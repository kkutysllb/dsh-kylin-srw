/** 译注版分析层（0205 附记四）：全文导读 + 每节【本节速览】/◆精读备注。
 * 翻译给出「说了什么」，这一层给出「怎么读」——参照用户既往精读成果的
 * 译注版体例。LLM 经窄面（宿主默认模型）逐节生成；输出是**结构化文本**
 * （字段行约定），不做 JSON——LLM 的 JSON 可靠性不够支撑逐字段渲染。 */

import { UpstreamError } from '../util/timeout.ts'
import type { LlmPort } from './translator.ts'
import type { ReadingSection } from './paragraphs.ts'

export interface SectionNote {
  /** 【本节速览】2-4 行（每行一条提要）。 */
  readonly summary: string
  /** ◆精读备注：要点/概念/论证/证据/评述 字段行。 */
  readonly note: string
}

export interface NotesFile {
  readonly version: 1
  readonly model: string
  readonly at: string
  /** 全文导读（多行结构化文本）；undefined = 未生成。 */
  readonly guide?: string
  readonly sections: Readonly<Record<string, SectionNote>>
}

export function emptyNotesFile(model: string): NotesFile {
  return { version: 1, model, at: new Date().toISOString(), sections: {} }
}

export const SECTION_SYSTEM_PROMPT = [
  '你是论文精读助手。基于给定的一节中文译文写精读批注，输出格式（严格遵守，字段名逐字照写）：',
  '【本节速览】',
  '- 提要1',
  '- 提要2（共 2-4 条）',
  '◆精读备注',
  '要点：本节论证的核心主张（一句话）',
  '概念：本节引入/使用的关键概念（含英文原词）',
  '论证：本节如何论证（方法/推理链）',
  '证据：引用的实验/数据/文献（数字与引用编号照抄译文）',
  '评述：译者判断——这一节哪里扎实、哪里存疑（必须标注「译者判断」字样）',
  '规则：忠实译文，禁止编造原文没有的内容；某字段无内容写「—」。',
].join('')

export const GUIDE_SYSTEM_PROMPT = [
  '你是论文精读助手。基于给出的标题、摘要与章节列表写全文导读，输出格式（严格遵守，字段名逐字照写）：',
  '类型判定：<综述/实证研究/方法论文/立场文章 等一句话判定>',
  '一句话概括：<不超过 60 字>',
  '要解决的问题：',
  '- 问题1（共 2-4 条）',
  '章节地图：',
  '<节名>：<一句话>（每章一行，按给定章节顺序）',
  '如果只记三件事：',
  '- 事1（恰好 3 条）',
  '规则：只依据给出的标题/摘要/章节名归纳，禁止编造论文没有的内容。',
].join('')

export function buildSectionPrompt(section: ReadingSection): string {
  const heading = section.headingTranslation !== undefined
    ? `${section.headingSource}（${section.headingTranslation}）`
    : section.headingSource
  const text = section.paragraphs
    .map(paragraph => paragraph.translation ?? '')
    .filter(text => text !== '')
    .join('\n')
    .slice(0, 4000)
  return `<节标题>${heading}</节标题>\n<节译文>\n${text}\n</节译文>`
}

export interface GuideInput {
  readonly title: string
  readonly abstract?: string
  readonly headings: readonly string[]
}

export function buildGuidePrompt(input: GuideInput): string {
  return [
    `<标题>${input.title}</标题>`,
    input.abstract !== undefined && input.abstract !== '' ? `<摘要译文>${input.abstract.slice(0, 2000)}</摘要译文>` : '<摘要译文>（缺失）</摘要译文>',
    `<章节列表>\n${input.headings.join('\n')}\n</章节列表>`,
  ].join('\n')
}

/** 解析节批注输出：以【本节速览】/◆精读备注 分段；字段缺失时整段退为
 * note（宁可有内容、不做假结构）。 */
export function parseSectionOutput(text: string): { summary: string; note: string } {
  const trimmed = text.trim()
  const summaryStart = trimmed.indexOf('【本节速览】')
  const noteStart = trimmed.indexOf('◆精读备注')
  if (summaryStart === -1 && noteStart === -1) return { summary: '', note: trimmed }
  const summary = summaryStart >= 0
    ? trimmed.slice(summaryStart + '【本节速览】'.length, noteStart > summaryStart ? noteStart : undefined).trim()
    : ''
  const note = noteStart >= 0 ? trimmed.slice(noteStart + '◆精读备注'.length).trim() : ''
  return { summary, note }
}

async function streamText(llm: LlmPort, options: {
  provider: string
  model: string
  system: string
  user: string
  timeoutMs: number
}): Promise<string> {
  // deadline 靠 AbortSignal.timeout：宿主 llm 窄面承诺响应 signal（translator 同款）
  const signal = AbortSignal.timeout(options.timeoutMs)
  let text = ''
  for await (const chunk of llm.stream({
    provider: options.provider,
    model: options.model,
    system: options.system,
    messages: [{ role: 'user', content: [{ type: 'text', text: options.user }] }],
    signal,
  })) {
    if (chunk.type === 'text-delta') text += chunk.text
  }
  return text
}

export interface NotesDeps {
  readonly llm: LlmPort
  readonly provider: string
  readonly model: string
  /** 逐节 deadline（默认 90s）。 */
  readonly timeoutMs?: number
}

/** 生成全文导读。 */
export async function generateGuide(deps: NotesDeps, input: GuideInput): Promise<string> {
  const text = await streamText(deps.llm, {
    provider: deps.provider,
    model: deps.model,
    system: GUIDE_SYSTEM_PROMPT,
    user: buildGuidePrompt(input),
    timeoutMs: deps.timeoutMs ?? 90_000,
  })
  if (text.trim() === '') throw new UpstreamError('导读生成返回空文本')
  return text.trim()
}

/** 生成一节的速览 + 备注。 */
export async function generateSectionNote(deps: NotesDeps, section: ReadingSection): Promise<SectionNote> {
  const text = await streamText(deps.llm, {
    provider: deps.provider,
    model: deps.model,
    system: SECTION_SYSTEM_PROMPT,
    user: buildSectionPrompt(section),
    timeoutMs: deps.timeoutMs ?? 90_000,
  })
  if (text.trim() === '') throw new UpstreamError('节备注生成返回空文本')
  return parseSectionOutput(text)
}
