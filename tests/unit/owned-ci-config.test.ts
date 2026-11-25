import {expect,test} from 'vitest';
// @ts-expect-error ESM test-owned service tooling
import {ownedCiConfig,ownedCiReceiptIssues} from '../../scripts/owned-ci-config.mjs';
test('CI namespace cannot name the developer project; scratch database alone is insufficient ownership',()=>{
 expect(()=>ownedCiConfig('project_id = "mekoniq-w00-w04"','mekoniq-w00-w04')).toThrow('CI_PROJECT_ID');expect(ownedCiConfig('project_id = "mekoniq-w00-w04"','mekoniq-ci-'+'a'.repeat(16))).toContain('mekoniq-ci-');expect(ownedCiReceiptIssues({database:'scratch'})).toContain('OWNED_TEST_SERVICE_REQUIRED');
 expect(ownedCiReceiptIssues({version:1,projectId:'mekoniq-ci-'+'a'.repeat(16),containerId:'b'.repeat(64),database:'postgres',host:'127.0.0.1',port:57422,createdForTests:true,unrelatedServicesModified:false})).toEqual([]);
});
// @ts-expect-error test-owned target binding
import * as owned from '../../scripts/owned-ci-config.mjs';
test('owned service credentials and database target must stay on the isolated local service',()=>{
 expect(typeof owned.ownedCiTargetIssues).toBe('function');
 const env={DATABASE_ADMIN_URL:'postgresql://postgres:example@127.0.0.1:57422/postgres',MEKONIQ_TEST_DB:'postgres',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:57421',SUPABASE_SERVICE_ROLE_KEY:'test-fixture',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'test-fixture'};
 expect(owned.ownedCiTargetIssues(env)).toEqual([]);expect(owned.ownedCiTargetIssues({...env,MEKONIQ_TEST_DB:'restore_up_1795500000000'})).toEqual([]);{const rest:Record<string,string|undefined>={...env};delete rest.MEKONIQ_TEST_DB;expect(owned.ownedCiTargetIssues(rest)).toEqual([]);}for(const bad of ['restore_','restore_UP','restore-up','postgres2','restore_a;drop'])expect(owned.ownedCiTargetIssues({...env,MEKONIQ_TEST_DB:bad})).toContain('OWNED_SERVICE_TARGET_REQUIRED');for(const change of [{DATABASE_ADMIN_URL:'postgresql://postgres:example@other:57422/postgres'},{MEKONIQ_TEST_DB:'other'},{NEXT_PUBLIC_SUPABASE_URL:'https://external.example'},{SUPABASE_SERVICE_ROLE_KEY:''}])expect(owned.ownedCiTargetIssues({...env,...change})).toContain('OWNED_SERVICE_TARGET_REQUIRED');
});
