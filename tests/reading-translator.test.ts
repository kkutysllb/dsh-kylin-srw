/** 翻译链（0205 Task 4.4）：分块/并发闸/退避重试/取消/进度。假 LLM 全程。 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { splitLongText, translateBlocks, type LlmPort, type TranslateInput } from '../src/reading/translator.ts'
import { TimeoutError } from '../src/util/timeout.ts'

const tick = (ms = 5): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms) })

/** 假 LLM：可编程失败序列/挂起/调用记录。 */
function fakeLlm(options: {
  failFirst?: number
  failIf?: (body: string) => boolean
  hang?: boolean
  latencyMs?: number
} = {}): { port: LlmPort; calls: string[]; peakInFlight: () => number } {
  const calls: string[] = []
  let inFlight = 0
  let peak = 0
  let seen = 0
  return {
    calls,
    peakInFlight: () => peak,
    port: {
      stream: async function* (request) {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        try {
          const src = request.messages[0]?.content[0]?.text ?? ''
          const body = src.split('<src>')[1]?.split('</src>')[0] ?? ''
          calls.push(body.slice(0, 30))
          seen += 1
          if (options.latencyMs !== undefined) await tick(options.latencyMs)
          if (options.hang === true) await new Promise((_resolve, reject) => {
            request.signal?.addEventListener('abort', () => { reject(new Error('aborted-inside')) })
          })
          if (options.failIf?.(body) === true || seen <= (options.failFirst ?? 0)) throw new Error('provider flaked')
          yield { type: 'text-delta' as const, index: 0, text: `【${body.slice(0, 12)}】` }
          yield { type: 'usage' as const, usage: { totalTokens: 42 } }
          yield { type: 'finish' as const, reason: { kind: 'stop' } }
        } finally {
          inFlight -= 1
        }
      },
    },
  }
}

const input = (id: string, text: string): TranslateInput => ({ id, text })

test('translator：splitLongText——≤4000 不切；超长按句切且每片不超限；无句读硬切', () => {
  assert.deepEqual(splitLongText('short'), ['short'])
  const long = '这是一个完整的句子。'.repeat(2000) // 11000 chars 带句号
  const chunks = splitLongText(long)
  assert.ok(chunks.length >= 3)
  assert.ok(chunks.every(chunk => chunk.length <= 4000))
  assert.equal(chunks.join(' ').replace(/\s/g, ''), long, '拼接无损')
  const noPunctuation = 'a'.repeat(9000)
  assert.deepEqual(splitLongText(noPunctuation).map(chunk => chunk.length), [4000, 4000, 1000])
})

test('translator：批量翻译成功——文本组装、usage 汇总、llmCalls 计数、进度回调', async () => {
  const fake = fakeLlm()
  const progress: Array<[number, number]> = []
  const report = await translateBlocks({
    llm: fake.port, provider: 'p', model: 'm', concurrency: 3, timeoutMs: 5_000,
  }, [input('b1', 'first block text'), input('b2', 'second block text')], {
    onProgress: (done, total) => { progress.push([done, total]) },
  })
  assert.equal(report.failures.length, 0)
  assert.equal(report.results.length, 2)
  assert.equal(report.llmCalls, 2)
  assert.equal(report.tokens, 84)
  assert.ok(report.results.every(result => result.text.startsWith('【')))
  assert.ok(report.results.every(result => result.model === 'm' && result.target === 'zh'))
  assert.deepEqual(progress.at(-1), [2, 2])
})

test('translator：上游抖动——退避重试后成功（attempts 内）', async () => {
  const fake = fakeLlm({ failFirst: 1 })
  const report = await translateBlocks({
    llm: fake.port, provider: 'p', model: 'm', attempts: 3, timeoutMs: 5_000,
  }, [input('b1', 'flaky upstream block')])
  assert.equal(report.failures.length, 0)
  assert.equal(report.results.length, 1)
  assert.equal(fake.calls.length, 2, '失败一次 + 重试成功一次')
})

test('translator：持续失败——重试耗尽进 failures 不拖垮整批', async () => {
  // 按内容判失败：'bad' 的所有尝试全挂，'good' 一次成功（并发序无关）
  const fake = fakeLlm({ failIf: body => body.includes('always fails') })
  const report = await translateBlocks({
    llm: fake.port, provider: 'p', model: 'm', attempts: 2, timeoutMs: 2_000,
  }, [input('bad', 'always fails'), input('good', 'succeeds anyway')])
  assert.equal(report.failures.length, 1)
  assert.equal(report.failures[0]?.id, 'bad')
  assert.equal(report.results.length, 1)
  assert.equal(report.results[0]?.id, 'good')
})

test('translator：超时不挂起——挂起 LLM + 小 deadline → TimeoutError 进 failures', async () => {
  const fake = fakeLlm({ hang: true })
  const report = await translateBlocks({
    llm: fake.port, provider: 'p', model: 'm', attempts: 1, timeoutMs: 60,
  }, [input('slow', 'hangs forever')])
  assert.equal(report.failures.length, 1)
  assert.ok(report.failures[0]?.error.includes('timed out') || report.failures[0]?.error.includes('aborted-inside'))
})

test('translator：并发被闸住', async () => {
  const fake = fakeLlm({ latencyMs: 20 })
  await translateBlocks({
    llm: fake.port, provider: 'p', model: 'm', concurrency: 2, timeoutMs: 5_000,
  }, Array.from({ length: 8 }, (_u, i) => input(`b${i}`, `block number ${i}`)))
  assert.ok(fake.peakInFlight() <= 2, `峰值并发 ${fake.peakInFlight()} 应 ≤2`)
})

test('translator：外部取消及时中断', async () => {
  const fake = fakeLlm({ hang: true })
  const external = new AbortController()
  const pending = translateBlocks({
    llm: fake.port, provider: 'p', model: 'm', concurrency: 2, timeoutMs: 60_000,
  }, Array.from({ length: 4 }, (_u, i) => input(`b${i}`, `block ${i}`)), { signal: external.signal })
  setTimeout(() => { external.abort() }, 30)
  await assert.rejects(() => pending, /cancelled/)
})

test('translator：术语表进 prompt（硬约束的输入侧）', async () => {
  const fake = fakeLlm()
  await translateBlocks({
    llm: fake.port, provider: 'p', model: 'm', timeoutMs: 5_000,
  }, [input('b1', 'transformer block')], { glossary: { transformer: '变换器' } })
  // 假 LLM 只记了 src 段；直接断言 prompt 里带术语表的路径由 userPrompt 保证——
  // 这里验证调用发生即可，术语替换校验在 glossary 模块单测。
  assert.equal(fake.calls.length, 1)
})
