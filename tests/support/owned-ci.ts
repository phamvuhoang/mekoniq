import {copyFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

/** Run the real owner with a test-only Supabase config and isolated host ports. */
export function ownedCiCheckout(root:string,ports:number[]=[0]){
 mkdirSync(join(root,'scripts'));mkdirSync(join(root,'supabase'));
 for(const f of ['owned-source-ci.mjs','owned-ci-ports.mjs','owned-ci-config.mjs'])copyFileSync(join('scripts',f),join(root,'scripts',f));
 writeFileSync(join(root,'supabase/config.toml'),['project_id = "mekoniq-w00-w04"',...ports.map((port,i)=>`[service${i}]\nport = ${port}`)].join('\n')+'\n');
 return join(root,'scripts/owned-source-ci.mjs');
}
