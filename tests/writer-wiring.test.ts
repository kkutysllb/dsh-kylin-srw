/** P0-1 装配回归：生产 SrwService 必须给 WriterService 传真实 nodeRun。
 * 旧缺陷：src/service.ts 构造时漏传 run → probeEngines 把「端口未装配」吞成
 * 「引擎不可用」，即使 PATH 里有可执行 tectonic 也恒 ENGINE_MISSING。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as pathResolve } from 'node:path'
import { SrwService } from '../src/service.ts'

test('writer wiring：生产 SrwService 装配 nodeRun，PATH 里的 tectonic 能被探测到', async (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX shell fake engine only')
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'srw-wiring-'))
  const bin = join(root, 'bin')
  await mkdir(bin, { recursive: true })
  const fake = join(bin, 'tectonic')
  await writeFile(fake, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "tectonic 0.15.0-fake"; exit 0; fi',
    'mkdir -p build',
    'printf "%%PDF-1.4 fake" > build/main.pdf',
    'echo "Output written on main.pdf (1 page, 20 bytes)."',
    '',
  ].join('\n'), { mode: 0o755 })
  const oldPath = process.env.PATH ?? ''
  process.env.PATH = `${bin}${oldPath === '' ? '' : `:${oldPath}`}`
  try {
    const fs = {
      resolve: (rel: string, opts?: { cwd?: string }) => ({ key: pathResolve(opts?.cwd ?? process.cwd(), rel) }),
      contains: (parent: { key: string }, child: { key: string }) => {
        const p = pathResolve(parent.key)
        const c = pathResolve(child.key)
        return c === p || c.startsWith(`${p}/`)
      },
    }
    const service = await SrwService.open({ fs }, { rootDir: root })
    const state = await service.writer.state('demo')
    assert.equal(state.engine.engine, 'tectonic')
    assert.equal(state.engine.probes.find(probe => probe.engine === 'tectonic')?.available, true)

    // 生产形状端到端：真实 nodeRun 调 PATH 里的假 tectonic（模拟 --outdir build），
    // 走完 scaffold → G1 confirm → compile，确认 pdfWritten/buildPdf/snapshot 都成立。
    await service.writer.venueApply('demo', 'ieee-journal', 'D1')
    await service.writer.scaffold('demo', { title: 'Wiring E2E' })
    await service.writer.outlineConfirm('demo')
    const outcome = await service.writer.compile('demo')
    assert.equal(outcome.ok, true)
    assert.equal(outcome.pdfWritten, true)
    assert.ok(outcome.snapshot !== undefined)
    assert.equal((await service.writer.state('demo')).files.buildPdf, true)
  } finally {
    process.env.PATH = oldPath
    await rm(root, { recursive: true, force: true })
  }
})
