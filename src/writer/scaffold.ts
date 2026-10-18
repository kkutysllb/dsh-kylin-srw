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

/** main.tex 的输入清单标记：outline.save/confirm 与 compile 都按这对标记
 * 重写同一段，避免「大纲改名、正文写进不被编译的文件」静默丢节。 */
export const INPUT_BEGIN = '% srw:inputs:begin'
export const INPUT_END = '% srw:inputs:end'

/** 章节文件相对路径的合法形状（防大纲里写入 ../ 或绝对路径）。 */
export function isSafeSectionFile(file: string): boolean {
  return /^sections\/[A-Za-z0-9._-]+\.tex$/.test(file)
}

/** 把 \input 里的路径归一成相对 .tex（sections/01-intro → sections/01-intro.tex）。 */
export function normalizeInputPath(raw: string): string {
  const trimmed = raw.trim().replace(/\\/g, '/')
  return trimmed.endsWith('.tex') ? trimmed : trimmed + '.tex'
}

/** 从 main.tex 提取 sections/ 输入清单（保持出现顺序）。 */
export function sectionInputPaths(mainTex: string): string[] {
  const paths: string[] = []
  for (const match of mainTex.matchAll(/^\s*\\input\{([^}]+)\}/gm)) {
    const path = normalizeInputPath(match[1] ?? '')
    if (path.startsWith('sections/')) paths.push(path)
  }
  return paths
}

/** 用大纲的章节文件重写 main.tex 的输入清单。
 * 新项目走标记块；旧项目（无标记）替换第一段连续的 \input{sections/…}；
 * 都没有则插到 \bibliographystyle/\bibliography 之前（最后退 \end{document}）。 */
export function syncInputBlock(mainTex: string, sections: readonly { readonly title: string; readonly file: string }[]): string {
  const block = [
    INPUT_BEGIN,
    ...sections.map(section => '\\input{' + section.file.replace(/\.tex$/, '') + '} % ' + section.title.replace(/\s+/g, ' ')),
    INPUT_END,
  ].join('\n')
  const begin = mainTex.indexOf(INPUT_BEGIN)
  const end = mainTex.indexOf(INPUT_END)
  if (begin >= 0 && end > begin) {
    return mainTex.slice(0, begin) + block + mainTex.slice(end + INPUT_END.length)
  }
  const lines = mainTex.split('\n')
  const isInput = (line: string): boolean => /^\s*\\input\{sections\/[^}]+\}/.test(line)
  const first = lines.findIndex(isInput)
  if (first >= 0) {
    let last = first
    while (last + 1 < lines.length && isInput(lines[last + 1] ?? '')) last += 1
    lines.splice(first, last - first + 1, ...block.split('\n'))
    return lines.join('\n')
  }
  const anchor = lines.findIndex(line => /^\s*\\(bibliographystyle|bibliography)\b/.test(line))
  const at = anchor >= 0 ? anchor : lines.findIndex(line => /^\s*\\end\{document\}/.test(line))
  if (at < 0) return mainTex.trimEnd() + '\n\n' + block + '\n'
  lines.splice(at, 0, ...block.split('\n'), '')
  return lines.join('\n')
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
    INPUT_BEGIN,
    ...venue.sectionOrder.map((title, index) => `\\input{sections/${slugifySection(title, index)}} % ${title}`),
    INPUT_END,
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
