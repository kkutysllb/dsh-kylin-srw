/** 公开时序门（M9-lite 最值钱的单点）：先申请、后公开。纯函数——输入
 * 已校验的 patent/events 与「计划公开时点」，输出四档判定 + 中文
 * reasons/advice；不落盘、不外联、不构成法律意见。
 *
 * 判定规则（analysis/goals/03-写专利.md §4 交叉 + 任务口径）：
 * 1) filing.filedAt 存在且 ≤ publicationAt → safe；
 * 2) 已公开事件（publicAt ≤ publicationAt）且无 filing → blocked（不可逆）；
 * 3) 有 filing 且事件 publicAt < filedAt：差距 ≤ 6 个月且 graceCase ≠ none
 *    → grace（须代理人确认适用）；否则 → risk（新颖性已丧失）；
 * 4) 无 filing、无已公开事件 → risk（先申请后公开）；
 * 5) 事件全部在 filedAt 之后 → safe。
 * 多事件取最严：blocked > risk > grace > safe；每条 reason 带事件
 * publicAt/kind；advice 至少一条。 */

import type { PatentMeta, PublicEvent } from './types.ts'

export type PublicationVerdict = 'safe' | 'grace' | 'risk' | 'blocked'

export interface PublicationCheckInput {
  readonly patent: PatentMeta
  readonly events: readonly PublicEvent[]
  /** 计划公开时点（投稿/预印本/答辩/开源的时刻），缺省语义由调用方补 now。 */
  readonly publicationAt: string
  /** 「未来」判定基准（缺省当前时刻；测试显式传入保证确定性）。 */
  readonly now?: string
}

export interface PublicationCheck {
  readonly verdict: PublicationVerdict
  readonly reasons: readonly string[]
  readonly advice: readonly string[]
}

const VERDICT_RANK: Readonly<Record<PublicationVerdict, number>> = { safe: 0, grace: 1, risk: 2, blocked: 3 }

/** 中国宽限期窗口：申请日前 6 个月（专利法第 24 条）。按日历月计算，
 * 「恰好 6 个月」落在窗口内（≤ 判定）。 */
const GRACE_MONTHS = 6

/** 公开事件落入宽限期窗口：filedAt - publicAt ≤ 6 个月（日历月）。 */
export function withinGraceWindow(publicAtMs: number, filedAtMs: number): boolean {
  const start = new Date(publicAtMs)
  const limit = new Date(start)
  limit.setUTCMonth(start.getUTCMonth() + GRACE_MONTHS)
  return filedAtMs <= limit.getTime()
}

const ADVICE_NO_LEGAL_OPINION = '本门只做时序提示，不构成法律意见；适用性与补救以专利代理人意见为准'

interface Finding {
  readonly verdict: PublicationVerdict
  readonly reason: string
  readonly advice?: string
}

export function checkPublication(input: PublicationCheckInput): PublicationCheck {
  const { patent, events, publicationAt } = input
  const publicationAtMs = Date.parse(publicationAt)
  const nowMs = input.now !== undefined ? Date.parse(input.now) : Date.now()
  const filing = patent.filing
  const filedAtMs = filing !== undefined && !Number.isNaN(Date.parse(filing.filedAt))
    ? Date.parse(filing.filedAt)
    : undefined
  const findings: Finding[] = []

  // 规则 1：申请日 ≤ 计划公开时点 → 公开发生在申请之后。
  if (filing !== undefined && filedAtMs !== undefined && filedAtMs <= publicationAtMs) {
    findings.push({
      verdict: 'safe',
      reason: `申请日 ${filing.filedAt}（${filing.applicationNo}）不晚于计划公开时点 ${publicationAt}：公开发生在申请之后`,
    })
  }

  for (const event of events) {
    const publicAtMs = Date.parse(event.publicAt)
    // 尚未公开（或时间非法）的事件对本次检查不构成在先公开。
    if (Number.isNaN(publicAtMs) || publicAtMs > publicationAtMs) continue
    if (filedAtMs === undefined || filing === undefined) {
      // 规则 2：已公开 + 无 filing → 不可逆。
      findings.push({
        verdict: 'blocked',
        reason: `公开事件 ${event.kind}@${event.publicAt} 已公开而该专利尚无申请记录：新颖性已不可逆丧失`,
        advice: '立即停止投稿/公开并联系专利代理人：自有公开已构成现有技术，事后申请无法恢复新颖性',
      })
      continue
    }
    if (publicAtMs < filedAtMs) {
      // 规则 3：公开在申请日之前 → 宽限期或丧失。
      if (withinGraceWindow(publicAtMs, filedAtMs) && event.graceCase !== 'none') {
        findings.push({
          verdict: 'grace',
          reason: `公开事件 ${event.kind}@${event.publicAt} 早于申请日 ${filing.filedAt}，落入 6 个月宽限期窗口且登记情形为「${event.graceCase}」`,
          advice: '宽限期仅四种法定情形（国家紧急状态为公共利益首次公开／中国政府主办或承认的国际展览会首次展出／规定的学术会议首次发表／他人未经同意泄露），须专利代理人确认适用；「规定的学术会议」仅指国务院有关主管部门或全国性学术团体组织召开的会议',
        })
      } else {
        findings.push({
          verdict: 'risk',
          reason: `公开事件 ${event.kind}@${event.publicAt} 早于申请日 ${filing.filedAt}${event.graceCase === 'none' ? '且未登记宽限情形' : '且超出 6 个月宽限期窗口'}：新颖性已丧失`,
          advice: '与专利代理人评估该申请是否仍值得提交，并核对公开时间/场合的证明材料（对比文件已含自有公开）',
        })
      }
      continue
    }
    // 规则 5：事件在申请日之后公开，不影响本申请新颖性。
    findings.push({
      verdict: 'safe',
      reason: `公开事件 ${event.kind}@${event.publicAt} 在申请日 ${filing.filedAt} 之后：不影响本申请的新颖性判定`,
    })
  }

  if (filedAtMs === undefined && !findings.some(f => f.verdict === 'blocked')) {
    // 规则 4：无 filing、无已公开事件 → 先申请后公开（未来时点是最典型场景）。
    findings.push({
      verdict: 'risk',
      reason: publicationAtMs > nowMs
        ? `尚无申请记录（filing 缺席）而计划公开时点 ${publicationAt} 在未来：一旦公开即构成现有技术`
        : `尚无申请记录（filing 缺席）且计划公开时点 ${publicationAt} 无任何公开事件登记：先补全公开盘点再判定`,
      advice: '先申请、后公开：中国宽限期仅申请日前 6 个月，且「规定的学术会议」范围极窄（国务院主管部门或全国性学术团体组织），不要指望宽限期兜底',
    })
  }

  // 有 filing 但计划公开时点早于申请日：这次公开本身就是申请前公开。
  if (filing !== undefined && filedAtMs !== undefined && filedAtMs > publicationAtMs) {
    findings.push({
      verdict: 'risk',
      reason: `计划公开时点 ${publicationAt} 早于申请日 ${filing.filedAt}：这次公开本身构成申请前公开`,
      advice: '把投稿/公开压到申请日之后；确需提前公开时逐事件登记 graceCase 并由专利代理人确认适用',
    })
  }

  // 防御兜底：没有任何可判事实时按保守处理（不判 safe）。
  if (findings.length === 0) {
    findings.push({
      verdict: 'risk',
      reason: `无可判定的申请或公开记录（计划公开时点 ${publicationAt}）：默认按「未申请、计划公开」保守处理`,
      advice: '先用 event.add 补全已知公开事件与申请登记，再重跑本检查',
    })
  }

  const verdict = findings.reduce<PublicationVerdict>(
    (worst, finding) => VERDICT_RANK[finding.verdict] > VERDICT_RANK[worst] ? finding.verdict : worst,
    'safe',
  )
  const reasons = findings.map(finding => finding.reason)
  const advice: string[] = []
  for (const finding of findings) {
    if (finding.advice !== undefined && !advice.includes(finding.advice)) advice.push(finding.advice)
  }
  if (advice.length === 0) {
    advice.push('先申请、后公开：任何投稿/预印本/答辩/开源之前完成专利申请或与专利代理人确认时序')
  }
  advice.push(ADVICE_NO_LEGAL_OPINION)
  return { verdict, reasons, advice }
}
