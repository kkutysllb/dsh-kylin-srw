/** 刊物注册表种子数据（0102 §7.3 的 venue.json 形状）。**全部
 * `confidence: "unverified"`**：数值来自各刊作者指南的通识记忆，未经人工
 * 逐项核定——只做建议，不阻断（RISK-7）。核定后在投稿视图（M8）升级。
 * 数据以 TS 模块内嵌（esbuild 打包零拷贝；JSON 文件加载是包装陷阱），
 * 载入仍过 validateVenue 校验——手写数据同样不过不了 schema。 */

import { validateVenue, type VenueSchema } from './types.ts'

const SEEDS: readonly unknown[] = [
  {
    schemaVersion: 1,
    id: 'ieee-journal',
    name: 'IEEE Transactions（通用期刊模板）',
    documentClass: 'IEEEtran',
    classOptions: ['journal'],
    bibStyle: 'IEEEtran',
    bibTool: 'bibtex',
    columns: 2,
    pageLimit: { regular: 12, note: '模板通用值，具体刊可能不同' },
    abstractWords: 250,
    sectionOrder: ['Introduction', 'Related Work', 'Method', 'Experiments', 'Results', 'Discussion', 'Conclusion'],
    mandatorySections: ['Introduction', 'Method', 'Experiments', 'Conclusion'],
    mandatoryStatements: [],
    referenceStyle: 'ieee',
    figureDpi: 300,
    depthTier: 'D3',
    confidence: 'unverified',
    sources: [{ url: 'https://journals.ieeeauthorcenter.ieee.org/', checkedAt: '2026-10-06' }],
    lang: 'en',
  },
  {
    schemaVersion: 1,
    id: 'acm-conf',
    name: 'ACM 会议（sigconf 全文）',
    documentClass: 'acmart',
    classOptions: ['sigconf'],
    bibStyle: 'ACM-Reference-Format',
    bibTool: 'bibtex',
    columns: 2,
    pageLimit: { regular: 10, note: '多数 ACM 会议正文 10 页 + 引用不限，具体以 CFP 为准' },
    abstractWords: 150,
    sectionOrder: ['Introduction', 'Related Work', 'Method', 'Experiments', 'Results', 'Discussion', 'Conclusion'],
    mandatorySections: ['Introduction', 'Method', 'Experiments', 'Conclusion'],
    mandatoryStatements: ['dataAvailability', 'codeAvailability'],
    referenceStyle: 'acm',
    figureDpi: 300,
    depthTier: 'D2',
    confidence: 'unverified',
    sources: [{ url: 'https://www.acm.org/publications/authors/submissions', checkedAt: '2026-10-06' }],
    lang: 'en',
  },
  {
    schemaVersion: 1,
    id: 'springer-lncs',
    name: 'Springer LNCS（会议/文集）',
    documentClass: 'llncs',
    classOptions: [],
    bibStyle: 'splncs04',
    bibTool: 'bibtex',
    columns: 1,
    pageLimit: { regular: 16, note: 'LNCS 常见 12–16 页，以卷次说明为准' },
    abstractWords: 150,
    sectionOrder: ['Introduction', 'Related Work', 'Method', 'Experiments', 'Results', 'Conclusion'],
    mandatorySections: ['Introduction', 'Method', 'Experiments', 'Conclusion'],
    mandatoryStatements: [],
    referenceStyle: 'numeric',
    figureDpi: 300,
    depthTier: 'D2',
    confidence: 'unverified',
    sources: [{ url: 'https://www.springer.com/gp/computer-science/lncs/conference-proceedings-guidelines', checkedAt: '2026-10-06' }],
    lang: 'en',
  },
  {
    schemaVersion: 1,
    id: 'cn-journal',
    name: '中文期刊（通用，ctex + GB/T 7714）',
    documentClass: 'ctexart',
    classOptions: ['zihao=-4', 'a4paper'],
    bibStyle: 'gbt7714',
    bibTool: 'bibtex',
    columns: 2,
    abstractWords: 200,
    sectionOrder: ['引言', '相关工作', '方法', '实验', '结果', '讨论', '结论'],
    mandatorySections: ['引言', '方法', '实验', '结论'],
    mandatoryStatements: [],
    referenceStyle: 'gbt7714',
    figureDpi: 300,
    depthTier: 'D3',
    confidence: 'unverified',
    sources: [{ url: 'https://www.gb688.cn/bb/stdinfo/N20220701444', checkedAt: '2026-10-06' }],
    lang: 'zh',
  },
]

let cache: readonly VenueSchema[] | undefined

/** 注册表（≥3 个 + 中文单列）：惰性校验，坏数据在首次访问即抛。 */
export function listVenues(): readonly VenueSchema[] {
  if (cache === undefined) {
    cache = SEEDS.map(seed => validateVenue(seed))
  }
  return cache
}

export function getVenue(id: string): VenueSchema | undefined {
  return listVenues().find(venue => venue.id === id)
}
