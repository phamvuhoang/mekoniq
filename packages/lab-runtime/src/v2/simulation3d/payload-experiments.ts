/** Closed server-owned experiments. A selector creates a new project/bundle/run; no live edits. */
export const PAYLOAD_EXPERIMENTS={
 'payload-empty-v1':{load:'empty',physics:'drive-contact-profile',maxLinearMps:.5,maxAngularRadps:1},
 'payload-center-v1':{load:'cup-center',physics:'drive-contact-profile',maxLinearMps:.5,maxAngularRadps:1},
 'payload-offset-v1':{load:'cup-offset',physics:'drive-contact-profile',maxLinearMps:.5,maxAngularRadps:1},
 'payload-slow-v1':{load:'cup-center',physics:'drive-contact-profile',maxLinearMps:.2,maxAngularRadps:.4},
 'payload-fast-v1':{load:'cup-center',physics:'drive-contact-profile',maxLinearMps:1,maxAngularRadps:2},
 'payload-friction-low-v1':{load:'cup-center',physics:'drive-contact-low-v1',maxLinearMps:.5,maxAngularRadps:1},
 'payload-friction-high-v1':{load:'cup-center',physics:'drive-contact-high-v1',maxLinearMps:.5,maxAngularRadps:1},
} as const;
for(const value of Object.values(PAYLOAD_EXPERIMENTS))Object.freeze(value);Object.freeze(PAYLOAD_EXPERIMENTS);
export type PayloadExperimentId=keyof typeof PAYLOAD_EXPERIMENTS;
export const payloadExperiment=(id:string)=>{if(!Object.hasOwn(PAYLOAD_EXPERIMENTS,id))throw new Error('MUJOCO_EXPERIMENT_UNREGISTERED');return PAYLOAD_EXPERIMENTS[id as PayloadExperimentId];};

/** B08 must compare exact fields, after verifying all digests. These are allowed differences, not a mask for arbitrary model/policy edits. */
export const PAYLOAD_SPEED_DIFFERENCES=Object.freeze({
 selectedInputs:['mujocoExperimentId','policy.parameters.maxLinearMps','policy.parameters.maxAngularRadps'] as const,
 derivedInputs:['projectDigest','physical.inputs.project.digest','physical.modelDigest','physical file sha256','load.modelRef.sha256','load.digest','load file sha256','navigation.inputs.project.digest','navigation.physicalModelDigest','navigation.modelDigest','navigation.kinematics.maxLinearMps','navigation.kinematics.maxAngularRadps','navigation.navigationPolicyRef.id','navigation.navigationPolicyRef.hash','policy.id','policy.source','policy.hash','scene.inputs.project.digest','scene.robots[0].model.inputs.project.digest','scene.robots[0].model.physicalModelDigest','scene.robots[0].model.modelDigest','scene.robots[0].model.kinematics.maxLinearMps','scene.robots[0].model.kinematics.maxAngularRadps','scene.robots[0].model.navigationPolicyRef.id','scene.robots[0].model.navigationPolicyRef.hash','scene.policy.id','scene.policy.source','scene.policy.parameters.maxLinearMps','scene.policy.parameters.maxAngularRadps','scene.policy.hash','scene.files[physical-model/amr-1.json].sha256','scene.files[cup-center.json].sha256','scene.engine.loadProfileRef.sha256','scene.sceneDigest','navigation-scene.json file sha256/bytes','scene.json file sha256/bytes','navigation-policy.json file sha256/bytes','navigation-model/amr-1.json file sha256/bytes','engineering-project.json file sha256/bytes','physical-model/amr-1.json file sha256','cup-center.json file sha256','bundleDigest','runId'] as const,
 // B08 operational admission reconstructs these complete documents from closed registry inputs. No subtree is ignored.
 validation:'physics-inputs.verifiedPhysicsInputs: exact reconstructed physical/navigation/policy/scene documents; all remaining documents and project fields must match',
 unchanged:['runSeed','sourceCommit','engineVersion','lockDigest','platform','clock','simulationPerturbation','completionObservation','assemblyDigest','world','canonical physical file sha256','physical mechanics excluding inputs/modelDigest','load props/supports','physics profile file sha256','controller algorithm/version/ramp policy','stop policy','all other navigation policy/kinematics fields','entitySpeedLimitMps'] as const,
});
