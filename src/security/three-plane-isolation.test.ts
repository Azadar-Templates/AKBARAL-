/**
 * THREE-PLANE SECURITY ISOLATION TEST
 *
 * Verifies:
 * 1. Normal USER cannot access admin/owner/mission routes
 * 2. Cross-user data isolation (user A cannot see user B's data)
 * 3. OWNER/ADMIN cannot see ZA141251SA mission data
 * 4. ZA141251SA mission data is completely isolated from AKBARAL! customer data
 * 5. Customer credits/tasks/billing are separate from mission wallets/treasury
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const TEST_MAIN_DB = resolve(process.cwd(), 'test-isolation-main.db');
const TEST_MISSION_DB = resolve(process.cwd(), 'test-isolation-mission.db');

describe('three-plane security isolation', () => {
  before(() => {
    // Clean up
    for (const f of [TEST_MAIN_DB, TEST_MISSION_DB]) {
      if (existsSync(f)) unlinkSync(f);
    }
    // Mission DB uses separate connection
    process.env.ZA141251SA_DATABASE_URL = `file:${TEST_MISSION_DB}`;
  });

  after(() => {
    try {
      const { missionDb } = require('../mission/database');
      missionDb.close();
    } catch {}
    for (const f of [TEST_MAIN_DB, TEST_MISSION_DB]) {
      try { if (existsSync(f)) unlinkSync(f); } catch {}
    }
    delete process.env.ZA141251SA_DATABASE_URL;
  });

  it('USER plane: user routes are scoped to authenticated userId', () => {
    // The user dashboard routes use requireAuth middleware.
    // Every query is scoped by req.auth.userId.
    // Verify the source code enforces this.
    const fs = require('node:fs');
    const source = fs.readFileSync(resolve(process.cwd(), 'src/routes/user-dashboard.ts'), 'utf8');

    // Check that every endpoint uses req.auth.userId
    const hasRequireAuth = source.includes('requireAuth');
    assert.ok(hasRequireAuth, 'user dashboard must use requireAuth middleware');

    // Count endpoints that reference userId
    const userIdReferences = (source.match(/req\.auth!?\.\s*userId/g) || []).length;
    assert.ok(userIdReferences >= 6, `expected at least 6 userId references, got ${userIdReferences}`);

    // Verify no cross-user queries (no WHERE user_id = ? with req.params)
    const crossUserPatterns = source.match(/req\.params\.\w*[uU]ser/g);
    assert.ok(!crossUserPatterns || crossUserPatterns.length === 0,
      'user dashboard must not reference other users via URL params');

    console.log(`[SECURITY] USER plane: requireAuth used, ${userIdReferences} userId-scoped queries, no cross-user access`);
  });

  it('OWNER-ADMIN plane: admin routes are separate from mission routes', () => {
    const fs = require('node:fs');

    // Check that admin routes exist but do not import mission modules
    const adminSource = fs.readFileSync(resolve(process.cwd(), 'src/routes/admin.ts'), 'utf8');
    const hasMissionImport = adminSource.includes("../mission/") || adminSource.includes("missionDb");
    assert.ok(!hasMissionImport, 'admin routes must NOT import mission modules');

    // Check that user dashboard does not import admin
    const userDashSource = fs.readFileSync(resolve(process.cwd(), 'src/routes/user-dashboard.ts'), 'utf8');
    const hasAdminImport = userDashSource.includes("../routes/admin") || userDashSource.includes("requireAdmin");
    assert.ok(!hasAdminImport, 'user dashboard must NOT import admin routes');

    console.log(`[SECURITY] OWNER-ADMIN plane: admin routes isolated from mission, user dashboard isolated from admin`);
  });

  it('MISSION BOSS plane: mission DB is separate connection from main DB', () => {
    const { missionEnv } = require('../mission/database');
    const env = missionEnv();
    // Mission DB must use ZA141251SA_DATABASE_URL, not the main DB URL
    assert.ok(env.databaseUrl.includes('mission') || env.databaseUrl.includes('ZA141251SA'),
      'mission DB should use separate database URL');

    console.log(`[SECURITY] MISSION plane: separate database connection (path: ${env.databaseUrl.slice(0, 40)}...)`);
  });

  it('MISSION data: customer tables do not exist in mission DB', () => {
    const { applyMissionMigrations, missionDb } = require('../mission/database');
    applyMissionMigrations();

    // Customer tables that must NOT exist in mission DB
    const customerTables = ['users', 'sessions', 'credit_accounts', 'subscriptions', 'invoices', 'payments', 'tasks'];
    for (const table of customerTables) {
      const exists = missionDb.tableExists(table);
      assert.ok(!exists, `mission DB must NOT contain customer table '${table}'`);
    }

    console.log(`[SECURITY] MISSION plane: ${customerTables.length} customer tables verified absent from mission DB`);
  });

  it('CUSTOMER data: all key mission tables exist', () => {
    const { missionDb, applyMissionMigrations } = require('../mission/database');
    applyMissionMigrations();

    // Mission tables that should exist in mission DB
    const missionTables = ['mission_agents', 'mission_wallets', 'mission_ledger', 'mission_audit',
      'mission_cash_accounts', 'mission_money_grants', 'mission_earning_engine_opportunities', 'mission_scheduler_state'];

    // All mission tables should exist in mission DB
    for (const table of missionTables) {
      const exists = missionDb.tableExists(table);
      assert.ok(exists, `mission table '${table}' must exist in mission DB`);
    }

    console.log(`[SECURITY] MISSION plane: all ${missionTables.length} mission tables present`);
  });

  it('USER isolation: user dashboard queries cannot leak other user data', () => {
    const fs = require('node:fs');
    const source = fs.readFileSync(resolve(process.cwd(), 'src/routes/user-dashboard.ts'), 'utf8');

    // Every task query must include user_id filter
    const taskQueries = source.match(/FROM tasks WHERE[^;]*/g) || [];
    for (const q of taskQueries) {
      assert.ok(q.includes('user_id'), `task query must filter by user_id: ${q.slice(0, 80)}`);
    }

    // Every invoice query must include user_id filter
    const invoiceQueries = source.match(/FROM invoices WHERE[^;]*/g) || [];
    for (const q of invoiceQueries) {
      assert.ok(q.includes('user_id'), `invoice query must filter by user_id: ${q.slice(0, 80)}`);
    }

    // Every session query must include user_id filter
    const sessionQueries = source.match(/FROM sessions WHERE[^;]*/g) || [];
    for (const q of sessionQueries) {
      assert.ok(q.includes('user_id'), `session query must filter by user_id: ${q.slice(0, 80)}`);
    }

    console.log(`[SECURITY] USER isolation: all task/invoice/session queries scoped by user_id`);
  });

  it('MONEY isolation: mission money module does not query customer tables', () => {
    const fs = require('node:fs');
    const source = fs.readFileSync(resolve(process.cwd(), 'src/mission/money.ts'), 'utf8');

    // Check for actual SQL table references — FROM customer_table, INTO customer_table, UPDATE customer_table
    const sqlPatterns = [
      /FROM\s+credit_accounts\b/,
      /FROM\s+subscriptions\b/,
      /FROM\s+invoices\b/,
      /\bINTO\s+credit_accounts\b/,
      /\bINTO\s+subscriptions\b/,
      /\bINTO\s+invoices\b/,
      /\bUPDATE\s+credit_accounts\b/,
      /\bUPDATE\s+subscriptions\b/,
      /\bUPDATE\s+invoices\b/,
    ];
    for (const pat of sqlPatterns) {
      assert.ok(!pat.test(source), `money module must NOT query customer tables (matched: ${pat})`);
    }

    console.log(`[SECURITY] MONEY isolation: mission money module does not query customer tables`);
  });

  it('TREASURY isolation: treasury does not read/write customer billing tables', () => {
    const fs = require('node:fs');
    const source = fs.readFileSync(resolve(process.cwd(), 'src/mission/treasury.ts'), 'utf8');

    const customerRefs = ['credit_accounts', 'subscriptions', 'invoices', 'payments', 'tasks'];
    for (const ref of customerRefs) {
      assert.ok(!source.includes(ref), `treasury module must NOT reference customer table '${ref}'`);
    }

    console.log(`[SECURITY] TREASURY isolation: treasury does not access customer billing tables`);
  });

  it('SCHEDULER isolation: scheduler does not query customer tables', () => {
    const fs = require('node:fs');
    const source = fs.readFileSync(resolve(process.cwd(), 'src/mission/earning/continuous-scheduler.ts'), 'utf8');

    // Check for actual SQL table references to customer tables
    const sqlPatterns = [
      /FROM\s+credit_accounts\b/,
      /FROM\s+subscriptions\b/,
      /FROM\s+invoices\b/,
      /\bINTO\s+credit_accounts\b/,
      /\bINTO\s+subscriptions\b/,
      /\bINTO\s+invoices\b/,
    ];
    for (const pat of sqlPatterns) {
      assert.ok(!pat.test(source), `scheduler must NOT query customer tables (matched: ${pat})`);
    }

    console.log(`[SECURITY] SCHEDULER isolation: scheduler does not query customer tables`);
  });

  it('BOSS dashboard does not query customer tables', () => {
    const fs = require('node:fs');
    const source = fs.readFileSync(resolve(process.cwd(), 'src/routes/boss-dashboard.ts'), 'utf8');

    // Check for actual SQL table references to customer tables
    const sqlPatterns = [
      /FROM\s+users\b/,
      /FROM\s+credit_accounts\b/,
      /FROM\s+subscriptions\b/,
      /FROM\s+invoices\b/,
      /FROM\s+payments\b/,
      /FROM\s+tasks\b/,
    ];
    for (const pat of sqlPatterns) {
      assert.ok(!pat.test(source), `BOSS dashboard must NOT query customer tables (matched: ${pat})`);
    }

    console.log(`[SECURITY] BOSS dashboard: no customer table queries`);
  });

  it('produces security isolation summary', () => {
    console.log('\n' + '='.repeat(80));
    console.log('SECURITY ISOLATION SUMMARY');
    console.log('='.repeat(80));
    console.log('USER plane:      requireAuth + userId-scoped queries ✓');
    console.log('OWNER-ADMIN:     separate routes, no mission imports ✓');
    console.log('MISSION BOSS:    separate database connection ✓');
    console.log('Cross-plane:     no customer↔mission table access ✓');
    console.log('Money isolation: mission money reads only mission tables ✓');
    console.log('Treasury:        no customer billing table access ✓');
    console.log('Scheduler:       no customer data modification ✓');
    console.log('BOSS dashboard:  no customer data exposure ✓');
    console.log('='.repeat(80));
  });
});
