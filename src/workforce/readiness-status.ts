export const READINESS_STATUSES = ['WORK-READY', 'CONDITIONAL', 'DEGRADED', 'NOT_READY'] as const;
export type ReadinessStatus = (typeof READINESS_STATUSES)[number];

export type LegacyReadinessStatus =
  | 'ACTIVE'
  | 'READY'
  | 'NEEDS_CONFIGURATION'
  | 'NEEDS_OWNER_ACTION'
  | 'PARTIALLY_READY'
  | 'MISSING_DEPENDENCY'
  | 'DEGRADED'
  | 'BLOCKED'
  | 'FAILED'
  | 'NOT_READY';

/** One canonical readiness vocabulary for registry, provider, and UI reports. */
export function normalizeReadiness(status: LegacyReadinessStatus): ReadinessStatus {
  switch (status) {
    case 'ACTIVE':
    case 'READY':
      return 'WORK-READY';
    case 'NEEDS_CONFIGURATION':
    case 'NEEDS_OWNER_ACTION':
    case 'PARTIALLY_READY':
      return 'CONDITIONAL';
    case 'MISSING_DEPENDENCY':
    case 'DEGRADED':
      return 'DEGRADED';
    case 'BLOCKED':
    case 'FAILED':
    case 'NOT_READY':
      return 'NOT_READY';
  }
}
