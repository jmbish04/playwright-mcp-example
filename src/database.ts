import { SystemInstruction, ActionLog, TestSession, TestResult } from './types';

export class DatabaseService {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  // System Instructions Management
  async createSystemInstruction(instruction: Omit<SystemInstruction, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
    const result = await this.db.prepare(
      `INSERT INTO system_instructions (url_pattern, name, instructions, test_type, is_active)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(
      instruction.url_pattern,
      instruction.name,
      instruction.instructions,
      instruction.test_type,
      instruction.is_active ?? true
    ).run();
    
    return result.meta.last_row_id;
  }

  async getSystemInstructionByUrl(url: string): Promise<SystemInstruction | null> {
    const results = await this.db.prepare(
      `SELECT * FROM system_instructions 
       WHERE is_active = TRUE 
       AND ? LIKE '%' || url_pattern || '%'
       ORDER BY LENGTH(url_pattern) DESC
       LIMIT 1`
    ).bind(url).all();
    
    return (results.results[0] as unknown as SystemInstruction) || null;
  }

  async getAllSystemInstructions(): Promise<SystemInstruction[]> {
    const results = await this.db.prepare(
      'SELECT * FROM system_instructions ORDER BY created_at DESC'
    ).all();
    
    return results.results as unknown as SystemInstruction[];
  }

  async updateSystemInstruction(id: number, updates: Partial<SystemInstruction>): Promise<void> {
    const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    
    await this.db.prepare(
      `UPDATE system_instructions SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(...values, id).run();
  }

  async deleteSystemInstruction(id: number): Promise<void> {
    await this.db.prepare('UPDATE system_instructions SET is_active = FALSE WHERE id = ?')
      .bind(id).run();
  }

  // Action Logging
  async logAction(log: Omit<ActionLog, 'id' | 'timestamp'>): Promise<void> {
    await this.db.prepare(
      `INSERT INTO action_logs (session_id, test_config_id, action_type, action_data, result, error, execution_time_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      log.session_id,
      log.test_config_id || null,
      log.action_type,
      log.action_data || null,
      log.result || null,
      log.error || null,
      log.execution_time_ms || null
    ).run();
  }

  async getActionLogs(sessionId: string): Promise<ActionLog[]> {
    const results = await this.db.prepare(
      'SELECT * FROM action_logs WHERE session_id = ? ORDER BY timestamp ASC'
    ).bind(sessionId).all();
    
    return results.results as unknown as ActionLog[];
  }

  // Test Session Management
  async createTestSession(session: Omit<TestSession, 'start_time'>): Promise<void> {
    await this.db.prepare(
      `INSERT INTO test_sessions (id, url, test_type, status, config_id)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(
      session.id,
      session.url,
      session.test_type,
      session.status,
      session.config_id || null
    ).run();
  }

  async updateTestSession(sessionId: string, updates: Partial<TestSession>): Promise<void> {
    const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    
    await this.db.prepare(
      `UPDATE test_sessions SET ${setClause} WHERE id = ?`
    ).bind(...values, sessionId).run();
  }

  async getTestSession(sessionId: string): Promise<TestSession | null> {
    const results = await this.db.prepare(
      'SELECT * FROM test_sessions WHERE id = ?'
    ).bind(sessionId).all();
    
    return (results.results[0] as unknown as TestSession) || null;
  }

  async getAllTestSessions(limit = 50): Promise<TestSession[]> {
    const results = await this.db.prepare(
      'SELECT * FROM test_sessions ORDER BY start_time DESC LIMIT ?'
    ).bind(limit).all();
    
    return results.results as unknown as TestSession[];
  }

  // Test Results
  async saveTestResult(result: Omit<TestResult, 'id' | 'timestamp'>): Promise<void> {
    await this.db.prepare(
      `INSERT INTO test_results (session_id, test_name, status, error_message, screenshot_path, execution_time_ms)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      result.session_id,
      result.test_name,
      result.status,
      result.error_message || null,
      result.screenshot_path || null,
      result.execution_time_ms || null
    ).run();
  }

  async getTestResults(sessionId: string): Promise<TestResult[]> {
    const results = await this.db.prepare(
      'SELECT * FROM test_results WHERE session_id = ? ORDER BY timestamp ASC'
    ).bind(sessionId).all();
    
    return results.results as unknown as TestResult[];
  }

  // Analytics and Cleanup
  async getSessionStats(sessionId: string): Promise<{
    total_actions: number;
    total_errors: number;
    avg_execution_time: number;
    test_results_summary: { passed: number; failed: number; skipped: number };
  }> {
    const [actionStats, testStats] = await Promise.all([
      this.db.prepare(
        `SELECT COUNT(*) as total_actions,
                SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as total_errors,
                AVG(execution_time_ms) as avg_execution_time
         FROM action_logs WHERE session_id = ?`
      ).bind(sessionId).first(),
      
      this.db.prepare(
        `SELECT status, COUNT(*) as count
         FROM test_results WHERE session_id = ?
         GROUP BY status`
      ).bind(sessionId).all()
    ]);

    const testSummary = { passed: 0, failed: 0, skipped: 0 };
    (testStats.results as any[]).forEach(row => {
      testSummary[row.status as keyof typeof testSummary] = row.count;
    });

    return {
      total_actions: (actionStats as any)?.total_actions || 0,
      total_errors: (actionStats as any)?.total_errors || 0,
      avg_execution_time: (actionStats as any)?.avg_execution_time || 0,
      test_results_summary: testSummary
    };
  }

  async cleanupOldSessions(daysOld = 30): Promise<number> {
    const result = await this.db.prepare(
      `DELETE FROM test_sessions 
       WHERE start_time < datetime('now', '-' || ? || ' days')`
    ).bind(daysOld).run();
    
    return result.meta.changes || 0;
  }
}