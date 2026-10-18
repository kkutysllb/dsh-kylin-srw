/** 刊物注册表 / 深度档位 / 合规检查 / 引擎探测（0206 Task 5.1/5.7/5.8）。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getVenue, listVenues } from '../src/venue/registry.ts'
import { validateVenue } from '../src/venue/types.ts'
import { DEPTH_PROFILES, experimentsChecklist } from '../src/venue/depth.ts'
import { runCompliance } from '../src/venue/compliance.ts'
import { ENGINE_ORDER, probeEngines, compileCommand, type RunPort } from '../src/writer/engine.ts'

test('venue：注册表 ≥3 个 + 中文单列，全部过 schema 校验且 sources 非空', () => {
  const venues = listVenues()
  assert.ok(venues.length >= 3, `注册表应 ≥3 个，实际 ${venues.length}`)
  assert.ok(venues.some(venue => venue.lang === 'zh'), '中文期刊单列')
  for (const venue of venues) {
    assert.ok(venue.sources.length > 0, `${venue.id} 必须留核对来源`)
    assert.equal(venue.confidence, 'unverified', '种子刊物一律未核定（只建议不阻断）')
  }
  assert.equal(getVenue('ieee-journal')?.documentClass, 'IEEEtran')
  assert.equal(getVenue('no-such'), undefined)
})

test('venue：schema 校验拒收缺 sources/坏 confidence/坏 columns', () => {
  const base = listVenues()[0] as unknown as Record<string, unknown>
  assert.throws(() => validateVenue({ ...base, sources: [] }), /sources/)
  assert.throws(() => validateVenue({ ...base, confidence: 'maybe' }), /confidence|非法/)
  assert.throws(() => validateVenue({ ...base, columns: 3 }), /columns|非法/)
  assert.throws(() => validateVenue({ ...base, depthTier: 'D4' }), /depthTier|非法/)
  // 正常数据可过
  assert.equal(validateVenue(base).id, base['id'])
})

test('depth：三档阈值单调递增；换档位 → 实验检查项集合变化', () => {
  assert.ok(DEPTH_PROFILES.D1.pages.max < DEPTH_PROFILES.D2.pages.min)
  assert.ok(DEPTH_PROFILES.D2.pages.max < DEPTH_PROFILES.D3.pages.min)
  // 文献数区间相邻可共点（0102 表：D2 40–60、D3 60–120）
  assert.ok(DEPTH_PROFILES.D1.references.max <= DEPTH_PROFILES.D2.references.min)
  assert.ok(DEPTH_PROFILES.D2.references.max <= DEPTH_PROFILES.D3.references.min)

  const d1 = experimentsChecklist('D1')
  const d3 = experimentsChecklist('D3')
  assert.ok(d1.some(item => item.includes('数据集 ≥ 1')))
  assert.ok(d3.some(item => item.includes('数据集 ≥ 3')))
  assert.ok(!d1.some(item => item.includes('显著性')), 'D1 不要求显著性检验')
  assert.ok(d3.some(item => item.includes('显著性')), 'D3 要求显著性检验')
  assert.deepEqual(DEPTH_PROFILES.D1.statements, [], 'D1 无必备声明')
  assert.ok(DEPTH_PROFILES.D3.statements.length >= 5, 'D3 声明最全')
})

test('compliance：同 facts 换档位 → 检查项集合与结论随之变化', () => {
  const venue = getVenue('ieee-journal')!
  const facts = {
    pages: 5,
    sections: ['Introduction', 'Method', 'Experiments', 'Conclusion'],
    figures: 3,
    tables: 1,
    referenceCount: 25,
    statementsPresent: [],
    hasAppendix: false,
  }
  const d1 = runCompliance({ venue, tier: 'D1', facts })
  const d3 = runCompliance({ venue, tier: 'D3', facts })
  const d1Pages = d1.find(item => item.id === 'pages')
  const d3Pages = d3.find(item => item.id === 'pages')
  assert.equal(d1Pages?.pass, true, '5 页合 D1（4–6）')
  assert.equal(d3Pages?.pass, false, '5 页不合 D3（12–20）')
  // 声明检查项集合：D1 无、D3 六项
  assert.equal(d1.filter(item => item.id.startsWith('statement.')).length, 0)
  assert.equal(d3.filter(item => item.id.startsWith('statement.')).length, DEPTH_PROFILES.D3.statements.length)
  // 附录：D3 允许，D1 不允许（有附录才报）
  assert.equal(d1.find(item => item.id === 'appendix'), undefined, 'D1 无附录不报')
  const d1WithAppendix = runCompliance({ venue, tier: 'D1', facts: { ...facts, hasAppendix: true } })
  assert.equal(d1WithAppendix.find(item => item.id === 'appendix')?.pass, false)
})

test('compliance：unverified 刊物只建议（warn），verified 才出 error', () => {
  const unverified = getVenue('ieee-journal')!
  const facts = {
    pages: 40,
    sections: [],
    figures: 0,
    tables: 0,
    referenceCount: 0,
    statementsPresent: [],
    hasAppendix: false,
  }
  const checks = runCompliance({ venue: unverified, tier: 'D2', facts })
  assert.ok(checks.every(item => item.level === 'warn'), '未核定刊物：全部 warn')
  const verified: typeof unverified = { ...unverified, confidence: 'verified' }
  const strict = runCompliance({ venue: verified, tier: 'D2', facts })
  assert.ok(strict.some(item => item.level === 'error'), '核定刊物：不过即 error')
  // 事实缺失（未编译）→ pass=undefined，只提示不判
  const pending = runCompliance({ venue: verified, tier: 'D2', facts: { ...facts, pages: undefined } })
  assert.equal(pending.find(item => item.id === 'pages')?.pass, undefined)
})

function fakeRun(available: ReadonlySet<string>): RunPort {
  return async (command, args) => {
    if (!available.has(command)) throw new Error(`spawn ${command} ENOENT`)
    return { stdout: `${command} ${args.join(' ')} version 1.0.0`, stderr: '' }
  }
}

test('engine：探测命中序 + 全缺不炸（ENGINE_MISSING 是数据不是异常）', async () => {
  const onlyXelatex = await probeEngines(fakeRun(new Set(['xelatex'])))
  assert.equal(onlyXelatex.engine, 'xelatex')
  assert.equal(onlyXelatex.probes.find(probe => probe.engine === 'tectonic')?.available, false)

  const none = await probeEngines(fakeRun(new Set()))
  assert.equal(none.engine, undefined)
  assert.equal(none.probes.length, ENGINE_ORDER.length)
  assert.ok(none.probes.every(probe => !probe.available), '四引擎全缺 → 引导安装，不抛')

  const all = await probeEngines(fakeRun(new Set(ENGINE_ORDER)))
  assert.equal(all.engine, 'tectonic', '按优先序取首个可用者')
})

test('engine：编译命令装配', () => {
  assert.deepEqual(compileCommand('tectonic', 'main.tex'), { command: 'tectonic', args: ['--outdir', 'build', 'main.tex'] })
  assert.equal(compileCommand('latexmk', 'main.tex').args.includes('-interaction=nonstopmode'), true)
  assert.equal(compileCommand('latexmk', 'main.tex').args.includes('-outdir=build'), true)
})
