import type {CompiledScene} from '../shared/engineering';
import type {TwinRuntime} from './controls';
import {TwinRuntimeError} from './controls';
/** Reads the compiler's own scene.json out of a compiled bundle; nothing else may be drawn as "the compiled robot". */
export async function loadCompiledScene(runtime:TwinRuntime,bundleDigest:string):Promise<CompiledScene> {
  if (!runtime.engineeringManifest||!runtime.engineeringBlob) throw new TwinRuntimeError('ENGINEERING_CAPABILITY_REQUIRED',[],0);
  const manifest=await runtime.engineeringManifest(bundleDigest),entry=manifest.files.find(f=>f.path==='scene.json');
  if (!entry||entry.sha256!==manifest.sceneDigest) throw new TwinRuntimeError('ENGINEERING_SCENE_MISSING',[],409);
  return JSON.parse(new TextDecoder().decode(await runtime.engineeringBlob(entry.sha256))) as CompiledScene;
}
/** The bundle's navigation-scene.json (IR-SIM 2D bundles only): compiled footprints, sensor mounts and obstacles the run uses; null when the bundle has none. */
export async function loadNavigationScene(runtime:TwinRuntime,bundleDigest:string):Promise<import('../shared/navigation2d').NavigationSceneV1|null> {
  if (!runtime.engineeringManifest||!runtime.engineeringBlob) return null;
  const entry=(await runtime.engineeringManifest(bundleDigest)).files.find(f=>f.path==='navigation-scene.json');
  if (!entry) return null;
  const scene=JSON.parse(new TextDecoder().decode(await runtime.engineeringBlob(entry.sha256)));
  return scene?.documentType==='navigation-scene'&&scene.schemaVersion===1&&Array.isArray(scene.robots)?scene:null;
}
/** The bundle's bill of materials, from its own bom.json. */
export async function loadBom(runtime:TwinRuntime,bundleDigest:string):Promise<import('../shared/engineering').Bom> {
  const manifest=await runtime.engineeringManifest!(bundleDigest),entry=manifest.files.find(f=>f.path==='bom.json');
  if (!entry) throw new TwinRuntimeError('ENGINEERING_BOM_MISSING',[],409);
  return JSON.parse(new TextDecoder().decode(await runtime.engineeringBlob!(entry.sha256)));
}
