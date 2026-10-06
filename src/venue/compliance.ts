/** 合规检查（R5 的机读出口）：把深度档阈值 + 刊物要求变成 `checks[]`——
 * 每条 `{id, level, pass, actual, expected, where}`，UI 可点跳转整改。
 * **confidence 语义**：venue 为 `unverified` 时所有检查降为 `warn`（只建议）；
 * `verified`（人工核定过）才可能出现 `error` 阻断级。 */

import { DEPTH_PROFILES, type DepthProfile } from './depth.ts'
import type { DepthTier, VenueSchema } from './types.ts'

export type ComplianceLevel = 'error' | 'warn'

export interface ComplianceFacts {
  /** 编译产物页数（无引擎/未编译时 undefined → 检查项 pass=undefined 不判）。 */
  readonly pages?: number | undefined
  readonly sections: readonly string[]
  readonly figures: number
  readonly tables: number
  readonly referenceCount: number
  /** 已存在的声明节/声明字段（如 'Data Availability' 节标题或 \section*）。 */
  readonly statementsPresent: readonly string[]
  readonly hasAppendix: boolean
}

export interface ComplianceCheck {
  readonly id: string
  readonly level: ComplianceLevel
  /** undefined = 事实缺失，无法判定（提示补事实，不算不过）。 */
  readonly pass: boolean | undefined
  readonly actual: string
  readonly expected: string
  /** 跳转落点（面板用：'sections'/'refs.bib'/'main.tex'/节名）。 */
  readonly where: string
}

function check(id: string, pass: boolean | undefined, actual: string, expected: string, where: string, errorWhenFail: boolean): ComplianceCheck {
  const level: ComplianceLevel = errorWhenFail ? 'error' : 'warn'
  if (pass === undefined) return { id, level: 'warn', pass: undefined, actual, expected, where }
  return { id, level: pass ? 'warn' : level, pass, actual, expected, where }
}

function countMatches(present: readonly string[], wanted: readonly string[]): readonly string[] {
  return wanted.filter(want => present.some(item => item.toLowerCase().includes(want.toLowerCase())))
}

/** 跑全部合规检查。order 固定：篇幅 → 章节 → 声明 → 图表 → 文献 → 附录。 */
export function runCompliance(input: {
  readonly venue: VenueSchema
  /** 档位：项目 project.json 的 depthTier，覆盖 venue.depthTier。 */
  readonly tier: DepthTier
  readonly facts: ComplianceFacts
}): readonly ComplianceCheck[] {
  const { venue, tier, facts } = input
  const profile: DepthProfile = DEPTH_PROFILES[tier]
  const errorWhenFail = venue.confidence === 'verified'
  const checks: ComplianceCheck[] = []

  checks.push(check(
    'pages',
    facts.pages === undefined ? undefined : facts.pages >= profile.pages.min && facts.pages <= profile.pages.max,
    facts.pages === undefined ? '未编译（无页数）' : `${facts.pages} 页`,
    `${profile.pages.min}–${profile.pages.max} 页`,
    'build/',
    errorWhenFail,
  ))

  for (const required of venue.mandatorySections) {
    const present = facts.sections.some(section => section.toLowerCase().includes(required.toLowerCase()))
    checks.push(check(`section.${required}`, present, present ? '有' : '缺', `必备章节 ${required}`, 'sections/', errorWhenFail))
  }
  if (profile.sections.requireRelatedWork) {
    const present = facts.sections.some(section => /related work|相关工作|文献综述/i.test(section))
    checks.push(check('section.relatedWork', present, present ? '有' : '缺', 'D2/D3 须含 Related Work 章节', 'sections/', errorWhenFail))
  }

  for (const statement of venue.mandatoryStatements.length > 0
    ? venue.mandatoryStatements
    : profile.statements) {
    const label = STATEMENT_LABELS[statement] ?? statement
    const present = countMatches(facts.statementsPresent, [label]).length > 0
      || facts.statementsPresent.some(item => item.toLowerCase().includes(statement.toLowerCase()))
    checks.push(check(`statement.${statement}`, present, present ? '有' : '缺', `必备声明：${label}`, 'sections/', errorWhenFail))
  }

  checks.push(check(
    'figures',
    facts.figures >= profile.figures.min && facts.figures <= profile.figures.max,
    `${facts.figures} 幅`,
    `${profile.figures.min}–${profile.figures.max} 幅`,
    'figs/',
    errorWhenFail,
  ))
  checks.push(check(
    'tables',
    facts.tables >= profile.tables.min && facts.tables <= profile.tables.max,
    `${facts.tables} 张`,
    `${profile.tables.min}–${profile.tables.max} 张`,
    'sections/',
    errorWhenFail,
  ))
  checks.push(check(
    'references',
    facts.referenceCount >= profile.references.min && facts.referenceCount <= profile.references.max,
    `${facts.referenceCount} 条`,
    `${profile.references.min}–${profile.references.max} 条`,
    'refs.bib',
    errorWhenFail,
  ))

  if (!profile.sections.allowAppendix && facts.hasAppendix) {
    checks.push(check('appendix', false, '有附录', `${tier} 不设附录（证明/超参移脚注或仓库）`, 'sections/', errorWhenFail))
  }

  return checks
}

export const STATEMENT_LABELS: Readonly<Record<string, string>> = {
  dataAvailability: 'Data Availability',
  codeAvailability: 'Code Availability',
  limitations: 'Limitations',
  conflictOfInterest: 'Conflict of Interest',
  ethics: 'Ethics',
  authorContributions: 'Author Contributions',
}
