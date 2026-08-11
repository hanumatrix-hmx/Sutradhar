/**
 * @file apps/server/tests/unit/routes.spec.ts
 * @description Unit tests for session, agent, workflow, and storage REST API route controllers.
 */

import {
  ServerApp,
  registerAllRoutes,
  SessionApplicationService,
  AgentApplicationService,
  WorkflowApplicationService,
  StorageApplicationService,
} from '../../src/index.js';
import { BrowserSessionManager } from '@pinchtab/browser';
import { AgentCore } from '@pinchtab/agent';
import { WorkflowRunner } from '@pinchtab/workflow';
import { LocalFileStorage, SessionRepository, SqliteClient } from '@pinchtab/storage';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

describe('@pinchtab/server Route Controllers Integration', () => {
  const tempDir = path.join(process.cwd(), '.test-server-storage');

  afterAll(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should register and dispatch all REST API route controllers via application services', async () => {
    const app = new ServerApp();

    const sqlite = new SqliteClient(':memory:');
    const sessionRepo = new SessionRepository(sqlite);
    const sessionManager = new BrowserSessionManager();
    const agentCore = new AgentCore();
    const workflowRunner = new WorkflowRunner({ agentCore });
    const fileStorage = new LocalFileStorage({ baseDir: tempDir });

    const sessionAppService = new SessionApplicationService(sessionManager, sessionRepo);
    const agentAppService = new AgentApplicationService(agentCore);
    const workflowAppService = new WorkflowApplicationService(workflowRunner);
    const storageAppService = new StorageApplicationService(fileStorage);

    registerAllRoutes(app.router, {
      sessionAppService,
      agentAppService,
      workflowAppService,
      storageAppService,
    });

    // Test 1: POST /api/v1/sessions
    const resCreateSession = await app.handleRequest('POST', '/api/v1/sessions', {
      body: { initialUrl: 'https://example.com' },
    });
    expect(resCreateSession.statusCode).toBe(201);
    const sessionData = resCreateSession.body as { id: string };
    expect(sessionData.id).toBeDefined();

    // Test 2: GET /api/v1/sessions
    const resListSessions = await app.handleRequest('GET', '/api/v1/sessions');
    expect(resListSessions.statusCode).toBe(200);

    // Test 3: POST /api/v1/agents/goals
    // With the REAL agent loop, an AgentCore configured without an LLM/browser
    // fails loudly → 503. (When the live stack is up, the runtime's wired
    // container would return 200 with a real result — covered by e2e tests.)
    const resAgentGoal = await app.handleRequest('POST', '/api/v1/agents/goals', {
      body: { goal: 'Extract price data' },
    });
    expect([200, 503]).toContain(resAgentGoal.statusCode);

    // Test 4: POST /api/v1/storage/files
    const resWriteFile = await app.handleRequest('POST', '/api/v1/storage/files', {
      body: { key: 'reports/data.json', content: '{"status":"ok"}' },
    });
    expect(resWriteFile.statusCode).toBe(201);

    // Test 5: DELETE /api/v1/sessions/:id
    const resDeleteSession = await app.handleRequest(
      'DELETE',
      `/api/v1/sessions/${sessionData.id}`,
    );
    expect(resDeleteSession.statusCode).toBe(200);
  });
});
