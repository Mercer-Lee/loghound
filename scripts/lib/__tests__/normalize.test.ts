import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function tryParseJson(value: unknown): unknown {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractEmbeddedJson(content: unknown): unknown {
  if (typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) return tryParseJson(trimmed);
  const firstBrace = trimmed.indexOf('{');
  if (firstBrace === -1) return null;
  return tryParseJson(trimmed.slice(firstBrace));
}

function normalizeClsResult(result: any, source: any) {
  const parsed = (tryParseJson(result.LogJson) as any) || {};
  const rawContent = parsed.__CONTENT__ || '';
  const embedded = extractEmbeddedJson(rawContent) as any;
  const extra = embedded && embedded.extra && typeof embedded.extra === 'object' ? embedded.extra : {};

  const prefixLevelMatch = rawContent.match(/\b(INFO|WARN|ERROR|DEBUG)\s+\d/);
  const prefixLevel = prefixLevelMatch ? prefixLevelMatch[1] : '';
  const prefixTraceIdMatch = rawContent.match(/traceId:([a-f0-9]{16,})/i);
  const prefixTraceId = prefixTraceIdMatch ? prefixTraceIdMatch[1] : '';

  return {
    level: embedded?.level || parsed.level || parsed.Level || prefixLevel,
    event: embedded?.event || parsed.event || parsed.action || parsed.module,
    content:
      embedded?.content ||
      extra.message ||
      parsed.content ||
      parsed.message ||
      parsed.msg ||
      (!embedded && rawContent ? rawContent : '') ||
      result.RawLog ||
      '',
    traceId:
      embedded?.traceId ||
      prefixTraceId ||
      parsed.traceId ||
      parsed.trace_id ||
      parsed.requestId ||
      extra.traceId ||
      extra.requestId,
    error:
      extra.errorMessage ||
      embedded?.error ||
      embedded?.err ||
      parsed.error ||
      parsed.err ||
      parsed.errMsg ||
      parsed.message,
  };
}

function makeClsResult(content: string) {
  return {
    Time: 1779418867032,
    LogJson: JSON.stringify({
      __TAG__: { pod_name: 'pod-1', container_name: 'app' },
      __CONTENT__: content,
    }),
    RawLog: '',
    HostName: 'host-1',
  };
}

describe('CLS normalize', () => {
  const source = { name: 'test-topic', alias: 'prod:test-source', layer: 'api' };

  it('extracts level from text prefix when JSON is embedded', () => {
    const n = normalizeClsResult(
      makeClsResult(
        '2026-05-22 11:01:06,883 ERROR 47 {"traceId":"abc123","event":"接口请求报错","extra":{"message":"timeout"}}',
      ),
      source,
    );
    assert.equal(n.level, 'ERROR');
    assert.equal(n.event, '接口请求报错');
    assert.equal(n.content, 'timeout');
    assert.equal(n.traceId, 'abc123');
  });

  it('extracts WARN level from text prefix', () => {
    const n = normalizeClsResult(
      makeClsResult(
        '2026-05-22 11:01:06,883 WARN 47 traceId:6bc885ac649e7b00d2ac0bbb8b492c7a {"event":"慢请求","content":"耗时","extra":{"time":5560}}',
      ),
      source,
    );
    assert.equal(n.level, 'WARN');
    assert.equal(n.event, '慢请求');
    assert.equal(n.content, '耗时');
    assert.equal(n.traceId, '6bc885ac649e7b00d2ac0bbb8b492c7a');
  });

  it('extracts INFO level and traceId from plain text logs', () => {
    const n = normalizeClsResult(
      makeClsResult(
        '2026-05-22 11:01:05,694 INFO 56 traceId:6bc885ac649e7b00d2ac0bbb8b492c7a 接口 GET /users 响应耗时 810ms client:backend-api',
      ),
      source,
    );
    assert.equal(n.level, 'INFO');
    assert.equal(n.traceId, '6bc885ac649e7b00d2ac0bbb8b492c7a');
    assert.ok(n.content.includes('接口 GET /users 响应耗时 810ms'));
  });

  it('extracts extra.message as content when content field is missing', () => {
    const n = normalizeClsResult(
      makeClsResult(
        '2026-05-22 11:01:06,883 ERROR 47 {"traceId":"t1","event":"接口请求报错","extra":{"message":"请求:http://backend/users 超时 :2000ms"}}',
      ),
      source,
    );
    assert.equal(n.content, '请求:http://backend/users 超时 :2000ms');
  });

  it('extracts err field as error', () => {
    const n = normalizeClsResult(
      makeClsResult(
        '2026-05-22 11:01:06,881 INFO 47 {"traceId":"t2","event":"请求异常","content":"数据","err":"请求:http://backend 超时 :2000ms"}',
      ),
      source,
    );
    assert.equal(n.error, '请求:http://backend 超时 :2000ms');
  });

  it('extracts traceId from text prefix in plain text logs', () => {
    const n = normalizeClsResult(
      makeClsResult(
        '2026-05-22 11:01:04,009 INFO 68 traceId:deadbeef12345678abcdef012345678 接口 GET /users 响应耗时 1125ms',
      ),
      source,
    );
    assert.equal(n.traceId, 'deadbeef12345678abcdef012345678');
  });

  it('returns empty content for empty input', () => {
    const n = normalizeClsResult(
      { LogJson: JSON.stringify({ __TAG__: {}, __CONTENT__: '' }), RawLog: '', HostName: 'h' },
      source,
    );
    assert.equal(n.content, '');
  });
});
