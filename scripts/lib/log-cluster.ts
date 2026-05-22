import type { ErrorCluster, NormalizedEntry, QueryHit } from './types';

function generateSignature(entry: NormalizedEntry): string {
  const summary = entry.summary;

  const code = summary.code || 'NONE';
  const error = (summary.error || '').substring(0, 50);
  const layer = summary.layer || 'unknown';
  const level = summary.level || 'INFO';

  if (level === 'ERROR' || level === 'WARN') {
    return `${layer}:${level}:${code}:${error}`;
  }

  const event = (summary.event || '').substring(0, 30);
  return `${layer}:${level}:${event}`;
}

function selectRepresentative(cluster: NormalizedEntry[]): NormalizedEntry {
  const withIds = cluster.filter((e) => e.summary.traceId || e.summary.taskId);

  if (withIds.length > 0) {
    return withIds.sort((a, b) => {
      const timeA = new Date((b.summary.time as string) || 0).getTime();
      const timeB = new Date((a.summary.time as string) || 0).getTime();
      return timeA - timeB;
    })[0];
  }

  return cluster[0];
}

export function clusterLogs(hits: QueryHit[], maxClusters = 10): ErrorCluster[] {
  const clusters = new Map<string, { signature: string; entries: NormalizedEntry[]; count: number }>();

  for (const hit of hits) {
    for (const entry of hit.body || []) {
      const signature = generateSignature(entry);

      if (!clusters.has(signature)) {
        clusters.set(signature, {
          signature,
          entries: [],
          count: 0,
        });
      }

      clusters.get(signature)!.entries.push(entry);
      clusters.get(signature)!.count++;
    }
  }

  const sortedClusters = Array.from(clusters.values())
    .sort((a, b) => {
      const aIsError = a.signature.includes('ERROR');
      const bIsError = b.signature.includes('ERROR');
      if (aIsError && !bIsError) return -1;
      if (!aIsError && bIsError) return 1;

      return b.count - a.count;
    })
    .slice(0, maxClusters);

  return sortedClusters.map((cluster) => {
    const representative = selectRepresentative(cluster.entries);
    const summary = representative.summary;

    const times = cluster.entries
      .map((e) => new Date((e.summary.time as string) || 0).getTime())
      .filter((t) => !isNaN(t));

    return {
      pattern: cluster.signature,
      count: cluster.count,
      category: inferCategory(cluster.signature),
      firstOccurrence: times.length > 0 ? new Date(Math.min(...times)).toISOString() : null,
      lastOccurrence: times.length > 0 ? new Date(Math.max(...times)).toISOString() : null,
      representative: {
        time: summary.time,
        source: summary.sourceName,
        layer: summary.layer,
        level: summary.level,
        code: summary.code,
        error: summary.error,
        content: summary.content?.substring(0, 200),
        traceId: summary.traceId,
        taskId: summary.taskId,
      },
      samples:
        cluster.count > 1
          ? cluster.entries.slice(0, 3).map((e) => ({
              time: e.summary.time,
              source: e.summary.sourceName,
              traceId: e.summary.traceId,
              taskId: e.summary.taskId,
            }))
          : undefined,
    };
  });
}

function inferCategory(signature: string): string {
  if (signature.includes('ERROR')) return 'ERROR';
  if (signature.includes('WARN')) return 'WARNING';
  if (signature.includes('api') && signature.includes('INFO')) return 'API_ACCESS';
  if (signature.includes('queue') && signature.includes('INFO')) return 'QUEUE_OPERATION';
  if (signature.includes('callback')) return 'CALLBACK';
  return 'OTHER';
}

export function getCriticalClusters(clusters: ErrorCluster[], maxCount = 5): ErrorCluster[] {
  return clusters.filter((c) => c.category === 'ERROR' || c.count >= 3).slice(0, maxCount);
}

export { generateSignature };
