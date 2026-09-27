import { randomUUID } from 'node:crypto';

/**
 * Test-only owner identity for the ZA141251SA single-identity lockdown.
 *
 * Production sets ZA141251SA_OWNER_EMAIL to the one authorised operator, and
 * `provisionOwner` fails closed for every other address. A test process that
 * inherits a real deployment environment (a .env on the machine running the
 * suite) would therefore be unable to provision the throwaway owner its fresh
 * temporary database needs.
 *
 * Importing this module rebinds the lock to a synthetic address that belongs to
 * this test process only. The lock stays ENFORCED — it is simply pointed at the
 * owner the fixture is about to create, so the tests exercise the same
 * fail-closed code path production uses instead of switching it off.
 *
 * Import it BEFORE any module that reads the owner identity, and pass
 * TEST_OWNER_EMAIL to provisionOwner.
 */
export const TEST_OWNER_EMAIL = `mission-test-owner-${randomUUID()}@test.local`;

process.env.ZA141251SA_OWNER_EMAIL = TEST_OWNER_EMAIL;
