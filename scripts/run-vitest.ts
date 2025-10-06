#!/usr/bin/env ts-node
import { spawn } from 'node:child_process'
import path from 'node:path'

function parseRunId(): string | undefined {
  const flagIndex = process.argv.indexOf('--run-id')
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) {
    return process.argv[flagIndex + 1]
  }
  return process.env.VITEST_RUN_ID
}

async function main() {
  const runId = parseRunId() || `unit_${Date.now()}`
  process.env.VITEST_RUN_ID = runId

  const reporterPath = path.resolve(__dirname, '../tests/reporters/unit-d1-reporter.ts')
  const args = ['vitest', 'run', '--reporter', 'default', '--reporter', reporterPath]

  const child = spawn('pnpm', args, {
    stdio: 'inherit',
    env: process.env,
    shell: false,
  })

  child.on('exit', (code) => {
    if (code !== 0) {
      process.stderr.write(`Vitest exited with status ${code}\n`)
      process.exit(code ?? 1)
    }

    const outputPath = path.resolve(process.cwd(), '.vitest-runs', `${runId}.json`)
    process.stdout.write(`Results saved to ${outputPath}\n`)
    process.exit(0)
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
