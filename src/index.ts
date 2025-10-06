import { env } from 'cloudflare:workers';
import { createMcpAgent } from '@cloudflare/playwright-mcp';
import { DatabaseService } from './database';
import { Logger } from './logger';
import { TraditionalTestExecutor } from './traditional-test-executor';
import { AgenticTestExecutor } from './agentic-test-executor';
import { PlaywrightClient } from './playwright-client';
import { SystemInstruction, TraditionalTestCase, AgenticTestConfig } from './types';

export const PlaywrightMCP = createMcpAgent(env.BROWSER);

// Generate unique session ID
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateRunId(): string {
  return `unit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// URL pattern matching helper
function findBestMatchingConfig(url: string, configs: SystemInstruction[]): SystemInstruction | null {
  const matches = configs.filter(config => {
    const pattern = config.url_pattern;
    if (pattern.includes('*')) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      return regex.test(url);
    }
    return url.includes(pattern);
  });

  // Return the most specific match (longest pattern)
  return matches.sort((a, b) => b.url_pattern.length - a.url_pattern.length)[0] || null;
}

// Error response helper
function errorResponse(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Success response helper  
function successResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const { pathname, searchParams } = new URL(request.url);
    const db = new DatabaseService(env.DB);

    try {
      switch (pathname) {
        case '/':
          if (request.method === 'GET' || request.method === 'HEAD') {
            return await serveAsset(env, request, '/index.html');
          }
          return errorResponse('Method not allowed', 405);

        case '/docs':
          if (request.method === 'GET' || request.method === 'HEAD') {
            return await serveAsset(env, request, '/index.html');
          }
          return errorResponse('Method not allowed', 405);

        case '/config':
          // Serve SPA page under /config.html on GET/HEAD, otherwise REST under /config API
          if (request.method === 'GET' || request.method === 'HEAD') {
            return await serveAsset(env, request, '/config.html');
          }
          return await handleConfigEndpoint(request, db);

        case '/config.html':
          if (request.method === 'GET' || request.method === 'HEAD') {
            return await serveAsset(env, request, '/config.html');
          }
          return errorResponse('Method not allowed', 405);

        case '/tests.html':
          if (request.method === 'GET' || request.method === 'HEAD') {
            return await serveAsset(env, request, '/tests.html');
          }
          return errorResponse('Method not allowed', 405);

        case '/tests/run-unit':
          return await handleRunUnitTests(request, env, db);

        case '/tests/unit-results':
          if (request.method === 'GET') {
            return await handleGetUnitResults(request, db);
          }
          return errorResponse('Method not allowed', 405);

        case '/tests/unit-results/import':
          return await handleImportUnitResults(request, env, db);

        case '/tests/unit-latest':
          if (request.method === 'GET') {
            return await handleGetLatestUnitRun(db);
          }
          return errorResponse('Method not allowed', 405);

        case '/tests/unit-runs':
          if (request.method === 'GET') {
            return await handleListUnitRuns(request, db);
          }
          return errorResponse('Method not allowed', 405);

        case '/sessions.html':
          if (request.method === 'GET' || request.method === 'HEAD') {
            return await serveAsset(env, request, '/sessions.html');
          }
          return errorResponse('Method not allowed', 405);

        case '/openapi.json':
          if (request.method === 'GET' || request.method === 'HEAD') {
            return await serveAsset(env, request, '/openapi.json');
          }
          return errorResponse('Method not allowed', 405);

        case '/sse':
        case '/sse/message':
          return PlaywrightMCP.serveSSE('/sse').fetch(request, env, ctx);
          
        case '/mcp':
          return PlaywrightMCP.serve('/mcp').fetch(request, env, ctx);

        // Configuration Management Endpoints (JSON only)
        case '/config.json':
          return await handleConfigEndpoint(request, db);
          
        case '/config/list':
          const configs = await db.getAllSystemInstructions();
          return successResponse({ configs });

        case '/config/find':
          const url = searchParams.get('url');
          if (!url) return errorResponse('URL parameter is required');

      const config = await db.getSystemInstructionByUrl(url, 'traditional');
          return successResponse({ config });

        case '/admin/setup':
          if (request.method !== 'POST') {
            return errorResponse('Method not allowed', 405);
          }

          const setupResult = await db.ensureSchema();
          const schemaAfterSetup = await db.getSchemaOverview();
          return successResponse({
            message: 'Database schema ensured',
            ...setupResult,
            schema: schemaAfterSetup.tables
          });

        case '/admin/schema':
          if (request.method !== 'GET') {
            return errorResponse('Method not allowed', 405);
          }

          const schema = await db.getSchemaOverview();
          return successResponse(schema);

        case '/admin/diag':
          if (request.method !== 'GET') {
            return errorResponse('Method not allowed', 405);
          }

          const diagSchema = await db.getSchemaOverview();
          return successResponse({
            status: 'ok',
            timestamp: new Date().toISOString(),
            tables: diagSchema.tables.length,
          });

        // Traditional Testing Endpoints
        case '/test/traditional':
          return await handleTraditionalTest(request, env, db);

        // Agentic Testing Endpoints  
        case '/test/agentic':
          return await handleAgenticTest(request, env, db);

        // Session Management Endpoints
        case '/session':
          return await handleSessionEndpoint(request, db);
          
        case '/session/list':
          const sessions = await db.getAllTestSessions();
          return successResponse({ sessions });

        case '/session/results':
          const sessionId = searchParams.get('sessionId');
          if (!sessionId) return errorResponse('sessionId parameter is required');
          
          const results = await db.getTestResults(sessionId);
          const logs = await db.getActionLogs(sessionId);
          const stats = await db.getSessionStats(sessionId);
          
          return successResponse({ 
            sessionId, 
            results, 
            logs, 
            stats 
          });

        // Analytics and Cleanup Endpoints
        case '/analytics/stats':
          const analyticsSessionId = searchParams.get('sessionId');
          if (!analyticsSessionId) return errorResponse('sessionId parameter is required');
          
          const sessionStats = await db.getSessionStats(analyticsSessionId);
          return successResponse({ stats: sessionStats });

        case '/cleanup/old-sessions':
          const daysOld = parseInt(searchParams.get('days') || '30');
          const deletedCount = await db.cleanupOldSessions(daysOld);
          return successResponse({ message: `Cleaned up ${deletedCount} old sessions` });

        // Health Check
        case '/health':
          try {
            await db.getSchemaOverview();
          } catch (error) {
            return errorResponse(
              error instanceof Error ? `Database check failed: ${error.message}` : 'Database check failed',
              503
            );
          }

          return successResponse({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: '1.0.0'
          });

        default:
          if ((request.method === 'GET' || request.method === 'HEAD') && 'ASSETS' in env && env.ASSETS) {
            const assetResponse = await env.ASSETS.fetch(request);
            if (assetResponse.status !== 404) {
              return assetResponse;
            }
          }

          return errorResponse('Not Found', 404);
      }
    } catch (error) {
      console.error('Request handling error:', error);
      return errorResponse(
        error instanceof Error ? error.message : 'Internal Server Error',
        500
      );
    }
  },
};

// Configuration endpoint handler
async function handleConfigEndpoint(request: Request, db: DatabaseService): Promise<Response> {
  switch (request.method) {
    case 'GET':
      const configs = await db.getAllSystemInstructions();
      return successResponse({ configs });

    case 'POST':
      try {
        const config: Omit<SystemInstruction, 'id'> = await request.json();
        
        if (!config.url_pattern || !config.name || !config.instructions || !config.test_type) {
          return errorResponse('Missing required fields: url_pattern, name, instructions, test_type');
        }

        const id = await db.createSystemInstruction(config);
        return successResponse({ message: 'Configuration created', id });
      } catch (error) {
        return errorResponse('Invalid JSON payload');
      }

    case 'PUT':
      try {
        const { id, ...updates }: SystemInstruction = await request.json();
        
        if (!id) {
          return errorResponse('ID is required for updates');
        }

        await db.updateSystemInstruction(id, updates);
        return successResponse({ message: 'Configuration updated' });
      } catch (error) {
        return errorResponse('Invalid JSON payload');
      }

    case 'DELETE':
      const url = new URL(request.url);
      const id = parseInt(url.searchParams.get('id') || '');
      
      if (!id) {
        return errorResponse('ID parameter is required');
      }

      await db.deleteSystemInstruction(id);
      return successResponse({ message: 'Configuration deleted' });

    default:
      return errorResponse('Method not allowed', 405);
  }
}

// Traditional test handler
async function handleTraditionalTest(request: Request, env: Env, db: DatabaseService): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const payload = await request.json() as {
      url: string;
      testCase?: TraditionalTestCase;
      useStoredConfig?: boolean;
    };

    if (!payload.url) {
      return errorResponse('URL is required');
    }

    const sessionId = generateSessionId();
    const logger = new Logger(db, sessionId);
    
    let testCase: TraditionalTestCase;
    let configId: number | undefined;

    if (payload.useStoredConfig !== false) {
      // Try to find stored configuration
      const config = await db.getSystemInstructionByUrl(payload.url);
      if (config && config.test_type === 'traditional') {
        try {
          testCase = JSON.parse(config.instructions);
          configId = config.id;
          await logger.logInfo('Using stored configuration', { configId, configName: config.name });
        } catch (error) {
          await logger.logWarning('Failed to parse stored configuration, using provided test case');
          if (!payload.testCase) {
            return errorResponse('No valid configuration found and no test case provided');
          }
          testCase = payload.testCase;
        }
      } else {
        if (!payload.testCase) {
          return errorResponse('No configuration found for URL and no test case provided');
        }
        testCase = payload.testCase;
      }
    } else {
      if (!payload.testCase) {
        return errorResponse('Test case is required when not using stored config');
      }
      testCase = payload.testCase;
    }

    // Create test session
    await db.createTestSession({
      id: sessionId,
      url: payload.url,
      test_type: 'traditional',
      status: 'running',
      config_id: configId
    });

    await logger.logSessionStart(payload.url, 'traditional');

    // Execute test
    const playwrightClient = new PlaywrightClient(env.BROWSER);
    const executor = new TraditionalTestExecutor(playwrightClient, db, logger);
    const result = await executor.executeTest(sessionId, testCase);

    // Update session status
    await db.updateTestSession(sessionId, {
      status: result.success ? 'completed' : 'failed',
      end_time: new Date().toISOString(),
      results: JSON.stringify(result),
      error_summary: result.error_summary
    });

    await logger.logSessionEnd(result.success ? 'completed' : 'failed', result);

    return successResponse({ 
      sessionId,
      success: result.success,
      executionTime: result.execution_time_ms,
      results: result.results,
      screenshots: result.screenshots,
      errorSummary: result.error_summary
    });

  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Test execution failed');
  }
}

// Agentic test handler
async function handleAgenticTest(request: Request, env: Env, db: DatabaseService): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const payload = await request.json() as {
      url: string;
      config?: AgenticTestConfig;
      useStoredConfig?: boolean;
    };

    if (!payload.url) {
      return errorResponse('URL is required');
    }

    const sessionId = generateSessionId();
    const logger = new Logger(db, sessionId);
    
    let config: AgenticTestConfig;
    let configId: number | undefined;

    if (payload.useStoredConfig !== false) {
      // Try to find stored configuration
      const storedConfig = await db.getSystemInstructionByUrl(payload.url, 'agentic');
      if (storedConfig && storedConfig.test_type === 'agentic') {
        try {
          config = JSON.parse(storedConfig.instructions);
          configId = storedConfig.id;
          await logger.logInfo('Using stored agentic configuration', { configId, configName: storedConfig.name });
        } catch (error) {
          await logger.logWarning('Failed to parse stored agentic configuration, using provided config');
          if (!payload.config) {
            return errorResponse('No valid agentic configuration found and no config provided');
          }
          config = payload.config;
        }
      } else {
        if (!payload.config) {
          return errorResponse('No agentic configuration found for URL and no config provided');
        }
        config = payload.config;
      }
    } else {
      if (!payload.config) {
        return errorResponse('Agentic config is required when not using stored config');
      }
      config = payload.config;
    }

    // Create test session
    await db.createTestSession({
      id: sessionId,
      url: payload.url,
      test_type: 'agentic',
      status: 'running',
      config_id: configId
    });

    await logger.logSessionStart(payload.url, 'agentic');

    // Execute agentic test
    const playwrightClient = new PlaywrightClient(env.BROWSER);
    const executor = new AgenticTestExecutor(playwrightClient, db, logger);
    const result = await executor.executeTest(sessionId, config);

    // Update session status
    await db.updateTestSession(sessionId, {
      status: result.success ? 'completed' : 'failed',
      end_time: new Date().toISOString(),
      results: JSON.stringify(result),
      error_summary: result.error_summary
    });

    await logger.logSessionEnd(result.success ? 'completed' : 'failed', result);

    return successResponse({ 
      sessionId,
      success: result.success,
      executionTime: result.execution_time_ms,
      results: result.results,
      screenshots: result.screenshots,
      errorSummary: result.error_summary
    });

  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Agentic test execution failed');
  }
}

// Session endpoint handler
async function handleSessionEndpoint(request: Request, db: DatabaseService): Promise<Response> {
  const { searchParams } = new URL(request.url);
  
  switch (request.method) {
    case 'GET':
      const sessionId = searchParams.get('sessionId');
      if (!sessionId) {
        const sessions = await db.getAllTestSessions();
        return successResponse({ sessions });
      }
      
      const session = await db.getTestSession(sessionId);
      if (!session) {
        return errorResponse('Session not found', 404);
      }
      
      const results = await db.getTestResults(sessionId);
      const logs = await db.getActionLogs(sessionId);
      const stats = await db.getSessionStats(sessionId);
      
      return successResponse({
        session,
        results,
        logs,
        stats
      });

    case 'DELETE':
      const deleteSessionId = searchParams.get('sessionId');
      if (!deleteSessionId) {
        return errorResponse('sessionId parameter is required');
      }
      
      await db.updateTestSession(deleteSessionId, { status: 'cancelled' });
      return successResponse({ message: 'Session cancelled' });

    default:
      return errorResponse('Method not allowed', 405);
  }
}

async function serveAsset(env: Env, request: Request, assetPath?: string): Promise<Response> {
  if (!('ASSETS' in env) || !env.ASSETS) {
    return new Response('Not Found', { status: 404 });
  }

  if (assetPath) {
    const url = new URL(request.url);
    url.pathname = assetPath.startsWith('/') ? assetPath : `/${assetPath}`;
    return env.ASSETS.fetch(new Request(url.toString(), request));
  }

  return env.ASSETS.fetch(request);
}

async function handleRunUnitTests(request: Request, env: Env, db: DatabaseService): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const runId = generateRunId();
  const isNodeRuntime = typeof (globalThis as any).process !== 'undefined';
  const message = isNodeRuntime
    ? `Run unit tests locally with \`pnpm ts-node scripts/run-vitest.ts --run-id ${runId}\` and upload the generated results file.`
    : 'CI should execute Vitest and POST the JSON results to /tests/unit-results/import.';

  await db.createUnitTestRow({
    run_id: runId,
    test_id: 'run-initialized',
    test_name: 'Unit test run initialized',
    status: 'PASS',
    test_logs: message,
    test_code: null,
    ai_response: 'Run initialization recorded.',
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
  });

  return successResponse({
    run_id: runId,
    mode: isNodeRuntime ? 'local' : 'remote',
    message,
  }, 201);
}

async function handleImportUnitResults(request: Request, env: Env, db: DatabaseService): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  let payload: any;
  try {
    payload = await request.json();
  } catch (error) {
    return errorResponse('Invalid JSON payload');
  }

  if (!payload || typeof payload.run_id !== 'string') {
    return errorResponse('run_id is required');
  }

  if (!Array.isArray(payload.results)) {
    return errorResponse('results array is required');
  }

  const runId: string = payload.run_id;
  const summary = { total: 0, passed: 0, failed: 0 };
  const processed: Array<{ id: number; test_id: string; status: 'PASS' | 'FAIL'; ai_response: string }>
    = [];

  for (const result of payload.results) {
    if (!result || typeof result.test_id !== 'string' || typeof result.test_name !== 'string') {
      return errorResponse('Each result requires test_id and test_name');
    }

    const status = result.status === 'PASS' ? 'PASS' : result.status === 'FAIL' ? 'FAIL' : null;
    if (!status) {
      return errorResponse('status must be PASS or FAIL');
    }

    const startedAt = new Date().toISOString();
    const rowId = await db.createUnitTestRow({
      run_id: runId,
      test_session_id: result.test_session_id ?? null,
      test_result_id: result.test_result_id ?? null,
      test_id: result.test_id,
      test_name: result.test_name,
      test_code: result.test_code ?? null,
      test_logs: result.test_logs ?? null,
      status,
      ai_response: null,
      started_at: startedAt,
      finished_at: null,
    });

    const ai_response = await analyzeUnitTestResult(env, {
      testName: result.test_name,
      status,
      logs: result.test_logs ?? '',
      code: result.test_code ?? '',
    });

    await db.completeUnitTestRow(rowId, {
      ai_response,
      finished_at: new Date().toISOString(),
    });

    summary.total += 1;
    if (status === 'PASS') summary.passed += 1; else summary.failed += 1;
    processed.push({ id: rowId, test_id: result.test_id, status, ai_response });
  }

  return successResponse({
    run_id: runId,
    stats: summary,
    processed,
  });
}

async function handleGetUnitResults(request: Request, db: DatabaseService): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get('run_id');
  if (!runId) {
    return errorResponse('run_id parameter is required');
  }

  const rows = await db.listUnitTestRuns(runId);
  const stats = rows.reduce((acc, row) => {
    acc.total += 1;
    if (row.status === 'PASS') acc.passed += 1; else acc.failed += 1;
    return acc;
  }, { total: 0, passed: 0, failed: 0 });
  const completed = rows.length > 0 && rows.every(row => !!row.finished_at);

  return successResponse({
    run_id: runId,
    results: rows,
    stats,
    completed,
  });
}

async function handleGetLatestUnitRun(db: DatabaseService): Promise<Response> {
  const latest = await db.getLatestUnitRun();
  if (!latest) {
    return successResponse({ run: null, rows: [] });
  }

  return successResponse(latest);
}

async function handleListUnitRuns(request: Request, db: DatabaseService): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get('limit');
  const limit = limitParam ? Math.min(50, Math.max(1, Number(limitParam) || 10)) : 10;
  const runs = await db.listRecentUnitRuns(limit);
  return successResponse({ runs });
}

async function analyzeUnitTestResult(env: Env, details: { testName: string; status: 'PASS' | 'FAIL'; logs: string; code: string; }): Promise<string> {
  if (!('AI' in env) || !env.AI || typeof (env as any).AI?.run !== 'function') {
    return 'AI not configured';
  }

  const model = '@cf/meta/llama-3.1-8b-instruct';
  const prompt = `You are analyzing a Vitest unit test result.\nTest name: ${details.testName}\nOutcome: ${details.status}.\nTest code:\n${details.code || 'N/A'}\nLogs:\n${details.logs || 'No logs provided.'}\nSummarize what happened, explain any failures, and suggest fixes.`;

  try {
    const result = await (env as any).AI.run(model, {
      messages: [
        { role: 'system', content: 'You are an assistant that explains unit test outcomes clearly and concisely.' },
        { role: 'user', content: prompt },
      ],
    });

    if (!result) {
      return 'No AI response returned.';
    }

    if (typeof result === 'string') {
      return result;
    }

    const text = result.output_text || result.response || JSON.stringify(result);
    return typeof text === 'string' && text.trim().length > 0 ? text : JSON.stringify(result);
  } catch (error) {
    return `AI analysis failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}
