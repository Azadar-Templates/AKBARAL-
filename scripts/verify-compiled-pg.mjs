#!/usr/bin/env node
/** Behavioral check of the packaged driver; never connects to a database. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {translateSqlForPg}=require('../dist/src/db/driver.js');
for(const column of ['payload','events.payload']) {
  assert.equal(translateSqlForPg(`SELECT json_extract(${column}, '$.key_1') AS value`),`SELECT (${column}::json->>'key_1') AS value`);
}
console.log('PASS compiled PostgreSQL driver uses single-quoted JSON keys. No database connection made.');
