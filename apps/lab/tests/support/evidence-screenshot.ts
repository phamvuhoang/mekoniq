import {basename,join} from 'node:path';
/** Successful capture destination; ordinary browser runs retain their established screenshot paths. */
export function evidenceScreenshotPath(legacyPath:string,env:NodeJS.ProcessEnv=process.env):string{
  return env.LAB_PW_OUTPUT_DIR?join(env.LAB_PW_OUTPUT_DIR,'captures',basename(legacyPath)):legacyPath;
}
