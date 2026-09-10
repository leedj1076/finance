import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runCodexBudgetRecommendation } from '@/features/budget-recommendations/codex-runner'
import { buildBudgetPromptInput } from '@/features/budget-recommendations/prompt'
import { makeBudgetReport, makeBudgetSnapshot } from '../fixtures/budget-recommendation'

const dirs: string[] = []

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'budget-runner-test-'))
  dirs.push(dir)
  return dir
}

async function fakeCodex(body: string) {
  const dir = await tempDir()
  const path = join(dir, 'fake-codex')
  await writeFile(path, `#!${process.execPath}\n${body}`, { mode: 0o700 })
  return path
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('isolated Codex budget recommendation runner', () => {
  it('executes the frozen prompt with the same hardened controls and isolated environment', async () => {
    vi.stubEnv('BUDGET_TEST_SECRET', 'must-never-reach-codex')
    vi.stubEnv('NODE_OPTIONS', '')
    const snapshot = makeBudgetSnapshot()
    const promptInput = buildBudgetPromptInput(snapshot, {
      revision: 7,
      updatedAt: '2026-09-10T00:00:00.000Z',
      commonInstructions: '설정 A를 그대로 사용하세요.',
      ledgerInstructions: null,
      budgetInstructions: '예산 설정 A',
    })
    const report = makeBudgetReport()
    const capturedPath = join(await tempDir(), 'captured.json')
    const codexPath = await fakeCodex(`
      const fs = require('node:fs');
      const args = process.argv.slice(2);
      let input = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => input += chunk);
      process.stdin.on('end', () => {
        const output = args[args.indexOf('--output-last-message') + 1];
        fs.writeFileSync(output, ${JSON.stringify(JSON.stringify(report))});
        fs.writeFileSync(${JSON.stringify(capturedPath)}, JSON.stringify({ input, args,
          cwd: process.cwd(), files: fs.readdirSync(process.cwd()), envKeys: Object.keys(process.env),
          canary: process.env.BUDGET_TEST_SECRET,
          mode: fs.statSync(process.cwd()).mode & 0o777,
          schema: JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8'))
        }));
        process.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\\n');
      });
    `)

    expect(await runCodexBudgetRecommendation(snapshot, { codexPath, model: 'trusted-model', promptInput })).toEqual(report)
    const captured = JSON.parse(await readFile(capturedPath, 'utf8'))
    expect(captured.input).toContain('설정 A를 그대로 사용하세요.')
    expect(captured.input).toContain(snapshot.sourceHash)
    expect(captured.args).toEqual(expect.arrayContaining([
      '--ignore-user-config', '--ignore-rules', '--ephemeral', '--strict-config',
      '--sandbox', 'read-only', '--output-schema', '--json', '--model', 'trusted-model',
    ]))
    expect(captured.args).toContain('web_search="disabled"')
    expect(captured.args).toContain('orchestrator.mcp.enabled=false')
    expect(captured.args).toContain('orchestrator.skills.enabled=false')
    expect(captured.args).toContain('shell_tool')
    expect(captured.args).toContain('plugins')
    expect(captured.args).toContain('memories')
    expect(captured.args.at(-1)).toBe('-')
    expect(captured.envKeys).not.toContain('NODE_OPTIONS')
    expect(captured.canary).toBeUndefined()
    expect(captured.mode).toBe(0o700)
    expect(captured.schema.additionalProperties).toBe(false)
    await expect(readFile(join(captured.cwd, 'schema.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects forged frozen input before invoking Codex', async () => {
    const snapshot = makeBudgetSnapshot()
    const promptInput = buildBudgetPromptInput(snapshot, {
      revision: 0, updatedAt: null, commonInstructions: null,
      ledgerInstructions: null, budgetInstructions: null,
    })
    await expect(runCodexBudgetRecommendation(snapshot, {
      codexPath: '/must-not-run',
      promptInput: { ...promptInput, promptHash: '0'.repeat(64) },
    })).rejects.toMatchObject({ code: 'invalid_output', message: 'invalid_output' })
  })

  it('rejects tool events and keeps private CLI diagnostics out of the error', async () => {
    const snapshot = makeBudgetSnapshot()
    const promptInput = buildBudgetPromptInput(snapshot, {
      revision: 0, updatedAt: null, commonInstructions: null,
      ledgerInstructions: null, budgetInstructions: null,
    })
    const codexPath = await fakeCodex(`
      process.stderr.write('private budget diagnostic');
      process.stdout.write(JSON.stringify({ type: 'item.started', item: { type: 'web_search' } }) + '\\n');
      setInterval(() => {}, 100);
    `)
    await expect(runCodexBudgetRecommendation(snapshot, { codexPath, promptInput, timeoutMs: 2_000 }))
      .rejects.toMatchObject({ code: 'invalid_output', message: 'invalid_output' })
  }, 5_000)
})
