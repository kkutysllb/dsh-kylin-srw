/** 专利域 schema（M9-lite 第一批）：patent.json / disclosure.json /
 * events.jsonl 行的手写校验器（照 src/core/schema.ts 的 validateProjectMeta
 * 风格：零依赖、返回中文错误清单而非抛错——RPC INVALID 聚合与 list 的
 * 「坏文件跳过」共用同一判定）。全部 schemaVersion:1；ISO 时间用
 * Date.parse 判定（与 validateProjectMeta 同口径）。
 *
 * 法务口径（analysis/goals/03-写专利.md §2，设计输入、不构成法律意见）：
 * MVP 只做中国发明专利（kind/jurisdiction 恒 invention/CN）；宽限期仅
 * 四种法定情形且窗口为申请日前 6 个月。 */
export declare const PATENT_SCHEMA_VERSION = 1;
/** 专利状态机（03 报告 §4）：idea → disclosure → … → granted|rejected|abandoned。 */
export declare const PATENT_STATUSES: readonly ["idea", "disclosure", "searching", "drafted", "checked", "filing-ready", "filed", "published", "oa", "granted", "rejected", "abandoned"];
export type PatentStatus = (typeof PATENT_STATUSES)[number];
/** 申请登记（手工回填；MVP 只支持中国发明专利）。 */
export interface PatentFiling {
    readonly applicationNo: string;
    readonly filedAt: string;
    readonly jurisdiction: 'CN';
}
export interface PatentMeta {
    readonly schemaVersion: typeof PATENT_SCHEMA_VERSION;
    readonly patentId: string;
    readonly title: string;
    readonly kind: 'invention';
    readonly status: PatentStatus;
    readonly inventors: readonly string[];
    readonly applicants: readonly string[];
    readonly filing?: PatentFiling;
    readonly createdAt: string;
    readonly updatedAt: string;
}
/** ISO 时间判定（与 validateProjectMeta 的 createdAt/updatedAt 同口径）。 */
export declare function isIsoTime(value: unknown): value is string;
/** 校验 patent.json 形状；返回中文错误清单（空数组 = 合法）。 */
export declare function validatePatentMeta(value: unknown): string[];
/** 有益效果：evidence 是证据指针（产物/文件路径）或字面 'TODO'（待补）。 */
export interface BeneficialEffect {
    readonly text: string;
    readonly evidence: string;
}
export interface DisclosureAttachment {
    readonly path: string;
    readonly note?: string;
}
/** 技术交底书（disclosure.json；问题-方案-效果-实施例 skeleton）。 */
export interface Disclosure {
    readonly schemaVersion: typeof PATENT_SCHEMA_VERSION;
    readonly technicalField: string;
    readonly backgroundArt: string;
    readonly problem: string;
    readonly solution: string;
    readonly embodiments: readonly string[];
    readonly beneficialEffects: readonly BeneficialEffect[];
    readonly attachments: readonly DisclosureAttachment[];
}
/** 宽容归一：把任意输入拉成 Disclosure 形状（缺省填空/TODO），交
 * validateDisclosure 报错。整体替换保存前的唯一入口。 */
export declare function normalizeDisclosure(value: unknown): Disclosure;
/** 校验 disclosure.json 形状；返回中文错误清单（空数组 = 合法）。 */
export declare function validateDisclosure(value: unknown): string[];
/** 公开事件类别（03 报告 §6）：paper/预印本/会议/学位论文/代码/其他公开 +
 * 申请登记（filed）与宽限声明（grace-declared）。 */
export declare const PUBLIC_EVENT_KINDS: readonly ["paper-submitted", "preprint-published", "conference-talk", "thesis", "code-release", "other-public", "filed", "grace-declared"];
export type PublicEventKind = (typeof PUBLIC_EVENT_KINDS)[number];
/** 宽限期四种法定情形 + none（专利法第 24 条；「规定的学术会议」极窄）。 */
export declare const GRACE_CASES: readonly ["none", "government-emergency", "international-exhibition", "prescribed-academic-conference", "unconsented-disclosure"];
export type GraceCase = (typeof GRACE_CASES)[number];
/** events.jsonl 一行（append-only，每行一个 JSON）。 */
export interface PublicEvent {
    readonly at: string;
    readonly kind: PublicEventKind;
    readonly description: string;
    readonly publicAt: string;
    readonly graceCase: GraceCase;
    readonly source?: string;
}
/** 宽容归一：at 缺省取 nowIso、graceCase 缺省 none；其余交 validatePublicEvent。 */
export declare function normalizePublicEvent(value: unknown, nowIso: string): PublicEvent;
/** 校验 events.jsonl 行；返回中文错误清单（空数组 = 合法）。 */
export declare function validatePublicEvent(value: unknown): string[];
