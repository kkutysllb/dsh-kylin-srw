/** Client 入口：侧边栏菜单项（`sidebar.panellist`）+ 独立主面板（`main`
 * keyed 槽）+ E1 验证用的 `settings.section` 区块。M0 面板 = 诊断视图。
 * bundle 经 window.__ModuleLoader__.load 装载（CJS 模块表契约）。
 *
 * inject 名单纪律（vibe 0.2.0 实测：缺名会激活失败）：前 10 个是同族已验证
 * 名单；后 4 个是 **E1 专用临时注入**（2026-10-04）——主区被占时右栏/预览/
 * 会话输入的真实行为必须注入才能逐项实测，E1 收口后按结论保留或撤。
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
          return <DiagView ctx={ctx} />
        })
        return () => { disposePanel(); disposeIcon() }
      })
    } catch (error) {
      console.warn('[dsh-kylin-srw] sidebar/main slot registration skipped:', error)
    }

    // E1 第 10 项载体：`settings.section` 是 body 级 portal 模态——主区被占
    // 时从外壳打开设置页，能看到本区块即证实 0102 §9.1 的预期。验证期注册，
    // M1 转正式设置页（ctx.settings.register + 自绘 section）。
    try {
      slots.inject('settings.section', () => slots.register({
        name: 'settings.section',
        id: 'srw-e1',
        order: 9999,
        label: '科研工作台（E1 验证）',
      }, function SrwE1SettingsSection(): React.ReactElement {
        return (
          <div style={{ padding: '12px 4px', fontSize: 13, lineHeight: 1.7 }}>
            <strong>科研工作台 · E1 验证区块</strong>
            <p style={{ margin: '6px 0 0' }}>
              当前主区被「科研工作台」面板占用。能看到本区块 = 证实
              settings.section 是 body 级 portal 模态（主区被占也能打开），
              0102 §9.1 第 10 项通过。
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
