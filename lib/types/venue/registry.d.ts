/** 刊物注册表种子数据（0102 §7.3 的 venue.json 形状）。**全部
 * `confidence: "unverified"`**：数值来自各刊作者指南的通识记忆，未经人工
 * 逐项核定——只做建议，不阻断（RISK-7）。核定后在投稿视图（M8）升级。
 * 数据以 TS 模块内嵌（esbuild 打包零拷贝；JSON 文件加载是包装陷阱），
 * 载入仍过 validateVenue 校验——手写数据同样不过不了 schema。 */
import { type VenueSchema } from './types.ts';
/** 注册表（≥3 个 + 中文单列）：惰性校验，坏数据在首次访问即抛。 */
export declare function listVenues(): readonly VenueSchema[];
export declare function getVenue(id: string): VenueSchema | undefined;
