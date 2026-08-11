/**
 * @file apps/server/src/application/storage-app-service.ts
 * @description Application service for artifact file storage persistence use cases.
 */

import { LocalFileStorage } from '@sutradhar/storage';
import { StructuredLogger } from '@sutradhar/observability';

export interface StoreFileCommand {
  readonly key: string;
  readonly content: string;
}

export class StorageApplicationService {
  private readonly fileStorage: LocalFileStorage;
  private readonly logger: StructuredLogger;

  public constructor(fileStorage: LocalFileStorage, logger?: StructuredLogger) {
    this.fileStorage = fileStorage;
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
  }

  public async storeFile(command: StoreFileCommand): Promise<{ key: string; path: string }> {
    this.logger.info(`[StorageApplicationService] Storing file artifact ${command.key}`);
    const pathWritten = await this.fileStorage.writeFile(command.key, command.content);
    return { key: command.key, path: pathWritten };
  }

  public async listFiles(prefix?: string): Promise<readonly string[]> {
    return this.fileStorage.listFiles(prefix);
  }

  /** Reads a stored file as text; undefined when the key does not exist. */
  public async getFile(key: string): Promise<string | undefined> {
    try {
      const raw = await this.fileStorage.readFile(key);
      return raw.toString('utf-8');
    } catch {
      return undefined;
    }
  }
}
