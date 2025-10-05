import { describe, it, beforeAll, expect } from 'vitest'
import worker from '../src/index'

// Minimal Env shim
class InMemoryD1 {
  private data = new Map<string, any[]>()
  async exec(_sql: string) { return { success: true } as any }
  prepare(_sql: string) { return {
    bind: (..._args: any[]) => ({
      all: async () => ({ results: [] }),
      first: async () => ({}),
      run: async () => ({ meta: { last_row_id: 1, changes: 1 } }),
    }),
    all: async () => ({ results: [] }),
  } as any }
}

function makeEnv(): Env {
  return {
    DB: new InMemoryD1() as unknown as D1Database,
    ASSETS: { fetch: (req: Request) => fetch(new URL(req.url).toString()) } as any,
    BROWSER: {} as any,
  } as Env
}

async function call(path: string, init?: RequestInit) {
  const url = 'https://example.com' + path
  const req = new Request(url, init)
  const res = await (worker as any).fetch(req, makeEnv(), {} as any)
  return res
}

describe('API smoke tests', () => {
  it('serves health', async () => {
    const res = await call('/health')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('healthy')
  })

  it('serves not found for unknown', async () => {
    const res = await call('/nope')
    expect(res.status).toBe(404)
  })

  it('serves config page asset', async () => {
    const res = await call('/config', { method: 'GET' })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toMatch(/D1 Configuration Console/)
  })

  it('returns configs list (empty)', async () => {
    const res = await call('/config.json')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.configs).toBeDefined()
  })

  it('rejects bad create payload', async () => {
    const res = await call('/config.json', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })
    expect(res.status).toBe(400)
  })
})

