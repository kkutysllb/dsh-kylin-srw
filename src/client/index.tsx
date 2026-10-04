/** Client 入口：侧边栏菜单项（`sidebar.panellist`）+ 独立主面板（`main`
 * keyed 槽）+ 设置区块（`settings.section`，M1 转正式）。M1 面板 = 工作台
 * 视图（项目头/列表/流水线/诊断折叠），诊断视图保留为折叠卡。
 * bundle 经 window.__ModuleLoader__.load 装载（CJS 模块表契约）。
 *
 * inject 名单纪律（vibe 0.2.0 实测：缺名会激活失败）：前 10 个是同族已验证
 * 名单；后 4 个是 E1 收口后**保留**的注入（右栏/预览/会话输入/uiSession
 * —— M2+ 文献预览与会话联动都要用，行为已在 E1 逐项实测）。
 */

import { useEffect, useState } from 'react'
import type { ClientContext } from './protocol-client.ts'
import { installStyles } from './styles.ts'
import { WorkbenchView } from './workbench.tsx'

export const name = 'dsh-kylin-srw'

export const inject = [
  'slots',
  'connection',
  'locale',
  'sessions',
  'uiWorkspace',
  'workspaces',
  'remote',
  'remote.session',
  'modelDirectories',
  'layout',
  // ── E1 专用临时注入（0201 Task 0.6；服务名均经 QiLin 源码/测试核对）──
  'sidebarRight',
  'documentPreviews',
  'uiSession',
  'conversation',
] as const

/** 面板 id：侧边栏入口与主面板共用。 */
const PANEL_ID = 'srw'

const NS = 'srw'

export function apply(ctx: ClientContext): void {
  const disposeStyles = installStyles()
  ctx.effect?.(() => disposeStyles, 'dsh-kylin-srw: styles')

  const locale = ctx.locale
  if (locale?.register !== undefined) {
    ctx.effect?.(
      () => locale.register(NS, { zh: { nav: '科研工作台' }, en: { nav: 'Research' } }),
      'dsh-kylin-srw: dictionaries',
    )
  }
  const navLabel = locale?.bind !== undefined ? (): string => locale.bind(NS)('nav') : '科研工作台'

  const slots = ctx.slots
  if (slots?.inject !== undefined) {
    try {
      slots.inject('sidebar.panellist', () => {
        const disposeIcon = slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 130,
          label: navLabel,
          locale: NS,
        }, PanelIcon)
        const disposePanel = slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
        }, function SrwMount(): React.ReactElement {
          return <WorkbenchView ctx={ctx} />
        })
        return () => { disposePanel(); disposeIcon() }
      })
    } catch (error) {
      console.warn('[dsh-kylin-srw] sidebar/main slot registration skipped:', error)
    }

    // 设置区块（M1 转正，E1 验证结论留档 docs/03-verify/E1）：`settings.section`
    // 是 body 级 portal 模态——主区被占也能打开。内容 = 总根摘要 + 选择按钮
    // （与面板同一条 root.set 通路）。
    try {
      slots.inject('settings.section', () => slots.register({
        name: 'settings.section',
        id: 'srw-settings',
        order: 900,
        label: '科研工作台',
      }, function SrwSettingsSection(): React.ReactElement {
        const [rootDir, setRootDir] = useState<string>('')
        const [busy, setBusy] = useState(false)
        const [error, setError] = useState<string | null>(null)
        useEffect(() => {
          let alive = true
          const load = async (): Promise<void> => {
            try {
              const rpc = ctx.connection?.rpc
              const call = rpc?.call
              if (call === undefined) return
              const raw = await call.call(rpc, '/dsh-kylin-srw', 'overview')
              const envelope = raw as { ok?: boolean; value?: { rootDir?: string } }
              if (alive && envelope?.ok === true) setRootDir(envelope.value?.rootDir ?? '')
            } catch { /* 设置页静默重试 */ }
          }
          void load()
          return () => { alive = false }
        }, [])
        const choose = async (): Promise<void> => {
          const picker = ctx.uiWorkspace?.pickDirectory
          if (picker === undefined) {
            setError('uiWorkspace.pickDirectory 不可达')
            return
          }
          try {
            setBusy(true)
            setError(null)
            const picked = await picker.call(ctx.uiWorkspace)
            if (picked === null || picked === '') return
            const rpc = ctx.connection?.rpc
            const call = rpc?.call
            if (call === undefined) throw new Error('connection.rpc.call 不可用')
            await call.call(rpc, '/dsh-kylin-srw', 'root.set', { path: picked })
            setRootDir(picked)
          } catch (cause) {
            setError(String(cause))
          } finally {
            setBusy(false)
          }
        }
        return (
          <div style={{ padding: '12px 4px', fontSize: 13, lineHeight: 1.7 }}>
            <strong>科研工作台</strong>
            <p style={{ margin: '6px 0' }}>
              科研总根：{rootDir === '' ? '未设置' : rootDir}
            </p>
            <button className='srw-btn' disabled={busy} onClick={() => { void choose() }}>
              {rootDir === '' ? '选择科研总根' : '更换科研总根'}
            </button>
            {error !== null ? <p style={{ margin: '6px 0 0', color: 'var(--srw-error, #c0392b)' }}>{error}</p> : null}
            <p style={{ margin: '10px 0 0', opacity: 0.75 }}>
              项目管理在侧边栏「科研工作台」面板中进行。
            </p>
          </div>
        )
      }))
    } catch (error) {
      console.warn('[dsh-kylin-srw] settings.section registration skipped:', error)
    }
  }
}

function PanelIcon(props: { size?: number }): React.ReactElement {
  const size = props.size ?? 18
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={1.9} strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      <path d='M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a1.6 1.6 0 0 0-1.6-1.6H5.5A1.5 1.5 0 0 1 4 15.9Z' />
      <path d='M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a1.6 1.6 0 0 1 1.6-1.6h4.9A1.5 1.5 0 0 0 20 15.9Z' />
      <path d='M7 8.5h2.5M7 11.5h2.5M14.5 8.5H17M14.5 11.5H17' />
    </svg>
  )
}
