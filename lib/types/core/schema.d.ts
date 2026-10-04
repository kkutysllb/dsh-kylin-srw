/** 零依赖手写校验器（ADR：M1 不引 zod 进 schema 面）：返回错误清单而非抛错，
 * RPC INVALID 聚合与 WorkspaceStore 的「坏文件跳过」共用同一判定。
 * storage 域无迁移机制（0102 §6.3）：version 恒 1，只加可选字段。 */
export interface ProjectMeta {
    readonly schemaVersion: 1;
    readonly slug: string;
    readonly title: string;
    readonly field?: string;
    readonly stage: 'idea' | 'literature' | 'reading' | 'writing' | 'experiments' | 'submission';
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly targetVenue?: string;
    readonly depthTier?: 'D1' | 'D2' | 'D3';
}
export declare const STAGES: readonly ["idea", "literature", "reading", "writing", "experiments", "submission"];
export declare const SLUG_RE: RegExp;
/** 校验 project.json 形状；返回中文错误清单（空数组 = 合法）。 */
export declare function validateProjectMeta(value: unknown): string[];
