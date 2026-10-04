/** 路径安全门（`test:security`）：assertInsideRoot 护栏的全部负例与
 * fail-closed 语义。从 host.test.ts 拆出（0202 Task 1.2），独立成命名门——
 * `pnpm check` 经 `test`（tests/*.test.ts glob）覆盖同一组，此脚本供
 * 单独重跑安全面。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, rm, symlink, writeFile, realpath } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve as nodeResolve } from 'node:path'
import { assertInsideRoot, PathSafetyError, type SrwFsLike } from '../src/host.ts'

/** canonical 语义 fake（与 ctx.fs 真实契约同形：resolve 产目标对象，
 * contains 收两目标，processPath 还原可打开路径）。expandTildeHome 模拟
 * 宿主 resolve 的 ~ 展开（作为路径前缀与 cwd 两种形态）。 */
function canonicalFake(expandTildeHome?: string): SrwFsLike & { processPath(t: unknown): string } {
  const expand = (rel: string): string | undefined => {
    if (expandTildeHome === undefined) return undefined
    if (rel === '~') return expandTildeHome
    if (rel.startsWith('~/')) return nodeResolve(expandTildeHome, rel.slice(2))
    return undefined
  }
  const resolveKey = (rel: string, cwd?: string): string => {
    const expanded = expand(rel)
    if (expanded !== undefined) return expanded
    const base = cwd === undefined ? process.cwd() : (expand(cwd) ?? cwd)
    return nodeResolve(base, rel)
  }
  return {
    resolve: (rel: string, opts?: { cwd?: string }) => ({ key: resolveKey(rel, opts?.cwd) }),
    contains: (parent: unknown, child: unknown) => {
      const p = nodeResolve((parent as { key: string }).key)
      const c = nodeResolve((child as { key: string }).key)
      return c === p || c.startsWith(`${p}/`)
    },
    processPath: (target: unknown) => (target as { key: string }).key,
  }
}

test('security：包含放行，../ 与绝对注入拒绝，能力缺失 fail-closed', async () => {
  const fs = canonicalFake()
  assert.equal(await assertInsideRoot(fs, '/root', 'a/b.txt'), '/root/a/b.txt')
  await assert.rejects(() => assertInsideRoot(fs, '/root', '../escape.txt'), PathSafetyError)
  await assert.rejects(() => assertInsideRoot(fs, '/root', '/etc/passwd'), PathSafetyError)
  // resolve 结果逃出 root（符号链接落点在外；root 自身仍在 root 内）
  const symlinkFs: SrwFsLike = {
    resolve: (rel: string) => ({ key: rel === '/root' ? '/root' : '/outside/x' }),
    contains: (parent: unknown, child: unknown) =>
      (child as { key: string }).key.startsWith((parent as { key: string }).key),
  }
  await assert.rejects(() => assertInsideRoot(symlinkFs, '/root', 'link'), PathSafetyError)
  // fail-closed：resolve/contains 任一缺席都必须拒绝，而不是放行
  await assert.rejects(() => assertInsideRoot(undefined, '/root', 'a.txt'), PathSafetyError)
  await assert.rejects(() => assertInsideRoot({}, '/root', 'a.txt'), PathSafetyError)
  await assert.rejects(() => assertInsideRoot({ contains: () => true }, '/root', 'a.txt'), PathSafetyError)
})

test('security：`~` 展开注入——宿主把 ~/x 解析到 home 时护栏按 canonical 判定', async () => {
  // 真实宿主 fs 的 resolve 可能展开 ~；护栏不做字符串假设，交给
  // contains 在 canonical 落点上判定：~/secret 落在 home → 不在 /root 内 → 拒绝。
  const fs = canonicalFake('/Users/researcher')
  await assert.rejects(() => assertInsideRoot(fs, '/root', '~/secret'), PathSafetyError)
  // root 本身写成 ~（未展开的 rootDir）也按同一口径工作：~ 展开后域正确
  const homeRoot = await assertInsideRoot(fs, '~', 'notes.txt')
  assert.equal(homeRoot, '/Users/researcher/notes.txt')
  await assert.rejects(() => assertInsideRoot(fs, '~', '../escape'), PathSafetyError)
})

test('security：真实 node:fs 符号链接负例（tmp 沙箱）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'srw-security-'))
  try {
    const root = join(dir, 'root')
    await mkdir(join(root, 'sub'), { recursive: true })
    await writeFile(join(root, 'sub', 'file.txt'), 'ok')
    // link → 沙箱内另一个目录（外于 root）；escape → 沙箱外
    await mkdir(join(dir, 'sibling'), { recursive: true })
    await symlink(join(dir, 'sibling'), join(root, 'link-in'))
    await symlink(dir, join(root, 'link-out'))
    // 真实 fs 适配器：realpath 跟随符号链接（canonical 语义）
    const realFs: SrwFsLike = {
      resolve: async (rel: string, opts?: { cwd?: string }) => ({
        key: await realpath(nodeResolve(opts?.cwd ?? process.cwd(), rel)),
      }),
      contains: (parent: unknown, child: unknown) => {
        const p = (parent as { key: string }).key
        const c = (child as { key: string }).key
        return c === p || c.startsWith(`${p}/`)
      },
      processPath: (target: unknown) => (target as { key: string }).key,
    }
    // 普通相对路径放行
    assert.equal(await assertInsideRoot(realFs, root, 'sub/file.txt'), join(realpathSync(root), 'sub/file.txt'))
    // 指向沙箱外的符号链接拒绝（realpath 落点在外）；不存在的落点也必须
    // 报错而非静默放行（ENOENT 形态，fail-closed 的另一半）
    await assert.rejects(() => assertInsideRoot(realFs, root, 'link-out'), PathSafetyError)
    await assert.rejects(() => assertInsideRoot(realFs, root, 'link-out/child.txt'), /ENOENT|越界/)
    // 指向 root 外但同沙箱的符号链接同样拒绝（root 域，不是沙箱域）
    await assert.rejects(() => assertInsideRoot(realFs, root, 'link-in'), PathSafetyError)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
