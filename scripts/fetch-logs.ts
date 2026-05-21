#!/usr/bin/env tsx
import 'dotenv/config';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import pLimit from 'p-limit';

const { GetLogsRequest } = require('@alicloud/sls20201230');

import {
  buildClsClient,
  buildSlsClient,
  buildTlsClient,
  extractEmbeddedJson,
  getProjectConfig,
  readProjectsConfig,
  toSingleLine,
  tryParseJson,
} from './lib';
import { extractSignals, filterNoiseEvents } from './lib/signal-extractor';
import { clusterLogs } from './lib/log-cluster';
import { generateHints } from './lib/hint-generator';

import type {
  FetchLogsArgs,
  LogSummary,
  NormalizedEntry,
  PreprocessResult,
  ProjectConfig,
  QueryHit,
  QueryHint,
  StageHints,
  SourceConfig,
  TimelineEntry,
} from './lib/types';

const execFileAsync = promisify(execFile);

function parseArgs(argv: string[]): FetchLogsArgs {
  const out: FetchLogsArgs = {
    project: '',
    env: 'prod',
    query: '',
    hours: 168,
    lines: 20,
    json: false,
    autoFallback: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const cur = argv[i];
    const next = argv[i + 1];
    if (cur === '--project' && next) {
      out.project = next;
      i += 1;
    } else if (cur === '--env' && next) {
      out.env = next;
      i += 1;
    } else if (cur === '--query' && next) {
      out.query = next;
      i += 1;
    } else if (cur === '--hours' && next) {
      out.hours = Number(next);
      i += 1;
    } else if (cur === '--lines' && next) {
      out.lines = Number(next);
      i += 1;
    } else if (cur === '--json') {
      out.json = true;
    } else if (cur === '--no-auto-fallback') {
      out.autoFallback = false;
    }
  }

  if (!out.project) {
    throw new Error('Missing required --project');
  }
  if (!out.query) {
    throw new Error('Missing required --query');
  }
  return out;
}

function normalizeSlsLog(entry: any, source: SourceConfig & { alias: string }): NormalizedEntry {
  const parsedContent = tryParseJson(entry.content) as any;
  const extra = parsedContent?.extra && typeof parsedContent.extra === 'object' ? parsedContent.extra : {};

  return {
    summary: {
      time: parsedContent?.time || entry._time_ || entry.__time__,
      level: parsedContent?.level || entry.level,
      event: parsedContent?.event,
      content: parsedContent?.content || entry.message || entry.msg || '',
      traceId: parsedContent?.traceId || entry.traceId || entry.trace_id || extra.traceId || extra.requestId,
      taskId: entry.taskId || entry.task_id || extra.taskId || extra.workTaskId || extra.renderTaskId,
      requestId: parsedContent?.requestId || entry.requestId || entry.request_id,
      uid: parsedContent?.uid || entry.uid || extra.uid || extra.userId,
      status: entry.status || extra.status,
      type: extra.type,
      code: extra.errorCode || parsedContent?.code || entry.code,
      error: extra.errorMessage || extra.msg || parsedContent?.error || entry.error || entry.err,
      layer: source.layer,
      sourceName: source.alias || source.name,
      sourceKind: 'sls',
      hostName: entry.__source__,
      podName: entry._pod_name_,
      containerName: entry._container_name_,
    },
    raw: entry,
  };
}

function normalizeClsResult(result: any, source: SourceConfig & { alias: string }): NormalizedEntry {
  const parsed = tryParseJson(result.LogJson) as any || {};
  const embedded = extractEmbeddedJson(parsed.__CONTENT__) as any;
  const extra = embedded && embedded.extra && typeof embedded.extra === 'object' ? embedded.extra : {};
  const customExtra = extra.customExtra && typeof extra.customExtra === 'object' ? extra.customExtra : {};
  const tags = parsed.__TAG__ && typeof parsed.__TAG__ === 'object' ? parsed.__TAG__ : {};

  return {
    summary: {
      time: embedded?.time || parsed.time || parsed.timestamp || result.Time,
      level: embedded?.level || parsed.level || parsed.Level,
      event: embedded?.event || parsed.event || parsed.action || parsed.module,
      content: embedded?.content || parsed.content || parsed.message || parsed.msg || result.RawLog || '',
      traceId: embedded?.traceId || parsed.traceId || parsed.trace_id || parsed.requestId || extra.traceId || extra.requestId,
      taskId: embedded?.taskId || extra.taskId || parsed.taskId || parsed.task_id || extra.renderTaskId || customExtra.renderTaskId || parsed.jobId || extra.workTaskId,
      requestId: embedded?.requestId || parsed.requestId || extra.requestId,
      uid: embedded?.uid || extra.userId || parsed.uid || parsed.userId || parsed.user_id,
      userNo: extra.userNo || extra.appUserNo || parsed.userNo || parsed.appUserNo || customExtra.userNo || customExtra.appUserNo,
      status: embedded?.status || extra.status || parsed.status || parsed.state,
      type: extra.type || embedded?.type,
      prompt: extra.prompt || extra.text || embedded?.prompt || embedded?.text || customExtra.prompt || customExtra.text,
      code: extra.errorCode || embedded?.code || parsed.code || parsed.errCode,
      error: extra.errorMessage || embedded?.error || parsed.error || parsed.err || parsed.errMsg || parsed.message,
      layer: source.layer,
      sourceName: source.alias || source.name,
      sourceKind: 'cls',
      hostName: result.HostName,
      podName: tags.pod_name,
      containerName: tags.container_name,
    },
    raw: result,
  };
}

function normalizeTlsLog(entry: any, source: SourceConfig & { alias: string }): NormalizedEntry {
  const contentMap: Record<string, string> = Array.isArray(entry.Contents)
    ? Object.fromEntries(entry.Contents.map((item: any) => [item.Key, item.Value]))
    : entry.Contents || {};
  const parsedMessage = tryParseJson(contentMap.content || contentMap.message || contentMap.msg || '') as any;
  const embedded = parsedMessage || extractEmbeddedJson(contentMap.content || contentMap.message || contentMap.msg || '') as any;
  const extra = embedded && embedded.extra && typeof embedded.extra === 'object' ? embedded.extra : {};
  const customExtra = extra.customExtra && typeof extra.customExtra === 'object' ? extra.customExtra : {};

  return {
    summary: {
      time: embedded?.time || contentMap.time || entry.Time,
      level: embedded?.level || contentMap.level || '',
      event: embedded?.event || contentMap.event || contentMap.action || contentMap.module || '',
      content: embedded?.content || contentMap.content || contentMap.message || contentMap.msg || '',
      traceId: embedded?.traceId || contentMap.traceId || contentMap.trace_id || extra.traceId || extra.requestId || '',
      taskId: embedded?.taskId || contentMap.taskId || contentMap.task_id || extra.taskId || extra.workTaskId || extra.renderTaskId || customExtra.renderTaskId || '',
      requestId: embedded?.requestId || contentMap.requestId || extra.requestId || '',
      uid: embedded?.uid || contentMap.uid || contentMap.userId || extra.uid || extra.userId || '',
      status: embedded?.status || contentMap.status || extra.status || contentMap.state || '',
      type: embedded?.type || extra.type || contentMap.type || '',
      code: embedded?.code || extra.errorCode || contentMap.code || contentMap.errCode || '',
      error: embedded?.error || extra.errorMessage || contentMap.error || contentMap.err || contentMap.errMsg || '',
      layer: source.layer,
      sourceName: source.alias || source.name,
      sourceKind: 'tls',
      hostName: contentMap.__path__ || contentMap._source || '',
      podName: contentMap._pod_name || contentMap.pod_name || '',
      containerName: contentMap._container_name || contentMap.container_name || '',
    },
    raw: entry,
  };
}

async function querySlsSource(
  client: ReturnType<typeof buildSlsClient>,
  projectId: string,
  source: SourceConfig & { alias: string },
  query: string,
  from: number,
  to: number,
  limit: number,
): Promise<QueryHit> {
  const req = new GetLogsRequest({ from, to, query, line: limit, reverse: true });
  const res = await client.getLogs(projectId, source.name, req);
  const body = Array.isArray(res.body) ? res.body.map((item: any) => normalizeSlsLog(item, source)) : [];
  return {
    source,
    query,
    count: body.length,
    body,
  };
}

async function queryClsSource(
  client: any,
  source: SourceConfig & { alias: string },
  query: string,
  from: number,
  to: number,
  limit: number,
): Promise<QueryHit> {
  const res = await client.SearchLog({
    From: from,
    To: to,
    Query: query,
    TopicId: source.name,
    SyntaxRule: 1,
    Sort: 'desc',
    Limit: limit,
  });
  const body = Array.isArray(res.Results) ? res.Results.map((item: any) => normalizeClsResult(item, source)) : [];
  return {
    source,
    query,
    count: body.length,
    body,
    requestId: res.RequestId,
  };
}

async function queryTlsSource(
  client: any,
  source: SourceConfig & { alias: string },
  query: string,
  from: number,
  to: number,
  limit: number,
): Promise<QueryHit> {
  const res = await client.SearchLogs({
    TopicId: source.name,
    Query: query,
    StartTime: from,
    EndTime: to,
    Limit: limit,
    Sort: 'desc',
  });
  const body = Array.isArray(res.Logs) ? res.Logs.map((item: any) => normalizeTlsLog(item, source)) : [];
  return {
    source,
    query,
    count: body.length,
    body,
    resultStatus: res.ResultStatus,
    errorCount: Array.isArray(res.Errors) ? res.Errors.length : 0,
  };
}

function extractIdentifiers(hits: QueryHit[]): Record<string, string> {
  const identifiers: Record<string, string> = {};
  for (const hit of hits) {
    for (const entry of hit.body) {
      const summary = entry.summary;
      for (const key of ['traceId', 'taskId', 'requestId', 'uid'] as const) {
        if (!identifiers[key] && summary[key]) {
          identifiers[key] = summary[key];
        }
      }
    }
  }
  return identifiers;
}

function toTimestamp(value: unknown): number {
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

function buildTimeline(hits: QueryHit[]): TimelineEntry[] {
  return hits
    .flatMap((hit) => hit.body.map((entry) => ({
      timestamp: toTimestamp(entry.summary.time),
      time: entry.summary.time || '',
      layer: entry.summary.layer || '',
      source: entry.summary.sourceName || hit.source.alias || hit.source.name,
      level: entry.summary.level || '',
      event: entry.summary.event || '',
      content: entry.summary.content || '',
      status: entry.summary.status || '',
      error: entry.summary.error || '',
      traceId: entry.summary.traceId || '',
      taskId: entry.summary.taskId || '',
      requestId: entry.summary.requestId || '',
      uid: entry.summary.uid || '',
    })))
    .sort((a, b) => b.timestamp - a.timestamp);
}

function buildStageHints(timeline: TimelineEntry[]): StageHints {
  const first = timeline[timeline.length - 1] || null;
  const last = timeline[0] || null;
  const lastErrored = timeline.find((item) => item.error) || null;
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
      error: lastErrored.error,
    } : null,
  };
}

function buildQueryHints(
  extractedIds: Record<string, string>,
  args: FetchLogsArgs,
  signalExtraction: any,
): QueryHint[] {
  const hints: QueryHint[] = [];
  if (extractedIds.traceId) {
    hints.push({
      type: 'useTraceId',
      message: `traceId extracted: ${extractedIds.traceId}, prefer this for subsequent queries within the same project`,
      suggestedQuery: `${extractedIds.traceId}`,
    });
  }
  if (args._fallbackInfo) {
    hints.push({
      type: 'autoFallback',
      message: `Original query "${args._fallbackInfo.originalQuery}" returned 0 hits, auto-fell back to "${args._fallbackInfo.fallbackQuery}"`,
    });
  }

  if (signalExtraction && signalExtraction.subTasks && signalExtraction.subTasks.failed.length > 0) {
    const failedIds = signalExtraction.subTasks.failed.slice(0, 3).map((t: any) => t.id).join(', ');
    hints.push({
      type: 'failedPathPriority',
      message: `Found ${signalExtraction.subTasks.failed.length} failed sub-tasks, prioritize: ${failedIds}`,
      failedTaskIds: signalExtraction.subTasks.failed.map((t: any) => t.id),
    });
  }

  return hints;
}

function buildPreprocessResult(
  projectConfig: ProjectConfig & { sources: (SourceConfig & { alias: string })[] },
  args: FetchLogsArgs,
  hits: QueryHit[],
): PreprocessResult {
  const matchedHits = hits.filter((item) => item.count > 0);
  const failedSources = hits
    .filter((item) => item.error)
    .map((item) => ({
      source: item.source.alias || item.source.name,
      layer: item.source.layer || '',
      error: item.error!,
    }));
  const timeline = buildTimeline(matchedHits);

  const signalExtraction = extractSignals(matchedHits, projectConfig);
  const errorClusters = clusterLogs(matchedHits, 10);
  const analysisHints = generateHints(signalExtraction, errorClusters, projectConfig);

  const extractedIds = extractIdentifiers(matchedHits);

  return {
    query: {
      project: projectConfig.name,
      env: projectConfig.env,
      query: args.query,
      hours: args.hours,
      lines: args.lines,
      backend: projectConfig.queryBackend,
    },
    sources: projectConfig.sources.map((source) => ({
      name: source.name,
      alias: source.alias || source.name,
      layer: source.layer,
      purpose: source.purpose || '',
    })),
    matchedSourceCount: matchedHits.length,
    failedSourceCount: failedSources.length,
    extractedIdentifiers: extractedIds,
    stageHints: buildStageHints(timeline),
    signalExtraction,
    errorClusters,
    analysisHints,
    fallbackInfo: args._fallbackInfo || null,
    queryHints: buildQueryHints(extractedIds, args, signalExtraction),
    timeline,
    sourceErrors: failedSources,
    hits: matchedHits,
  };
}

function expandProjectConfigs(projectName: string, env: string): ProjectConfig[] {
  const projects = readProjectsConfig();
  const project = projects[projectName];
  if (!project) {
    throw new Error(`Unknown project ${projectName}`);
  }

  const multiEnvs = project.multiEnvs;
  if (multiEnvs && Array.isArray(multiEnvs) && multiEnvs.length > 0) {
    return multiEnvs.map((envName: string) => getProjectConfig(projectName, envName));
  }

  return [getProjectConfig(projectName, env)];
}

function tagProjectConfigSources(
  projectConfig: ProjectConfig,
): ProjectConfig & { sources: (SourceConfig & { alias: string })[] } {
  return {
    ...projectConfig,
    sources: (projectConfig.sources || []).map((source) => ({
      ...source,
      alias: `${projectConfig.env}:${source.alias || source.name}`,
    })),
  };
}

async function queryWebhookProject(
  projectConfig: any,
  args: FetchLogsArgs,
): Promise<PreprocessResult> {
  const tsxBin = path.resolve(__dirname, '..', 'node_modules', '.bin', 'tsx');
  const scriptPath = path.join(__dirname, 'fetch-webhook.ts');
  const { stdout } = await execFileAsync(tsxBin, [
    scriptPath,
    '--taskId',
    args.query,
    '--json',
  ], {
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });

  const parsed = JSON.parse(stdout) as PreprocessResult;
  if (parsed && parsed.query) {
    parsed.query.project = projectConfig.name;
    parsed.query.env = projectConfig.env;
    parsed.query.query = args.query;
    parsed.query.hours = args.hours;
    parsed.query.lines = args.lines;
  }
  return parsed;
}

function printSummary(summary: LogSummary, index: number): void {
  const lead = [summary.time, summary.level, summary.event, summary.content]
    .filter(Boolean)
    .join(' | ');
  console.log(`  ${index + 1}. ${lead}`);

  const details = [
    ['traceId', summary.traceId],
    ['taskId', summary.taskId],
    ['requestId', summary.requestId],
    ['uid', summary.uid],
    ['type', summary.type],
    ['status', summary.status],
    ['code', summary.code],
    ['error', summary.error],
    ['layer', summary.layer],
    ['source', summary.sourceName],
    ['host', summary.hostName],
    ['pod', summary.podName],
    ['container', summary.containerName],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');

  if (details.length) {
    console.log(`     ${details.map(([key, value]) => `${key}=${toSingleLine(value)}`).join(' | ')}`);
  }
}

function printHumanOutput(result: PreprocessResult): void {
  console.log(`${result.query.project}/${result.query.env} window=${result.query.hours}h query=${result.query.query}`);

  if (!result.hits.length) {
    console.log('No matching logs found.');
    if (result.fallbackInfo) {
      console.log(`\nAuto fallback attempted: "${result.fallbackInfo.originalQuery}" -> "${result.fallbackInfo.fallbackQuery}" (still 0 hits)`);
    }
    if (result.sourceErrors.length > 0) {
      console.log('\nSource errors');
      for (const item of result.sourceErrors) {
        console.log(`- ${item.source} (${item.layer}): ${toSingleLine(item.error)}`);
      }
    }
    return;
  }

  if (result.analysisHints) {
    const hints = result.analysisHints;
    console.log('\n=== AI Analysis Hints ===');
    if (hints.currentBestHypothesis) {
      console.log(`Hypothesis: ${hints.currentBestHypothesis}`);
      console.log(`Confidence: ${hints.confidence}`);
    }
    if (hints.suggestedNextAction) {
      console.log(`Next Action: ${hints.suggestedNextAction}`);
    }
    if (hints.shouldQueryDownstream && hints.downstreamSuggestions.length > 0) {
      console.log(`Suggested Downstream: ${hints.downstreamSuggestions.join(', ')}`);
    }
    if (hints.reasoning.length > 0) {
      console.log(`Reasoning: ${hints.reasoning.join('; ')}`);
    }
  }

  if (result.signalExtraction && result.signalExtraction.hardFailures.length > 0) {
    console.log('\n=== Hard Failures ===');
    for (const failure of result.signalExtraction.hardFailures.slice(0, 3)) {
      console.log(`- [${failure.category}] ${failure.code || failure.error} at ${failure.layer}`);
    }
  }

  if (result.signalExtraction && result.signalExtraction.infoFailures.length > 0) {
    console.log('\n=== Business Failures (INFO) ===');
    for (const failure of result.signalExtraction.infoFailures.slice(0, 5)) {
      console.log(`- [${failure.severity}] ${failure.message} (source: ${failure.source}, layer: ${failure.layer})`);
    }
  }

  if (result.signalExtraction && result.signalExtraction.errorClassification) {
    const ec = result.signalExtraction.errorClassification;
    console.log('\n=== Error Classification ===');
    console.log(`- Category: ${ec.category} (${ec.confidence})`);
    if (ec.message) console.log(`- Message: ${ec.message}`);
    console.log(`- Query Downstream: ${ec.shouldQueryDownstream ? 'Yes' : 'No'}`);
    if (ec.downstreamTargets.length > 0) {
      console.log(`- Targets: ${ec.downstreamTargets.join(', ')}`);
    }
    console.log(`- Action: ${ec.action}`);
  }

  if (result.errorClusters && result.errorClusters.length > 0) {
    console.log('\n=== Error Clusters ===');
    for (const cluster of result.errorClusters.slice(0, 5)) {
      console.log(`- [${cluster.category}] ${cluster.pattern} (${cluster.count})`);
    }
  }

  if (Object.keys(result.extractedIdentifiers).length > 0) {
    console.log('\nExtracted identifiers');
    for (const [key, value] of Object.entries(result.extractedIdentifiers)) {
      console.log(`- ${key}: ${toSingleLine(value)}`);
    }
  }

  if (result.stageHints.firstVisibleEvent || result.stageHints.lastVisibleEvent || result.stageHints.lastErrorEvent) {
    console.log('\nStage hints');
    if (result.stageHints.firstVisibleEvent) {
      const item = result.stageHints.firstVisibleEvent;
      console.log(`- first: ${toSingleLine([item.time, item.source, item.layer, item.event || item.content].filter(Boolean).join(' | '))}`);
    }
    if (result.stageHints.lastVisibleEvent) {
      const item = result.stageHints.lastVisibleEvent;
      console.log(`- last: ${toSingleLine([item.time, item.source, item.layer, item.event || item.content, item.status].filter(Boolean).join(' | '))}`);
    }
    if (result.stageHints.lastErrorEvent) {
      const item = result.stageHints.lastErrorEvent;
      console.log(`- last-error: ${toSingleLine([item.time, item.source, item.layer, item.event || item.content, item.error].filter(Boolean).join(' | '))}`);
    }
  }

  if (result.fallbackInfo) {
    console.log('\n=== Auto Fallback ===');
    console.log(`Original query: "${result.fallbackInfo.originalQuery}" -> 0 hits`);
    console.log(`Fallback query: "${result.fallbackInfo.fallbackQuery}" -> ${result.hits.reduce((s, h) => s + h.count, 0)} hits`);
  }

  if (result.queryHints && result.queryHints.length > 0) {
    console.log('\n=== Query Hints ===');
    for (const hint of result.queryHints) {
      console.log(`- ${hint.message}`);
    }
  }

  if (result.signalExtraction && result.signalExtraction.errorStacks && result.signalExtraction.errorStacks.length > 0) {
    console.log('\n=== Error Stacks ===');
    for (const stack of result.signalExtraction.errorStacks.slice(0, 3)) {
      console.log(`- ${stack.message}`);
      if (stack.topFrame) {
        console.log(`  at ${stack.topFrame.function} (${stack.topFrame.file}:${stack.topFrame.line}:${stack.topFrame.column})`);
      }
    }
  }

  if (result.signalExtraction && result.signalExtraction.subTasks && result.signalExtraction.subTasks.total > 0) {
    const subTasks = result.signalExtraction.subTasks;
    console.log(`\n=== Sub Tasks (${subTasks.summary}) ===`);
    for (const task of subTasks.failed.slice(0, 5)) {
      console.log(`[FAIL] ${task.id} (${task.type}) - ${task.error ? toSingleLine(task.error).substring(0, 100) : 'failed'}`);
    }
    for (const task of subTasks.processing.slice(0, 3)) {
      console.log(`[PROC] ${task.id} (${task.type}) - processing`);
    }
    const showCompleted = subTasks.failed.length === 0 || subTasks.completed.length <= 5;
    if (showCompleted) {
      for (const task of subTasks.completed.slice(0, 5)) {
        console.log(`[OK] ${task.id} (${task.type}) - completed`);
      }
    } else if (subTasks.completed.length > 5) {
      console.log(`[OK] ... and ${subTasks.completed.length} more completed tasks`);
    }
    for (const task of subTasks.unknown.slice(0, 3)) {
      console.log(`[?] ${task.id} (${task.type}) - status unknown`);
    }
  }

  if (result.hits.length > 0) {
    const allEntries = result.hits.flatMap(h => h.body || []);
    const filteredEntries = filterNoiseEvents(allEntries);
    const noiseCount = allEntries.length - filteredEntries.length;
    if (noiseCount > 0) {
      console.log(`\n=== Noise Filter ===`);
      console.log(`Total: ${allEntries.length} entries | Relevant: ${filteredEntries.length} | Filtered: ${noiseCount} noise entries`);
    }
  }

  for (const hit of result.hits) {
    console.log(`\n[${hit.source.alias || hit.source.name}] ${hit.count} hit(s)`);
    hit.body.slice(0, result.query.lines).forEach((entry, index) => printSummary(entry.summary, index));
  }

  if (result.sourceErrors.length > 0) {
    console.log('\nSource errors');
    for (const item of result.sourceErrors) {
      console.log(`- ${item.source} (${item.layer}): ${toSingleLine(item.error)}`);
    }
  }
}

function hasLevelFilter(query: string): boolean {
  const upper = query.toUpperCase();
  return /\bERROR\b/.test(upper) || /\bWARN\b/.test(upper);
}

function stripLevelFilter(query: string): string {
  return query
    .replace(/\s*AND\s*\(\s*ERROR\s+OR\s+WARN\s*\)/gi, '')
    .replace(/\s*AND\s*ERROR\b/gi, '')
    .replace(/\s*AND\s*WARN\b/gi, '')
    .replace(/\(\s*ERROR\s+OR\s+WARN\s*\)\s*AND\s*/gi, '')
    .replace(/\(\s*ERROR\s+OR\s+WARN\s*\)/gi, '')
    .trim();
}

function totalHitCount(hits: QueryHit[]): number {
  return hits.reduce((sum, h) => sum + (h.count || 0), 0);
}

type LimitFn = <T>(fn: () => Promise<T>) => Promise<T>;

async function queryAllSources(
  projectConfigs: ReturnType<typeof tagProjectConfigSources>[],
  primaryConfig: any,
  args: FetchLogsArgs,
  limit: LimitFn,
): Promise<QueryHit[]> {
  const hits: QueryHit[] = [];

  if (primaryConfig.queryBackend === 'sls') {
    const to = Math.floor(Date.now() / 1000);
    const from = to - Math.max(1, args.hours) * 3600;
    const tasks: Promise<QueryHit>[] = [];
    for (const projectConfig of projectConfigs) {
      const client = buildSlsClient(projectConfig.region);
      for (const source of projectConfig.sources) {
        tasks.push(
          limit(async () => {
            try {
              return await querySlsSource(client, projectConfig.projectId, source, args.query, from, to, args.lines);
            } catch (error: any) {
              return { source, query: args.query, error: error.message, count: 0, body: [] };
            }
          }),
        );
      }
    }
    const results = await Promise.all(tasks);
    hits.push(...results);
  } else if (primaryConfig.queryBackend === 'cls') {
    const to = Date.now();
    const from = to - Math.max(1, args.hours) * 3600 * 1000;
    const tasks: Promise<QueryHit>[] = [];
    for (const projectConfig of projectConfigs) {
      const client = buildClsClient(projectConfig.region);
      for (const source of projectConfig.sources) {
        tasks.push(
          limit(async () => {
            try {
              return await queryClsSource(client, source, args.query, from, to, args.lines);
            } catch (error: any) {
              return { source, query: args.query, error: error.message, count: 0, body: [] };
            }
          }),
        );
      }
    }
    const results = await Promise.all(tasks);
    hits.push(...results);
  } else if (primaryConfig.queryBackend === 'tls') {
    const to = Math.floor(Date.now() / 1000);
    const from = to - Math.max(1, args.hours) * 3600;
    const tasks: Promise<QueryHit>[] = [];
    for (const projectConfig of projectConfigs) {
      const client = buildTlsClient(projectConfig.region);
      for (const source of projectConfig.sources) {
        tasks.push(
          limit(async () => {
            try {
              return await queryTlsSource(client, source, args.query, from, to, args.lines);
            } catch (error: any) {
              return { source, query: args.query, error: error.message, count: 0, body: [] };
            }
          }),
        );
      }
    }
    const results = await Promise.all(tasks);
    hits.push(...results);
  } else {
    throw new Error(`Unsupported query backend ${primaryConfig.queryBackend} for project ${primaryConfig.name}`);
  }

  return hits;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const projectConfigs = expandProjectConfigs(args.project, args.env).map(tagProjectConfigSources);
  const primaryProjectConfig = {
    ...projectConfigs[0],
    env: projectConfigs.map((item) => item.env).join(','),
    sources: projectConfigs.flatMap((item) => item.sources || []),
  };

  if (primaryProjectConfig.queryBackend === 'webhook') {
    const result = await queryWebhookProject(primaryProjectConfig, args);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    printHumanOutput(result);
    if (!result.hits.length) {
      process.exitCode = 1;
    }
    return;
  }

  const limit = pLimit(5) as unknown as LimitFn;
  let hits = await queryAllSources(projectConfigs, primaryProjectConfig, args, limit);

  if (args.autoFallback && totalHitCount(hits) === 0 && hasLevelFilter(args.query)) {
    const fallbackQuery = stripLevelFilter(args.query);
    if (fallbackQuery && fallbackQuery !== args.query) {
      const fallbackArgs = { ...args, query: fallbackQuery };
      hits = await queryAllSources(projectConfigs, primaryProjectConfig, fallbackArgs, limit);
      if (totalHitCount(hits) > 0) {
        args._fallbackInfo = {
          originalQuery: args.query,
          fallbackQuery,
          reason: '0 hits with level filter, retried without',
        };
      }
    }
  }

  const result = buildPreprocessResult(primaryProjectConfig, args, hits);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  printHumanOutput(result);
  if (!result.hits.length) {
    process.exitCode = 1;
  }
}

main().catch((error: any) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
