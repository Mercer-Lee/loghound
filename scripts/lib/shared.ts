import type { TimelineEntry, StageHints, NormalizedEntry, PreprocessResult } from './types';
import { toSingleLine } from './index';

export function toTimestamp(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  if (typeof value === 'number') {
    return value > 1000000000000 ? value : value * 1000;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1000000000000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildTimeline(entries: NormalizedEntry[]): TimelineEntry[] {
  return entries
    .map((entry) => ({
      timestamp: toTimestamp(entry.summary.time),
      time: entry.summary.time || '',
      layer: entry.summary.layer || '',
      source: entry.summary.sourceName || '',
      level: entry.summary.level || '',
      event: entry.summary.event || '',
      content: entry.summary.content || '',
      status: entry.summary.status || '',
      error: entry.summary.error || '',
      traceId: entry.summary.traceId || '',
      taskId: entry.summary.taskId || '',
      requestId: entry.summary.requestId || '',
      uid: entry.summary.uid || '',
      nodeStep: entry.summary.nodeStep || 0,
    }))
    .sort((a, b) => {
      if (a.timestamp !== b.timestamp) {
        return b.timestamp - a.timestamp;
      }
      return (b.nodeStep || 0) - (a.nodeStep || 0);
    });
}

export function buildStageHints(timeline: TimelineEntry[]): StageHints {
  const first = timeline[timeline.length - 1] || null;
  const last = timeline[0] || null;
  const lastErrored = timeline.find((item) => item.error || item.status === 'failed') || null;
  return {
    firstVisibleEvent: first ? {
      time: first.time,
      source: first.source,
      layer: first.layer,
      event: first.event,
      content: first.content,
    } : null,
    lastVisibleEvent: last ? {
      time: last.time,
      source: last.source,
      layer: last.layer,
      event: last.event,
      content: last.content,
      status: last.status,
    } : null,
    lastErrorEvent: lastErrored ? {
      time: lastErrored.time,
      source: lastErrored.source,
      layer: lastErrored.layer,
      event: lastErrored.event,
      content: lastErrored.content,
      error: lastErrored.error || lastErrored.status,
    } : null,
  };
}

export function extractIdentifiers(entries: NormalizedEntry[], fallbacks?: Record<string, string>): Record<string, string> {
  const identifiers: Record<string, string> = fallbacks ? { ...fallbacks } : {};
  for (const entry of entries) {
    const summary = entry.summary || {};
    for (const key of ['traceId', 'taskId', 'requestId', 'uid'] as const) {
      if (!identifiers[key] && summary[key]) {
        identifiers[key] = summary[key];
      }
    }
  }
  return identifiers;
}

export function printSummary(summary: any, index: number): void {
  const lead = [summary.time, summary.level, summary.event, summary.content]
    .filter(Boolean)
    .join(' | ');
  console.log(`  ${index + 1}. ${lead || '(empty entry)'}`);

  const details = [
    ['traceId', summary.traceId],
    ['taskId', summary.taskId],
    ['requestId', summary.requestId],
    ['uid', summary.uid],
    ['status', summary.status],
    ['type', summary.type],
    ['code', summary.code],
    ['error', summary.error],
    ['layer', summary.layer],
    ['source', summary.sourceName],
    ['host', summary.hostName],
    ['pod', summary.podName],
    ['container', summary.containerName],
    ['workflowName', summary.workflowName],
    ['executionId', summary.executionId],
    ['step', summary.nodeStep],
    ['duration', summary.duration],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');

  if (details.length) {
    console.log(`     ${details.map(([key, value]) => `${key}=${toSingleLine(value)}`).join(' | ')}`);
  }
}

export function printStageHints(stageHints: StageHints): void {
  if (!stageHints.firstVisibleEvent && !stageHints.lastVisibleEvent && !stageHints.lastErrorEvent) {
    return;
  }
  console.log('\nStage hints');
  if (stageHints.firstVisibleEvent) {
    const item = stageHints.firstVisibleEvent;
    console.log(`- first: ${toSingleLine([item.time, item.source, item.layer, item.event || item.content].filter(Boolean).join(' | '))}`);
  }
  if (stageHints.lastVisibleEvent) {
    const item = stageHints.lastVisibleEvent;
    console.log(`- last: ${toSingleLine([item.time, item.source, item.layer, item.event || item.content, item.status].filter(Boolean).join(' | '))}`);
  }
  if (stageHints.lastErrorEvent) {
    const item = stageHints.lastErrorEvent;
    console.log(`- last-error: ${toSingleLine([item.time, item.source, item.layer, item.event || item.content, item.error].filter(Boolean).join(' | '))}`);
  }
}

export function printExtractedIdentifiers(identifiers: Record<string, string>): void {
  if (Object.keys(identifiers).length === 0) return;
  console.log('\nExtracted identifiers');
  for (const [key, value] of Object.entries(identifiers)) {
    console.log(`- ${key}: ${toSingleLine(value)}`);
  }
}

export function stripRawFields(result: PreprocessResult): PreprocessResult {
  const stripped: any = { ...result };
  delete (stripped as any).rawResponse;

  stripped.hits = stripped.hits.map((hit: any) => ({
    ...hit,
    body: hit.body.map((entry: any) => ({
      summary: entry.summary,
    })),
  }));

  return stripped as PreprocessResult;
}
