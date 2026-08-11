/**
 * @file packages/agent/src/core/cross-run-memory.ts
 * @description Persists a short summary of each completed goal run to disk and retrieves
 * summaries from prior related runs to seed a new run's prompt — so the agent doesn't
 * repeat the same mistakes (or re-discover the same site quirks) on every fresh goal.
 *
 * Deliberately simple: one JSON file per run under a `memory/` prefix via the same
 * LocalFileStorage abstraction apps/server already uses for run records (see
 * apps/server/src/application/run-repository.ts). Relevance ranking is a naive keyword
 * overlap score, not embeddings — good enough for "have I seen a goal like this before,"
 * cheap enough to run on every goal start with no extra infra.
 */

import { LocalFileStorage } from '@sutradhar/storage';
import { StructuredLogger } from '@sutradhar/observability';

export interface RunMemoryRecord {
  readonly goalId: string;
  readonly objective: string;
  readonly status: string;
  readonly summary?: string;
  readonly answer?: string;
  readonly stepCount: number;
  readonly timestamp: string;
}

export interface CrossRunMemoryOptions {
  readonly storage?: LocalFileStorage;
  readonly logger?: StructuredLogger;
}

const MEMORY_PREFIX = 'agent-memory';
const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'to', 'of', 'and', 'for', 'on', 'in', 'with', 'this',
  'that', 'it', 'from', 'find', 'get', 'go', 'please', 'me', 'my', 'i', 'what',
]);
/** Cap on stored run summaries — without this, both disk usage and the O(n) file-read cost
 *  of every `getRelevantRuns()` lookup grow unbounded over a long-lived process. */
const MAX_STORED_RUNS = 200;
/** Only run the (read-every-file) prune sweep once the count exceeds the cap by this much,
 *  so a normal `recordRun()` call isn't paying a full directory read on every single write —
 *  it's amortized over a batch of writes instead. */
const PRUNE_MARGIN = 20;

export class CrossRunMemory {
  private readonly storage: LocalFileStorage;
  private readonly logger: StructuredLogger;

  public constructor(options: CrossRunMemoryOptions = {}) {
    this.storage = options.storage ?? new LocalFileStorage();
    this.logger = options.logger ?? new StructuredLogger({ minLevel: 'info' });
  }

  /** Persist a short summary of a completed (or failed/cancelled) run. Never throws — a
   *  memory-write failure must not take down the run it's trying to remember. */
  public async recordRun(record: RunMemoryRecord): Promise<void> {
    try {
      await this.storage.writeFile(
        `${MEMORY_PREFIX}/${record.goalId}.json`,
        JSON.stringify(record, null, 2),
      );
      await this.pruneIfNeeded();
    } catch (err) {
      this.logger.warn(`[CrossRunMemory] failed to persist run summary: ${(err as Error).message}`);
    }
  }

  /** Deletes the oldest stored runs once the count exceeds {@link MAX_STORED_RUNS} by more
   *  than {@link PRUNE_MARGIN} — keeps disk usage and future lookup cost bounded without
   *  paying a full directory scan on every single `recordRun()` call. */
  private async pruneIfNeeded(): Promise<void> {
    const files = await this.storage.listFiles(MEMORY_PREFIX);
    if (files.length <= MAX_STORED_RUNS + PRUNE_MARGIN) return;

    const withTimestamps: Array<{ file: string; timestamp: number }> = [];
    for (const file of files) {
      try {
        const raw = await this.storage.readFile(file);
        const record = JSON.parse(raw.toString('utf-8')) as RunMemoryRecord;
        withTimestamps.push({ file, timestamp: Date.parse(record.timestamp) || 0 });
      } catch {
        // Unreadable/corrupt entry — prune it too, it's dead weight either way.
        withTimestamps.push({ file, timestamp: 0 });
      }
    }

    withTimestamps.sort((a, b) => a.timestamp - b.timestamp);
    const toDelete = withTimestamps.slice(0, withTimestamps.length - MAX_STORED_RUNS);
    for (const { file } of toDelete) {
      await this.storage.deleteFile(file).catch(() => {});
    }
    if (toDelete.length > 0) {
      this.logger.info(`[CrossRunMemory] Pruned ${toDelete.length} old run summaries (cap: ${MAX_STORED_RUNS})`);
    }
  }

  /**
   * Returns up to `limit` prior runs whose objective shares the most keywords with
   * `objective`, most-relevant first. Runs with zero keyword overlap are excluded.
   */
  public async getRelevantRuns(objective: string, limit = 3): Promise<readonly RunMemoryRecord[]> {
    const queryTokens = tokenize(objective);
    if (queryTokens.size === 0) return [];

    try {
      const files = await this.storage.listFiles(MEMORY_PREFIX);
      const scored: Array<{ record: RunMemoryRecord; score: number }> = [];

      for (const file of files) {
        try {
          const raw = await this.storage.readFile(file);
          const record = JSON.parse(raw.toString('utf-8')) as RunMemoryRecord;
          const overlap = intersectionSize(queryTokens, tokenize(record.objective));
          if (overlap > 0) scored.push({ record, score: overlap });
        } catch {
          // Skip unreadable/corrupt entries rather than failing the whole lookup.
        }
      }

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit).map((s) => s.record);
    } catch (err) {
      this.logger.warn(`[CrossRunMemory] failed to retrieve relevant runs: ${(err as Error).message}`);
      return [];
    }
  }
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const item of a) if (b.has(item)) count++;
  return count;
}
