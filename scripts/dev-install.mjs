#!/usr/bin/env node
/** 本地开发安装（0201 Task 0.5）：把本包以 `link:` 方式装进两个引擎通道。
 *
 * 引擎对接口径（2026-10-04）：
 * - 麒麟 = 本机 **web 端**（源码仓启动，profile 默认 `p0vibe`）
 * - DSH  = 本机 **桌面端**（默认 profile；如需隔离用 --dsh-profile）
 *
 * ⚠ E2 未做前的一个已知未知：`link:` 是否被自动记进
 * `qilin.profile.bundles`——脚本在安装后打印核对命令；若未记账，手改
 * profile 的 package.json 兜底（结论将在 E2 记录后固化为自动处理）。
 * 提醒：client 产物半可热换（宿主 500ms stat 轮询），host 侧变更需重启。
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function argOf(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback
}

const qilinProfile = argOf('qilin-profile', 'p0vibe')
// DSH 桌面端在用 desktop profile（本机实测 ~/.dsh/profiles/{desktop,web}）。
const dshProfile = argOf('dsh-profile', 'desktop')
const qilinRepo = argOf('qilin-repo', join(homedir(), 'kk_Projects', 'QiLin'))
const skipBuild = process.argv.includes('--skip-build')

function run(label, command, args, options = {}) {
  console.log(`\x1b[2m$ ${command} ${args.join(' ')}\x1b[0m  (${label})`)
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...(options.env ?? {}) },
  })
  return result.status === 0
}

async function main() {
  if (!skipBuild) {
    if (!run('build', process.execPath, [join(repoRoot, 'scripts', 'build.mjs')])) {
      console.error('\n✗ build 失败，中止安装')
      process.exit(1)
    }
  }

  const linkPath = `link:${repoRoot}`
  let failures = 0

  /* ── 麒麟通道（web 端） ── */
  console.log(`\n═══ 麒麟通道（web 端，profile ${qilinProfile}） ═══`)
  if (!existsSync(qilinRepo)) {
    console.warn(`⚠ 未找到 QiLin 源码仓 ${qilinRepo}（--qilin-repo 可指定），跳过`)
    failures += 1
  } else {
    const okAdd = run('qilin add', 'pnpm', ['qilin', 'plugin', '--profile', qilinProfile, 'add', linkPath], { cwd: qilinRepo })
    if (okAdd) {
      run('qilin list', 'pnpm', ['qilin', 'plugin', '--profile', qilinProfile, 'list'], { cwd: qilinRepo })
      console.log(`→ E2 核对项：profile 里是否出现 "link:" 记账（cat ~/.qilin/profiles/${qilinProfile}/package.json）`)
      console.log(`→ 启动 web 端：cd ${qilinRepo} && pnpm qilin --profile ${qilinProfile} --port 3090（用打印出的带 token 地址打开）`)
    } else {
      console.error('✗ qilin plugin add 失败（确认 pnpm qilin 可用与 profile 名）')
      failures += 1
    }
  }

  /* ── DSH 通道（桌面端） ── */
  console.log('\n═══ DSH 通道（桌面端） ═══')
  const dshArgs = ['plugin', '--profile', dshProfile]
  const dshLabel = `（profile ${dshProfile}）`
  const dshCheck = spawnSync('dsh', ['--version'], { stdio: 'ignore', shell: false })
  if (dshCheck.error !== undefined || dshCheck.status !== 0) {
    console.warn('⚠ 未找到 dsh CLI（PATH 中无 dsh），跳过 DSH 通道安装')
    failures += 1
  } else {
    const probe = spawnSync('dsh', ['plugin', '--profile', dshProfile, 'add', linkPath], {
      cwd: repoRoot, encoding: 'utf8', shell: false,
    })
    const refused = (probe.stderr ?? '').includes('managed exclusively by the Electron application')
    if (probe.status === 0) {
      console.log(`✓ dsh plugin add 成功 ${dshLabel}`)
    } else if (refused) {
      // E2 实测事实（2026-10-04）：desktop profile 由 Electron 应用独占管理，
      // CLI add 被拒 → 手改 profile package.json 记 link: 依赖（先备份）。
      console.log(`⚠ profile ${dshProfile} 由 Electron 应用独占管理，CLI add 被拒 → 手改记账`)
      const handEdit = spawnSync('python3', ['-c', `
import json, sys, shutil, time
path = ${JSON.stringify(join(homedir(), '.dsh', 'profiles', dshProfile, 'package.json'))}
shutil.copy(path, path + '.bak-srw-' + str(int(time.time())))
with open(path) as f: d = json.load(f)
d.setdefault('dependencies', {})['dsh-kylin-srw'] = ${JSON.stringify(linkPath)}
with open(path, 'w') as f: json.dump(d, f, indent=2, ensure_ascii=False)
print('✓ 已记账（含备份 .bak-srw-*）:', d['dependencies']['dsh-kylin-srw'])
`], { encoding: 'utf8', shell: false })
      console.log(handEdit.stdout ?? handEdit.stderr)
      if (handEdit.status !== 0) failures += 1
      console.log('→ 重启 DSH 桌面端生效（host 变更必须完全退出重启）')
    } else {
      console.error(`✗ dsh plugin add 失败：${(probe.stderr ?? probe.stdout ?? '').slice(-300)}`)
      failures += 1
    }
  }

  console.log(`
═══ 完成后的验证步骤（E1 载体） ═══
1. 两个通道侧栏应出现「科研工作台」，点开 = M0 诊断面板；
2. 面板首屏即能力探测表（diag.caps）：红点 = 缺席服务，正是 E1/E2 要记录的数据；
3. E1 按钮（panelInfo / 试开文档查看器 / 送草稿…）逐个点，结果落日志区，
   截图或复制进 docs/03-verify/E1-*.md；
4. host 侧代码变更后需重启引擎进程；client 产物变更约 500ms 热换。`)
  process.exit(failures === 0 ? 0 : 1)
}

await main()
