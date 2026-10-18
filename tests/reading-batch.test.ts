/** P0-7 批量精读续跑：① 部分失败先落成功缓存再抛；② finish.reason='length'
 * 视为失败且不写缓存（TRUNCATED）；③ 服务端 clamp ≤40；④ 缓存命中零 LLM 调用。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile, mkdir as _mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as pathResolve } from 'node:path'
import { buildFixturePdf } from './fixture-pdf.ts'
import { ReadingService, MAX_TRANSLATE_BLOCKS } from '../src/reading/service.ts'
import { translateBlocks, type LlmPort } from '../src/reading/translator.ts'
import { srcHashOf } from '../src/reading/source-map.ts'

function fakeFs() {
  return {
    resolve: (rel: string, opts?: { cwd?: string }) => ({ key: pathResolve(opts?.cwd ?? process.cwd(), rel) }),
    contains: (parent: { key: string }, child: { key: string }) => {
      const p = pathResolve(parent.key)
      const c = pathResolve(child.key)
      return c === p || c.startsWith(`${p}/`)
    },
  }
}

interface FakeLlm {
  readonly port: LlmPort
  readonly calls: string[]
  failEnabled: boolean
}

function fakeLlm(mode: 'normal' | 'length' | 'fail-para-b' = 'normal'): FakeLlm {
  const calls: string[] = []
  const state = {
    calls,
    failEnabled: true,
    port: {
      stream: async function* (request: Parameters<LlmPort['stream']>[0]) {
        const prompt = request.messages[0]?.content[0]?.text ?? ''
        const body = prompt.split('<src>')[1]?.split('</src>')[0] ?? ''
        calls.push(body.slice(0, 60))
        if (mode === 'length') {
          yield { type: 'text-delta' as const, index: 0, text: '截断译文' }
          yield { type: 'finish' as const, reason: { kind: 'length' } }
          return
        }
        if (mode === 'fail-para-b' && state.failEnabled && body.includes('PARA-B')) {
          throw new Error('provider flaked on PARA-B')
        }
        yield { type: 'text-delta' as const, index: 0, text: `【中译】${body.slice(0, 16)}` }
        yield { type: 'usage' as const, usage: { totalTokens: 10 } }
        yield { type: 'finish' as const, reason: { kind: 'stop' } }
      },
    } satisfies LlmPort,
  }
  return state as FakeLlm
}

const PDF_REL = 'literature/pdf/batch-test.pdf'

async function makeService(options: { mode?: 'normal' | 'length' | 'fail-para-b' } = {}): Promise<{
  service: ReadingService
  root: string
  fake: FakeLlm
}> {
  const root = await mkdtemp(join(tmpdir(), 'srw-reading-batch-'))
  const fake = fakeLlm(options.mode ?? 'normal')
  const service = new ReadingService({
    fs: fakeFs(),
    rootDir: () => root,
    llm: () => fake.port,
    llmConfig: () => ({ provider: 'test', model: 'test-model' }),
  })
  const pdf = buildFixturePdf([
    { x: 60, y: 726, text: 'Batch Reading Test', size: 16 },
    { x: 60, y: 690, text: 'PARA-A first paragraph line one.', size: 10 },
    { x: 60, y: 684, text: 'PARA-A first paragraph line two.', size: 10 },
    { x: 60, y: 620, text: 'PARA-B second paragraph line one.', size: 10 },
    { x: 60, y: 614, text: 'continuation line without the failure marker.', size: 10 },
    { x: 60, y: 550, text: 'PARA-C third paragraph line one.', size: 10 },
    { x: 60, y: 544, text: 'PARA-C third paragraph line two.', size: 10 },
  ])
  await mkdir(join(root, 'proj', 'literature', 'pdf'), { recursive: true })
  await writeFile(join(root, 'proj', PDF_REL), pdf)
  return { service, root, fake }
}

test('reading P0-7：部分失败先写成功译文缓存，重跑只补失败块（缓存零调用）', async () => {
  const { service, root, fake } = await makeService({ mode: 'fail-para-b' })
  try {
    const extracted = await service.extract('proj', 'batch-paper', PDF_REL)
    assert.ok(extracted.blocks >= 2)
    const before = await service.status('proj', 'batch-paper')
    assert.ok(before.translatable >= 2)
    await assert.rejects(
      () => service.translate('proj', 'batch-paper'),
      (error: unknown) => (error as { code?: string }).code === 'UPSTREAM',
    )
    const cacheRaw = JSON.parse(await readFile(join(root, 'proj', 'reading', 'batch-paper', 'cache.json'), 'utf8')) as { entries: Record<string, unknown> }
    assert.equal(Object.keys(cacheRaw.entries).length, before.translatable - 1, '成功块必须已落缓存')
    const callsAfterFailure = fake.calls.length
    assert.ok(callsAfterFailure > before.translatable - 1, '失败块含重试调用')

    fake.failEnabled = false
    const done = await service.translate('proj', 'batch-paper')
    assert.equal(done.translated, done.translatable, '重跑补齐全部块')
    assert.equal(fake.calls.length, callsAfterFailure + 1, '重跑只对失败块发起 1 次调用')

    // 第三次：全部缓存命中，零 LLM 调用
    const again = await service.translate('proj', 'batch-paper')
    assert.equal(fake.calls.length, callsAfterFailure + 1, '缓存命中零 LLM 调用')
    assert.equal(again.translated, again.translatable)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reading P0-7：translator finish.reason=length → 失败（不产出结果）；服务报 TRUNCATED 且不写缓存', async () => {
  const report = await translateBlocks({
    llm: fakeLlm('length').port, provider: 'p', model: 'm', attempts: 1, timeoutMs: 2_000,
  }, [{ id: 'b1', text: 'truncated block' }])
  assert.equal(report.results.length, 0)
  assert.equal(report.failures.length, 1)
  assert.match(report.failures[0]?.error ?? '', /truncated/)

  const { service, root } = await makeService({ mode: 'length' })
  try {
    await service.extract('proj', 'batch-paper', PDF_REL)
    await assert.rejects(
      () => service.translate('proj', 'batch-paper'),
      (error: unknown) => (error as { code?: string }).code === 'TRUNCATED',
    )
    const cache = await readFile(join(root, 'proj', 'reading', 'batch-paper', 'cache.json'), 'utf8').catch(() => '')
    assert.equal(cache, '', '截断译文不得写缓存')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reading P0-7：显式 keys >40 → INVALID；未给 keys 时服务端单批 clamp 40', async () => {
  const { service, root, fake } = await makeService()
  try {
    await service.extract('proj', 'batch-paper', PDF_REL)
    await assert.rejects(
      () => service.translate('proj', 'batch-paper', { keys: Array.from({ length: 41 }, (_u, i) => `k${i}`) }),
      (error: unknown) => (error as { code?: string }).code === 'INVALID' && (error as Error).message.includes('单批最多'),
    )

    // 手工 map：41 个可译块，验证未给 keys 时只译 40
    const blocks = Array.from({ length: 41 }, (_u, i) => ({
      id: `p1-b${i}`,
      kind: 'para' as const,
      order: i,
      page: 1,
      srcHash: srcHashOf(`manual block ${i}`),
      chars: 20,
      bbox: { x0: 0, yTop: 0, x1: 10, yBottom: 10 },
      quality: 'ok' as const,
    }))
    const dir = join(root, 'proj', 'reading', 'many-paper')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'source_map.json'), JSON.stringify({
      schemaVersion: 1,
      paperKey: 'many-paper',
      source: { pdf: 'literature/pdf/many.pdf', sha256: 'x', pages: 1 },
      extractor: { name: 'test', version: 'test', ranAt: '2026-01-01T00:00:00.000Z' },
      blocks,
    }))
    await writeFile(join(dir, 'sources.json'), JSON.stringify(Object.fromEntries(blocks.map((block, i) => [block.id, `manual block ${i}`]))))
    const first = await service.translate('proj', 'many-paper')
    assert.equal(fake.calls.length, MAX_TRANSLATE_BLOCKS, '服务端 clamp：单批最多 40 次调用')
    assert.equal(first.translated, 40)
    const second = await service.translate('proj', 'many-paper')
    assert.equal(fake.calls.length, MAX_TRANSLATE_BLOCKS + 1, '剩余 1 块由下一批补齐')
    assert.equal(second.translated, 41)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
