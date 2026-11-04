/**
 * Observation-only export of robot state to a MassRobotics-style interoperability consumer. It publishes what MEKONIQ already knows (pose, state, battery); nothing comes back in: there is
 * no command path, no subscription to commands, and the capabilities say so. Field names here are neutral — they must be aligned with the exact version of the official standard before a
 * consumer is connected (docs/integrations/rmf-boundary.md).
 */
export type Observation = { robotId: string; observedAt: string; pose?: { x: number; y: number; yaw: number; mapId: string }; operationalState?: 'idle' | 'moving' | 'stopped' | 'fault' | 'offline'; batteryPercent?: number };
export function massRoboticsObservationCapabilities() {
  return { commandMotion: false, observePose: true, observeState: true, observeBattery: true } as const;
}
export function observationFrom(robot: { id: string; observedAt: string; x?: number; y?: number; yaw?: number; mapId?: string; status?: string; battery?: number }): Observation {
  const state: Observation['operationalState'] | undefined = robot.status === 'moving' || robot.status === 'idle' || robot.status === 'stopped' || robot.status === 'fault' || robot.status === 'offline' ? robot.status : undefined;
  return { robotId: robot.id, observedAt: robot.observedAt,
    ...(robot.x !== undefined && robot.y !== undefined && robot.mapId ? { pose: { x: robot.x, y: robot.y, yaw: robot.yaw ?? 0, mapId: robot.mapId } } : {}),
    ...(state ? { operationalState: state } : {}), ...(typeof robot.battery === 'number' && robot.battery >= 0 && robot.battery <= 100 ? { batteryPercent: robot.battery } : {}) };
}
/** The only thing an observer is given: a place to publish to. */
export interface ObservationSink { publish(observation: Observation): Promise<void> }
