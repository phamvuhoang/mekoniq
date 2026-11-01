import {expect,test} from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {readFile} from 'node:fs/promises';
const names=['lab-project','lab-run','lab-deployment'];
test('source public Lab schemas have stable IDs and reject untyped or incomplete external inputs',async()=>{const ajv=new Ajv({allErrors:true,strict:true});addFormats(ajv);for(const name of names){const schema=JSON.parse(await readFile(`packages/contracts/schemas/${name}.schema.json`,'utf8'));expect(schema.$id).toBe(`mekoniq.${name}.v1`);ajv.addSchema(schema);}for(const name of names){const validate=ajv.getSchema(`mekoniq.${name}.v1`)!;expect(validate({})).toBe(false);expect(validate({schemaVersion:1,command:'rm -rf /'})).toBe(false);}});
