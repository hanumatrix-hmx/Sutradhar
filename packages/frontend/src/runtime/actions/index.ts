/**
 * @file packages/frontend/src/runtime/actions/index.ts
 * @description Action Engine barrel export and ActionRegistry initialization.
 */

import { ActionRegistry } from './actionRegistry.js';
import {
  NavigateAction,
  CreateTabAction,
  CloseTabAction,
  FocusTabAction,
  ReloadAction,
  BackAction,
  ForwardAction,
} from './impl/navigationActions.js';
import {
  ClickElementAction,
  TypeTextAction,
  HoverElementAction,
  ScrollAction,
} from './impl/interactionActions.js';
import {
  ExtractDOMAction,
  CaptureScreenshotAction,
  ExecuteJavaScriptAction,
  WaitAction,
} from './impl/dataActions.js';
import { DownloadFileAction, UploadFileAction } from './impl/fileActions.js';

export * from './actionTypes.js';
export * from './actionContext.js';
export * from './browserPageAction.js';
export * from './actionExecutor.js';
export * from './actionRegistry.js';
export * from './actionHistory.js';
export * from './impl/navigationActions.js';
export * from './impl/interactionActions.js';
export * from './impl/dataActions.js';
export * from './impl/fileActions.js';

// Auto-register all 17 actions into singleton ActionRegistry
const registry = ActionRegistry.getInstance();

registry.register('Navigate', (input) => new NavigateAction(input), {
  category: 'navigation',
  requiresBrowserRunning: true,
});
registry.register('CreateTab', (input) => new CreateTabAction(input), {
  category: 'navigation',
  requiresBrowserRunning: true,
});
registry.register('CloseTab', (input) => new CloseTabAction(input), {
  category: 'navigation',
  requiresBrowserRunning: true,
});
registry.register('FocusTab', (input) => new FocusTabAction(input), {
  category: 'navigation',
  requiresBrowserRunning: true,
});
registry.register('Reload', (input) => new ReloadAction(input), {
  category: 'navigation',
  requiresBrowserRunning: true,
});
registry.register('Back', (input) => new BackAction(input), {
  category: 'navigation',
  requiresBrowserRunning: true,
});
registry.register('Forward', (input) => new ForwardAction(input), {
  category: 'navigation',
  requiresBrowserRunning: true,
});

registry.register('ClickElement', (input) => new ClickElementAction(input), {
  category: 'interaction',
  requiresBrowserRunning: true,
});
registry.register('TypeText', (input) => new TypeTextAction(input), {
  category: 'interaction',
  requiresBrowserRunning: true,
});
registry.register('HoverElement', (input) => new HoverElementAction(input), {
  category: 'interaction',
  requiresBrowserRunning: true,
});
registry.register('Scroll', (input) => new ScrollAction(input), {
  category: 'interaction',
  requiresBrowserRunning: true,
});

registry.register('ExtractDOM', (input) => new ExtractDOMAction(input), {
  category: 'data',
  requiresBrowserRunning: true,
});
registry.register('CaptureScreenshot', (input) => new CaptureScreenshotAction(input), {
  category: 'data',
  requiresBrowserRunning: true,
});
registry.register('ExecuteJavaScript', (input) => new ExecuteJavaScriptAction(input), {
  category: 'data',
  requiresBrowserRunning: true,
});
registry.register('Wait', (input) => new WaitAction(input), {
  category: 'data',
  requiresBrowserRunning: false,
});

registry.register('DownloadFile', (input) => new DownloadFileAction(input), {
  category: 'file',
  requiresBrowserRunning: true,
});
registry.register('UploadFile', (input) => new UploadFileAction(input), {
  category: 'file',
  requiresBrowserRunning: true,
});
