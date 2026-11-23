// Dependencies in Vite output: static/dynamic JS imports and preload asset lists.
// Parse JavaScript so an example string or comment cannot be mistaken for an import.
import ts from 'typescript';
import {posix} from 'node:path';
export function productionAssetDependencies(path,bytes){
 const out=new Set(),file=ts.createSourceFile(path,bytes.toString(),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const add=value=>{
  const resolved=value.startsWith('.')?posix.normalize(posix.join(posix.dirname(path),value)):value.replace(/^\//,'');
  if(!/^assets\/[A-Za-z0-9_.-]+\.(?:js|css)$/.test(resolved))throw Error('PRODUCTION_IMPORT_PATH');
  out.add(resolved);
 };
 const walk=node=>{
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteralLike(node.moduleSpecifier))add(node.moduleSpecifier.text);
  if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0]))add(node.arguments[0].text);
  if(ts.isStringLiteralLike(node)&&/^\/?assets\/[A-Za-z0-9_.-]+\.(?:js|css)$/.test(node.text))add(node.text);
  ts.forEachChild(node,walk);
 };
 walk(file);return [...out];
}
