import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Test toTimestamp and extractIdentifiers logic

function toTimestamp(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return value > 1000000000000 ? value : value * 1000;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric > 1000000000000 ? numeric : numeric * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractIdentifiers(entries: Array<{ summary: Record<string, string> }>): Record<string, string> {
  const identifiers: Record<string, string> = {};
  for (const entry of entries) {
    const summary = entry.summary || {};
    for (const key of ['traceId', 'taskId', 'requestId', 'uid'] as const) {
      if (!identifiers[key] && summary[key]) identifiers[key] = summary[key];
    }
  }
  return identifiers;
}

describe('toTimestamp', () => {
  it('handles millisecond timestamps', () => {
    assert.equal(toTimestamp(1779418867032), 1779418867032);
  });

  it('handles second timestamps', () => {
    assert.equal(toTimestamp(1779418867), 1779418867000);
  });

  it('handles ISO date strings', () => {
    const ts = toTimestamp('2026-05-22T03:01:07.032Z');
    assert.equal(ts, 1779418867032);
  });

  it('returns 0 for null/undefined/empty', () => {
    assert.equal(toTimestamp(null), 0);
    assert.equal(toTimestamp(undefined), 0);
    assert.equal(toTimestamp(''), 0);
  });
});

describe('extractIdentifiers', () => {
  it('extracts identifiers from multiple entries', () => {
    const ids = extractIdentifiers([
      { summary: { traceId: 't1', uid: '' } },
      { summary: { taskId: 'task1', traceId: '' } },
      { summary: { uid: 'u1', requestId: 'r1' } },
    ]);
    assert.equal(ids.traceId, 't1');
    assert.equal(ids.taskId, 'task1');
    assert.equal(ids.uid, 'u1');
    assert.equal(ids.requestId, 'r1');
  });

  it('keeps first seen value', () => {
    const ids = extractIdentifiers([{ summary: { traceId: 'first' } }, { summary: { traceId: 'second' } }]);
    assert.equal(ids.traceId, 'first');
  });

  it('returns empty for no entries', () => {
    assert.deepEqual(extractIdentifiers([]), {});
  });
});
