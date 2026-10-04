/** 文献 API 的统一出网口（0203 Task 2.2）：RateGate 限速 + withDeadline
 * 超时 + 手动重定向（API 域固定常量，Task 2.7 的完整 SSRF 三步只用于
 * 用户/agent 提供的 URL）+ 429/503 上报退避。
 *
 * 只接受本模块构造的 https URL；查询串编码交给 URL/URLSearchParams。
 */

import { ServiceError } from '../service.ts'
import { withDeadline } from '../net/deadline.ts'
import type { RateGate } from './rate-gate.ts'

const API_DEADLINE_MS = 15_000

export interface GatedFetchResult {
  readonly status: number
  readonly text: string
}

async function gatedFetch(gate: RateGate, url: URL): Promise<Response> {
  const domain = url.hostname
  await gate.acquire(domain)
  let response: Response
  try {
    response = await withDeadline(API_DEADLINE_MS, signal => fetch(url, {
      redirect: 'manual',
      signal,
      headers: { 'user-agent': 'dsh-kylin-srw/0.0.1 (research workbench plugin)' },
    }))
  } catch (error: unknown) {
    throw new ServiceError('UPSTREAM', `请求失败：${domain}（${error instanceof Error ? error.message : String(error)}）`)
  }
  if (response.status === 429 || response.status === 503) {
    const retryAfter = Number(response.headers.get('retry-after'))
    await gate.reportFailure(domain, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined)
    throw new ServiceError('RATE_LIMITED', `${domain} 限流（HTTP ${response.status}），已进入退避`)
  }
  if (!response.ok) {
    throw new ServiceError('UPSTREAM', `${domain} 返回 HTTP ${response.status}`)
  }
  await gate.reportSuccess(domain)
  return response
}

/** GET 并以文本返回（Atom/XML/JSON 皆可，解析交给调用方）。 */
export async function gatedFetchText(gate: RateGate, url: URL): Promise<string> {
  const response = await gatedFetch(gate, url)
  return await withDeadline(API_DEADLINE_MS, signal => response.text())
}

/** GET 并解析 JSON（坏 JSON → UPSTREAM）。 */
export async function gatedFetchJson<T>(gate: RateGate, url: URL): Promise<T> {
  const text = await gatedFetchText(gate, url)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ServiceError('UPSTREAM', `${url.hostname} 返回的不是合法 JSON`)
  }
}
