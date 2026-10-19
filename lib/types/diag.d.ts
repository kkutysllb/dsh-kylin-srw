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
    /** unavailable 且属「按设计不注入」时的原因（供诊断面三态渲染：
     * 绿=可用 / 灰=按设计 / 红=意外缺席）。有 inject 围栏的宿主上，
     * 未注入服务读属性会抛 without-inject——那是围栏按设计触发，不是故障。 */
    readonly byDesign?: string;
}
export declare function collectCaps(ctx: unknown): readonly CapRow[];
