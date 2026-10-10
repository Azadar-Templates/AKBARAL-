/**
 * The specialty config is the single source of truth for what each mission specialist does, so it has
 * to agree with the venue catalog (or the fleet would rank work nobody may take), with the gate
 * helper (or the dashboard would advertise a fit the assign call refuses), and with itself (a
 * specialty nothing uses is a lie about the fleet's surface).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPECIALIST_SPECIALTIES, WORK_KINDS, describeSpecialty, isSpecialtyFit, knownSpecialties, specialtyFor, workKindsFor } from './specialty-registry';
import { VERIFIED_PLATFORM_RECORDS } from './platform-catalog';

test('the config is one object of complete entries over known work kinds', () => {
  const keys = Object.keys(SPECIALIST_SPECIALTIES);
  assert.ok(keys.length >= 15, `the fleet needs real coverage, saw ${keys.length}`);
  assert.deepEqual(knownSpecialties(), [...keys].sort(), 'knownSpecialties is the sorted set of the same keys');
  for (const key of keys) {
    const definition = SPECIALIST_SPECIALTIES[key];
    assert.match(definition.label, /^[A-Z]/, `${key} has an owner-readable label`);
    assert.ok(definition.does.length >= 2, `${key} must name more than one kind of work`);
    assert.ok(definition.classes.length >= 1, `${key} must be allowed at least one opportunity class`);
    assert.ok(definition.rationale.length > 30, `${key} has to say why those kinds of work are the paid ones`);
    for (const work of definition.does) assert.ok((WORK_KINDS as readonly string[]).includes(work), `${key}: ${work} is a declared work kind`);
    for (const opportunityClass of definition.classes) assert.ok(/^[a-z0-9_]+$/.test(opportunityClass), `${key}: class ids are snake_case`);
    assert.deepEqual(new Set(definition.does).size, definition.does.length, `${key} lists each work kind once`);
  }
});

test('every catalogued venue names a specialty in this config, of a class that specialty covers', () => {
  const classesUsed = new Set<string>();
  for (const record of VERIFIED_PLATFORM_RECORDS) {
    classesUsed.add(record.opportunityClass);
    const definition = specialtyFor(record.specialtyKey);
    assert.ok(definition, `${record.platformId} names ${record.specialtyKey}, which must exist in the config`);
    assert.ok(definition!.classes.includes(record.opportunityClass), `${record.platformId}: ${record.specialtyKey} does not cover ${record.opportunityClass}, so nobody could ever be assigned to it`);
    assert.equal(isSpecialtyFit(record.specialtyKey, record.opportunityClass), true, 'the gate agrees with the catalog on every real pairing');
  }
  // A class no specialty claims would leave that whole earning rail unassignable, and the only
  // honest way to find that out is to say it out loud.
  const claimed = new Set(Object.values(SPECIALIST_SPECIALTIES).flatMap(entry => [...entry.classes]));
  for (const entry of classesUsed) assert.ok(claimed.has(entry), `opportunity class ${entry} is used by the catalog but claimed by no specialty`);
});

test('no specialty is defined that no venue uses, and no class is claimed for a venue that does not exist', () => {
  const used = new Set(VERIFIED_PLATFORM_RECORDS.map(record => record.specialtyKey));
  const defined = new Set(knownSpecialties());
  assert.deepEqual([...defined].filter(key => !used.has(key)), [], 'an unused specialty is dead config and would be presented as fleet capability');
  const classesInCatalog = new Set(VERIFIED_PLATFORM_RECORDS.map(record => record.opportunityClass));
  for (const [key, definition] of Object.entries(SPECIALIST_SPECIALTIES)) {
    for (const opportunityClass of definition.classes) {
      assert.ok(classesInCatalog.has(opportunityClass), `${key} claims ${opportunityClass}, which the catalog has no venue for`);
    }
  }
});

test('fit fails closed: an unknown specialty, an unknown class, or none at all', () => {
  assert.equal(isSpecialtyFit('no_such_specialist', 'bug_bounties'), false);
  assert.equal(isSpecialtyFit('crowd_tester', 'no_such_class'), false);
  assert.equal(isSpecialtyFit(null, 'bug_bounties'), false);
  assert.equal(isSpecialtyFit('crowd_tester', null), false);
  assert.equal(isSpecialtyFit(undefined, undefined), false);
  assert.equal(describeSpecialty(null), 'unregistered specialty', 'the refusal text has to admit it is unknown');
  const crowdTester = SPECIALIST_SPECIALTIES.crowd_tester;
  assert.deepEqual(workKindsFor('crowd_tester'), [...crowdTester.does]);
  assert.deepEqual(workKindsFor('no_such_specialist'), [], 'an unknown specialty claims no skills');
  assert.deepEqual(workKindsFor(null), []);
  // A specialty that covers two classes must not leak into a third.
  assert.equal(isSpecialtyFit('crowd_tester', 'microtasks_labeling'), true);
  assert.equal(isSpecialtyFit('crowd_tester', 'github_issue_bounties'), false);
  assert.match(describeSpecialty('crowd_tester'), new RegExp(crowdTester.label));
  assert.match(describeSpecialty('crowd_tester'), new RegExp(crowdTester.does[0]));
});
