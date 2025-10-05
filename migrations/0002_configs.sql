-- Seed initial configurations for traditional and agentic testing

-- Agentic configuration targeting this worker's config page
INSERT INTO system_instructions (url_pattern, name, instructions, test_type, is_active)
VALUES (
  'playwright-mcp-example.hacolby.workers.dev/config',
  'Self-test: Agentic config page',
  json('{"goal":"Open the configuration console and verify schema loads then list configurations","success_criteria":["Schema section rendered","Configurations table visible"],"max_attempts":2,"timeout_ms":90000}'),
  'agentic',
  TRUE
);

-- Traditional test case targeting this worker's config page
INSERT INTO system_instructions (url_pattern, name, instructions, test_type, is_active)
VALUES (
  'playwright-mcp-example.hacolby.workers.dev/config',
  'Self-test: Traditional config page',
  json('{"name":"Config page smoke","steps":[{"action":"navigate","url":"https://playwright-mcp-example.hacolby.workers.dev/config"},{"action":"wait_for","selector":"header h1"},{"action":"click","selector":"#refresh-schema-btn"},{"action":"click","selector":"#refresh-configs-btn"},{"action":"screenshot"}],"assertions":[{"type":"exists","selector":"#config-form"},{"type":"exists","selector":"#config-table-body"}]}'),
  'traditional',
  TRUE
);

