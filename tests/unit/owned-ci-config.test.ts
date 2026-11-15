import {expect,test} from 'vitest';
// @ts-expect-error ESM test-owned service tooling
import {ownedCiConfig,ownedCiReceiptIssues} from '../../scripts/owned-ci-config.mjs';
test('CI namespace cannot name the developer project; scratch database alone is insufficient ownership',()=>{
 expect(()=>ownedCiConfig('project_id = "mekoniq-w00-w04"','mekoniq-w00-w04')).toThrow('CI_PROJECT_ID');expect(ownedCiConfig('project_id = "mekoniq-w00-w04"','mekoniq-ci-'+'a'.repeat(16))).toContain('mekoniq-ci-');expect(ownedCiReceiptIssues({database:'scratch'})).toContain('OWNED_TEST_SERVICE_REQUIRED');
 expect(ownedCiReceiptIssues({version:1,projectId:'mekoniq-ci-'+'a'.repeat(16),containerId:'b'.repeat(64),database:'postgres',host:'127.0.0.1',port:57422,createdForTests:true,unrelatedServicesModified:false})).toEqual([]);
});
