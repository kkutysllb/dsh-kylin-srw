/** 真实 TeX 引擎验收（Phase 0 收尾）：本机装有 tectonic/latexmk/xelatex/pdflatex
 * 之一时才运行；全缺则 skip（CI 无 TeX 不跑）。验证生产装配的 nodeRun 能驱动
 * 真引擎走完 scaffold → G1 → 正文（带引用）→ 编译出真 PDF → 快照 →
 * 越界 input 被 GATE 拦 → 修复后恢复 → 回滚复原。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as pathResolve } from 'node:path'
import { SrwService } from '../src/service.ts'
import { ServiceError } from '../src/service.ts'

const run = promisify(execFile)

const ENGINE_CANDIDATES = ['tectonic', 'latexmk', 'xelatex', 'pdflatex'] as const

async function findEngine(): Promise<string | undefined> {
  for (const engine of ENGINE_CANDIDATES) {
    try {
      await run(engine, ['--version'], { timeout: 15_000 })
      return engine
    } catch { /* 不在 PATH，试下一个 */ }
  }
  return undefined
}

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

test('writer real-engine：真引擎出真 PDF + 引用解析 + 越界 input GATE + 回滚', async (t) => {
  const engine = await findEngine()
  if (engine === undefined) {
    t.skip('本机无 TeX 引擎（tectonic/latexmk/xelatex/pdflatex 全缺）——装 tectonic 后重跑本验收')
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'srw-real-'))
  try {
    const service = await SrwService.open({ fs: fakeFs() }, { rootDir: root })
    const writer = service.writer
    assert.equal((await writer.state('demo')).engine.engine, engine)

    await writer.venueApply('demo', 'ieee-journal', 'D1')
    await writer.scaffold('demo', { title: 'Real Engine Acceptance' })
    await writer.outlineConfirm('demo')
    const introTex = '\\section{Introduction}\nWe build on the transformer~\\cite{vaswani2017}.\n'
    await writer.sectionWrite('demo', 's1', introTex)
    // scaffold 的 refs.bib 只留占位注释；写入一条真实可解析条目
    await writeFile(join(root, 'demo', 'paper', 'refs.bib'), [
      '@article{vaswani2017,',
      '  author  = {Vaswani, Ashish and Shazeer, Noam},',
      '  title   = {Attention Is All You Need},',
      '  journal = {NeurIPS},',
      '  year    = {2017},',
      '}',
      '',
    ].join('\n'), 'utf8')

    const outcome = await writer.compile('demo')
    assert.equal(outcome.ok, true, `编译失败：${outcome.log.slice(0, 800)}`)
    assert.equal(outcome.pdfWritten, true)
    assert.equal(outcome.parsed.errors.length, 0)
    assert.ok(outcome.snapshot !== undefined)
    assert.equal((await writer.state('demo')).files.buildPdf, true)
    if (engine === 'tectonic' || engine === 'latexmk') {
      assert.ok(!/Citation .* undefined/.test(outcome.log), '引用应已被解析（无 undefined citation）')
    }
    if (engine === 'xelatex' || engine === 'pdflatex') {
      assert.ok(outcome.bib !== undefined && outcome.bib.bbl, 'bbl 应已生成')
      assert.equal(outcome.bib.undefinedCitations, 0)
    }

    // 真 PDF：非空、魔数正确
    const pdf = await readFile(join(root, 'demo', 'paper', 'build', 'main.pdf'))
    assert.ok(pdf.length > 1000, '真 PDF 应有实质内容')
    assert.ok(pdf.subarray(0, 5).toString('latin1') === '%PDF-')

    // 越界 input：标记块外塞一条野 input → 编译必须 GATE 拒绝（绝不静默编进去）
    const mainPath = join(root, 'demo', 'paper', 'main.tex')
    const tampered = (await readFile(mainPath, 'utf8')).replace('% srw:inputs:end', '% srw:inputs:end\n\\input{sections/99-rogue} % rogue')
    await writeFile(mainPath, tampered, 'utf8')
    await assert.rejects(
      () => writer.compile('demo'),
      (error: unknown) => error instanceof ServiceError && error.code === 'GATE',
    )
    const recovered = (await readFile(mainPath, 'utf8')).replace('\\input{sections/99-rogue} % rogue\n', '')
    await writeFile(mainPath, recovered, 'utf8')
    const afterGate = await writer.compile('demo')
    assert.equal(afterGate.ok, true)

    // 回滚：改坏节 → restore → 内容复原
    await writer.sectionWrite('demo', 's1', '\\section{Introduction}\nWrecked.\n')
    await writer.snapshotRestore('demo', outcome.snapshot!.id)
    assert.equal(await readFile(join(root, 'demo', 'paper', 'sections', '01-introduction.tex'), 'utf8'), introTex)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
