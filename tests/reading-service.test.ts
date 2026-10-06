/** ReadingService 全链（0205 Task 4.7）：extract→translate→render→verify
 * + 增量重译计数（假 LLM：重跑不发起调用）+ 术语表变更定向重译。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve as pathResolve } from 'node:path'
import { buildFixturePdf } from './fixture-pdf.ts'
import { ReadingService } from '../src/reading/service.ts'
import type { LlmPort } from '../src/reading/translator.ts'

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

function fakeLlm() {
  const calls: string[] = []
  return {
    calls,
    port: {
      stream: async function* (request: Parameters<LlmPort['stream']>[0]) {
        const src = request.messages[0]?.content[0]?.text ?? ''
        const body = src.split('<src>')[1]?.split('</src>')[0] ?? ''
        calls.push(body.slice(0, 24))
        yield { type: 'text-delta' as const, index: 0, text: `【中译】${body.slice(0, 16)}` }
        yield { type: 'usage' as const, usage: { totalTokens: 30 } }
        yield { type: 'finish' as const, reason: { kind: 'stop' } }
      },
    } satisfies LlmPort,
  }
}

const PDF_REL = 'literature/pdf/test2026-paper-abc12345.pdf'

async function makeService(options: { llm?: boolean } = {}): Promise<{
  service: ReadingService
  root: string
  fake: ReturnType<typeof fakeLlm>
}> {
  const root = await mkdtemp(join(tmpdir(), 'srw-reading-'))
  const fake = fakeLlm()
  const service = new ReadingService({
    fs: fakeFs(),
    rootDir: () => root,
    llm: () => (options.llm === false ? undefined : fake.port),
    llmConfig: () => ({ provider: 'test', model: 'test-model' }),
  })
  const pdf = buildFixturePdf([
    { x: 60, y: 740, text: 'Attention Is All You Need', size: 16 },
    ...Array.from({ length: 8 }, (_u, i) => ({ x: 60, y: 700 - i * 14, text: `Body paragraph line ${i} of the first section.` })),
  ])
  await mkdir(join(root, 'proj', 'literature', 'pdf'), { recursive: true })
  await writeFile(join(root, 'proj', PDF_REL), pdf)
  return { service, root, fake }
}

test('reading：extract → translate → verify 全链，产物落盘', async () => {
  const { service, root, fake } = await makeService()
  try {
    const extracted = await service.extract('proj', 'test2026-paper', PDF_REL)
    assert.ok(extracted.blocks >= 2)
    assert.equal(extracted.migrated, 0)
    const status = await service.translate('proj', 'test2026-paper')
    assert.equal(status.extracted, true)
    assert.equal(status.translated, status.blocks, '全部块带译文元数据')
    assert.equal(status.mismatch, 0)
    assert.equal(status.orphan, 0)
    assert.ok(status.verified > 0)
    const markdown = await readFile(join(root, 'proj', 'reading', 'test2026-paper', 'paper.md'), 'utf8')
    assert.ok(markdown.includes('<!-- srw:p1-b1 '))
    assert.ok(markdown.includes('【中译】'))
    assert.equal(fake.calls.length, status.blocks, '每块恰好一次调用')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reading：增量重译——重跑 translate 零调用（缓存命中）；强制才重打', async () => {
  const { service, root, fake } = await makeService()
  try {
    await service.extract('proj', 'test2026-paper', PDF_REL)
    await service.translate('proj', 'test2026-paper')
    const firstCalls = fake.calls.length
    assert.ok(firstCalls > 0)
    const again = await service.translate('proj', 'test2026-paper')
    assert.equal(fake.calls.length, firstCalls, '缓存命中：零 LLM 调用')
    assert.equal(again.translated, again.blocks, '译文元数据仍在')
    await service.translate('proj', 'test2026-paper', { force: true })
    assert.equal(fake.calls.length, firstCalls * 2, 'force 才真正重打')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reading：术语表变更 → 缓存清空 → 重译全覆盖', async () => {
  const { service, root, fake } = await makeService()
  try {
    await service.extract('proj', 'test2026-paper', PDF_REL)
    await service.translate('proj', 'test2026-paper')
    await service.setGlossary('proj', 'test2026-paper', { attention: '注意力机制' })
    const before = fake.calls.length
    await service.translate('proj', 'test2026-paper')
    assert.ok(fake.calls.length > before, '改术语表后重译发生')
    const markdown = await readFile(join(root, 'proj', 'reading', 'test2026-paper', 'paper.md'), 'utf8')
    assert.ok(markdown.includes('【中译】'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reading：LLM 缺席——translate 报 INVALID，extract/status 不受影响', async () => {
  const { service, root } = await makeService({ llm: false })
  try {
    await service.extract('proj', 'test2026-paper', PDF_REL)
    await assert.rejects(
      () => service.translate('proj', 'test2026-paper'),
      (error: unknown) => (error as { code?: string }).code === 'INVALID',
    )
    const status = await service.status('proj', 'test2026-paper')
    assert.equal(status.extracted, true)
    assert.equal(status.llmAvailable, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reading：未抽取 NOT_FOUND；paperKey 非法拒', async () => {
  const { service, root } = await makeService()
  try {
    await assert.rejects(() => service.translate('proj', 'no-such'), /未抽取/)
    await assert.rejects(() => service.extract('proj', 'BAD_KEY!', 'literature/pdf/x.pdf'), /paperKey 非法/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
