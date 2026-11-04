/** A device may speak only for the tenant and venue it is enrolled in; an entry naming any other scope is refused before it reaches a projection. */
export function validDeviceScope(device: { organizationId: string; venueId: string }, entry: { organizationId: string; venueId: string }): boolean {
  return device.organizationId === entry.organizationId && device.venueId === entry.venueId;
}
