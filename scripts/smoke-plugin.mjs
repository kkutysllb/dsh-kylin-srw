#!/usr/bin/env node
/**
 * dsh-kylin-srw 插件冒烟测试（零依赖，node scripts/smoke-plugin.mjs）。
 *
 * 覆盖发布面契约（0201 Task 0.3 的 16 条 + 同族 automation 的经验断言）：
 * 1. package.json：dsh/qilin 双键逐字一致、bundle.patch 为单 string、
 *    exports、files 白名单覆盖检查、peerDependencies 全 `*`、
 *    dependencies 不含引擎包（QiLin EngineNameCollisionError）；
 * 2. cordis.patch.yml：可解析、单行 insert、row id/name 与包名一致；
 * 3. host bundle（lib/index.js）：ESM、零 `@deepseek-ai/*` 运行时导入
 *    （KCoder 打包运行时不向插件提供框架模块）、导出 apply/inject/name；
 * 4. client bundle（lib/client.js）：`window.__ModuleLoader__.load` 自注册
 *    协议、无裸 ESM export、require('react') 走静态模块表、require 目标
 *    只有浏览器静态模块表的 9 个词（0102 §5.2 第 3 条）；
 * 5. 声明产物 lib/types/index.d.ts。
 *
 * `--negatives`：四条负例自检（每条必须让断言变红，证明断言不是摆设）——
 * 在内存中对产物/清单做临时变异后复跑断言核心，不动仓库文件。
 *   ① host 产物注入真实引擎 import   ② bundle.patch 改数组
 *   ③ peer 值改 ^0.2.0              ④ client 产物 require 清单外语义包
 */
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = dirname(fileURLToPath(import.meta.url)) + '/..'

/** 浏览器侧静态模块表：client bundle 的 require 目标白名单（0102 §5.2 #3，
 * ✅ QiLin packages/client/web/src/seed.ts:29-38 + dsh-compat aliases）。 */
const CLIENT_REQUIRE_ALLOWLIST = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

/** 断言核心：对给定材料返回失败清单（id + 说明）。main 模式期望为空，
 * negatives 模式期望包含指定 id。 */
export function runAssertions({ manifest, yamlText, hostSource, clientSource, packageRoot: root }) {
  const failures = []

  function check(id, label, condition, detail = '') {
    if (!condition) failures.push({ id, label, detail })
  }

  /* ═══ 1. manifest ═══ */

  check('name', `name 形如 dsh-kylin-srw`, manifest.name === 'dsh-kylin-srw')
  check('version', 'version 为合法 semver', /^\d+\.\d+\.\d+$/.test(manifest.version ?? ''), manifest.version)
  check('type-module', 'type = module（宿主 ESM 装载）', manifest.type === 'module')
  check('dual-keys-identical', 'dsh / qilin 两键内容逐字一致',
    JSON.stringify(manifest.dsh ?? null) === JSON.stringify(manifest.qilin ?? null),
    '只写 qilin 键会让 DSH 静默不挂载（0102 §5.1）')
  check('patch-is-string', 'dsh.bundle.patch 是单个 string（麒麟 bundlePatchOf 只认 string）',
    typeof manifest.dsh?.bundle?.patch === 'string' && manifest.dsh.bundle.patch === './cordis.patch.yml',
    `got ${JSON.stringify(manifest.dsh?.bundle?.patch)}`)
  check('platform-web', 'dsh.client.platform = web', manifest.dsh?.client?.platform === 'web')
  check('client-inject-list', 'dsh.client.inject 非空字符串数组',
    Array.isArray(manifest.dsh?.client?.inject)
    && manifest.dsh.client.inject.length > 0
    && manifest.dsh.client.inject.every(x => typeof x === 'string'),
    `${manifest.dsh?.client?.inject?.length ?? 0} rows`)
  check('exports-main', 'exports["."] 指向 lib/index.js', manifest.exports?.['.']?.default === './lib/index.js')
  check('exports-client', 'exports["./client"] 声明 client bundle',
    typeof manifest.exports?.['./client'] === 'string' || typeof manifest.exports?.['./client']?.default === 'string')

  const filesListed = manifest.files ?? []
  for (const entry of filesListed) {
    check('files-exist', `files 白名单存在: ${entry}`, existsSync(join(root, entry)))
  }
  check('files-patch', 'files 覆盖 cordis.patch.yml', filesListed.includes('cordis.patch.yml'))
  check('files-lib', 'files 覆盖 lib 产物目录', filesListed.includes('lib'))

  /* peer / deps 纪律（0102 §5.1） */

  const peers = manifest.peerDependencies ?? {}
  const badPeers = Object.entries(peers).filter(([, v]) => v !== '*')
  check('peer-all-star', 'peerDependencies 全部为 `*`（^range 会被 0.2.0-rc.2 拒）',
    Object.keys(peers).length > 0 && badPeers.length === 0,
    badPeers.map(([k, v]) => `${k}:${v}`).join(', '))
  const engineDeps = Object.keys(manifest.dependencies ?? {})
    .filter(name => name.startsWith('@deepseek-ai/') || name.startsWith('@qilin/'))
  check('deps-no-engine', 'dependencies 不含引擎包（QiLin EngineNameCollisionError 拒整 profile）',
    engineDeps.length === 0, engineDeps.join(', '))

  /* ═══ 2. cordis.patch.yml ═══ */

  check('patch-insert', 'patch 含 insert 行', /- insert:/.test(yamlText))
  check('patch-id', `patch row id = ${manifest.name}`, yamlText.includes(`id: ${manifest.name}`))
  check('patch-name', `patch row name = ${manifest.name}`,
    yamlText.includes(`name: ${manifest.name}`) || yamlText.includes(`name: '${manifest.name}'`))

  /* ═══ 3. host bundle ═══ */

  check('host-exists', 'lib/index.js 存在', typeof hostSource === 'string')
  if (typeof hostSource === 'string') {
    check('host-no-engine-import', 'host bundle 无 @deepseek-ai/* 运行时导入（KCoder 部署约束）',
      !/from\s*["']@deepseek-ai\//.test(hostSource) && !/import\s*\(\s*["']@deepseek-ai\//.test(hostSource)
      && !/require\(\s*["']@deepseek-ai\//.test(hostSource),
      '框架能力经 inject 服务名接入，不 import @deepseek-ai/*')
    check('host-exports-apply', 'host bundle 导出 apply', /\bapply\b/.test(hostSource))
    check('host-exports-name', 'host bundle 导出包名 name', hostSource.includes(manifest.name))
    check('host-inject-names', 'host bundle 声明 inject 服务名（connection/webServer）',
      hostSource.includes('connection') && hostSource.includes('webServer'))
  }

  /* ═══ 4. client bundle ═══ */

  check('client-exists', 'lib/client.js 存在', typeof clientSource === 'string')
  if (typeof clientSource === 'string') {
    check('client-loader', 'client bundle 走 __ModuleLoader__ 自注册协议',
      clientSource.trimStart().startsWith('window.__ModuleLoader__.load('),
      'dsh client module-table 契约')
    check('client-no-bare-export', 'client bundle 无裸 ESM export 语句', !/^export /m.test(clientSource))
    check('client-react-require', "client bundle 以 require(\"react\") 引 React",
      clientSource.includes('require("react")') || clientSource.includes("require('react')"))
    check('client-id', 'client bundle 注册 id 与包名一致', clientSource.includes(`id: ${JSON.stringify(manifest.name)}`))
    check('client-slots', 'client bundle 注册 sidebar.panellist + main 双槽',
      clientSource.includes('sidebar.panellist') && (clientSource.includes('"main"') || clientSource.includes("'main'")))

    const required = [...clientSource.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map(m => m[1])
    const foreign = [...new Set(required.filter(name => !CLIENT_REQUIRE_ALLOWLIST.has(name)))]
    check('client-require-allowlist', 'client bundle require 目标只在浏览器静态模块表 9 词内',
      foreign.length === 0, foreign.join(', '))
  }

  /* ═══ 5. 声明产物 ═══ */

  check('types-exist', 'lib/types/index.d.ts 存在（types 导出）', existsSync(join(root, 'lib/types/index.d.ts')))
  if (typeof clientSource === 'string') {
    check('client-sourcemap', 'client bundle 带 sourcemap 引用（HMR 对账用）',
      clientSource.includes('sourceMappingURL'))
  }

  /* ═══ 6. 产物尺寸下限（防空壳产物）═══ */

  for (const [id, label, path, minKb] of [
    ['host-size', 'host bundle', 'lib/index.js', 1],
    ['client-size', 'client bundle', 'lib/client.js', 4],
  ]) {
    const full = join(root, path)
    if (existsSync(full)) {
      const size = statSync(full).size
      check(id, `${label} 非空壳（≥ ${minKb}KB）：${Math.round(size / 1024)}KB`, size >= minKb * 1024)
    }
  }

  return failures
}

/* ═══════════════════════════ negatives ═══════════════════════════ */

function mutateHostSource(source) {
  // 负例①：真实引擎运行时 import（非 type 导入）
  return `${source}\nimport { x } from "@deepseek-ai/dsh-tools";\n`
}

function mutatePatchToArray(manifest) {
  // 负例②：bundle.patch 用数组形态（麒麟 bundlePatchOf 只认 string）
  return {
    ...manifest,
    dsh: { ...manifest.dsh, bundle: { patch: ['./cordis.patch.yml'] } },
    qilin: { ...manifest.qilin, bundle: { patch: ['./cordis.patch.yml'] } },
  }
}

function mutatePeerRange(manifest) {
  // 负例③：peer 值写 ^range（会被 0.2.0-rc.2 prerelease 拒）
  return {
    ...manifest,
    peerDependencies: { ...manifest.peerDependencies, '@deepseek-ai/dsh-tools': '^0.2.0' },
  }
}

function mutateClientSource(source) {
  // 负例④：require 清单外语义包（浏览器静态模块表没有，运行时必炸）
  return `${source}\nrequire("@deepseek-ai/dsh-coding-sidebar");\n`
}

const NEGATIVES = [
  { id: 'host-no-engine-import', label: '① host 注入真实引擎 import 必须红', apply: ({ hostSource }) => ({ hostSource: mutateHostSource(hostSource) }), expect: 'host-no-engine-import' },
  { id: 'patch-is-string', label: '② bundle.patch 改数组必须红', apply: ({ manifest }) => ({ manifest: mutatePatchToArray(manifest) }), expect: 'patch-is-string' },
  { id: 'peer-all-star', label: '③ peer 值改 ^0.2.0 必须红', apply: ({ manifest }) => ({ manifest: mutatePeerRange(manifest) }), expect: 'peer-all-star' },
  { id: 'client-require-allowlist', label: '④ client require 清单外包必须红', apply: ({ clientSource }) => ({ clientSource: mutateClientSource(clientSource) }), expect: 'client-require-allowlist' },
]

async function main() {
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  const yamlText = await readFile(join(packageRoot, 'cordis.patch.yml'), 'utf8')
  const hostPath = join(packageRoot, 'lib/index.js')
  const clientPath = join(packageRoot, 'lib/client.js')
  const hostSource = existsSync(hostPath) ? await readFile(hostPath, 'utf8') : undefined
  const clientSource = existsSync(clientPath) ? await readFile(clientPath, 'utf8') : undefined

  if (process.argv.includes('--negatives')) {
    let failures = 0
    for (const negative of NEGATIVES) {
      const base = { manifest, yamlText, hostSource, clientSource, packageRoot }
      const mutated = negative.apply(base)
      const found = runAssertions({ ...base, ...mutated }).some(f => f.id === negative.expect)
      console.log(`${found ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${negative.label}`)
      if (!found) failures += 1
    }
    console.log(failures === 0 ? '\nnegatives: ALL RED AS EXPECTED' : `\nnegatives: ${failures} NOT RED`)
    process.exit(failures === 0 ? 0 : 1)
  }

  const failures = runAssertions({ manifest, yamlText, hostSource, clientSource, packageRoot })
  for (const failure of failures) {
    console.log(`\x1b[31mFAIL\x1b[0m  ${failure.label}${failure.detail ? ' — ' + failure.detail : ''}`)
  }
  const summary = failures.length === 0
    ? `\n${manifest.name}@${manifest.version} smoke: ALL PASS`
    : `\n${manifest.name}@${manifest.version} smoke: ${failures.length} FAILURES`
  console.log(summary)
  process.exit(failures.length === 0 ? 0 : 1)
}

// 只在直接执行时跑 main（smoke-dual-host.mjs 会 import 本文件的断言核心；
// 顶层副作用曾让 import 方先跑完整 smoke 并 exit，见双通道冒烟的教训）。
const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) await main()
