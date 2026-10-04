/** 跨进程文件锁（RateGate 账本用）：`O_CREAT|O_EXCL` 独占创建 + 轮询，
 * 陈旧锁（mtime 超龄）强破。不引第三方依赖；只保证「同一台机器同一文件系统」
 * 的互斥——账本场景（域级限速时间戳）恰好只需要这个粒度。
 *
 * 用法：`await withFileLock(path, async () => { …读改写… })`——锁的获取与
 * 释放都在本进程内成对；回调抛错也释放（finally）。
 */
export declare function withFileLock<T>(lockPath: string, fn: () => Promise<T> | T): Promise<T>;
/** 测试与降速注入用：把账本目录下的锁文件路径规约出来。 */
export declare function lockPathFor(targetPath: string): string;
/** 原子写兜底（账本以外的调用方不常用；与 writeRootConfig 同纪律）。 */
export declare function atomicWrite(path: string, data: string): Promise<void>;
