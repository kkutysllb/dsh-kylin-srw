/** 能力探测（M0 诊断面 / Phase 0 V 系列的数据源）。
 *
 * 纯函数：给定任意宿主 ctx（真实 cordis ctx 或测试 fake），逐个软探测
 * 宿主服务与关键方法是否存在。绝不抛错——缺席就是「不可用」这个事实本身。
 * 探测清单与 0102 §5.3 兼容矩阵一一对应，E1/E2 的结论据此回填。
 */
export interface CapRow {
    readonly name: string;
    readonly available: boolean;
    readonly detail: string;
}
export declare function collectCaps(ctx: unknown): readonly CapRow[];
/** 宿主 home 口径（0102 §5.3：双通道 home 不同，经此单点解析，不硬编码）。 */
export declare function hostHomeFromEnv(env: Record<string, string | undefined>, homedir: string): {
    channel: 'qilin' | 'dsh' | 'unknown';
    home: string;
};
