/** 科研总根配置（`.srw/root.json`，B 路线）：settings.register 后置到 V15
 * （宿主 schemastery 运行时不可达，见 0202 Task 1.1 决策），用户级根内设置
 * 以文件为真相源。读失败一律回落默认值（缺文件与坏文件同权），写走
 * tmp→rename 原子替换（与 writeBinary 同纪律）。 */
export interface RootConfig {
    readonly schemaVersion: 1;
    readonly defaultLangPair: 'en-zh' | 'zh-en';
    readonly allowIllustrative: boolean;
    readonly offlineMode: boolean;
}
export declare const DEFAULT_ROOT: RootConfig;
export declare function rootConfigPath(rootAbs: string): string;
/** 读根配置；缺文件/坏文件/字段非法逐项钳回默认（无迁移：version 恒 1）。 */
export declare function readRootConfig(rootAbs: string): Promise<RootConfig>;
/** 合并写入根配置（补 `.srw` 目录），返回合并后的完整配置。 */
export declare function writeRootConfig(rootAbs: string, patch: Partial<Omit<RootConfig, 'schemaVersion'>>): Promise<RootConfig>;
