/* Generated from native-handoff-v1.schema.json. Run pnpm contracts:generate; do not edit. */

export type HandoffInstallation =
  | {
      kind: 'oci';
    }
  | {
      kind: 'native_apt';
      /**
       * @minItems 1
       * @maxItems 256
       */
      sources: {
        id: string;
        kind: 'apt_repository' | 'source_archive';
        uri: string;
        sha256: string | null;
      }[];
      /**
       * @minItems 1
       * @maxItems 256
       */
      packageSources: {
        name: string;
        sourceId: string;
      }[];
    };

export interface NativeHandoffV1 {
  schemaVersion: 1;
  subject: HandoffSubject;
  checker: {
    sourceCommit: string;
    toolSha256: string;
  };
  refs: {
    /**
     * @minItems 1
     * @maxItems 1
     */
    runtimeManifest: HandoffRef[];
    /**
     * @minItems 1
     * @maxItems 1
     */
    labLock: HandoffRef[];
    /**
     * @minItems 1
     * @maxItems 1
     */
    runtime: HandoffRef[];
    /**
     * @minItems 1
     * @maxItems 1
     */
    project: HandoffRef[];
    /**
     * @minItems 1
     * @maxItems 1
     */
    world: HandoffRef[];
    /**
     * @minItems 1
     * @maxItems 1
     */
    model: HandoffRef[];
    /**
     * @minItems 1
     * @maxItems 1
     */
    profile: HandoffRef[];
    /**
     * @minItems 1
     * @maxItems 512
     */
    schema: HandoffRef[];
    /**
     * @minItems 1
     * @maxItems 512
     */
    engine: HandoffRef[];
    /**
     * @minItems 1
     * @maxItems 512
     */
    tool: HandoffRef[];
    /**
     * @minItems 1
     * @maxItems 1
     */
    archive?: HandoffRef[];
  };
  profile: HandoffProfile;
  frames: {
    world: string;
    robotBase: string;
    tool: string | null;
    handedness: 'right';
  };
  units: {
    length: 'm';
    angle: 'rad';
    mass: 'kg';
    time: 's';
  };
  /**
   * @minItems 1
   * @maxItems 256
   */
  seeds: number[];
  casePolicy: {
    /**
     * @minItems 1
     * @maxItems 256
     */
    required: string[];
    lostAck: 'unknown_no_resend';
    authority: 'source';
  };
  accepted: false;
  dynamics: 'not_calibrated';
}
export interface HandoffSubject {
  id: string;
  sourceCommit: string;
  labCommit: string;
  schemaHash: string;
  portableClosureHash: string;
  runtimeArtifactSha256: string;
  image: HandoffImage | null;
  executionKind: 'mujoco_image' | 'ros2_native' | 'linuxcnc_native';
  profileSha256: string;
  nativeClosureHash: string | null;
}
export interface HandoffImage {
  platform: 'linux/amd64' | 'linux/arm64';
  manifestDigest: string;
  configDigest: string;
}
export interface HandoffRef {
  path: string;
  sha256: string;
  bytes: number;
  sourcePath: string;
  sourceCommit: string;
}
export interface HandoffProfile {
  id: string;
  modelId: string;
  modelSha256: string;
  architecture: 'amd64' | 'arm64';
  os: {
    id: string;
    version: string;
  };
  /**
   * @minItems 1
   * @maxItems 256
   */
  requiredPackages: HandoffPackage[];
  /**
   * @minItems 0
   * @maxItems 256
   */
  forbiddenPackages: string[];
  /**
   * @minItems 1
   * @maxItems 16
   */
  clockDomains: string[];
  installation: HandoffInstallation;
  documents: HandoffDocumentBinding;
}
export interface HandoffPackage {
  name: string;
  version: string | null;
  sha256: string | null;
}
export interface HandoffDocumentBinding {
  kind: string;
  modelRevision: string;
  siModelRevision: string;
  sourceUnits: {
    length: string;
    angle: string;
    alpha: string;
  };
  lengthToM: number;
  angleToRad: number;
  frameMap: {
    [k: string]: any;
  };
  /**
   * @minItems 1
   * @maxItems 1000
   */
  jointMap: {
    id: string;
    controllerJoint: string;
    sign: -1 | 1;
    zeroOffsetRad: number;
    lowerRad: number | null;
    upperRad: number | null;
    velocityRadS: number;
  }[];
  inertiaOrder: 'xx_xy_xz_yy_yz_zz' | 'unknown';
}
