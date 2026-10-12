(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./scheduler.js'));
  else if (root) root.MeetingPublication = factory(root.MeetingScheduler);
})(typeof window !== 'undefined' ? window : null, function (Scheduler) {
  'use strict';

  if (!Scheduler || typeof Scheduler.validateState !== 'function') throw new Error('请先加载排期模块 scheduler.js。');
  const REVISION = /^state-v1-[0-9a-f]{16}$/;
  const own = function (value, key) { return Object.prototype.hasOwnProperty.call(value, key); };
  const object = function (value) { return value !== null && typeof value === 'object' && !Array.isArray(value); };

  function read(value) {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!object(parsed)) throw new Error('排期文档必须是 JSON 对象。');
    return parsed;
  }

  // Require an explicit timezone and a real calendar date. Date.parse alone
  // silently rolls dates such as February 30 into the following month.
  function normalizeTime(value) {
    const match = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) throw new Error('时间必须是带时区的 ISO 日期时间。');
    Scheduler.dateParts(match[1]);
    if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) throw new Error('时间中的时、分或秒无效。');
    if (match[6] !== 'Z' && (Number(match[6].slice(1, 3)) > 23 || Number(match[6].slice(4, 6)) > 59)) throw new Error('时间中的时区偏移无效。');
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) throw new Error('时间无效。');
    const result = new Date(parsed).toISOString();
    Scheduler.dateParts(result.slice(0, 10));
    return result;
  }

  // validateState builds objects in a fixed property order, strips unknown
  // fields, and sorts history by date while preserving meaningful roster order.
  // This is a content-change marker, not a security or authenticity signature.
  function fingerprintClean(state) {
    const content = JSON.stringify(state);
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < content.length; index += 1) {
      const code = content.charCodeAt(index);
      first = Math.imul(first ^ code, 0x01000193);
      second = Math.imul(second ^ code, 0x85ebca6b);
      second ^= second >>> 13;
    }
    const hex = function (value) { return (value >>> 0).toString(16).padStart(8, '0'); };
    return 'state-v1-' + hex(first) + hex(second);
  }
  function fingerprint(state) {
    return fingerprintClean(Scheduler.validateState(state));
  }

  // Legacy bare states receive a null publishedAt. Envelope timestamps are
  // required; callers decide when a publication happens and supply the time.
  function parsePublication(value) {
    const document = read(value);
    let state;
    let publishedAt = null;
    if (own(document, 'schemaVersion')) {
      if (document.schemaVersion !== 1) throw new Error('不支持的发布文档版本。');
      if (!own(document, 'state') || !own(document, 'publishedAt')) throw new Error('发布文档缺少排期或发布时间。');
      publishedAt = normalizeTime(document.publishedAt);
      state = Scheduler.validateState(document.state);
    } else {
      state = Scheduler.validateState(document);
    }
    return { schemaVersion: 1, publishedAt: publishedAt, state: state, revision: fingerprintClean(state) };
  }
  function serializePublication(state, publishedAt) {
    const document = { schemaVersion: 1, publishedAt: normalizeTime(publishedAt), state: Scheduler.validateState(state) };
    return JSON.stringify(document, null, 2) + '\n';
  }

  // A missing base is deliberately preserved as null: an old local draft must
  // never silently claim it was based on the newly fetched publication.
  function normalizeDraft(value) {
    const record = read(value);
    if (!own(record, 'draftVersion')) {
      return { draftVersion: 1, state: Scheduler.validateState(record), baseRevision: null, updatedAt: null };
    }
    if (record.draftVersion !== 1 || !own(record, 'state')) throw new Error('不支持的本地草稿格式或版本。');
    const baseRevision = record.baseRevision === undefined ? null : record.baseRevision;
    if (baseRevision !== null && (typeof baseRevision !== 'string' || !REVISION.test(baseRevision))) throw new Error('草稿的基础版本标识无效。');
    const updatedAt = record.updatedAt === undefined || record.updatedAt === null ? null : normalizeTime(record.updatedAt);
    return { draftVersion: 1, state: Scheduler.validateState(record.state), baseRevision: baseRevision, updatedAt: updatedAt };
  }

  function compareDraft(draftValue, publicationValue) {
    const draft = normalizeDraft(draftValue);
    // Also accept parsePublication's normalized legacy result (null timestamp).
    // Recompute revisions from validated content; never trust supplied hashes.
    const publication = object(publicationValue) && publicationValue.schemaVersion === 1 && publicationValue.publishedAt === null && own(publicationValue, 'revision')
      ? parsePublication(publicationValue.state)
      : parsePublication(publicationValue);
    const localRevision = fingerprintClean(draft.state);
    const publishedRevision = publication.revision;
    const hasChanges = localRevision !== publishedRevision;
    const baseMatches = draft.baseRevision === publishedRevision;
    const needsBase = hasChanges && draft.baseRevision === null;
    const hasLocalChanges = draft.baseRevision === null ? hasChanges : localRevision !== draft.baseRevision;
    const hasRemoteChanges = draft.baseRevision !== null && !baseMatches;
    const hasConflict = hasChanges && hasLocalChanges && hasRemoteChanges;
    const status = !hasChanges ? 'synced' : needsBase ? 'unbased' : hasConflict ? 'conflict' : hasRemoteChanges ? 'remote-update' : 'local-changes';
    return {
      hasChanges: hasChanges,
      baseMatches: baseMatches,
      hasConflict: hasConflict,
      needsBase: needsBase,
      localRevision: localRevision,
      publishedRevision: publishedRevision,
      hasLocalChanges: hasLocalChanges,
      hasRemoteChanges: hasRemoteChanges,
      status: status
    };
  }

  return { parsePublication: parsePublication, serializePublication: serializePublication, fingerprint: fingerprint, normalizeDraft: normalizeDraft, compareDraft: compareDraft };
});
