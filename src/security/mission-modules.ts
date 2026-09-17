/**
 * Type-only bridge for the role-separation test.
 *
 * The test resolves the private mission modules with a dynamic import inside
 * `before()` (the mission database URL has to be in the environment first).
 * This file gives those dynamic imports a stable shape without making the
 * platform code import the mission at module scope.
 */
import type * as database from '../mission/database';

export type MissionDatabaseModule = typeof database;
