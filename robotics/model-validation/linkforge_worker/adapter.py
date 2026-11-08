"""MEKONIQ policy around linkforge-core. LinkForge 1.6.0 repairs inertia, drops elements it dislikes and still says `valid`, so the pipeline is:
raw checks -> name map -> import -> parity -> upstream validator -> reference export. Nothing here repairs a model; every finding keeps the source ids."""
import contextlib
import io
import json
import logging
import math
import os
import platform
import posixpath
import re
import xml.etree.ElementTree as ET
from importlib import metadata
from pathlib import Path

from .names import NameMapError, make_name_map, rewrite_urdf
from .parity import compare, from_lf, from_model, from_urdf_xml

ADAPTER_VERSION = "linkforge-adapter/1"
POLICY_VERSION = "mekoniq-model-policy/1"
MAX_XML_BYTES = 2 * 1024 * 1024
_UNSAFE_XML = [("XML_DTD_REJECTED", re.compile(r"<!DOCTYPE|<!ENTITY", re.I)), ("XACRO_UNSUPPORTED", re.compile(r"xacro", re.I))]


class Reject(Exception):
    def __init__(self, code, detail):
        super().__init__(f"{code}: {detail}")
        self.code, self.detail = code, detail


def _issue(code, severity, path, entity, source, detail, **extra):
    return {"code": code, "severity": severity, "path": path, "entityId": entity, "source": source, "detail": str(detail)[:1000], **extra}


# ---------- reading the URDF safely ----------
def _inside(root: Path, rel: str) -> Path:
    if not isinstance(rel, str) or not rel or rel.startswith(("/", "\\")) or "://" in rel or re.match(r"^[A-Za-z]:", rel) or ".." in Path(rel).parts:
        raise Reject("PATH_REJECTED", f"{rel!r} is not a relative path inside the bundle")
    real_root = root.resolve()
    target = real_root / rel
    for part in [target, *target.parents]:
        if part == real_root:
            break
        if part.is_symlink():
            raise Reject("PATH_REJECTED", f"{rel!r} passes through a symbolic link")
    if real_root not in target.resolve().parents:
        raise Reject("PATH_REJECTED", f"{rel!r} escapes the bundle")
    return target


def _read_urdf(request):
    import hashlib
    root = Path(request["bundleRoot"])
    path = _inside(root, request["urdfPath"])
    if not path.is_file():
        raise Reject("PATH_REJECTED", f"{request['urdfPath']!r} is not a file in the bundle")
    if path.stat().st_size > MAX_XML_BYTES:
        raise Reject("XML_TOO_LARGE", f"{path.stat().st_size} bytes exceed {MAX_XML_BYTES}")
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != request["urdfSha256"]:
        raise Reject("SOURCE_HASH_MISMATCH", "the URDF bytes do not match the supplied digest")
    text = data.decode("utf-8", errors="strict")
    for code, pattern in _UNSAFE_XML:
        if pattern.search(text):
            raise Reject(code, "DTD/entity declarations and XACRO are not accepted")
    try:
        ET.fromstring(text)
    except ET.ParseError as e:
        raise Reject("XML_MALFORMED", e)
    return root, Path(request["urdfPath"]).parent.as_posix(), text


def _root_relative_meshes(text, urdf_dir, root):
    """Mesh filenames are relative to the URDF; LinkForge sandboxes them to its source directory, so rewrite them relative to the bundle root (and refuse escapes)."""
    tree = ET.fromstring(text)
    for mesh in tree.iter("mesh"):
        name = mesh.get("filename", "")
        _inside(root, posixpath.normpath(posixpath.join(urdf_dir, name)) if not name.startswith(("/", "\\")) and "://" not in name else name)
        mesh.set("filename", posixpath.normpath(posixpath.join(urdf_dir, name)))
    return ET.tostring(tree, encoding="unicode")


# ---------- raw (MEKONIQ policy) checks ----------
def _non_finite(value, path="", out=None):
    out = [] if out is None else out
    if isinstance(value, float) and not math.isfinite(value):
        out.append(path or "/")
    elif isinstance(value, dict):
        for k, v in value.items():
            _non_finite(v, f"{path}/{k}", out)
    elif isinstance(value, list):
        for i, v in enumerate(value):
            _non_finite(v, f"{path}/{i}", out)
    return out


def _eigenvalues(t):
    ixx, ixy, ixz, iyy, iyz, izz = t
    p1 = ixy * ixy + ixz * ixz + iyz * iyz
    q = (ixx + iyy + izz) / 3
    if p1 == 0:
        return sorted([ixx, iyy, izz])
    p2 = (ixx - q) ** 2 + (iyy - q) ** 2 + (izz - q) ** 2 + 2 * p1
    p = math.sqrt(p2 / 6)
    b = [[(ixx - q) / p, ixy / p, ixz / p], [ixy / p, (iyy - q) / p, iyz / p], [ixz / p, iyz / p, (izz - q) / p]]
    det = (b[0][0] * (b[1][1] * b[2][2] - b[1][2] * b[2][1]) - b[0][1] * (b[1][0] * b[2][2] - b[1][2] * b[2][0]) + b[0][2] * (b[1][0] * b[2][1] - b[1][1] * b[2][0])) / 2
    phi = math.acos(max(-1.0, min(1.0, det))) / 3
    e1 = q + 2 * p * math.cos(phi)
    e3 = q + 2 * p * math.cos(phi + 2 * math.pi / 3)
    return sorted([e3, 3 * q - e1 - e3, e1])


def _inertia_problem(t):
    ixx, ixy, ixz, iyy, iyz, izz = t
    minors = [ixx, ixx * iyy - ixy * ixy, ixx * (iyy * izz - iyz * iyz) - ixy * (ixy * izz - iyz * ixz) + ixz * (ixy * iyz - iyy * ixz)]
    if min(ixx, iyy, izz) <= 0 or any(m <= 0 for m in minors):
        return "tensor is not positive definite"
    a, b, c = _eigenvalues(t)
    if a + b < c * (1 - 1e-9):
        return "principal moments violate the triangle inequality"
    return None


def raw_checks(model):
    """Policy checks on the physical model alone. Returns (issues, checks)."""
    issues, robot = [], model["robotId"]
    for path in _non_finite(model):
        issues.append(_issue("NON_FINITE", "error", path, robot, "mekoniq", "NaN or Infinity is never a physical value"))
    links = {l["id"]: l for l in model["links"]}
    if len(links) != len(model["links"]):
        issues.append(_issue("DUPLICATE_ID", "error", "/links", robot, "mekoniq", "link ids must be unique"))
    for l in model["links"]:
        lid, base = l["id"], f"/links/{l['id']}"
        mass = l["massKg"]["value"]
        if isinstance(mass, (int, float)) and math.isfinite(mass) and mass <= 0:
            issues.append(_issue("MASS_INVALID", "error", f"{base}/massKg", lid, "mekoniq", "mass must be positive", linkId=lid))
        t = l.get("inertiaKgM2")
        if t is None:
            issues.append(_issue("INERTIA_MISSING", "error", f"{base}/inertiaKgM2", lid, "mekoniq", "inertia is unknown; no default is substituted", linkId=lid))
        elif all(isinstance(v, (int, float)) and math.isfinite(v) for v in t):
            problem = _inertia_problem(t)
            if problem:
                issues.append(_issue("INERTIA_INVALID", "error", f"{base}/inertiaKgM2", lid, "mekoniq", problem, linkId=lid))
    parents, topo = {}, []
    for j in model["joints"]:
        jid = j["id"]
        for end in ("parent", "child"):
            if j[end] not in links:
                topo.append(_issue("DANGLING_JOINT", "error", f"/joints/{jid}/{end}", jid, "mekoniq", f"{end} link {j[end]!r} does not exist", jointId=jid))
        if j["child"] in parents:
            topo.append(_issue("MULTIPLE_PARENT", "error", f"/joints/{jid}", jid, "mekoniq", f"link {j['child']!r} already has parent joint {parents[j['child']]!r}", jointId=jid, linkId=j["child"]))
        parents.setdefault(j["child"], jid)
        lim = j.get("limits") or {}
        if j["kind"] != "fixed":
            v, e = lim.get("velocity", {}).get("value"), lim.get("effort", {}).get("value")
            lo, hi = lim.get("lower", {}).get("value"), lim.get("upper", {}).get("value")
            if not (isinstance(v, (int, float)) and v > 0 and isinstance(e, (int, float)) and e > 0) or (lo is not None and hi is not None and lo >= hi):
                topo.append(_issue("JOINT_LIMITS_INVALID", "error", f"/joints/{jid}/limits", jid, "mekoniq", "velocity and effort must be positive and lower < upper", jointId=jid))
    roots = [i for i in links if i not in parents]
    if len(roots) > 1:
        topo.append(_issue("MULTIPLE_ROOTS", "error", "/links", robot, "mekoniq", f"{len(roots)} root links: {sorted(roots)}"))
    elif not roots and links:
        topo.append(_issue("CYCLE", "error", "/joints", robot, "mekoniq", "every link has a parent, so the joints form a cycle"))
    else:  # a root exists but part of the graph may still be a detached cycle
        seen, stack = set(), list(roots)
        kids = {}
        for j in model["joints"]:
            kids.setdefault(j["parent"], []).append(j["child"])
        while stack:
            n = stack.pop()
            if n not in seen:
                seen.add(n)
                stack.extend(kids.get(n, []))
        if seen != set(links) and not any(i["code"] == "DANGLING_JOINT" for i in topo):
            topo.append(_issue("CYCLE", "error", "/joints", robot, "mekoniq", f"links {sorted(set(links) - seen)} are not reachable from the root"))
    sensor_issues = [_issue("SENSOR_FRAME_MISSING", "error", f"/sensors/{s['sensorId']}", s["sensorId"], "mekoniq", f"sensor frame {s['parentLinkId']!r} is not a link of this robot")
                     for s in model["sensors"] if s["parentLinkId"] not in links]
    no_collision = [l["id"] for l in model["links"] if not l["collision"]]
    cov = [_issue("COLLISION_MISSING", "warning", f"/links/{i}/collision", i, "mekoniq", "no collision shape; collision coverage is unknown for this link", linkId=i) for i in no_collision]
    issues += topo + sensor_issues + cov
    checks = [{"id": "MEKONIQ-RAW", "source": "mekoniq", "result": "fail" if any(i["severity"] == "error" for i in issues if i not in sensor_issues) else "pass",
               "coverageScope": "finite values, mass, inertia, topology, joint limits"},
              {"id": "SENSOR-FRAMES", "source": "mekoniq", "result": "fail" if sensor_issues else "pass", "coverageScope": "sensor parent links"},
              {"id": "COLLISION-COVERAGE", "source": "mekoniq", "result": "inconclusive" if no_collision else "pass", "coverageScope": "collision shape per link"}]
    return issues, checks


# ---------- LinkForge ----------
class _Capture(logging.Handler):
    def __init__(self):
        super().__init__(logging.DEBUG)
        self.lines = []

    def emit(self, record):
        self.lines.append(record.getMessage())


def _lf_import(xml_text, root):
    import linkforge.core as lf
    from linkforge.core.parsers import URDFParser
    cap, out, err = _Capture(), io.StringIO(), io.StringIO()
    logging.getLogger().addHandler(cap)
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            robot = URDFParser().parse_string(xml_text, source_directory=root)
    finally:
        logging.getLogger().removeHandler(cap)
    notes = cap.lines + [l for l in (out.getvalue() + err.getvalue()).splitlines() if l.strip()]
    return lf, robot, notes


def validate_request(request):
    """One validated request -> {'report': ModelValidationReportV1 without digest and artifact refs, 'artifacts': {name: text}}. Never prints to stdout."""
    model = request["model"]
    robot_id = model["robotId"]
    base = {"schemaVersion": 1, "documentType": "model-validation-report", "physicalModelDigest": model["modelDigest"], "assemblyDigest": model["inputs"]["assemblyDigest"], "robotId": robot_id,
            "mode": "shadow", "nameMapRef": None, "inputUrdfRef": None, "referenceUrdfRef": None, "referenceSrdfRef": None, "assumptions": list(model.get("assumptions", [])), "limitations": []}
    engine = {"package": "linkforge-core", "packageVersion": metadata.version("linkforge-core"), "pythonVersion": platform.python_version(), "lockDigest": request["lockDigest"],
              "adapterVersion": request.get("adapterVersion", ADAPTER_VERSION), "policyVersion": POLICY_VERSION}
    issues, checks, artifacts = [], [], {}

    def finish(execution="ran"):
        errors = any(i["severity"] == "error" for i in issues)
        result = "fail" if errors and execution == "ran" else "inconclusive" if execution != "ran" or any(c["result"] in ("inconclusive",) for c in checks) else "pass"
        uniq = {(i["code"], i["path"], i["detail"]): i for i in issues}
        ordered = sorted(uniq.values(), key=lambda i: ({"error": 0, "warning": 1, "info": 2}[i["severity"]], i["code"], i["path"]))[:500]
        return {"report": {**base, "execution": execution, "result": result, "engine": engine, "checks": checks, "issues": ordered,
                           "limitations": ["model consistency only: not a simulation, strength, stability or safety result", "reference URDF carries the physical model's source ids"]},
                "artifacts": artifacts}

    try:
        root, urdf_dir, text = _read_urdf(request)
    except Reject as e:
        issues.append(_issue(e.code, "error", "/urdf", robot_id, "mekoniq", e.detail))
        failed_hard = e.code in ("PATH_REJECTED", "SOURCE_HASH_MISMATCH")
        checks.append({"id": "SOURCE-URDF", "source": "mekoniq", "result": "fail", "coverageScope": "URDF input acceptance"})
        raw_issues, raw_checks_ = raw_checks(model)
        issues += raw_issues
        checks += raw_checks_
        return finish("failed" if failed_hard else "ran")
    except UnicodeDecodeError as e:
        issues.append(_issue("XML_MALFORMED", "error", "/urdf", robot_id, "mekoniq", e))
        return finish()

    raw_issues, raw_checks_ = raw_checks(model)
    issues += raw_issues
    checks += raw_checks_
    try:
        names = make_name_map({"link": [l["id"] for l in model["links"]], "joint": [j["id"] for j in model["joints"]], "sensor": [s["sensorId"] for s in model["sensors"]]})
        mapped_xml = _root_relative_meshes(rewrite_urdf(text, names["forward"]), urdf_dir, root)
    except (NameMapError, Reject) as e:
        issues.append(_issue(e.code, "error", "/urdf", robot_id, "mekoniq", e.detail))
        checks.append({"id": "SOURCE-URDF", "source": "mekoniq", "result": "fail", "coverageScope": "name mapping"})
        return finish("failed" if isinstance(e, Reject) else "ran")
    artifacts["name-map.json"] = json.dumps(names, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    reverse = {k: v for kind in names["reverse"].values() for k, v in kind.items()}

    def back(text_):
        for mapped, src in reverse.items():
            text_ = text_.replace(mapped, src)
        return text_

    def restore(findings, source):
        out = []
        for f in findings:
            g = {k: (back(v) if isinstance(v, str) else v) for k, v in f.items() if k != "numeric"}
            g["source"] = source
            out.append(g)
        return out

    try:
        raw_xml = from_urdf_xml(mapped_xml)
        from_mdl = from_model(model, names["forward"])
    except (ET.ParseError, KeyError, AttributeError, TypeError, ValueError) as e:
        issues.append(_issue("XML_MALFORMED", "error", "/urdf", robot_id, "mekoniq", f"unreadable URDF structure: {e}"))
        return finish()
    src = restore(compare(from_mdl, raw_xml, "URDF_MODEL"), "mekoniq")
    issues += src
    checks.append({"id": "SOURCE-URDF", "source": "mekoniq", "result": "fail" if src else "pass", "coverageScope": "URDF equals the physical model: links, joints, shapes, inertials"})

    robot = None
    try:
        lf, robot, notes = _lf_import(mapped_xml, root)
        checks.append({"id": "LF-IMPORT", "source": "linkforge", "result": "pass", "coverageScope": "read_urdf completed"})
        for n in sorted(set(notes))[:20]:
            issues.append(_issue("LF_IMPORT_DIAGNOSTIC", "warning", "/urdf", robot_id, "linkforge", back(n)))
    except Exception as e:  # LinkForge raises its own error family; any failure is reported, never swallowed into a pass
        issues.append(_issue("LF_IMPORT_FAILED", "error", "/urdf", robot_id, "linkforge", back(f"{type(e).__name__}: {e}")))
        checks.append({"id": "LF-IMPORT", "source": "linkforge", "result": "fail", "coverageScope": "read_urdf completed"})
        checks.append({"id": "LF-PARITY", "source": "parity", "result": "not_run", "coverageScope": "import failed, nothing to compare"})
    if robot is not None:
        par = restore(compare(raw_xml, from_lf(robot), "LF"), "parity")
        issues += par
        checks.append({"id": "LF-PARITY", "source": "parity", "result": "fail" if par else "pass", "coverageScope": "link/joint sets, parent-child, types, axes, origins, limits, visual/collision shapes, mass, COM, inertia"})
        verdict = lf.RobotValidator().validate(robot)
        for sev, items in (("error", verdict.errors), ("warning", verdict.warnings)):
            for item in items:
                code = getattr(item.code, "value", item.code)
                ent = back(", ".join(item.affected_objects[:1])) if item.affected_objects else robot_id
                issues.append(_issue("LF_" + str(code).upper(), sev, "/model", ent, "linkforge", back(f"{item.title}: {item.message}"), upstreamCode=str(code)))
        checks.append({"id": "LF-VALIDATOR", "source": "linkforge", "result": "pass" if verdict.is_valid else "fail", "coverageScope": "RobotValidator default checks on the imported model"})
        if any(i["severity"] == "error" for i in issues):
            checks.append({"id": "REFERENCE-EXPORT", "source": "parity", "result": "not_run", "coverageScope": "not exported: the input has blocking issues"})
        else:
            from linkforge.core.generators import URDFGenerator
            exported = URDFGenerator().generate(robot)
            found = compare(raw_xml, from_urdf_xml(exported), "EXPORT")
            structural = [f for f in found if not f.get("numeric")]
            # LinkForge's serializer writes 6 decimals, so small tensors can miss the declared precision (inertia 1e-9 abs / 1e-5 rel). That withholds the
            # reference artifact (and says why); it is not a defect of the input model. A missing or changed element is still an error.
            issues += restore(structural, "parity") + [{**f, "severity": "warning"} for f in restore([f for f in found if f.get("numeric")], "parity")]
            if structural:
                result, scope = "fail", "re-export lost or changed elements"
            elif found:
                result, scope = "not_run", f"reference URDF withheld: LinkForge's serializer exceeds the declared precision on {len(found)} value(s) (LF_EXPORT_MISMATCH)"
            else:
                result, scope = "pass", "re-export within declared precision: pose 1e-6, mass 1e-6, inertia 1e-9 abs / 1e-5 rel"
            checks.append({"id": "REFERENCE-EXPORT", "source": "parity", "result": result, "coverageScope": scope})
            if not found:
                artifacts["reference.urdf"] = _restore_reference(exported, names, urdf_dir)
    checks.append({"id": "SRDF", "source": "linkforge", "result": "not_run", "coverageScope": "SEMANTIC_PROFILE_NOT_SUPPLIED: no SRDF is generated without a hashed semantic policy"})
    return finish()


def _restore_reference(exported, names, urdf_dir):
    tree = ET.fromstring(exported)
    for mesh in tree.iter("mesh"):
        mesh.set("filename", posixpath.relpath(mesh.get("filename", ""), urdf_dir or "."))
    return rewrite_urdf(ET.tostring(tree, encoding="unicode"), names["reverse"])
