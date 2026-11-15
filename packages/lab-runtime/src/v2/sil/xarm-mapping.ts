// Independent raw readback checker. Static kinematic parity is not host/controller/contact qualification.
import {createHash} from 'node:crypto';
import target from '../../../../../robotics/manipulation/profiles/xarm6-native-mapping.json';
import extensions from '../../../../../robotics/manipulation/profiles/xarm6-sim-extensions.json';
import profile from '../../../../../robotics/manipulation/profiles/xarm6-jazzy-sim.json';
interface Node {name:string;attrs:Record<string,string>;children:Node[];text:string}
/** Strict, bounded XML subset: no DTD, entity expansion, namespaces, duplicate attributes or unbalanced markup. */
function xmlTree(xml:string):Node{
 if(xml.length>4_000_000||/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml))throw Error('XARM_XML_INVALID');
 const clean=xml.replace(/<\?xml[^?]*\?>/g,'').replace(/<!--[\s\S]*?-->/g,'');const root:Node={name:'document',attrs:{},children:[],text:''},stack=[root];
 const tokens=clean.match(/<[^>]*>|[^<]+/g)??[];if(tokens.join('')!==clean)throw Error('XARM_XML_INVALID');
 for(const token of tokens){const parent=stack.at(-1)!;if(!token.startsWith('<')){parent.text+=token;continue;}
  if(token.startsWith('</')){if(stack.length<2||token!==`</${parent.name}>`)throw Error('XARM_XML_INVALID');stack.pop();continue;}
  const m=/^<([A-Za-z_][\w.-]*)([\s\S]*?)(\/?)>$/.exec(token);if(!m||stack.length>100)throw Error('XARM_XML_INVALID');
  const attrs:Record<string,string>={};let rest=m[2]!.trim();while(rest){const a=/^([A-Za-z_][\w.-]*)\s*=\s*(["'])(.*?)\2\s*/.exec(rest);if(!a||Object.hasOwn(attrs,a[1]!)||/[<&]/.test(a[3]!))throw Error('XARM_XML_INVALID');attrs[a[1]!]=a[3]!;rest=rest.slice(a[0].length);}
  const node={name:m[1]!,attrs,children:[],text:''};parent.children.push(node);if(!m[3])stack.push(node);
 }
 if(stack.length!==1||root.children.length!==1||root.children[0]!.name!=='robot'||root.text.trim())throw Error('XARM_XML_INVALID');return root.children[0]!;
}
const one=(n:Node,name:string)=>{const xs=n.children.filter(x=>x.name===name);if(xs.length!==1)throw Error('XARM_MAPPING_INVALID:'+name);return xs[0]!;};
function numbers(s:string|undefined,n:number){const tokens=s?.trim().split(/\s+/);if(!tokens||tokens.length!==n||tokens.some(t=>!/^[-+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?$/.test(t)))throw Error('XARM_MAPPING_NUMERIC');const v=tokens.map(Number);if(!v.every(Number.isFinite))throw Error('XARM_MAPPING_NUMERIC');return v;}
function near(a:number[],b:number[]){if(a.length!==b.length||a.some((v,i)=>Math.abs(v-b[i]!)>1e-9))throw Error('XARM_MAPPING_MISMATCH');}
// Compare closed extension trees independent of ordering and numeric lexical spelling.
function semantic(n:Node):string{
 const attrs=Object.entries(n.attrs).sort(([a],[b])=>a.localeCompare(b));let text=n.text.trim();
 if(['param','mechanicalReduction','multiplier','offset','sensitiveness','maxEffort'].includes(n.name)){
  const v=numbers(text,1)[0]!;text=String(Math.round(v*1e9)/1e9);
 }
 return JSON.stringify([n.name,attrs,text,n.children.map(semantic).sort()]);
}
function checkExtensions(robot:Node,mode:'X1'|'X2'){
 const expected=xmlTree(extensions.xml.replaceAll('{hardwarePlugin}',profile.modes[mode].plugin));
 const actual=robot.children.filter(n=>['ros2_control','transmission','gazebo'].includes(n.name));
 if(mode==='X2'){
  const control=actual.filter(n=>n.name==='gazebo'&&n.children.some(c=>c.name==='plugin'&&c.attrs.name==='gz_ros2_control::GazeboSimROS2ControlPlugin'));
  if(control.length!==1)throw Error('XARM_GAZEBO_CONTROL_INVALID');
  const parameter=one(one(control[0]!,'plugin'),'parameters');
  // Upstream generates this temporary YAML. Only its declaration is checked here; contents and installed behavior remain unresolved.
  if(!/^\/tmp\/launch_params_[A-Za-z0-9_]{1,80}$/.test(parameter.text.trim()))throw Error('XARM_CONTROL_PARAMETERS_INVALID');
  expected.children.push(xmlTree('<robot><gazebo><plugin filename="gz_ros2_control-system" name="gz_ros2_control::GazeboSimROS2ControlPlugin"><parameters>'+parameter.text.trim()+'</parameters></plugin></gazebo></robot>').children[0]!);
 }
 if(JSON.stringify(actual.map(semantic).sort())!==JSON.stringify(expected.children.map(semantic).sort()))throw Error('XARM_CONTROL_DECLARATION_MISMATCH');
 // Prevent shadow/nested declarations in otherwise unexamined material/collision data.
 const counts=(nodes:Node[]):string[]=>nodes.flatMap(n=>[...(['plugin','ros2_control','gazebo','transmission'].includes(n.name)?[n.name]:[]),...counts(n.children)]).sort();
 if(JSON.stringify(counts(robot.children))!==JSON.stringify(counts(actual)))throw Error('XARM_PLUGIN_PLACEMENT_INVALID');
}
export function validateXarmUrdf(xml:string,mode:'X1'|'X2'){
 if(!['X1','X2'].includes(mode))throw Error('XARM_MODE_INVALID');const robot=xmlTree(xml),joints=robot.children.filter(n=>n.name==='joint'),names=joints.map(j=>j.attrs.name),children=joints.map(j=>one(j,'child').attrs.link);
 if(new Set(names).size!==names.length||new Set(children).size!==children.length)throw Error('XARM_MAPPING_DUPLICATE');
 if(names.length!==target.joints.length||robot.children.some(n=>!['link','joint','material','ros2_control','transmission','gazebo'].includes(n.name)))throw Error('XARM_MODEL_GRAPH_INVALID');
 for(const expected of target.joints){const joint=joints.find(j=>j.attrs.name===expected.name);if(!joint||joint.attrs.type!==expected.type||one(joint,'parent').attrs.link!==expected.parent||one(joint,'child').attrs.link!==expected.child)throw Error('XARM_MAPPING_MISMATCH');
  const mimic=joint.children.filter(n=>n.name==='mimic');
  if('mimic' in expected&&expected.mimic){if(mimic.length!==1||mimic[0]!.attrs.joint!==expected.mimic.joint)throw Error('XARM_MIMIC_INVALID');near(numbers(mimic[0]!.attrs.multiplier??'1',1),[expected.mimic.multiplier]);near(numbers(mimic[0]!.attrs.offset??'0',1),[expected.mimic.offset]);if(Object.keys(mimic[0]!.attrs).some(k=>!['joint','multiplier','offset'].includes(k))||mimic[0]!.children.length)throw Error('XARM_MIMIC_INVALID');}else if(mimic.length)throw Error('XARM_MIMIC_INVALID');
  const origin=one(joint,'origin');near(numbers(origin.attrs.xyz,3),expected.xyz);near(numbers(origin.attrs.rpy,3),expected.rpy);
  if(expected.axis){near(numbers(one(joint,'axis').attrs.xyz,3),expected.axis);const limit=one(joint,'limit');for(const [key,value]of Object.entries(expected.limits!))near(numbers(limit.attrs[key],1),[value]);}
 }
 const links=robot.children.filter(n=>n.name==='link');if(new Set(links.map(l=>l.attrs.name)).size!==links.length)throw Error('XARM_MAPPING_DUPLICATE');
 const expectedLinks=new Set(target.joints.flatMap(j=>[j.parent,j.child]));
 if(links.length!==expectedLinks.size||links.some(l=>!expectedLinks.has(l.attrs.name!))||joints.some(j=>![one(j,'parent').attrs.link,one(j,'child').attrs.link].every(n=>links.some(l=>l.attrs.name===n))))throw Error('XARM_MODEL_GRAPH_INVALID');
 const visited=new Set<string>();const visit=(name:string)=>{if(visited.has(name))throw Error('XARM_MODEL_GRAPH_INVALID');visited.add(name);for(const j of joints.filter(j=>one(j,'parent').attrs.link===name))visit(one(j,'child').attrs.link!);};visit(target.nativeAttachment.root);if(visited.size!==links.length)throw Error('XARM_MODEL_GRAPH_INVALID');
 for(const l of links)if(!target.visualMeshes.some(v=>v.link===l.attrs.name)&&l.children.some(n=>n.name==='visual'))throw Error('XARM_VISUAL_INVALID');
 for(const expected of target.visualMeshes){const link=links.find(l=>l.attrs.name===expected.link)!;const visual=one(link,'visual'),geometry=one(visual,'geometry'),mesh=one(geometry,'mesh');
  if(geometry.children.length!==1||mesh.children.length||Object.keys(mesh.attrs).some(k=>!['filename','scale'].includes(k))||mesh.attrs.filename!==(mode==='X2'?expected.uri.replace('package://xarm_description','file://'+profile.descriptionShare):expected.uri))throw Error('XARM_G2_1305_MAPPING_MISMATCH');
  const origins=visual.children.filter(n=>n.name==='origin');if(origins.length>1)throw Error('XARM_VISUAL_INVALID');near(numbers(origins[0]?.attrs.xyz??'0 0 0',3),expected.xyz);near(numbers(origins[0]?.attrs.rpy??'0 0 0',3),expected.rpy);near(numbers(mesh.attrs.scale??'1 1 1',3),expected.scale);
 }
 for(const expected of target.nominalInertials){const link=links.find(l=>l.attrs.name===expected.link)!;const inertial=one(link,'inertial'),origin=one(inertial,'origin');near(numbers(origin.attrs.xyz,3),expected.comM);near(numbers(origin.attrs.rpy,3),[0,0,0]);near(numbers(one(inertial,'mass').attrs.value,1),[expected.massKg]);const tensor=one(inertial,'inertia');for(const [i,key]of ['ixx','ixy','ixz','iyy','iyz','izz'].entries())near(numbers(tensor.attrs[key],1),[expected.inertiaKgM2[i]!]);}
 checkExtensions(robot,mode);
 return {schemaVersion:1,mode,scope:target.scope,profileId:profile.id,urdfSha256:createHash('sha256').update(xml).digest('hex')};
}

export interface XarmMappingSubject {sourceCommit:string;profileId:string;architecture:string;modelSha256:string}
export function validateXarmMappingRecord(xml:string,record:Record<string,unknown>,subject:XarmMappingSubject){
 const mode=record.mode as 'X1'|'X2',mapping=validateXarmUrdf(xml,mode);
 const expected={...mapping,producer:'native_xarm.robot_description.v1',sourceCommit:subject.sourceCommit,subjectProfileId:subject.profileId,environmentProfile:'engineering-'+subject.architecture,sourceModelSha256:subject.modelSha256,vendorCommit:profile.vendorCommit,syntheticSimModelSelector:profile.syntheticSimModelSelector};
 if(Object.keys(record).some(k=>![...Object.keys(expected),'evidenceKind','controller'].includes(k)))throw Error('XARM_MAPPING_FIELD_INVALID');
 if(subject.modelSha256!==target.sourceModelSha256||Object.entries(expected).some(([k,v])=>record[k]!==v)||!['protocol_double',profile.modes[mode].evidenceKind].includes(String(record.evidenceKind)))throw Error('XARM_MAPPING_PROVENANCE_MISMATCH');
 if(record.evidenceKind!=='protocol_double'){
  const controller=record.controller as {joints?:unknown;commandInterfaces?:string[];stateInterfaces?:string[];srdf?:string}|undefined;
  if(!controller||JSON.stringify(controller.joints)!==JSON.stringify(profile.jointMap.map(j=>j.native))||!Array.isArray(controller.commandInterfaces)||!controller.commandInterfaces.includes('position')||!Array.isArray(controller.stateInterfaces)||!controller.stateInterfaces.includes('position')||typeof controller.srdf!=='string'||!controller.srdf.includes('<robot'))throw Error('XARM_CONTROLLER_READBACK_MISSING');
 }
}
