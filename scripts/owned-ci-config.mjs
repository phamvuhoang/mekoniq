// A new Supabase namespace, never the developer project's reset/migration target.
export function ownedCiConfig(text,projectId){
 if(!/^mekoniq-ci-[a-f0-9]{16}$/.test(projectId))throw Error('CI_PROJECT_ID');
 if(!text.includes('project_id = "mekoniq-w00-w04"'))throw Error('CI_CONFIG_BASE');
 return text.replace('project_id = "mekoniq-w00-w04"',`project_id = "${projectId}"`);
}
export function ownedCiReceiptIssues(r){return !r||r.version!==1||!/^mekoniq-ci-[a-f0-9]{16}$/.test(r.projectId??'')||! /^[a-f0-9]{64}$/.test(r.containerId??'')||r.database!=='postgres'||r.host!=='127.0.0.1'||r.port!==57422||r.createdForTests!==true||r.unrelatedServicesModified!==false?['OWNED_TEST_SERVICE_REQUIRED']:[];}
export function ownedCiTargetIssues(env){try{const db=new URL(env.DATABASE_ADMIN_URL),api=new URL(env.NEXT_PUBLIC_SUPABASE_URL);if(!['postgresql:','postgres:'].includes(db.protocol)||db.hostname!=='127.0.0.1'||db.port!=='57422'||db.pathname!=='/postgres'||!/^(postgres|restore_[a-z0-9_]+)$/.test(env.MEKONIQ_TEST_DB??'postgres')||api.protocol!=='http:'||api.hostname!=='127.0.0.1'||api.port!=='57421'||!env.SUPABASE_SERVICE_ROLE_KEY||!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)return ['OWNED_SERVICE_TARGET_REQUIRED'];return [];}catch{return ['OWNED_SERVICE_TARGET_REQUIRED'];}}
