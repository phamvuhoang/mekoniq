"""`python3 -m compiler --fixture <project+assetFiles json> --out <dir> [--scenario <scenario json>] [--map-id lab-world]`
Compiles one bundle and prints a JSON summary. Exit 2: inputs missing/unreadable; exit 1: the compiler refused the input (code on stderr)."""
import argparse
import json
import sys
from pathlib import Path

from actors.scenario import load_scenario

from .compile_world import CompileError, compile_world


def engineering_main(argv):
    """`python3 -m compiler engineering --input <EngineeringCompileInput json> --out <dir>`: prints {sceneDigest, files}. Exit 1: refused (CODE: detail on stderr); 2: unreadable input."""
    from .engineering import compile_engineering
    p = argparse.ArgumentParser(prog="compiler engineering")
    p.add_argument("--input", required=True)
    p.add_argument("--out", required=True)
    a = p.parse_args(argv)
    try:
        data = json.loads(Path(a.input).read_text())
    except (OSError, ValueError) as e:
        print(f"INPUT_INVALID: {e}", file=sys.stderr)
        return 2
    try:
        result = compile_engineering(data, a.out)
    except CompileError as e:
        print(f"{e.code}: {e.detail or ''}", file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["engineering"]:
        return engineering_main(argv[1:])
    p = argparse.ArgumentParser(prog="compiler")
    p.add_argument("--fixture", required=True, help="JSON with {project, assetFiles[]} (paths relative to the fixture file)")
    p.add_argument("--out", required=True)
    p.add_argument("--scenario", default=None)
    p.add_argument("--map-id", default="lab-world")
    a = p.parse_args(argv)
    fixture = Path(a.fixture)
    if not fixture.is_file():
        print(f"FIXTURE_MISSING: {fixture}", file=sys.stderr)
        return 2
    try:
        fx = json.loads(fixture.read_text())
        assets = [json.loads((fixture.parent / f).read_text()) for f in fx.get("assetFiles", [])]
        scenario = load_scenario(a.scenario) if a.scenario else None
    except (OSError, ValueError) as e:
        print(f"INPUT_INVALID: {e}", file=sys.stderr)
        return 2
    try:
        manifest = compile_world(fx["project"], assets, a.out, map_id=a.map_id, scenario=scenario)
    except CompileError as e:
        print(f"{e.code}: {e.detail or ''}", file=sys.stderr)
        return 1
    print(json.dumps({"inputHash": manifest["inputHash"], "manifestHash": manifest["manifestHash"], "outputDirectory": str(Path(a.out)), "scenario": manifest["scenario"],
                      "robots": [r["namespace"] for r in manifest["robots"]]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
