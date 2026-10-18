/** 翻译链（0205 Task 4.4 / R6）：逐块翻译——分块（≤4000 字符，超长句切）
 * → 并发闸（宿主无 p-limit，用自建 Limiter）→ 宿主只有 `llm.stream`
 * （无 complete）→ 窄面消费 text-delta 收文 → 逐块 deadline + 指数退避
 * 重试 2 → 外部取消及时中断。
 *
 * LLM 经窄面注入（真实装配走 `ctx.reflect.get('llm')`——0204 勘误 1 的
 * 围栏结论），测试注入假 LLM。 */

import { Limiter, limitedMap } from '../util/limiter.ts'
import { retryWithBackoff, TimeoutError, timeoutOf, UpstreamError } from '../util/timeout.ts'
import { srcHashOf } from './source-map.ts'

/** 宿主 llm 的窄消费面（只依赖我们用得到的形状；大小写遵循 StreamChunk）。 */
export interface LlmPort {
  stream(options: {
    provider: string
    model: string
    system?: string
    messages: ReadonlyArray<{ role: 'user'; content: readonly [{ type: 'text'; text: string }] }>
    temperature?: number
    signal?: AbortSignal
  }): AsyncIterable<
    | { type: 'text-delta'; index: number; text: string }
    | { type: 'usage'; usage: { readonly totalTokens?: number } }
    | { type: 'finish'; reason: { readonly kind: string } }
    | { type: 'block-start'; index: number; blockType: string }
    | { type: 'block-end'; index: number; block: unknown }
    | { type: 'reasoning-delta'; index: number; text: string }
    | { type: 'tool-call-delta'; index: number; id: string; argumentsDelta: string }
  >
}

export const MAX_CHUNK_CHARS = 4000

/** 超长块按句切子块（中英句号/问叹号；不跨切保证每片 ≤ maxChars）。 */
export function splitLongText(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  if (text.length <= maxChars) return [text]
  const sentences = text.split(/(?<=[。！？.!?])\s*/)
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    // 单句超限：硬切（无句读的极端情况）
    if (sentence.length > maxChars) {
      if (current !== '') {
        chunks.push(current)
        current = ''
      }
      for (let offset = 0; offset < sentence.length; offset += maxChars) {
        chunks.push(sentence.slice(offset, offset + maxChars))
      }
      continue
    }
    if (current !== '' && current.length + sentence.length + 1 > maxChars) {
      chunks.push(current)
      current = sentence
    } else {
      current = current === '' ? sentence : `${current} ${sentence}`
    }
  }
  if (current !== '') chunks.push(current)
  return chunks
}

const SYSTEM_PROMPT = [
  '你是学术文献精读翻译引擎。把用户给出的论文片段准确翻译为中文，体例：',
  '数字与统计零误差照抄原文，不得换算、四舍五入、增删（如 1,250、74%、3.2×、10^5）；',
  '引用标记 [12]、(Vaswani et al., 2017) 与交叉引用 §3.1、Fig. 2、Table 4 保留原形不改写；',
  '系统名/模型名/数据集名保留英文（Transformer、GLM、ImageNet）；专业术语首次出现时在中文译名后括注英文原词；',
  '保留数学公式、代码原文；',
  '术语表（若给出）中的条目必须使用指定译名（硬约束）；',
  '只输出译文，不要解释、不要加前缀后缀。',
].join('')

function userPrompt(text: string, glossary: Readonly<Record<string, string>>): string {
  const entries = Object.entries(glossary)
  const glossaryBlock = entries.length > 0
    ? `\n\n术语表（必须使用指定译名）：\n${entries.map(([term, translation]) => `- ${term} → ${translation}`).join('\n')}`
    : ''
  return `翻译为中文：\n\n<src>\n${text}\n</src>${glossaryBlock}`
}

export interface TranslateDeps {
  readonly llm: LlmPort
  readonly provider: string
  readonly model: string
  /** 并发闸位（默认 3，合法 1..6）。 */
  readonly concurrency?: number
  /** 逐块 deadline（默认 120s）。 */
  readonly timeoutMs?: number
  /** 尝试次数（默认 3 = 首次 + 重试 2）。 */
  readonly attempts?: number
}

export interface TranslateInput {
  readonly id: string
  readonly text: string
}

export interface BlockTranslation {
  readonly id: string
  readonly srcHash: string
  readonly target: string
  readonly model: string
  readonly text: string
  readonly at: string
  readonly tokens?: number
}

export interface TranslateReport {
  readonly results: readonly BlockTranslation[]
  readonly failures: readonly { readonly id: string; readonly error: string }[]
  /** 实际发起的 LLM 调用次数（增量重译验收用：只打变化块）。 */
  readonly llmCalls: number
  readonly tokens: number
}

/** 逐块翻译：外部 signal 取消 → 立即抛 UpstreamError；单块失败不拖垮
 * 整批（进 failures）。llmCalls 计数真实上游调用（含重试）。 */
export async function translateBlocks(
  deps: TranslateDeps,
  inputs: readonly TranslateInput[],
  options: {
    glossary?: Readonly<Record<string, string>>
    target?: string
    signal?: AbortSignal
    onProgress?: (done: number, total: number) => void
  } = {},
): Promise<TranslateReport> {
  const concurrency = Math.min(6, Math.max(1, deps.concurrency ?? 3))
  const timeoutMs = deps.timeoutMs ?? 120_000
  const attempts = Math.max(1, deps.attempts ?? 3)
  const target = options.target ?? 'zh'
  const glossary = options.glossary ?? {}
  const limiter = new Limiter(concurrency)
  const results: BlockTranslation[] = []
  const failures: { id: string; error: string }[] = []
  let llmCalls = 0
  let tokens = 0
  let done = 0
  const startedAt = new Date().toISOString()

  // 外部取消 → 立刻整体失败（不再调度新块）
  const cancellation = new Promise<never>((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => {
      reject(new UpstreamError(new Error('translation cancelled')))
    }, { once: true })
  })

  const worker = async (input: TranslateInput): Promise<void> => {
    const chunks = splitLongText(input.text)
    try {
      const pieces = await Promise.all(chunks.map(chunk => retryWithBackoff({
        attempts,
        baseMs: 500,
        isRetryable: () => options.signal?.aborted !== true,
        run: async () => {
          llmCalls += 1
          return await timeoutOf(timeoutMs, async signal => {
            let callTokens = 0
            const stream = deps.llm.stream({
              provider: deps.provider,
              model: deps.model,
              system: SYSTEM_PROMPT,
              messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt(chunk, glossary) }] }],
              temperature: 0.2,
              signal,
            })
            let translated = ''
            for await (const item of stream) {
              if (item.type === 'text-delta') translated += item.text
              else if (item.type === 'usage') callTokens = item.usage.totalTokens ?? 0
              else if (item.type === 'finish' && (item.reason.kind === 'error' || item.reason.kind === 'aborted')) {
                throw new Error(`llm stream finished with ${item.reason.kind}`)
              } else if (item.type === 'finish' && item.reason.kind === 'length') {
                // P0-7：截断译文不是完整译文——按失败处理，绝不写缓存
                throw new Error('llm stream truncated (finish reason=length)')
              }
            }
            tokens += callTokens
            const trimmed = translated.trim()
            if (trimmed === '') throw new Error('llm stream produced empty translation')
            return trimmed
          }, options.signal)
        },
      })))
      results.push({
        id: input.id,
        srcHash: srcHashOf(input.text),
        target,
        model: deps.model,
        text: pieces.join('\n\n'),
        at: startedAt,
      })
    } catch (error: unknown) {
      if (options.signal?.aborted === true) throw new UpstreamError(new Error('translation cancelled'))
      failures.push({ id: input.id, error: error instanceof Error ? error.message : String(error) })
    } finally {
      done += 1
      options.onProgress?.(done, inputs.length)
    }
  }

  const run = limitedMap(limiter, inputs, worker)
  try {
    await Promise.race([cancellation, run])
  } finally {
    run.catch(() => { /* 竞速落败侧（整体取消）的迟到拒绝不再冒泡 */ })
  }
  return { results, failures, llmCalls, tokens }
}
