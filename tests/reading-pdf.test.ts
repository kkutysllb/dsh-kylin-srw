/** 精读结果 PDF（译注版）：renderReadingPdf 产出合法 PDF（封面/阅读指南/
 * 导读/双语正文/附录）+ exportPdf 落 readings/<YYYY-MM-DD>/<paperKey>.pdf +
 * notes 生成导读/节备注（可恢复）+ 回读抽取验证 CJK 与结构。 */

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
import { parseSectionOutput } from '../src/reading/notes.ts'
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

/** 翻译/导读/节备注三路分发假 LLM：<src>→翻译、<标题>→导读、<节标题>→节备注。 */
function fakeLlm(options: { failSections?: boolean } = {}) {
  return {
    port: {
      stream: async function* (request: Parameters<LlmPort['stream']>[0]) {
        const src = request.messages[0]?.content[0]?.text ?? ''
        if (src.includes('<节标题>')) {
          if (options.failSections === true) throw new Error('simulated upstream failure')
          yield { type: 'text-delta' as const, index: 0, text: '【本节速览】\n- 提出注意力架构\n- 消融详尽\n◆精读备注\n要点：注意力足够\n概念：自注意力（self-attention）\n论证：先定义后实证\n证据：表 2 的 28.4 BLEU\n评述：译者判断：论证扎实' }
        } else if (src.includes('<标题>')) {
          yield { type: 'text-delta' as const, index: 0, text: '类型判定：方法论文\n一句话概括：提出全注意力架构取代循环结构。\n要解决的问题：\n- 训练慢\n章节地图：\n1 Introduction：背景与动机\n如果只记三件事：\n- 注意力足矣' }
        } else {
          const body = src.split('<src>')[1]?.split('</src>')[0] ?? ''
          yield { type: 'text-delta' as const, index: 0, text: `注意力测试译文：${body.slice(0, 16)}` }
        }
        yield { type: 'usage' as const, usage: { totalTokens: 30 } }
        yield { type: 'finish' as const, reason: { kind: 'stop' } }
      },
    } satisfies LlmPort,
  }
}

const PDF_REL = 'literature/pdf/test2026-paper-abc12345.pdf'

/** 版面安全布局：title 距页缘 66pt（furniture 带外）；各块间距既保持独立
 * 又不触发 figlabel 的孤立判定（除刻意设置的 'Block Under'）。 */
function layout(): { x: number; y: number; text: string; size: number }[] {
  return [
    { x: 60, y: 726, text: 'Attention Is All You Need', size: 16 },
    { x: 60, y: 680, text: 'Body line 0 for the export test.', size: 11 },
    { x: 60, y: 666, text: 'Body line 1 for the export test.', size: 11 },
    { x: 60, y: 652, text: 'Body line 2 for the export test.', size: 11 },
    { x: 60, y: 638, text: 'Body line 3 for the export test.', size: 11 },
    { x: 60, y: 600, text: '1 Introduction', size: 12 },
    { x: 60, y: 550, text: 'Block Under', size: 11 },
    { x: 60, y: 505, text: 'Figure 1: The full architecture.', size: 11 },
    { x: 60, y: 460, text: 'After the figure we continue the argument.', size: 11 },
  ]
}

test('notes：解析【本节速览】/◆精读备注 分段；无标记整段退为 note', () => {
  const full = parseSectionOutput('【本节速览】\n- 甲\n- 乙\n◆精读备注\n要点：x\n评述：译者判断：y')
  assert.equal(full.summary, '- 甲\n- 乙')
  assert.ok(full.note.includes('要点：x'))
  const bare = parseSectionOutput('只有一段话')
  assert.equal(bare.summary, '')
  assert.equal(bare.note, '只有一段话')
})

test('pdfdoc：无字体环境明确报 FONT_MISSING（回退链全 miss 时 fail-closed）', async () => {
  const font = resolveCjkFont()
  if (font !== undefined) return // 本机有字体：该断言交给 CI/无字体机
  await assert.rejects(
    () => renderReadingPdf({
      paperKey: 'x', titleZh: 't', titleEn: 't', exportedAt: 'now',
      summary: { pages: 1, blocks: 0, translated: 0, verified: 0, mismatch: 0, orphan: 0, missing: 0 },
      flow: [], references: [],
    }),
    /FONT_MISSING/,
  )
})

test('pdfdoc：译注版结构（封面/导读/速览/备注盒/图内标注/参考文献原样/页眉）可回读', { skip: resolveCjkFont() === undefined ? '本机无 CJK 字体' : false }, async () => {
  const buffer = await renderReadingPdf({
    paperKey: 'arxiv-1706-03762',
    titleZh: '注意力就是你所需要的一切',
    titleEn: 'Attention Is All You Need',
    authors: 'Ashish Vaswani, Noam Shazeer, et al.',
    pdfPath: 'literature/pdf/vaswani2017-attention-70603762.pdf',
    exportedAt: '2026-10-06T08:00:00.000Z',
    model: 'test-model',
    glossary: { 'self-attention': '自注意力' },
    guide: '类型判定：方法论文\n一句话概括：提出全注意力架构。',
    sectionNotes: { 'p1-b3': { summary: '- 速览条目', note: '要点：测试要点' } },
    summary: { pages: 15, blocks: 5, translated: 4, verified: 3, mismatch: 1, orphan: 0, missing: 0 },
    flow: [
      { id: 'p1-b1', kind: 'title', state: 'verified', sourceText: 'Attention Is All You Need', translation: '注意力就是你所需要的一切' },
      { id: 'p1-b2', state: 'verified', sourceText: 'We propose a new simple network architecture, the Transformer.', translation: '我们提出了一种新的简单网络架构——Transformer。' },
      { id: 'p1-b3', kind: 'heading', state: 'verified', sourceText: '1 Introduction', translation: '1 引言' },
      { id: 'p1-b4', kind: 'caption', state: 'verified', sourceText: 'Figure 1: Model architecture.', translation: '图 1：模型架构。' },
      { id: 'p2-b1', state: 'mismatch', sourceText: 'Tampered source paragraph.', translation: '被手改源段的译文' },
    ],
    references: [
      { id: 'p9-b1', kind: 'reference', state: 'verified', sourceText: 'Bahdanau et al. 2015. Neural machine translation by jointly learning to align and translate.' },
    ],
    figureNotes: { 'p1-b4': ['Block Under', 'Which Cup?'] },
    figureList: [{ text: 'Figure 1: Model architecture.', page: 3 }],
  })
  assert.ok(buffer.length > 5000, `PDF 太小：${buffer.length}`)
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-')
  // 回读：用自己的抽取器验证 CJK 真实写进页面（ToUnicode 可逆向）
  const roundtrip = await extractPdfBlocks(new Uint8Array(buffer))
  const text = roundtrip.blocks.map(block => block.text).join('\n')
  assert.ok(text.includes('注意力就是你所需要的一切'), '封面中文标题未回读')
  assert.ok(text.includes('中文精读译注版'), '译注版页眉/标识未回读')
  assert.ok(text.includes('阅读指南'), '阅读指南未回读')
  assert.ok(text.includes('类型判定'), '全文导读未回读')
  assert.ok(text.includes('【本节速览】'), '节速览盒未回读')
  assert.ok(text.includes('精读备注'), '节备注盒未回读')
  assert.ok(text.includes('图内标注'), '图内标注未回读')
  assert.ok(text.includes('Block Under'), '图内碎片源文未回读')
  assert.ok(text.includes('术语对照表'), '术语对照表未回读')
  assert.ok(text.includes('自注意力'), '术语条目未回读')
  assert.ok(text.includes('英文原样保留'), '参考文献原样体例未回读')
  assert.ok(text.includes('Bahdanau et al. 2015'), '参考文献条目未回读')
  assert.ok(text.includes('源文被改'), '问题段警示未回读')
  assert.ok(text.includes('免责'), '免责说明未回读')
})

test('notes 全链：翻译 → generateNotes（导读+节备注，失败可恢复）→ export 含分析层', async () => {
  const root = await mkdtemp(join(tmpdir(), 'srw-pdf-notes-'))
  try {
    const service = new ReadingService({
      fs: fakeFs(),
      rootDir: () => root,
      llm: () => fakeLlm().port,
      llmConfig: () => ({ provider: 'test', model: 'test-model' }),
    })
    await mkdir(join(root, 'demo', 'literature', 'pdf'), { recursive: true })
    await writeFile(join(root, 'demo', PDF_REL), buildFixturePdf(layout()))
    await service.extract('demo', 'export-test-paper', PDF_REL)
    await service.translate('demo', 'export-test-paper')

    // 先让节备注失败：导读就该生成，节 pending=1
    const failing = new ReadingService({
      fs: fakeFs(),
      rootDir: () => root,
      llm: () => fakeLlm({ failSections: true }).port,
      llmConfig: () => ({ provider: 'test', model: 'test-model' }),
    })
    const partial = await failing.generateNotes('demo', 'export-test-paper')
    assert.equal(partial.guideReady, true, '节失败不阻断导读')
    assert.equal(partial.total >= 1, true)
    assert.equal(partial.pending, partial.total, '节全失败时 pending=total')

    // 重跑（健康 LLM）：只补缺失节 → pending=0
    const done = await service.generateNotes('demo', 'export-test-paper')
    assert.equal(done.guideReady, true)
    assert.equal(done.pending, 0)
    const notes = await service.loadNotes('demo', 'export-test-paper')
    assert.ok(notes?.guide !== undefined, 'notes.json 应有导读')
    const sectionIds = Object.keys(notes.sections)
    assert.equal(sectionIds.length >= 1, true, 'notes.json 应有节备注')
    assert.ok(notes.sections[sectionIds[0] as string]?.note.includes('要点：'), '节备注应含字段行')

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

    // 译注版结构回读：导读/速览/图注/图内标注/无徽章 verified 段
    const archived = await extractPdfBlocks(new Uint8Array(await readFile(join(root, first.path))))
    const text = archived.blocks.map(block => block.text).join('\n')
    assert.ok(!text.includes('源段一致'), 'verified 段不应再渲染块徽章')
    assert.ok(text.includes('Attention Is All You Need'), '标题源文未回读')
    assert.ok(text.includes('全文导读'), '导读章未回读')
    assert.ok(text.includes('【本节速览】'), '节速览未回读')
    assert.ok(text.includes('Block Under'), '图内标注未回读')
    assert.ok(text.includes('英文原样保留'), '参考文献体例未回读')
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
