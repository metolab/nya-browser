import type { LocalFileJob } from '@nya/shared';

type Job = LocalFileJob & { sessionId: string; finishedAt?: number };

const jobs = new Map<string, Job>();

function prune() {
  const cutoff = Date.now() - 60_000;
  for (const [id, job] of jobs) {
    if (job.state !== 'active' && (job.finishedAt || 0) < cutoff) jobs.delete(id);
  }
}

export function startLocalJob(sessionId: string, id: string, filePath: string, name: string, total: number) {
  prune();
  const job: Job = {
    id,
    sessionId,
    path: filePath,
    name,
    total,
    state: 'active',
  };
  jobs.set(`${sessionId}:${id}`, job);
  return job;
}

export function finishLocalJob(sessionId: string, id: string, state: Job['state']) {
  const job = jobs.get(`${sessionId}:${id}`);
  if (!job || job.state !== 'active') return;
  job.state = state;
  job.finishedAt = Date.now();
}

export function listLocalJobs(sessionId: string): LocalFileJob[] {
  prune();
  return [...jobs.values()]
    .filter((job) => job.sessionId === sessionId)
    .map(({ sessionId: _sid, finishedAt: _at, ...job }) => job);
}
