import { SystemInstruction, ActionLog, TestSession, TestResult, UnitTestRunRecord } from './types';

export class DatabaseService {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  // Database setup & schema introspection
  async ensureSchema(): Promise<{
    createdTables: string[];
    existingTables: string[];
  }> {
    const beforeSetup = await this.listUserTables();

    const schemaSql = `
      CREATE TABLE IF NOT EXISTS system_instructions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url_pattern TEXT NOT NULL,
        name TEXT NOT NULL,
        instructions TEXT NOT NULL,
        test_type TEXT NOT NULL CHECK (test_type IN ('traditional', 'agentic')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE
      );

      CREATE TABLE IF NOT EXISTS action_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        test_config_id INTEGER,
        action_type TEXT NOT NULL,
        action_data TEXT,
        result TEXT,
        error TEXT,
        execution_time_ms INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (test_config_id) REFERENCES system_instructions(id),
        FOREIGN KEY (session_id) REFERENCES test_sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS test_sessions (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        test_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
        config_id INTEGER,
        start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        end_time DATETIME,
        results TEXT,
        error_summary TEXT,
        FOREIGN KEY (config_id) REFERENCES system_instructions(id)
      );

      CREATE TABLE IF NOT EXISTS test_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        test_name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'skipped')),
        error_message TEXT,
        screenshot_path TEXT,
        execution_time_ms INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES test_sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_system_instructions_url_pattern ON system_instructions(url_pattern);
      CREATE INDEX IF NOT EXISTS idx_action_logs_session_id ON action_logs(session_id);
      CREATE INDEX IF NOT EXISTS idx_action_logs_timestamp ON action_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_test_sessions_status ON test_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_test_results_session_id ON test_results(session_id);

      CREATE TABLE IF NOT EXISTS unit_test_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        test_session_id TEXT,
        test_result_id INTEGER,
        test_id TEXT NOT NULL,
        test_name TEXT NOT NULL,
        test_code TEXT,
        test_logs TEXT,
        ai_response TEXT,
        status TEXT NOT NULL CHECK (status IN ('PASS', 'FAIL')),
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        finished_at DATETIME,
        FOREIGN KEY (test_session_id) REFERENCES test_sessions(id),
        FOREIGN KEY (test_result_id) REFERENCES test_results(id)
      );

      CREATE INDEX IF NOT EXISTS idx_unit_test_runs_run_id ON unit_test_runs(run_id);
      CREATE INDEX IF NOT EXISTS idx_unit_test_runs_status ON unit_test_runs(status);
      CREATE INDEX IF NOT EXISTS idx_unit_test_runs_started_at ON unit_test_runs(started_at);
    `;

    const statements = schemaSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const stmt of statements) {
      await this.db.prepare(stmt).run();
    }

    const afterSetup = await this.listUserTables();
    const createdTables = afterSetup.filter(table => !beforeSetup.includes(table));

    return {
      createdTables,
      existingTables: afterSetup
    };
  }

  async getSchemaOverview(): Promise<{
    tables: Array<{
      name: string;
      rowCount: number;
      columns: Array<{
        name: string;
        type: string;
        notNull: boolean;
        defaultValue: string | null;
        primaryKey: boolean;
      }>;
      indexes: Array<{
        name: string;
        unique: boolean;
      }>;
    }>;
  }> {
    const tables = await this.listUserTables();

    const tablesWithSchema = await Promise.all(tables.map(async (table) => {
      const safeName = this.validateIdentifier(table);

      const columnsResult = await this.db.prepare(`PRAGMA table_info(${safeName})`).all();
      const indexesResult = await this.db.prepare(`PRAGMA index_list(${safeName})`).all();
      const rowCountResult = await this.db.prepare(`SELECT COUNT(*) as count FROM ${safeName}`).first();

      const columns = (columnsResult.results as any[]).map(column => ({
        name: column.name,
        type: column.type,
        notNull: column.notnull === 1,
        defaultValue: column.dflt_value ?? null,
        primaryKey: column.pk === 1
      }));

      const indexes = (indexesResult.results as any[]).map(index => ({
        name: index.name,
        unique: index.unique === 1
      }));

      const rowCount = (rowCountResult as any)?.count ?? 0;

      return {
        name: table,
        rowCount,
        columns,
        indexes
      };
    }));

    return {
      tables: tablesWithSchema
    };
  }

  private async listUserTables(): Promise<string[]> {
    const results = await this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all();

    return (results.results as Array<{ name: string }>).map(row => row.name);
  }

  private validateIdentifier(name: string): string {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`Invalid identifier: ${name}`);
    }
    return name;
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

  async getSystemInstructionByUrl(url: string, testType?: 'traditional' | 'agentic'): Promise<SystemInstruction | null> {
    const hasType = typeof testType === 'string' && (testType === 'traditional' || testType === 'agentic');
    const sql = `SELECT *
                 FROM system_instructions
                 WHERE is_active = TRUE
                 ${hasType ? 'AND test_type = ?' : ''}
                 AND instr(?, url_pattern) > 0
                 ORDER BY LENGTH(url_pattern) DESC
                 LIMIT 1`;

    const stmt = this.db.prepare(sql);
    const bindArgs = hasType ? [testType, url] : [url];
    const results = await stmt.bind(...bindArgs).all();

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

  // Unit test run management
  async createUnitTestRow(row: Omit<UnitTestRunRecord, 'id'>): Promise<number> {
    const result = await this.db.prepare(
      `INSERT INTO unit_test_runs (
        run_id, test_session_id, test_result_id, test_id, test_name,
        test_code, test_logs, ai_response, status, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)`
    ).bind(
      row.run_id,
      row.test_session_id ?? null,
      row.test_result_id ?? null,
      row.test_id,
      row.test_name,
      row.test_code ?? null,
      row.test_logs ?? null,
      row.ai_response ?? null,
      row.status,
      row.started_at ?? null,
      row.finished_at ?? null
    ).run();

    return result.meta.last_row_id;
  }

  async completeUnitTestRow(id: number, updates: Partial<UnitTestRunRecord>): Promise<void> {
    const fields = Object.keys(updates);
    if (fields.length === 0) {
      return;
    }

    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const values = fields.map(field => (updates as any)[field]);

    await this.db.prepare(
      `UPDATE unit_test_runs SET ${setClause} WHERE id = ?`
    ).bind(...values, id).run();
  }

  async listUnitTestRuns(runId: string): Promise<UnitTestRunRecord[]> {
    const results = await this.db.prepare(
      `SELECT * FROM unit_test_runs WHERE run_id = ? ORDER BY started_at ASC, id ASC`
    ).bind(runId).all();

    return results.results as unknown as UnitTestRunRecord[];
  }

  async listRecentUnitRuns(limit = 10): Promise<Array<{
    run_id: string;
    started_at: string | null;
    finished_at: string | null;
    total: number;
    passed: number;
    failed: number;
  }>> {
    const results = await this.db.prepare(
      `SELECT run_id,
              MIN(started_at) AS started_at,
              MAX(finished_at) AS finished_at,
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'PASS' THEN 1 ELSE 0 END) AS passed,
              SUM(CASE WHEN status = 'FAIL' THEN 1 ELSE 0 END) AS failed
       FROM unit_test_runs
       GROUP BY run_id
       ORDER BY MAX(started_at) DESC
       LIMIT ?`
    ).bind(limit).all();

    return results.results as unknown as Array<{
      run_id: string;
      started_at: string | null;
      finished_at: string | null;
      total: number;
      passed: number;
      failed: number;
    }>;
  }

  async getLatestUnitRun(): Promise<{ run: { run_id: string; started_at: string | null; finished_at: string | null; stats: { total: number; passed: number; failed: number; }; }; rows: UnitTestRunRecord[] } | null> {
    const recent = await this.listRecentUnitRuns(1);
    if (recent.length === 0) {
      return null;
    }

    const run = recent[0];
    const rows = await this.listUnitTestRuns(run.run_id);

    return {
      run: {
        run_id: run.run_id,
        started_at: run.started_at,
        finished_at: run.finished_at,
        stats: {
          total: run.total,
          passed: run.passed,
          failed: run.failed,
        },
      },
      rows,
    };
  }
}
