/** 检索计划与重放（P0-5）：`<project>/literature/searches/<planId>.json`
 * 保存检索 DSL；`runs/<runId>/{plan.json,results.jsonl,summary.json}` 存运行
 * 快照。执行 = 三源并发（各源既有 RateGate）→ 归一化 → 以 identityKey 去重
 * （复用 identity 的合并守卫）→ 稳定排序（identityKey 升序）→ resultHash。
 * replay 只读本地 results.jsonl，不联网，离线可用。
 *
 * 设计口径（0203/01-查论文 §4.3）：
 * - plan.save 不触网；plan.run 才触网，离线抛 OFFLINE；
 * - 同一 plan 连续 live run 的 resultHash 必须一致（排序与身份规则确定性）；
 * - 在线 API 漂移只允许体现为 diff 的新增/消失，不允许同键漂移。
 */
import { type SrwFsLike } from '../host.ts';
import type { LitCandidate, LitSource } from './types.ts';
export declare const PLAN_SCHEMA_VERSION = 1;
export declare const MAX_PER_SOURCE_LIMIT = 50;
export declare const MAX_SOURCES = 3;
export declare const PLAN_SORTS: readonly ["relevance", "citations", "year"];
export type PlanSort = (typeof PLAN_SORTS)[number];
export declare const PLAN_SOURCES: readonly LitSource[];
export interface PlanFilters {
    readonly yearFrom?: number;
    readonly yearTo?: number;
    readonly source?: readonly LitSource[];
}
export interface PlanQuery {
    readonly text: string;
    readonly filters?: PlanFilters;
}
export interface SearchPlan {
    readonly schemaVersion: typeof PLAN_SCHEMA_VERSION;
    readonly planId: string;
    readonly query: PlanQuery;
    readonly sources: readonly LitSource[];
    readonly perSourceLimit: number;
    readonly sort: PlanSort;
    readonly createdAt: string;
}
export interface PlanRunCounts {
    readonly bySource: Readonly<Record<string, number>>;
    readonly identified: number;
    readonly deduped: number;
}
export interface PlanRunError {
    readonly source: string;
    readonly code: string;
    readonly message: string;
}
export interface PlanRunSummary {
    readonly runId: string;
    readonly planId: string;
    readonly counts: PlanRunCounts;
    readonly resultHash: string;
    readonly startedAt: string;
    readonly finishedAt: string;
    readonly errors: readonly PlanRunError[];
}
export interface PlanRunResult extends PlanRunSummary {
    readonly runDir: string;
    readonly plan: SearchPlan;
    readonly resultKeys: readonly string[];
}
export interface ReplayDiff {
    readonly added: readonly string[];
    readonly removed: readonly string[];
}
export interface ReplayResult {
    readonly planId: string;
    readonly runId: string;
    readonly previousRunId?: string;
    readonly resultHash: string;
    readonly recomputedHash: string;
    readonly consistent: boolean;
    readonly diff: ReplayDiff;
    readonly integrity: {
        readonly added: readonly string[];
        readonly removed: readonly string[];
    };
    readonly keyCount: number;
    readonly keys: readonly string[];
}
/** 计划执行依赖：search 由 LiteratureService 注入（测试可给纯函数）。 */
export interface PlanDeps {
    readonly fs: SrwFsLike | undefined;
    readonly rootDir: string;
    readonly offline: () => boolean;
    readonly search: (source: LitSource, query: string, limit: number) => Promise<readonly LitCandidate[]>;
    readonly now?: () => Date;
    readonly newRunId?: () => string;
}
export interface SavePlanInput {
    readonly text?: unknown;
    readonly query?: unknown;
    readonly sources?: unknown;
    readonly perSourceLimit?: unknown;
    readonly limit?: unknown;
    readonly sort?: unknown;
    readonly filters?: unknown;
    readonly planId?: unknown;
}
/** 保存计划（不触网）：planId 由内容指纹确定性生成；同内容重复保存保留
 * 原 createdAt，不产生新文件。 */
export declare function savePlan(deps: PlanDeps, project: string, input: SavePlanInput): Promise<SearchPlan>;
/** 读计划；缺失 → NOT_FOUND，形状坏 → INVALID。 */
export declare function loadPlan(deps: PlanDeps, project: string, planId: string): Promise<SearchPlan>;
/** 列计划（createdAt 倒序；坏文件跳过，不让一个坏计划毁掉列表）。 */
export declare function listPlans(deps: PlanDeps, project: string): Promise<readonly SearchPlan[]>;
/** resultHash = sha256(JSON.stringify(sortedIdentityKeys))（hex）。 */
export declare function resultHashOf(keys: readonly string[]): string;
/** 执行计划：三源并发（各源自带 RateGate）→ 过滤 → 去重 → 稳定排序 → 快照。 */
export declare function runPlan(deps: PlanDeps, project: string, planId: string): Promise<PlanRunResult>;
/** 离线重放：只读本地 results.jsonl 重算 resultHash，并给出 diff。
 * 有上一 run 时 diff 是「本次相对上次」的新增/消失；否则 diff 是
 * 「重算相对文件记录」的一致性差异（正常为空）。 */
export declare function replayPlan(deps: PlanDeps, project: string, planId: string, runId?: string): Promise<ReplayResult>;
