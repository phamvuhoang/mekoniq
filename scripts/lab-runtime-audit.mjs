import {isBuiltin,createRequire} from 'node:module';
// A Lab artifact must run with no node_modules or checkout beside it, and carry no credential. Called by export-lab-runtime.mjs before the manifest is written.
const SECRETS=[/-----BEGIN [A-Z ]*PRIVATE KEY-----(?:\\n|\s)*[A-Za-z0-9+/]{16}/,/\bsb_secret_[A-Za-z0-9_-]{16}/,/\bsk_(?:live|test)_[A-Za-z0-9]{16}/,/\bAKIA[0-9A-Z]{16}\b/,/\bgh[pousr]_[A-Za-z0-9]{30,}/,/\bgithub_pat_[A-Za-z0-9_]{30,}/,/\bxox[baprs]-[A-Za-z0-9-]{20,}/];
export function auditBundle(text){
 // TypeScript is already pinned in the build/import toolchain of both repositories.
 // Parse syntax rather than scanning code-generation strings (AJV legitimately embeds require(...) as text).
 const ts=createRequire(import.meta.url)('typescript'),tree=ts.createSourceFile('runtime.mjs',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 if(tree.parseDiagnostics.length)throw new Error('ARTIFACT_SYNTAX_INVALID');
 const check=node=>{if(node&&ts.isStringLiteralLike(node)&&!isBuiltin(node.text))throw new Error(`NON_STANDALONE_IMPORT:${node.text}`);};
 const visit=node=>{
  if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))check(node.moduleSpecifier);
  if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&['require','__require'].includes(node.expression.text)))check(node.arguments[0]);
  ts.forEachChild(node,visit);
 };
 visit(tree);
 if(SECRETS.some(p=>p.test(text)))throw new Error('SECRET_IN_ARTIFACT');
 // Decode JWT claims instead of depending on a particular base64 alignment of service_role.
 for(const match of text.matchAll(/\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)){
  let claims;try{claims=JSON.parse(Buffer.from(match[1],'base64url').toString('utf8'));}catch{continue;}
  if(claims?.role==='service_role')throw new Error('SECRET_IN_ARTIFACT');
 }
 for(const match of text.matchAll(/\{[^{}]{0,4096}\}/g))if(/["']?kty["']?\s*:\s*["'](?:RSA|EC|OKP)["']/.test(match[0])&&/["']?d["']?\s*:\s*["'][A-Za-z0-9_-]{16,}["']/.test(match[0]))throw new Error('SECRET_IN_ARTIFACT');
}
