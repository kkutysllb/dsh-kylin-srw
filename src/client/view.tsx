/** M0 诊断视图：宿主能力表（RPC `diag.caps`）+ 客户端服务表 + panelInfo
 * 快照 + E1 探测按钮。所有探测结果进滚动日志，作为 E1/E2 记录的原始证据。
 * 每个按钮都是「期望先写好」的实验步骤（见 0201 Task 0.6），失败/缺席
 * 都是有效数据，绝不静默。
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

/** 注入面（10）+ E1 候选面（未注入，探测结果应为「未注入」）。 */
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
  'sidebarRightTabs',
  'documentPreviews',
  'settings',
  'uiSession',
  'conversation',
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

export function DiagView({ ctx }: { readonly ctx: ClientContext }): React.ReactElement {
  const [hostCaps, setHostCaps] = useState<readonly CapsRow[] | null>(null)
  const [info, setInfo] = useState<Record<string, unknown> | null>(null)
  const [rpcError, setRpcError] = useState<string | null>(null)
  const [log, setLog] = useState<readonly LogEntry[]>([])
  const [sessionId, setSessionId] = useState('')
  const [busy, setBusy] = useState(false)

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

  const probePanelInfo = useCallback((): void => {
    const snapshot = ctx.layout?.panelInfo?.getSnapshot?.()
    pushLog(snapshot !== undefined ? 'ok' : 'bad', `layout.panelInfo = ${fmt(snapshot)}`)
  }, [ctx, pushLog])

  const tryOpenViewer = useCallback(async (deferred: boolean): Promise<void> => {
    const sidebarRight = (ctx as Record<string, unknown>)['sidebarRight'] as Record<string, unknown> | undefined
    const name = deferred === true ? 'openResourceIn' : 'openResource'
    if (sidebarRight === undefined || typeof sidebarRight[name] !== 'function') {
      pushLog('bad', `ctx.sidebarRight.${name} 不可达（服务未注入——inject 名单 E1 后扩；预期现象本身即数据）`)
      return
    }
    try {
      const args: unknown[] = deferred === true ? [sessionId, {}] : [{}]
      const result = await (sidebarRight[name] as AnyFn).apply(sidebarRight, args)
      pushLog('ok', `sidebarRight.${name} 返回：${fmt(result)}`)
    } catch (error: unknown) {
      pushLog('bad', `sidebarRight.${name} 抛错（主区被占时预期 "no session surface is mounted"）：${String(error)}`)
    }
  }, [ctx, pushLog, sessionId])

  const sendDraft = useCallback(async (): Promise<void> => {
    const sid = sessionId.trim()
    const sessions = ctx.sessions
    if (sid === '' || sessions === undefined) {
      pushLog('bad', '送草稿跳过：需要 sessionId（输入框）与 sessions 服务')
      return
    }
    const submit = async (label: string, carrier: unknown): Promise<boolean> => {
      const scope = carrier as { conversation?: { input?: { for?(c: unknown): { setDraft?(t: string): void; submit?(m?: unknown): void } } } }
      const shell = scope?.conversation?.input?.for?.(carrier)
      if (shell?.setDraft === undefined || shell.submit === undefined) {
        pushLog('bad', `${label}: input shell 不可用（for/setDraft/submit 缺一）`)
        return false
      }
      shell.setDraft(`[SRW E1] draft ping ${new Date().toLocaleTimeString()}`)
      shell.submit()
      pushLog('ok', `${label}: setDraft+submit 已执行（请到目标会话确认落点正确、切会话不串台）`)
      return true
    }
    const anySessions = sessions as unknown as Record<string, unknown>
    // 路径 A（0102 §9.3 原文口径）：retain → ready → binding → for(binding.ctx)
    if (typeof anySessions['retain'] === 'function' && typeof anySessions['binding'] === 'function') {
      try {
        const ref = (anySessions['retain'] as AnyFn).call(sessions, sid, { source: 'srw' }) as { ready?: Promise<unknown>; release?: () => void } | undefined
        if (ref?.ready !== undefined) await ref.ready
        const bound = (anySessions['binding'] as AnyFn).call(sessions, sid) as { ctx?: unknown } | undefined
        const carrier = bound?.ctx
        ref?.release?.()
        if (carrier !== undefined && await submit('路径A retain+binding', carrier) === true) return
      } catch (error: unknown) {
        pushLog('bad', `路径A retain+binding 抛错：${String(error)}`)
      }
    } else {
      pushLog('info', '路径A 不可用：sessions.retain/binding 未注入')
    }
    // 路径 B（vibe 同款）：retainAgentScope → scope → for(scope)
    if (typeof sessions.retainAgentScope === 'function' && typeof sessions.scope === 'function') {
      try {
        const ref = sessions.retainAgentScope.call(sessions, sid)
        const scope = sessions.scope.call(sessions, sid)
        const done = await submit('路径B retainAgentScope+scope', scope)
        ref?.release?.()
        if (done) return
      } catch (error: unknown) {
        pushLog('bad', `路径B retainAgentScope+scope 抛错：${String(error)}`)
      }
    } else {
      pushLog('info', '路径B 不可用：sessions.retainAgentScope/scope 未注入')
    }
    pushLog('bad', '送草稿两条路径都未成功——E1 记录原始错误后定稿正确通路')
  }, [ctx, pushLog, sessionId])

  const tryOpenSettings = useCallback(async (): Promise<void> => {
    const settings = (ctx as Record<string, unknown>)['settings'] as Record<string, unknown> | undefined
    if (settings === undefined) {
      pushLog('bad', 'ctx.settings 未注入（settings.section 槽是 M1 设置页的正式通路，此按钮仅探测服务面）')
      return
    }
    const opener = Object.entries(settings).find(([, v]) => typeof v === 'function')
    if (opener === undefined) {
      pushLog('info', `ctx.settings 存在但无可直调函数：${fmt(Object.keys(settings))}`)
      return
    }
    try {
      const result = await (opener[1] as AnyFn).call(settings)
      pushLog('ok', `settings.${opener[0]}() 返回：${fmt(result)}`)
    } catch (error: unknown) {
      pushLog('bad', `settings.${opener[0]}() 抛错：${String(error)}`)
    }
  }, [ctx, pushLog])

  const clientRows = CLIENT_PATHS.map(path => ({ path, ...safeGet(ctx, path) }))

  return (
    <div className='srw-panel'>
      <h1 className='srw-h1'>科研工作台 · M0 诊断</h1>
      <p className='srw-sub'>
        {info === null
          ? '宿主信息加载中…'
          : `v${String(info['version'] ?? '?')} · 通道 ${String((info['home'] as Record<string, unknown> | undefined)?.['channel'] ?? '?')} · home ${String((info['home'] as Record<string, unknown> | undefined)?.['home'] ?? '?')} · 离线模式 ${info['offlineMode'] === true ? '开' : '关'}`}
        {rpcError !== null ? <span style={{ color: 'var(--srw-error)' }}> · RPC：{rpcError}</span> : null}
      </p>

      <div className='srw-card'>
        <h2>宿主能力（RPC diag.caps）</h2>
        <button className='srw-btn primary' disabled={busy} onClick={() => { void refresh() }}>重新探测</button>
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
        <h2>客户端服务面（注入 10 + E1 候选）</h2>
        <table className='srw-table'>
          <tbody>
            {clientRows.map(row => (
              <tr key={row.path}>
                <td>{row.path}</td>
                <td><span className={`srw-dot ${row.present ? 'ok' : 'bad'}`} />{row.present ? '可用' : row.detail}</td>
                <td className='srw-detail'>{row.detail === '未注入' ? '' : row.detail}</td>
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
          <button className='srw-btn' onClick={() => { void tryOpenViewer(false) }}>试开文档查看器</button>
          <button className='srw-btn' onClick={() => { void tryOpenViewer(true) }}>试延迟打开</button>
          <button className='srw-btn' onClick={() => { void sendDraft() }}>送草稿到会话</button>
          <button className='srw-btn' onClick={() => { void tryOpenSettings() }}>设置页候选探测</button>
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
