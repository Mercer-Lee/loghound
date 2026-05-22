// --- Config types ---

export interface TaskPattern {
  type: string;
  regex: string;
}

export interface SourceConfig {
  name: string;
  alias?: string;
  layer: string;
  purpose?: string;
}

export interface EnvConfig {
  vendorOverride?: string;
  backendOverride?: string;
  region: string;
  projectId?: string;
  sources?: SourceConfig[];
}

export interface ProjectDefinition {
  vendor: string;
  queryBackend: string;
  downstream?: string[];
  keywords?: string[];
  taskPatterns?: TaskPattern[];
  multiEnvs?: string[];
  envs: Record<string, EnvConfig>;
}

export interface ProjectConfig {
  name: string;
  env: string;
  vendor: string;
  queryBackend: string;
  downstream: string[];
  keywords: string[];
  taskPatterns: TaskPattern[];
  region: string;
  projectId: string;
  sources: SourceConfig[];
}

// --- Log entry types ---

export interface LogSummary {
  time: string | number | undefined;
  level: string | undefined;
  event: string | undefined;
  content: string;
  traceId: string;
  taskId: string;
  requestId: string;
  uid: string;
  userNo?: string;
  status: string | undefined;
  type: string | undefined;
  code: string | undefined;
  error: string | undefined;
  prompt?: string;
  layer: string;
  sourceName: string;
  sourceKind: string;
  hostName: string;
  podName: string;
  containerName: string;
  workflowName?: string;
  executionId?: string;
  nodeStep?: number;
  duration?: string;
  index?: number;
}

export interface NormalizedEntry {
  summary: LogSummary;
  raw: any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRecord = Record<string, any>;

// --- Query result types ---

export interface QueryHit {
  source: SourceConfig & { alias: string };
  query: string;
  count: number;
  body: NormalizedEntry[];
  error?: string;
  requestId?: string;
  resultStatus?: string;
  errorCount?: number;
}

// --- Signal types ---

export interface HardFailure {
  time: string | number | undefined;
  source: string;
  layer: string;
  signalType: 'HARD_FAILURE';
  category: string;
  subtype: string;
  code: string | undefined;
  error: string | undefined;
  extractedFields: AnyRecord;
  raw: {
    traceId: string;
    taskId: string;
    requestId: string;
  };
}

export interface InfoFailure {
  time: string | number | undefined;
  source: string;
  layer: string;
  signalType: 'INFO_FAILURE';
  category: string;
  subtype: string;
  severity: string;
  message: string;
  code: string | undefined;
  raw: {
    traceId: string;
    taskId: string;
    requestId: string;
  };
}

export interface StateTransition {
  time: string | number | undefined;
  source: string;
  layer: string;
  state: string;
  event: string | undefined;
}

export interface CrossProjectMention {
  time: string | number | undefined;
  source: string;
  mentionedService: string;
  context: string | undefined;
  traceId: string;
  taskId: string;
}

export interface StackFrame {
  function: string;
  file: string;
  line: number;
  column: number;
}

export interface ErrorStack {
  time: string | number | undefined;
  source: string;
  layer: string;
  message: string;
  frames: StackFrame[];
  topFrame: StackFrame | null;
  traceId: string;
  taskId: string;
}

export interface SubTask {
  id: string;
  type: string;
  status: 'unknown' | 'failed' | 'completed' | 'processing';
  error: string | null;
  time: string | number | undefined;
  source: string;
  layer: string;
  traceId: string;
  uid: string;
}

export interface SubTaskSummary {
  total: number;
  failed: SubTask[];
  completed: SubTask[];
  processing: SubTask[];
  unknown: SubTask[];
  summary: string;
}

export interface ErrorClassification {
  category: string;
  subcategory: string | null;
  confidence: string;
  message: string | null;
  shouldQueryDownstream: boolean;
  downstreamTargets: string[];
  action: string;
}

export interface SignalExtraction {
  hardFailures: HardFailure[];
  infoFailures: InfoFailure[];
  stateTransitions: StateTransition[];
  crossProjectMentions: CrossProjectMention[];
  errorStacks: ErrorStack[];
  subTasks: SubTaskSummary;
  errorClassification: ErrorClassification;
  meta: {
    totalEntries: number;
    project: string;
    extractedAt: string;
  };
}

// --- Cluster types ---

export interface ErrorCluster {
  pattern: string;
  count: number;
  category: string;
  firstOccurrence: string | null;
  lastOccurrence: string | null;
  representative: {
    time: string | number | undefined;
    source: string;
    layer: string;
    level: string | undefined;
    code: string | undefined;
    error: string | undefined;
    content: string | undefined;
    traceId: string;
    taskId: string;
  };
  samples?: Array<{
    time: string | number | undefined;
    source: string;
    traceId: string;
    taskId: string;
  }>;
}

// --- Hint types ---

export interface AlternativeHypothesis {
  hypothesis: string;
  likelihood: string;
  why: string;
}

export interface AnalysisHints {
  currentBestHypothesis: string | null;
  confidence: string;
  reasoning: string[];
  supportingEvidence: AnyRecord[];
  missingInformation: string[];
  suggestedNextAction: string | null;
  shouldQueryDownstream: boolean;
  downstreamSuggestions: string[];
  alternativeHypotheses: AlternativeHypothesis[];
}

// --- Timeline types ---

export interface TimelineEntry {
  timestamp: number;
  time: string | number | undefined;
  layer: string;
  source: string;
  level: string;
  event: string;
  content: string;
  status: string;
  error: string;
  traceId: string;
  taskId: string;
  requestId: string;
  uid: string;
  nodeStep?: number;
}

export interface StageEvent {
  time: string | number | undefined;
  source: string;
  layer: string;
  event: string;
  content: string;
}

export interface StageHints {
  firstVisibleEvent: StageEvent | null;
  lastVisibleEvent: (StageEvent & { status: string }) | null;
  lastErrorEvent: (StageEvent & { error: string }) | null;
}

// --- Query hint types ---

export interface QueryHint {
  type: string;
  message: string;
  suggestedQuery?: string;
  failedTaskIds?: string[];
}

export interface FallbackInfo {
  originalQuery: string;
  fallbackQuery: string;
  reason: string;
}

// --- Result types ---

export interface PreprocessResult {
  query: {
    project: string;
    env: string;
    query: string;
    hours: number;
    lines: number;
    backend: string;
    taskId?: string;
    apiUrl?: string;
    preferredApiUrl?: string;
    fallbackApiUrl?: string;
    route?: string;
  };
  sources: Array<{
    name: string;
    alias: string;
    layer: string;
    purpose: string;
  }>;
  matchedSourceCount: number;
  failedSourceCount: number;
  extractedIdentifiers: Record<string, string>;
  stageHints: StageHints;
  signalExtraction: SignalExtraction;
  errorClusters: ErrorCluster[];
  analysisHints: AnalysisHints;
  fallbackInfo: FallbackInfo | null;
  queryHints: QueryHint[];
  timeline: TimelineEntry[];
  sourceErrors: Array<{ source: string; layer: string; error: string }>;
  hits: QueryHit[];
  rawResponse?: unknown;
}

// --- Fetch args types ---

export interface FetchLogsArgs {
  project: string;
  env: string;
  query: string;
  hours: number;
  lines: number;
  json: boolean;
  autoFallback: boolean;
  _fallbackInfo?: FallbackInfo;
}

export interface FetchWebhookArgs {
  taskId: string;
  apiUrl: string | undefined;
  errorApiUrl: string | undefined;
  timeoutMs: number;
  json: boolean;
}

export interface FetchSqlArgs {
  query: string;
  table: string;
  lookupField: string;
  returnFields: string;
  env: string;
  json: boolean;
}

export interface FetchMongoArgs {
  query: string;
  collection: string;
  lookupField: string;
  returnFields?: string;
  env: string;
  json: boolean;
}

export interface LookupResult {
  success: boolean;
  lookupValue: string;
  error?: string;
  [key: string]: unknown;
}
