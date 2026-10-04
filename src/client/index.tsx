/** Client 入口：侧边栏菜单项（`sidebar.panellist`）+ 独立主面板（`main`
 * keyed 槽）。M0 面板 = 诊断视图：能力探测表 + panelInfo 快照 + E1 探测
 * 按钮（Task 0.4/0.6 的载体）。bundle 经 window.__ModuleLoader__.load
 * 装载（CJS 模块表契约）。
 *
 * inject 名单纪律（vibe 0.2.0 实测：缺名会激活失败）：M0 只放同族已验证
 * 的 10 个服务名；sidebarRight/documentPreviews/settings 等候选面**不进**
 * 名单，诊断面软探测并如实报告「未注入」——E1 结论后才扩名单。
 */

import type { ClientContext } from './protocol-client.ts'
import { installStyles } from './styles.ts'
import { DiagView } from './view.tsx'

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
          return <DiagView ctx={ctx} />
        })
        return () => { disposePanel(); disposeIcon() }
      })
    } catch (error) {
      console.warn('[dsh-kylin-srw] sidebar/main slot registration skipped:', error)
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
