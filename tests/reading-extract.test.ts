/** PDF 抽取器（0205 Task 4.2）：手造 fixture PDF（无二进制 fixture 入库）
 * 验行重建 / 双栏识别（不得左右交错）/ 跨栏 suspicious / title 判定。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectGutter, extractPdfBlocks, buildLines, type ExtractResult } from '../src/reading/extract.ts'
import { buildFixturePdf } from './fixture-pdf.ts'

test('extract：单栏——行序保持、紧邻行并段、序号标题判 heading', async () => {
  // 标题前后留真实文档特有的空距（合并阈值 1.8×行高=18pt）
  const lines = [
    { x: 60, y: 740, text: 'A Study of Attention Mechanisms', size: 16 },
    { x: 60, y: 706, text: 'Abstract' },
    { x: 60, y: 674, text: 'This paper studies attention. The first paragraph continues here' },
    { x: 60, y: 662, text: 'with a second physical line that should merge into the same block.' },
    { x: 60, y: 630, text: '1 Introduction' },
    { x: 60, y: 616, text: 'The introduction body starts here and flows on for a while.' },
  ]
  const result: ExtractResult = await extractPdfBlocks(buildFixturePdf(lines))
  assert.equal(result.pages, 1)
  const texts = result.blocks.map(block => block.text)
  assert.equal(texts[0], 'A Study of Attention Mechanisms')
  assert.equal(result.blocks[0]?.kind, 'title')
  assert.ok(texts.some(text => text.includes('should merge into the same block')), '相邻行应并段')
  assert.ok(result.blocks.some(block => block.kind === 'heading' && block.text.startsWith('1 Introduction')))
  // 阅读序 = 书写序（单栏不乱）
  const joined = result.blocks.map(block => block.text).join('\n')
  assert.ok(joined.indexOf('Abstract') < joined.indexOf('1 Introduction'))
})

test('extract：双栏——先左栏后右栏，绝不能左右交错', async () => {
  const lines: Array<{ x: number; y: number; text: string }> = []
  for (let i = 0; i < 10; i += 1) lines.push({ x: 50, y: 720 - i * 14, text: `LEFT line ${i} first column body text continues.` })
  for (let i = 0; i < 10; i += 1) lines.push({ x: 340, y: 720 - i * 14, text: `RIGHT line ${i} second column body text continues.` })
  const result = await extractPdfBlocks(buildFixturePdf(lines))
  const joined = result.blocks.map(block => block.text).join('\n')
  const firstRight = joined.indexOf('RIGHT line 0')
  const lastLeft = joined.lastIndexOf('LEFT line 9')
  assert.ok(lastLeft >= 0 && firstRight >= 0, '两栏文本都抽到')
  assert.ok(lastLeft < firstRight, '左栏全部读完才进右栏（不交错）')
  // 双栏下每行一个块（换栏断块；同栏行距 14 > 1.8×行高 10 → 各自成段也可）
  assert.ok(result.blocks.length >= 2)
})

test('extract：跨栏 item 标 suspicious，且不进入正常阅读流', async () => {
  const lines = [
    ...Array.from({ length: 6 }, (_unused, i) => ({ x: 50, y: 720 - i * 14, text: `LEFT line ${i} body text.` })),
    ...Array.from({ length: 6 }, (_unused, i) => ({ x: 340, y: 720 - i * 14, text: `RIGHT line ${i} body text.` })),
    { x: 180, y: 600, text: 'a long formula line that certainly straddles across the middle gutter region of this page', size: 10 },
  ]
  const result = await extractPdfBlocks(buildFixturePdf(lines))
  const suspicious = result.blocks.filter(block => block.quality === 'suspicious')
  assert.equal(suspicious.length, 1)
  assert.ok(suspicious[0]?.text.includes('straddle'), '跨栏内容独立成块并标级')
  assert.ok(result.blocks.filter(block => block.quality === 'ok').every(block => !block.text.includes('straddle')))
})

test('extract：detectGutter 单元——两簇+空带判栏，单簇不判', () => {
  const item = (x: number, width = 100): { str: string; x: number; y: number; width: number; height: number } =>
    ({ str: 't', x, y: 700, width, height: 10 })
  const twoColumn = [
    ...Array.from({ length: 5 }, (_unused, i) => item(50 + (i % 2) * 10)),
    ...Array.from({ length: 5 }, (_unused, i) => item(360 + (i % 2) * 10)),
  ]
  const gutter = detectGutter(twoColumn, 612)
  assert.ok(gutter !== undefined && gutter > 200 && gutter < 400, `双栏应有 gutter，得到 ${gutter}`)
  const single = Array.from({ length: 12 }, (_unused, i) => item(50 + i * 30, 40))
  assert.equal(detectGutter(single, 612), undefined, '连续单簇不判栏')
})

test('extract：buildLines——同 y 桶按 x 拼接、间距补空格', () => {
  const lines = buildLines([
    { str: 'world', x: 200, y: 700, width: 40, height: 10 },
    { str: 'hello', x: 60, y: 700, width: 35, height: 10 },
    { str: 'next', x: 60, y: 686, width: 30, height: 10 },
  ])
  assert.equal(lines.length, 2)
  assert.equal(lines[0]?.text, 'hello world', '同 y 桶 x 升序 + 间距补空格')
  assert.equal(lines[1]?.text, 'next')
})
