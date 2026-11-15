// Independent raw readback checker. Static kinematic parity is not host/controller/contact qualification.
import {createHash} from 'node:crypto';
import target from '../../../../../robotics/manipulation/profiles/xarm6-native-mapping.json';
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
function numbers(s:string|undefined,n:number){const v=s?.trim().split(/\s+/).map(Number);if(!v||v.length!==n||!v.every(Number.isFinite))throw Error('XARM_MAPPING_NUMERIC');return v;}
function near(a:number[],b:number[]){if(a.length!==b.length||a.some((v,i)=>Math.abs(v-b[i]!)>1e-9))throw Error('XARM_MAPPING_MISMATCH');}
export function validateXarmUrdf(xml:string,mode:'X1'|'X2'){
 if(!['X1','X2'].includes(mode))throw Error('XARM_MODE_INVALID');const robot=xmlTree(xml),joints=robot.children.filter(n=>n.name==='joint'),names=joints.map(j=>j.attrs.name),children=joints.map(j=>one(j,'child').attrs.link);
 if(new Set(names).size!==names.length||new Set(children).size!==children.length)throw Error('XARM_MAPPING_DUPLICATE');
 for(const expected of target.joints){const joint=joints.find(j=>j.attrs.name===expected.name);if(!joint||joint.attrs.type!==expected.type||one(joint,'parent').attrs.link!==expected.parent||one(joint,'child').attrs.link!==expected.child)throw Error('XARM_MAPPING_MISMATCH');
  const origin=one(joint,'origin');near(numbers(origin.attrs.xyz,3),expected.xyz);near(numbers(origin.attrs.rpy,3),expected.rpy);
  if(expected.axis){near(numbers(one(joint,'axis').attrs.xyz,3),expected.axis);const limit=one(joint,'limit');for(const [key,value]of Object.entries(expected.limits!))near(numbers(limit.attrs[key],1),[value]);}
 }
 const links=robot.children.filter(n=>n.name==='link');if(new Set(links.map(l=>l.attrs.name)).size!==links.length)throw Error('XARM_MAPPING_DUPLICATE');
 for(const expected of target.visualMeshes){const link=links.find(l=>l.attrs.name===expected.link);if(!link||one(one(one(link,'visual'),'geometry'),'mesh').attrs.filename!==(mode==='X2'?expected.uri.replace('package://xarm_description','file://'+profile.descriptionShare):expected.uri))throw Error('XARM_G2_1305_MAPPING_MISMATCH');}
 for(const expected of target.nominalInertials){const link=links.find(l=>l.attrs.name===expected.link)!;const inertial=one(link,'inertial'),origin=one(inertial,'origin');near(numbers(origin.attrs.xyz,3),expected.comM);near(numbers(origin.attrs.rpy,3),[0,0,0]);near(numbers(one(inertial,'mass').attrs.value,1),[expected.massKg]);const tensor=one(inertial,'inertia');for(const [i,key]of ['ixx','ixy','ixz','iyy','iyz','izz'].entries())near(numbers(tensor.attrs[key],1),[expected.inertiaKgM2[i]!]);}
 const controls=robot.children.filter(n=>n.name==='ros2_control');if(!controls.length)throw Error('XARM_PLUGIN_MISSING');
 for(const control of controls)if(one(one(control,'hardware'),'plugin').text.trim()!==profile.modes[mode].plugin)throw Error('XARM_HARDWARE_PLUGIN_FORBIDDEN');
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
