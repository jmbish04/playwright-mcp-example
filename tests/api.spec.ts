import { describe, it, beforeAll, beforeEach, expect, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

type SystemInstruction = {
  id: number
  url_pattern: string
  name: string
  instructions: string
  test_type: 'traditional' | 'agentic'
  is_active?: boolean
}

type TestSession = {
  id: string
  url: string
  test_type: 'traditional' | 'agentic'
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  config_id?: number
  start_time?: string
  end_time?: string | null
  results?: string | null
  error_summary?: string | null
}

type UnitRunRow = {
  id: number
  run_id: string
  test_id: string
  test_name: string
  status: 'PASS' | 'FAIL'
  test_logs?: string | null
  test_code?: string | null
  ai_response?: string | null
  started_at?: string | null
  finished_at?: string | null
}

const dbState = vi.hoisted(() => {
  const state = {
    instructionSeq: 0,
    unitRunSeq: 0,
    instructions: [] as SystemInstruction[],
    sessions: new Map<string, TestSession>(),
    actionLogs: [] as Array<{ session_id: string; action_type: string; timestamp: string }>,
    testResults: [] as Array<{ session_id: string; test_name: string; status: string }>,
    unitRuns: [] as UnitRunRow[],
    failEnsureSchema: false,
    failGetSchema: false,
    reset() {
      this.instructionSeq = 0
      this.unitRunSeq = 0
      this.instructions = []
      this.sessions = new Map()
      this.actionLogs = []
      this.testResults = []
      this.unitRuns = []
      this.failEnsureSchema = false
      this.failGetSchema = false
    },
  }
  state.reset()
  return state
})

vi.mock('../src/database', () => {
  const state = dbState

  class FakeDatabaseService {
    constructor(_db: unknown) {}

    async ensureSchema() {
      if (state.failEnsureSchema) {
        throw new Error('failed to ensure schema')
      }
      return { createdTables: [], existingTables: ['system_instructions', 'unit_test_runs'] }
    }

    async getSchemaOverview() {
      if (state.failGetSchema) {
        throw new Error('schema introspection failed')
      }

      return {
        tables: [
          {
            name: 'system_instructions',
            rowCount: state.instructions.length,
            columns: [],
            indexes: [],
          },
          {
            name: 'unit_test_runs',
            rowCount: state.unitRuns.length,
            columns: [],
            indexes: [],
          },
        ],
      }
    }

    async createSystemInstruction(instruction: Omit<SystemInstruction, 'id'>) {
      const id = ++state.instructionSeq
      state.instructions.push({ id, ...instruction, is_active: instruction.is_active ?? true })
      return id
    }

    async getSystemInstructionByUrl(url: string, testType?: 'traditional' | 'agentic') {
      const found = state.instructions
        .filter(config => config.is_active !== false)
        .filter(config => (testType ? config.test_type === testType : true))
        .filter(config => url.includes(config.url_pattern))
        .sort((a, b) => b.url_pattern.length - a.url_pattern.length)
      return found[0] ?? null
    }

    async getAllSystemInstructions() {
      return [...state.instructions]
    }

    async updateSystemInstruction(id: number, updates: Partial<SystemInstruction>) {
      const config = state.instructions.find(item => item.id === id)
      if (config) {
        Object.assign(config, updates)
      }
    }

    async deleteSystemInstruction(id: number) {
      const config = state.instructions.find(item => item.id === id)
      if (config) {
        config.is_active = false
      }
    }

    async logAction(log: any) {
      state.actionLogs.push({ session_id: log.session_id, action_type: log.action_type, timestamp: new Date().toISOString() })
    }

    async getActionLogs(sessionId: string) {
      return state.actionLogs.filter(log => log.session_id === sessionId)
    }

    async createTestSession(session: TestSession) {
      state.sessions.set(session.id, { ...session, start_time: new Date().toISOString() })
    }

    async updateTestSession(sessionId: string, updates: Partial<TestSession>) {
      const session = state.sessions.get(sessionId)
      if (session) {
        Object.assign(session, updates)
      }
    }

    async getTestSession(sessionId: string) {
      return state.sessions.get(sessionId) ?? null
    }

    async getAllTestSessions(limit = 50) {
      return Array.from(state.sessions.values())
        .sort((a, b) => (b.start_time ?? '').localeCompare(a.start_time ?? ''))
        .slice(0, limit)
    }

    async saveTestResult(result: any) {
      state.testResults.push(result)
    }

    async getTestResults(sessionId: string) {
      return state.testResults.filter(result => result.session_id === sessionId)
    }

    async getSessionStats(sessionId: string) {
      const results = state.testResults.filter(result => result.session_id === sessionId)
      const total = results.length
      const passed = results.filter(result => result.status === 'passed').length
      const failed = results.filter(result => result.status === 'failed').length
      return {
        total_actions: state.actionLogs.filter(log => log.session_id === sessionId).length,
        total_errors: failed,
        avg_execution_time: 0,
        test_results_summary: { passed, failed, skipped: total - passed - failed },
      }
    }

    async cleanupOldSessions() {
      return 0
    }

    async createUnitTestRow(row: any) {
      const id = ++state.unitRunSeq
      state.unitRuns.push({ id, ...row })
      return id
    }

    async completeUnitTestRow(id: number, updates: Partial<UnitRunRow>) {
      const row = state.unitRuns.find(item => item.id === id)
      if (row) {
        Object.assign(row, updates)
      }
    }

    async listUnitTestRuns(runId: string) {
      return state.unitRuns.filter(row => row.run_id === runId)
    }

    async listRecentUnitRuns(limit = 10) {
      const grouped = new Map<string, { run_id: string; started_at: string | null; finished_at: string | null; total: number; passed: number; failed: number }>()
      for (const row of state.unitRuns) {
        if (!grouped.has(row.run_id)) {
          grouped.set(row.run_id, {
            run_id: row.run_id,
            started_at: row.started_at ?? null,
            finished_at: row.finished_at ?? null,
            total: 0,
            passed: 0,
            failed: 0,
          })
        }
        const bucket = grouped.get(row.run_id)!
        bucket.total += 1
        if (row.status === 'PASS') bucket.passed += 1
        else bucket.failed += 1
        bucket.started_at = bucket.started_at ?? row.started_at ?? null
        bucket.finished_at = row.finished_at ?? bucket.finished_at ?? null
      }
      return Array.from(grouped.values()).sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? '')).slice(0, limit)
    }

    async getLatestUnitRun() {
      const recent = await this.listRecentUnitRuns(1)
      if (!recent.length) return null
      const run = recent[0]
      const rows = await this.listUnitTestRuns(run.run_id)
      return {
        run: {
          run_id: run.run_id,
          started_at: run.started_at,
          finished_at: run.finished_at,
          stats: { total: run.total, passed: run.passed, failed: run.failed },
        },
        rows,
      }
    }
  }

  return { DatabaseService: FakeDatabaseService, __dbState: state }
})

vi.mock('../src/logger', () => {
  class FakeLogger {
    async logInfo() {}
    async logWarning() {}
    async logError() {}
    async logSessionStart() {}
    async logSessionEnd() {}
    async logTestStart() {}
    async logTestEnd() {}
    async timedExecution(_name: string, _meta: unknown, fn: () => Promise<unknown>) {
      return fn()
    }
  }
  return { Logger: FakeLogger }
})

vi.mock('../src/traditional-test-executor', () => {
  class FakeTraditionalTestExecutor {
    constructor() {}
    async executeTest(sessionId: string) {
      const success = !sessionId.includes('fail')
      return {
        session_id: sessionId,
        success,
        results: [],
        logs: [],
        screenshots: [],
        execution_time_ms: 25,
        error_summary: success ? undefined : 'failure detected',
      }
    }
  }
  return { TraditionalTestExecutor: FakeTraditionalTestExecutor }
})

vi.mock('../src/agentic-test-executor', () => {
  class FakeAgenticTestExecutor {
    constructor() {}
    async executeTest(sessionId: string) {
      return {
        session_id: sessionId,
        success: true,
        results: [],
        logs: [],
        screenshots: [],
        execution_time_ms: 30,
      }
    }
  }
  return { AgenticTestExecutor: FakeAgenticTestExecutor }
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let workerInstance: any | null = null

async function getWorker() {
  if (!workerInstance) {
    workerInstance = (await import('../src/index')).default
  }
  return workerInstance
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  const assetsRoot = path.resolve(__dirname, '../public')
  const assetFetcher = {
    async fetch(request: Request) {
      const url = new URL(request.url)
      let pathname = url.pathname
      if (pathname === '/') pathname = '/index.html'
      const filePath = path.join(assetsRoot, pathname.replace(/^\//, ''))
      try {
        const data = await fs.readFile(filePath)
        return new Response(data, { status: 200 })
      } catch {
        return new Response('Not Found', { status: 404 })
      }
    },
  }

  return {
    DB: {} as unknown as D1Database,
    ASSETS: assetFetcher as any,
    BROWSER: {} as any,
    ...overrides,
  } as Env
}

async function call(pathname: string, init?: RequestInit) {
  const url = `https://example.com${pathname}`
  const request = new Request(url, init)
  const worker = await getWorker()
  const response = await worker.fetch(request, makeEnv(), {} as any)
  return response
}
const resetState = () => {
  dbState.reset()
}

describe('admin endpoints', () => {
  beforeEach(resetState)
  it('ensures schema successfully', async () => {
    const response = await call('/admin/setup', { method: 'POST' })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.message).toContain('Database schema ensured')
  })

  it('returns error when schema setup fails', async () => {
    dbState.failEnsureSchema = true
    const response = await call('/admin/setup', { method: 'POST' })
    expect(response.status).toBe(500)
  })

  it('returns schema overview', async () => {
    await call('/config.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url_pattern: 'https://example.com', name: 'Example', instructions: '{}', test_type: 'traditional' }),
    })

    const response = await call('/admin/schema')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Array.isArray(body.tables)).toBe(true)
    expect(body.tables.length).toBeGreaterThan(0)
  })

  it('fails schema overview when database throws', async () => {
    dbState.failGetSchema = true
    const response = await call('/admin/schema')
    expect(response.status).toBe(500)
  })

  it('provides diagnostics information', async () => {
    const response = await call('/admin/diag')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('ok')
    expect(body.tables).toBeGreaterThanOrEqual(0)
  })
})

describe('config endpoints', () => {
  beforeEach(resetState)
  it('lists configurations', async () => {
    const response = await call('/config.json')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Array.isArray(body.configs)).toBe(true)
  })

  it('rejects invalid creation payload', async () => {
    const response = await call('/config.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(400)
  })

  it('creates and updates configuration', async () => {
    const create = await call('/config.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url_pattern: 'https://foo.dev', name: 'Foo', instructions: '{}', test_type: 'traditional' }),
    })
    const createBody = await create.json()
    const update = await call('/config.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: createBody.id, name: 'Updated Foo' }),
    })
    expect(update.status).toBe(200)
  })

  it('rejects update without id', async () => {
    const response = await call('/config.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Missing id' }),
    })
    expect(response.status).toBe(400)
  })

  it('deletes configuration', async () => {
    const create = await call('/config.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url_pattern: 'https://bar.dev', name: 'Bar', instructions: '{}', test_type: 'agentic' }),
    })
    const { id } = await create.json()
    const response = await call(`/config.json?id=${id}`, { method: 'DELETE' })
    expect(response.status).toBe(200)
  })

  it('finds configuration by url and type', async () => {
    await call('/config.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url_pattern: 'example.com', name: 'Stored', instructions: '{}', test_type: 'traditional' }),
    })

    const response = await call('/config/find?url=https://example.com/page')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.config).toBeTruthy()
  })

  it('returns error when url is missing in find', async () => {
    const response = await call('/config/find')
    expect(response.status).toBe(400)
  })
})

describe('test execution endpoints', () => {
  beforeEach(resetState)
  it('runs traditional test with stored config', async () => {
    await call('/config.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url_pattern: 'https://site.test',
        name: 'Stored Traditional',
        instructions: JSON.stringify({ name: 'Stored Test', steps: [], assertions: [] }),
        test_type: 'traditional',
      }),
    })

    const response = await call('/test/traditional', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://site.test/home' }),
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
  })

  it('rejects traditional test without config or payload', async () => {
    const response = await call('/test/traditional', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://missing.test', useStoredConfig: true }),
    })
    expect(response.status).toBe(400)
  })

  it('runs agentic test with stored config', async () => {
    await call('/config.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url_pattern: 'agentic.test',
        name: 'Agentic Config',
        instructions: JSON.stringify({ goal: 'Check', context: '', success_criteria: [] }),
        test_type: 'agentic',
      }),
    })

    const response = await call('/test/agentic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://agentic.test/run' }),
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
  })

  it('rejects agentic test without configuration', async () => {
    const response = await call('/test/agentic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://unknown.test' }),
    })
    expect(response.status).toBe(400)
  })
})

describe('session endpoints', () => {
  beforeEach(resetState)
  beforeEach(() => {
    const session: TestSession = {
      id: 'session-1',
      url: 'https://example.com',
      test_type: 'traditional',
      status: 'completed',
      start_time: new Date().toISOString(),
    }
    dbState.sessions.set(session.id, { ...session })
    dbState.testResults.push({ session_id: session.id, test_name: 'Example', status: 'passed' })
    dbState.actionLogs.push({ session_id: session.id, action_type: 'info', timestamp: new Date().toISOString() })
  })

  it('lists sessions when no id provided', async () => {
    const response = await call('/session')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Array.isArray(body.sessions)).toBe(true)
    expect(body.sessions.length).toBeGreaterThan(0)
  })

  it('returns specific session information', async () => {
    const response = await call('/session?sessionId=session-1')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.session.id).toBe('session-1')
    expect(Array.isArray(body.logs)).toBe(true)
  })

  it('returns 404 for unknown session', async () => {
    const response = await call('/session?sessionId=unknown')
    expect(response.status).toBe(404)
  })

  it('cancels a session', async () => {
    const response = await call('/session?sessionId=session-1', { method: 'DELETE' })
    expect(response.status).toBe(200)
    expect(dbState.sessions.get('session-1')?.status).toBe('cancelled')
  })

  it('rejects cancel without session id', async () => {
    const response = await call('/session', { method: 'DELETE' })
    expect(response.status).toBe(400)
  })
})

describe('asset endpoints', () => {
  beforeEach(resetState)
  it('serves home page', async () => {
    const response = await call('/')
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('<!DOCTYPE html>')
  })

  it('serves config and tests dashboards', async () => {
    const configRes = await call('/config')
    const testsRes = await call('/tests.html')
    const sessionsRes = await call('/sessions.html')
    expect(configRes.status).toBe(200)
    expect(testsRes.status).toBe(200)
    expect(sessionsRes.status).toBe(200)
  })

  it('returns 404 for missing asset', async () => {
    const response = await call('/no-such-asset.html')
    expect(response.status).toBe(404)
  })
})

describe('health endpoint', () => {
  beforeEach(resetState)
  it('returns healthy status', async () => {
    const response = await call('/health')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('healthy')
  })

  it('returns error when database check fails', async () => {
    dbState.failGetSchema = true
    const response = await call('/health')
    expect(response.status).toBe(503)
  })
})

describe('unit test result workflow', () => {
  beforeEach(resetState)
  it('initializes a run and records placeholder', async () => {
    const response = await call('/tests/run-unit', { method: 'POST' })
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.run_id).toMatch(/^unit_/)
    expect(dbState.unitRuns.some(row => row.run_id === body.run_id)).toBe(true)
  })

  it('imports unit test results and stores AI analysis placeholder', async () => {
    const response = await call('/tests/unit-results/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        run_id: 'run-123',
        results: [
          { test_id: 't1', test_name: 'passes', test_logs: 'ok', test_code: 'expect(true)', status: 'PASS' },
          { test_id: 't2', test_name: 'fails', test_logs: 'boom', test_code: 'throw', status: 'FAIL' },
        ],
      }),
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.stats.total).toBe(2)
    expect(body.stats.failed).toBe(1)
    const stored = dbState.unitRuns.filter(row => row.run_id === 'run-123')
    expect(stored.length).toBe(2)
    expect(stored[0].ai_response).toBeTruthy()
  })

  it('rejects invalid import payload', async () => {
    const response = await call('/tests/unit-results/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(400)
  })

  it('lists run results and summaries', async () => {
    await call('/tests/unit-results/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        run_id: 'run-abc',
        results: [
          { test_id: 'x', test_name: 'one', status: 'PASS' },
        ],
      }),
    })

    const listRes = await call('/tests/unit-results?run_id=run-abc')
    expect(listRes.status).toBe(200)
    const listBody = await listRes.json()
    expect(listBody.stats.total).toBe(1)

    const latestRes = await call('/tests/unit-latest')
    expect(latestRes.status).toBe(200)
    const latestBody = await latestRes.json()
    expect(latestBody.run.run_id).toBe('run-abc')

    const runsRes = await call('/tests/unit-runs')
    expect(runsRes.status).toBe(200)
    const runsBody = await runsRes.json()
    expect(Array.isArray(runsBody.runs)).toBe(true)
  })
})
