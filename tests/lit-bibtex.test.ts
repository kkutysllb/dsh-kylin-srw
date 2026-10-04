/** Task 2.8：citekey 确定性 / LaTeX 转义 / refs.bib 追加去重。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendToRefs, citekeyOf, escapeLatex, extractCitekeys, toBibtex } from '../src/literature/bibtex.ts'
import type { LitEntry } from '../src/literature/library.ts'

function entry(over: Partial<LitEntry>): LitEntry {
  return {
    key: 'arxiv:2401.12345',
    identity: { arxivId: '2401.12345v2', title: 'Electron Microscopy Survey', year: 2024 },
    source: 'arxiv',
    seenIn: ['arxiv'],
    authors: ['Alice Alpha'],
    venue: 'arXiv',
    abstract: '',
    status: 'unread',
    addedAt: '2026-10-04T00:00:00Z',
    updatedAt: '2026-10-04T00:00:00Z',
    ...over,
  }
}

test('bibtex：citekey 确定性公式与冲突后缀', () => {
  const e1 = entry({})
  assert.equal(citekeyOf(e1), 'alpha2024-electron')
  // 同一条目两次生成必同 key
  assert.equal(citekeyOf(e1), citekeyOf(entry({})))
  // CJK 标题：无拉丁词 → 标题头直用（作者非 ASCII 无拼音 → unknown，计划口径）
  const cjk = entry({ identity: { title: '通信网络智能运维综述', year: 2025 }, authors: ['王小明'] })
  assert.match(citekeyOf(cjk), /^unknown2025-/)
  // 无作者
  assert.match(citekeyOf(entry({ authors: [] })), /^unknown2024-/)
})

test('bibtex：LaTeX 转义 + 类型映射', () => {
  const latex = entry({ identity: { title: 'A & B % C # D _ E {F}', year: 2024 } })
  const bib = toBibtex(latex, 'x2024-a')
  assert.ok(bib.includes('A \\& B \\% C \\# D \\_ E \\{F\\}'))
  // arXiv venue → @misc
  assert.ok(bib.startsWith('@misc{x2024-a,'))
  // 会议 → @inproceedings
  const conf = entry({ venue: 'Proceedings of the ACL Conference' })
  assert.ok(toBibtex(conf, 'y').startsWith('@inproceedings{y,'))
  // 期刊 → @article + venue 字段
  const journal = entry({ venue: 'Nature', identity: { doi: '10.1/n', title: 'T', year: 2023 } })
  const journalBib = toBibtex(journal, 'z')
  assert.ok(journalBib.startsWith('@article{z,'))
  assert.ok(journalBib.includes('doi = {10.1/n}'))
})

test('bibtex：appendToRefs——首写/重复跳过/批内冲突后缀/无残留', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'srw-bib-'))
  try {
    const refs = join(dir, 'refs.bib')
    const a = entry({})
    const b = entry({ key: 'arxiv:2402.1', identity: { arxivId: '2402.00001v1', title: 'Bridging Modalities', year: 2024 }, authors: ['Bob Beta'] })
    // 批内冲突（不同条目同公式键）：同批 → 后缀 -2
    const c = entry({ key: 'arxiv:2403.1', identity: { title: 'Electron Microscopy Extended', year: 2024 }, authors: ['Alice Alpha'] })
    const first = await appendToRefs(refs, [a, c, b])
    assert.deepEqual(first.added, ['alpha2024-electron', 'alpha2024-electron-2', 'beta2024-bridging'])
    assert.equal(first.skipped, 0)
    const text1 = await readFile(refs, 'utf8')
    assert.ok(text1.includes('@misc{alpha2024-electron-2,'))
    // 同 key 再导出 → 跳过（引用级去重）
    const second = await appendToRefs(refs, [a])
    assert.deepEqual(second.added, [])
    assert.equal(second.skipped, 1)
    // 无 tmp 残留
    const { readdir } = await import('node:fs/promises')
    const leftovers = (await readdir(dir)).filter(name => name.includes('.tmp-'))
    assert.deepEqual(leftovers, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
