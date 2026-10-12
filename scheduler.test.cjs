'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const scheduler = require('./scheduler.js');
const { defaultState, isMonday, addDays, dateParts, buildSchedule, reconcilePast, validateState } = scheduler;

test('reference dates run every Monday from October 19 through January 25, across the year', () => {
  const rows = buildSchedule(defaultState(), '2026-10-12');
  assert.equal(rows.length, 15);
  assert.equal(rows[0].date, '2026-10-19');
  assert.equal(rows[11].date, '2027-01-04');
  assert.equal(rows[14].date, '2027-01-25');
  assert.ok(rows.every(row => isMonday(row.date)));
  assert.deepEqual(rows.slice(0, 12).map(row => row.studentName), defaultState().students.map(student => student.name));
  assert.equal(rows[12].studentName, rows[0].studentName);
  assert.equal(rows[12].cycle, 2);
  assert.equal(rows[0].isPast, false);
  assert.deepEqual(dateParts('2027-01-04'), { year: 2027, month: 1, day: 4, weekday: 1 });
});

test('calendar arithmetic is stable across DST and rejects impossible dates', () => {
  assert.equal(addDays('2026-10-26', 7), '2026-11-02');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(isMonday('2026-10-20'), false);
  assert.equal(isMonday('2026-02-30'), false);
  assert.throws(() => addDays('2026-02-30', 7));
});

test('internship and paused students are omitted, and active students repeat in roster order', () => {
  const state = defaultState();
  state.students[0].status = 'internship';
  state.students[2].status = 'paused';
  const rows = buildSchedule(state, '2026-10-12');
  assert.equal(rows[0].studentName, '赵政翔');
  assert.equal(rows[1].studentName, '马燕伟');
  assert.ok(rows.every(row => !['孔雯', '李艺芝'].includes(row.studentName)));
  assert.equal(rows[10].studentName, rows[0].studentName);
  assert.equal(rows[10].cycle, 2);
});

test('empty or entirely inactive rosters generate explicit unassigned slots', () => {
  for (const state of [defaultState(), Object.assign(defaultState(), { students: [] })]) {
    state.students.forEach(student => { student.status = 'internship'; });
    const rows = buildSchedule(state, '2026-10-12');
    assert.equal(rows.length, 15);
    assert.ok(rows.every(row => row.studentId === null && row.studentName === ''));
    assert.doesNotThrow(() => validateState(reconcilePast(state, '2026-11-01')));
  }
});

test('history freezes previous weeks but today remains changeable', () => {
  const state = defaultState();
  reconcilePast(state, '2026-11-02');
  assert.equal(state.history.length, 2);
  state.students[0].status = 'internship';
  state.students[2].status = 'paused';
  state.students[1].name = '修改姓名';
  const rows = buildSchedule(state, '2026-11-02');
  assert.equal(rows[0].studentName, '孔雯');
  assert.equal(rows[1].studentName, '赵政翔');
  assert.equal(rows[2].studentName, '马燕伟');
  assert.equal(rows[2].isPast, false);
  assert.equal(rows[0].isPast, true);
  reconcilePast(state, '2026-11-03');
  assert.equal(state.history.length, 3);
  assert.equal(state.history[2].studentName, '马燕伟');
  assert.doesNotThrow(() => validateState(state));
});

test('deleting the last historical speaker resumes at the surviving successor', () => {
  const state = defaultState();
  reconcilePast(state, '2026-11-02');
  state.students = state.students.filter(student => !['student-1', 'student-2'].includes(student.id));
  const rows = buildSchedule(state, '2026-11-02');
  assert.equal(rows[0].studentName, '孔雯');
  assert.equal(rows[1].studentName, '赵政翔');
  assert.equal(rows[2].studentName, '李艺芝');
  assert.equal(rows[11].studentName, '宋佳奕');
  assert.equal(rows[12].studentName, '李艺芝');
  assert.equal(rows[12].cycle, 2);
  assert.doesNotThrow(() => validateState(state));
});

test('a paused previous speaker remains a rotation anchor and a restored student returns in order', () => {
  const state = defaultState();
  reconcilePast(state, '2026-11-02');
  state.students[1].status = 'paused';
  assert.equal(buildSchedule(state, '2026-11-02')[2].studentName, '李艺芝');
  state.students[2].status = 'internship';
  assert.equal(buildSchedule(state, '2026-11-02')[2].studentName, '马燕伟');
  state.students[2].status = 'active';
  assert.equal(buildSchedule(state, '2026-11-02')[2].studentName, '李艺芝');
});

test('history without an old roster snapshot still has a deterministic fallback', () => {
  const state = defaultState();
  reconcilePast(state, '2026-11-02');
  state.history.forEach(row => { delete row.rosterIds; });
  state.students = [{ id: 'new-a', name: '新同学甲', status: 'active' }, { id: 'new-b', name: '新同学乙', status: 'active' }];
  assert.equal(buildSchedule(state, '2026-11-02')[2].studentName, '新同学甲');
  assert.equal(buildSchedule(state, '2026-11-02')[3].studentName, '新同学乙');
  assert.doesNotThrow(() => validateState(state));
});

test('completed rows survive a shorter display horizon and later extension', () => {
  const state = defaultState();
  reconcilePast(state, '2026-11-17');
  state.settings.weeks = 2;
  reconcilePast(state, '2026-11-17');
  assert.equal(state.history.length, 5);
  assert.doesNotThrow(() => validateState(state));
  state.settings.weeks = 15;
  assert.equal(buildSchedule(state, '2026-11-17')[5].studentName, '石子豪');
});

test('validation rejects malformed, excessive, duplicate and inconsistent imported data', () => {
  const edits = [
    state => { state.version = 2; },
    state => { state.students[0].status = 'unknown'; },
    state => { state.students[0].name = ' '; },
    state => { state.students[0].name = '字'.repeat(31); },
    state => { state.students[0].name = '姓名\n'; },
    state => { state.students[1].id = state.students[0].id; },
    state => { state.students[0].id = '<script>'; },
    state => { state.students = Array.from({ length: 201 }, (_, n) => ({ id: 's' + n, name: '甲', status: 'active' })); },
    state => { state.settings.startDate = '2026-10-20'; },
    state => { state.settings.startDate = '2026-02-30'; },
    state => { state.settings.weeks = 0; },
    state => { state.settings.weeks = 105; },
    state => { state.settings.weeks = 1.5; },
    state => { reconcilePast(state, '2026-11-02'); state.history[0].index = 2; },
    state => { reconcilePast(state, '2026-11-02'); state.history[0].cycle = 0; },
    state => { reconcilePast(state, '2026-11-02'); state.history.push(state.history[0]); },
    state => { reconcilePast(state, '2026-11-02'); state.history.shift(); },
    state => { reconcilePast(state, '2026-11-02'); state.history[0].rosterIds = []; }
  ];
  for (const edit of edits) {
    const state = defaultState();
    edit(state);
    assert.throws(() => validateState(state));
  }
  assert.throws(() => validateState(null));
  assert.throws(() => validateState([]));
});

test('validated state is an independent clone with unknown properties removed', () => {
  const state = defaultState();
  state.extra = 'discard';
  state.students[0].extra = 'discard';
  reconcilePast(state, '2026-11-02');
  const checked = validateState(state);
  assert.equal(checked.extra, undefined);
  assert.equal(checked.students[0].extra, undefined);
  checked.students[0].name = '独立副本';
  checked.history[0].rosterIds.pop();
  assert.equal(state.students[0].name, '孔雯');
  assert.equal(state.history[0].rosterIds.length, 12);
});
