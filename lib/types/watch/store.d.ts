/** 订阅存储（0204 §2）：`<root>/.srw/watch.json` 是订阅本体的唯一真相源。
 * 原子落盘（tmp→rename）+ revision STALE 拒写 + assertInsideRoot 护栏——
 * 与 library.json 同款纪律；坏 JSON 抛 INVALID 不静默清空用户数据。
 * 时钟任务本体在宿主 schedule 存储，这里只存绑定 id。 */
import { type SrwFsLike } from '../host.ts';
import { type WatchDoc, type WatchSub } from './model.ts';
export declare class WatchStore {
    private readonly rootDir;
    private readonly fs;
    constructor(rootDir: string, fs: SrwFsLike | undefined);
    private guard;
    /** 读订阅表；缺文件返回空表。坏 JSON 抛 INVALID。 */
    load(): Promise<WatchDoc>;
    /** 保存（乐观并发，同 library 口径）；原子落盘。 */
    save(doc: WatchDoc, expectedRevision: number): Promise<WatchDoc>;
    /** 原子更新单条订阅（load→patch→save 一次持有，调用方给纯 patch 函数）。 */
    update(patch: (subs: readonly WatchSub[]) => readonly WatchSub[]): Promise<WatchDoc>;
    upsertSub(sub: WatchSub): Promise<WatchDoc>;
    removeSub(id: string): Promise<WatchDoc>;
}
