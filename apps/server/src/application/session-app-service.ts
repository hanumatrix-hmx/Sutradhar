/**
 * @file apps/server/src/application/session-app-service.ts
 * @description Application service for browser session use cases, hiding browser internals from HTTP controllers.
 */

import { SessionId, BrowserSessionDto } from '@pinchtab/contracts';
import { BrowserSessionManager } from '@pinchtab/browser';
import { SessionRepository } from '@pinchtab/storage';
import { StructuredLogger } from '@pinchtab/observability';

export interface CreateSessionCommand {
  readonly isIncognito?: boolean;
  readonly initialUrl?: string;
  /** Caller-supplied id — the UI session id, so both sides share one session. */
  readonly sessionId?: SessionId;
}

export class SessionApplicationService {
  private readonly sessionManager: BrowserSessionManager;
  private readonly sessionRepository: SessionRepository;
  private readonly logger: StructuredLogger;

  public constructor(
    sessionManager: BrowserSessionManager,
    sessionRepository: SessionRepository,
    logger?: StructuredLogger,
  ) {
    this.sessionManager = sessionManager;
    this.sessionRepository = sessionRepository;
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
  }

  public async createSession(command: CreateSessionCommand = {}): Promise<BrowserSessionDto> {
    this.logger.info('[SessionApplicationService] Creating browser session', {
      isIncognito: command.isIncognito,
      initialUrl: command.initialUrl,
      ...(command.sessionId ? { sessionId: command.sessionId } : {}),
    });
    // Idempotent for caller-supplied ids: relaunching a live session returns
    // it instead of spawning a second browser.
    if (command.sessionId) {
      const existing = this.sessionManager.getSession(command.sessionId);
      if (existing) {
        return existing.toDto();
      }
    }
    const session = await this.sessionManager.createSession({
      isIncognito: command.isIncognito,
      initialUrl: command.initialUrl,
      ...(command.sessionId ? { sessionId: command.sessionId } : {}),
    });

    const dto = session.toDto();
    await this.sessionRepository.saveSession(dto);
    return dto;
  }

  public async getSession(id: SessionId): Promise<BrowserSessionDto | undefined> {
    const active = this.sessionManager.getSession(id);
    if (active) {
      return active.toDto();
    }
    return this.sessionRepository.findSession(id);
  }

  public async listSessions(): Promise<readonly BrowserSessionDto[]> {
    const activeDtos = this.sessionManager.getAllSessions().map((s) => s.toDto());
    if (activeDtos.length > 0) {
      return activeDtos;
    }
    return this.sessionRepository.listSessions();
  }

  public async closeSession(id: SessionId): Promise<void> {
    this.logger.info(`[SessionApplicationService] Closing session ${id}`);
    await this.sessionManager.closeSession(id);
    await this.sessionRepository.deleteSession(id);
  }
}
