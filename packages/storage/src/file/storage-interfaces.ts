/**
 * @file packages/storage/src/file/storage-interfaces.ts
 * @description Standard IFileStorage interface contract for file persistence adapters.
 */

export interface IFileStorage {
  writeFile(key: string, data: Buffer | string): Promise<string>;
  readFile(key: string): Promise<Buffer>;
  deleteFile(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  listFiles(prefix?: string): Promise<readonly string[]>;
}
