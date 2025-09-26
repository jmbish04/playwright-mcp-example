-- System instructions table for storing testing configurations
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

-- Actions log table for comprehensive logging
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

-- Test sessions table for managing test runs
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

-- Test results table for storing detailed test outcomes
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

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_system_instructions_url_pattern ON system_instructions(url_pattern);
CREATE INDEX IF NOT EXISTS idx_action_logs_session_id ON action_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_action_logs_timestamp ON action_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_test_sessions_status ON test_sessions(status);
CREATE INDEX IF NOT EXISTS idx_test_results_session_id ON test_results(session_id);
