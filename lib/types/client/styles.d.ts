/** 面板样式：注入一条 <style>（id 幂等），类名 `srw-` 前缀。
 *
 * 双层令牌（vibe/automation 同款）：宿主设计平台令牌 `--dsw-alias-*` 优先，
 * 缺 token 的宿主回落字面量——双主题自适应。布局纪律（0102 §9.4）：壳层
 * 宽度归宿主；main 槽 `overflow:hidden` 定高不滚动，面板必须自带
 * height:100% + min-height:0 + overflow-y。
 */
export declare function installStyles(): () => void;
