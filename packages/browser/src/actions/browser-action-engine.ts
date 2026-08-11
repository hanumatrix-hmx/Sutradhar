/**
 * @file packages/browser/src/actions/browser-action-engine.ts
 * @description Core BrowserActionEngine executing 19 browser actions with retries, timeout, and event emission.
 *
 * Every selector-targeted action resolves its target across the page's frames (iframes, at
 * any nesting depth) and through open shadow roots within each frame — see {@link resolveElement}.
 */

import os from 'node:os';
import path from 'node:path';
import { realpath, access } from 'node:fs/promises';
import { EventBus } from '@sutradhar/events';
import { StructuredLogger } from '@sutradhar/observability';
import { SessionId } from '@sutradhar/contracts';
import { ElementHandle, Page } from 'puppeteer-core';
import { IBrowserTab } from '../session/browser-tab.js';
import { ExecutionVerifier } from '../verifier/execution-verifier.js';
import { SD_GENERATION_ATTR, SD_CURRENT_GENERATION_ATTR } from '../dom/dom-semantic-engine.js';
import { ActionParams, ActionResultDto } from './action-types.js';

export interface IBrowserActionEngine {
  executeAction(tab: IBrowserTab, params: ActionParams): Promise<ActionResultDto>;
}

/** Action types that mutate page state — subject to the duplicate-action guard. */
const MUTATING_ACTIONS = new Set([
  'click',
  'click_by_text',
  'click_by_role',
  'type',
  'type_by_label',
  'press_key',
  'select_option',
  'upload_file',
  'drag_and_drop',
  'touch_tap',
  'download_file',
]);

/** How long a (tab, actionType, target) combination is remembered to guard against accidental
 *  rapid double-dispatch (e.g. a submit button clicked twice in quick succession). */
const DUPLICATE_ACTION_WINDOW_MS = 1000;

export class BrowserActionEngine implements IBrowserActionEngine {
  private readonly eventBus?: EventBus;
  private readonly logger: StructuredLogger;
  private readonly verifier: ExecutionVerifier;
  /** key: `${tabId}:${actionType}:${target}` -> last-dispatched timestamp. */
  private readonly recentActions = new Map<string, number>();
  /** Directories a 'download_file' action is allowed to write into (each resolved to an
   *  absolute path). Defaults to just the OS temp directory — a caller-supplied `downloadDir`
   *  that doesn't resolve under one of these is rejected rather than trusted blindly, since it
   *  ultimately reaches CDP's `Browser.setDownloadBehavior` as a real filesystem write target. */
  private readonly allowedDownloadRoots: readonly string[];
  /** Directories an 'upload_file' action is allowed to read from, each resolved to an
   *  absolute path. Unset (the default) means unrestricted — uploading an arbitrary local
   *  file the caller specifies is the intended feature, unlike downloads (which write NEW
   *  files and so default-sandbox to the OS temp dir). Configure this when the calling LLM
   *  is untrusted enough that an attacker-controlled page could plausibly talk it into
   *  uploading a sensitive file (e.g. via prompt injection in page content). */
  private readonly allowedUploadRoots?: readonly string[];
  /** key: tabId -> a promise that resolves once every action queued against that tab so far
   *  has finished. Two concurrent `executeAction` calls against the SAME tab would otherwise
   *  interleave their CDP calls against one Puppeteer `Page` — nondeterministic and hard to
   *  debug (a `type` racing a `navigate`, for instance). Different tabs are never serialized
   *  against each other. */
  private readonly tabQueues = new Map<string, Promise<unknown>>();

  public constructor(
    eventBus?: EventBus,
    logger?: StructuredLogger,
    verifier?: ExecutionVerifier,
    allowedDownloadRoots?: readonly string[],
    allowedUploadRoots?: readonly string[],
  ) {
    this.eventBus = eventBus;
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
    this.verifier = verifier ?? new ExecutionVerifier();
    this.allowedDownloadRoots = (allowedDownloadRoots ?? [os.tmpdir()]).map((root) => path.resolve(root));
    this.allowedUploadRoots = allowedUploadRoots?.map((root) => path.resolve(root));
  }

  /**
   * Confirms `filePath` exists and, when {@link allowedUploadRoots} is configured, that it
   * falls within one of those roots (symlink-resolved the same way {@link resolveDownloadDir}
   * checks download destinations) before it's handed to Puppeteer's `uploadFile`/file-chooser
   * APIs — which read the file and hand its contents to the page.
   */
  private async assertUploadPathAllowed(filePath: string): Promise<void> {
    const resolved = path.resolve(filePath);
    try {
      await access(resolved);
    } catch {
      throw new Error(`Upload file "${filePath}" does not exist or is not accessible.`);
    }

    if (!this.allowedUploadRoots || this.allowedUploadRoots.length === 0) return;

    const canonical = await realpath(resolved).catch(() => resolved);
    for (const root of this.allowedUploadRoots) {
      const canonicalRoot = await realpath(root).catch(() => root);
      if (canonical === canonicalRoot || canonical.startsWith(canonicalRoot + path.sep)) return;
    }
    throw new Error(
      `Upload file "${filePath}" is outside the allowed upload directories ` +
        `(${this.allowedUploadRoots.join(', ')}).`,
    );
  }

  /**
   * Resolve the requested download directory (defaulting to the first allowed root when none
   * is given) and reject it outright if it doesn't fall under one of {@link allowedDownloadRoots}
   * — prevents an MCP caller from directing a real CDP download to an arbitrary filesystem
   * location.
   *
   * Containment is checked against the REAL (symlink-resolved) path of both the requested
   * directory and each allowed root, not just the literal string — a plain prefix check on
   * the un-resolved paths can be defeated by a symlink/junction sitting inside (or standing
   * in for) an allowed root that actually points somewhere else entirely (e.g. a shared temp
   * dir containing a junction to a sensitive location). `fs.realpath` requires the target to
   * exist; a directory that doesn't exist yet can't meaningfully be symlink-checked, so it
   * falls back to the literal resolved path — a nonexistent target fails loudly downstream
   * (CDP/fs) instead of silently bypassing this check either way.
   */
  private async resolveDownloadDir(requested: string | undefined): Promise<string> {
    const resolved = requested ? path.resolve(requested) : this.allowedDownloadRoots[0]!;
    const canonical = await realpath(resolved).catch(() => resolved);

    for (const root of this.allowedDownloadRoots) {
      const canonicalRoot = await realpath(root).catch(() => root);
      if (canonical === canonicalRoot || canonical.startsWith(canonicalRoot + path.sep)) {
        return resolved;
      }
    }

    throw new Error(
      `downloadDir "${requested}" is outside the allowed download directories ` +
        `(${this.allowedDownloadRoots.join(', ')}). Pass a path under one of these, or configure ` +
        'additional allowed roots when constructing the runtime.',
    );
  }

  public async executeAction(tab: IBrowserTab, params: ActionParams): Promise<ActionResultDto> {
    // Chain onto whatever's already queued for this tab so overlapping calls serialize
    // instead of interleaving CDP calls against the same Page. `.catch(() => {})` on the
    // predecessor means one call failing never blocks the next one from starting.
    const previous = this.tabQueues.get(tab.id) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(() => this.executeActionSerialized(tab, params));
    const settleMarker = run.catch(() => {});
    this.tabQueues.set(tab.id, settleMarker);
    // Once this call (and anything chained after it so far) settles, drop the map entry if
    // nothing newer replaced it — keeps `tabQueues` from growing unbounded across a long
    // process lifetime with many tabs opened and closed over time.
    void settleMarker.finally(() => {
      if (this.tabQueues.get(tab.id) === settleMarker) {
        this.tabQueues.delete(tab.id);
      }
    });
    return run;
  }

  private async executeActionSerialized(tab: IBrowserTab, params: ActionParams): Promise<ActionResultDto> {
    const duplicateError = this.checkDuplicateAction(tab.id, params);
    if (duplicateError) {
      return duplicateError;
    }

    const startTime = Date.now();
    const timeoutMs = params.timeoutMs ?? 15000;
    const maxRetries = params.maxRetries ?? 2;
    const previousUrl = tab.url;
    let attempt = 0;
    let lastError: Error | undefined;

    this.logger.info(`[BrowserActionEngine] Executing action ${params.actionType}`, {
      tabId: tab.id,
      url: params.url,
      selector: params.selector,
      text: params.text,
    });

    while (attempt <= maxRetries) {
      try {
        const resultData = await this.performActionWithTimeout(tab, params, timeoutMs);
        const executionTimeMs = Date.now() - startTime;

        const result: ActionResultDto = {
          success: true,
          actionType: params.actionType,
          executionTimeMs,
          currentUrl: tab.url,
          title: tab.title,
          outputData: resultData,
          retriesUsed: attempt,
        };
        const verification = await this.verifier.verifyAction(
          tab,
          previousUrl,
          result,
          params.verificationSpec,
        );
        const finalResult: ActionResultDto = { ...result, verification };

        tab.recordAction({
          actionType: params.actionType,
          selector: params.selector,
          success: true,
          executionTimeMs,
          timestamp: new Date().toISOString(),
        });

        if (this.eventBus && params.sessionId) {
          await this.eventBus.publish(
            'browser:action:executed',
            {
              sessionId: params.sessionId as SessionId,
              tabId: tab.id,
              actionType: params.actionType,
              success: true,
              durationMs: executionTimeMs,
            },
            `corr_act_${Date.now()}`,
          );
        }

        return finalResult;
      } catch (err) {
        lastError = err as Error;
        attempt++;
        this.logger.warn(
          `[BrowserActionEngine] Action ${params.actionType} failed (attempt ${attempt}/${maxRetries + 1}): ${lastError.message}`,
        );
        if (attempt <= maxRetries) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
    }

    const executionTimeMs = Date.now() - startTime;

    // Capture a debugging screenshot on the way out when the action ultimately failed — best
    // effort only; a page that's mid-navigation or already torn down shouldn't turn a real
    // action failure into a screenshot-capture failure instead.
    let failureScreenshot: string | undefined;
    if (tab.page) {
      try {
        const buf = await tab.page.screenshot({ encoding: 'base64' });
        failureScreenshot = String(buf);
      } catch {
        // best-effort — leave undefined
      }
    }

    const failResult: ActionResultDto = {
      success: false,
      actionType: params.actionType,
      executionTimeMs,
      currentUrl: tab.url,
      title: tab.title,
      error: lastError?.message ?? 'Unknown action error',
      retriesUsed: attempt - 1,
      failureScreenshot,
    };
    const verification = await this.verifier.verifyAction(
      tab,
      previousUrl,
      failResult,
      params.verificationSpec,
    );

    tab.recordAction({
      actionType: params.actionType,
      selector: params.selector,
      success: false,
      error: failResult.error,
      executionTimeMs,
      timestamp: new Date().toISOString(),
    });

    return { ...failResult, verification };
  }

  /**
   * Guard against an accidental rapid double-dispatch of the same mutating action on the same
   * target (e.g. a submit button clicked twice within a second) — a common way a slow response
   * or an over-eager caller-side retry causes a duplicate form submission. Only applies across
   * separate top-level `executeAction` calls; the internal retry loop above is unaffected since
   * this check runs once, before that loop starts.
   */
  private checkDuplicateAction(tabId: string, params: ActionParams): ActionResultDto | undefined {
    if (!MUTATING_ACTIONS.has(params.actionType)) return undefined;

    const target = params.selector ?? params.key ?? '';
    const key = `${tabId}:${params.actionType}:${target}`;
    const now = Date.now();

    // Opportunistically prune stale entries so this map never grows unbounded.
    for (const [k, t] of this.recentActions) {
      if (now - t >= DUPLICATE_ACTION_WINDOW_MS) this.recentActions.delete(k);
    }

    const lastAt = this.recentActions.get(key);
    if (lastAt !== undefined && now - lastAt < DUPLICATE_ACTION_WINDOW_MS) {
      return {
        success: false,
        actionType: params.actionType,
        executionTimeMs: 0,
        error:
          `Duplicate '${params.actionType}' on the same target within ${DUPLICATE_ACTION_WINDOW_MS}ms — ` +
          'likely an accidental double-dispatch (e.g. a submit button clicked twice). If this is ' +
          'intentional, wait a moment and retry.',
        retriesUsed: 0,
      };
    }

    this.recentActions.set(key, now);
    return undefined;
  }

  private async performActionWithTimeout(
    tab: IBrowserTab,
    params: ActionParams,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    return Promise.race([
      this.dispatchAction(tab, params),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Action ${params.actionType} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  }

  private async dispatchAction(
    tab: IBrowserTab,
    params: ActionParams,
  ): Promise<Record<string, unknown>> {
    const page = tab.page;

    switch (params.actionType) {
      case 'navigate': {
        if (!params.url) throw new Error('Navigate action requires url parameter');
        await tab.navigate(params.url);
        return { url: tab.url, title: tab.title };
      }

      case 'click': {
        if (!params.selector) throw new Error('Click action requires a selector parameter');
        if (page) {
          await this.withModifiers(page, params.modifiers, () =>
            this.verifiedClick(page, params.selector!, params.button ?? 'left', params.offset),
          );
        } else {
          // No selector-capable page path (e.g. a mock/no-Chrome tab) — fall back to the
          // tab's own action dispatch, but honor its result instead of discarding it; a
          // no-live-page tab now reports success:false there rather than faking success.
          const fallback = await tab.executeAction({ type: 'click', targetSelector: params.selector });
          if (!fallback.success) throw new Error(fallback.error ?? 'click failed');
        }
        return { clickedSelector: params.selector, button: params.button ?? 'left', modifiers: params.modifiers };
      }

      case 'click_by_text': {
        if (!params.text) throw new Error('ClickByText action requires text parameter');
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute click_by_text.`);
        const xpath = `xpath///*[contains(text(), "${params.text}")]`;
        const element = await this.resolveElement(page, xpath, { timeoutMs: 5000 });
        if (!element) throw new Error(`No element found containing text: ${params.text}`);
        await element.click();
        return { clickedText: params.text };
      }

      case 'click_by_role': {
        if (!params.role) throw new Error('ClickByRole action requires role parameter');
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute click_by_role.`);
        // Puppeteer's built-in `aria/` selector engine queries the browser's own computed
        // accessibility tree — unlike a plain `[role="X"]` CSS selector (the previous
        // implementation), it correctly matches IMPLICIT roles too (a plain <button> has role
        // "button" without ever declaring role="button" in its markup — the vast majority of
        // real-world interactive elements rely on implicit roles, not explicit ones). The name
        // segment, when given, is also matched against the real computed accessible name, not
        // just left unused — `name` was accepted and documented as narrowing the match but
        // silently ignored before this fix.
        const ariaSelector = `aria/${params.name ?? ''}[role="${params.role}"]`;
        const handle = await this.resolveElement(page, ariaSelector, { visible: true, timeoutMs: 5000 });
        if (!handle) {
          throw new Error(
            `No visible element found with role "${params.role}"` +
              (params.name ? ` and accessible name "${params.name}"` : ''),
          );
        }
        await this.assertNotStale(handle, ariaSelector);
        await this.verifiedClickOnHandle(handle, ariaSelector);
        return { role: params.role, name: params.name };
      }

      case 'type': {
        if (!params.value) throw new Error('Type action requires value parameter');
        if (!params.selector) throw new Error('Type action requires a selector parameter');
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute type.`);
        const handle = await this.resolveElement(page, `pierce/${params.selector}`, {
          timeoutMs: 5000,
        });
        if (!handle) throw new Error(`No element found for selector: ${params.selector}`);
        await this.assertNotStale(handle, params.selector);
        await this.runHandleOp('type', () => handle.type(params.value!));
        return { typedValue: params.value };
      }

      case 'type_by_label': {
        if (!params.label || !params.value) throw new Error('TypeByLabel requires label and value');
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute type_by_label.`);
        const selector = `input[aria-label="${params.label}"], input[placeholder="${params.label}"]`;
        const handle = await this.resolveElement(page, `pierce/${selector}`, { timeoutMs: 5000 });
        if (!handle) throw new Error(`No input found matching label: ${params.label}`);
        await this.runHandleOp('type_by_label', () => handle.type(params.value!));
        return { label: params.label, value: params.value };
      }

      case 'press_key': {
        if (!params.key) throw new Error('PressKey requires key parameter');
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute press_key.`);
        await this.withModifiers(page, params.modifiers, () => page.keyboard.press(params.key as any));
        return { key: params.key, modifiers: params.modifiers };
      }

      case 'scroll': {
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute scroll.`);
        const amount = params.amount ?? 500;
        const direction = params.direction ?? 'down';
        await page.evaluate(
          (amt, dir) => {
            window.scrollBy(0, dir === 'down' ? amt : -amt);
          },
          amount,
          direction,
        );
        return { direction: params.direction ?? 'down' };
      }

      case 'wait': {
        const ms = params.milliseconds ?? 1000;
        await new Promise((r) => setTimeout(r, ms));
        return { waitedMs: ms };
      }

      case 'wait_for_selector': {
        if (!params.selector) throw new Error('WaitForSelector requires selector parameter');
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute wait_for_selector.`);
        const handle = await this.resolveElement(page, `pierce/${params.selector}`, {
          timeoutMs: params.timeoutMs ?? 10000,
        });
        if (!handle) throw new Error(`No element found for selector: ${params.selector}`);
        return { foundSelector: params.selector };
      }

      case 'select_option': {
        const values = params.values?.length ? params.values : params.value ? [params.value] : undefined;
        if (!params.selector || !values) {
          throw new Error("SelectOption requires selector and either 'value' or 'values'");
        }
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute select_option.`);
        const handle = await this.resolveElement(page, `pierce/${params.selector}`, {
          timeoutMs: 5000,
        });
        if (!handle) throw new Error(`No element found for selector: ${params.selector}`);
        await this.assertNotStale(handle, params.selector);
        await this.runHandleOp('select_option', () => handle.select(...values));
        return { selectedValues: values };
      }

      case 'hover': {
        if (!params.selector) throw new Error('Hover action requires a selector parameter');
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute hover.`);
        await this.verifiedHover(page, params.selector, params.offset);
        return { hoveredSelector: params.selector };
      }

      case 'focus': {
        if (!params.selector) throw new Error('Focus action requires a selector parameter');
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute focus.`);
        const handle = await this.resolveElement(page, `pierce/${params.selector}`, {
          timeoutMs: 5000,
        });
        if (!handle) throw new Error(`No element found for selector: ${params.selector}`);
        await this.assertNotStale(handle, params.selector);
        await this.runHandleOp('focus', () => handle.focus());
        return { focusedSelector: params.selector };
      }

      case 'take_screenshot': {
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute take_screenshot.`);
        const buf = await page.screenshot({ encoding: 'base64', fullPage: params.fullPage ?? true });
        return { screenshotBase64Length: String(buf).length };
      }

      case 'drag_and_drop': {
        if (!params.selector || !params.targetSelector) {
          throw new Error('DragAndDrop action requires selector (source) and targetSelector (destination) parameters');
        }
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute drag_and_drop.`);
        const source = await this.resolveElement(page, `pierce/${params.selector}`, { timeoutMs: 5000 });
        if (!source) throw new Error(`No element found for source selector: ${params.selector}`);
        const target = await this.resolveElement(page, `pierce/${params.targetSelector}`, { timeoutMs: 5000 });
        if (!target) throw new Error(`No element found for target selector: ${params.targetSelector}`);
        await this.assertNotStale(source, params.selector);
        await this.assertNotStale(target, params.targetSelector);
        await this.runHandleOp('drag_and_drop', async () => {
          await source.drag(target);
          await target.drop(source);
        });
        return { sourceSelector: params.selector, targetSelector: params.targetSelector };
      }

      case 'touch_tap': {
        if (!params.selector) throw new Error('TouchTap action requires selector parameter');
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute touch_tap.`);
        const handle = await this.resolveElement(page, `pierce/${params.selector}`, {
          visible: true,
          timeoutMs: 5000,
        });
        if (!handle) throw new Error(`No visible element found for selector: ${params.selector}`);
        await this.assertNotStale(handle, params.selector);
        await this.runHandleOp('touch_tap', () => handle.tap());
        return { tappedSelector: params.selector };
      }

      case 'download_file': {
        if (!params.selector) {
          throw new Error("DownloadFile action requires a selector (of the element that triggers the download)");
        }
        if (!page) {
          throw new Error(`No live browser page for tab ${tab.id} — cannot execute download_file.`);
        }

        const downloadDir = await this.resolveDownloadDir(params.downloadDir);
        // Downloads must be configured on a *browser*-level CDP session, not a page-level one —
        // `Page.setDownloadBehavior`/`Page.downloadWillBegin`/`Page.downloadProgress` are
        // deprecated and don't fire in Chrome's current ("new") headless mode; the replacement
        // `Browser.*` equivalents only exist on the browser target's own session.
        const client = await page.browser().target().createCDPSession();
        await client.send('Browser.setDownloadBehavior', {
          behavior: 'allow',
          downloadPath: downloadDir,
          eventsEnabled: true,
        });

        const downloadTimeoutMs = params.timeoutMs ?? 30000;
        let cleanup = (): void => {};
        const downloadPromise = new Promise<{ filename: string; path: string }>((resolve, reject) => {
          let suggestedFilename: string | undefined;
          const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Download did not complete within ${downloadTimeoutMs}ms`));
          }, downloadTimeoutMs);

          const onWillBegin = (evt: { suggestedFilename: string }): void => {
            suggestedFilename = evt.suggestedFilename;
          };
          const onProgress = (evt: { state: string; guid: string }): void => {
            if (evt.state === 'completed') {
              cleanup();
              const filename = suggestedFilename ?? evt.guid;
              resolve({ filename, path: path.join(downloadDir, filename) });
            } else if (evt.state === 'canceled') {
              cleanup();
              reject(new Error('Download was canceled'));
            }
          };
          client.on('Browser.downloadWillBegin', onWillBegin);
          client.on('Browser.downloadProgress', onProgress);
          cleanup = () => {
            clearTimeout(timer);
            client.off('Browser.downloadWillBegin', onWillBegin);
            client.off('Browser.downloadProgress', onProgress);
          };
        });
        // If verifiedClick throws below (e.g. the trigger element isn't found), this promise
        // is never awaited — without a handler attached now, its eventual timeout rejection
        // (up to `downloadTimeoutMs` later) would surface as an unhandled promise rejection
        // and crash the process. This no-op catch only suppresses that Node-level warning; it
        // doesn't affect the real `await downloadPromise` below, which still observes the
        // rejection normally.
        downloadPromise.catch(() => {});

        try {
          await this.verifiedClick(page, params.selector, 'left');
          const downloaded = await downloadPromise;
          return { downloadedFilename: downloaded.filename, downloadedPath: downloaded.path, downloadDir };
        } catch (err) {
          cleanup();
          throw err;
        } finally {
          await client.detach().catch(() => {});
        }
      }

      case 'upload_file': {
        if (!params.selector || !params.filePath) {
          throw new Error('UploadFile action requires selector and filePath parameters');
        }
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute upload_file.`);
        await this.assertUploadPathAllowed(params.filePath);
        const handle = await this.resolveElement(page, `pierce/${params.selector}`, {
          timeoutMs: 5000,
        });
        if (!handle) {
          throw new Error(`No file input found for selector: ${params.selector}`);
        }
        await this.runHandleOp('upload_file', () => (handle as any).uploadFile(params.filePath));
        return { uploadedFilePath: params.filePath };
      }

      default:
        throw new Error(`Unsupported action type ${params.actionType}`);
    }
  }

  /**
   * True for Puppeteer/CDP's "execution context destroyed" family of errors — thrown when the
   * frame a handle belonged to navigates away mid-operation. `verifiedClick` already treats
   * this specially for clicks (it's often evidence the click's own submit/link navigation
   * fired); this catches the same underlying condition for every other handle-based action so
   * a navigation racing a `type`/`select_option`/`focus`/`drag_and_drop`/`touch_tap`/
   * `upload_file` produces a clear diagnosis instead of Puppeteer's raw, easy-to-miss message.
   */
  private isContextDestroyedError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return (
      message.includes('Execution context was destroyed') ||
      message.includes('detached Frame') ||
      message.includes('Cannot find context with specified id')
    );
  }

  /** Runs a handle-based operation, rethrowing a context-destroyed failure with a clear
   *  "page navigated away mid-action" diagnosis instead of Puppeteer's raw error text. */
  private async runHandleOp<T>(actionType: string, op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (this.isContextDestroyedError(err)) {
        throw new Error(
          `Page navigated away mid-action while executing '${actionType}' — the action may ` +
            `have already taken effect before the navigation (original error: ${(err as Error).message})`,
        );
      }
      throw err;
    }
  }

  /**
   * Holds `modifiers` down for the duration of `op` (Ctrl+click, Shift+click, Ctrl+A, etc.),
   * releasing them afterward in reverse order even if `op` throws — a stuck-down modifier key
   * would silently corrupt every subsequent action on the page.
   */
  private async withModifiers<T>(
    page: Page,
    modifiers: readonly string[] | undefined,
    op: () => Promise<T>,
  ): Promise<T> {
    if (!modifiers || modifiers.length === 0) return op();
    for (const key of modifiers) {
      await page.keyboard.down(key as any);
    }
    try {
      return await op();
    } finally {
      for (const key of [...modifiers].reverse()) {
        await page.keyboard.up(key as any).catch(() => {});
      }
    }
  }

  /**
   * Locate an element by `fullSelector` (any Puppeteer-understood selector syntax — a plain
   * CSS selector, a `pierce/`-prefixed one that also crosses open shadow roots, or an
   * `xpath/` one) across every frame on the page, not just the main one. Iframes are genuinely
   * separate documents/execution contexts — unlike shadow DOM, no selector prefix can cross
   * that boundary, so every frame must be searched independently. Single-frame pages (the
   * common case) skip the overhead of racing across frames entirely.
   *
   * Returns `null` (never throws) if nothing matches within `timeoutMs` in any frame, so
   * callers can produce their own clear "not found" error with the original, unprefixed
   * selector in the message.
   */
  private async resolveElement(
    page: Page,
    fullSelector: string,
    options: { visible?: boolean; timeoutMs?: number } = {},
  ): Promise<ElementHandle<Element> | null> {
    const timeoutMs = options.timeoutMs ?? 5000;
    const live = page.frames().filter((f) => !f.isDetached());
    // `page.frames()` always includes the main frame, so `live` is empty only in
    // pathological/mocked scenarios — fall back to the main frame defensively.
    const targets = live.length > 0 ? live : [page.mainFrame()];

    if (targets.length === 1) {
      const only = targets[0]!;
      return only
        .waitForSelector(fullSelector, { visible: options.visible, timeout: timeoutMs })
        .catch(() => null);
    }

    // Give the main frame a head start before racing every frame. A generic selector (e.g.
    // `[role="button"]`, used by click_by_role) can just as easily match inside a third-party
    // ad/tracking iframe as in the page the caller actually meant — a plain `Promise.any`
    // race would resolve to whichever frame's `waitForSelector` happens to settle first,
    // which can silently target the wrong frame. The main frame is checked with a short
    // timeout first; only if it doesn't have the element do the other frames get raced.
    const mainFrame = page.mainFrame();
    const mainFrameTimeoutMs = Math.min(timeoutMs, 1000);
    const mainFrameMatch = await mainFrame
      .waitForSelector(fullSelector, { visible: options.visible, timeout: mainFrameTimeoutMs })
      .catch(() => null);
    if (mainFrameMatch) return mainFrameMatch;

    const remainingTimeoutMs = Math.max(timeoutMs - mainFrameTimeoutMs, 0);
    if (remainingTimeoutMs === 0) return null;

    // Re-include the main frame in this second race (not just "otherFrames"): the first phase
    // only proves the element wasn't there within the first `mainFrameTimeoutMs` — it says
    // nothing about whether the element appears in the main frame later (e.g. content that
    // loads/renders asynchronously). Excluding it here would silently never find a main-frame
    // element that shows up after the head-start window on any page that also has iframes.
    try {
      return await Promise.any(
        targets.map((f) =>
          f.waitForSelector(fullSelector, { visible: options.visible, timeout: remainingTimeoutMs }),
        ),
      );
    } catch {
      return null;
    }
  }

  /**
   * Waits for `handle`'s bounding box to stop changing across two consecutive animation frames
   * before returning — best-effort and bounded, so a genuinely continuously-moving element (a
   * marquee, a live chart) just falls through once `timeoutMs` is spent rather than blocking
   * forever. Without this, a button revealed mid-CSS-transition (a slide-in panel, a modal
   * fading in) is technically visible and unoccluded the instant it's added to the DOM, well
   * before it finishes animating to its final position — nothing else in the click path would
   * catch that, since the click still lands on a real element at a real point, just prematurely.
   */
  private async waitForStableBoundingBox(handle: ElementHandle<Element>, timeoutMs = 1200): Promise<void> {
    await handle.evaluate((el, timeout) => {
      return new Promise<void>((resolve) => {
        const start = performance.now();
        let last: DOMRect | null = null;
        let stableFrames = 0;
        const tick = () => {
          const rect = el.getBoundingClientRect();
          if (last && rect.x === last.x && rect.y === last.y && rect.width === last.width && rect.height === last.height) {
            stableFrames++;
          } else {
            stableFrames = 0;
          }
          last = rect;
          if (stableFrames >= 2 || performance.now() - start > timeout) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }, timeoutMs);
  }

  /**
   * Click `selector`, but first verify the element is actually the topmost node at its
   * own click point, and afterward verify the click event was actually delivered to it.
   *
   * Two independent failure modes can make Puppeteer's plain `page.click()` report success
   * on a click that never really landed:
   *  1. Occlusion — if another element (an overlay, a sticky header, a duplicate node
   *     matching the same selector) is topmost at the element's bounding-box center, the
   *     real click event goes to that element instead while `page.click()` still resolves
   *     cleanly.
   *  2. A reproduced upstream Puppeteer/CDP defect where `ElementHandle.click()`'s
   *     `Input.dispatchMouseEvent`-based click can silently fail to deliver the click event
   *     to the page at all — observed specifically on a tab that previously underwent a
   *     click-triggered navigation — while still resolving without throwing. A plain
   *     JS-level `element.click()` reliably delivers the event even in that state, so it's
   *     used as an automatic fallback when delivery isn't observed.
   *
   * Operates entirely through the resolved `ElementHandle` (never re-querying by selector)
   * so it works uniformly whether the element lives in the main frame, a nested iframe, or an
   * open shadow root — `elementFromPoint` is called against the element's own root node
   * (its shadow root, if any, otherwise its document), since `document.elementFromPoint`
   * alone would miss elements inside a shadow tree.
   */
  private async verifiedClick(
    page: Page,
    selector: string,
    button: 'left' | 'right' | 'middle' = 'left',
    offset?: { x: number; y: number },
  ): Promise<void> {
    const handle = await this.resolveElement(page, `pierce/${selector}`, {
      visible: true,
      timeoutMs: 5000,
    });
    if (!handle) {
      throw new Error(`No visible element found for selector: ${selector}`);
    }
    await this.assertNotStale(handle, selector);
    await this.verifiedClickOnHandle(handle, selector, button, offset);
  }

  /**
   * The actual occlusion-check-then-click logic, operating on an already-resolved handle
   * instead of a selector — split out so callers that need a resolution strategy
   * {@link resolveElement}'s `pierce/` prefix can't express (e.g. `click_by_role`'s `aria/`
   * selector, which must reach `resolveElement` unprefixed) can still get the same
   * occlusion/stability/delivery verification as a normal selector-driven click.
   * `selector` here is used only for error messages.
   */
  private async verifiedClickOnHandle(
    handle: ElementHandle<Element>,
    selector: string,
    button: 'left' | 'right' | 'middle' = 'left',
    offset?: { x: number; y: number },
  ): Promise<void> {
    // Bring the element into the viewport BEFORE checking what's on top of it. Without this,
    // any element below the fold (a real, common case — e.g. a button revealed by scrolling a
    // cart/checkout page) has its click point outside the visible viewport, so
    // `elementFromPoint` returns null there and the occlusion check below wrongly reports the
    // element as "occluded" even though nothing is actually covering it.
    await handle.scrollIntoView().catch(() => {});

    // A button revealed mid-CSS-transition (e.g. a slide-in panel) is technically visible and
    // occlusion-free the instant it's added to the DOM, well before it's finished animating to
    // its final position — clicking immediately lands on a real element at a real point, so
    // nothing here would otherwise catch it, yet the interaction is semantically premature.
    // Wait for its bounding box to stop changing across consecutive animation frames (bounded,
    // best-effort — a genuinely continuously-moving element just falls through once the budget
    // is spent, rather than blocking forever).
    await this.waitForStableBoundingBox(handle).catch(() => {});

    const isHit = await handle.evaluate((el, off) => {
      const rect = el.getBoundingClientRect();
      const cx = off ? rect.x + off.x : rect.x + rect.width / 2;
      const cy = off ? rect.y + off.y : rect.y + rect.height / 2;
      const root = el.getRootNode() as Document | ShadowRoot;
      const topEl =
        typeof (root as ShadowRoot & { elementFromPoint?: unknown }).elementFromPoint === 'function'
          ? (root as unknown as { elementFromPoint(x: number, y: number): Element | null }).elementFromPoint(cx, cy)
          : document.elementFromPoint(cx, cy);
      return !!topEl && (topEl === el || el.contains(topEl) || topEl.contains(el));
    }, offset ?? null);
    if (!isHit) {
      throw new Error(
        `Element matching "${selector}" is occluded by another element at its click point — a click would not reach the intended target`,
      );
    }

    // A right-click's real signal is a 'contextmenu' event, not 'click' — a left/middle click
    // still fires 'click'. Listening for the wrong one would always read as "not delivered"
    // and wrongly trigger the JS-click fallback below (which can only ever simulate a *left*
    // click), so the marker/fallback logic must be button-aware.
    const deliveryEvent = button === 'right' ? 'contextmenu' : 'click';

    await handle.evaluate((el, evtName) => {
      const target = el as HTMLElement & { __ptClicked?: boolean };
      target.__ptClicked = false;
      target.addEventListener(evtName, () => { target.__ptClicked = true; }, { once: true, capture: true });
    }, deliveryEvent);

    // A click whose synchronous onclick handler opens a native dialog (alert/confirm/prompt)
    // blocks Chrome's own click dispatch until the dialog is dismissed — CDP's input dispatch
    // waits for in-page synchronous handlers to finish running. Race it against a short
    // timeout instead of silently waiting out BrowserTab's dialog auto-dismiss window, so a
    // dialog-triggering click still returns promptly and the caller gets a real chance to see
    // and handle the dialog (via getPendingDialog/handleDialog) before it's auto-dismissed.
    // The original click promise is left to settle in the background either way — swallowing
    // its eventual outcome so a late rejection can't surface as an unhandled rejection.
    await Promise.race([
      handle.click({ button, offset }).catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ]);

    // If the click itself triggered a navigation, the handle evaluating this check may already
    // be mid-teardown ("Execution context was destroyed") — that's strong evidence the click
    // WAS delivered (you can't navigate without the click/submit handler firing), so treat
    // that specific failure as "delivered" rather than triggering the fallback click below.
    //
    // If the click instead triggered a native dialog (alert/confirm/prompt), the page's
    // renderer is now synchronously blocked and this evaluate call won't resolve until the
    // dialog is handled (by the caller via handleDialog, or by BrowserTab's own auto-dismiss
    // safety net) — race it against a short timeout rather than silently waiting out that
    // entire window, so a dialog-triggering click still returns promptly and the caller gets
    // a real chance to see and handle the dialog before it's auto-dismissed.
    const delivered = await Promise.race([
      handle
        .evaluate((el) => !!(el as HTMLElement & { __ptClicked?: boolean }).__ptClicked)
        .catch(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 1500)),
    ]);

    if (!delivered) {
      if (button === 'right') {
        // There's no `element.click()`-equivalent single call for a right-click; dispatch a
        // synthetic contextmenu event directly instead.
        await handle.evaluate((el) => {
          el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
        });
      } else {
        await handle.evaluate((el) => (el as HTMLElement).click());
      }
    }
  }

  /** Same occlusion check as {@link verifiedClick}, applied before hovering. */
  private async verifiedHover(page: Page, selector: string, offset?: { x: number; y: number }): Promise<void> {
    const handle = await this.resolveElement(page, `pierce/${selector}`, {
      visible: true,
      timeoutMs: 5000,
    });
    if (!handle) {
      throw new Error(`No visible element found for selector: ${selector}`);
    }
    await this.assertNotStale(handle, selector);

    // Bring the element into the viewport BEFORE checking what's on top of it. Without this,
    // any element below the fold (a real, common case — e.g. a button revealed by scrolling a
    // cart/checkout page) has its click point outside the visible viewport, so
    // `elementFromPoint` returns null there and the occlusion check below wrongly reports the
    // element as "occluded" even though nothing is actually covering it.
    await handle.scrollIntoView().catch(() => {});

    // A button revealed mid-CSS-transition (e.g. a slide-in panel) is technically visible and
    // occlusion-free the instant it's added to the DOM, well before it's finished animating to
    // its final position — clicking immediately lands on a real element at a real point, so
    // nothing here would otherwise catch it, yet the interaction is semantically premature.
    // Wait for its bounding box to stop changing across consecutive animation frames (bounded,
    // best-effort — a genuinely continuously-moving element just falls through once the budget
    // is spent, rather than blocking forever).
    await this.waitForStableBoundingBox(handle).catch(() => {});

    const point = await handle.evaluate((el, off) => {
      const rect = el.getBoundingClientRect();
      const cx = off ? rect.x + off.x : rect.x + rect.width / 2;
      const cy = off ? rect.y + off.y : rect.y + rect.height / 2;
      const root = el.getRootNode() as Document | ShadowRoot;
      const topEl =
        typeof (root as ShadowRoot & { elementFromPoint?: unknown }).elementFromPoint === 'function'
          ? (root as unknown as { elementFromPoint(x: number, y: number): Element | null }).elementFromPoint(cx, cy)
          : document.elementFromPoint(cx, cy);
      const isHit = !!topEl && (topEl === el || el.contains(topEl) || topEl.contains(el));
      return { cx, cy, isHit };
    }, offset ?? null);
    if (!point.isHit) {
      throw new Error(
        `Element matching "${selector}" is occluded by another element at its hover point — a hover would not reach the intended target`,
      );
    }
    // ElementHandle.hover() always targets the element's center with no offset option — moving
    // the mouse to the exact (possibly offset) point directly is what actually supports hovering
    // a specific pixel within canvas-rendered UI, same as the offset-aware click above.
    if (offset) {
      await page.mouse.move(point.cx, point.cy);
    } else {
      await handle.hover();
    }
  }

  /**
   * Reject a target that comes from an older `browser.snapshot` than the page's current one.
   * Node ids are re-stamped fresh on every snapshot (along with a generation marker); if the
   * page has been re-snapshotted since a given id was handed out, blindly acting on it can hit
   * a different element than the caller intended. No-ops for a plain CSS selector the caller
   * wrote by hand (it won't carry a generation stamp at all).
   *
   * Reads `el.ownerDocument`, which resolves correctly to the element's own document whether
   * it's in the main frame, a nested iframe, or an open shadow root (shadow trees don't get
   * their own `Document` — they share the page's, unlike iframes).
   */
  private async assertNotStale(handle: ElementHandle<Element>, selector: string): Promise<void> {
    const isStale = await handle.evaluate(
      (el, genAttr, currentGenAttr) => {
        const elGen = el.getAttribute(genAttr);
        const currentGen = el.ownerDocument.documentElement.getAttribute(currentGenAttr);
        return !!elGen && !!currentGen && elGen !== currentGen;
      },
      SD_GENERATION_ATTR,
      SD_CURRENT_GENERATION_ATTR,
    );
    if (isStale) {
      throw new Error(
        `Element matching "${selector}" is from a stale snapshot (the page has been re-snapshotted since) — call browser.snapshot again and use a fresh node id.`,
      );
    }
  }
}
