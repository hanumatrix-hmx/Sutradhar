/**
 * @file apps/server/src/application/agent-app-service.ts
 * @description Application service for autonomous agent use cases.
 */

import { AgentGoalDto } from '@pinchtab/contracts';
import { AgentCore } from '@pinchtab/agent';
import { StructuredLogger } from '@pinchtab/observability';

export interface ExecuteGoalCommand {
  readonly goal: string;
  /**
   * Client session id — echoed back for run linkage (Phase 2) AND used to
   * bind the agent loop to the client's backend browser session (Phase 3).
   */
  readonly sessionId?: string;
}

export interface AgentStatusResult {
  readonly agentId: string;
  readonly name: string;
  readonly state: string;
}

export class AgentApplicationService {
  private readonly agentCore: AgentCore;
  private readonly logger: StructuredLogger;

  public constructor(agentCore: AgentCore, logger?: StructuredLogger) {
    this.agentCore = agentCore;
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
  }

  public async executeGoal(command: ExecuteGoalCommand): Promise<AgentGoalDto> {
    this.logger.info('[AgentApplicationService] Executing agent goal use case', {
      goal: command.goal,
      ...(command.sessionId ? { sessionId: command.sessionId } : {}),
    });
    // Pass the client session through so the agent loop drives the SAME
    // backend browser session the user's viewport is watching.
    const result = await this.agentCore.executeGoal(command.goal, command.sessionId);
    // Run linkage: echo the requesting session so the client can bind the
    // server-assigned run id (result.id) to its session model.
    return command.sessionId ? { ...result, sessionId: command.sessionId } : result;
  }

  public getStatus(): AgentStatusResult {
    return {
      agentId: this.agentCore.agentId,
      name: this.agentCore.name,
      state: this.agentCore.state,
    };
  }
}
