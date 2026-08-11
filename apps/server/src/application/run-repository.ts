/**
 * @file apps/server/src/application/run-repository.ts
 * @description RunRepository — storage-backed persistence for agent runs (Phase 5).
 *
 * One JSON file per run under the `runs/` prefix of LocalFileStorage. Every
 * run (including failed/cancelled) is written at START and updated at END.
 * Retention is INDEFINITE: nothing here ever purges; deletion is explicit
 * and user-driven only.
 */

import { RunRecordDto } from '@pinchtab/contracts';
import { LocalFileStorage } from '@pinchtab/storage';
import { StructuredLogger } from '@pinchtab/observability';

const RUNS_PREFIX = 'runs/';

export interface ListRunsFilter {
  readonly sessionId?: string;
  readonly status?: string;
  /** ISO timestamps (inclusive bounds). */
  readonly from?: string;
  readonly to?: string;
}

export class RunRepository {
  private readonly storage: LocalFileStorage;
  private readonly logger: StructuredLogger;

  public constructor(storage: LocalFileStorage, logger?: StructuredLogger) {
    this.storage = storage;
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
  }

  private key(runId: string): string {
    return `${RUNS_PREFIX}${runId}.json`;
  }

  /** Persists the record (create or update). Never throws on write failure —
   *  a storage hiccup must not kill a live run; the error is logged honestly. */
  public async save(record: RunRecordDto): Promise<void> {
    try {
      await this.storage.writeFile(this.key(record.runId), JSON.stringify(record, null, 2));
    } catch (err) {
      this.logger.error(
        '[RunRepository] Failed to persist run record',
        { runId: record.runId },
        err,
      );
    }
  }

  public async get(runId: string): Promise<RunRecordDto | undefined> {
    try {
      const raw = await this.storage.readFile(this.key(runId));
      return JSON.parse(raw.toString('utf-8')) as RunRecordDto;
    } catch {
      return undefined;
    }
  }

  /** All runs newest-first, honoring optional sessionId/status/from/to filters. */
  public async list(filter: ListRunsFilter = {}): Promise<readonly RunRecordDto[]> {
    const keys = await this.storage.listFiles(RUNS_PREFIX);
    const records: RunRecordDto[] = [];
    for (const key of keys) {
      try {
        const raw = await this.storage.readFile(key);
        records.push(JSON.parse(raw.toString('utf-8')) as RunRecordDto);
      } catch {
        // A corrupt file must never break the whole history listing.
      }
    }

    const filtered = records.filter((r) => {
      if (filter.sessionId && r.sessionId !== filter.sessionId) return false;
      if (filter.status && r.status !== filter.status) return false;
      if (filter.from && r.startedAt < filter.from) return false;
      if (filter.to && r.startedAt > filter.to) return false;
      return true;
    });

    return filtered.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }

  /** Explicit, user-driven deletion. Returns false when the run does not exist. */
  public async delete(runId: string): Promise<boolean> {
    const deleted = await this.storage.deleteFile(this.key(runId));
    if (deleted) {
      this.logger.info('[RunRepository] Run record deleted', { runId });
    }
    return deleted;
  }
}
