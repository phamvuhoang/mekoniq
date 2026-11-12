// Writes the xarm6-g2-v1 fixture (R2a M02, D38): UFACTORY xArm 6 (1305) + Gripper G2 from the pinned xarm_ros2 files as one engineering component, byte-stable.
//   pnpm exec tsx scripts/generate-xarm6-fixture.mjs [--out <dir>]      (default robotics/simulation-mujoco/fixtures/xarm6-g2-v1)
// Reads only robotics/catalog/documents/<sha256> and the fixture's vendor-manifest.json; never the network. Vendor text is data: XML and a YAML subset are
// parsed, the xacro is never expanded or evaluated. Masses, inertia, joint origins, limits and meshes are manufacturer nominal; the cell layout, gains,
// friction, contact and pads are the spike M00 assumptions (docs/research/2026-11-mujoco-arm-spike.md), copied verbatim.
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MAX_CONDITION,XARM6_SI,forwardKinematics,jacobianCondition,solvePose} from '../packages/lab-runtime/src/v2/models/arm-kinematics';
import {qconj,qmul,qrotate} from '../packages/lab-runtime/src/v2/frames';
import {hashJson} from '../packages/lab-runtime/src/v2/hash';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
export const FIXTURE_DIR='robotics/simulation-mujoco/fixtures/xarm6-g2-v1';
const DOCS=join(ROOT,'robotics/catalog/documents');
/** Every legitimate G2 vertex lies within 0.15 m of its link origin; the 300 stray triangles of base_link_g2.dae (spike M00) sit 0.50-0.55 m away. */
export const STRAY_RADIUS_M=0.3;
const STL_HEADER=Buffer.from('M00 dae2stl'.padEnd(80,' '),'latin1'); // the spike's converter header, so unfiltered meshes can be cross-checked byte for byte

// ---- deterministic JSON (same rules as generate-arm-fixture.mjs) ----
const r12=(x)=>{const v=Number(x.toPrecision(12));return Object.is(v,-0)?0:v;};
const round=(v)=>Array.isArray(v)?v.map(round):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,round(x)])):typeof v==='number'?r12(v):v;
const sortKeys=(v)=>Array.isArray(v)?v.map(sortKeys):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map((k)=>[k,sortKeys(v[k])])):v;
const text=(v)=>JSON.stringify(sortKeys(round(v)),null,2)+'\n';
const sha=(b)=>createHash('sha256').update(b).digest('hex');

// ---- XML as data: elements, attributes, text. No DTD, no entities beyond the five predefined ones. ----
const ENT={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"},unent=(s)=>s.replace(/&(amp|lt|gt|quot|apos);/g,(_,k)=>ENT[k]);
export function parseXml(src){
  const root={name:'#root',attrs:{},children:[],text:''},stack=[root];
  const re=/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m,at=0;
  while((m=re.exec(src))){
    if(m.index!==at)throw new Error(`XML_INVALID: offset ${at}`);
    at=re.lastIndex;const top=stack.at(-1);
    if(m[2]){if(top.name!==m[2])throw new Error(`XML_INVALID: </${m[2]}> closes <${top.name}>`);stack.pop();}
    else if(m[3]){const el={name:m[3],attrs:{},children:[],text:''};for(const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))el.attrs[a[1]]=unent(a[2]??a[3]);top.children.push(el);if(!m[5])stack.push(el);}
    else if(m[6]!==undefined)top.text+=unent(m[6]);
    else if(m[1]!==undefined)top.text+=m[1];
  }
  if(at!==src.length||stack.length!==1)throw new Error('XML_INVALID: unclosed element');
  return root;
}
const all=(el,pred,out=[])=>{for(const c of el.children){if(pred(c))out.push(c);all(c,pred,out);}return out;};
const one=(el,pred,what)=>{const f=all(el,pred);if(f.length!==1)throw new Error(`VENDOR_FORMAT: ${f.length} matches for ${what}`);return f[0];};
const child=(el,name)=>{const f=el.children.filter((c)=>c.name===name);if(f.length!==1)throw new Error(`VENDOR_FORMAT: ${f.length} <${name}> in <${el.name} ${el.attrs.name??''}>`);return f[0];};
const nums=(s,n)=>{const v=String(s).trim().split(/\s+/).map(Number);if(!v.every(Number.isFinite)||(n!==undefined&&v.length!==n))throw new Error(`VENDOR_FORMAT: numbers "${s}"`);return v;};

/** The two-level YAML maps of xarm_description/config: `key:` or `key: number|bool`, comments, nothing else. */
export function parseYamlMap(src){
  const root={},stack=[{indent:-1,obj:root}];
  for(const raw of src.split('\n')){
    const line=raw.replace(/(^|\s)#.*$/,'').trimEnd();if(!line.trim())continue;
    const m=/^( *)([A-Za-z0-9_]+):(?: +(\S+))?$/.exec(line);if(!m)throw new Error(`YAML_UNSUPPORTED: ${raw}`);
    while(stack.at(-1).indent>=m[1].length)stack.pop();
    const parent=stack.at(-1).obj;
    if(m[3]===undefined){const o={};parent[m[2]]=o;stack.push({indent:m[1].length,obj:o});}
    else if(m[3]==='true'||m[3]==='false')parent[m[2]]=m[3]==='true';
    else if(/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(m[3]))parent[m[2]]=Number(m[3]);
    else throw new Error(`YAML_UNSUPPORTED: ${raw}`);
  }
  return root;
}
/** The only xacro expressions the limits use: ${n}, ${-n}, ${pi}, ${-n*pi}. Anything else is refused, not evaluated. */
export function xacroNumber(s){
  const m=/^\$\{(-?)(?:(\d+(?:\.\d+)?)\*)?(pi|\d+(?:\.\d+)?)\}$/.exec(String(s).replace(/\s+/g,''));
  if(!m)throw new Error(`XACRO_EXPRESSION_UNSUPPORTED: ${s}`);
  const v=(m[2]?Number(m[2]):1)*(m[3]==='pi'?Math.PI:Number(m[3]));return m[1]?-v:v;
}

// ---- frames ----
const qx=(a)=>[Math.sin(a/2),0,0,Math.cos(a/2)],qy=(a)=>[0,Math.sin(a/2),0,Math.cos(a/2)],qz=(a)=>[0,0,Math.sin(a/2),Math.cos(a/2)];
/** URDF rpy is fixed-axis X, Y, Z: R = Rz(yaw) Ry(pitch) Rx(roll). */
export const rpyToQuat=([r,p,y])=>qmul(qmul(qz(y),qy(p)),qx(r));
const axisAngle=(u,a)=>{const n=Math.hypot(...u),s=Math.sin(a/2)/n;return [u[0]*s,u[1]*s,u[2]*s,Math.cos(a/2)];};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
/** Unit quaternion (xyzw) of the rotation whose columns are x, y, z. */
function quatFromColumns(x,y,z){
  const [m00,m10,m20]=x,[m01,m11,m21]=y,[m02,m12,m22]=z,t=m00+m11+m22;
  if(t>0){const s=2*Math.sqrt(t+1);return [(m21-m12)/s,(m02-m20)/s,(m10-m01)/s,s/4];}
  if(m00>m11&&m00>m22){const s=2*Math.sqrt(1+m00-m11-m22);return [s/4,(m01+m10)/s,(m02+m20)/s,(m21-m12)/s];}
  if(m11>m22){const s=2*Math.sqrt(1+m11-m00-m22);return [(m01+m10)/s,s/4,(m12+m21)/s,(m02-m20)/s];}
  const s=2*Math.sqrt(1+m22-m00-m11);return [(m02+m20)/s,(m12+m21)/s,s/4,(m10-m01)/s];
}
/** Gripper frame for a horizontal approach a (spike rot_side): z = a, y horizontal (closing direction), x = y x z (down). */
export const sideGrasp=(a)=>{const n=Math.hypot(a[0],a[1]),z=[a[0]/n,a[1]/n,0],y=[-z[1],z[0],0];return quatFromColumns(cross(y,z),y,z);};

/** Pure flange FK of the component: walks J1..J6 from `base`, T = prod(Trans(origin.xyz) Rot(origin.q) Rot(axis, q_i)); returns the link6 origin (m, base frame). */
export function chainFlange(component,q){
  let link='base',p=[0,0,0],r=[0,0,0,1];
  for(let i=0;i<6;i++){
    const j=component.joints.find((x)=>x.id===`J${i+1}`);
    if(!j||j.parent!==link)throw new Error(`CHAIN_INVALID: J${i+1}`);
    const o=qrotate(r,j.origin.xyzM);p=[p[0]+o[0],p[1]+o[1],p[2]+o[2]];r=qmul(qmul(r,j.origin.quaternionXyzw),axisAngle(j.axis,q[i]));link=j.child;
  }
  return p;
}

// ---- meshes ----
const stlTriangles=(b)=>{if(b.length<84||b.length!==84+50*b.readUInt32LE(80))throw new Error('VENDOR_FORMAT: not a binary STL');return b.readUInt32LE(80);};
/** COLLADA -> binary STL as the spike's meshinfo.py dae2stl: first geometry, its single <triangles>, the node matrix chain of the first visual scene,
 *  unit scale, zero normals, float32 little-endian, fixed header; then drops every triangle with a vertex farther than maxRadiusM from the origin. */
export function dae2stl(src,maxRadiusM=STRAY_RADIUS_M){
  const doc=parseXml(src),col=child(doc,'COLLADA');
  const unit=Number(child(child(col,'asset'),'unit').attrs.meter??'1');
  const geo=child(col,'library_geometries').children.find((c)=>c.name==='geometry'),mesh=child(geo,'mesh');
  if(mesh.children.some((c)=>c.name==='polylist'||c.name==='polygons'))throw new Error('VENDOR_FORMAT: polygons are not triangles');
  const tri=child(mesh,'triangles'),inputs=tri.children.filter((c)=>c.name==='input'),vin=inputs.find((i)=>i.attrs.semantic==='VERTEX');
  const stride=1+Math.max(...inputs.map((i)=>Number(i.attrs.offset))),off=Number(vin.attrs.offset);
  const posId=child(mesh,'vertices').children.find((c)=>c.name==='input'&&c.attrs.semantic==='POSITION').attrs.source.slice(1);
  const source=mesh.children.find((c)=>c.name==='source'&&c.attrs.id===posId),fa=nums(child(source,'float_array').text);
  if(child(child(source,'technique_common'),'accessor').attrs.stride!=='3'||fa.length%3)throw new Error('VENDOR_FORMAT: positions are not xyz');
  const idx=nums(child(tri,'p').text).filter((_,i)=>i%stride===off);
  if(idx.length!==3*Number(tri.attrs.count))throw new Error('VENDOR_FORMAT: triangle count');
  const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],mat=(a,b)=>a.map((_,i)=>[0,1,2,3].map((j)=>[0,1,2,3].reduce((s,k)=>s+a[i][k]*b[k][j],0)));
  const walk=(node,M)=>{
    const m=node.children.find((c)=>c.name==='matrix'),M2=m?mat(M,[0,1,2,3].map((i)=>nums(m.text,16).slice(4*i,4*i+4))):M;
    if(node.children.some((c)=>c.name==='instance_geometry'&&c.attrs.url===`#${geo.attrs.id}`))return M2;
    for(const c of node.children.filter((c)=>c.name==='node')){const got=walk(c,M2);if(got)return got;}
    return null;
  };
  const scene=child(col,'library_visual_scenes').children.find((c)=>c.name==='visual_scene');
  let M=null;for(const n of scene.children.filter((c)=>c.name==='node')){M=walk(n,I);if(M)break;}
  if(!M)throw new Error('VENDOR_FORMAT: no node instances the geometry');
  const tf=(i)=>[0,1,2].map((r)=>unit*(M[r][0]*fa[3*i]+M[r][1]*fa[3*i+1]+M[r][2]*fa[3*i+2]+M[r][3]));
  const kept=[];let dropped=0;
  for(let k=0;k<idx.length;k+=3){const t=[tf(idx[k]),tf(idx[k+1]),tf(idx[k+2])];if(t.some((v)=>Math.hypot(...v)>maxRadiusM))dropped++;else kept.push(t);}
  const out=Buffer.alloc(84+50*kept.length);STL_HEADER.copy(out,0);out.writeUInt32LE(kept.length,80);
  kept.forEach((t,k)=>{const o=84+50*k;t.flat().forEach((v,i)=>out.writeFloatLE(v,o+12+4*i));});
  return {bytes:out,triangles:kept.length,droppedTriangles:dropped};
}

// ---- vendor description ----
const ARM_DIR='xarm_description/meshes/xarm6_1305/visual'; // the xacro's model_num >= 1305 branch (spike M00); checked against the xacro text below
const GRIPPER_SUFFIX='_g2'; // gripper_version G2: same macro as G1, mesh name suffix _g2, .dae (xarm_gripper.urdf.xacro l.9-13)
async function loadVendor(dir){
  const vm=JSON.parse(await readFile(join(dir,'vendor-manifest.json'),'utf8')),docs=new Map();
  for(const s of vm.sources){
    if(!s.license||!/^[0-9a-f]{40}$/.test(s.commit??''))throw new Error(`VENDOR_UNPINNED: ${s.path}`);
    const bytes=await readFile(join(DOCS,s.sha256));
    if(sha(bytes)!==s.sha256)throw new Error(`VENDOR_HASH_MISMATCH: ${s.path}`);
    docs.set(s.path,{...s,bytes});
  }
  const doc=(path)=>{const d=docs.get(path);if(!d)throw new Error(`VENDOR_FILE_MISSING: ${path}`);return d;};
  return {vm,doc};
}
function describe(doc){
  const armX=doc('xarm_description/urdf/xarm6/xarm6.urdf.xacro'),kinY=doc('xarm_description/config/kinematics/default/xarm6_default_kinematics.yaml');
  const inY=doc('xarm_description/config/link_inertial/xarm6_type6_HT_BR2.yaml'),limY=doc('xarm_description/config/xarm6/joint_limits_1305.yaml');
  const grX=doc('xarm_description/urdf/gripper/xarm_gripper.urdf.xacro'),devX=doc('xarm_description/urdf/xarm_device_macro.xacro');
  const src=(d,locator)=>({kind:'manufacturer',documentId:d.documentId,revision:d.commit,locator,contentSha256:d.sha256});
  const scalar=(value,unit,d,locator)=>({value,unit,source:src(d,locator)});
  const name=(s)=>s.replace(/^\$\{prefix\}/,'');
  const macro=one(parseXml(armX.bytes.toString('utf8')),(e)=>e.name==='xacro:macro'&&e.attrs.name==='xarm6_urdf','xarm6_urdf macro');
  if(!all(macro,(e)=>e.name==='xacro:if'&&/model_num >= 1305/.test(e.attrs.value)).some((e)=>e.children.some((c)=>c.name==='xacro:property'&&c.attrs.name==='visual_dir'&&c.attrs.value==='xarm6_1305/visual')))throw new Error('VENDOR_FORMAT: xarm6_1305 visual branch');
  const params=Object.fromEntries(macro.attrs.params.trim().split(/\s+/).map((t)=>t.split(':=')));
  const kin=parseYamlMap(kinY.bytes.toString('utf8')).kinematics,inertial=parseYamlMap(inY.bytes.toString('utf8')),lims=parseYamlMap(limY.bytes.toString('utf8')).joint_limits;
  const I6=(o)=>[o.ixx,o.ixy,o.ixz,o.iyy,o.iyz,o.izz];
  const urdfInertial=(el,d,id)=>{const i=child(el,'inertial'),o=child(i,'origin');if(nums(o.attrs.rpy,3).some((v)=>v!==0))throw new Error(`VENDOR_FORMAT: rotated inertial ${id}`);const t=child(i,'inertia').attrs;
    return {massKg:scalar(Number(child(i,'mass').attrs.value),'kg',d,`${id} inertial/mass`),comM:nums(o.attrs.xyz,3),inertiaKgM2:I6(Object.fromEntries(Object.entries(t).map(([k,v])=>[k,Number(v)]))),inertialSource:src(d,`${id} inertial`)};};
  const armLinks=[],armJoints=[],meshes=[],dyn=[];
  const xlink=(id)=>one(macro,(e)=>e.name==='link'&&name(e.attrs.name??'')===id,id);
  const visualPath=(el)=>{const f=one(el,(e)=>e.name==='xacro:common_link_visual','visual').attrs.mesh_filename.replace('${visual_dir}','xarm6_1305/visual').replace('${link6_visual}','xarm6_1305/visual/link6');
    if(f.includes('$'))throw new Error(`XACRO_EXPRESSION_UNSUPPORTED: ${f}`);return `xarm_description/meshes/${f}.stl`;};
  ['link_base','link1','link2','link3','link4','link5','link6'].forEach((v,i)=>{
    const el=xlink(v),id=i===0?'base':v,path=visualPath(el);if(!path.startsWith(ARM_DIR))throw new Error(`VENDOR_FORMAT: ${path}`);
    meshes.push({link:id,path,kind:'stl'});
    const inn=i===0?urdfInertial(el,armX,v):(()=>{const y=inertial[v];return {massKg:scalar(y.mass,'kg',inY,`${v}.mass`),comM:[y.origin.x,y.origin.y,y.origin.z],inertiaKgM2:I6(y.inertia),inertialSource:src(inY,`${v} (origin, mass, inertia)`)};})();
    armLinks.push({id,path,...inn});
  });
  for(let i=1;i<=6;i++){
    const el=one(macro,(e)=>e.name==='joint'&&name(e.attrs.name??'')===`joint${i}`,`joint${i}`),k=kin[`joint${i}`],lim=child(el,'limit').attrs,d=child(el,'dynamics').attrs;
    if(name(child(el,'parent').attrs.link)!==(i===1?'link_base':`link${i-1}`)||name(child(el,'child').attrs.link)!==`link${i}`)throw new Error(`VENDOR_FORMAT: joint${i} links`);
    if(lim.effort!==`\${joint_limits['joint${i}']['max_effort']}`||lim.lower!==`\${joint${i}_lower_limit}`||lim.upper!==`\${joint${i}_upper_limit}`)throw new Error(`VENDOR_FORMAT: joint${i} limit`);
    dyn.push([Number(d.damping),Number(d.friction)]);
    armJoints.push({id:`J${i}`,kind:'revolute',parent:i===1?'base':`link${i-1}`,child:`link${i}`,
      origin:{xyzM:[k.x,k.y,k.z],quaternionXyzw:rpyToQuat([k.roll,k.pitch,k.yaw])},axis:nums(child(el,'axis').attrs.xyz,3),
      limits:{lower:scalar(xacroNumber(params[`joint${i}_lower_limit`]),'rad',armX,`xarm6_urdf joint${i}_lower_limit`),upper:scalar(xacroNumber(params[`joint${i}_upper_limit`]),'rad',armX,`xarm6_urdf joint${i}_upper_limit`),
        velocity:scalar(Number(lim.velocity),'rad/s',armX,`joint${i} limit velocity`),effort:scalar(lims[`joint${i}`].max_effort,'N*m',limY,`joint${i}.max_effort`)}});
  }
  if(dyn.some(([a,b])=>a!==dyn[0][0]||b!==dyn[0][1]))throw new Error('VENDOR_FORMAT: joint dynamics differ');
  // the gripper hangs on link_eef, which is link6 with an identity origin (xarm_device_macro.xacro joint_eef)
  const eef=one(parseXml(devX.bytes.toString('utf8')),(e)=>e.name==='joint'&&e.attrs.name==='${prefix}joint_eef','joint_eef'),eo=child(eef,'origin').attrs;
  if(nums(eo.xyz,3).concat(nums(eo.rpy,3)).some((v)=>v!==0))throw new Error('VENDOR_FORMAT: joint_eef is not the identity');
  const gm=one(parseXml(grX.bytes.toString('utf8')),(e)=>e.name==='xacro:macro'&&e.attrs.name==='xarm_gripper_urdf','xarm_gripper_urdf macro');
  const gLinks=[],gJoints=[{id:'gripper_fix',kind:'fixed',parent:'link6',child:'xarm_gripper_base_link',origin:{xyzM:[0,0,0],quaternionXyzw:[0,0,0,1]},axis:[0,0,1]}],mimic=[];let tcp=null;
  for(const el of gm.children.filter((c)=>c.name==='link')){
    const id=name(el.attrs.name);if(id==='link_tcp')continue;
    const f=one(el,(e)=>e.name==='xacro:common_link_visual','visual').attrs.mesh_filename.replace('${name_suffix}',GRIPPER_SUFFIX);
    if(f.includes('$'))throw new Error(`XACRO_EXPRESSION_UNSUPPORTED: ${f}`);
    const path=`xarm_description/meshes/${f}.dae`;meshes.push({link:id,path,kind:'dae'});gLinks.push({id,path,...urdfInertial(el,grX,id)});
  }
  for(const el of gm.children.filter((c)=>c.name==='joint')){
    const id=name(el.attrs.name),o=child(el,'origin').attrs,origin={xyzM:nums(o.xyz,3),quaternionXyzw:rpyToQuat(nums(o.rpy,3))};
    if(id==='joint_tcp'){tcp=origin;continue;}
    const lim=child(el,'limit').attrs,mm=el.children.find((c)=>c.name==='mimic');
    gJoints.push({id,kind:el.attrs.type,parent:name(child(el,'parent').attrs.link),child:name(child(el,'child').attrs.link),origin,axis:nums(child(el,'axis').attrs.xyz,3),
      limits:{lower:scalar(Number(lim.lower),'rad',grX,`${id} limit lower`),upper:scalar(Number(lim.upper),'rad',grX,`${id} limit upper`),velocity:scalar(Number(lim.velocity),'rad/s',grX,`${id} limit velocity`),effort:scalar(Number(lim.effort),'N*m',grX,`${id} limit effort`)}});
    if(mm){if(Number(mm.attrs.offset??0)!==0)throw new Error(`VENDOR_FORMAT: mimic offset ${id}`);mimic.push({joint:id,mimics:name(mm.attrs.joint),multiplier:Number(mm.attrs.multiplier)});}
  }
  const toolM=XARM6_SI.toolM;
  if(!tcp||tcp.quaternionXyzw.some((v,i)=>v!==[0,0,0,1][i])||tcp.xyzM.some((v,i)=>Math.abs(v-toolM[i])>1e-12))throw new Error('TOOL_MISMATCH: joint_tcp differs from XARM6_REFERENCE.toolTranslation');
  return {armLinks,armJoints,gLinks,gJoints,meshes,mimic,dynamics:{damping:dyn[0][0],friction:dyn[0][1],doc:armX}};
}

// ---- spike M00 assumptions (docs/research/2026-11-mujoco-arm-spike.md, "Tham số chọn" and scene.py DEFAULTS), verbatim ----
const M00={
  stand:{center:[0.49,0],half:[0.05,0.05],top:0.10},tray:{center:[0.35,0.35],half:[0.10,0.10],top:0.06},
  cup:{radiusM:0.04,heightM:0.1,emptyMassKg:0.02,drinkMassKg:0.30},graspDepthM:0.022,approachM:0.12,liftM:0.15,placeClearM:0.002,
  home:{position:[0.38,0,0.40],approach:[1,0]},homeSeed:[0.000003,-1.147796,-0.32446,-3.141599,0.09854,0.00001],
  kp:[6000,6000,5000,2000,2000,500],kv:[150,150,100,40,30,14],armature:[0.1,0.1,0.1,0.1,0.1,0.1],
  gripper:{kp:20,kv:0.5,forceRangeNm:1.2,forceN:13.15,armatureKgM2:0.002,closedRad:0.85,commandRateRadPerTick:0.04,mimicSolref:[0.004,1],openingMaxM:0.0889},
  padHalf:[0.012,0.002,0.020],padCenter:[0,0.024,0.040],palm:{centerM:[0,0,0.047],half:[0.0375,0.051,0.056]},
  contact:{solref:[0.01,1],solimp:[0.9,0.95,0.005],impratio:10,condim:4,padFriction:[1.0,0.02,0.0001],propFriction:[0.6,0.005,0.0001]},
  capsuleRadiusM:[0.049,0.0485,0.045,0.045,0.039,0.039],
  capsuleSegmentsM:[[[0,0,-0.07],[0,0,0]],[[0,0,0],[0.0535,-0.2845,0]],[[0,0,0],[0.0775,0.12,0]],[[0,0,-0.16],[0,0,0]],[[0,0,0],[0.076,0.06,0]],[[0,0,-0.02],[0,0,0]]],
  maxAccelerationRadS2:[6,6,6,8,8,8],speedFraction:0.5,
};
export const IK_RNG_SEED=20261112,FK_GOLDEN_SEED=20261112;
const add=(a,b,s=1)=>a.map((v,i)=>v+s*b[i]);

export function cellLayout(){
  const {stand,tray,cup}=M00,ag=[...stand.center.map((v)=>v/Math.hypot(...stand.center)),0],ap=[...tray.center.map((v)=>v/Math.hypot(...tray.center)),0];
  return {schemaVersion:1,provenance:'assumed',frame:'arm_base',
    nozzleStand:{centerM:[...stand.center,stand.top/2],sizeM:[...stand.half.map((h)=>2*h),stand.top]},tray:{centerM:[...tray.center,tray.top/2],sizeM:[...tray.half.map((h)=>2*h),tray.top]},
    cup:{componentId:'cup-ref',...cup},
    grasp:{pick:{position:add([...stand.center,stand.top+cup.heightM/2],ag,M00.graspDepthM),quaternionXyzw:sideGrasp(ag)},
      place:{position:add([...tray.center,tray.top+cup.heightM/2+M00.placeClearM],ap,M00.graspDepthM),quaternionXyzw:sideGrasp(ap)},approachM:M00.approachM,liftM:M00.liftM}};
}
/** The six task poses, solved in order with each seed chained from the previous answer (home from the spike's home joints). */
export function solveWaypoints(layout){
  const {pick,place,approachM,liftM}=layout.grasp,ag=qrotate(pick.quaternionXyzw,[0,0,1]);
  const targets=[['home',{position:M00.home.position,quaternionXyzw:sideGrasp(M00.home.approach)}],['pickApproach',{position:add(pick.position,ag,-approachM),quaternionXyzw:pick.quaternionXyzw}],['pick',pick],
    ['lift',{position:add(pick.position,[0,0,liftM]),quaternionXyzw:pick.quaternionXyzw}],['placeApproach',{position:add(place.position,[0,0,approachM]),quaternionXyzw:place.quaternionXyzw}],['place',place]];
  let seed=M00.homeSeed;const table=[];
  for(const [waypoint,t] of targets){
    const r=solvePose(XARM6_SI,t,{q:seed,rngSeed:IK_RNG_SEED});
    if(!r.ok)throw new Error(`ARM_POSE_UNREACHABLE:${waypoint} (${r.reason})`);
    const q=round(r.q),f=forwardKinematics(XARM6_SI,q).tcp;
    let dq=qmul(t.quaternionXyzw,qconj(f.quaternionXyzw));if(dq[3]<0)dq=dq.map((v)=>-v);
    const row={waypoint,q,positionErrorM:Math.hypot(...add(t.position,f.position,-1)),orientationErrorRad:2*Math.atan2(Math.hypot(dq[0],dq[1],dq[2]),dq[3]),condition:jacobianCondition(XARM6_SI,q).condition};
    if(!(row.positionErrorM<=1e-3&&row.orientationErrorRad<=0.0087&&row.condition<=MAX_CONDITION)||q.some((v,i)=>v<XARM6_SI.limits[i].min||v>XARM6_SI.limits[i].max))throw new Error(`ARM_POSE_UNREACHABLE:${waypoint}`);
    table.push(round(row));seed=q;
  }
  return table;
}
const mulberry32=(seed)=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};

const BASE_PROJECT={schemaVersion:2,name:'Coffee cell',revision:1,updatedAt:'2026-11-05T00:00:00.000Z',
  entities:[{id:'amr-1',kind:'amr',assetRef:{id:'service-robot-asset',revision:1,contentHash:'bf15015afcc0e719c79ff76eff955ba9c83f72c82968156fa25743f7d8e15c79'}},
    {id:'arm-1',kind:'arm',assetRef:{id:'arm-puma-reference',revision:1,contentHash:'f12c8e962d74dcab35734e0e14f00e0a1168e6906b377fa530b27a4e4b2f79ef'}},
    {id:'coffee-1',kind:'coffee_machine',assetRef:{id:'coffee-machine-illustrative',revision:1,contentHash:'18771958e98006dd7cb6bd9352611ce0bbd37aaacaaa159f67ef70124d7d9faa'}},
    {id:'cups-1',kind:'cup_station',assetRef:{id:'cup-paper-illustrative',revision:1,contentHash:'a58680ada2a4f5befb241b9abd6f3ee38a4dc60639038e07cd69b0e1fbd3633e'}}],
  world:{id:'coffee-cell-world',revision:1,width:6,height:4,
    points:[{id:'parking',name:'Parking',kind:'parking',x:0.8,y:0.8},{id:'coffee-pickup',name:'Coffee pickup',kind:'coffee_pickup',x:3,y:1},{id:'table-1',name:'T01',kind:'table',x:5,y:3}],
    handoffPoints:[{id:'coffee-pickup',name:'Coffee pickup',kind:'coffee_pickup',position:[3,1,0],yawRad:1.5707963267948966}],
    obstacles:[{id:'counter',x:2,y:1.5,width:2,height:0.6}]}}; // lab/fixtures/twins/coffee-cell-v2.json project (Lab 98ef987), copied
/** The Lab coffee cell with the xArm placed so the layout's tray lands on coffee_pickup. The base sits 0.7 m above the floor; the AMR body (robotHeightM, extruded) is 0.6 m, below the
 * arm base plane, and the AMR's tray (the layout's `tray` support, top 0.76 m in the map) stands on a riser above the body. Illustrative, not calibrated. */
function coffeeProject(layout){
  const pickup=BASE_PROJECT.world.points.find((p)=>p.kind==='coffee_pickup'),baseHeightM=0.7,robotHeightM=0.6;
  return {...structuredClone(BASE_PROJECT),id:'coffee-cell-xarm6',name:'Coffee cell (xArm 6)',
    armCollisionProfile:{schemaVersion:1,id:'coffee-arm-scene-xarm6',revision:1,units:'SI',provenance:'illustrative',
      reference:'Illustrative xArm 6 base placement: the xarm6-g2-v1 cell-layout tray lands on coffee_pickup; the arm base is 0.7 m above the floor; the AMR body is extruded to 0.6 m, below the arm base plane, and its tray (the cell-layout tray, top 0.76 m) stands on a riser above the body; extruded fixture/AMR heights; not calibrated or physical safety evidence',
      modelId:XARM6_SI.id,modelRevision:XARM6_SI.revision,baseInMap:{position:[pickup.x-layout.tray.centerM[0],pickup.y-layout.tray.centerM[1],baseHeightM],quaternionXyzw:[0,0,0,1]},fixtureHeightM:1,robotHeightM}};
}

function physics(d){
  const g=M00.gripper,pad=(link,s)=>({link,centerM:[M00.padCenter[0],s*M00.padCenter[1],M00.padCenter[2]],sizeM:M00.padHalf.map((h)=>2*h)});
  return {schemaVersion:1,provenance:'assumed',substitute:false,not_calibrated:true,
    note:'Spike M00 values (docs/research/2026-11-mujoco-arm-spike.md), copied verbatim: gains, armature, gripper drive, pads, palm, contact and motion limits are assumed; jointDynamics (damping 1, frictionloss 1) is cited from the vendor xacro <dynamics>, which are Gazebo simulation settings, so it is assumed too, not a measured joint property; gripper.forceN and openingMaxM are spike measurements of this model, not product data.',
    actuators:M00.kp.map((kp,i)=>({joint:`J${i+1}`,kp,kv:M00.kv[i]})),armatureKgM2:M00.armature,
    jointDynamics:{damping:d.dynamics.damping,frictionloss:d.dynamics.friction,source:{kind:'assumed',documentId:d.dynamics.doc.documentId,revision:d.dynamics.doc.commit,locator:'joint1..6 <dynamics damping friction> (Gazebo values)',contentSha256:d.dynamics.doc.sha256}},
    gripper:{driveJoint:'drive_joint',mimic:d.mimic.map(({joint,multiplier,mimics})=>{if(mimics!=='drive_joint')throw new Error(`VENDOR_FORMAT: ${joint} mimics ${mimics}`);return {joint,multiplier};}),
      openingMaxM:g.openingMaxM,forceN:g.forceN,kp:g.kp,kv:g.kv,forceRangeNm:g.forceRangeNm,armatureKgM2:g.armatureKgM2,closedRad:g.closedRad,commandRateRadPerTick:g.commandRateRadPerTick,mimicSolref:g.mimicSolref},
    pads:[pad('left_finger',-1),pad('right_finger',1)],palm:{link:'xarm_gripper_base_link',centerM:M00.palm.centerM,sizeM:M00.palm.half.map((h)=>2*h)},
    contact:M00.contact,capsuleRadiusM:M00.capsuleRadiusM,capsuleSegmentsM:M00.capsuleSegmentsM,maxAccelerationRadS2:M00.maxAccelerationRadS2,speedFraction:M00.speedFraction};
}

const README=(m)=>`# xarm6-g2-v1

UFACTORY xArm 6 (bản 1305) với Gripper G2, dưới dạng một \`engineering-component\` cho plant MuJoCo của R2a (D38). Sinh bởi \`scripts/generate-xarm6-fixture.mjs\` từ file của hãng đã ghim; không sửa tay.

**Khối lượng và quán tính là số danh định của hãng; ma sát, hệ số điều khiển và má kẹp là giả định; chưa hiệu chuẩn.**

Cản và ma sát khớp (\`jointDynamics\`) là thiết lập mô phỏng Gazebo trong file của hãng, được lấy làm giả định (\`source.kind\` \`assumed\`, vẫn trích xacro của hãng), không phải đặc tính đo được của khớp.

## Nguồn từng nhóm số

| Nhóm | File | Nguồn |
|---|---|---|
| Gốc khớp J1..J6 (xyz, roll) | \`component.json\` | \`xarm_description/config/kinematics/default/xarm6_default_kinematics.yaml\` (rpy đổi sang quaternion, quay cố định trục X, Y, Z) |
| Giới hạn khớp, \`velocity\` | \`component.json\` | \`xarm_description/urdf/xarm6/xarm6.urdf.xacro\` (tham số macro \`jointN_lower/upper_limit\`, \`velocity="3.14"\`) |
| \`effort\` J1..J6 | \`component.json\` | \`xarm_description/config/xarm6/joint_limits_1305.yaml\` |
| Khối lượng, trọng tâm, quán tính link1..6 | \`component.json\` | \`xarm_description/config/link_inertial/xarm6_type6_HT_BR2.yaml\` (mặc định của xacro); base: \`xarm6.urdf.xacro\` |
| Khớp, giới hạn, mimic, quán tính tay kẹp | \`component.json\`, \`physics.json\` (\`gripper.mimic\`) | \`xarm_description/urdf/gripper/xarm_gripper.urdf.xacro\` (G2 dùng chung macro với G1, chỉ đổi mesh \`_g2\`/\`.dae\`); gắn vào \`link6\` qua \`link_eef\` gốc đơn vị (\`xarm_device_macro.xacro\`) |
| Mesh tay máy | \`blobs/<sha256>.stl\` | \`xarm_description/meshes/xarm6_1305/visual/*.stl\`, chép nguyên byte |
| Mesh tay kẹp | \`blobs/<sha256>.stl\` | \`xarm_description/meshes/gripper/xarm/*_g2.dae\`, đổi sang STL nhị phân (xem dưới) |
| Bảng modified D-H \`XARM6_REFERENCE\` | \`packages/lab-runtime/src/v2/models/arm-kinematics.ts\` | trang D-H xArm 6 của hãng (spike M00); \`toolTranslation\` = \`joint_tcp\` z 172 mm |
| \`jointDynamics\` (damping 1, frictionloss 1) | \`physics.json\` | \`<dynamics>\` trong xacro của hãng: giá trị mô phỏng Gazebo, ghi \`assumed\` |
| \`kp\`, \`kv\`, \`armatureKgM2\`, tay kẹp (\`kp\`, \`kv\`, \`forceRangeNm\`, \`armatureKgM2\`, \`closedRad\`, \`commandRateRadPerTick\`, \`mimicSolref\`), má kẹp, lòng bàn tay, \`contact\`, \`capsuleRadiusM\`, \`maxAccelerationRadS2\`, \`speedFraction\` | \`physics.json\` | giả định của spike M00 (\`docs/research/2026-11-mujoco-arm-spike.md\`, bảng "Tham số chọn"), chép nguyên; \`solimp\` ghi 3 số đầu, hai số cuối (0.5, 2) là mặc định của MuJoCo |
| \`gripper.forceN\` (13,15 N mỗi má), \`gripper.openingMaxM\` (88,9 mm) | \`physics.json\` | số đo của spike trên mô hình này, không phải số của sản phẩm |
| Bệ vòi, khay, cốc, pose gắp/đặt, \`approachM\`, \`liftM\` | \`cell-layout.json\` | giả định của spike M00 (bảng bố cục trạm); pose là pose TCP trong khung base, gắp ngang theo hướng bán kính, TCP vượt trục cốc \`graspDepthM\` 0,022 m, đáy cốc khi đặt cao hơn khay 2 mm |
| Waypoint | \`programs.json\` | \`solvePose(XARM6_SI)\` (seed nối tiếp từ \`home\` của spike, \`rngSeed\` ${IK_RNG_SEED}); \`home\` là TCP (0,38, 0, 0,40) hướng như gắp; \`pickApproach\` = \`pick\` lùi \`approachM\` dọc trục tiếp cận, \`lift\` = \`pick\` + \`liftM\` theo z, \`placeApproach\` = \`place\` + \`approachM\` theo z |
| Trạm cà phê | \`coffee-cell-project.json\` | project \`coffee-cell-v2\` của Lab; \`baseInMap\` đặt khay của \`cell-layout\` lên điểm \`coffee_pickup\`, đế tay máy cao 0,7 m; thân AMR (\`robotHeightM\`, đùn lên) cao 0,6 m, thấp hơn mặt phẳng đế tay máy, khay của AMR (khay của \`cell-layout\`, mặt trên 0,76 m) đặt trên giá nâng phía trên thân; minh họa, chưa hiệu chuẩn |

## Mesh

- Tay máy: 7 STL nhị phân của hãng, tên blob là sha256 của file hãng.
- Tay kẹp: G2 trong \`xarm_ros2\` chỉ có DAE. Bộ sinh đọc DAE như dữ liệu XML: hình học thứ nhất, phần \`<triangles>\` duy nhất, chuỗi ma trận node của visual scene thứ nhất, đơn vị m; ghi STL nhị phân pháp tuyến 0, float32 little-endian, header 80 byte cố định. Tam giác có đỉnh xa gốc link hơn ${STRAY_RADIUS_M} m bị loại: chỉ \`base_link_g2\` có (300 tam giác lạc của spike M00). \`manifest.json\` ghi mỗi blob đã đổi cùng sha256 của DAE nguồn và số tam giác giữ/bỏ.
- Va chạm trong \`component.json\` chỉ có ở base và link1..link6 (cùng mesh hiển thị; MuJoCo lấy bao lồi). Va chạm tay kẹp là má kẹp và lòng bàn tay hộp giả định trong \`physics.json\`; khâu và ngón không có hình va chạm. Mesh va chạm \`collision/*.obj\` của hãng không dùng.

## License

Mọi file của hãng: \`xArm-Developer/xarm_ros2\` commit \`${m.commit}\`, ${m.license} (\`NOTICE\`). Danh sách file, URL và sha256: \`vendor-manifest.json\`; bản sao nằm ở \`robotics/catalog/documents/<sha256>\` (nhập bằng \`scripts/import-engineering-vendor.mjs\`).

## Sinh lại

\`\`\`sh
node scripts/import-engineering-vendor.mjs ${FIXTURE_DIR}/vendor-manifest.json   # chỉ khi thiếu file trong robotics/catalog/documents
pnpm exec tsx scripts/generate-xarm6-fixture.mjs
\`\`\`

Đầu ra tất định: số làm tròn 12 chữ số, khóa JSON sắp xếp. \`tests/unit/xarm6-fixture.test.ts\` sinh lại vào thư mục tạm và so từng byte; \`tests/integration/xarm6-rtb.test.ts\` so bảng D-H với Robotics Toolbox.
`;

export async function generateXarm6Fixture(dir,{inputDir=join(ROOT,FIXTURE_DIR)}={}){
  const {vm,doc}=await loadVendor(inputDir),d=describe(doc),repo=vm.repositories[0];
  const blobs=new Map(),blobRows=[];
  for(const m of d.meshes){
    const s=doc(m.path);let bytes,row;
    if(m.kind==='stl'){bytes=s.bytes;row={conversion:'copy',triangles:stlTriangles(bytes),droppedTriangles:0};}
    else{const c=dae2stl(s.bytes.toString('utf8'));bytes=c.bytes;row={conversion:'dae2stl',triangles:c.triangles,droppedTriangles:c.droppedTriangles};}
    const h=sha(bytes);blobs.set(h,bytes);blobRows.push({link:m.link,sha256:h,sourceSha256:s.sha256,sourceDocumentId:s.documentId,bytes:bytes.length,...row});
  }
  const blobOf=(link)=>blobRows.find((b)=>b.link===link);
  const shape=(l)=>{const b=blobOf(l.id);return {pose:{xyzM:[0,0,0],quaternionXyzw:[0,0,0,1]},geometry:{kind:'mesh',blobSha256:b.sha256,scale:[1,1,1]},source:{kind:'manufacturer',documentId:b.sourceDocumentId,revision:repo.commit,locator:l.path.slice(-200),contentSha256:b.sourceSha256}};};
  const link=(l,collide)=>({id:l.id,visual:[shape(l)],collision:collide?[shape(l)]:[],massKg:l.massKg,comM:l.comM,inertiaKgM2:l.inertiaKgM2,inertialSource:l.inertialSource});
  const used=new Set([...d.meshes.map((m)=>m.path),...[...JSON.stringify([d.armLinks,d.armJoints,d.gLinks,d.gJoints]).matchAll(/"documentId":"([^"]+)"/g)].map((x)=>x[1].replace(/^xarm_ros2:/,''))]);
  const component=round({schemaVersion:1,id:'xarm6-g2-v1',revision:'1',identity:{manufacturer:'UFACTORY',family:'xArm 6 (1305) + Gripper G2',sku:null,status:'candidate'},
    links:[...d.armLinks.map((l)=>link(l,true)),...d.gLinks.map((l)=>link(l,false))],joints:[...d.armJoints,...d.gJoints],ports:[],models:[],
    documents:vm.sources.filter((s)=>used.has(s.path)).map((s)=>({id:s.documentId,url:s.url,digest:s.sha256,license:s.license}))});
  const layout=round(cellLayout()),table=solveWaypoints(layout);
  const programs={programs:{modelId:XARM6_SI.id,waypoints:Object.fromEntries(table.map((r)=>[r.waypoint,r.q])),
    choreography:{'cup-pick':[{waypoint:'pickApproach'},{waypoint:'pick',action:'grip'},{waypoint:'lift'}],'cup-place':[{waypoint:'placeApproach'},{waypoint:'place',action:'release'},{waypoint:'home'}]},
    motion:{profile:'quintic-sync-v1',maxAccelerationRadS2:M00.maxAccelerationRadS2,speedFraction:M00.speedFraction}},table,digest:hashJson(table)};
  const rnd=mulberry32(FK_GOLDEN_SEED),poses=Array.from({length:20},()=>XARM6_SI.limits.map((l)=>{const lo=Math.max(l.min,-Math.PI),hi=Math.min(l.max,Math.PI);return r12(lo+(hi-lo)*rnd());}));
  const fkGolden={schemaVersion:1,seed:FK_GOLDEN_SEED,note:'flangeChainM: chainFlange(component.json, q) from the vendor joint origins; flangeDhM: forwardKinematics(XARM6_SI, q).flange from the manufacturer modified D-H table (m, arm base frame). They differ by about 2 um because the vendor files write pi/2 as 1.5708.',
    poses:poses.map((q)=>({q,flangeChainM:chainFlange(component,q),flangeDhM:forwardKinematics(XARM6_SI,q).flange.position}))};
  const notice=`xarm6-g2-v1 contains files derived from the following repository. Each copy is listed with its sha256 in vendor-manifest.json and manifest.json.\n\n`+
    vm.repositories.map((r)=>`${r.id} (${r.url}) at commit ${r.commit}, ${r.license}\n${r.copyright}\n\n${doc(r.licenseFile).bytes.toString('utf8').trim()}\n`).join('\n');
  const out={'component.json':text(component),'physics.json':text(physics(d)),'cell-layout.json':text(layout),'programs.json':text(programs),'fk-golden.json':text(fkGolden),
    'coffee-cell-project.json':text(coffeeProject(layout)),NOTICE:notice,'README.md':README(repo),'vendor-manifest.json':await readFile(join(inputDir,'vendor-manifest.json'),'utf8')};
  const manifest={schemaVersion:1,documentType:'mujoco-arm-fixture-manifest',id:'xarm6-g2-v1',generator:'scripts/generate-xarm6-fixture.mjs',componentDigest:hashJson(component),modelRevision:XARM6_SI.revision,
    vendor:{repository:repo.url,commit:repo.commit,license:repo.license},not_calibrated:true,
    note:'UFACTORY xArm 6 (1305) + Gripper G2 from xarm_ros2 at a pinned commit. Masses, inertia, joint origins, limits and meshes are manufacturer nominal; layout, gains, friction, contact and pads are spike M00 assumptions. Not calibrated.',
    files:Object.keys(out).sort().map((path)=>({path,sha256:sha(out[path]),bytes:Buffer.byteLength(out[path])})),
    blobs:[...blobRows].sort((a,b)=>a.link<b.link?-1:1)};
  await mkdir(join(dir,'blobs'),{recursive:true});
  for(const [name,body] of Object.entries(out))if(name!=='vendor-manifest.json')await writeFile(join(dir,name),body);
  await writeFile(join(dir,'manifest.json'),text(manifest));
  for(const [h,bytes] of blobs)await writeFile(join(dir,'blobs',`${h}.stl`),bytes);
  return {component,manifest,table};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const i=process.argv.indexOf('--out'),dir=i>0?process.argv[i+1]:join(ROOT,FIXTURE_DIR);
  const {manifest,table}=await generateXarm6Fixture(dir);
  console.log(JSON.stringify({dir,componentDigest:manifest.componentDigest,blobs:manifest.blobs.map((b)=>[b.link,b.sha256,b.triangles,b.droppedTriangles]),table},null,1));
}
