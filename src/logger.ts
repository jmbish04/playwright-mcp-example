import { DatabaseService } from './database';
import { ActionLog } from './types';

export class Logger {
  private db: DatabaseService;
  private sessionId: string;
  private testConfigId?: number;

  constructor(db: DatabaseService, sessionId: string, testConfigId?: number) {
    this.db = db;
    this.sessionId = sessionId;
    this.testConfigId = testConfigId;
  }

  async logAction(
    actionType: string,
    actionData?: any,
    result?: any,
    error?: Error | string,
    executionTimeMs?: number
  ): Promise<void> {
    const log: Omit<ActionLog, 'id' | 'timestamp'> = {
      session_id: this.sessionId,
      test_config_id: this.testConfigId,
      action_type: actionType,
      action_data: actionData ? JSON.stringify(actionData) : undefined,
      result: result ? JSON.stringify(result) : undefined,
      error: error ? (typeof error === 'string' ? error : error.message) : undefined,
      execution_time_ms: executionTimeMs
    };

    await this.db.logAction(log);

    // Also log to console for immediate visibility
    const logLevel = error ? 'error' : 'info';
    console[logLevel](`[${this.sessionId}] ${actionType}:`, {
      data: actionData,
      result: result,
      error: error,
      executionTime: executionTimeMs
    });
  }

  async logNavigate(url: string, result?: any, error?: Error, executionTimeMs?: number): Promise<void> {
    await this.logAction('navigate', { url }, result, error, executionTimeMs);
  }

  async logClick(selector: string, result?: any, error?: Error, executionTimeMs?: number): Promise<void> {
    await this.logAction('click', { selector }, result, error, executionTimeMs);
  }

  async logType(selector: string, text: string, result?: any, error?: Error, executionTimeMs?: number): Promise<void> {
    await this.logAction('type', { selector, text }, result, error, executionTimeMs);
  }

  async logScreenshot(path: string, result?: any, error?: Error, executionTimeMs?: number): Promise<void> {
    await this.logAction('screenshot', { path }, result, error, executionTimeMs);
  }

  async logAssertion(type: string, details: any, result?: any, error?: Error, executionTimeMs?: number): Promise<void> {
    await this.logAction('assertion', { type, ...details }, result, error, executionTimeMs);
  }

  async logTestStart(testName: string): Promise<void> {
    await this.logAction('test_start', { testName });
  }

  async logTestEnd(testName: string, status: 'passed' | 'failed' | 'skipped', executionTimeMs?: number): Promise<void> {
    await this.logAction('test_end', { testName, status }, undefined, undefined, executionTimeMs);
  }

  async logSessionStart(url: string, testType: string): Promise<void> {
    await this.logAction('session_start', { url, testType });
  }

  async logSessionEnd(status: string, summary?: any): Promise<void> {
    await this.logAction('session_end', { status, summary });
  }

  async logError(error: Error | string, context?: any): Promise<void> {
    await this.logAction('error', context, undefined, error);
  }

  async logInfo(message: string, data?: any): Promise<void> {
    await this.logAction('info', { message, ...data });
  }

  async logWarning(message: string, data?: any): Promise<void> {
    await this.logAction('warning', { message, ...data });
  }

  async logDebug(message: string, data?: any): Promise<void> {
    await this.logAction('debug', { message, ...data });
  }

  // Utility method to create a timed execution wrapper
  async timedExecution<T>(
    actionType: string,
    actionData: any,
    execution: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    try {
      const result = await execution();
      const executionTime = Date.now() - startTime;
      await this.logAction(actionType, actionData, result, undefined, executionTime);
      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      await this.logAction(actionType, actionData, undefined, error as Error, executionTime);
      throw error;
    }
  }
}