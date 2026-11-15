// A new Supabase namespace, never the developer project's reset/migration target.
export function ownedCiConfig(text,projectId){
 if(!/^mekoniq-ci-[a-f0-9]{16}$/.test(projectId))throw Error('CI_PROJECT_ID');
 if(!text.includes('project_id = "mekoniq-w00-w04"'))throw Error('CI_CONFIG_BASE');
 return text.replace('project_id = "mekoniq-w00-w04"',`project_id = "${projectId}"`);
}
export function ownedCiReceiptIssues(r){return !r||r.version!==1||!/^mekoniq-ci-[a-f0-9]{16}$/.test(r.projectId??'')||! /^[a-f0-9]{64}$/.test(r.containerId??'')||r.database!=='postgres'||r.host!=='127.0.0.1'||r.port!==57422||r.createdForTests!==true||r.unrelatedServicesModified!==false?['OWNED_TEST_SERVICE_REQUIRED']:[];}
