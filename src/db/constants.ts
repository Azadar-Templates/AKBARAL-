/**
 * Domain value constants for the Phase 1 database foundation.
 *
 * Prisma stores these as TEXT columns in SQLite. Keeping them as constants
 * (instead of DB enums) keeps the schema portable to PostgreSQL later and gives
 * the application a single source of truth for allowed status/type values.
 */

export const UserRole = {
  USER: 'user',
  ADMIN: 'admin',
  SERVICE: 'service',
} as const;
export type UserRoleValue = (typeof UserRole)[keyof typeof UserRole];

export const UserStatus = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  BANNED: 'banned',
} as const;
export type UserStatusValue = (typeof UserStatus)[keyof typeof UserStatus];

export const CreditTransactionType = {
  GRANT: 'grant',
  CONSUME_TASK: 'consume_task',
  REFUND_TASK: 'refund_task',
  BONUS: 'bonus',
  ADJUST: 'adjust',
} as const;
export type CreditTransactionTypeValue =
  (typeof CreditTransactionType)[keyof typeof CreditTransactionType];

export const CreditTransactionStatus = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;
export type CreditTransactionStatusValue =
  (typeof CreditTransactionStatus)[keyof typeof CreditTransactionStatus];

export const TaskStatus = {
  CREATED: 'created',
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;
export type TaskStatusValue = (typeof TaskStatus)[keyof typeof TaskStatus];

export const AgentExecutionStatus = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;
export type AgentExecutionStatusValue =
  (typeof AgentExecutionStatus)[keyof typeof AgentExecutionStatus];

export const LogLevel = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
} as const;
export type LogLevelValue = (typeof LogLevel)[keyof typeof LogLevel];

export const AgentStatus = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
  DEPRECATED: 'deprecated',
} as const;
export type AgentStatusValue = (typeof AgentStatus)[keyof typeof AgentStatus];

export const ProjectStatus = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
  DELETED: 'deleted',
} as const;
export type ProjectStatusValue = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export const IntegrationStatus = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
  ERROR: 'error',
} as const;
export type IntegrationStatusValue =
  (typeof IntegrationStatus)[keyof typeof IntegrationStatus];

/**
 * The default number of free-task credits granted to a new user.
 */
export const DEFAULT_FREE_CREDITS = 3;
