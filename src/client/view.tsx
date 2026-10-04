/** M0 诊断视图：宿主能力表（RPC `diag.caps`）+ 客户端服务表 + panelInfo
 * 快照 + E1 探测按钮。所有探测结果进滚动日志，作为 E1/E2 记录的原始证据。
 * 每个按钮都是「期望先写好」的实验步骤（见 0201 Task 0.6），失败/缺席
 * 都是有效数据，绝不静默。
 *
 * E1 专用注入（sidebarRight/documentPreviews/uiSession/conversation）生效后，
 * 按钮发的是 QiLin 源码核对过的真实调用：
 * - `openResource(address)` / `openResourceIn(sessionId, address)`（ui-sidebar-right service.ts:210/347）
 * - `documentPreviews.register({id, extensions, title, loading})`（registry.ts:9-27）
 * - `conversation.input.for(binding.ctx).setDraft/submit`（0102 §9.3 路径 A）
 * - `uiSession.adapter.current.getSnapshot().key`（ui-session index.ts:299）
 */

import { useCallback, useEffect, useState } from 'react'
import type { ClientContext } from './protocol-client.ts'

interface CapsRow {
  readonly name: string
  readonly available: boolean
  readonly detail: string
}

interface LogEntry {
  readonly at: string
  readonly kind: 'ok' | 'bad' | 'info'
  readonly text: string
}

const RPC_CHANNEL = '/dsh-kylin-srw'

/** 注入面（14：已验证 10 + E1 临时 4）+ 仍未注入的候选（settings 等）。 */
const CLIENT_PATHS: readonly string[] = [
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
  'sidebarRight',
  'documentPreviews',
  'uiSession',
  'conversation',
  'settings',
]

function safeGet(ctx: ClientContext, path: string): { present: boolean; detail: string } {
  let current: unknown = ctx
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return { present: false, detail: 'absent' }
    try {
      current = (current as Record<string, unknown>)[part]
    } catch (error: unknown) {
      return { present: false, detail: `threw: ${String(error)}` }
    }
    if (current === undefined) return { present: false, detail: '未注入' }
  }
  return { present: current !== undefined, detail: typeof current }
}

async function callRpc(ctx: ClientContext, endpoint: string, payload?: unknown): Promise<unknown> {
  const rpc = ctx.connection?.rpc
  const call = rpc?.call
  if (call === undefined) throw new Error('connection.rpc.call 不可用（connection 未注入或缺 rpc 面）')
  const raw = await call.call(rpc, RPC_CHANNEL, endpoint, payload)
  const envelope = raw as { ok?: boolean; value?: unknown; error?: { code: string; message: string } }
  if (envelope !== null && typeof envelope === 'object' && envelope.ok === true) return envelope.value
  const message = envelope !== null && typeof envelope === 'object' && envelope.error !== undefined
    ? `${String(envelope.error.code)}: ${String(envelope.error.message)}`
    : String(raw)
  throw new Error(message)
}

function fmt(value: unknown, max = 220): string {
  let text: string
  try {
    text = JSON.stringify(value) ?? String(value)
  } catch {
    text = String(value)
  }
  return text.length > max ? `${text.slice(0, max)}…` : text
}

type AnyFn = (...args: unknown[]) => unknown

export function DiagView({ ctx, embedded = false }: { readonly ctx: ClientContext; readonly embedded?: boolean }): React.ReactElement {
  const [hostCaps, setHostCaps] = useState<readonly CapsRow[] | null>(null)
  const [info, setInfo] = useState<Record<string, unknown> | null>(null)
  const [rpcError, setRpcError] = useState<string | null>(null)
  const [log, setLog] = useState<readonly LogEntry[]>([])
  const [sessionId, setSessionId] = useState('')
  const [busy, setBusy] = useState(false)
  const [containsRoot, setContainsRoot] = useState('')
  const [containsTarget, setContainsTarget] = useState('')

  const pushLog = useCallback((kind: LogEntry['kind'], text: string): void => {
    setLog(previous => [{ at: new Date().toLocaleTimeString(), kind, text }, ...previous].slice(0, 80))
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const value = await callRpc(ctx, 'diag.caps') as { caps?: readonly CapsRow[]; info?: Record<string, unknown> }
      setHostCaps(value.caps ?? [])
      setInfo(value.info ?? null)
      setRpcError(null)
      pushLog('ok', `diag.caps OK（${(value.caps ?? []).length} 行）`)
    } catch (error: unknown) {
      setRpcError(String(error))
      pushLog('bad', `diag.caps 失败：${String(error)}`)
    } finally {
      setBusy(false)
    }
  }, [ctx, pushLog])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    const current = ctx.sessions?.list?.getSnapshot?.().current
    if (typeof current === 'string' && current !== '') setSessionId(current)
  }, [ctx])

  /* ── E1 第 1 项：panelInfo ── */
  const probePanelInfo = useCallback((): void => {
    const snapshot = ctx.layout?.panelInfo?.getSnapshot?.()
    pushLog(snapshot !== undefined ? 'ok' : 'bad', `layout.panelInfo = ${fmt(snapshot)}`)
  }, [ctx, pushLog])

  /* ── E1 第 2/3 项：右栏写路径（主区被占时预期响亮抛错）── */
  const tryOpenViewer = useCallback((deferred: boolean): void => {
    const sidebarRight = ctx.sidebarRight
    // 合法资源地址：qilin-resource://file/session/<sid>/<path>（ui-chat apply.ts:185 同款；
    // 工作区外绝对路径原样拼。裸路径会抛 no registered tab type claims）。
    const address = `qilin-resource://file/session/${sessionId.trim() || '<sid>'}/Users/libing/kk_Projects/dsh-kylin-srw/README.md`
    if (deferred === true) {
      const openIn = sidebarRight?.openResourceIn
      if (openIn === undefined) {
        pushLog('bad', 'ctx.sidebarRight.openResourceIn 不可达（E1 注入未生效？重启宿主后重试）')
        return
      }
      const sid = sessionId.trim()
      if (sid === '') {
        pushLog('bad', '试延迟打开需要 sessionId（先在引擎里开一个会话再填输入框）')
        return
      }
      try {
        openIn.call(sidebarRight, sid, address)
        pushLog('ok', `openResourceIn('${sid}', '${address}') 未抛错（预期只写不画——切回对话页看 tab 是否出现，出现=第 3 项通过）`)
      } catch (error: unknown) {
        pushLog('bad', `openResourceIn 抛错：${String(error)}`)
      }
      return
    }
    const open = sidebarRight?.openResource
    if (open === undefined) {
      pushLog('bad', 'ctx.sidebarRight.openResource 不可达（E1 注入未生效？重启宿主后重试）')
      return
    }
    try {
      open.call(sidebarRight, address)
      pushLog('ok', `openResource('${address}') 未抛错——主区被占时这**不符合**0102 预期，请记录！`)
    } catch (error: unknown) {
      pushLog('bad', `openResource 抛错（主区被占时预期 "no session surface is mounted"）：${String(error)}`)
    }
  }, [ctx, pushLog, sessionId])

  /* ── E1 第 5 项（API 面）：主区被占时预览器仍可注册 ── */
  const registerPreview = useCallback((): void => {
    const previews = ctx.documentPreviews
    if (previews?.register === undefined) {
      pushLog('bad', 'documentPreviews 不可达（E1 注入未生效？）')
      return
    }
    try {
      const dispose = previews.register({
        id: 'srw-e1-preview',
        extensions: ['srwtxt'],
        title: () => 'SRW E1 预览',
        loading: 'text-pages',
      })
      pushLog('ok', 'documentPreviews.register 成功（主区被占仍可注册=第 5 项 API 面通过）；15s 后自动撤销')
      window.setTimeout(() => {
        try {
          dispose()
          pushLog('info', 'E1 预览注册已自动撤销（不留垃圾）')
        } catch { /* 已撤销 */ }
      }, 15000)
    } catch (error: unknown) {
      pushLog('bad', `documentPreviews.register 抛错：${String(error)}`)
    }
  }, [ctx, pushLog])

  /* ── E1 第 6/7 项：送草稿（两条路径，A 为 0102 原文口径）── */
  const sendDraft = useCallback(async (): Promise<void> => {
    const sid = sessionId.trim()
    const sessions = ctx.sessions
    if (sid === '' || sessions === undefined) {
      pushLog('bad', '送草稿跳过：需要 sessionId（输入框）与 sessions 服务')
      return
    }
    const anySessions = sessions as unknown as Record<string, unknown>
    // 路径 A（0102 §9.3 原文）：retain → ready → binding → conversation.input.for(binding.ctx)
    if (typeof anySessions['retain'] === 'function' && typeof anySessions['binding'] === 'function'
      && ctx.conversation?.input?.for !== undefined) {
      try {
        const ref = (anySessions['retain'] as AnyFn).call(sessions, sid, { source: 'srw' }) as { ready?: Promise<unknown>; release?: () => void } | undefined
        if (ref?.ready !== undefined) await ref.ready
        const bound = (anySessions['binding'] as AnyFn).call(sessions, sid) as { ctx?: unknown } | undefined
        const carrier = bound?.ctx
        ref?.release?.()
        if (carrier === undefined) {
          pushLog('bad', '路径A：binding(sid).ctx 为空')
        } else {
          const shell = ctx.conversation.input.for!(carrier)
          if (shell?.setDraft !== undefined && shell.submit !== undefined) {
            shell.setDraft(`[SRW E1] draft ping ${new Date().toLocaleTimeString()}`)
            shell.submit()
            pushLog('ok', `路径A retain+binding+conversation.input.for：已送草稿（到会话 ${sid} 确认落点正确、切会话不串台）`)
            return
          }
          pushLog('bad', '路径A：input shell 缺 setDraft/submit')
        }
      } catch (error: unknown) {
        pushLog('bad', `路径A retain+binding 抛错（未 retain 直接 for 的文案也是第 7 项数据）：${String(error)}`)
      }
    } else {
      pushLog('info', '路径A 不可用（retain/binding/conversation.input 缺一）')
    }
    // 路径 B（vibe 同款）：retainAgentScope → scope → for(scope)
    if (typeof sessions.retainAgentScope === 'function' && typeof sessions.scope === 'function') {
      try {
        const ref = sessions.retainAgentScope.call(sessions, sid)
        const scope = sessions.scope.call(sessions, sid)
        const shell = scope?.conversation?.input?.for?.(scope)
        ref?.release?.()
        if (shell?.setDraft !== undefined && shell.submit !== undefined) {
          shell.setDraft(`[SRW E1] draft ping B ${new Date().toLocaleTimeString()}`)
          shell.submit()
          pushLog('ok', `路径B retainAgentScope+scope：已送草稿（到会话 ${sid} 确认落点）`)
          return
        }
        pushLog('bad', '路径B：scope 的 input shell 不可用')
      } catch (error: unknown) {
        pushLog('bad', `路径B retainAgentScope+scope 抛错：${String(error)}`)
      }
    } else {
      pushLog('info', '路径B 不可用：sessions.retainAgentScope/scope 未注入')
    }
    pushLog('bad', '两条路径都未成功——E1 记录原始错误后定稿正确通路')
  }, [ctx, pushLog, sessionId])

  /* ── §9.3：当前会话唯一权威 ── */
  const probeUiSession = useCallback((): void => {
    try {
      const key = ctx.uiSession?.adapter?.current?.getSnapshot?.().key
      pushLog(key !== undefined ? 'ok' : 'bad', `uiSession.adapter.current.key = ${key === undefined ? '(undefined)' : JSON.stringify(key)}（切会话后重按，验证实时性）`)
    } catch (error: unknown) {
      pushLog('bad', `uiSession 探测抛错：${String(error)}`)
    }
  }, [ctx, pushLog])

  /* ── E1 第 10 项说明 ── */
  const probeSettings = useCallback((): void => {
    const present = safeGet(ctx, 'settings')
    pushLog('info', `ctx.settings ${present.present ? '存在' : '未注入（服务名未验证，为避免激活失败不注入）'}；第 10 项的正确载体是 settings.section 槽——本插件已注册「科研工作台（E1 验证）」区块，请在面板占主区时从外壳打开设置页查看能否打开（portal 模态预期）`)
  }, [ctx, pushLog])

  /* ── Task 1.2 / V4：宿主 contains 实测（诊断真值，非护栏）── */
  const probeContains = useCallback(async (): Promise<void> => {
    const root = containsRoot.trim()
    const target = containsTarget.trim()
    if (root === '' || target === '') {
      pushLog('bad', 'contains 实测需要 root 与 target 两个路径')
      return
    }
    try {
      const value = await callRpc(ctx, 'diag.contains', { root, target }) as { contained?: boolean; detail?: string }
      pushLog(value.contained === true ? 'ok' : 'info',
        `diag.contains(root=${root}, target=${target}) → ${value.contained === true}（contains 语义）${value.detail !== undefined && value.detail !== '' ? `；detail：${value.detail}` : ''}`)
    } catch (error: unknown) {
      pushLog('bad', `diag.contains 失败：${String(error)}`)
    }
  }, [ctx, pushLog, containsRoot, containsTarget])

  const clientRows = CLIENT_PATHS.map(path => ({ path, ...safeGet(ctx, path) }))

  return (
    <div className='srw-panel'>
      {embedded ? null : (
        <>
          <h1 className='srw-h1'>科研工作台 · M0 诊断</h1>
          <p className='srw-sub'>
            {info === null
              ? '宿主信息加载中…'
              : `v${String(info['version'] ?? '?')} · 通道 ${String((info['home'] as Record<string, unknown> | undefined)?.['channel'] ?? '?')} · home ${String((info['home'] as Record<string, unknown> | undefined)?.['home'] ?? '') === '' ? '(未判定)' : String((info['home'] as Record<string, unknown>)['home'])} · 离线模式 ${info['offlineMode'] === true ? '开' : '关'}`}
            {rpcError !== null ? <span style={{ color: 'var(--srw-error)' }}> · RPC：{rpcError}</span> : null}
          </p>
        </>
      )}

      <div className='srw-card'>
        <h2>宿主能力（RPC diag.caps）</h2>
        <button className='srw-btn primary' disabled={busy} onClick={() => { void refresh() }}>重新探测</button>
        <div className='srw-actions' style={{ marginTop: 8 }}>
          <input
            className='srw-input'
            placeholder='root（绝对路径）'
            value={containsRoot}
            onChange={event => { setContainsRoot(event.target.value) }}
          />
          <input
            className='srw-input'
            placeholder='target（相对 root 或绝对）'
            value={containsTarget}
            onChange={event => { setContainsTarget(event.target.value) }}
          />
          <button className='srw-btn' onClick={() => { void probeContains() }}>contains 实测（V4）</button>
        </div>
        {hostCaps === null
          ? <p className='srw-detail'>{rpcError ?? '加载中…'}</p>
          : (
              <table className='srw-table'>
                <thead>
                  <tr><th>服务</th><th>状态</th><th>类型</th></tr>
                </thead>
                <tbody>
                  {hostCaps.map(row => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td><span className={`srw-dot ${row.available ? 'ok' : 'bad'}`} />{row.available ? '可用' : '缺席'}</td>
                      <td className='srw-detail'>{row.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
      </div>

      <div className='srw-card'>
        <h2>客户端服务面（已验证 10 + E1 临时 4 + 候选）</h2>
        <table className='srw-table'>
          <tbody>
            {clientRows.map(row => (
              <tr key={row.path}>
                <td>{row.path}</td>
                <td><span className={`srw-dot ${row.present ? 'ok' : 'bad'}`} />{row.present ? '可用' : row.detail === '未注入' ? '未注入' : '缺席'}</td>
                <td className='srw-detail'>{row.present ? row.detail : row.detail === '未注入' ? '' : row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className='srw-card'>
        <h2>E1 探测（0201 Task 0.6 · 每条结果落日志）</h2>
        <div className='srw-actions'>
          <input
            className='srw-input'
            placeholder='sessionId（默认取当前会话）'
            value={sessionId}
            onChange={event => { setSessionId(event.target.value) }}
          />
        </div>
        <div className='srw-actions'>
          <button className='srw-btn' onClick={probePanelInfo}>panelInfo 快照</button>
          <button className='srw-btn' onClick={() => { tryOpenViewer(false) }}>试开文档查看器</button>
          <button className='srw-btn' onClick={() => { tryOpenViewer(true) }}>试延迟打开</button>
          <button className='srw-btn' onClick={() => { void sendDraft() }}>送草稿到会话</button>
          <button className='srw-btn' onClick={registerPreview}>注册预览器</button>
          <button className='srw-btn' onClick={probeUiSession}>uiSession 探测</button>
          <button className='srw-btn' onClick={probeSettings}>设置页说明</button>
        </div>
        <ul className='srw-log'>
          {log.map((entry, index) => (
            <li key={`${entry.at}-${String(index)}`}>
              <span className='t'>{entry.at}</span>
              <span className={entry.kind}>{entry.kind === 'ok' ? '✓' : entry.kind === 'bad' ? '✗' : '·'}</span>{' '}
              {entry.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
