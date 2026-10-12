(function () {
  'use strict';
  const S = window.MeetingScheduler;
  const STORAGE_KEY = 'monday-lab-schedule-v1';
  const THEME_KEY = 'monday-lab-theme';
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const labels = { active: '在校', internship: '实习', paused: '暂停' };
  const views = {
    overview: ['组会排班', '把时间留给讨论，把排期交给这里。', '排期总览'],
    students: ['轮值同学', '管理名单与状态，让每一次轮值都安排得当。', '学生管理'],
    settings: ['排期设置', '设定开始日期，余下的按顺序进行。', '排期设置']
  };
  let state, currentView = 'overview', monthFilter = 'all', studentFilter = 'all', search = '';
  let editingId = null, confirmation = null, undoState = null, toastTimer = null, printing = false;
  const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const pad = (value) => String(value).padStart(2, '0');
  const shortDate = (date) => { const d = S.dateParts(date); return `${d.month}月${d.day}日`; };
  const fullDate = (date) => { const d = S.dateParts(date); return `${d.year}年${d.month}月${d.day}日`; };
  const avatar = (name, index = 0) => `<span class="avatar avatar-${index % 4}" aria-hidden="true">${esc(Array.from(name)[0] || '待')}</span>`;
  function warning(message) {
    $('#storage-warning').textContent = message;
    $('#storage-warning').hidden = false;
    $('#save-status').textContent = '请留意数据提示';
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      state = raw ? S.validateState(JSON.parse(raw)) : S.defaultState();
      S.reconcilePast(state);
    } catch (error) {
      state = S.defaultState();
      warning('未能读取本机数据，当前显示初始名单。可在排期设置中导入备份；新的修改会覆盖本机记录。');
    }
  }
  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      $('#save-status').textContent = '已保存到本机';
      $('#storage-warning').hidden = true;
    } catch (error) {
      warning('浏览器未能保存本次修改。请通过“导出排期 → 备份全部数据”下载备份，避免关闭页面后丢失。');
    }
  }
  function toast(message, canUndo = false) {
    clearTimeout(toastTimer);
    $('#toast').innerHTML = `<span>${esc(message)}</span>${canUndo ? '<button id="undo-action">撤销</button>' : ''}`;
    $('#toast').hidden = false;
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, canUndo ? 9000 : 4500);
  }
  function commit(mutator, message, canUndo = true) {
    const before = clone(state);
    const draft = clone(state);
    S.reconcilePast(draft);
    mutator(draft);
    state = S.validateState(draft);
    undoState = canUndo ? before : null;
    persist();
    render();
    toast(message, canUndo);
  }
  function switchView(view) {
    currentView = Object.prototype.hasOwnProperty.call(views, view) ? view : 'overview';
    if (location.hash !== '#' + currentView) history.replaceState(null, '', '#' + currentView);
    $$('.view').forEach((el) => { el.hidden = el.id !== currentView + '-view'; });
    $$('.navigation [data-view]').forEach((el) => {
      el.classList.toggle('active', el.dataset.view === currentView);
      if (el.dataset.view === currentView) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
    $('#page-title').textContent = views[currentView][0];
    $('#page-description').textContent = views[currentView][1];
    $('#breadcrumb-current').textContent = views[currentView][2];
    $('#page-kicker').textContent = currentView === 'overview' ? '每周一 / 一人主讲' : '课题组 / 每周一见';
    render();
    window.scrollTo(0, 0);
  }
  function renderSummary(schedule) {
    const next = schedule.find((r) => !r.isPast);
    const activeCount = state.students.filter((s) => s.status === 'active').length;
    const internshipCount = state.students.filter((s) => s.status === 'internship').length;
    const pausedCount = state.students.filter((s) => s.status === 'paused').length;
    let content;
    if (next) {
      const d = S.dateParts(next.date);
      const days = Math.round((Date.parse(next.date + 'T00:00:00Z') - Date.parse(S.todayISO() + 'T00:00:00Z')) / 86400000);
      content = `<div class="next-copy"><span class="eyebrow">下一次组会</span><h2 class="speaker-name">${esc(next.studentName || '等待安排')}<small>${next.studentId ? '主讲' : ''}</small></h2><p class="next-date">${fullDate(next.date)}，星期一</p></div><div class="next-date-display" aria-hidden="true"><strong>${pad(d.day)}</strong><span>${pad(d.month)} / ${d.year}</span></div><div class="next-bottom"><span class="next-tag">${next.studentId ? `第 ${pad(next.index + 1)} 次组会` : '添加或恢复一位在校同学即可排期'}</span><span class="countdown">${days === 0 ? '就在今天' : `还有 ${days} 天`} <span aria-hidden="true">↗</span></span></div>`;
    } else {
      content = '<div class="next-copy"><span class="eyebrow">本期日程已结束</span><h2 class="speaker-name">下一次分享，待续</h2><p class="next-date">在排期设置中增加周数，继续安排组会。</p></div><div class="next-bottom"><button class="text-button" data-view="settings">延长排期 ↗</button></div>';
    }
    $('#summary').innerHTML = `<article class="next-meeting">${content}</article><div class="summary-stats"><div class="metric"><span class="metric-label">参与轮值</span><strong class="metric-number">${pad(activeCount)}<small>位同学</small></strong><p>每人一次，循环排会</p></div><div class="metric"><span class="metric-label">暂不参与</span><strong class="metric-number">${pad(internshipCount + pausedCount)}<small>位同学</small></strong><p>实习 ${internshipCount} 人<span class="metric-separator">/</span>暂停 ${pausedCount} 人</p></div></div>`;
  }
  function renderSchedule(schedule) {
    const months = [...new Set(schedule.map((r) => r.date.slice(0, 7)))];
    if (!months.includes(monthFilter)) monthFilter = 'all';
    $('#month-filters').innerHTML = `<button class="filter-button ${monthFilter === 'all' ? 'selected' : ''}" data-month="all" aria-pressed="${monthFilter === 'all'}">全部日程</button>` + months.map((m) => `<button class="filter-button ${monthFilter === m ? 'selected' : ''}" data-month="${m}" aria-pressed="${monthFilter === m}">${Number(m.slice(5))}月${m.slice(0, 4) !== state.settings.startDate.slice(0, 4) ? `<small>${m.slice(0, 4)}</small>` : ''}</button>`).join('');
    const visible = printing || monthFilter === 'all' ? schedule : schedule.filter((r) => r.date.startsWith(monthFilter));
    const next = schedule.find((r) => !r.isPast);
    let prevYear = null;
    $('#schedule-rows').innerHTML = visible.map((row) => {
      const d = S.dateParts(row.date);
      const isNext = row === next;
      const index = Math.max(0, state.students.findIndex((s) => s.id === row.studentId));
      let year = '';
      if (prevYear !== null && prevYear !== d.year) year = `<tr class="year-separator"><td colspan="4">${d.year} 年</td></tr>`;
      prevYear = d.year;
      const badge = row.isPast ? ['past', '已过去'] : !row.studentId ? ['unassigned', '待安排'] : isNext ? ['next', '下一场'] : ['pending', '已排期'];
      return `${year}<tr class="${isNext ? 'is-next' : ''} ${row.isPast ? 'is-past' : ''}"><td><div class="date-cell"><span class="date-day">${pad(d.month)}<span class="date-dot">.</span>${pad(d.day)}</span><span class="date-week">星期一</span><span class="sr-only">${d.year}年</span></div></td><td><div class="speaker-cell">${avatar(row.studentName, index)}<strong>${esc(row.studentName || '暂无主讲')}</strong></div></td><td class="cycle-column"><span class="cycle-label">第 ${pad(row.cycle)} 轮</span></td><td><span class="badge ${badge[0]}">${badge[1]}</span></td></tr>`;
    }).join('');
    $('#schedule-count').textContent = `${state.settings.weeks} 场`;
    $('#schedule-footer').innerHTML = `<span>共 ${schedule.length} 场组会${visible.length !== schedule.length ? `，当前显示 ${visible.length} 场` : ''}</span><span>每周一，自动轮值 <span aria-hidden="true">↻</span></span>`;
  }
  function renderRoster() {
    $('#roster-list').innerHTML = state.students.length ? state.students.map((s, i) => `<button class="roster-row ${s.status !== 'active' ? 'is-inactive' : ''}" data-edit="${esc(s.id)}" aria-label="编辑${esc(s.name)}，${labels[s.status]}"><span class="roster-order">${pad(i + 1)}</span>${avatar(s.name, i)}<span class="roster-name">${esc(s.name)}</span><span class="roster-status ${s.status}">${labels[s.status]}</span><span class="row-chevron" aria-hidden="true">›</span></button>`).join('') : '<div class="empty-state"><strong>还没有轮值同学</strong><p>添加第一位同学，开始安排组会。</p><button class="button secondary" data-add>添加学生</button></div>';
  }
  function renderStudents(schedule) {
    $('#student-filters').innerHTML = ['all', 'active', 'internship', 'paused'].map((status) => `<button data-filter="${status}" class="filter-button ${studentFilter === status ? 'selected' : ''}" aria-pressed="${studentFilter === status}">${status === 'all' ? '全部' : labels[status]} <span>${state.students.filter((s) => status === 'all' || s.status === status).length}</span></button>`).join('');
    const filtered = state.students.filter((s) => (studentFilter === 'all' || s.status === studentFilter) && s.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    $('#student-rows').innerHTML = filtered.map((s) => {
      const i = state.students.findIndex((item) => item.id === s.id);
      const next = schedule.find((r) => !r.isPast && r.studentId === s.id);
      return `<tr><td><div class="order-controls"><span>${pad(i + 1)}</span><button class="icon-button" data-move="${esc(s.id)}" data-direction="-1" ${i === 0 ? 'disabled' : ''} aria-label="将${esc(s.name)}前移一位">↑</button><button class="icon-button" data-move="${esc(s.id)}" data-direction="1" ${i === state.students.length - 1 ? 'disabled' : ''} aria-label="将${esc(s.name)}后移一位">↓</button></div></td><td><div class="student-person">${avatar(s.name, i)}<strong>${esc(s.name)}</strong></div></td><td><select class="status-select ${s.status}" data-status="${esc(s.id)}" aria-label="${esc(s.name)}的排会状态">${Object.entries(labels).map(([key, label]) => `<option value="${key}" ${s.status === key ? 'selected' : ''}>${label}</option>`).join('')}</select></td><td><span class="next-student-date">${next ? `${shortDate(next.date)}<small>${next.date.slice(0, 4)}</small>` : s.status === 'active' ? '本期暂无安排' : '暂不参与'}</span></td><td><div class="row-actions"><button class="text-button" data-edit="${esc(s.id)}">编辑</button><button class="text-button danger-subtle" data-delete="${esc(s.id)}" aria-label="删除${esc(s.name)}">删除</button></div></td></tr>`;
    }).join('');
    $('#students-empty').hidden = filtered.length > 0;
    if (!filtered.length) $('#students-empty').innerHTML = state.students.length ? '<strong>没有找到符合条件的同学</strong><p>试试其他姓名或状态。</p>' : '<strong>添加第一位同学</strong><p>名单就绪后，组会日期会自动生成。</p><button class="button primary" data-add>添加学生</button>';
  }
  function render() {
    const schedule = S.buildSchedule(state);
    $('#nav-count').textContent = state.students.length;
    renderSummary(schedule);
    renderSchedule(schedule);
    renderRoster();
    renderStudents(schedule);
    $('#start-date').value = state.settings.startDate;
    $('#week-count').value = state.settings.weeks;
    $('#range-footer').textContent = `${fullDate(state.settings.startDate)} 至 ${fullDate(schedule[schedule.length - 1].date)}`;
  }
  function openStudent(id = null) {
    editingId = id;
    const student = state.students.find((s) => s.id === id);
    $('#student-form').reset();
    $('#student-name').value = student ? student.name : '';
    $(`#student-form input[value="${student ? student.status : 'active'}"]`).checked = true;
    $('#student-dialog-title').textContent = student ? '编辑学生' : '添加学生';
    $('#save-student').textContent = student ? '保存修改' : '添加学生';
    $('#delete-student').hidden = !student;
    $('#student-error').textContent = '';
    $('#student-dialog-hint').textContent = student ? '状态调整会自动更新未来排期，过去的记录保持不变。' : '新同学会加入名单末尾，参与后续轮值。';
    $('#student-dialog').showModal();
    $('#student-name').focus();
  }
  function confirm(title, description, actionText, action) {
    $('#confirm-title').textContent = title;
    $('#confirm-description').textContent = description;
    $('#confirm-action').textContent = actionText;
    confirmation = action;
    $('#confirm-dialog').showModal();
  }
  function deleteStudent(id) {
    const student = state.students.find((s) => s.id === id);
    if (!student) return;
    $('#student-dialog').close();
    confirm(`删除${student.name}？`, '这位同学将从轮值名单中移除，未来排期会自动顺延。过去的组会记录会保留。', '确认删除', () => {
      commit((draft) => { draft.students = draft.students.filter((s) => s.id !== id); }, `已删除${student.name}，排期已更新`);
    });
  }
  function download(data, filename, type) {
    const blob = new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportData(format) {
    $('#export-menu').hidden = true;
    $('#export-toggle').setAttribute('aria-expanded', 'false');
    const schedule = S.buildSchedule(state);
    if (format === 'json') {
      const backup = clone(state);
      S.reconcilePast(backup);
      download(JSON.stringify(backup, null, 2), `组会排班备份-${S.todayISO()}.json`, 'application/json');
      toast('已导出名单、设置与历史记录');
    } else if (format === 'csv') {
      const csvCell = (value) => '"' + String(value).replace(/^[=+@-]/, "'$&").replace(/"/g, '""') + '"';
      const rows = [['日期', '星期', '主讲同学', '轮次', '安排'], ...schedule.map((r) => [r.date, '星期一', r.studentName || '待安排', r.cycle, r.isPast ? '已过去' : r.studentId ? '已排期' : '待安排'])];
      download('\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'), `组会排期-${state.settings.startDate}.csv`, 'text/csv;charset=utf-8');
      toast('已导出完整排期，可用 Excel 打开');
    } else if (format === 'print') {
      printing = true;
      document.body.classList.add('printing');
      $('#page-title').textContent = views.overview[0];
      $('#page-description').textContent = views.overview[1];
      renderSchedule(schedule);
      window.print();
    }
  }
  function updateThemeLabel() {
    const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    $('#theme-toggle').textContent = dark ? '切换浅色外观' : '切换深色外观';
  }
  try {
    const theme = localStorage.getItem(THEME_KEY);
    if (['light', 'dark'].includes(theme)) document.documentElement.dataset.theme = theme;
  } catch (_) { /* Theme storage is optional. */ }
  updateThemeLabel();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeLabel);
  $('#theme-toggle').addEventListener('click', () => {
    const dark = $('#theme-toggle').textContent.includes('浅色');
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, document.documentElement.dataset.theme); } catch (_) { /* Session theme still works. */ }
    updateThemeLabel();
  });
  document.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (target) {
      if (target.dataset.view) { switchView(target.dataset.view); $('#main').focus(); }
      if (target.hasAttribute('data-add')) openStudent();
      if (target.dataset.edit) openStudent(target.dataset.edit);
      if (target.dataset.delete) deleteStudent(target.dataset.delete);
      if (target.dataset.close) $('#' + target.dataset.close).close();
      if (target.dataset.month) { monthFilter = target.dataset.month; renderSchedule(S.buildSchedule(state)); }
      if (target.dataset.filter) { studentFilter = target.dataset.filter; renderStudents(S.buildSchedule(state)); }
      if (target.dataset.export) exportData(target.dataset.export);
      if (target.dataset.move) {
        const id = target.dataset.move;
        const delta = Number(target.dataset.direction);
        commit((draft) => {
          const i = draft.students.findIndex((s) => s.id === id);
          const destination = i + delta;
          if (i >= 0 && destination >= 0 && destination < draft.students.length) [draft.students[i], draft.students[destination]] = [draft.students[destination], draft.students[i]];
        }, '轮值顺序已调整');
      }
      if (target.id === 'undo-action' && undoState) {
        state = undoState;
        undoState = null;
        persist(); render(); toast('已撤销上一次修改');
      }
    }
    if (!event.target.closest('.export-wrap')) {
      $('#export-menu').hidden = true;
      $('#export-toggle').setAttribute('aria-expanded', 'false');
    }
  });
  $('#export-toggle').addEventListener('click', () => {
    $('#export-menu').hidden = !$('#export-menu').hidden;
    $('#export-toggle').setAttribute('aria-expanded', String(!$('#export-menu').hidden));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      $('#export-menu').hidden = true;
      $('#export-toggle').setAttribute('aria-expanded', 'false');
    }
  });
  $('#student-search').addEventListener('input', (event) => { search = event.target.value.trim(); renderStudents(S.buildSchedule(state)); });
  $('#student-rows').addEventListener('change', (event) => {
    if (!event.target.dataset.status) return;
    const id = event.target.dataset.status;
    const status = event.target.value;
    const student = state.students.find((s) => s.id === id);
    if (student && labels[status]) commit((draft) => { draft.students.find((s) => s.id === id).status = status; }, `${student.name}已设为${labels[status]}，未来排期已更新`);
  });
  $('#student-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = $('#student-name').value.trim();
    const status = $('#student-form input[name="status"]:checked').value;
    if (!name) { $('#student-error').textContent = '请输入学生姓名。'; return; }
    if (state.students.some((s) => s.name === name && s.id !== editingId)) { $('#student-error').textContent = '名单中已存在这个姓名，可加上年级或编号区分。'; return; }
    if (!editingId && state.students.length >= 200) { $('#student-error').textContent = '名单最多支持 200 位同学。'; return; }
    if (editingId && !state.students.some((s) => s.id === editingId)) { $('#student-error').textContent = '这位同学已在其他页面被删除，请关闭后重新添加。'; return; }
    try {
      commit((draft) => {
        if (editingId) Object.assign(draft.students.find((s) => s.id === editingId), { name, status });
        else draft.students.push({ id: 'student-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)), name, status });
      }, editingId ? '学生信息已更新，未来排期已调整' : `已添加${name}，排期已更新`);
      $('#student-dialog').close();
    } catch (error) { $('#student-error').textContent = error.message; }
  });
  $('#delete-student').addEventListener('click', () => deleteStudent(editingId));
  $('#confirm-action').addEventListener('click', () => {
    const action = confirmation;
    confirmation = null;
    $('#confirm-dialog').close();
    if (action) action();
  });
  $('#settings-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const startDate = $('#start-date').value;
    const weeks = Number($('#week-count').value);
    $('#settings-error').textContent = '';
    if (!S.isMonday(startDate)) { $('#settings-error').textContent = '组会安排在周一，请选择一个星期一。'; return; }
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 104) { $('#settings-error').textContent = '请输入 1 至 104 之间的整数。'; return; }
    const changedStart = startDate !== state.settings.startDate;
    const apply = () => commit((draft) => {
      draft.settings = { startDate, weeks };
      if (changedStart) draft.history = [];
    }, '排期设置已保存');
    const prior = S.buildSchedule(state).some((r) => r.isPast);
    if (changedStart && prior) confirm('重新开始一份排期？', '更改首场日期会清除当前历史记录，并按现有名单重新排期。建议先导出备份。', '重新排期', apply);
    else apply();
  });
  $('#import-button').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('备份文件过大，请选择小于 2 MB 的 JSON 文件。');
      const imported = S.validateState(JSON.parse(await file.text()));
      confirm('导入这份备份？', `将用备份中的 ${imported.students.length} 位学生和 ${imported.settings.weeks} 周排期替换当前数据。导入后可以立即撤销。`, '确认导入', () => {
        undoState = clone(state);
        state = imported;
        S.reconcilePast(state);
        persist(); render(); toast('备份已导入', true);
      });
    } catch (error) { toast(error instanceof SyntaxError ? '文件不是有效的 JSON 备份，请重新选择。' : error.message); }
  });
  window.addEventListener('afterprint', () => {
    printing = false;
    document.body.classList.remove('printing');
    $('#page-title').textContent = views[currentView][0];
    $('#page-description').textContent = views[currentView][1];
    renderSchedule(S.buildSchedule(state));
  });
  window.addEventListener('hashchange', () => switchView(location.hash.slice(1)));
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const incoming = S.validateState(JSON.parse(event.newValue));
      const previousStudent = state.students.find((s) => s.id === editingId);
      const incomingStudent = incoming.students.find((s) => s.id === editingId);
      const editorConflict = $('#student-dialog').open && editingId && JSON.stringify(previousStudent) !== JSON.stringify(incomingStudent);
      state = incoming;
      undoState = null;
      if (editorConflict) $('#student-dialog').close();
      render(); toast(editorConflict ? '这位同学已在另一标签页被修改，请重新打开编辑。' : '已载入另一标签页保存的修改');
    } catch (_) { warning('另一标签页的数据格式无效，已保留当前页面内容。'); }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { S.reconcilePast(state); render(); }
  });
  load();
  switchView(location.hash.slice(1) || 'overview');
})();
