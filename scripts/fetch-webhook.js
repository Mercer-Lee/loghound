#!/usr/bin/env node
require('dotenv').config();
const { toSingleLine, tryParseJson } = require('./lib');

function parseArgs(argv) {
  const out = {
    taskId: '',
    apiUrl: process.env.WEBHOOK_API_URL,
    errorApiUrl: process.env.WEBHOOK_ERROR_API_URL,
    timeoutMs: 15000,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const cur = argv[i];
    const next = argv[i + 1];
    if (cur === '--taskId' && next) {
      out.taskId = next;
      i += 1;
    } else if (cur === '--api-url' && next) {
      out.apiUrl = next;
      i += 1;
    } else if (cur === '--error-api-url' && next) {
      out.errorApiUrl = next;
      i += 1;
    } else if (cur === '--timeout-ms' && next) {
      out.timeoutMs = Number(next);
      i += 1;
    } else if (cur === '--json') {
      out.json = true;
    }
  }

  if (!out.taskId) {
    throw new Error('Missing required --taskId');
  }

  return out;
}

function parseResponseBody(text) {
  const json = tryParseJson(text);
  if (json !== null) {
    return json;
  }
  return { rawText: text };
}

function findFirstValue(input, keys) {
  const queue = [input];
  const seen = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') {
      continue;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    for (const key of keys) {
      const value = current[key];
      if (value !== undefined && value !== null && value !== '') {
        return value;
      }
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item);
      }
      continue;
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }

  return '';
}

function parseNodeOutput(output) {
  const parts = String(output || '')
    .split(' | ')
    .map((part) => part.trim())
    .filter(Boolean);
  const fields = {};

  for (const part of parts) {
    const idx = part.indexOf(':');
    if (idx === -1) {
      continue;
    }
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key && value !== undefined) {
      fields[key] = value;
    }
  }

  if (fields.result) {
    const taskIdMatch = fields.result.match(/"taskId":"([^"]+)"/);
    const executionIdMatch = fields.result.match(/"executionId":"([^"]+)"/);
    const statusMatch = fields.result.match(/"status":"([^"]+)"/);
    const codeMatch = fields.result.match(/"code":"([^"]+)"/);
    const messageMatch = fields.result.match(/"message":"([^"]+)/);
    if (taskIdMatch && !fields.taskId) fields.taskId = taskIdMatch[1];
    if (executionIdMatch && !fields.executionId) fields.executionId = executionIdMatch[1];
    if (statusMatch && !fields.status) fields.status = statusMatch[1];
    if (codeMatch && !fields.code) fields.code = codeMatch[1];
    if (messageMatch && !fields.message) fields.message = messageMatch[1];
  }

  if (fields.body) {
    const bodyStatusMatch = fields.body.match(/"status":(\d+)/);
    const taskIdMatch = fields.body.match(/"task_id":"([^"]+)"/);
    if (bodyStatusMatch && !fields.bodyStatus) fields.bodyStatus = bodyStatusMatch[1];
    if (taskIdMatch && !fields.taskId) fields.taskId = taskIdMatch[1];
  }

  return fields;
}

function parseTimelineReport(report, payload, fallbackTaskId) {
  if (typeof report !== 'string' || !report.trim()) {
    return [];
  }

  const executionId = payload.execution_id || payload.executionId || '';
  const workflowId = payload.workflow_id || payload.workflowId || '';

  const nodePattern = /(\d+)\.\[(.*?) \| duration:([^\]]+)\] node: ([^\n]+)\n\s*output: ([\s\S]*?)(?=\n\d+\.\[|$)/g;
  const entries = [];
  let match;

  while ((match = nodePattern.exec(report)) !== null) {
    const [, step, nodeStatusText, duration, nodeName, output] = match;
    const fields = parseNodeOutput(output.trim());
    const status = fields.status || (nodeStatusText.includes('failed') || nodeStatusText.includes('失败') ? 'failed' : nodeStatusText.includes('success') || nodeStatusText.includes('成功') ? 'success' : '');
    const code = fields.code || '';
    const error = fields.message || fields.error || (status === 'failed' ? output.trim() : '');
    const taskId = fields.taskId || fallbackTaskId;
    const derivedExecutionId = fields.executionId || executionId;
    const contentParts = [
      `node: ${nodeName.trim()}`,
      `status: ${nodeStatusText.trim()}`,
      `duration: ${duration.trim()}`,
      output.trim(),
    ].filter(Boolean);

    entries.push({
      summary: {
        time: '',
        level: status === 'failed' ? 'ERROR' : 'INFO',
        event: nodeName.trim(),
        content: contentParts.join(' | '),
        traceId: '',
        taskId,
        requestId: '',
        uid: '',
        status,
        type: 'workflow-node',
        code,
        error,
        layer: 'workflow',
        sourceName: 'webhook-workflow',
        sourceKind: 'webhook',
        workflowName: workflowId,
        executionId: derivedExecutionId,
        nodeStep: Number(step),
        duration: duration.trim(),
      },
      raw: {
        step: Number(step),
        nodeStatusText,
        duration,
        nodeName: nodeName.trim(),
        output: output.trim(),
        fields,
      },
    });
  }

  return entries;
}

function findRecords(payload, fallbackTaskId) {
  const timelineEntries = parseTimelineReport(payload?.ai_timeline_report, payload, fallbackTaskId);
  if (timelineEntries.length > 0) {
    return timelineEntries;
  }

  const candidates = [
    payload,
    payload?.data,
    payload?.records,
    payload?.items,
    payload?.list,
    payload?.result,
    payload?.result?.records,
    payload?.result?.items,
    payload?.rows,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map((item) => ({ rawMode: true, item }));
    }
  }

  if (payload && typeof payload === 'object') {
    return [{ rawMode: true, item: payload }];
  }

  return [];
}

function normalizeGenericRecord(record, index, fallbackTaskId) {
  const time = findFirstValue(record, ['time', 'timestamp', 'createdAt', 'createTime', 'updatedAt', 'updateTime']);
  const level = findFirstValue(record, ['level', 'logLevel', 'severity']);
  const event = findFirstValue(record, ['event', 'action', 'node', 'nodeName', 'step', 'workflowNode']);
  const content = findFirstValue(record, ['content', 'message', 'msg', 'detail', 'errorMessage', 'reason', 'description']);
  const traceId = findFirstValue(record, ['traceId', 'trace_id', 'requestId', 'request_id']);
  const taskId = findFirstValue(record, ['taskId', 'task_id', 'id']) || fallbackTaskId;
  const uid = findFirstValue(record, ['uid', 'userId', 'user_id']);
  const status = findFirstValue(record, ['status', 'state', 'executionStatus', 'workflowStatus', 'final_status']);
  const type = findFirstValue(record, ['type', 'workflowType']);
  const code = findFirstValue(record, ['code', 'errorCode']);
  const error = findFirstValue(record, ['error', 'errorMessage', 'err', 'errMsg', 'reason']);
  const sourceName = findFirstValue(record, ['source', 'sourceName', 'node', 'nodeName']) || 'webhook-workflow';
  const workflowName = findFirstValue(record, ['workflowName', 'workflow', 'name', 'workflow_id']);
  const executionId = findFirstValue(record, ['executionId', 'execution_id', 'runId']);

  return {
    summary: {
      time,
      level,
      event,
      content,
      traceId,
      taskId,
      requestId: traceId,
      uid,
      status,
      type,
      code,
      error,
      layer: 'workflow',
      sourceName,
      sourceKind: 'webhook',
      workflowName,
      executionId,
      index,
    },
    raw: record,
  };
}

function normalizeRecord(record, index, fallbackTaskId) {
  if (record && record.summary && record.raw) {
    return record;
  }
  if (record && record.rawMode) {
    return normalizeGenericRecord(record.item, index, fallbackTaskId);
  }
  return normalizeGenericRecord(record, index, fallbackTaskId);
}

function extractIdentifiers(entries, fallbackTaskId) {
  const identifiers = { taskId: fallbackTaskId };
  for (const entry of entries) {
    const summary = entry.summary || {};
    for (const key of ['traceId', 'taskId', 'requestId', 'uid']) {
      if (!identifiers[key] && summary[key]) {
        identifiers[key] = summary[key];
      }
    }
  }
  return identifiers;
}

function toTimestamp(value) {
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
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildTimeline(entries) {
  return entries
    .map((entry) => ({
      timestamp: toTimestamp(entry.summary.time),
      time: entry.summary.time || '',
      layer: entry.summary.layer || 'workflow',
      source: entry.summary.sourceName || 'webhook-workflow',
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

function buildStageHints(timeline) {
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

function buildResult(args, payload, meta = {}) {
  const records = findRecords(payload, args.taskId);
  const hits = records.map((record, index) => normalizeRecord(record, index, args.taskId));
  const timeline = buildTimeline(hits);

  return {
    query: {
      project: 'webhook',
      env: 'prod',
      query: args.taskId,
      taskId: args.taskId,
      apiUrl: meta.apiUrl || args.apiUrl,
      backend: 'webhook',
      preferredApiUrl: args.errorApiUrl,
      fallbackApiUrl: args.apiUrl,
      route: meta.route || 'default',
    },
    sources: [
      {
        name: 'webhook-workflow',
        alias: 'webhook-workflow',
        layer: 'workflow',
        purpose: 'workflow execution records queried through webhook',
      },
    ],
    matchedSourceCount: hits.length > 0 ? 1 : 0,
    failedSourceCount: 0,
    extractedIdentifiers: extractIdentifiers(hits, args.taskId),
    stageHints: buildStageHints(timeline),
    timeline,
    sourceErrors: [],
    hits: hits.length > 0 ? [{
      source: { name: 'webhook-workflow', alias: 'webhook-workflow', layer: 'workflow' },
      query: args.taskId,
      count: hits.length,
      body: hits,
    }] : [],
    rawResponse: payload,
  };
}

async function requestWebhook(apiUrl, taskId, token, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-token': token } : {}),
      },
      body: JSON.stringify({ taskId }),
      signal: controller.signal,
    });

    const text = await response.text();
    const payload = parseResponseBody(text);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${toSingleLine(text)}`);
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function hasUsableHits(result) {
  return Boolean(result && Array.isArray(result.hits) && result.hits.length > 0 && result.hits.some((hit) => hit.count > 0));
}

async function fetchWebhook(args) {
  const token = process.env.WEBHOOK_TOKEN || '';

  // Try error-detail endpoint first if available
  if (args.errorApiUrl) {
    const errorPayload = await requestWebhook(args.errorApiUrl, args.taskId, token, args.timeoutMs);
    const errorResult = buildResult(args, errorPayload, { apiUrl: args.errorApiUrl, route: 'error-first' });
    if (hasUsableHits(errorResult)) {
      return errorResult;
    }
  }

  // Fallback to general endpoint
  if (!args.apiUrl) {
    throw new Error('Missing WEBHOOK_API_URL environment variable or --api-url argument');
  }
  const fallbackPayload = await requestWebhook(args.apiUrl, args.taskId, token, args.timeoutMs);
  return buildResult(args, fallbackPayload, { apiUrl: args.apiUrl, route: 'fallback-general' });
}

function printSummary(summary, index) {
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
    ['workflowName', summary.workflowName],
    ['executionId', summary.executionId],
    ['step', summary.nodeStep],
    ['duration', summary.duration],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');

  if (details.length) {
    console.log(`     ${details.map(([key, value]) => `${key}=${toSingleLine(value)}`).join(' | ')}`);
  }
}

function printHumanOutput(result) {
  console.log(`webhook/prod taskId=${result.query.taskId}`);

  if (!result.hits.length) {
    console.log('No matching workflow records found.');
    return;
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

  for (const hit of result.hits) {
    console.log(`\n[${hit.source.alias || hit.source.name}] ${hit.count} hit(s)`);
    hit.body.forEach((entry, index) => printSummary(entry.summary, index));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await fetchWebhook(args);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  printHumanOutput(result);
  if (!result.hits.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
