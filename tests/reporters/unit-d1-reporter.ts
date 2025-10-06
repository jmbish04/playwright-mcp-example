import fs from 'node:fs'
import path from 'node:path'
import type { Reporter, File, Task } from 'vitest'

type SerializedTest = {
  id: string
  name: string
  status: 'PASS' | 'FAIL'
  duration: number
  error?: string
  logs: string[]
}

type ReporterOptions = {
  runId?: string
  outputDir?: string
}

function flattenTask(task: Task, tests: SerializedTest[]) {
  if ((task as any).type === 'test') {
    const state = task.result?.state === 'pass' ? 'PASS' : 'FAIL'
    const logs = (task.logs || []).flatMap(entry => Array.isArray(entry?.content) ? entry.content.map(String) : [String(entry?.content ?? '')])
    tests.push({
      id: task.id,
      name: task.name,
      status: state,
      duration: task.result?.duration ?? 0,
      error: task.result?.error ? serializeError(task.result.error) : undefined,
      logs: logs.filter(Boolean),
    })
  }

  if ('tasks' in task && Array.isArray(task.tasks)) {
    task.tasks.forEach(child => flattenTask(child, tests))
  }
}

function serializeError(error: unknown): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? ''}`.trim()
  }
  return JSON.stringify(error)
}

export default class UnitD1Reporter implements Reporter {
  private readonly runId: string
  private readonly outputFile: string

  constructor(options: ReporterOptions = {}) {
    this.runId = options.runId || process.env.VITEST_RUN_ID || `unit_${Date.now()}`
    const outputDir = options.outputDir || path.resolve(process.cwd(), '.vitest-runs')
    fs.mkdirSync(outputDir, { recursive: true })
    this.outputFile = path.join(outputDir, `${this.runId}.json`)
  }

  async onFinished(files: File[]): Promise<void> {
    const tests: SerializedTest[] = []
    files.forEach(file => flattenTask(file as unknown as Task, tests))

    const payload = {
      run_id: this.runId,
      generated_at: new Date().toISOString(),
      tests,
    }

    fs.writeFileSync(this.outputFile, JSON.stringify(payload, null, 2))
    process.stdout.write(`Vitest unit results saved to ${this.outputFile}\n`)
  }
}
