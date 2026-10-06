/** 骨架生成（Task 5.2）：按 venue schema 渲染 main.tex + sections/ 空节 +
 * refs.bib 占位。宏包单链：algorithm/booktabs/tikz/pgfplots（ADR-12 的
 * M5 部分）；中文刊物（lang=zh）走 ctexart，节名中文。 */

import type { VenueSchema } from '../venue/types.ts'

export interface ScaffoldPlan {
  readonly mainTex: string
  /** 相对路径 → 内容（sections/*.tex 与 refs.bib）。 */
  readonly files: Readonly<Record<string, string>>
  readonly sections: readonly string[]
}

const PLACEHOLDER_TITLES: Readonly<Record<string, string>> = {
  Introduction: 'Introduction',
  'Related Work': 'Related Work',
  Method: 'Method',
  Experiments: 'Experiments',
  Results: 'Results',
  Discussion: 'Discussion',
  Conclusion: 'Conclusion',
  引言: '引言',
  相关工作: '相关工作',
  方法: '方法',
  实验: '实验',
  结果: '结果',
  讨论: '讨论',
  结论: '结论',
}

function slugifySection(title: string, index: number): string {
  const ascii = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const base = ascii !== '' ? ascii : `sec-${index + 1}`
  return `${String(index + 1).padStart(2, '0')}-${base}`
}

/** 骨架：sections 顺序取 venue.sectionOrder；必列章节缺失时仍按全序生成
 * （合规检查会提示缺声明/缺节——骨架先给全，作者自行删）。 */
export function renderScaffold(input: {
  readonly venue: VenueSchema
  readonly title: string
  readonly authors?: string
  readonly abstract?: string
}): ScaffoldPlan {
  const { venue } = input
  const zh = venue.lang === 'zh'
  const packages = [
    '\\usepackage{algorithm}',
    '\\usepackage{algorithmic}',
    '\\usepackage{booktabs}',
    '\\usepackage{tikz}',
    '\\usepackage{pgfplots}',
    '\\pgfplotsset{compat=1.18}',
    ...(zh ? [] : ['\\usepackage[T1]{fontenc}']),
  ]
  const classOptions = venue.classOptions.join(',')
  const mainTex = [
    `% 由 dsh-kylin-srw 生成（venue=${venue.id}，confidence=${venue.confidence}）`,
    `\\documentclass[${classOptions}]{${venue.documentClass}}`,
    ...packages,
    venue.bibTool === 'biber' ? '\\usepackage[style=gbt7714]{biblatex}' : '',
    `\\title{${escapeLatex(input.title)}}`,
    input.authors !== undefined ? `\\author{${escapeLatex(input.authors)}}` : `\\author{}`,
    `\\begin{document}`,
    `\\maketitle`,
    `\\begin{abstract}`,
    input.abstract !== undefined ? escapeLatex(input.abstract) : `% 摘要（≤${venue.abstractWords ?? 250} 词）`,
    `\\end{abstract}`,
    '',
    ...venue.sectionOrder.map((title, index) => `\\input{sections/${slugifySection(title, index)}} % ${title}`),
    '',
    `\\bibliographystyle{${venue.bibStyle}}`,
    `\\bibliography{refs}`,
    `\\end{document}`,
  ].filter(line => line !== '').join('\n') + '\n'

  const files: Record<string, string> = {}
  for (const [index, title] of venue.sectionOrder.entries()) {
    const label = PLACEHOLDER_TITLES[title] ?? title
    files[`sections/${slugifySection(title, index)}.tex`] = [
      `\\section{${escapeLatex(label)}}`,
      `% 目标：本节意图写在这里（大纲确认后由 agent 按档位起草）`,
      '',
    ].join('\n')
  }
  files['refs.bib'] = `% refs.bib——引用审计（srw_paper citeAudit/refsAppend）维护；勿手改条目 key\n`
  return {
    mainTex,
    files,
    sections: venue.sectionOrder.map((title, index) => `sections/${slugifySection(title, index)}.tex`),
  }
}

function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
}
