import fs from 'fs';
import path from 'path';

import type {
  AnyRecord,
  CrossProjectMention,
  ErrorClassification,
  ErrorStack,
  HardFailure,
  InfoFailure,
  NormalizedEntry,
  ProjectConfig,
  QueryHit,
  SignalExtraction,
  StackFrame,
  StateTransition,
  SubTask,
  SubTaskSummary,
} from './types';
import { readProjectsConfig } from './index';

interface CompiledTaskPattern {
  type: string;
  regex: RegExp;
}

function buildTaskPatterns(): CompiledTaskPattern[] {
  const projects = readProjectsConfig();
  const patterns: CompiledTaskPattern[] = [];
  for (const [, project] of Object.entries(projects)) {
    const proj = project as any;
    if (proj.taskPatterns && Array.isArray(proj.taskPatterns)) {
      for (const tp of proj.taskPatterns) {
        try {
          patterns.push({ type: tp.type, regex: new RegExp(tp.regex, 'i') });
        } catch {
          // Skip invalid regex
        }
      }
    }
  }
  return patterns;
}

function buildProjectKeywords(projects: Record<string, any>): Record<string, string[]> {
  const keywords: Record<string, string[]> = {};
  for (const [name, project] of Object.entries(projects)) {
    const proj = project as any;
    if (proj.keywords && Array.isArray(proj.keywords)) {
      keywords[name] = proj.keywords;
    }
  }
  return keywords;
}

function tryParseJsonSafe(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

function parseStackFrames(stackText: string): StackFrame[] {
  const frames: StackFrame[] = [];
  const frameRegex = /at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/g;
  let match;
  while ((match = frameRegex.exec(stackText)) !== null) {
    frames.push({
      function: match[1] || '<anonymous>',
      file: match[2],
      line: parseInt(match[3], 10),
      column: parseInt(match[4], 10),
    });
  }
  return frames;
}

function extractErrorMessage(stackText: string): string {
  const firstLine = stackText.split('\n')[0].trim();
  const cleaned = firstLine.replace(/^["\\]+/, '').replace(/["\\]+$/, '');
  const errorMatch = cleaned.match(/^(?:Error:\s*)?(.+)$/);
  return errorMatch ? errorMatch[1] : cleaned;
}

function extractErrorStacks(entries: NormalizedEntry[]): ErrorStack[] {
  const stacks: ErrorStack[] = [];

  for (const entry of entries) {
    const summary = entry.summary;
    const raw = entry.raw;

    let stackText: string | null = null;

    if (summary.error && typeof summary.error === 'string' && summary.error.includes('\n')) {
      stackText = summary.error;
    }

    if (!stackText) {
      const rawContent = typeof raw === 'string' ? raw : raw?.content || raw?.LogJson || raw?.RawLog || '';
      const parsed = typeof rawContent === 'string' ? tryParseJsonSafe(rawContent) : rawContent;
      const contentStr = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
      const stackMatch = contentStr.match(/"stack"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (stackMatch) {
        stackText = stackMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
    }

    if (!stackText) {
      const extra = entry.raw?.extra || entry.raw?.LogJson?.extra;
      if (extra?.stack && typeof extra.stack === 'string') {
        stackText = extra.stack;
      }
    }

    if (stackText) {
      const frames = parseStackFrames(stackText);
      if (frames.length > 0) {
        stacks.push({
          time: summary.time,
          source: summary.sourceName,
          layer: summary.layer,
          message: extractErrorMessage(stackText),
          frames,
          topFrame: frames[0] || null,
          traceId: summary.traceId,
          taskId: summary.taskId,
        });
      }
    }
  }

  return stacks;
}

const UUID_TASK_FIELDS = ['renderTaskId', 'taskId', 'workTaskId', 'batchWorkTaskId'];
const UUID_REGEX = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;

const SUCCESS_KEYWORDS = ['success', 'completed', 'succeeded'];
const FAILURE_KEYWORDS = ['failed', 'error', 'failure'];

function extractSubTasks(entries: NormalizedEntry[]): SubTaskSummary {
  const taskPatterns = buildTaskPatterns();
  const taskMap = new Map<string, SubTask>();

  for (const entry of entries) {
    const summary = entry.summary;
    const content = `${summary.content || ''} ${summary.error || ''}`;
    const rawContent = JSON.stringify(entry.raw || '');

    const taskId = summary.taskId || '';
    const searchContent = `${taskId} ${content}`;

    for (const pattern of taskPatterns) {
      const matches = searchContent.match(new RegExp(pattern.regex.source, 'gi')) || [];
      for (const match of matches) {
        const normalizedId = match.toLowerCase();
        if (!taskMap.has(normalizedId)) {
          taskMap.set(normalizedId, {
            id: match,
            type: pattern.type,
            status: 'unknown',
            error: null,
            time: summary.time,
            source: summary.sourceName,
            layer: summary.layer,
            traceId: summary.traceId,
            uid: summary.uid,
          });
        }
        updateTaskStatus(taskMap.get(normalizedId)!, summary, content);
      }
    }

    for (const field of UUID_TASK_FIELDS) {
      const fieldRegex = new RegExp(`"${field}"\\s*:\\s*"(${UUID_REGEX.source})"`, 'i');
      const match = rawContent.match(fieldRegex);
      if (match) {
        const uuid = match[1];
        const normalizedId = uuid.toLowerCase();
        if (!taskMap.has(normalizedId)) {
          taskMap.set(normalizedId, {
            id: uuid,
            type: 'uuid',
            status: 'unknown',
            error: null,
            time: summary.time,
            source: summary.sourceName,
            layer: summary.layer,
            traceId: summary.traceId,
            uid: summary.uid,
          });
        }
        updateTaskStatus(taskMap.get(normalizedId)!, summary, content);
      }
    }
  }

  const failed: SubTask[] = [];
  const completed: SubTask[] = [];
  const processing: SubTask[] = [];
  const unknown: SubTask[] = [];

  for (const task of taskMap.values()) {
    switch (task.status) {
      case 'failed':
        failed.push(task);
        break;
      case 'completed':
        completed.push(task);
        break;
      case 'processing':
        processing.push(task);
        break;
      default:
        unknown.push(task);
    }
  }

  return {
    total: taskMap.size,
    failed,
    completed,
    processing,
    unknown,
    summary: `${completed.length} completed / ${failed.length} failed / ${processing.length} processing / ${unknown.length} unknown`,
  };
}

function updateTaskStatus(task: SubTask, summary: any, content: string): void {
  const lowerContent = content.toLowerCase();

  for (const keyword of FAILURE_KEYWORDS) {
    if (lowerContent.includes(keyword.toLowerCase())) {
      task.status = 'failed';
      task.error = summary.error || extractErrorMessageFromContent(content);
      task.time = summary.time;
      return;
    }
  }

  for (const keyword of SUCCESS_KEYWORDS) {
    if (lowerContent.includes(keyword.toLowerCase())) {
      if (task.status !== 'failed') {
        task.status = 'completed';
        task.time = summary.time;
      }
      return;
    }
  }

  if (summary.status) {
    const lowerStatus = summary.status.toLowerCase();
    if (lowerStatus === 'failed' || lowerStatus === 'fail') {
      task.status = 'failed';
      task.error = summary.error || task.error;
      task.time = summary.time;
    } else if (lowerStatus === 'completed' || lowerStatus === 'success') {
      if (task.status !== 'failed') {
        task.status = 'completed';
        task.time = summary.time;
      }
    } else if (lowerStatus === 'processing' || lowerStatus === 'running') {
      if (task.status === 'unknown') {
        task.status = 'processing';
      }
    }
  }
}

function extractErrorMessageFromContent(content: string): string {
  const errorMatch = content.match(/(?:error|failed)[:：]\s*(.+?)(?:\s*at\s+|\.|$)/i);
  if (errorMatch) {
    return errorMatch[1].trim().substring(0, 200);
  }
  return content.substring(0, 200);
}

const DEFAULT_HARD_FAILURE_PATTERNS: Record<string, { category: string; subtype: string }> = {
  'ResultReview.NotPass': { category: 'REVIEW', subtype: 'CONTENT_VIOLATION' },
  'Task.RenderFailed': { category: 'RENDER', subtype: 'RENDER_ERROR' },
  RenderFailed: { category: 'RENDER', subtype: 'RENDER_ERROR' },
  'Task.Failed': { category: 'RENDER', subtype: 'TASK_FAILED' },
  timeout: { category: 'TIMEOUT', subtype: 'DEADLINE_EXCEEDED' },
  'deadline exceeded': { category: 'TIMEOUT', subtype: 'DEADLINE_EXCEEDED' },
  'context deadline exceeded': { category: 'TIMEOUT', subtype: 'DEADLINE_EXCEEDED' },
  ECONNREFUSED: { category: 'NETWORK', subtype: 'CONNECTION_REFUSED' },
  ECONNRESET: { category: 'NETWORK', subtype: 'CONNECTION_RESET' },
  ETIMEDOUT: { category: 'NETWORK', subtype: 'CONNECTION_TIMEOUT' },
  'Service.Error': { category: 'DEPENDENCY', subtype: 'DOWNSTREAM_ERROR' },
  'file not found': { category: 'MEDIA', subtype: 'FILE_NOT_FOUND' },
  'codec error': { category: 'MEDIA', subtype: 'CODEC_ERROR' },
  'invalid media format': { category: 'MEDIA', subtype: 'INVALID_FORMAT' },
};

const DEFAULT_INFO_FAILURE_PATTERNS: Record<string, { category: string; subtype: string; severity: string }> = {
  'processing failed': { category: 'PROCESS', subtype: 'PROCESSING_FAILED', severity: 'HIGH' },
  'task failed': { category: 'PROCESS', subtype: 'TASK_FAILED', severity: 'HIGH' },
  'callback failed': { category: 'CALLBACK', subtype: 'CALLBACK_FAILED', severity: 'HIGH' },
  'submit failed': { category: 'SUBMIT', subtype: 'SUBMIT_FAILED', severity: 'HIGH' },
  'download failed': { category: 'MATERIAL', subtype: 'DOWNLOAD_FAILED', severity: 'HIGH' },
  'resource unreachable': { category: 'MATERIAL', subtype: 'RESOURCE_UNREACHABLE', severity: 'HIGH' },
  'unsupported format': { category: 'PARAM', subtype: 'FORMAT_UNSUPPORTED', severity: 'HIGH' },
};

interface LoadedPatterns {
  hardFailure: Record<string, { category: string; subtype: string }>;
  infoFailure: Record<string, { category: string; subtype: string; severity: string }>;
}

let _patternsCache: LoadedPatterns | null = null;

function loadSignalPatterns(): LoadedPatterns {
  if (_patternsCache) return _patternsCache;
  try {
    const file = path.join(__dirname, '..', '..', 'config', 'signal-patterns.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    _patternsCache = {
      hardFailure: config.hardFailurePatterns || DEFAULT_HARD_FAILURE_PATTERNS,
      infoFailure: config.infoFailurePatterns || DEFAULT_INFO_FAILURE_PATTERNS,
    };
  } catch {
    _patternsCache = {
      hardFailure: DEFAULT_HARD_FAILURE_PATTERNS,
      infoFailure: DEFAULT_INFO_FAILURE_PATTERNS,
    };
  }
  return _patternsCache;
}

function extractHardFailures(entries: NormalizedEntry[]): HardFailure[] {
  const failures: HardFailure[] = [];

  for (const entry of entries) {
    const summary = entry.summary;
    const content = `${summary.code || ''} ${summary.error || ''} ${summary.content || ''}`.toLowerCase();

    for (const [pattern, classification] of Object.entries(loadSignalPatterns().hardFailure) as [
      string,
      { category: string; subtype: string },
    ][]) {
      if (content.includes(pattern.toLowerCase())) {
        failures.push({
          time: summary.time,
          source: summary.sourceName,
          layer: summary.layer,
          signalType: 'HARD_FAILURE',
          category: classification.category,
          subtype: classification.subtype,
          code: summary.code,
          error: summary.error,
          extractedFields: extractCriticalFields(entry),
          raw: {
            traceId: summary.traceId,
            taskId: summary.taskId,
            requestId: summary.requestId,
          },
        });
        break;
      }
    }
  }

  return failures;
}

function extractInfoFailures(entries: NormalizedEntry[]): InfoFailure[] {
  const failures: InfoFailure[] = [];

  for (const entry of entries) {
    const summary = entry.summary;
    const content = `${summary.content || ''} ${summary.error || ''} ${summary.code || ''}`;

    for (const [pattern, classification] of Object.entries(loadSignalPatterns().infoFailure) as [
      string,
      { category: string; subtype: string; severity: string },
    ][]) {
      if (content.toLowerCase().includes(pattern.toLowerCase())) {
        failures.push({
          time: summary.time,
          source: summary.sourceName,
          layer: summary.layer,
          signalType: 'INFO_FAILURE',
          category: classification.category,
          subtype: classification.subtype,
          severity: classification.severity,
          message: extractInfoFailureMessage(content, pattern),
          code: summary.code,
          raw: {
            traceId: summary.traceId,
            taskId: summary.taskId,
            requestId: summary.requestId,
          },
        });
        break;
      }
    }
  }

  return failures;
}

function extractInfoFailureMessage(content: string, pattern: string): string {
  const sentences = content.split(/[|,;.\n]/);
  for (const sentence of sentences) {
    if (sentence.toLowerCase().includes(pattern.toLowerCase())) {
      return sentence.trim();
    }
  }
  return pattern;
}

function extractCriticalFields(entry: NormalizedEntry): AnyRecord {
  const raw = entry.raw || {};
  const rawContent = JSON.stringify(raw);
  const fields: AnyRecord = {};

  const outputMatch = rawContent.match(/"output"[:\s]*([^,}]+)/);
  if (outputMatch) {
    fields.output = outputMatch[1].trim().replace(/^"/, '').replace(/"$/, '');
    fields.outputIsEmpty = !fields.output || fields.output === 'null' || fields.output === '""';
  }

  const reviewMatch = rawContent.match(/"reviewStatus"[:\s]*"([^"]+)"/);
  if (reviewMatch) {
    fields.reviewStatus = reviewMatch[1];
  }

  const nodeMatch = rawContent.match(/"nodeIndex"[:\s]*(\d+)/);
  if (nodeMatch) {
    fields.nodeIndex = parseInt(nodeMatch[1], 10);
  }

  return fields;
}

function extractStateTransitions(entries: NormalizedEntry[]): StateTransition[] {
  const transitions: StateTransition[] = [];
  const seenStates = new Set<string>();

  const sorted = [...entries].sort((a, b) => {
    const timeA = new Date((a.summary.time as string) || 0).getTime();
    const timeB = new Date((b.summary.time as string) || 0).getTime();
    return timeA - timeB;
  });

  for (const entry of sorted) {
    const summary = entry.summary;
    const status = summary.status;

    if (status && !seenStates.has(status)) {
      seenStates.add(status);
      transitions.push({
        time: summary.time,
        source: summary.sourceName,
        layer: summary.layer,
        state: status,
        event: summary.event,
      });
    }
  }

  return transitions;
}

function extractCrossProjectMentions(entries: NormalizedEntry[], currentProject: string): CrossProjectMention[] {
  const projects = readProjectsConfig();
  const projectKeywords = buildProjectKeywords(projects);
  const mentions: CrossProjectMention[] = [];

  for (const entry of entries) {
    const summary = entry.summary;
    const content = `${summary.content || ''} ${summary.error || ''}`.toLowerCase();

    for (const [project, keywords] of Object.entries(projectKeywords)) {
      if (project === currentProject) continue;

      for (const keyword of keywords) {
        if (content.includes(keyword.toLowerCase())) {
          mentions.push({
            time: summary.time,
            source: summary.sourceName,
            mentionedService: project,
            context: summary.content?.substring(0, 100),
            traceId: summary.traceId,
            taskId: summary.taskId,
          });
          break;
        }
      }
    }
  }

  return mentions;
}

function extractDownstreamTargets(crossProjectMentions: CrossProjectMention[]): string[] {
  const targets = new Set<string>();
  for (const mention of crossProjectMentions) {
    targets.add(mention.mentionedService);
  }
  return Array.from(targets);
}

function classifyErrorPattern(
  entries: NormalizedEntry[],
  hardFailures: HardFailure[],
  infoFailures: InfoFailure[],
  crossProjectMentions: CrossProjectMention[],
): ErrorClassification {
  const result: ErrorClassification = {
    category: 'UNKNOWN',
    subcategory: null,
    confidence: 'low',
    message: null,
    shouldQueryDownstream: false,
    downstreamTargets: [],
    action: 'Manual analysis required',
  };

  const paramPatterns = [
    { pattern: 'invalid parameter', category: 'PARAM_VALIDATION', message: 'Invalid parameter' },
    { pattern: 'validation failed', category: 'PARAM_VALIDATION', message: 'Validation failed' },
    { pattern: 'unsupported format', category: 'PARAM_VALIDATION', message: 'Unsupported format' },
    { pattern: 'invalid character', category: 'PARAM_VALIDATION', message: 'Invalid character' },
  ];

  const allContent = entries.map((e) => `${e.summary?.content || ''} ${e.summary?.error || ''}`).join(' ');
  for (const { pattern, category, message } of paramPatterns) {
    if (allContent.toLowerCase().includes(pattern.toLowerCase())) {
      result.category = category;
      result.subcategory = pattern;
      result.confidence = 'high';
      result.message = message;
      result.shouldQueryDownstream = false;
      result.action = 'Entry-level parameter issue, no downstream tracking needed';
      return result;
    }
  }

  const timeoutPatterns = ['timeout', 'deadline exceeded', 'context deadline exceeded'];
  const hasTimeout = timeoutPatterns.some((p) => allContent.toLowerCase().includes(p.toLowerCase()));
  if (hasTimeout) {
    result.category = 'TIMEOUT';
    result.confidence = 'medium';
    result.message = 'Service timeout';
    result.shouldQueryDownstream = true;
    result.downstreamTargets = extractDownstreamTargets(crossProjectMentions);
    result.action =
      result.downstreamTargets.length > 0
        ? `Query downstream to confirm timeout source: ${result.downstreamTargets.join(', ')}`
        : 'Check current service internal execution time';
    return result;
  }

  const dependencyFailures = hardFailures.filter((f) => f.category === 'DEPENDENCY');
  if (dependencyFailures.length > 0) {
    result.category = 'DEPENDENCY_ERROR';
    result.confidence = 'medium';
    result.message = 'Downstream service call failed';
    result.shouldQueryDownstream = true;
    result.downstreamTargets = extractDownstreamTargets(crossProjectMentions);
    result.action =
      result.downstreamTargets.length > 0
        ? `Query downstream for real failure reason: ${result.downstreamTargets.join(', ')}`
        : 'Check downstream service connection status';
    return result;
  }

  const renderFailures = [...hardFailures, ...infoFailures].filter(
    (f) => f.category === 'RENDER' || f.subtype?.includes('PACKAGING') || f.subtype?.includes('RENDER'),
  );
  if (renderFailures.length > 0) {
    result.category = 'RENDER_FAILURE';
    result.confidence = 'medium';
    result.message = (renderFailures[0] as any).message || (renderFailures[0] as any).error || 'Render failed';
    result.shouldQueryDownstream = true;
    result.downstreamTargets = extractDownstreamTargets(crossProjectMentions);
    result.action = 'Confirm whether render service was reached, query relevant downstream logs';
    return result;
  }

  const reviewFailures = hardFailures.filter((f) => f.category === 'REVIEW');
  if (reviewFailures.length > 0) {
    result.category = 'CONTENT_REVIEW';
    result.confidence = 'high';
    result.message = 'Content review failed';
    result.shouldQueryDownstream = false;
    result.action = 'Extract user input and analyze sensitive content, no downstream tracking needed';
    return result;
  }

  if (hardFailures.length > 0) {
    result.category = 'HARD_FAILURE';
    result.confidence = 'low';
    result.message = (hardFailures[0].error || hardFailures[0].code) ?? null;
    result.shouldQueryDownstream = true;
    result.downstreamTargets = extractDownstreamTargets(crossProjectMentions);
    result.action = 'Analyze error stack and context, confirm failure location';
    return result;
  }

  if (infoFailures.length > 0) {
    result.category = 'BUSINESS_FAILURE';
    result.confidence = 'medium';
    result.message = (infoFailures[0].message || infoFailures[0].subtype) ?? null;
    result.shouldQueryDownstream = true;
    result.downstreamTargets = extractDownstreamTargets(crossProjectMentions);
    result.action = 'INFO level failure, need context to determine if this is the final failure point';
    return result;
  }

  return result;
}

export function extractSignals(hits: QueryHit[], projectConfig: ProjectConfig): SignalExtraction {
  const allEntries = hits.flatMap((hit) =>
    (hit.body || []).map((entry) => ({
      ...entry,
      _sourceAlias: hit.source?.alias || hit.source?.name,
    })),
  );

  const hardFailures = extractHardFailures(allEntries);
  const infoFailures = extractInfoFailures(allEntries);
  const stateTransitions = extractStateTransitions(allEntries);
  const crossProjectMentions = extractCrossProjectMentions(allEntries, projectConfig.name);
  const errorStacks = extractErrorStacks(allEntries);
  const subTasks = extractSubTasks(allEntries);
  const errorClassification = classifyErrorPattern(allEntries, hardFailures, infoFailures, crossProjectMentions);

  return {
    hardFailures,
    infoFailures,
    stateTransitions,
    crossProjectMentions,
    errorStacks,
    subTasks,
    errorClassification,
    meta: {
      totalEntries: allEntries.length,
      project: projectConfig.name,
      extractedAt: new Date().toISOString(),
    },
  };
}

const NOISE_EVENT_PATTERNS = ['getUserInfo', 'slow request', 'healthcheck', 'heartbeat', 'health', 'ping', 'metrics'];

const KEY_EVENT_PATTERNS = ['render', 'callback', 'failed', 'workflow', 'task', 'submit', 'process', 'create'];

export function filterNoiseEvents(entries: NormalizedEntry[]): NormalizedEntry[] {
  return entries.filter((entry) => {
    const summary = entry.summary || {};
    const event = (summary.event || '').toLowerCase();
    const content = (summary.content || '').toLowerCase();
    const text = `${event} ${content}`;

    for (const pattern of NOISE_EVENT_PATTERNS) {
      if (text.includes(pattern.toLowerCase())) {
        return false;
      }
    }

    for (const pattern of KEY_EVENT_PATTERNS) {
      if (text.includes(pattern.toLowerCase())) {
        return true;
      }
    }

    return true;
  });
}

export {
  DEFAULT_HARD_FAILURE_PATTERNS as HARD_FAILURE_PATTERNS,
  DEFAULT_INFO_FAILURE_PATTERNS as INFO_FAILURE_PATTERNS,
  loadSignalPatterns,
  extractHardFailures,
  extractInfoFailures,
  extractStateTransitions,
  extractCrossProjectMentions,
  extractErrorStacks,
  extractSubTasks,
  classifyErrorPattern,
};
