'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = require('./scheduler.js');
const P = require('./publication.js');
const TIME = '2026-10-12T10:00:00.000Z';
const clone = value => JSON.parse(JSON.stringify(value));
const publish = state => P.parsePublication(P.serializePublication(state, TIME));
const draft = (state, baseRevision) => ({ draftVersion: 1, state, baseRevision, updatedAt: TIME });

test('published JSON round-trips full state including frozen historical names and rotation snapshots', () => {
  const state = S.defaultState();
  S.reconcilePast(state, '2026-11-02');
  state.students = state.students.filter(student => student.id !== 'student-1');
  const result = publish(state);
  assert.deepEqual(result.state, state);
  assert.equal(result.state.history[0].studentName, '孔雯');
  assert.equal(result.publishedAt, TIME);
  assert.equal(result.revision, P.fingerprint(state));
  assert.equal(P.serializePublication(result.state, result.publishedAt), P.serializePublication(state, TIME));
  assert.deepEqual(Object.keys(JSON.parse(P.serializePublication(state, TIME))), ['schemaVersion', 'publishedAt', 'state']);
});

test('legacy raw backups preserve content and remain explicitly unbased local drafts', () => {
  const state = S.defaultState();
  const published = P.parsePublication(JSON.stringify(state));
  const normalized = P.normalizeDraft(JSON.stringify(state));
  assert.deepEqual(published.state, state);
  assert.equal(published.publishedAt, null);
  assert.equal(normalized.baseRevision, null);
  assert.equal(normalized.updatedAt, null);
  assert.equal(P.compareDraft(normalized, published).status, 'synced');
  normalized.state.students[0].status = 'internship';
  const comparison = P.compareDraft(normalized, published);
  assert.equal(comparison.status, 'unbased');
  assert.equal(comparison.needsBase, true);
  assert.equal(comparison.hasConflict, false);
});

test('unknown and pollution-related properties are discarded at every document level', () => {
  const state = S.defaultState();
  state.settings.extra = 'discard';
  state.students[0].extra = 'discard';
  const input = JSON.parse(JSON.stringify({ schemaVersion: 1, publishedAt: TIME, state, revision: 'forged', token: 'must-not-export' }));
  Object.defineProperty(input, '__proto__', { enumerable: true, value: { polluted: true } });
  Object.defineProperty(input.state, '__proto__', { enumerable: true, value: { polluted: true } });
  input.state.constructor = { prototype: { polluted: true } };
  const parsed = P.parsePublication(JSON.stringify(input));
  assert.deepEqual(parsed.state, S.defaultState());
  assert.deepEqual(Object.keys(parsed), ['schemaVersion', 'publishedAt', 'state', 'revision']);
  assert.equal({}.polluted, undefined);
  assert.notEqual(parsed.revision, 'forged');
  const local = P.normalizeDraft({ ...draft(input.state, parsed.revision), token: 'discard', revision: 'discard' });
  assert.deepEqual(Object.keys(local), ['draftVersion', 'state', 'baseRevision', 'updatedAt']);
  assert.equal(JSON.stringify(parsed).includes('must-not-export'), false);
});

test('ISO timestamps normalize offsets while rejecting nonexistent dates and invalid times', () => {
  const state = S.defaultState();
  assert.equal(P.parsePublication({ schemaVersion: 1, publishedAt: '2026-10-12T18:00:00+08:00', state }).publishedAt, TIME);
  assert.equal(P.parsePublication({ schemaVersion: 1, publishedAt: '2028-02-29T00:00:00Z', state }).publishedAt, '2028-02-29T00:00:00.000Z');
  for (const invalid of [null, '', 1791799200000, 'today', '2026-10-12', '2026-10-12T18:00:00', '2026-02-30T00:00:00Z', '2026-02-29T00:00:00Z', '2026-13-01T00:00:00Z', '2026-10-12T24:00:00Z', '2026-10-12T12:60:00Z', '2026-10-12T12:00:60Z', '2026-10-12T12:00:00+25:00']) {
    assert.throws(() => P.serializePublication(state, invalid), String(invalid));
    assert.throws(() => P.parsePublication({ schemaVersion: 1, publishedAt: invalid, state }), String(invalid));
    if (invalid !== null) assert.throws(() => P.normalizeDraft({ ...draft(state, null), updatedAt: invalid }), String(invalid));
  }
});

test('invalid document versions, invalid states and invalid draft bases are rejected', () => {
  const state = S.defaultState();
  const badState = clone(state);
  badState.students[0].status = 'unexpected';
  for (const invalid of [null, [], 2, 'not JSON', { schemaVersion: 2, publishedAt: TIME, state }, { schemaVersion: 1, state }, { schemaVersion: 1, publishedAt: TIME }, { schemaVersion: 1, publishedAt: TIME, state: badState }, badState]) {
    assert.throws(() => P.parsePublication(invalid));
  }
  for (const invalid of [null, [], { draftVersion: 2, state }, { draftVersion: 1 }, draft(badState, null), draft(state, ''), draft(state, 2), draft(state, 'remote-value')]) {
    assert.throws(() => P.normalizeDraft(invalid));
  }
  assert.throws(() => P.fingerprint(badState));
});

test('fingerprints ignore JSON key order, discarded fields and publication metadata', () => {
  const state = S.defaultState();
  const reordered = { history: [], settings: { weeks: 15, startDate: '2026-10-19', ignored: true }, students: state.students.map(student => ({ status: student.status, name: student.name, id: student.id, ignored: 'x' })), version: 1, ignored: 'x' };
  assert.equal(P.fingerprint(state), P.fingerprint(reordered));
  assert.equal(publish(state).revision, P.parsePublication(P.serializePublication(state, '2026-10-13T10:00:00Z')).revision);
  const before = clone(state);
  P.fingerprint(state);
  P.parsePublication(state);
  P.normalizeDraft(state);
  assert.deepEqual(state, before);
  assert.deepEqual(state.history, []);
});

test('fingerprints detect meaningful roster, status, settings and frozen-history changes', () => {
  const state = S.defaultState();
  S.reconcilePast(state, '2026-11-02');
  const edits = [
    value => { value.students[0].status = 'internship'; },
    value => { value.students[0].status = 'paused'; },
    value => { value.students[0].name = '孔雯（修改）'; },
    value => { [value.students[0], value.students[1]] = [value.students[1], value.students[0]]; },
    value => { value.students.pop(); },
    value => { value.settings.weeks = 16; },
    value => { value.history[0].studentName = '原主讲人'; },
    value => { value.history[0].rosterIds.reverse(); },
    value => { value.settings.startDate = '2026-10-26'; value.history = []; }
  ];
  const revisions = new Set([P.fingerprint(state)]);
  for (const edit of edits) {
    const changed = clone(state);
    edit(changed);
    const revision = P.fingerprint(changed);
    assert.equal(revisions.has(revision), false);
    revisions.add(revision);
  }
  const reorderedHistory = clone(state);
  reorderedHistory.history.reverse();
  assert.equal(P.fingerprint(state), P.fingerprint(reorderedHistory));
});

test('local edits based on the current publication are safe local changes', () => {
  const base = publish(S.defaultState());
  const local = clone(base.state);
  local.students[0].status = 'internship';
  const compared = P.compareDraft(draft(local, base.revision), base);
  assert.equal(compared.status, 'local-changes');
  assert.equal(compared.hasChanges, true);
  assert.equal(compared.baseMatches, true);
  assert.equal(compared.hasLocalChanges, true);
  assert.equal(compared.hasRemoteChanges, false);
  assert.equal(compared.hasConflict, false);
  assert.equal(compared.needsBase, false);
});

test('a remote update does not conflict with an unchanged local copy of its base', () => {
  const base = publish(S.defaultState());
  const remote = clone(base.state);
  remote.students[1].status = 'paused';
  const compared = P.compareDraft(draft(base.state, base.revision), publish(remote));
  assert.equal(compared.status, 'remote-update');
  assert.equal(compared.hasChanges, true);
  assert.equal(compared.hasLocalChanges, false);
  assert.equal(compared.hasRemoteChanges, true);
  assert.equal(compared.hasConflict, false);
  assert.equal(compared.baseMatches, false);
});

test('different local and remote edits from one base report a conflict without modifying either side', () => {
  const base = publish(S.defaultState());
  const local = clone(base.state);
  const remote = clone(base.state);
  local.students[0].status = 'internship';
  remote.students[1].status = 'paused';
  const localRecord = draft(local, base.revision);
  const publication = publish(remote);
  const before = JSON.stringify([localRecord, publication]);
  const compared = P.compareDraft(localRecord, publication);
  assert.equal(compared.status, 'conflict');
  assert.equal(compared.hasConflict, true);
  assert.equal(compared.hasLocalChanges, true);
  assert.equal(compared.hasRemoteChanges, true);
  assert.equal(JSON.stringify([localRecord, publication]), before);
});

test('identical local and published content is synced even when its base revision is old', () => {
  const base = publish(S.defaultState());
  const changed = clone(base.state);
  changed.students[0].status = 'internship';
  const compared = P.compareDraft(draft(changed, base.revision), publish(changed));
  assert.equal(compared.status, 'synced');
  assert.equal(compared.hasChanges, false);
  assert.equal(compared.baseMatches, false);
  assert.equal(compared.hasConflict, false);
  assert.equal(compared.needsBase, false);
  assert.equal(compared.localRevision, compared.publishedRevision);
});

test('supplied publication revision strings cannot disguise remote content changes', () => {
  const base = publish(S.defaultState());
  const remote = clone(base);
  remote.state.students[0].status = 'paused';
  remote.revision = base.revision;
  const compared = P.compareDraft(draft(base.state, base.revision), remote);
  assert.equal(compared.status, 'remote-update');
  assert.notEqual(compared.publishedRevision, base.revision);
});

test('draft records normalize timestamps and survive JSON storage independently of source objects', () => {
  const state = S.defaultState();
  const record = { ...draft(state, P.fingerprint(state)), updatedAt: '2026-10-12T18:00:00+08:00' };
  const normalized = P.normalizeDraft(JSON.stringify(record));
  assert.equal(normalized.updatedAt, TIME);
  assert.deepEqual(P.normalizeDraft(JSON.stringify(normalized)), normalized);
  normalized.state.students[0].name = '独立副本';
  assert.equal(state.students[0].name, '孔雯');
  assert.equal(P.normalizeDraft({ draftVersion: 1, state }).baseRevision, null);
});

test('browser UMD exposes the same API without crypto, network, storage or Node globals', () => {
  const context = { window: { MeetingScheduler: S } };
  vm.runInNewContext(fs.readFileSync(require.resolve('./publication.js'), 'utf8'), context);
  const browser = context.window.MeetingPublication;
  assert.deepEqual(Object.keys(browser), Object.keys(P));
  assert.equal(browser.fingerprint(S.defaultState()), P.fingerprint(S.defaultState()));
  assert.equal(browser.serializePublication(S.defaultState(), TIME), P.serializePublication(S.defaultState(), TIME));
});
