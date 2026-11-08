import {describe,expect,it} from 'vitest';
// @ts-expect-error plain ESM script without declarations
import {lockMetadata,sha256} from '../../scripts/bootstrap-portable-simulation.mjs';
describe('portable-worker-lock/1',()=>{
 it('sorts packages deterministically and hashes the requirements text',()=>{
  const m=lockMetadata({pythonVersion:'3.11.15',platform:'darwin-arm64',freeze:'PyYAML==6.0.3\nlinkforge-core==1.6.0\n-e junk\n',requirementsText:'x'});
  expect(m.packages).toEqual([{name:'linkforge-core',version:'1.6.0'},{name:'pyyaml',version:'6.0.3'}]);
  expect(m.requirementsSha256).toBe(sha256('x'));
  expect(m.documentType).toBe('portable-worker-lock');
 });
});
