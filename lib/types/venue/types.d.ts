/** 刊物要求 schema（0102 §7.3）：注册表随插件分发的种子数据 + 项目内实例。
 * **诚实性约束**：刊物事实一律带 `confidence` 与 `sources`——`unverified`
 * 只做建议（不阻断），人工核定后才升级为阻断（RISK-7）。 */
export type DepthTier = 'D1' | 'D2' | 'D3';
export type ReferenceStyle = 'ieee' | 'acm' | 'apa' | 'gbt7714' | 'numeric' | 'authoryear';
export type StatementKind = 'dataAvailability' | 'codeAvailability' | 'limitations' | 'conflictOfInterest' | 'ethics' | 'authorContributions';
export interface VenueSource {
    readonly url: string;
    readonly checkedAt: string;
}
export interface VenueSchema {
    readonly schemaVersion: 1;
    readonly id: string;
    readonly name: string;
    /** LaTeX documentclass（IEEEtran / acmart / llncs / ctexart…）。 */
    readonly documentClass: string;
    readonly classOptions: readonly string[];
    /** 参考文献样式（\bibliographystyle 或 biblatex style）。 */
    readonly bibStyle: string;
    readonly bibTool: 'bibtex' | 'biber';
    readonly columns: 1 | 2;
    readonly pageLimit?: {
        readonly regular: number;
        readonly note?: string;
    };
    readonly abstractWords?: number;
    readonly sectionOrder: readonly string[];
    readonly mandatorySections: readonly string[];
    readonly mandatoryStatements: readonly StatementKind[];
    readonly referenceStyle: ReferenceStyle;
    readonly figureDpi?: number;
    readonly depthTier: DepthTier;
    readonly confidence: 'verified' | 'unverified';
    readonly sources: readonly VenueSource[];
    /** 中文期刊单列（ctex + GB/T 7714）。 */
    readonly lang: 'en' | 'zh';
}
/** 手写校验（宿主无 zod/ajv；0102 §7.1.2 纪律——缺什么建什么）。 */
export declare function validateVenue(raw: unknown): VenueSchema;
