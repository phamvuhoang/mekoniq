import { MAX_TRAYS } from '../project/schema';
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { RobotDesign } from "../shared/types";
import { compileAsset, serviceAmrAsset } from "../twin/model";
export type Viewer = {
  dispose: () => void;
  explode: (value: number) => void;
  select: (id: string) => void;
  reset: () => void;
};
export function mountRobot(
  host: HTMLElement,
  design: RobotDesign,
  onSelect: (id: string) => void,
  onFallback: () => void,
): Viewer | null {
  // A valid project has 1..MAX_TRAYS trays; clamp so an out-of-range design still draws a coherent robot.
  const trays = Number.isFinite(design.trays) ? Math.min(MAX_TRAYS, Math.max(1, Math.floor(design.trays))) : 1;
  let disposed = false;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  host.appendChild(renderer.domElement);
  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    queueMicrotask(() => {
      if (!disposed) onFallback();
    });
  });
  renderer.domElement.setAttribute(
    "aria-label",
    "Illustrative service robot — use component list to select parts",
  );
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(2.7, 2, 3.2);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.85, 0);
  controls.enableDamping = false;
  controls.minDistance = 2.5;
  controls.maxDistance = 9;
  controls.maxPolarAngle = Math.PI * 0.52;
  controls.enablePan = false;
  scene.add(new THREE.HemisphereLight(0xc9e8ff, 0x24373b, 3));
  const light = new THREE.DirectionalLight(0xffffff, 5);
  light.position.set(2, 5, 3);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  scene.add(light);
  const rim = new THREE.DirectionalLight(0xb4f375, 2);
  rim.position.set(-3, 2, -2);
  scene.add(rim);
  const group = new THREE.Group();
  scene.add(group);
  const parts: THREE.Mesh[] = [];
  const white = new THREE.MeshStandardMaterial({
    color: 0xd6dfdb,
    metalness: 0.55,
    roughness: 0.32,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x182a33,
    metalness: 0.5,
    roughness: 0.4,
  });
  const lime = new THREE.MeshStandardMaterial({
    color: 0xb4f375,
    metalness: 0.35,
    roughness: 0.3,
    emissive: 0x324c18,
    emissiveIntensity: 0.3,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x111b20,
    roughness: 0.9,
  });
  function mesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    id: string,
    x: number,
    y: number,
    z: number,
    layer: number,
  ): THREE.Mesh {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData = { id, baseY: y, layer, material };
    parts.push(m);
    group.add(m);
    return m;
  }
  // Dimensions come from the compiled asset revision (single geometry source, shared with collision); the viewer holds no body size of its own.
  // Asset frame: x forward, y left, z up. Scene: x right, y up, z forward.
  const model = compileAsset(serviceAmrAsset({ ...design, chassis: "service", trays }));
  const shape = (frameId: string) => model.visual.shapes.find((sh) => sh.frameId === frameId)!;
  const sizeOf = (frameId: string) => (shape(frameId) as unknown as { sizeM: number[] }).sizeM;
  const at = (frameId: string) => { const p = shape(frameId).pose.position; return { x: -p[1]!, y: p[2]!, z: p[0]! }; };
  const box = (frameId: string, color: THREE.Material, id: string, layer: number, size = sizeOf(frameId), dy = 0) => {
    const p = at(frameId);
    return mesh(new THREE.BoxGeometry(size[1], size[2], size[0]), color, id, p.x, p.y + dy, p.z, layer);
  };
  const [bodyL, bodyW, bodyH] = sizeOf("chassis"), bodyP = at("chassis"), bodyTop = bodyP.y + bodyH! / 2;
  box("chassis", white, "chassis", 0);
  mesh(new THREE.BoxGeometry(bodyW, 0.02, bodyL), dark, "chassis", bodyP.x, bodyTop, bodyP.z, 0);
  mesh(new THREE.BoxGeometry(bodyW! + 0.006, 0.03, bodyL! + 0.006), lime, "chassis", bodyP.x, bodyP.y - bodyH! / 2 + 0.03, bodyP.z, 0);
  const wheelR = sizeOf("drive")[2]! * 0.75, driveP = at("drive");
  for (const x of [-1, 1]) {
    const w = mesh(new THREE.CylinderGeometry(wheelR, wheelR, 0.06, 24), rubber, "drive", x * (bodyW! / 2 - 0.03), driveP.y, driveP.z, 0);
    w.rotation.z = Math.PI / 2;
  }
  box("battery", dark, "battery", 1);
  const [trayL, trayW] = sizeOf("tray_1"), topTray = at(`tray_${trays}`);
  for (const x of [-1, 1])
    for (const z of [-1, 1]) {
      const h = topTray.y + 0.15 - bodyTop;
      mesh(new THREE.CylinderGeometry(0.021, 0.021, h, 12), white, "trays", x * (trayW! / 2 - 0.02), bodyTop + h / 2, z * (trayL! / 2 - 0.02), 1);
    }
  for (let i = 1; i <= trays; i++) {
    const p = at(`tray_${i}`), layer = 1 + i;
    box(`tray_${i}`, dark, "trays", layer);
    mesh(new THREE.BoxGeometry(trayW! - 0.04, 0.009, trayL! - 0.04), white, "trays", p.x, p.y + 0.023, p.z, layer);
    for (const x of [-1, 1]) mesh(new THREE.BoxGeometry(0.018, 0.055, trayL! - 0.01), dark, "trays", p.x + x * (trayW! / 2 - 0.01), p.y + 0.03, p.z, layer);
    mesh(new THREE.BoxGeometry(trayW! - 0.04, 0.055, 0.018), dark, "trays", p.x, p.y + 0.03, p.z - (trayL! / 2 - 0.01), layer);
    if (i === 2) {
      // Decorative cup, kept inside the tray rectangle.
      const cx = p.x + trayW! / 2 - 0.13;
      mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.013, 32), white, "trays", cx, p.y + 0.045, p.z + 0.02, layer);
      mesh(new THREE.CylinderGeometry(0.055, 0.035, 0.06, 32), lime, "trays", cx, p.y + 0.07, p.z + 0.02, layer);
    }
  }
  const [tabL, tabW, tabT] = sizeOf("tablet"), tab = at("tablet"), standH = tab.y - (topTray.y + 0.02);
  mesh(new THREE.BoxGeometry(0.04, standH, 0.04), white, "tablet", tab.x, topTray.y + 0.02 + standH / 2, tab.z - 0.04, trays + 2);
  const tablet = mesh(new THREE.BoxGeometry(tabW, tabL, tabT), dark, "tablet", tab.x, tab.y, tab.z, trays + 2);
  tablet.rotation.x = -0.3;
  const screen = mesh(new THREE.BoxGeometry(tabW! - 0.04, tabL! - 0.04, 0.005), lime, "tablet", tab.x, tab.y, tab.z + 0.02, trays + 2);
  screen.rotation.x = -0.3;
  const sensorShape = shape("sensor"), sp = at("sensor");
  if (sensorShape.kind === "cylinder") {
    mesh(new THREE.CylinderGeometry(sensorShape.radiusM, sensorShape.radiusM, sensorShape.heightM, 32), dark, "sensor", sp.x, sp.y, sp.z, 1);
    mesh(new THREE.CylinderGeometry(sensorShape.radiusM + 0.001, sensorShape.radiusM + 0.001, 0.012, 32), lime, "sensor", sp.x, sp.y + sensorShape.heightM / 2, sp.z, 1);
  } else if (sensorShape.kind === "box") {
    const [l, w, h] = sensorShape.sizeM;
    mesh(new THREE.BoxGeometry(w, h, l), dark, "sensor", sp.x, sp.y, sp.z, 1);
    mesh(new THREE.BoxGeometry(w! * 0.8, 0.018, l!), lime, "sensor", sp.x, sp.y + h! / 2, sp.z, 1);
  }
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(1.55, 80),
    new THREE.MeshStandardMaterial({
      color: 0x15252b,
      roughness: 1,
      transparent: true,
      opacity: 0.9,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.position.y = 0.008;
  scene.add(floor);
  const grid = new THREE.GridHelper(5, 25, 0x3e565c, 0x263d43);
  grid.position.y = 0.012;
  scene.add(grid);
  // Collision footprint from the same asset (service only; a Valetudo footprint is unknown and is not drawn).
  const footprint = design.chassis === "service" ? model.collision.footprint : null;
  if (footprint) {
    const [x0, y0] = footprint.min, [x1, y1] = footprint.max;
    const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([ax, ay]) => new THREE.Vector3(-ay!, 0.02, ax));
    const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners), new THREE.LineBasicMaterial({ color: 0xb4f375, transparent: true, opacity: 0.9, depthTest: false }));
    outline.name = "collision-footprint";
    outline.renderOrder = 2; // drawn over the mesh so the collision outline stays comparable with the visual
    scene.add(outline);
    const r = model.collision.radiusM!;
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.006, 80), new THREE.MeshBasicMaterial({ color: 0xb4f375, side: THREE.DoubleSide, transparent: true, opacity: 0.35, depthTest: false }));
    ring.renderOrder = 2;
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    scene.add(ring);
  }
  const render = () => renderer.render(scene, camera);
  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    renderer.setSize(width, height);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    render();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  controls.addEventListener("change", render);
  let down = { x: 0, y: 0 };
  renderer.domElement.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const r = host.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        (-(e.clientY - r.top) / r.height) * 2 + 1,
      ),
      camera,
    );
    const hit = ray.intersectObjects(parts)[0];
    if (hit) onSelect(String(hit.object.userData.id));
  });
  resize();
  return {
    explode(value) {
      camera.position.set(
        2.7 + value * 0.7,
        2 + value * 0.8,
        3.2 + value * 0.8,
      );
      controls.target.set(0, 0.85 + value * 0.4, 0);
      controls.update();
      for (const m of parts)
        m.position.y =
          Number(m.userData.baseY) + Number(m.userData.layer) * value * 0.15;
      render();
    },
    select(id) {
      for (const m of parts) {
        m.material = m.userData.id === id ? lime : m.userData.material;
      }
      render();
    },
    reset() {
      camera.position.set(2.7, 2, 3.2);
      controls.target.set(0, 0.85, 0);
      controls.update();
      render();
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          for (const material of Array.isArray(o.material)
            ? o.material
            : [o.material])
            material.dispose();
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      host.replaceChildren();
    },
  };
}
