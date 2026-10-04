/** storage 域 `srw_index` v1（0102 §6.3 / 0202 Task 1.4）：SRW 的持久索引。
 *
 * - spec 本体是纯数据 + zod schema（宿主 DomainFacility 只鸭子调 `.parse`，
 *   与宿主 zod ^4.4 同代同源，跨实例无兼容问题）。
 * - version 恒 1（storage 域无迁移机制）：只加可选字段 + `.default()`。
 * - `global`：`{rootDir, activeProject}` —— root.set / project.open 的
 *   持久落点（root.json 是根内配置，这里是「哪个根」的权威记忆）。
 * - `projectCache` 表：项目列表投影缓存（list 实扫的加速面，可丢弃——
 *   真相源始终是目录里的 project.json）。
 * - spec 的早期校验（name/table 合法、version 非负整数、global 不收 null）
 *   本地复刻宿主 defineDomain 的检查——模块加载即 fail loud，不等宿主。
 */
import { z } from 'zod';
export interface SrwIndexGlobal {
    rootDir: string;
    activeProject: string;
}
export declare const ProjectCacheEntry: z.ZodObject<{
    slug: z.ZodString;
    title: z.ZodString;
    stage: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type ProjectCacheEntry = z.output<typeof ProjectCacheEntry>;
export declare const SrwIndexGlobalSchema: z.ZodObject<{
    rootDir: z.ZodDefault<z.ZodString>;
    activeProject: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export declare const SrwIndexSpec: {
    readonly name: "srw_index";
    readonly version: 1;
    readonly layout: "single";
    readonly global: {
        readonly schema: z.ZodObject<{
            rootDir: z.ZodDefault<z.ZodString>;
            activeProject: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>;
        readonly initial: {
            readonly rootDir: "";
            readonly activeProject: "";
        };
    };
    readonly tables: {
        readonly project_cache: {
            readonly valueSchema: z.ZodObject<{
                slug: z.ZodString;
                title: z.ZodString;
                stage: z.ZodString;
                updatedAt: z.ZodString;
            }, z.core.$strip>;
        };
    };
};
/** 宿主 defineDomain 的早期校验复刻（模块加载即执行）。 */
export declare function assertValidDomainSpec(spec: typeof SrwIndexSpec): void;
/** 宿主 Domain handle 的最小结构面（本插件用到的成员）。 */
export interface SrwIndexDomain {
    readonly global: {
        get(): SrwIndexGlobal;
        set(value: SrwIndexGlobal): Promise<void>;
    };
    table(name: string): {
        get(key: string): unknown;
        entries(): IterableIterator<[string, unknown]>;
        put(key: string, value: unknown): Promise<void>;
        delete(key: string): Promise<boolean>;
    };
    close(): Promise<void> | void;
}
/** 从注入的 storageDomain 打开 srw_index；失败抛错由调用方决定降级姿态。 */
export declare function openSrwIndex(storageDomain: unknown): Promise<SrwIndexDomain>;
