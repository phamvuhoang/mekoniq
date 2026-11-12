import type {ComponentRevision} from '../packages/contracts/generated/engineering';
export const FIXTURE_DIR: string;
export const STRAY_RADIUS_M: number;
export const IK_RNG_SEED: number;
export const FK_GOLDEN_SEED: number;
export function chainFlange(component: unknown, q: readonly number[]): [number, number, number];
export function dae2stl(src: string, maxRadiusM?: number): {bytes: Buffer; triangles: number; droppedTriangles: number};
export function generateXarm6Fixture(dir: string, options?: {inputDir?: string}): Promise<{component: ComponentRevision; manifest: {componentDigest: string; files: {path: string; sha256: string; bytes: number}[]; blobs: {link: string; sha256: string; sourceSha256: string; triangles: number; droppedTriangles: number}[]}; table: {waypoint: string; q: number[]; positionErrorM: number; orientationErrorRad: number; condition: number}[]}>;
