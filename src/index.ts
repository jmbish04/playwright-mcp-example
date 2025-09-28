import { env } from 'cloudflare:workers';
import { createMcpAgent } from '@cloudflare/playwright-mcp';
import { DatabaseService } from './database';
import { Logger } from './logger';
import { TraditionalTestExecutor } from './traditional-test-executor';
import { AgenticTestExecutor } from './agentic-test-executor';
import type { PlaywrightMcpAgent } from './types';
import { SystemInstruction, TraditionalTestCase, AgenticTestConfig } from './types';

export const PlaywrightMCP = createMcpAgent(env.BROWSER) as PlaywrightMcpAgent;

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

        // API Documentation
        case '/docs':
        case '/':
          return new Response(getApiDocumentation(), {
            headers: { 'Content-Type': 'text/html' }
          });

        default:
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
    const executor = new TraditionalTestExecutor(PlaywrightMCP, db, logger);
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
    const executor = new AgenticTestExecutor(PlaywrightMCP, db, logger);
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

// API Documentation
function getApiDocumentation(): string {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>Playwright Testing Utility Worker API</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
        .endpoint { background: #f5f5f5; padding: 15px; margin: 10px 0; border-radius: 5px; }
        .method { color: white; padding: 3px 8px; border-radius: 3px; font-weight: bold; }
        .get { background: #4CAF50; }
        .post { background: #2196F3; }
        .put { background: #FF9800; }
        .delete { background: #f44336; }
        code { background: #f0f0f0; padding: 2px 4px; border-radius: 3px; }
        pre { background: #f0f0f0; padding: 10px; border-radius: 5px; overflow-x: auto; }
    </style>
</head>
<body>
    <h1>Playwright Testing Utility Worker API</h1>
    <p>A comprehensive testing utility for Cloudflare Workers with traditional and AI agentic testing capabilities.</p>
    
    <h2>Configuration Management</h2>
    <div class="endpoint">
        <span class="method get">GET</span> <code>/config</code> - List all configurations
    </div>
    <div class="endpoint">
        <span class="method post">POST</span> <code>/config</code> - Create new configuration
        <pre>{"url_pattern": "*.example.com", "name": "Example Test", "instructions": "{...}", "test_type": "traditional"}</pre>
    </div>
    <div class="endpoint">
        <span class="method get">GET</span> <code>/config/find?url={url}</code> - Find configuration for URL
    </div>
    
    <h2>Testing</h2>
    <div class="endpoint">
        <span class="method post">POST</span> <code>/test/traditional</code> - Execute traditional test
        <pre>{"url": "https://example.com", "testCase": {...}, "useStoredConfig": true}</pre>
    </div>
    <div class="endpoint">
        <span class="method post">POST</span> <code>/test/agentic</code> - Execute AI agentic test
        <pre>{"url": "https://example.com", "config": {"goal": "...", "success_criteria": [...]}, "useStoredConfig": true}</pre>
    </div>
    
    <h2>Session Management</h2>
    <div class="endpoint">
        <span class="method get">GET</span> <code>/session</code> - List all sessions
    </div>
    <div class="endpoint">
        <span class="method get">GET</span> <code>/session?sessionId={id}</code> - Get session details
    </div>
    <div class="endpoint">
        <span class="method get">GET</span> <code>/session/results?sessionId={id}</code> - Get session results and logs
    </div>
    
    <h2>Analytics</h2>
    <div class="endpoint">
        <span class="method get">GET</span> <code>/analytics/stats?sessionId={id}</code> - Get session statistics
    </div>
    <div class="endpoint">
        <span class="method post">POST</span> <code>/cleanup/old-sessions?days={days}</code> - Cleanup old sessions
    </div>
    
    <h2>Utility</h2>
    <div class="endpoint">
        <span class="method get">GET</span> <code>/health</code> - Health check
    </div>
    <div class="endpoint">
        <span class="method get">GET</span> <code>/mcp</code> - MCP endpoint for AI assistants
    </div>
    <div class="endpoint">
        <span class="method get">GET</span> <code>/sse</code> - Server-sent events endpoint
    </div>
</body>
</html>`;
}
