#!/usr/bin/env node
/** 双通道发布面冒烟（0201 Task 0.5 / 执行约定 5）：同一份产物，两个通道。
 *
 * Stage 1（默认，全自动）：build → npm pack → 产物内容断言（files 白名单
 * 精确覆盖、无源码/无 node_modules 泄漏）→ 发布面契约断言（复用
 * smoke-plugin 的断言核心）。
 *
 * Stage 2（--install 显式开启）：把 tarball 装进两个真实 profile 并用
 * plugin list 探活。⚠ 会改用户 profile（可回滚：各通道 `plugin remove
 * dsh-kylin-srw`），默认不执行——日常开发用 `pnpm dev:install`（link:）。
 *
 * 宿主运行时探活（宿主日志出现 __ModuleLoader__.load / host apply 日志）
 * 需要引擎进程在跑：麒麟侧探活方式按 E2 结论固化（0102 §16.2）；在此之前
 * 本脚本对未验证部分输出 UNVERIFIED 行，不假绿。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runAssertions } from './smoke-plugin.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const qilinProfile = argOf('qilin-profile', 'p0vibe')
const dshProfile = argOf('dsh-profile', '')
const qilinRepo = argOf('qilin-repo', join(homedir(), 'kk_Projects', 'QiLin'))
const doInstall = process.argv.includes('--install')

function argOf(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback
}

let failures = 0
let unverified = 0
function check(label, condition, detail = '') {
  const mark = condition ? 'PASS' : 'FAIL'
  console.log(`\x1b[${condition ? 32 : 31}m${mark}\x1b[0m  ${label}${detail ? ' — ' + detail : ''}`)
  if (!condition) failures += 1
}
function unverifiedStep(label) {
  unverified += 1
  console.log(`\x1b[33mUNVERIFIED\x1b[0m  ${label}`)
}

function runCapture(label, command, args, cwd) {
  console.log(`\x1b[2m$ ${command} ${args.join(' ')}\x1b[0m  (${label})`)
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false })
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

async function main() {
  /* ── Stage 1a: build + pack ── */
  const build = runCapture('build', process.execPath, [join(repoRoot, 'scripts', 'build.mjs')], repoRoot)
  check('build 成功', build.ok, build.output.slice(-400))
  if (!build.ok) process.exit(1)

  const stageDir = mkdtempSync(join(tmpdir(), 'srw-dual-'))
  // --cache 指向本次临时目录：不能依赖用户级 ~/.npm——被沙箱/CI 限制写家目录时
  // npm 会以「sudo chown ~/.npm」这类与真实原因无关的文案失败（2026-10-09 实测）。
  const pack = runCapture('npm pack', 'npm',
    ['pack', '--pack-destination', stageDir, '--cache', join(stageDir, 'npm-cache')], repoRoot)
  const tarballs = existsSync(stageDir)
    ? readdirSync(stageDir).filter(name => name.startsWith('dsh-kylin-srw-') && name.endsWith('.tgz'))
    : []
  const tarball = tarballs[0] === undefined ? undefined : join(stageDir, tarballs[0])
  check('npm pack 产出 tarball', pack.ok && tarball !== undefined, tarball ?? pack.output.slice(-400))

  if (tarball === undefined) process.exit(1)

  /* ── Stage 1b: tarball 内容断言 ── */
  const listing = runCapture('tar -tzf', 'tar', ['-tzf', tarball], repoRoot)
  const entries = listing.output.split('\n')
  for (const required of [
    'package/package.json',
    'package/lib/index.js',
    'package/lib/client.js',
    'package/lib/types/index.d.ts',
    'package/cordis.patch.yml',
    'package/README.md',
    'package/LICENSE',
  ]) {
    check(`tarball 含 ${required}`, entries.some(entry => entry === required))
  }
  check('tarball 不含 node_modules', !entries.some(entry => entry.includes('node_modules/')))
  check('tarball 不含源码 src/', !entries.some(entry => entry.startsWith('package/src/')))
  check('tarball 不含 docs/', !entries.some(entry => entry.startsWith('package/docs/')))
  check('tarball 不含 .survey/', !entries.some(entry => entry.includes('.survey')))

  /* ── Stage 1c: 发布面契约（复用 smoke 断言核心，对 tarball 内的 manifest） ── */
  const manifest = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
  const yamlText = await readFile(join(repoRoot, 'cordis.patch.yml'), 'utf8')
  const hostSource = await readFile(join(repoRoot, 'lib/index.js'), 'utf8')
  const clientSource = await readFile(join(repoRoot, 'lib/client.js'), 'utf8')
  const contractFailures = runAssertions({ manifest, yamlText, hostSource, clientSource, packageRoot: repoRoot })
  for (const failure of contractFailures) {
    console.log(`\x1b[31mFAIL\x1b[0m  ${failure.label}${failure.detail ? ' — ' + failure.detail : ''}`)
  }
  check('发布面契约断言全绿', contractFailures.length === 0)

  /* ── Stage 2: 真实 profile 安装探活（--install 显式开启） ── */
  if (!doInstall) {
    unverifiedStep('DSH 桌面端真实安装探活（--install 开启；或日常用 pnpm dev:install）')
    unverifiedStep(`麒麟 web 端真实安装探活（--install 开启；启动 cd ${qilinRepo} && pnpm qilin --profile ${qilinProfile} --port 3090）`)
    unverifiedStep('宿主运行时探活：宿主日志出现 dsh-kylin-srw 的 __ModuleLoader__.load 与 host apply（按 E2 结论固化自动探活）')
  } else {
    const dshArgs = dshProfile === '' ? [] : ['--profile', dshProfile]
    const dshInstall = runCapture('dsh add file', 'dsh', ['plugin', ...dshArgs, 'add', `file:${tarball}`], repoRoot)
    const dshList = dshInstall.ok ? runCapture('dsh list', 'dsh', ['plugin', ...dshArgs, 'list'], repoRoot) : { output: '' }
    check('DSH 通道安装 + list 探活', dshInstall.ok && dshList.output.includes('dsh-kylin-srw'), dshList.output.slice(-300))

    const qilinInstall = existsSync(qilinRepo)
      ? runCapture('qilin add file', 'pnpm', ['qilin', 'plugin', '--profile', qilinProfile, 'add', `file:${tarball}`], qilinRepo)
      : { ok: false, output: `QiLin 仓不存在：${qilinRepo}` }
    const qilinList = qilinInstall.ok
      ? runCapture('qilin list', 'pnpm', ['qilin', 'plugin', '--profile', qilinProfile, 'list'], qilinRepo)
      : { output: '' }
    check('麒麟通道安装 + list 探活', qilinInstall.ok && qilinList.output.includes('dsh-kylin-srw'), qilinList.output.slice(-300))
    unverifiedStep('两通道面板实开探活（启动引擎后人工确认；自动化按 E2 结论补）')
  }

  rmSync(stageDir, { recursive: true, force: true })

  console.log(`
dsh-kylin-srw smoke:dual: ${failures === 0 ? '\x1b[32mSTAGE GREEN\x1b[0m' : `\x1b[31m${failures} FAILURES\x1b[0m`}${unverified > 0 ? ` · ${unverified} 项 UNVERIFIED（运行时探活待 E2/实机）` : ''}`)
  process.exit(failures === 0 ? 0 : 1)
}

await main()
