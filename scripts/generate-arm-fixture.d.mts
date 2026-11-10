import type {ComponentRevision} from '../packages/contracts/generated/engineering';
export const MASS_KG: number[];
export const EFFORT_NM: number[];
export function buildArmComponent(): ComponentRevision;
export function chainFk(component: ComponentRevision, q: number[]): {flange: [number, number, number]; quaternionXyzw: [number, number, number, number]};
export function generateArmFixture(dir: string): Promise<{component: ComponentRevision; componentDigest: string; manifest: {files: {path: string; sha256: string; bytes: number}[]; componentDigest: string}}>;
