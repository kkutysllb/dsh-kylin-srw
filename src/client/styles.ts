/** 面板样式：注入一条 <style>（id 幂等），类名 `srw-` 前缀。
 *
 * 双层令牌（vibe/automation 同款）：宿主设计平台令牌 `--dsw-alias-*` 优先，
 * 缺 token 的宿主回落字面量——双主题自适应。布局纪律（0102 §9.4）：壳层
 * 宽度归宿主；main 槽 `overflow:hidden` 定高不滚动，面板必须自带
 * height:100% + min-height:0 + overflow-y。
 */

const STYLE_ID = 'dsh-kylin-srw-styles'

export function installStyles(): () => void {
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}

const CSS = `
.srw-panel {
  --srw-fg: var(--dsw-alias-label-primary, #1f2329);
  --srw-fg-secondary: var(--dsw-alias-label-secondary, #5a6472);
  --srw-fg-muted: var(--dsw-alias-label-tertiary, #8a94a3);
  --srw-layer: var(--dsw-alias-bg-layer-2, transparent);
  --srw-fill: var(--dsw-alias-bg-skeleton, rgba(127,127,127,.14));
  --srw-border: var(--dsw-alias-border-l3, rgba(127,127,127,.3));
  --srw-primary: var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6);
  --srw-primary-fg: var(--dsw-alias-label-primary-foreground, #ffffff);
  --srw-ok: var(--dsw-alias-state-success-primary, #23a353);
  --srw-error: var(--dsw-alias-state-error-primary, #d0403d);
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 16px 20px 32px;
  color: var(--srw-fg);
  font-size: 13px;
  line-height: 1.6;
}
.srw-panel *, .srw-panel *::before, .srw-panel *::after { box-sizing: inherit; }
.srw-h1 { font-size: 16px; font-weight: 600; margin: 0 0 4px; }
.srw-sub { color: var(--srw-fg-muted); margin: 0 0 16px; }
.srw-card {
  background: var(--srw-layer);
  border: 1px solid var(--srw-border);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 14px;
}
.srw-card h2 { font-size: 13px; font-weight: 600; margin: 0 0 8px; }
.srw-table { width: 100%; border-collapse: collapse; }
.srw-table th, .srw-table td {
  text-align: left; padding: 3px 8px; border-bottom: 1px solid var(--srw-border);
  font-weight: 400; font-size: 12px;
}
.srw-table th { color: var(--srw-fg-muted); font-weight: 500; }
.srw-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
.srw-dot.ok { background: var(--srw-ok); }
.srw-dot.bad { background: var(--srw-error); }
.srw-dot.unknown { background: var(--srw-fg-muted); }
.srw-detail { color: var(--srw-fg-muted); font-size: 11px; }
.srw-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
.srw-btn {
  appearance: none; border: 1px solid var(--srw-border); border-radius: 8px;
  background: var(--srw-fill); color: var(--srw-fg);
  padding: 5px 12px; font-size: 12px; cursor: pointer;
}
.srw-btn:hover { border-color: var(--srw-primary); }
.srw-btn.primary { background: var(--srw-primary); border-color: var(--srw-primary); color: var(--srw-primary-fg); }
.srw-btn:disabled { opacity: .5; cursor: default; }
.srw-log { list-style: none; margin: 8px 0 0; padding: 0; max-height: 260px; overflow-y: auto; }
.srw-log li {
  font-size: 12px; padding: 4px 0; border-bottom: 1px dashed var(--srw-border);
  word-break: break-all; white-space: pre-wrap;
}
.srw-log .t { color: var(--srw-fg-muted); margin-right: 8px; font-variant-numeric: tabular-nums; }
.srw-log .ok { color: var(--srw-ok); }
.srw-log .bad { color: var(--srw-error); }
.srw-input {
  border: 1px solid var(--srw-border); border-radius: 8px; background: var(--srw-layer);
  color: var(--srw-fg); padding: 4px 8px; font-size: 12px; width: 260px;
}
.srw-form { align-items: center; }
.srw-error { color: var(--srw-error); font-size: 12px; margin: 6px 0; word-break: break-all; }
.srw-projects { list-style: none; margin: 8px 0 0; padding: 0; }
.srw-project {
  border: 1px solid var(--srw-border); border-radius: 10px;
  padding: 10px 12px; margin-bottom: 8px;
}
.srw-project.active { border-color: var(--srw-primary); }
.srw-project-main { display: flex; align-items: center; gap: 8px; }
.srw-project-title { font-weight: 600; }
.srw-project-meta { display: flex; gap: 6px; color: var(--srw-fg-muted); font-size: 11px; margin: 2px 0 4px; }
.srw-badge {
  display: inline-block; border-radius: 999px; padding: 1px 10px;
  background: var(--srw-fill); color: var(--srw-fg-secondary); font-size: 11px;
}
.srw-pipeline { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.srw-stage {
  border-radius: 999px; padding: 2px 12px; font-size: 12px;
  background: var(--srw-fill); color: var(--srw-fg-muted);
  position: relative;
}
.srw-stage:not(:last-child)::after {
  content: '→'; position: absolute; right: -10px; top: 50%;
  transform: translateY(-50%); color: var(--srw-fg-muted); font-size: 11px;
}
.srw-stage.current { background: var(--srw-primary); color: var(--srw-primary-fg); }
.srw-btn.danger:hover { border-color: var(--srw-error); color: var(--srw-error); }
.srw-btn.danger-confirm { background: var(--srw-error); border-color: var(--srw-error); color: var(--srw-primary-fg); }
.srw-btn.link {
  appearance: none; background: none; border: none; padding: 0;
  color: var(--srw-fg); font-size: 13px; font-weight: 600; cursor: pointer;
}
`
