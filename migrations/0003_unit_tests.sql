-- Migration to create unit_test_runs table for storing unit test executions
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
  finished_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_unit_test_runs_run_id ON unit_test_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_unit_test_runs_status ON unit_test_runs(status);
CREATE INDEX IF NOT EXISTS idx_unit_test_runs_started_at ON unit_test_runs(started_at);
