(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MeetingScheduler = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const DAY = 86400000;
  const STATUSES = ['active', 'internship', 'paused'];
  const NAMES = ['孔雯', '赵政翔', '李艺芝', '马燕伟', '唐畅', '石子豪', '邓晓宇', '马瑞佳', '张壮', '刘慧', '构润哲', '宋佳奕'];

  function fail(message) { throw new Error(message); }
  function plainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  function timestamp(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) fail('日期格式应为 YYYY-MM-DD。');
    const value = Date.parse(iso + 'T00:00:00Z');
    if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== iso || iso < '1900-01-01' || iso > '2199-12-31') {
      fail('日期无效，请使用 1900 至 2199 年间的真实日期。');
    }
    return value;
  }
  function todayISO() {
    const now = new Date();
    return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  }
  function dateParts(iso) {
    const value = new Date(timestamp(iso));
    return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate(), weekday: value.getUTCDay() };
  }
  function isMonday(iso) {
    try { return dateParts(iso).weekday === 1; } catch (_) { return false; }
  }
  function addDays(iso, days) {
    if (!Number.isInteger(days)) fail('日期偏移必须是整数。');
    const result = new Date(timestamp(iso) + days * DAY).toISOString().slice(0, 10);
    timestamp(result);
    return result;
  }
  function defaultState() {
    return {
      version: 1,
      students: NAMES.map(function (name, index) { return { id: 'student-' + (index + 1), name: name, status: 'active' }; }),
      settings: { startDate: '2026-10-19', weeks: 15 },
      history: []
    };
  }
  function validId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
  }
  function cleanName(value) {
    if (typeof value !== 'string') fail('同学姓名必须是文字。');
    const name = value.trim();
    if (!name || Array.from(name).length > 30 || /[\u0000-\u001f\u007f]/.test(value)) fail('同学姓名需为 1 至 30 个字符，且不能包含控制字符。');
    return name;
  }

  // Return a fresh, whitelisted object. Never merge imported properties into app objects.
  function validateState(value) {
    if (!plainObject(value) || value.version !== 1) fail('不支持的备份格式或版本。');
    if (!Array.isArray(value.students) || value.students.length > 200) fail('同学名单格式无效，最多支持 200 人。');
    if (!plainObject(value.settings) || !isMonday(value.settings.startDate)) fail('排期开始日期必须是有效的周一。');
    const weeks = value.settings.weeks;
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 104) fail('排期周数应为 1 至 104 的整数。');
    addDays(value.settings.startDate, (weeks - 1) * 7);
    const seen = new Set();
    const students = value.students.map(function (student) {
      if (!plainObject(student) || !validId(student.id) || seen.has(student.id)) fail('名单中的同学标识无效或重复。');
      if (!STATUSES.includes(student.status)) fail('同学状态只能是在校、实习或暂停。');
      seen.add(student.id);
      return { id: student.id, name: cleanName(student.name), status: student.status };
    });
    if (!Array.isArray(value.history) || value.history.length > 104) fail('已完成排期格式无效。');
    const historyDates = new Set();
    const history = value.history.map(function (row) {
      if (!plainObject(row) || !isMonday(row.date) || historyDates.has(row.date)) fail('已完成排期含有无效或重复的日期。');
      const offset = (timestamp(row.date) - timestamp(value.settings.startDate)) / (DAY * 7);
      if (!Number.isInteger(offset) || offset < 0 || offset > 103 || row.index !== offset) fail('已完成排期的日期或序号与起始日期不一致。');
      if (!Number.isInteger(row.cycle) || row.cycle < 1 || row.cycle > 104) fail('已完成排期的轮次无效。');
      if (row.studentId !== null && !validId(row.studentId)) fail('已完成排期的同学标识无效。');
      if (row.studentId === null && row.studentName !== '') fail('未安排的排期不能包含主讲人。');
      const clean = { date: row.date, studentId: row.studentId, studentName: row.studentId === null ? '' : cleanName(row.studentName), index: offset, cycle: row.cycle, isPast: true };
      if (row.rosterIds !== undefined) {
        if (!Array.isArray(row.rosterIds) || row.rosterIds.length > 200 || !row.rosterIds.every(validId) || new Set(row.rosterIds).size !== row.rosterIds.length) {
          fail('已完成排期中的历史名单无效。');
        }
        if (row.studentId !== null && !row.rosterIds.includes(row.studentId)) fail('历史主讲人不在对应的历史名单中。');
        clean.rosterIds = row.rosterIds.slice();
      }
      historyDates.add(row.date);
      return clean;
    }).sort(function (a, b) { return a.date.localeCompare(b.date); });
    history.forEach(function (row, index) {
      if (row.index !== index) fail('已完成排期必须从起始日期连续记录。');
    });
    return { version: 1, students: students, settings: { startDate: value.settings.startDate, weeks: weeks }, history: history };
  }

  // Prefer the current roster position. The saved roster order also provides a
  // stable successor when a previous speaker has since been deleted.
  function cursorAfter(anchor, students, active) {
    if (!anchor) return { position: 0, cycle: 1 };
    let order = students.map(function (student) { return student.id; });
    let previous = order.indexOf(anchor.studentId);
    if (previous < 0) {
      order = anchor.rosterIds || [];
      previous = order.indexOf(anchor.studentId);
    }
    if (previous >= 0) {
      for (let step = 1; step <= order.length; step += 1) {
        const next = (previous + step) % order.length;
        const position = active.findIndex(function (student) { return student.id === order[next]; });
        if (position >= 0) return { position: position, cycle: anchor.cycle + (next <= previous ? 1 : 0) };
      }
    }
    const position = (anchor.index + 1) % active.length;
    return { position: position, cycle: anchor.cycle + (position === 0 ? 1 : 0) };
  }
  function publicRow(row, index, today) {
    return { date: row.date, studentId: row.studentId, studentName: row.studentName, index: index, cycle: row.cycle, isPast: row.date < today };
  }
  function buildSchedule(state, today) {
    today = today || todayISO();
    timestamp(today);
    const active = state.students.filter(function (student) { return student.status === 'active'; });
    const past = new Map(state.history.filter(function (row) { return row.date < today; }).map(function (row) { return [row.date, row]; }));
    const result = [];
    let anchor = null;
    let cursor = null;
    for (let index = 0; index < state.settings.weeks; index += 1) {
      const date = addDays(state.settings.startDate, index * 7);
      const frozen = past.get(date);
      if (frozen) {
        result.push(publicRow(frozen, index, today));
        if (frozen.studentId !== null) anchor = frozen;
        cursor = null;
        continue;
      }
      if (!active.length) {
        result.push({ date: date, studentId: null, studentName: '', index: index, cycle: anchor ? anchor.cycle : 1, isPast: date < today });
        continue;
      }
      if (!cursor) cursor = cursorAfter(anchor, state.students, active);
      const student = active[cursor.position];
      result.push({ date: date, studentId: student.id, studentName: student.name, index: index, cycle: cursor.cycle, isPast: date < today });
      cursor.position = (cursor.position + 1) % active.length;
      if (cursor.position === 0) cursor.cycle += 1;
    }
    return result;
  }
  function reconcilePast(state, today) {
    today = today || todayISO();
    timestamp(today);
    const existing = new Map(state.history.filter(function (row) { return row.date < today; }).map(function (row) { return [row.date, row]; }));
    const rosterIds = state.students.map(function (student) { return student.id; });
    buildSchedule(state, today).forEach(function (row) {
      if (row.isPast && !existing.has(row.date)) existing.set(row.date, Object.assign({}, row, { rosterIds: rosterIds.slice() }));
    });
    state.history = Array.from(existing.values()).sort(function (a, b) { return a.date.localeCompare(b.date); });
    return state;
  }

  return { defaultState: defaultState, todayISO: todayISO, isMonday: isMonday, addDays: addDays, buildSchedule: buildSchedule, reconcilePast: reconcilePast, validateState: validateState, dateParts: dateParts };
});
