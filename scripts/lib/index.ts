import fs from 'fs';
import path from 'path';

import type { ProjectConfig, ProjectDefinition } from './types';

import * as tencentcloud from 'tencentcloud-sdk-nodejs';
import * as sls from '@alicloud/sls20201230';
import { $OpenApiUtil } from '@alicloud/openapi-core';
import { tlsOpenapi } from '@volcengine/openapi';

const SlsClient = sls.default;
const ClsClient = tencentcloud.cls.v20201016.Client;
const TlsService = tlsOpenapi.TlsService;

const SLS_REGION_ENDPOINTS: Record<string, string> = {
  'cn-beijing': 'cn-beijing.log.aliyuncs.com',
  'cn-shenzhen': 'cn-shenzhen.log.aliyuncs.com',
  'cn-shanghai': 'cn-shanghai.log.aliyuncs.com',
  'cn-hangzhou': 'cn-hangzhou.log.aliyuncs.com',
  'cn-chengdu': 'cn-chengdu.log.aliyuncs.com',
  'ap-southeast-1': 'ap-southeast-1.log.aliyuncs.com',
  'ap-northeast-1': 'ap-northeast-1.log.aliyuncs.com',
  'us-west-1': 'us-west-1.log.aliyuncs.com',
  'eu-central-1': 'eu-central-1.log.aliyuncs.com',
};

let _projectsCache: Record<string, ProjectDefinition> | null = null;

export function readProjectsConfig(): Record<string, ProjectDefinition> {
  if (!_projectsCache) {
    const file = path.join(__dirname, '..', '..', 'config', 'projects.json');
    _projectsCache = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return _projectsCache!;
}

export function getProjectConfig(projectName: string, env: string): ProjectConfig {
  const projects = readProjectsConfig();
  const project = projects[projectName];
  if (!project) {
    throw new Error(`Unknown project ${projectName}`);
  }

  const envConfig = project.envs && project.envs[env];
  if (!envConfig) {
    throw new Error(`Unsupported env ${env} for project ${projectName}`);
  }

  return {
    name: projectName,
    env,
    vendor: envConfig.vendorOverride || project.vendor,
    queryBackend: envConfig.backendOverride || project.queryBackend,
    downstream: project.downstream || [],
    keywords: project.keywords || [],
    taskPatterns: project.taskPatterns || [],
    region: envConfig.region,
    projectId: envConfig.projectId || '',
    sources: envConfig.sources || [],
    signalPatterns: project.signalPatterns || undefined,
  };
}

export function buildSlsClient(region: string) {
  const accessKeyId = process.env.SLS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.SLS_ACCESS_KEY_SECRET;
  if (!accessKeyId || !accessKeySecret) {
    throw new Error('Missing SLS_ACCESS_KEY_ID or SLS_ACCESS_KEY_SECRET');
  }
  const endpoint = SLS_REGION_ENDPOINTS[region] || region;
  return new SlsClient(
    new $OpenApiUtil.Config({ accessKeyId, accessKeySecret, endpoint, readTimeout: 30_000, connectTimeout: 10_000 }),
  );
}

export function buildClsClient(region: string) {
  const secretId = process.env.CLS_SECRET_ID;
  const secretKey = process.env.CLS_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new Error('Missing CLS_SECRET_ID or CLS_SECRET_KEY');
  }
  return new ClsClient({
    credential: { secretId, secretKey },
    region,
    profile: { httpProfile: { endpoint: 'cls.tencentcloudapi.com', reqTimeout: 30 } },
  });
}

export function buildTlsClient(region: string) {
  const accessKeyId = process.env.TLS_ACCESS_KEY_ID;
  const secretKey = process.env.TLS_ACCESS_KEY_SECRET;
  const sessionToken = process.env.TLS_SESSION_TOKEN;
  const host = process.env.TLS_HOST;

  if (!accessKeyId || !secretKey) {
    throw new Error('Missing TLS_ACCESS_KEY_ID or TLS_ACCESS_KEY_SECRET');
  }
  if (!host) {
    throw new Error('Missing TLS_HOST (required for Volcengine TLS)');
  }

  return new TlsService({
    host,
    region,
    accessKeyId,
    secretKey,
    sessionToken,
  });
}

function quoteTerm(value: string | number | undefined): string {
  return String(value || '').trim();
}

export function buildKeywordQueries(order: string[] | undefined, termsByKey: Record<string, string>): string[] {
  const queries: string[] = [];
  const seen = new Set<string>();

  for (const template of order || []) {
    let query = template;
    for (const [key, value] of Object.entries(termsByKey)) {
      query = query.replaceAll(key, quoteTerm(value));
    }
    if (/\b(traceId|taskId|requestId|uid|userId|renderTaskId)\b/.test(query)) {
      continue;
    }
    query = query
      .replace(/\band\b/gi, 'AND')
      .replace(/\bor\b/gi, 'OR')
      .replace(/\bnot\b/gi, 'NOT');
    query = query.replace(/\s+/g, ' ').trim();
    if (!query || seen.has(query)) {
      continue;
    }
    seen.add(query);
    queries.push(query);
  }

  for (const value of Object.values(termsByKey)) {
    const query = quoteTerm(value);
    if (query && !seen.has(query)) {
      seen.add(query);
      queries.push(query);
    }
  }

  return queries;
}

export function tryParseJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function extractEmbeddedJson(content: unknown): unknown {
  if (typeof content !== 'string') {
    return null;
  }
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) {
    return tryParseJson(trimmed);
  }
  const firstBrace = trimmed.indexOf('{');
  if (firstBrace === -1) {
    return null;
  }
  return tryParseJson(trimmed.slice(firstBrace));
}

export function toSingleLine(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : JSON.stringify(value);
}
