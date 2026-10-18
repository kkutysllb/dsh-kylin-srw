/** 科研总根配置（`.srw/root.json`，B 路线）：settings.register 后置到 V15
 * （宿主 schemastery 运行时不可达，见 0202 Task 1.1 决策），用户级根内设置
 * 以文件为真相源。读失败一律回落默认值（缺文件与坏文件同权），写走
 * tmp→rename 原子替换（与 writeBinary 同纪律）。
 *
 * P0-4/P0-5 追加（全部可选，缺省空；无迁移纪律）：
 * - openalexMailto?    OpenAlex 礼貌池邮箱；
 * - unpaywallEmail?    Unpaywall 必填真实邮箱（缺 → fulltext 报 INVALID 提示配置）；
 * - fulltext.confirmedHosts[]  用户确认过的出版商/仓储 PDF 域（白名单只可加）。
 */
export interface FulltextConfig {
    /** 用户显式确认过的全文 PDF 主机（小写、无端口）。 */
    readonly confirmedHosts?: readonly string[];
}
export interface RootConfig {
    readonly schemaVersion: 1;
    readonly defaultLangPair: 'en-zh' | 'zh-en';
    readonly allowIllustrative: boolean;
    readonly offlineMode: boolean;
    /** Crossref 礼貌池邮箱（可选，加字段不加版本——0102 §6.3 无迁移纪律）。 */
    readonly politeMailto?: string;
    /** OpenAlex 礼貌池邮箱（可选；P0-5 起可配）。 */
    readonly openalexMailto?: string;
    /** Unpaywall 必填邮箱（可选；P0-4 全文获取用）。 */
    readonly unpaywallEmail?: string;
    /** 全文获取域确认（可选；缺省无额外主机）。 */
    readonly fulltext?: FulltextConfig;
}
export declare const DEFAULT_ROOT: RootConfig;
export declare function rootConfigPath(rootAbs: string): string;
/** 读根配置；缺文件/坏文件/字段非法逐项钳回默认（无迁移：version 恒 1）。 */
export declare function readRootConfig(rootAbs: string): Promise<RootConfig>;
/** 合并写入根配置（补 `.srw` 目录），返回合并后的完整配置。 */
export declare function writeRootConfig(rootAbs: string, patch: Partial<Omit<RootConfig, 'schemaVersion'>>): Promise<RootConfig>;
/** P0-4 域确认写回：把用户显式允许的主机并入 fulltext.confirmedHosts。
 * 非法主机名抛 INVALID（用 Error 而非 ServiceError 避免 root↔service 循环）。 */
export declare function addConfirmedHost(rootAbs: string, host: string): Promise<readonly string[]>;
