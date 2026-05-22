import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Test the core extraction functions by reimporting logic.
// Since extractHardFailures/extractInfoFailures are not exported,
// we test the pattern matching logic directly.

const DEFAULT_HARD_FAILURE_PATTERNS: Record<string, { category: string; subtype: string }> = {
  'ResultReview.NotPass': { category: 'REVIEW', subtype: 'CONTENT_VIOLATION' },
  'Task.RenderFailed': { category: 'RENDER', subtype: 'RENDER_ERROR' },
  timeout: { category: 'TIMEOUT', subtype: 'DEADLINE_EXCEEDED' },
  ECONNREFUSED: { category: 'NETWORK', subtype: 'CONNECTION_REFUSED' },
  ETIMEDOUT: { category: 'NETWORK', subtype: 'CONNECTION_TIMEOUT' },
};

const MTV_PATTERNS: Record<string, { category: string; subtype: string }> = {
  接口请求报错: { category: 'API_ERROR', subtype: 'REQUEST_ERROR' },
  超时: { category: 'TIMEOUT', subtype: 'INTERNAL_TIMEOUT' },
};

function matchHardFailure(content: string, patterns: Record<string, { category: string; subtype: string }>) {
  const lower = content.toLowerCase();
  for (const [pattern, classification] of Object.entries(patterns)) {
    if (lower.includes(pattern.toLowerCase())) {
      return classification;
    }
  }
  return null;
}

describe('Hard failure pattern matching', () => {
  it('matches default timeout pattern', () => {
    const result = matchHardFailure('connection timeout after 30s', DEFAULT_HARD_FAILURE_PATTERNS);
    assert.deepEqual(result, { category: 'TIMEOUT', subtype: 'DEADLINE_EXCEEDED' });
  });

  it('matches default ECONNREFUSED', () => {
    const result = matchHardFailure('connect ECONNREFUSED 10.0.1.2:8080', DEFAULT_HARD_FAILURE_PATTERNS);
    assert.deepEqual(result, { category: 'NETWORK', subtype: 'CONNECTION_REFUSED' });
  });

  it('matches project-specific 超时 pattern', () => {
    const merged = { ...DEFAULT_HARD_FAILURE_PATTERNS, ...MTV_PATTERNS };
    const result = matchHardFailure('请求:http://backend/users 超时 :2000ms', merged);
    assert.deepEqual(result, { category: 'TIMEOUT', subtype: 'INTERNAL_TIMEOUT' });
  });

  it('matches project-specific 接口请求报错', () => {
    const merged = { ...DEFAULT_HARD_FAILURE_PATTERNS, ...MTV_PATTERNS };
    const result = matchHardFailure('接口请求报错 path GET /api', merged);
    assert.deepEqual(result, { category: 'API_ERROR', subtype: 'REQUEST_ERROR' });
  });

  it('returns null for no match', () => {
    const result = matchHardFailure('everything is fine', DEFAULT_HARD_FAILURE_PATTERNS);
    assert.equal(result, null);
  });

  it('project patterns merge without overwriting defaults', () => {
    const merged = { ...DEFAULT_HARD_FAILURE_PATTERNS, ...MTV_PATTERNS };
    assert.ok(merged['timeout']);
    assert.ok(merged['超时']);
    assert.ok(merged['接口请求报错']);
    assert.ok(merged['ECONNREFUSED']);
  });
});

// Noise filter test
const NOISE_EVENT_PATTERNS = ['getUserInfo', 'healthcheck', 'heartbeat', 'health check', 'ping', 'metrics'];
const KEY_EVENT_PATTERNS = ['render', 'callback', 'failed', 'workflow', 'task', 'submit', 'process', 'create'];

function isNoise(event: string, content: string): boolean {
  const text = `${event} ${content}`.toLowerCase();
  for (const p of NOISE_EVENT_PATTERNS) {
    if (text.includes(p.toLowerCase())) return true;
  }
  return false;
}

describe('Noise filter', () => {
  it('filters getUserInfo events', () => {
    assert.equal(isNoise('getUserInfo', 'uid=123'), true);
  });

  it('filters healthcheck events', () => {
    assert.equal(isNoise('health', 'healthcheck ok'), true);
  });

  it('does NOT filter slow request events', () => {
    assert.equal(isNoise('慢请求', '耗时 5560ms'), false);
  });

  it('does NOT filter error events', () => {
    assert.equal(isNoise('接口请求报错', 'timeout'), false);
  });

  it('does NOT filter render events', () => {
    assert.equal(isNoise('render', 'Task.RenderFailed'), false);
  });
});
