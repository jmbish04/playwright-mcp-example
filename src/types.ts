export interface SystemInstruction {
  id?: number;
  url_pattern: string;
  name: string;
  instructions: string;
  test_type: 'traditional' | 'agentic';
  created_at?: string;
  updated_at?: string;
  is_active?: boolean;
}

export interface ActionLog {
  id?: number;
  session_id: string;
  test_config_id?: number;
  action_type: string;
  action_data?: string;
  result?: string;
  error?: string;
  execution_time_ms?: number;
  timestamp?: string;
}

export interface TestSession {
  id: string;
  url: string;
  test_type: 'traditional' | 'agentic';
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  config_id?: number;
  start_time?: string;
  end_time?: string;
  results?: string;
  error_summary?: string;
}

export interface TestResult {
  id?: number;
  session_id: string;
  test_name: string;
  status: 'passed' | 'failed' | 'skipped';
  error_message?: string;
  screenshot_path?: string;
  execution_time_ms?: number;
  timestamp?: string;
}

export interface TraditionalTestCase {
  name: string;
  steps: TestStep[];
  assertions: TestAssertion[];
}

export interface TestStep {
  action: 'navigate' | 'click' | 'type' | 'select' | 'wait' | 'screenshot' | 'custom';
  selector?: string;
  value?: string;
  url?: string;
  timeout?: number;
  description: string;
}

export interface TestAssertion {
  type: 'exists' | 'visible' | 'text' | 'value' | 'count' | 'custom';
  selector?: string;
  expected?: string | number | boolean;
  description: string;
}

export interface AgenticTestConfig {
  goal: string;
  context: string;
  success_criteria: string[];
  max_attempts?: number;
  timeout_ms?: number;
}

export interface TestExecutionResult {
  session_id: string;
  success: boolean;
  results: TestResult[];
  logs: ActionLog[];
  screenshots: string[];
  error_summary?: string;
  execution_time_ms: number;
}