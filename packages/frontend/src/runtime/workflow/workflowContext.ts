/**
 * @file packages/frontend/src/runtime/workflow/workflowContext.ts
 * @description WorkflowContext providing dependencies during workflow execution.
 */

import { ActionExecutor } from '../actions/actionExecutor.js';
import { ActionContext } from '../actions/actionContext.js';
import { VariableStore } from './variableStore.js';
import { CancellationToken } from '../actions/actionTypes.js';

export interface WorkflowContext {
  readonly sessionId: string;
  readonly workflowId: string;
  readonly actionExecutor: ActionExecutor;
  readonly actionContext: ActionContext;
  readonly variableStore: VariableStore;
  readonly cancellationToken?: CancellationToken;
}
