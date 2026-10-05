/** 翻译链（0205 Task 4.4 / R6）：逐块翻译——分块（≤4000 字符，超长句切）
 * → 并发闸（宿主无 p-limit，用自建 Limiter）→ 宿主只有 `llm.stream`
 * （无 complete）→ 窄面消费 text-delta 收文 → 逐块 deadline + 指数退避
 * 重试 2 → 外部取消及时中断。
 *
 * LLM 经窄面注入（真实装配走 `ctx.reflect.get('llm')`——0204 勘误 1 的
 * 围栏结论），测试注入假 LLM。 */
/** 宿主 llm 的窄消费面（只依赖我们用得到的形状；大小写遵循 StreamChunk）。 */
export interface LlmPort {
    stream(options: {
        provider: string;
        model: string;
        system?: string;
        messages: ReadonlyArray<{
            role: 'user';
            content: readonly [{
                type: 'text';
                text: string;
            }];
        }>;
        temperature?: number;
        signal?: AbortSignal;
    }): AsyncIterable<{
        type: 'text-delta';
        index: number;
        text: string;
    } | {
        type: 'usage';
        usage: {
            readonly totalTokens?: number;
        };
    } | {
        type: 'finish';
        reason: {
            readonly kind: string;
        };
    } | {
        type: 'block-start';
        index: number;
        blockType: string;
    } | {
        type: 'block-end';
        index: number;
        block: unknown;
    } | {
        type: 'reasoning-delta';
        index: number;
        text: string;
    } | {
        type: 'tool-call-delta';
        index: number;
        id: string;
        argumentsDelta: string;
    }>;
}
export declare const MAX_CHUNK_CHARS = 4000;
/** 超长块按句切子块（中英句号/问叹号；不跨切保证每片 ≤ maxChars）。 */
export declare function splitLongText(text: string, maxChars?: number): string[];
export interface TranslateDeps {
    readonly llm: LlmPort;
    readonly provider: string;
    readonly model: string;
    /** 并发闸位（默认 3，合法 1..6）。 */
    readonly concurrency?: number;
    /** 逐块 deadline（默认 120s）。 */
    readonly timeoutMs?: number;
    /** 尝试次数（默认 3 = 首次 + 重试 2）。 */
    readonly attempts?: number;
}
export interface TranslateInput {
    readonly id: string;
    readonly text: string;
}
export interface BlockTranslation {
    readonly id: string;
    readonly srcHash: string;
    readonly target: string;
    readonly model: string;
    readonly text: string;
    readonly at: string;
    readonly tokens?: number;
}
export interface TranslateReport {
    readonly results: readonly BlockTranslation[];
    readonly failures: readonly {
        readonly id: string;
        readonly error: string;
    }[];
    /** 实际发起的 LLM 调用次数（增量重译验收用：只打变化块）。 */
    readonly llmCalls: number;
    readonly tokens: number;
}
/** 逐块翻译：外部 signal 取消 → 立即抛 UpstreamError；单块失败不拖垮
 * 整批（进 failures）。llmCalls 计数真实上游调用（含重试）。 */
export declare function translateBlocks(deps: TranslateDeps, inputs: readonly TranslateInput[], options?: {
    glossary?: Readonly<Record<string, string>>;
    target?: string;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
}): Promise<TranslateReport>;
