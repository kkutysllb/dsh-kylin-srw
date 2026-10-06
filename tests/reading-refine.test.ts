/** 版面二次判别（0205 附记四）：页眉/页脚杂讯、p1 标题重选、参考文献段、
 * 图内标注碎片——真论文里的高频抽取缺陷（"September, 2026" 吃掉标题位、
 * 图内文字混进正文、参考文献被翻译）在这里被拦住。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { refineBlocks, type ExtractedBlock } from '../src/reading/extract.ts'

function blk(
  id: string,
  page: number,
  order: number,
  text: string,
  options: { size?: number; kind?: ExtractedBlock['kind']; yTop: number; yBottom: number; x0?: number; x1?: number } ,
): ExtractedBlock {
  return {
    id,
    page,
    order,
    text,
    kind: options.kind ?? 'para',
    bbox: { x0: options.x0 ?? 60, yTop: options.yTop, x1: options.x1 ?? 480, yBottom: options.yBottom },
    size: options.size ?? 9.7,
    quality: 'ok',
  }
}

test('refine：页缘短行 → furniture（日期行/license 行/页码），不进正文', () => {
  const blocks = [
    blk('p1-b1', 1, 0, 'September, 2026', { yTop: 745, yBottom: 734, x0: 460, x1: 526 }),
    blk('p1-b2', 1, 1, 'A real paragraph about attention mechanisms in transformers.', { yTop: 660, yBottom: 649 }),
    blk('p2-b1', 2, 2, 'Body text continues with enough length to be real content here.', { yTop: 700, yBottom: 689 }),
  ]
  const [first] = refineBlocks(blocks, { 1: 792, 2: 792 })
  assert.equal(first?.kind, 'furniture')
})

test('refine：p1 标题重选——不是第一块的真正标题拿到 title，页眉日期不让位', () => {
  const blocks = [
    blk('p1-b1', 1, 0, 'September, 2026', { yTop: 745, yBottom: 734, x0: 460, x1: 526 }),
    blk('p1-b2', 1, 1, 'Semantic Communication Meets Edge Intelligence: A Survey', { size: 13, yTop: 700, yBottom: 655 }),
    blk('p1-b3', 1, 2, 'Alice Researcher, Bob Builder, and Carol Critic', { yTop: 640, yBottom: 629 }),
    blk('p1-b4', 1, 3, 'Abstract—We survey the field of semantic communication systems.', { yTop: 615, yBottom: 604 }),
    blk('p2-b1', 2, 4, 'Body text of page two with plenty of length to look like prose.', { yTop: 700, yBottom: 689 }),
  ]
  const refined = refineBlocks(blocks, { 1: 792, 2: 792 })
  assert.equal(refined.find(b => b.id === 'p1-b2')?.kind, 'title', '真标题应拿到 title')
  assert.equal(refined.find(b => b.id === 'p1-b1')?.kind, 'furniture', '日期行应是杂讯')
})

test('refine：venue/arXiv 行即便字号大也不当标题', () => {
  const blocks = [
    blk('p1-b1', 1, 0, 'arXiv:2609.10522v2 [eess.SP] 16 Sep 2026', { size: 12, yTop: 745, yBottom: 734, x0: 200, x1: 420 }),
    blk('p1-b2', 1, 1, 'A Real Title About Something Specific Here', { size: 11.5, yTop: 700, yBottom: 689 }),
    blk('p2-b1', 2, 2, 'Body text of page two with plenty of length to look like prose.', { yTop: 700, yBottom: 689 }),
  ]
  const refined = refineBlocks(blocks, { 1: 792, 2: 792 })
  // b1 命中 furniture（页缘）+ venue；title 落在 b2
  assert.equal(refined.find(b => b.id === 'p1-b2')?.kind, 'title')
  assert.notEqual(refined.find(b => b.id === 'p1-b1')?.kind, 'title')
})

test('refine：References 之后全部 → reference（英文原样保留的翻译豁免依据）', () => {
  const blocks = [
    blk('p1-b1', 1, 0, 'Body before references with enough length to be prose-like.', { yTop: 700, yBottom: 689 }),
    blk('p1-b2', 1, 1, 'References', { kind: 'heading', yTop: 660, yBottom: 649 }),
    blk('p1-b3', 1, 2, '[1] Vaswani et al. 2017. Attention is all you need.', { yTop: 630, yBottom: 619 }),
    blk('p1-b4', 1, 3, '[2] Bahdanau et al. 2015. Neural machine translation.', { yTop: 600, yBottom: 589 }),
  ]
  const refined = refineBlocks(blocks, { 1: 792 })
  assert.equal(refined.find(b => b.id === 'p1-b2')?.kind, 'heading', 'References 行仍是标题行')
  assert.equal(refined.find(b => b.id === 'p1-b3')?.kind, 'reference')
  assert.equal(refined.find(b => b.id === 'p1-b4')?.kind, 'reference')
  assert.equal(refined.find(b => b.id === 'p1-b1')?.kind, 'para')
})

test('refine：References 与首条目合并成块也触发（真论文活体教训）', () => {
  // showharness p18-b2 原文形状：标题行和 [1] 条目被 groupBlocks 合进一块
  // ——块内容就是条目 → reference（进附录 C，不翻译）
  const merged = blk('p18-b2', 18, 1, 'References [1] Michael Ahn, Anthony Brohan, Noah Brown, and many more authors of the RT-1 paper here.', { yTop: 700, yBottom: 689 })
  const refined = refineBlocks([merged], { 18: 792 })
  assert.equal(refined[0]?.kind, 'reference', '条目合并块应触发且归 reference')
  // fan2024 p13-b1 原文形状：全大写 REFERENCES + 从 [30] 起的双栏续排
  const caps = blk('p13-b1', 13, 2, 'REFERENCES [30] A. D. Sarma, L. Fang, N. Gupta, and H. Lee, Finding related tables in data lakes for sure.', { yTop: 700, yBottom: 689 })
  const refinedCaps = refineBlocks([caps], { 13: 792 })
  assert.equal(refinedCaps[0]?.kind, 'reference', '全大写 REFERENCES 同判')
})

test('refine：References 被前段末行吞并 → 开启 refs 段但块本体保持可译', () => {
  // recursive p28-b2 原文形状：双栏接排把标题吞进前段末尾
  const blocks = [
    blk('p28-b2', 28, 0, 'Experiment results compare favorably against all baselines across tasks and work. References', { yTop: 700, yBottom: 689 }),
    blk('p28-b3', 28, 1, '[1] A. Radford et al. Learning transferable visual models from natural language.', { yTop: 660, yBottom: 649 }),
  ]
  const refined = refineBlocks(blocks, { 28: 792 })
  assert.equal(refined[0]?.kind, 'para', '吞并块含正文，保持 para（可译）')
  assert.equal(refined[1]?.kind, 'reference', '其后条目进 reference')
})

test('refine：孤立单行碎片 + 附近有图注 → figlabel；正文连续段不误伤', () => {
  const blocks = [
    blk('p1-b1', 1, 0, 'A normal paragraph line about the experimental setup here.', { yTop: 700, yBottom: 689 }),
    blk('p1-b2', 1, 1, 'Block Under', { yTop: 660, yBottom: 649, x0: 60, x1: 130 }),
    blk('p1-b3', 1, 2, 'Figure 3: Which cup is under which block?', { kind: 'caption', yTop: 600, yBottom: 589, x0: 60, x1: 300 }),
    blk('p1-b4', 1, 3, 'Following paragraph that continues the running text normally.', { yTop: 550, yBottom: 539 }),
  ]
  const refined = refineBlocks(blocks, { 1: 792 })
  assert.equal(refined.find(b => b.id === 'p1-b2')?.kind, 'figlabel', '孤立短碎片应判 figlabel')
  assert.equal(refined.find(b => b.id === 'p1-b1')?.kind, 'para', '连续正文不误伤')
  assert.equal(refined.find(b => b.id === 'p1-b4')?.kind, 'para', '连续正文不误伤')
})

test('refine：小写开头的跨图续行片段不判 figlabel（fan2024 活体误伤教训）', () => {
  const blocks = [
    blk('p1-b1', 1, 0, 'She compares diversity reports issued by major tech compa-', { yTop: 700, yBottom: 689 }),
    blk('p1-b2', 1, 1, 'tech companies in 2021 (top blue table in Figure 1). The', { yTop: 620, yBottom: 609, x0: 60, x1: 400 }),
    blk('p1-b3', 1, 2, 'Figure 1: Diversity numbers across two sources.', { kind: 'caption', yTop: 560, yBottom: 549, x0: 60, x1: 300 }),
    blk('p1-b4', 1, 3, 'user has access to 2021 numbers which contradict the news article text.', { yTop: 500, yBottom: 489 }),
  ]
  const refined = refineBlocks(blocks, { 1: 792 })
  assert.equal(refined.find(b => b.id === 'p1-b2')?.kind, 'para', '小写开头的续行是正文，不是图内标注')
  assert.equal(refined.find(b => b.id === 'p1-b4')?.kind, 'para', '小写开头的续行是正文，不是图内标注')
})
