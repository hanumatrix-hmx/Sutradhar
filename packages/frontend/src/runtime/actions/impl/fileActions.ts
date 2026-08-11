/**
 * @file packages/frontend/src/runtime/actions/impl/fileActions.ts
 * @description File actions (DownloadFile, UploadFile).
 */

import { BrowserAction } from '../browserPageAction.js';
import { ActionContext } from '../actionContext.js';
import { ActionArtifact } from '../actionTypes.js';

export class DownloadFileAction extends BrowserAction<
  { url: string; filename?: string },
  { filename: string; size: string }
> {
  public constructor(input: { url: string; filename?: string }) {
    super({
      type: 'DownloadFile',
      name: 'Download File',
      description: `Downloads file from ${input.url}`,
      input,
      metadata: { category: 'file', requiresBrowserRunning: true },
    });
  }

  public async validate(_context: ActionContext): Promise<{ valid: boolean; reason?: string }> {
    if (!this.input.url) return { valid: false, reason: 'File URL is required' };
    return { valid: true };
  }

  public async execute(
    _context: ActionContext,
  ): Promise<{ output: { filename: string; size: string }; artifacts: ActionArtifact[] }> {
    const filename =
      this.input.filename || this.input.url.split('/').pop() || 'downloaded_file.bin';
    const artifact: ActionArtifact = {
      id: `dl_${Date.now()}`,
      name: filename,
      type: 'download',
      mimeType: 'application/octet-stream',
      data: 'mock_binary_data',
      sizeBytes: 1024 * 50,
    };
    return { output: { filename, size: '50 KB' }, artifacts: [artifact] };
  }
}

export class UploadFileAction extends BrowserAction<
  { selector: string; filePath: string },
  { uploaded: boolean; filePath: string }
> {
  public constructor(input: { selector: string; filePath: string }) {
    super({
      type: 'UploadFile',
      name: 'Upload File to Field',
      description: `Uploads file ${input.filePath} to input ${input.selector}`,
      input,
      metadata: { category: 'file', requiresBrowserRunning: true },
    });
  }

  public async validate(_context: ActionContext): Promise<{ valid: boolean; reason?: string }> {
    if (!this.input.selector) return { valid: false, reason: 'Selector is required' };
    if (!this.input.filePath) return { valid: false, reason: 'File path is required' };
    return { valid: true };
  }

  public async execute(
    _context: ActionContext,
  ): Promise<{ output: { uploaded: boolean; filePath: string } }> {
    return { output: { uploaded: true, filePath: this.input.filePath } };
  }
}
