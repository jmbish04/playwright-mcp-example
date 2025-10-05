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

        // Configuration Management Endpoints
        case '/config':
          return await handleConfigEndpoint(request, db);
          
        case '/config/list':
          const configs = await db.getAllSystemInstructions();
          return successResponse({ configs });

        case '/config/find':
          const url = searchParams.get('url');
          if (!url) return errorResponse('URL parameter is required');

          const config = await db.getSystemInstructionByUrl(url);
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
      const storedConfig = await db.getSystemInstructionByUrl(payload.url);
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

  const url = new URL(request.url);

  if (assetPath) {
    url.pathname = assetPath.startsWith('/') ? assetPath : `/${assetPath}`;
  }

  const assetRequest = assetPath ? new Request(url.toString(), request) : request;
  const response = await env.ASSETS.fetch(assetRequest);

  if (response.status === 404 && assetPath && !assetPath.endsWith('/index.html')) {
    return serveAsset(env, request, '/index.html');
  }

  return response;
}
