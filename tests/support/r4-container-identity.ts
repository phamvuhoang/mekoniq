type Image={Id:string;Os:string;Architecture:string;Config:{Labels?:Record<string,string>}};
type Host={os:string;machine:string;daemonPlatform:string};
type Runtime={sourceCommit?:unknown;schemaHash?:unknown};
type Export={sourceCommit:string;schemaHash:string;artifactSha256:string};

export function assertR4Image(host:Host,image:Image,sourceCommit:string){
 if(host.os!=='Darwin'||host.machine!=='arm64'||host.daemonPlatform!=='linux/arm64'||image.Os!=='linux'||image.Architecture!=='arm64'){
  throw Error(`NATIVE_ARCH_REQUIRED: host=${host.os}/${host.machine} daemon=${host.daemonPlatform} image=${image.Os}/${image.Architecture}`);
 }
 const revision=image.Config.Labels?.['org.opencontainers.image.revision'];
 if(revision!==sourceCommit)throw Error(`IMAGE_STALE: OCI revision ${revision}, expected ${sourceCommit}`);
}

export function assertR4Runtime(expected:Export,health:Runtime,bundleSha256:string){
 if(health.sourceCommit!==expected.sourceCommit||health.schemaHash!==expected.schemaHash||bundleSha256!==expected.artifactSha256){
  throw Error(`IMAGE_STALE: runtime commit=${health.sourceCommit} schema=${health.schemaHash} bundle=${bundleSha256}, expected ${JSON.stringify({sourceCommit:expected.sourceCommit,schemaHash:expected.schemaHash,artifactSha256:expected.artifactSha256})}`);
 }
}
