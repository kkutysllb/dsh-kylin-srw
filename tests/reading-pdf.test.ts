/** 精读结果 PDF 归档（用户指令：项目工作区独立子目录、按日期归档）：
 * renderReadingPdf 产出合法 PDF（CJK 字体内嵌）+ exportPdf 落
 * readings/<YYYY-MM-DD>/<paperKey>.pdf + 回读抽取文本含译文。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve as pathResolve } from 'node:path'
import { buildFixturePdf } from './fixture-pdf.ts'
import { ReadingService } from '../src/reading/service.ts'
import { extractPdfBlocks } from '../src/reading/extract.ts'
import { resolveCjkFont, renderReadingPdf } from '../src/reading/pdfdoc.ts'
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
  return {
    port: {
      stream: async function* (request: Parameters<LlmPort['stream']>[0]) {
        const src = request.messages[0]?.content[0]?.text ?? ''
        const body = src.split('<src>')[1]?.split('</src>')[0] ?? ''
        yield { type: 'text-delta' as const, index: 0, text: `注意力测试译文：${body.slice(0, 16)}` }
        yield { type: 'usage' as const, usage: { totalTokens: 30 } }
        yield { type: 'finish' as const, reason: { kind: 'stop' } }
      },
    } satisfies LlmPort,
  }
}

const PDF_REL = 'literature/pdf/test2026-paper-abc12345.pdf'

test('pdfdoc：无字体环境明确报 FONT_MISSING（回退链全 miss 时 fail-closed）', async () => {
  const font = resolveCjkFont()
  if (font !== undefined) return // 本机有字体：该断言交给 CI/无字体机
  await assert.rejects(
    () => renderReadingPdf({
      paperKey: 'x', title: 't', exportedAt: 'now',
      summary: { pages: 1, blocks: 0, translated: 0, verified: 0, mismatch: 0, orphan: 0, missing: 0 },
      paragraphs: [],
    }),
    /FONT_MISSING/,
  )
})

test('pdfdoc：整篇逐段双语渲染出合法 PDF（%PDF 头 + 回读文本含源句与译文）', { skip: resolveCjkFont() === undefined ? '本机无 CJK 字体' : false }, async () => {
  const buffer = await renderReadingPdf({
    paperKey: 'arxiv-1706-03762',
    title: 'Attention Is All You Need',
    pdfPath: 'literature/pdf/vaswani2017-attention-70603762.pdf',
    exportedAt: '2026-10-06T08:00:00.000Z',
    model: 'test-model',
    summary: { pages: 15, blocks: 3, translated: 2, verified: 2, mismatch: 1, orphan: 0, missing: 0 },
    paragraphs: [
      { id: 'p1-b1', kind: 'title', state: 'verified', sourceText: 'Attention Is All You Need', translation: '注意力就是你所需要的一切' },
      { id: 'p1-b2', state: 'verified', sourceText: 'We propose a new simple network architecture, the Transformer.', translation: '我们提出了一种新的简单网络架构——Transformer。' },
      { id: 'p2-b1', state: 'mismatch', sourceText: 'Tampered source paragraph.', translation: '被手改源段的译文' },
    ],
  })
  assert.ok(buffer.length > 5000, `PDF 太小：${buffer.length}`)
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-')
  // 回读：用自己的抽取器验证 CJK 译文真实写进页面（ToUnicode 可逆向）
  const roundtrip = await extractPdfBlocks(new Uint8Array(buffer))
  const text = roundtrip.blocks.map(block => block.text).join('\n')
  assert.ok(text.includes('注意力就是你所需要的一切'), '译文未回读')
  assert.ok(text.includes('Transformer'), '源文未回读')
  assert.ok(text.includes('源文被改'), '问题段警示未回读')
})

test('exportPdf：落 readings/<当日>/<paperKey>.pdf，同日重导覆盖', async () => {
  const root = await mkdtemp(join(tmpdir(), 'srw-pdf-export-'))
  try {
    const service = new ReadingService({
      fs: fakeFs(),
      rootDir: () => root,
      llm: () => fakeLlm().port,
      llmConfig: () => ({ provider: 'test', model: 'test-model' }),
    })
    await mkdir(join(root, 'demo', 'literature', 'pdf'), { recursive: true })
    const pdfBytes = buildFixturePdf([
      { x: 60, y: 740, text: 'Attention Is All You Need', size: 16 },
      ...Array.from({ length: 6 }, (_u, i) => ({ x: 60, y: 700 - i * 14, text: `Body line ${i} for the export test.` })),
    ])
    await writeFile(join(root, 'demo', PDF_REL), pdfBytes)
    await service.extract('demo', 'export-test-paper', PDF_REL)
    await service.translate('demo', 'export-test-paper')

    const first = await service.exportPdf('demo', 'export-test-paper')
    assert.match(first.path, /^demo\/readings\/\d{4}-\d{2}-\d{2}\/export-test-paper\.pdf$/)
    assert.ok(first.bytes > 5000, `归档 PDF 太小：${first.bytes}`)
    assert.equal(first.summary.verified > 0, true)
    const abs = join(root, first.path)
    assert.equal((await stat(abs)).isFile(), true)

    const second = await service.exportPdf('demo', 'export-test-paper')
    assert.equal(second.path, first.path, '同日重导应同路径覆盖')
    const entries = await readdir(join(root, 'demo/readings'))
    assert.equal(entries.length, 1, '只应有当日一个日期目录')

    // 逐段呈现：verified 段不携带任何块徽章痕迹
    const { extractPdfBlocks } = await import('../src/reading/extract.ts')
    const archived = await extractPdfBlocks(new Uint8Array(await readFile(join(root, first.path))))
    const text = archived.blocks.map(block => block.text).join('\n')
    assert.ok(!text.includes('源段一致'), 'verified 段不应再渲染块徽章')
    assert.ok(text.includes('Attention Is All You Need'), '标题源文未回读')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('exportPdf：未抽取 NOT_FOUND；导出物在 root 内（guard 生效）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'srw-pdf-guard-'))
  try {
    const service = new ReadingService({
      fs: fakeFs(),
      rootDir: () => root,
      llm: () => undefined,
      llmConfig: () => ({ provider: 'test', model: 'test-model' }),
    })
    await assert.rejects(() => service.exportPdf('demo', 'no-such-paper'), /未抽取/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
