window.__ModuleLoader__.load({ id: "dsh-kylin-srw", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var import_react3 = require("react");

// src/client/styles.ts
var STYLE_ID = "dsh-kylin-srw-styles";
function installStyles() {
  if (document.getElementById(STYLE_ID) !== null) return () => {
  };
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  return () => {
    style.remove();
  };
}
var CSS = `
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
  content: '\u2192'; position: absolute; right: -10px; top: 50%;
  transform: translateY(-50%); color: var(--srw-fg-muted); font-size: 11px;
}
.srw-stage.current { background: var(--srw-primary); color: var(--srw-primary-fg); }
.srw-btn.danger:hover { border-color: var(--srw-error); color: var(--srw-error); }
.srw-btn.danger-confirm { background: var(--srw-error); border-color: var(--srw-error); color: var(--srw-primary-fg); }
.srw-btn.link {
  appearance: none; background: none; border: none; padding: 0;
  color: var(--srw-fg); font-size: 13px; font-weight: 600; cursor: pointer;
}
`;

// src/client/workbench.tsx
var import_react2 = require("react");

// src/client/view.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var RPC_CHANNEL = "/dsh-kylin-srw";
var CLIENT_PATHS = [
  "slots",
  "connection",
  "locale",
  "sessions",
  "uiWorkspace",
  "workspaces",
  "remote",
  "remote.session",
  "modelDirectories",
  "layout",
  "sidebarRight",
  "documentPreviews",
  "uiSession",
  "conversation",
  "settings"
];
function safeGet(ctx, path) {
  let current = ctx;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") return { present: false, detail: "absent" };
    try {
      current = current[part];
    } catch (error) {
      return { present: false, detail: `threw: ${String(error)}` };
    }
    if (current === void 0) return { present: false, detail: "\u672A\u6CE8\u5165" };
  }
  return { present: current !== void 0, detail: typeof current };
}
async function callRpc(ctx, endpoint, payload) {
  const rpc2 = ctx.connection?.rpc;
  const call = rpc2?.call;
  if (call === void 0) throw new Error("connection.rpc.call \u4E0D\u53EF\u7528\uFF08connection \u672A\u6CE8\u5165\u6216\u7F3A rpc \u9762\uFF09");
  const raw = await call.call(rpc2, RPC_CHANNEL, endpoint, payload);
  const envelope = raw;
  if (envelope !== null && typeof envelope === "object" && envelope.ok === true) return envelope.value;
  const message = envelope !== null && typeof envelope === "object" && envelope.error !== void 0 ? `${String(envelope.error.code)}: ${String(envelope.error.message)}` : String(raw);
  throw new Error(message);
}
function fmt(value, max = 220) {
  let text;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > max ? `${text.slice(0, max)}\u2026` : text;
}
function DiagView({ ctx, embedded = false }) {
  const [hostCaps, setHostCaps] = (0, import_react.useState)(null);
  const [info, setInfo] = (0, import_react.useState)(null);
  const [rpcError, setRpcError] = (0, import_react.useState)(null);
  const [log, setLog] = (0, import_react.useState)([]);
  const [sessionId, setSessionId] = (0, import_react.useState)("");
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [containsRoot, setContainsRoot] = (0, import_react.useState)("");
  const [containsTarget, setContainsTarget] = (0, import_react.useState)("");
  const pushLog = (0, import_react.useCallback)((kind, text) => {
    setLog((previous) => [{ at: (/* @__PURE__ */ new Date()).toLocaleTimeString(), kind, text }, ...previous].slice(0, 80));
  }, []);
  const refresh = (0, import_react.useCallback)(async () => {
    setBusy(true);
    try {
      const value = await callRpc(ctx, "diag.caps");
      setHostCaps(value.caps ?? []);
      setInfo(value.info ?? null);
      setRpcError(null);
      pushLog("ok", `diag.caps OK\uFF08${(value.caps ?? []).length} \u884C\uFF09`);
    } catch (error) {
      setRpcError(String(error));
      pushLog("bad", `diag.caps \u5931\u8D25\uFF1A${String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [ctx, pushLog]);
  (0, import_react.useEffect)(() => {
    void refresh();
  }, [refresh]);
  (0, import_react.useEffect)(() => {
    const current = ctx.sessions?.list?.getSnapshot?.().current;
    if (typeof current === "string" && current !== "") setSessionId(current);
  }, [ctx]);
  const probePanelInfo = (0, import_react.useCallback)(() => {
    const snapshot = ctx.layout?.panelInfo?.getSnapshot?.();
    pushLog(snapshot !== void 0 ? "ok" : "bad", `layout.panelInfo = ${fmt(snapshot)}`);
  }, [ctx, pushLog]);
  const tryOpenViewer = (0, import_react.useCallback)((deferred) => {
    const sidebarRight = ctx.sidebarRight;
    const address = `qilin-resource://file/session/${sessionId.trim() || "<sid>"}/Users/libing/kk_Projects/dsh-kylin-srw/README.md`;
    if (deferred === true) {
      const openIn = sidebarRight?.openResourceIn;
      if (openIn === void 0) {
        pushLog("bad", "ctx.sidebarRight.openResourceIn \u4E0D\u53EF\u8FBE\uFF08E1 \u6CE8\u5165\u672A\u751F\u6548\uFF1F\u91CD\u542F\u5BBF\u4E3B\u540E\u91CD\u8BD5\uFF09");
        return;
      }
      const sid = sessionId.trim();
      if (sid === "") {
        pushLog("bad", "\u8BD5\u5EF6\u8FDF\u6253\u5F00\u9700\u8981 sessionId\uFF08\u5148\u5728\u5F15\u64CE\u91CC\u5F00\u4E00\u4E2A\u4F1A\u8BDD\u518D\u586B\u8F93\u5165\u6846\uFF09");
        return;
      }
      try {
        openIn.call(sidebarRight, sid, address);
        pushLog("ok", `openResourceIn('${sid}', '${address}') \u672A\u629B\u9519\uFF08\u9884\u671F\u53EA\u5199\u4E0D\u753B\u2014\u2014\u5207\u56DE\u5BF9\u8BDD\u9875\u770B tab \u662F\u5426\u51FA\u73B0\uFF0C\u51FA\u73B0=\u7B2C 3 \u9879\u901A\u8FC7\uFF09`);
      } catch (error) {
        pushLog("bad", `openResourceIn \u629B\u9519\uFF1A${String(error)}`);
      }
      return;
    }
    const open = sidebarRight?.openResource;
    if (open === void 0) {
      pushLog("bad", "ctx.sidebarRight.openResource \u4E0D\u53EF\u8FBE\uFF08E1 \u6CE8\u5165\u672A\u751F\u6548\uFF1F\u91CD\u542F\u5BBF\u4E3B\u540E\u91CD\u8BD5\uFF09");
      return;
    }
    try {
      open.call(sidebarRight, address);
      pushLog("ok", `openResource('${address}') \u672A\u629B\u9519\u2014\u2014\u4E3B\u533A\u88AB\u5360\u65F6\u8FD9**\u4E0D\u7B26\u5408**0102 \u9884\u671F\uFF0C\u8BF7\u8BB0\u5F55\uFF01`);
    } catch (error) {
      pushLog("bad", `openResource \u629B\u9519\uFF08\u4E3B\u533A\u88AB\u5360\u65F6\u9884\u671F "no session surface is mounted"\uFF09\uFF1A${String(error)}`);
    }
  }, [ctx, pushLog, sessionId]);
  const registerPreview = (0, import_react.useCallback)(() => {
    const previews = ctx.documentPreviews;
    if (previews?.register === void 0) {
      pushLog("bad", "documentPreviews \u4E0D\u53EF\u8FBE\uFF08E1 \u6CE8\u5165\u672A\u751F\u6548\uFF1F\uFF09");
      return;
    }
    try {
      const dispose = previews.register({
        id: "srw-e1-preview",
        extensions: ["srwtxt"],
        title: () => "SRW E1 \u9884\u89C8",
        loading: "text-pages"
      });
      pushLog("ok", "documentPreviews.register \u6210\u529F\uFF08\u4E3B\u533A\u88AB\u5360\u4ECD\u53EF\u6CE8\u518C=\u7B2C 5 \u9879 API \u9762\u901A\u8FC7\uFF09\uFF1B15s \u540E\u81EA\u52A8\u64A4\u9500");
      window.setTimeout(() => {
        try {
          dispose();
          pushLog("info", "E1 \u9884\u89C8\u6CE8\u518C\u5DF2\u81EA\u52A8\u64A4\u9500\uFF08\u4E0D\u7559\u5783\u573E\uFF09");
        } catch {
        }
      }, 15e3);
    } catch (error) {
      pushLog("bad", `documentPreviews.register \u629B\u9519\uFF1A${String(error)}`);
    }
  }, [ctx, pushLog]);
  const sendDraft = (0, import_react.useCallback)(async () => {
    const sid = sessionId.trim();
    const sessions = ctx.sessions;
    if (sid === "" || sessions === void 0) {
      pushLog("bad", "\u9001\u8349\u7A3F\u8DF3\u8FC7\uFF1A\u9700\u8981 sessionId\uFF08\u8F93\u5165\u6846\uFF09\u4E0E sessions \u670D\u52A1");
      return;
    }
    const anySessions = sessions;
    if (typeof anySessions["retain"] === "function" && typeof anySessions["binding"] === "function" && ctx.conversation?.input?.for !== void 0) {
      try {
        const ref = anySessions["retain"].call(sessions, sid, { source: "srw" });
        if (ref?.ready !== void 0) await ref.ready;
        const bound = anySessions["binding"].call(sessions, sid);
        const carrier = bound?.ctx;
        ref?.release?.();
        if (carrier === void 0) {
          pushLog("bad", "\u8DEF\u5F84A\uFF1Abinding(sid).ctx \u4E3A\u7A7A");
        } else {
          const shell = ctx.conversation.input.for(carrier);
          if (shell?.setDraft !== void 0 && shell.submit !== void 0) {
            shell.setDraft(`[SRW E1] draft ping ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`);
            shell.submit();
            pushLog("ok", `\u8DEF\u5F84A retain+binding+conversation.input.for\uFF1A\u5DF2\u9001\u8349\u7A3F\uFF08\u5230\u4F1A\u8BDD ${sid} \u786E\u8BA4\u843D\u70B9\u6B63\u786E\u3001\u5207\u4F1A\u8BDD\u4E0D\u4E32\u53F0\uFF09`);
            return;
          }
          pushLog("bad", "\u8DEF\u5F84A\uFF1Ainput shell \u7F3A setDraft/submit");
        }
      } catch (error) {
        pushLog("bad", `\u8DEF\u5F84A retain+binding \u629B\u9519\uFF08\u672A retain \u76F4\u63A5 for \u7684\u6587\u6848\u4E5F\u662F\u7B2C 7 \u9879\u6570\u636E\uFF09\uFF1A${String(error)}`);
      }
    } else {
      pushLog("info", "\u8DEF\u5F84A \u4E0D\u53EF\u7528\uFF08retain/binding/conversation.input \u7F3A\u4E00\uFF09");
    }
    if (typeof sessions.retainAgentScope === "function" && typeof sessions.scope === "function") {
      try {
        const ref = sessions.retainAgentScope.call(sessions, sid);
        const scope = sessions.scope.call(sessions, sid);
        const shell = scope?.conversation?.input?.for?.(scope);
        ref?.release?.();
        if (shell?.setDraft !== void 0 && shell.submit !== void 0) {
          shell.setDraft(`[SRW E1] draft ping B ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`);
          shell.submit();
          pushLog("ok", `\u8DEF\u5F84B retainAgentScope+scope\uFF1A\u5DF2\u9001\u8349\u7A3F\uFF08\u5230\u4F1A\u8BDD ${sid} \u786E\u8BA4\u843D\u70B9\uFF09`);
          return;
        }
        pushLog("bad", "\u8DEF\u5F84B\uFF1Ascope \u7684 input shell \u4E0D\u53EF\u7528");
      } catch (error) {
        pushLog("bad", `\u8DEF\u5F84B retainAgentScope+scope \u629B\u9519\uFF1A${String(error)}`);
      }
    } else {
      pushLog("info", "\u8DEF\u5F84B \u4E0D\u53EF\u7528\uFF1Asessions.retainAgentScope/scope \u672A\u6CE8\u5165");
    }
    pushLog("bad", "\u4E24\u6761\u8DEF\u5F84\u90FD\u672A\u6210\u529F\u2014\u2014E1 \u8BB0\u5F55\u539F\u59CB\u9519\u8BEF\u540E\u5B9A\u7A3F\u6B63\u786E\u901A\u8DEF");
  }, [ctx, pushLog, sessionId]);
  const probeUiSession = (0, import_react.useCallback)(() => {
    try {
      const key = ctx.uiSession?.adapter?.current?.getSnapshot?.().key;
      pushLog(key !== void 0 ? "ok" : "bad", `uiSession.adapter.current.key = ${key === void 0 ? "(undefined)" : JSON.stringify(key)}\uFF08\u5207\u4F1A\u8BDD\u540E\u91CD\u6309\uFF0C\u9A8C\u8BC1\u5B9E\u65F6\u6027\uFF09`);
    } catch (error) {
      pushLog("bad", `uiSession \u63A2\u6D4B\u629B\u9519\uFF1A${String(error)}`);
    }
  }, [ctx, pushLog]);
  const probeSettings = (0, import_react.useCallback)(() => {
    const present = safeGet(ctx, "settings");
    pushLog("info", `ctx.settings ${present.present ? "\u5B58\u5728" : "\u672A\u6CE8\u5165\uFF08\u670D\u52A1\u540D\u672A\u9A8C\u8BC1\uFF0C\u4E3A\u907F\u514D\u6FC0\u6D3B\u5931\u8D25\u4E0D\u6CE8\u5165\uFF09"}\uFF1B\u7B2C 10 \u9879\u7684\u6B63\u786E\u8F7D\u4F53\u662F settings.section \u69FD\u2014\u2014\u672C\u63D2\u4EF6\u5DF2\u6CE8\u518C\u300C\u79D1\u7814\u5DE5\u4F5C\u53F0\uFF08E1 \u9A8C\u8BC1\uFF09\u300D\u533A\u5757\uFF0C\u8BF7\u5728\u9762\u677F\u5360\u4E3B\u533A\u65F6\u4ECE\u5916\u58F3\u6253\u5F00\u8BBE\u7F6E\u9875\u67E5\u770B\u80FD\u5426\u6253\u5F00\uFF08portal \u6A21\u6001\u9884\u671F\uFF09`);
  }, [ctx, pushLog]);
  const probeContains = (0, import_react.useCallback)(async () => {
    const root = containsRoot.trim();
    const target = containsTarget.trim();
    if (root === "" || target === "") {
      pushLog("bad", "contains \u5B9E\u6D4B\u9700\u8981 root \u4E0E target \u4E24\u4E2A\u8DEF\u5F84");
      return;
    }
    try {
      const value = await callRpc(ctx, "diag.contains", { root, target });
      pushLog(
        value.contained === true ? "ok" : "info",
        `diag.contains(root=${root}, target=${target}) \u2192 ${value.contained === true}\uFF08contains \u8BED\u4E49\uFF09${value.detail !== void 0 && value.detail !== "" ? `\uFF1Bdetail\uFF1A${value.detail}` : ""}`
      );
    } catch (error) {
      pushLog("bad", `diag.contains \u5931\u8D25\uFF1A${String(error)}`);
    }
  }, [ctx, pushLog, containsRoot, containsTarget]);
  const clientRows = CLIENT_PATHS.map((path) => ({ path, ...safeGet(ctx, path) }));
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "srw-panel", children: [
    embedded ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { className: "srw-h1", children: "\u79D1\u7814\u5DE5\u4F5C\u53F0 \xB7 M0 \u8BCA\u65AD" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "srw-sub", children: [
        info === null ? "\u5BBF\u4E3B\u4FE1\u606F\u52A0\u8F7D\u4E2D\u2026" : `v${String(info["version"] ?? "?")} \xB7 \u901A\u9053 ${String(info["home"]?.["channel"] ?? "?")} \xB7 home ${String(info["home"]?.["home"] ?? "") === "" ? "(\u672A\u5224\u5B9A)" : String(info["home"]["home"])} \xB7 \u79BB\u7EBF\u6A21\u5F0F ${info["offlineMode"] === true ? "\u5F00" : "\u5173"}`,
        rpcError !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: "var(--srw-error)" }, children: [
          " \xB7 RPC\uFF1A",
          rpcError
        ] }) : null
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "srw-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u5BBF\u4E3B\u80FD\u529B\uFF08RPC diag.caps\uFF09" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "srw-btn primary", disabled: busy, onClick: () => {
        void refresh();
      }, children: "\u91CD\u65B0\u63A2\u6D4B" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "srw-actions", style: { marginTop: 8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            className: "srw-input",
            placeholder: "root\uFF08\u7EDD\u5BF9\u8DEF\u5F84\uFF09",
            value: containsRoot,
            onChange: (event) => {
              setContainsRoot(event.target.value);
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            className: "srw-input",
            placeholder: "target\uFF08\u76F8\u5BF9 root \u6216\u7EDD\u5BF9\uFF09",
            value: containsTarget,
            onChange: (event) => {
              setContainsTarget(event.target.value);
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "srw-btn", onClick: () => {
          void probeContains();
        }, children: "contains \u5B9E\u6D4B\uFF08V4\uFF09" })
      ] }),
      hostCaps === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "srw-detail", children: rpcError ?? "\u52A0\u8F7D\u4E2D\u2026" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { className: "srw-table", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u670D\u52A1" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u72B6\u6001" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u7C7B\u578B" })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: hostCaps.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: row.name }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `srw-dot ${row.available ? "ok" : "bad"}` }),
            row.available ? "\u53EF\u7528" : "\u7F3A\u5E2D"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { className: "srw-detail", children: row.detail })
        ] }, row.name)) })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "srw-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u5BA2\u6237\u7AEF\u670D\u52A1\u9762\uFF08\u5DF2\u9A8C\u8BC1 10 + E1 \u4E34\u65F6 4 + \u5019\u9009\uFF09" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("table", { className: "srw-table", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: clientRows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: row.path }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `srw-dot ${row.present ? "ok" : "bad"}` }),
          row.present ? "\u53EF\u7528" : row.detail === "\u672A\u6CE8\u5165" ? "\u672A\u6CE8\u5165" : "\u7F3A\u5E2D"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { className: "srw-detail", children: row.present ? row.detail : row.detail === "\u672A\u6CE8\u5165" ? "" : row.detail })
      ] }, row.path)) }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "srw-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "E1 \u63A2\u6D4B\uFF080201 Task 0.6 \xB7 \u6BCF\u6761\u7ED3\u679C\u843D\u65E5\u5FD7\uFF09" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "srw-actions", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          className: "srw-input",
          placeholder: "sessionId\uFF08\u9ED8\u8BA4\u53D6\u5F53\u524D\u4F1A\u8BDD\uFF09",
          value: sessionId,
          onChange: (event) => {
            setSessionId(event.target.value);
          }
        }
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "srw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "srw-btn", onClick: probePanelInfo, children: "panelInfo \u5FEB\u7167" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "srw-btn", onClick: () => {
          tryOpenViewer(false);
        }, children: "\u8BD5\u5F00\u6587\u6863\u67E5\u770B\u5668" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "srw-btn", onClick: () => {
          tryOpenViewer(true);
        }, children: "\u8BD5\u5EF6\u8FDF\u6253\u5F00" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "srw-btn", onClick: () => {
          void sendDraft();
        }, children: "\u9001\u8349\u7A3F\u5230\u4F1A\u8BDD" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "srw-btn", onClick: registerPreview, children: "\u6CE8\u518C\u9884\u89C8\u5668" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "srw-btn", onClick: probeUiSession, children: "uiSession \u63A2\u6D4B" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "srw-btn", onClick: probeSettings, children: "\u8BBE\u7F6E\u9875\u8BF4\u660E" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "srw-log", children: log.map((entry, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "t", children: entry.at }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: entry.kind, children: entry.kind === "ok" ? "\u2713" : entry.kind === "bad" ? "\u2717" : "\xB7" }),
        " ",
        entry.text
      ] }, `${entry.at}-${String(index)}`)) })
    ] })
  ] });
}

// src/reading/render.ts
var ANCHOR_RE = /^<!--\s*srw:(p\d+-b\d+)(?:\s+kind=(\w+))?(?:\s+state=(\w+))?\s*-->$/;
var ZH_MARK = "<!-- srw:zh -->";
var END_MARK = "<!-- /srw -->";
function parsePaper(markdown) {
  const lines = markdown.split("\n");
  const blocks = [];
  let current;
  const flush = () => {
    if (current === void 0) return;
    blocks.push({
      id: current.id,
      ...current.kind !== void 0 ? { kind: current.kind } : {},
      ...current.declaredState !== void 0 ? { declaredState: current.declaredState } : {},
      sourceText: current.source.join("\n").trim(),
      ...current.translation !== void 0 ? { translation: current.translation.join("\n").trim() } : {}
    });
    current = void 0;
  };
  for (const line of lines) {
    const anchor = line.match(ANCHOR_RE);
    if (anchor !== null) {
      flush();
      current = {
        id: anchor[1] ?? "",
        ...anchor[2] !== void 0 ? { kind: anchor[2] } : {},
        ...anchor[3] !== void 0 ? { declaredState: anchor[3] } : {},
        source: [],
        phase: "src"
      };
      continue;
    }
    if (current === void 0) continue;
    if (line.trim() === ZH_MARK) {
      current.phase = "zh";
      current.translation = [];
      continue;
    }
    if (line.trim() === END_MARK) {
      flush();
      continue;
    }
    if (current.phase === "src") current.source.push(line);
    else current.translation?.push(line);
  }
  flush();
  return blocks;
}

// src/client/workbench.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var RPC_CHANNEL2 = "/dsh-kylin-srw";
var STAGES = ["idea", "literature", "reading", "writing", "experiments", "submission"];
var STAGE_LABELS = {
  idea: "\u9009\u9898",
  literature: "\u6587\u732E",
  reading: "\u7CBE\u8BFB",
  writing: "\u5199\u4F5C",
  experiments: "\u5B9E\u9A8C",
  submission: "\u6295\u7A3F"
};
async function rpc(ctx, endpoint, payload) {
  const rpcFace = ctx.connection?.rpc;
  const call = rpcFace?.call;
  if (call === void 0) throw new Error("connection.rpc.call \u4E0D\u53EF\u7528");
  const raw = await call.call(rpcFace, RPC_CHANNEL2, endpoint, payload);
  const envelope = raw;
  if (envelope !== null && typeof envelope === "object" && envelope.ok === true) return envelope.value;
  const message = envelope !== null && typeof envelope === "object" && envelope.error !== void 0 ? `${envelope.error.code}: ${envelope.error.message}` : String(raw);
  throw new Error(message);
}
function fmtTime(iso) {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  const delta = Date.now() - at;
  if (delta < 6e4) return "\u521A\u521A";
  if (delta < 36e5) return `${Math.floor(delta / 6e4)} \u5206\u949F\u524D`;
  if (delta < 864e5) return `${Math.floor(delta / 36e5)} \u5C0F\u65F6\u524D`;
  return new Date(at).toLocaleDateString();
}
function paperKeyOfLite(key) {
  const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/g, "");
  return slug === "" ? "paper" : slug;
}
function pdfPathOfEntry(file, project) {
  return file.startsWith(`${project}/`) ? file.slice(project.length + 1) : file;
}
var READING_STATE_LABELS = {
  verified: "\u2713 \u6E90\u6BB5\u4E00\u81F4",
  mismatch: "\u26A0 \u6E90\u6587\u88AB\u6539",
  orphan: "\u5B64\u7ACB\u5757"
};
function WorkbenchView({ ctx }) {
  const [overview, setOverview] = (0, import_react2.useState)(null);
  const [projects, setProjects] = (0, import_react2.useState)([]);
  const [engineWorkspaces, setEngineWorkspaces] = (0, import_react2.useState)([]);
  const [error, setError] = (0, import_react2.useState)(null);
  const [notice, setNotice] = (0, import_react2.useState)(null);
  const [diagOpen, setDiagOpen] = (0, import_react2.useState)(false);
  const [formOpen, setFormOpen] = (0, import_react2.useState)(false);
  const [formSlug, setFormSlug] = (0, import_react2.useState)("");
  const [formTitle, setFormTitle] = (0, import_react2.useState)("");
  const [busy, setBusy] = (0, import_react2.useState)(false);
  const [confirmingSlug, setConfirmingSlug] = (0, import_react2.useState)(null);
  const [litSource, setLitSource] = (0, import_react2.useState)("arxiv");
  const [litQuery, setLitQuery] = (0, import_react2.useState)("");
  const [litResults, setLitResults] = (0, import_react2.useState)([]);
  const [libEntries, setLibEntries] = (0, import_react2.useState)([]);
  const [litBusy, setLitBusy] = (0, import_react2.useState)(false);
  const [litNotice, setLitNotice] = (0, import_react2.useState)(null);
  const [watchSubs, setWatchSubs] = (0, import_react2.useState)([]);
  const [watchSource, setWatchSource] = (0, import_react2.useState)("arxiv");
  const [watchQuery, setWatchQuery] = (0, import_react2.useState)("");
  const [watchEvery, setWatchEvery] = (0, import_react2.useState)(86400);
  const [watchBusy, setWatchBusy] = (0, import_react2.useState)(false);
  const [watchNotice, setWatchNotice] = (0, import_react2.useState)(null);
  const [confirmingWatchId, setConfirmingWatchId] = (0, import_react2.useState)(null);
  const [readingSelKey, setReadingSelKey] = (0, import_react2.useState)("");
  const [readingKey, setReadingKey] = (0, import_react2.useState)("");
  const [readingStatus, setReadingStatus] = (0, import_react2.useState)(null);
  const [readingView, setReadingView] = (0, import_react2.useState)(null);
  const [readingBusy, setReadingBusy] = (0, import_react2.useState)(false);
  const [readingNotice, setReadingNotice] = (0, import_react2.useState)(null);
  const alive = (0, import_react2.useRef)(true);
  const confirmTimer = (0, import_react2.useRef)(void 0);
  (0, import_react2.useEffect)(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const refreshProjects = (0, import_react2.useCallback)(async () => {
    try {
      const value = await rpc(ctx, "root.get");
      if (alive.current) setProjects(value.projects ?? []);
    } catch (cause) {
      if (alive.current) setError(String(cause));
    }
  }, [ctx]);
  const refreshWatch = (0, import_react2.useCallback)(async () => {
    try {
      const subs = await rpc(ctx, "watch.list");
      if (alive.current) setWatchSubs(subs);
    } catch {
    }
  }, [ctx]);
  const watchCreate = async () => {
    const project = overview?.activeProject ?? "";
    if (project === "") {
      setWatchNotice("\u5148\u521B\u5EFA/\u6253\u5F00\u4E00\u4E2A\u9879\u76EE\u518D\u8BA2\u9605");
      return;
    }
    if (watchQuery.trim() === "") {
      setWatchNotice("\u68C0\u7D22\u8BCD\u4E0D\u80FD\u4E3A\u7A7A");
      return;
    }
    setWatchBusy(true);
    try {
      const result = await rpc(ctx, "watch.create", {
        project,
        source: watchSource,
        query: watchQuery,
        everySeconds: watchEvery
      });
      setWatchQuery("");
      setWatchNotice(result.scheduled === true ? "\u5DF2\u8BA2\u9605\uFF1A\u65F6\u949F\u4EFB\u52A1\u5DF2\u5199\u5165\u5BBF\u4E3B\u300C\u81EA\u52A8\u5316\u4EFB\u52A1\u300D\u9875\uFF08\u5230\u671F\u81EA\u52A8\u6293\u53D6\u5165\u5E93\uFF09" : `\u5DF2\u8BA2\u9605\u4F46\u672A\u6392\u7A0B\uFF1A${result.hint ?? ""}`);
      await refreshWatch();
    } catch (cause) {
      setWatchNotice(`\u8BA2\u9605\u5931\u8D25\uFF1A${String(cause)}`);
    } finally {
      if (alive.current) setWatchBusy(false);
    }
  };
  const watchAction = async (action, id) => {
    setWatchBusy(true);
    try {
      if (action === "run") {
        const result = await rpc(ctx, "watch.run", { id });
        setWatchNotice(`\u6293\u53D6\u5B8C\u6210\uFF1A\u65B0\u589E ${result.fresh} \u6761`);
      } else if (action === "remove") {
        await rpc(ctx, "watch.remove", { id });
        setWatchNotice("\u8BA2\u9605\u5DF2\u5220\u9664\uFF08\u65F6\u949F\u4EFB\u52A1\u540C\u6B65\u79FB\u9664\uFF09");
      } else {
        const result = await rpc(ctx, `watch.${action}`, { id });
        setWatchNotice(action === "pause" ? "\u5DF2\u6682\u505C\uFF08\u65F6\u949F\u4EFB\u52A1\u5DF2\u79FB\u9664\uFF0C\u8BA2\u9605\u4FDD\u7559\uFF09" : result.scheduled === true ? "\u5DF2\u6062\u590D\uFF1A\u65F6\u949F\u4EFB\u52A1\u5DF2\u91CD\u5EFA" : `\u5DF2\u6062\u590D\u4F46\u672A\u6392\u7A0B\uFF1A${result.hint ?? ""}`);
      }
      await refreshWatch();
    } catch (cause) {
      setWatchNotice(`\u64CD\u4F5C\u5931\u8D25\uFF1A${String(cause)}`);
    } finally {
      if (alive.current) setWatchBusy(false);
    }
  };
  (0, import_react2.useEffect)(() => {
    let timer;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const value = await rpc(ctx, "overview");
        if (alive.current) {
          setOverview(value);
          setError(null);
        }
      } catch (cause) {
        if (alive.current) setError(String(cause));
      }
    };
    void poll();
    void refreshProjects();
    void refreshWatch();
    timer = window.setInterval(() => {
      void poll();
    }, 5e3);
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer !== void 0) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ctx, refreshProjects, refreshWatch]);
  (0, import_react2.useEffect)(() => {
    const snapshot = ctx.workspaces?.list?.getSnapshot?.();
    if (snapshot !== void 0) {
      setEngineWorkspaces((snapshot.items ?? []).map((item) => item.title ?? item.path ?? "").filter((title) => title !== ""));
    }
  }, [ctx, overview]);
  const applyRoot = (0, import_react2.useCallback)(async (picked) => {
    try {
      setError(null);
      setNotice(null);
      await rpc(ctx, "root.set", { path: picked });
      const value = await rpc(ctx, "overview");
      if (alive.current) {
        setOverview(value);
        setNotice(`\u79D1\u7814\u603B\u6839\u5DF2\u8BBE\u7F6E\uFF1A${picked}`);
      }
      await refreshProjects();
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [ctx, refreshProjects, refreshWatch]);
  const chooseRoot = (0, import_react2.useCallback)(async () => {
    const picker = ctx.uiWorkspace?.pickDirectory;
    if (picker === void 0) {
      setError("uiWorkspace.pickDirectory \u4E0D\u53EF\u8FBE\uFF08client \u6CE8\u5165\u7F3A\u5E2D\uFF09");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      setBusy(false);
      setNotice("\u76EE\u5F55\u6846\u53EF\u80FD\u5DF2\u5F39\u51FA\u5728\u5BBF\u4E3B\u5C4F\u5E55\u4E0A\u7B49\u5F85\u9009\u62E9\uFF1B\u82E5\u672A\u51FA\u73B0\u8BF7\u91CD\u542F\u5BBF\u4E3B\u540E\u518D\u8BD5\u3002");
    }, 8e3);
    try {
      const picked = await picker.call(ctx.uiWorkspace);
      if (timedOut) return;
      if (picked === null || picked === "") {
        setNotice("\u5DF2\u53D6\u6D88\u9009\u62E9");
        return;
      }
      await applyRoot(picked);
    } catch (cause) {
      if (!timedOut && alive.current) setError(String(cause));
    } finally {
      window.clearTimeout(timer);
      if (!timedOut && alive.current) setBusy(false);
    }
  }, [ctx, applyRoot]);
  const createProject = (0, import_react2.useCallback)(async () => {
    const slug = formSlug.trim();
    const title = formTitle.trim();
    if (slug === "" || title === "") {
      setError("slug \u4E0E title \u90FD\u5FC5\u586B");
      return;
    }
    try {
      setBusy(true);
      setError(null);
      await rpc(ctx, "project.create", { slug, title });
      setFormOpen(false);
      setFormSlug("");
      setFormTitle("");
      await refreshProjects();
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [ctx, formSlug, formTitle, refreshProjects]);
  const openProject = (0, import_react2.useCallback)(async (slug) => {
    try {
      setBusy(true);
      setError(null);
      await rpc(ctx, "project.open", { slug });
      const value = await rpc(ctx, "overview");
      if (alive.current) setOverview(value);
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [ctx]);
  const removeProject = (0, import_react2.useCallback)(async (slug) => {
    if (confirmingSlug !== slug) {
      setConfirmingSlug(slug);
      if (confirmTimer.current !== void 0) window.clearTimeout(confirmTimer.current);
      confirmTimer.current = window.setTimeout(() => {
        setConfirmingSlug(null);
      }, 6e3);
      return;
    }
    if (confirmTimer.current !== void 0) window.clearTimeout(confirmTimer.current);
    setConfirmingSlug(null);
    try {
      setBusy(true);
      setError(null);
      await rpc(ctx, "project.remove", { slug });
      await refreshProjects();
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [ctx, refreshProjects, confirmingSlug]);
  const refreshLib = (0, import_react2.useCallback)(async (slug) => {
    try {
      const value = await rpc(ctx, "literature.lib", { project: slug });
      if (alive.current) setLibEntries(value.entries ?? []);
    } catch (cause) {
      if (alive.current) setError(String(cause));
    }
  }, [ctx]);
  const litSearch = (0, import_react2.useCallback)(async () => {
    const query = litQuery.trim();
    if (query === "") return;
    try {
      setLitBusy(true);
      setLitNotice(null);
      setError(null);
      const items = await rpc(ctx, "literature.search", { source: litSource, query, limit: 15 });
      if (alive.current) {
        setLitResults(items);
        setLitNotice(`\u68C0\u7D22\u5230 ${items.length} \u6761\uFF08${litSource}\uFF09`);
      }
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setLitBusy(false);
    }
  }, [ctx, litQuery, litSource]);
  const litImport = (0, import_react2.useCallback)(async (items) => {
    const slug = overview?.activeProject;
    if (slug === void 0 || slug === "") {
      setError("\u5148\u6253\u5F00\u4E00\u4E2A\u9879\u76EE\u518D\u5165\u5E93\uFF08\u9879\u76EE\u5361\u300C\u6253\u5F00\u300D\uFF09");
      return;
    }
    try {
      setLitBusy(true);
      setError(null);
      const value = await rpc(ctx, "literature.import", { project: slug, items });
      if (alive.current) {
        setLitNotice(`\u5165\u5E93\u5B8C\u6210\uFF1A\u65B0\u589E ${value.added}\uFF0C\u53BB\u91CD\u8DF3\u8FC7 ${value.duplicates}${value.retracted.length > 0 ? `\uFF0C\u64A4\u7A3F\u6807\u7EA2 ${value.retracted.length}` : ""}`);
        await refreshLib(slug);
      }
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setLitBusy(false);
    }
  }, [ctx, overview, refreshLib]);
  const litPdf = (0, import_react2.useCallback)(async (key) => {
    const slug = overview?.activeProject;
    if (slug === void 0 || slug === "") return;
    try {
      setLitBusy(true);
      setError(null);
      await rpc(ctx, "literature.fetchPdf", { project: slug, key });
      if (alive.current) {
        setLitNotice("PDF \u5DF2\u843D\u76D8 literature/pdf/");
        await refreshLib(slug);
      }
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setLitBusy(false);
    }
  }, [ctx, overview, refreshLib]);
  const litBibtex = (0, import_react2.useCallback)(async () => {
    const slug = overview?.activeProject;
    if (slug === void 0 || slug === "") return;
    try {
      setLitBusy(true);
      setError(null);
      const value = await rpc(ctx, "literature.bibtex", { project: slug });
      if (alive.current) {
        setLitNotice(`refs.bib \u5DF2\u66F4\u65B0\uFF1A\u65B0\u589E ${value.added.length} \u6761${value.skippedRetracted.length > 0 ? `\uFF0C\u64A4\u7A3F\u8DF3\u8FC7 ${value.skippedRetracted.length}` : ""}`);
      }
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setLitBusy(false);
    }
  }, [ctx, overview]);
  const litToAgent = (0, import_react2.useCallback)(async () => {
    const query = litQuery.trim();
    if (query === "") {
      setError("\u5148\u586B\u68C0\u7D22\u8BCD\u518D\u8F6C\u7ED9 Agent");
      return;
    }
    const sessions = ctx.sessions;
    if (sessions === void 0 || ctx.conversation?.input?.for === void 0) {
      setError("\u4F1A\u8BDD\u8F93\u5165\u901A\u8DEF\u4E0D\u53EF\u8FBE\uFF08sessions/conversation \u672A\u6CE8\u5165\uFF09");
      return;
    }
    let current;
    try {
      const key = ctx.uiSession?.adapter?.current?.getSnapshot?.().key;
      if (typeof key === "string" && key !== "") current = key;
    } catch {
    }
    if (current === void 0 || current === "") {
      const snap = sessions.list?.getSnapshot?.();
      if (typeof snap?.current === "string" && snap.current !== "") current = snap.current;
    }
    if (current === void 0 || current === "") {
      setError("\u6CA1\u6709\u6253\u5F00\u4E2D\u7684\u4F1A\u8BDD\u2014\u2014\u5148\u5728\u5DE6\u4FA7\u5F00\u4E00\u4E2A\u4F1A\u8BDD\uFF08agent \u4EFB\u52A1\u9700\u8981\u4F1A\u8BDD\u627F\u8F7D\uFF09");
      return;
    }
    const slug = overview?.activeProject;
    const projectClause = slug !== void 0 && slug !== "" ? `\u5165\u5E93\u5230\u9879\u76EE ${slug}` : "\u5165\u5E93\u524D\u5148\u7528 srw_project \u5DE5\u5177\u786E\u8BA4\u76EE\u6807\u9879\u76EE\uFF08list \u540E\u9009\u6700\u5408\u9002\u7684\uFF0C\u6CA1\u6709\u5C31\u63D0\u793A\u6211\u521B\u5EFA\uFF09";
    const prompt = [
      `\u8BF7\u7528 srw_literature \u5DE5\u5177\u5B8C\u6210\u4E00\u6B21\u6587\u732E\u68C0\u7D22\u4E0E\u5165\u5E93\uFF08${litSource} \u6E90\uFF09\u3002`,
      `\u68C0\u7D22\u8BCD\uFF1A${query}\u3002\u53D6\u524D 5 \u6761\u3002`,
      `${projectClause}\u3002`,
      "\u5B8C\u6210\u540E\u7B80\u77ED\u6C47\u62A5\uFF1A\u65B0\u589E\u51E0\u6761\u3001\u53BB\u91CD\u51E0\u6761\u3001\u6709\u65E0\u64A4\u7A3F\u6807\u7EA2\u3002"
    ].join("");
    const withTimeout = async (promise, ms = 4e3) => await Promise.race([Promise.resolve(promise), new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error("timeout"));
      }, ms);
    })]);
    const tryPath = async (usePathB) => {
      const anySessions = sessions;
      let carrier;
      if (!usePathB) {
        const ref = anySessions["retain"].call(sessions, current, { source: "srw" });
        if (ref?.ready !== void 0) await withTimeout(ref.ready);
        const bound = anySessions["binding"].call(sessions, current);
        carrier = bound?.ctx;
        ref?.release?.();
      } else {
        const ref = sessions.retainAgentScope?.call(sessions, current);
        const scope = sessions.scope?.call(sessions, current);
        carrier = scope;
        ref?.release?.();
      }
      if (carrier === void 0) throw new Error(usePathB ? "\u4E24\u6761\u901A\u8DEF\u90FD\u62FF\u4E0D\u5230\u4F1A\u8BDD\u8F93\u5165" : "binding.ctx \u4E3A\u7A7A");
      const inputFor = ctx.conversation?.input?.for;
      if (inputFor === void 0) throw new Error("conversation.input.for \u4E0D\u53EF\u8FBE");
      const shell = inputFor(carrier);
      if (shell?.setDraft === void 0 || shell.submit === void 0) throw new Error("input shell \u7F3A setDraft/submit");
      shell.setDraft(prompt);
      shell.submit();
    };
    try {
      try {
        await withTimeout(tryPath(false));
      } catch (pathAError) {
        await withTimeout(tryPath(true));
      }
      if (alive.current) setLitNotice("\u5DF2\u628A\u68C0\u7D22\u4EFB\u52A1\u8F6C\u7ED9\u5F53\u524D\u4F1A\u8BDD\u7684 Agent\uFF08\u6D88\u606F\u5DF2\u53D1\u9001\uFF0C\u5207\u5230\u4F1A\u8BDD\u9875\u770B\u8FDB\u5C55\uFF09");
    } catch (cause) {
      try {
        await navigator.clipboard.writeText(prompt);
        if (alive.current) {
          setLitNotice("\u8BE5\u4F1A\u8BDD\u7684\u8F93\u5165\u901A\u8DEF\u672A\u6FC0\u6D3B\uFF08\u9762\u677F\u5360\u4E3B\u533A\uFF09\u2014\u2014\u63D0\u793A\u8BCD\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F\uFF0C\u5230\u4F1A\u8BDD\u8F93\u5165\u6846\u7C98\u8D34\u56DE\u8F66\u5373\u53EF\u53D1\u8D77");
        }
      } catch {
        if (alive.current) setError(`\u8F6C\u7ED9\u5931\u8D25\uFF1A${String(cause)}\uFF1B\u8BF7\u624B\u52A8\u5728\u4F1A\u8BDD\u8F93\u5165\u6846\u63CF\u8FF0\u68C0\u7D22\u9700\u6C42\uFF08Agent \u5DF2\u5E26 srw_literature \u5DE5\u5177\uFF09`);
      }
    }
  }, [ctx, litQuery, litSource, overview]);
  const loadReadingContent = (0, import_react2.useCallback)(async (project, paperKey) => {
    try {
      const value = await rpc(ctx, "reading.content", { project, paperKey });
      if (!alive.current) return;
      setReadingView(parsePaper(value.markdown).map((block) => ({
        id: block.id,
        state: value.verify.states[block.id] ?? "orphan",
        sourceText: block.sourceText,
        ...block.translation !== void 0 ? { translation: block.translation } : {}
      })));
    } catch {
      if (alive.current) setReadingView(null);
    }
  }, [ctx]);
  const loadReadingAll = (0, import_react2.useCallback)(async (project, paperKey) => {
    try {
      const value = await rpc(ctx, "reading.status", { project, paperKey });
      if (!alive.current) return;
      setReadingStatus(value);
      if (value.extracted) await loadReadingContent(project, paperKey);
      else if (alive.current) setReadingView(null);
    } catch {
      if (alive.current) {
        setReadingStatus(null);
        setReadingView(null);
      }
    }
  }, [ctx, loadReadingContent]);
  (0, import_react2.useEffect)(() => {
    const project = overview?.activeProject;
    const paperKey = readingKey.trim();
    if (project === void 0 || project === "" || paperKey === "") {
      setReadingStatus(null);
      setReadingView(null);
      return;
    }
    void loadReadingAll(project, paperKey);
  }, [overview?.activeProject, readingKey, loadReadingAll]);
  const readingAction = async (action) => {
    const project = overview?.activeProject ?? "";
    const paperKey = readingKey.trim();
    if (project === "" || paperKey === "") {
      setReadingNotice("\u5148\u6253\u5F00\u9879\u76EE\u5E76\u9009\u62E9\u8BBA\u6587");
      return;
    }
    setReadingBusy(true);
    try {
      if (action === "extract") {
        const file = pdfEntries.find((entry) => paperKeyOfLite(entry.key) === paperKey)?.pdf?.file;
        if (file === void 0) {
          setReadingNotice("\u8BE5 paperKey \u6CA1\u6709\u5BF9\u5E94\u7684 PDF \u6761\u76EE\uFF08\u4ECE\u4E0B\u62C9\u9009\u62E9\u4F1A\u81EA\u52A8\u751F\u6210\uFF09");
          return;
        }
        const result = await rpc(
          ctx,
          "reading.extract",
          { project, paperKey, pdfPath: pdfPathOfEntry(file, project) }
        );
        setReadingNotice(`\u5DF2\u62BD\u53D6\uFF1A${result.pages} \u9875 ${result.blocks} \u5757\uFF08\u8FC1\u79FB ${result.migrated}\uFF0C\u5B64\u513F ${result.orphan}\uFF09`);
      } else if (action === "translate") {
        setReadingNotice("\u7FFB\u8BD1\u4E2D\u2014\u2014\u9010\u5757\u8D70 LLM\uFF0C\u9996\u6B21\u5168\u91CF\u53EF\u80FD\u8981\u51E0\u5206\u949F\uFF08\u7F13\u5B58\u547D\u4E2D\u4F1A\u8DF3\u8FC7\uFF09\u2026");
        const result = await rpc(ctx, "reading.translate", { project, paperKey });
        setReadingNotice(`\u7FFB\u8BD1\u5B8C\u6210\uFF1A\u5DF2\u8BD1 ${result.translated}/${result.blocks} \u5757`);
      } else {
        const result = await rpc(
          ctx,
          "reading.verify",
          { project, paperKey }
        );
        setReadingNotice(`\u6821\u9A8C\uFF1A\u4E00\u81F4 ${result.verified.length}\uFF0C\u6E90\u6587\u88AB\u6539 ${result.mismatch.length}\uFF0C\u5B64\u7ACB ${result.orphan.length}\uFF0C\u4E22\u5931 ${result.missing.length}`);
      }
      await loadReadingAll(project, paperKey);
    } catch (cause) {
      setReadingNotice(`\u64CD\u4F5C\u5931\u8D25\uFF1A${String(cause)}`);
    } finally {
      if (alive.current) setReadingBusy(false);
    }
  };
  (0, import_react2.useEffect)(() => {
    const slug = overview?.activeProject;
    if (slug !== void 0 && slug !== "") void refreshLib(slug);
  }, [overview?.activeProject, refreshLib]);
  const activeStage = overview?.activeStage;
  const rootDir = overview?.rootDir ?? "";
  const pdfEntries = libEntries.filter((entry) => entry.pdf !== void 0);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "srw-panel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h1", { className: "srw-h1", children: "\u79D1\u7814\u5DE5\u4F5C\u53F0" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "srw-sub", children: overview === null ? "\u52A0\u8F7D\u4E2D\u2026" : `v${overview.version} \xB7 \u9879\u76EE ${overview.projectCount} \xB7 \u6D3B\u52A8\u9879\u76EE ${overview.activeProject === "" ? "\uFF08\u672A\u9009\uFF09" : overview.activeProject} \xB7 \u80FD\u529B ${overview.capsOk}/${overview.capsTotal} \xB7 \u79BB\u7EBF ${overview.offlineMode ? "\u5F00" : "\u5173"}` }),
    error !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "srw-error", children: error }) : null,
    notice !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "srw-detail", children: notice }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "srw-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { children: "\u79D1\u7814\u603B\u6839" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "srw-detail", children: rootDir === "" ? "\u672A\u8BBE\u7F6E\u2014\u2014\u9009\u62E9\u4E00\u4E2A\u76EE\u5F55\u4F5C\u4E3A\u5168\u90E8\u79D1\u7814\u9879\u76EE\u7684\u603B\u6839" : rootDir }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "srw-actions", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "srw-btn primary", disabled: busy, onClick: () => {
        void chooseRoot();
      }, children: rootDir === "" ? "\u9009\u62E9\u79D1\u7814\u603B\u6839" : "\u66F4\u6362\u79D1\u7814\u603B\u6839" }) }),
      engineWorkspaces.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { className: "srw-detail", children: [
        "\u5F15\u64CE\u5DE5\u4F5C\u533A\uFF1A",
        engineWorkspaces.join("\u3001"),
        "\uFF08\u53E3\u5F84\u6838\u5BF9\uFF1A\u4E0A\u65B9\u603B\u6839\u5E94\u4E0E\u67D0\u4E00\u5DE5\u4F5C\u533A\u76EE\u5F55\u4E00\u81F4\uFF09"
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "srw-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { children: "\u9879\u76EE" }),
      rootDir === "" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "srw-detail", children: "\u5148\u8BBE\u7F6E\u79D1\u7814\u603B\u6839\uFF0C\u518D\u521B\u5EFA\u9879\u76EE\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "srw-actions", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "srw-btn", disabled: busy, onClick: () => {
          setFormOpen((open) => !open);
        }, children: formOpen ? "\u6536\u8D77\u8868\u5355" : "\u65B0\u5EFA\u9879\u76EE" }) }),
        formOpen ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "srw-actions srw-form", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "input",
            {
              className: "srw-input",
              placeholder: "slug\uFF08\u5C0F\u5199\u5B57\u6BCD\u6570\u5B57\u8FDE\u5B57\u7B26\uFF09",
              value: formSlug,
              onChange: (event) => {
                setFormSlug(event.target.value);
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "input",
            {
              className: "srw-input",
              placeholder: "\u6807\u9898\uFF08\u2264200 \u5B57\uFF09",
              value: formTitle,
              onChange: (event) => {
                setFormTitle(event.target.value);
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "srw-btn primary", disabled: busy, onClick: () => {
            void createProject();
          }, children: "\u521B\u5EFA" })
        ] }) : null,
        projects.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "srw-detail", children: "\u8FD8\u6CA1\u6709\u9879\u76EE\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "srw-projects", children: projects.map((project) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { className: `srw-project ${project.slug === overview?.activeProject ? "active" : ""}`, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "srw-project-main", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "srw-project-title", children: project.title }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "srw-badge", children: STAGE_LABELS[project.stage] ?? project.stage })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "srw-project-meta", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: project.slug }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: "\xB7" }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: fmtTime(project.updatedAt) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "srw-actions", children: [
            project.slug === overview?.activeProject ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "srw-detail", children: "\u5F53\u524D\u9879\u76EE" }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "srw-btn", disabled: busy, onClick: () => {
              void openProject(project.slug);
            }, children: "\u6253\u5F00" }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "button",
              {
                className: `srw-btn ${confirmingSlug === project.slug ? "danger-confirm" : "danger"}`,
                disabled: busy,
                onClick: () => {
                  void removeProject(project.slug);
                },
                children: confirmingSlug === project.slug ? "\u786E\u8BA4\u5220\u9664\uFF1F\uFF08\u4E0D\u53EF\u6062\u590D\uFF09" : "\u5220\u9664"
              }
            )
          ] })
        ] }, project.slug)) })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "srw-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("h2", { children: [
        "\u6587\u732E\uFF08",
        overview?.activeProject === "" || overview?.activeProject === void 0 ? "\u672A\u9009\u9879\u76EE" : `\u9879\u76EE ${overview.activeProject}`,
        "\uFF09"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "srw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
          "select",
          {
            className: "srw-input",
            value: litSource,
            onChange: (event) => {
              setLitSource(event.target.value);
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "arxiv", children: "arXiv" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "openalex", children: "OpenAlex" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "crossref", children: "Crossref" })
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "input",
          {
            className: "srw-input",
            placeholder: "\u68C0\u7D22\u8BCD\uFF08arXiv \u53EF\u5E26 ti:/au:/all: \u524D\u7F00\uFF09",
            value: litQuery,
            onChange: (event) => {
              setLitQuery(event.target.value);
            },
            onKeyDown: (event) => {
              if (event.key === "Enter") {
                void litSearch();
              }
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "srw-btn primary", disabled: litBusy, onClick: () => {
          void litSearch();
        }, children: "\u68C0\u7D22" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "srw-btn", disabled: litBusy || litQuery.trim() === "", onClick: () => {
          void litToAgent();
        }, children: "\u8F6C\u7ED9 Agent" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "srw-btn", disabled: litBusy || libEntries.length === 0, onClick: () => {
          void litBibtex();
        }, children: "\u5BFC\u51FA BibTeX" })
      ] }),
      litNotice !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "srw-detail", children: litNotice }) : null,
      litResults.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "srw-projects", children: litResults.map((item) => {
        const key = `${item.source}:${item.identity.doi ?? item.identity.arxivId ?? item.identity.title}`;
        return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { className: "srw-project", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "srw-project-main", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "srw-project-title", children: item.identity.title }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "srw-badge", children: item.identity.year }),
            item.pdfUrl !== void 0 || item.oaUrl !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "srw-badge", children: "OA" }) : null
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "srw-project-meta", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
              item.authors.slice(0, 3).join(", "),
              item.authors.length > 3 ? " \u7B49" : ""
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: "\xB7" }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: item.venue === "" ? item.source : item.venue })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "srw-actions", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "srw-btn", disabled: litBusy || overview?.activeProject === "" || overview?.activeProject === void 0, onClick: () => {
            void litImport([item]);
          }, children: "\u5165\u5E93" }) })
        ] }, key);
      }) }) : null,
      libEntries.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("h2", { style: { marginTop: 10 }, children: [
          "\u9879\u76EE\u5E93\uFF08",
          libEntries.length,
          "\uFF09"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "srw-projects", children: libEntries.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { className: "srw-project", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "srw-project-main", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "srw-project-title", children: entry.identity.title }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: `srw-badge ${entry.status === "retracted" ? "bad" : ""}`, children: entry.status === "unread" ? "\u672A\u8BFB" : entry.status === "has-pdf" ? "\u6709 PDF" : entry.status === "retracted" ? "\u5DF2\u64A4\u7A3F" : entry.status })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "srw-project-meta", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: entry.identity.year }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: "\xB7" }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: entry.seenIn.join("+") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "srw-actions", children: entry.pdf === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "srw-btn", disabled: litBusy, onClick: () => {
            void litPdf(entry.key);
          }, children: "\u53D6 PDF" }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "srw-detail", children: "PDF \u5DF2\u5728 literature/pdf/" }) })
        ] }, entry.key)) })
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "srw-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("h2", { children: [
        "\u7CBE\u8BFB",
        readingStatus !== null ? `\uFF1A${readingStatus.paperKey}` : ""
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "srw-detail", children: "PDF \u62BD\u5757 \u2192 \u9010\u5757\u7FFB\u8BD1\uFF08\u6309\u54C8\u5E0C\u7F13\u5B58\uFF09\u2192 \u53CC\u8BED\u5BF9\u7167\u3002\u6821\u9A8C\u706F\uFF1A\u2713 \u6E90\u6BB5\u4E00\u81F4 / \u26A0 \u6E90\u6587\u88AB\u6539 / \u5B64\u7ACB = \u5757\u4E0D\u5728 source_map\u3002\u8BD1\u6587\u53EF\u968F\u624B\u6539\uFF0C\u6E90\u6BB5\u52A8\u4E86\u5C31\u4F1A\u4EAE \u26A0\u3002" }),
      readingNotice !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "srw-detail", children: readingNotice }) : null,
      pdfEntries.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "srw-detail", children: "\u9879\u76EE\u5E93\u91CC\u8FD8\u6CA1\u6709\u5E26 PDF \u7684\u6761\u76EE\u2014\u2014\u5148\u5728\u4E0A\u65B9\u6587\u732E\u5361\u300C\u53D6 PDF\u300D\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "srw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "select",
          {
            className: "srw-input",
            value: pdfEntries.some((entry) => entry.key === readingSelKey) ? readingSelKey : pdfEntries[0]?.key ?? "",
            onChange: (event) => {
              const picked = event.target.value;
              setReadingSelKey(picked);
              const entry = pdfEntries.find((item) => item.key === picked);
              setReadingKey(entry === void 0 ? "" : paperKeyOfLite(entry.key));
            },
            children: pdfEntries.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("option", { value: entry.key, children: [
              entry.identity.title.slice(0, 40),
              "\uFF08",
              entry.key,
              "\uFF09"
            ] }, entry.key))
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "input",
          {
            className: "srw-input",
            placeholder: "paperKey",
            value: readingKey,
            onChange: (event) => {
              setReadingKey(event.target.value);
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "srw-btn primary", disabled: readingBusy || readingKey.trim() === "", onClick: () => {
          void readingAction("extract");
        }, children: "\u62BD\u53D6" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "srw-btn", disabled: readingBusy || readingKey.trim() === "", onClick: () => {
          void readingAction("translate");
        }, children: "\u7FFB\u8BD1" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "srw-btn", disabled: readingBusy || readingKey.trim() === "", onClick: () => {
          void readingAction("verify");
        }, children: "\u6821\u9A8C" })
      ] }),
      readingStatus !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { className: "srw-project-meta", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
          readingStatus.pages,
          " \u9875"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: "\xB7" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
          "\u5757 ",
          readingStatus.blocks
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: "\xB7" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
          "\u5DF2\u8BD1 ",
          readingStatus.translated
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: "\xB7" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
          "\u2713 ",
          readingStatus.verified,
          " / \u26A0 ",
          readingStatus.mismatch,
          " / \u5B64 ",
          readingStatus.orphan,
          " / \u4E22 ",
          readingStatus.missing
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: "\xB7" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
          "LLM ",
          readingStatus.llmAvailable ? "\u53EF\u7528" : "\u4E0D\u53EF\u7528\uFF08\u7FFB\u8BD1\u9700\u5BBF\u4E3B\u9ED8\u8BA4\u6A21\u578B\uFF09"
        ] })
      ] }) : null,
      readingView !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "srw-list", children: readingView.map((block) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { className: "srw-item", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "srw-project-main", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: block.id }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: `srw-badge ${block.state === "verified" ? "" : "bad"}`, children: READING_STATE_LABELS[block.state] ?? block.state })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "srw-detail", style: { whiteSpace: "pre-wrap" }, children: block.sourceText }),
        block.translation !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { whiteSpace: "pre-wrap", margin: "4px 0 0" }, children: block.translation }) : null
      ] }, block.id)) }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "srw-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("h2", { children: [
        "\u8BA2\u9605\u6293\u53D6",
        overview?.watchSummary !== void 0 && overview.watchSummary.total > 0 ? `\uFF08\u542F\u7528 ${overview.watchSummary.enabled}/${overview.watchSummary.total}\uFF09` : ""
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "srw-detail", children: "\u5230\u671F\u7531\u5BBF\u4E3B\u300C\u81EA\u52A8\u5316\u4EFB\u52A1\u300D\u5524\u9192\u4F1A\u8BDD\u81EA\u52A8\u68C0\u7D22\u5165\u5E93\uFF08\u5E42\u7B49\u53BB\u91CD\uFF09\uFF1B\u65F6\u949F\u4EFB\u52A1\u53EF\u5728\u5BBF\u4E3B\u81EA\u52A8\u5316\u9875\u8C03\u6574\u3002" }),
      watchNotice !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "srw-detail", children: watchNotice }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "srw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
          "select",
          {
            className: "srw-input",
            value: watchSource,
            onChange: (event) => {
              setWatchSource(event.target.value);
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "arxiv", children: "arXiv" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "openalex", children: "OpenAlex" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "crossref", children: "Crossref" })
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
          "select",
          {
            className: "srw-input",
            value: watchEvery,
            onChange: (event) => {
              setWatchEvery(Number(event.target.value));
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: 900, children: "\u6BCF 15 \u5206\u949F" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: 3600, children: "\u6BCF\u5C0F\u65F6" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: 86400, children: "\u6BCF\u5929" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: 604800, children: "\u6BCF\u5468" })
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "input",
          {
            className: "srw-input",
            placeholder: '\u68C0\u7D22\u8BCD\uFF08\u5982 ti:"peer review"\uFF09',
            value: watchQuery,
            onChange: (event) => {
              setWatchQuery(event.target.value);
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "button",
          {
            className: "srw-btn",
            disabled: watchBusy || overview?.activeProject === "" || overview?.activeProject === void 0,
            onClick: () => {
              void watchCreate();
            },
            children: "\u8BA2\u9605\u5F53\u524D\u9879\u76EE"
          }
        )
      ] }),
      watchSubs.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "srw-list", children: watchSubs.map((subItem) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { className: "srw-item", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: subItem.source }),
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: subItem.query }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "srw-detail", children: [
            " \u2192 \u9879\u76EE ",
            subItem.project
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "srw-project-meta", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: subItem.enabled ? subItem.scheduleId !== void 0 ? "\u5DF2\u6392\u7A0B" : "\u672A\u6392\u7A0B" : "\u5DF2\u6682\u505C" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: "\xB7" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: subItem.lastResult === void 0 ? "\u5C1A\u672A\u8FD0\u884C" : subItem.lastResult.kind === "ok" ? `\u4E0A\u6B21\u65B0\u589E ${subItem.lastResult.fresh ?? 0} \u6761` : `\u4E0A\u6B21\u9519\u8BEF\uFF1A${subItem.lastResult.error ?? ""}` })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "srw-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "srw-btn", disabled: watchBusy, onClick: () => {
            void watchAction("run", subItem.id);
          }, children: "\u7ACB\u5373\u6293\u53D6" }),
          !subItem.enabled || subItem.scheduleId === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "button",
            {
              className: "srw-btn",
              disabled: watchBusy,
              title: "\u5411\u5BBF\u4E3B\u300C\u81EA\u52A8\u5316\u4EFB\u52A1\u300D\u6CE8\u518C/\u91CD\u5EFA\u65F6\u949F\u4EFB\u52A1",
              onClick: () => {
                void watchAction("resume", subItem.id);
              },
              children: subItem.enabled ? "\u8865\u6392\u7A0B" : "\u6062\u590D"
            }
          ) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "srw-btn", disabled: watchBusy, onClick: () => {
            void watchAction("pause", subItem.id);
          }, children: "\u6682\u505C" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "button",
            {
              className: `srw-btn ${confirmingWatchId === subItem.id ? "danger-confirm" : "danger"}`,
              disabled: watchBusy,
              onClick: () => {
                if (confirmingWatchId === subItem.id) {
                  setConfirmingWatchId(null);
                  void watchAction("remove", subItem.id);
                } else {
                  setConfirmingWatchId(subItem.id);
                }
              },
              children: confirmingWatchId === subItem.id ? "\u786E\u8BA4\u5220\u9664\uFF1F" : "\u5220\u9664"
            }
          )
        ] })
      ] }, subItem.id)) }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "srw-detail", children: "\u6682\u65E0\u8BA2\u9605\u3002\u68C0\u7D22\u8BCD\u5199\u6CD5\u4E0E\u300C\u6587\u732E\u300D\u5361\u4E00\u81F4\uFF08ti:/abs:/au: \u524D\u7F00\u53EF\u9009\uFF09\uFF1B\u5230\u70B9\u81EA\u52A8\u6293\u53D6\u8FDB\u5F53\u524D\u9879\u76EE\u5E93\u3002" })
    ] }),
    activeStage !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "srw-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("h2", { children: [
        "\u9636\u6BB5\u6D41\u6C34\u7EBF\uFF08",
        STAGE_LABELS[activeStage] ?? activeStage,
        "\uFF09"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "srw-pipeline", children: STAGES.map((stage) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: `srw-stage ${stage === activeStage ? "current" : ""}`, children: STAGE_LABELS[stage] ?? stage }, stage)) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "srw-detail", children: "M1 \u9636\u6BB5\u4E3A\u53EA\u8BFB\u5C55\u793A\uFF1B\u9636\u6BB5\u63A8\u8FDB\u968F M2+ \u9886\u57DF\u6A21\u5757\u89E3\u9501\u3002" })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "srw-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { className: "srw-btn link", onClick: () => {
        setDiagOpen((open) => !open);
      }, children: [
        diagOpen ? "\u25BE" : "\u25B8",
        " \u8BCA\u65AD\uFF08\u80FD\u529B\u63A2\u6D4B / E1 \u63A2\u6D4B / contains \u5B9E\u6D4B\uFF09"
      ] }) }),
      diagOpen ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(DiagView, { ctx }) : null
    ] })
  ] });
}

// src/client/index.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var name = "dsh-kylin-srw";
var inject = [
  "slots",
  "connection",
  "locale",
  "sessions",
  "uiWorkspace",
  "workspaces",
  "remote",
  "remote.session",
  "modelDirectories",
  "layout",
  // ── E1 专用临时注入（0201 Task 0.6；服务名均经 QiLin 源码/测试核对）──
  "sidebarRight",
  "documentPreviews",
  "uiSession",
  "conversation"
];
var PANEL_ID = "srw";
var NS = "srw";
function apply(ctx) {
  const disposeStyles = installStyles();
  ctx.effect?.(() => disposeStyles, "dsh-kylin-srw: styles");
  const locale = ctx.locale;
  if (locale?.register !== void 0) {
    ctx.effect?.(
      () => locale.register(NS, { zh: { nav: "\u79D1\u7814\u5DE5\u4F5C\u53F0" }, en: { nav: "Research" } }),
      "dsh-kylin-srw: dictionaries"
    );
  }
  const navLabel = locale?.bind !== void 0 ? () => locale.bind(NS)("nav") : "\u79D1\u7814\u5DE5\u4F5C\u53F0";
  const slots = ctx.slots;
  if (slots?.inject !== void 0) {
    try {
      slots.inject("sidebar.panellist", () => {
        const disposeIcon = slots.register({
          name: "sidebar.panellist",
          id: PANEL_ID,
          order: 130,
          label: navLabel,
          locale: NS
        }, PanelIcon);
        const disposePanel = slots.register({
          name: "main",
          key: PANEL_ID,
          locale: NS
        }, function SrwMount() {
          return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(WorkbenchView, { ctx });
        });
        return () => {
          disposePanel();
          disposeIcon();
        };
      });
    } catch (error) {
      console.warn("[dsh-kylin-srw] sidebar/main slot registration skipped:", error);
    }
    try {
      slots.inject("settings.section", () => slots.register({
        name: "settings.section",
        id: "srw-settings",
        order: 900,
        label: "\u79D1\u7814\u5DE5\u4F5C\u53F0"
      }, function SrwSettingsSection() {
        const [rootDir, setRootDir] = (0, import_react3.useState)("");
        const [busy, setBusy] = (0, import_react3.useState)(false);
        const [error, setError] = (0, import_react3.useState)(null);
        (0, import_react3.useEffect)(() => {
          let alive = true;
          const load = async () => {
            try {
              const rpc2 = ctx.connection?.rpc;
              const call = rpc2?.call;
              if (call === void 0) return;
              const raw = await call.call(rpc2, "/dsh-kylin-srw", "overview");
              const envelope = raw;
              if (alive && envelope?.ok === true) setRootDir(envelope.value?.rootDir ?? "");
            } catch {
            }
          };
          void load();
          return () => {
            alive = false;
          };
        }, []);
        const choose = async () => {
          const picker = ctx.uiWorkspace?.pickDirectory;
          if (picker === void 0) {
            setError("\u76EE\u5F55\u9009\u62E9\u4E0D\u53EF\u7528\uFF1A\u8BF7\u5230\u4FA7\u8FB9\u680F\u300C\u79D1\u7814\u5DE5\u4F5C\u53F0\u300D\u9762\u677F\u9009\u62E9\uFF08\u9762\u677F\u5185\u7F6E\u76EE\u5F55\u6D4F\u89C8\u5668\uFF09");
            return;
          }
          setBusy(true);
          setError(null);
          let timedOut = false;
          const timer = window.setTimeout(() => {
            timedOut = true;
            setBusy(false);
            setError("\u76EE\u5F55\u6846\u53EF\u80FD\u5DF2\u5F39\u51FA\u5728\u5BBF\u4E3B\u5C4F\u5E55\u4E0A\u7B49\u5F85\u9009\u62E9\uFF1B\u82E5\u672A\u51FA\u73B0\u8BF7\u5230\u9762\u677F\u91CD\u8BD5\u3002");
          }, 8e3);
          try {
            const picked = await picker.call(ctx.uiWorkspace);
            if (timedOut) return;
            if (picked === null || picked === "") return;
            const rpc2 = ctx.connection?.rpc;
            const call = rpc2?.call;
            if (call === void 0) throw new Error("connection.rpc.call \u4E0D\u53EF\u7528");
            await call.call(rpc2, "/dsh-kylin-srw", "root.set", { path: picked });
            setRootDir(picked);
          } catch (cause) {
            if (!timedOut) setError(String(cause));
          } finally {
            window.clearTimeout(timer);
            if (!timedOut) setBusy(false);
          }
        };
        return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { padding: "12px 4px", fontSize: 13, lineHeight: 1.7 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "\u79D1\u7814\u5DE5\u4F5C\u53F0" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { style: { margin: "6px 0" }, children: [
            "\u79D1\u7814\u603B\u6839\uFF1A",
            rootDir === "" ? "\u672A\u8BBE\u7F6E" : rootDir
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: "srw-btn", disabled: busy, onClick: () => {
            void choose();
          }, children: rootDir === "" ? "\u9009\u62E9\u79D1\u7814\u603B\u6839" : "\u66F4\u6362\u79D1\u7814\u603B\u6839" }),
          error !== null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: { margin: "6px 0 0", color: "var(--srw-error, #c0392b)" }, children: error }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: { margin: "10px 0 0", opacity: 0.75 }, children: "\u9879\u76EE\u7BA1\u7406\u5728\u4FA7\u8FB9\u680F\u300C\u79D1\u7814\u5DE5\u4F5C\u53F0\u300D\u9762\u677F\u4E2D\u8FDB\u884C\u3002" })
        ] });
      }));
    } catch (error) {
      console.warn("[dsh-kylin-srw] settings.section registration skipped:", error);
    }
  }
}
function PanelIcon(props) {
  const size = props.size ?? 18;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("path", { d: "M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a1.6 1.6 0 0 0-1.6-1.6H5.5A1.5 1.5 0 0 1 4 15.9Z" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("path", { d: "M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a1.6 1.6 0 0 1 1.6-1.6h4.9A1.5 1.5 0 0 0 20 15.9Z" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("path", { d: "M7 8.5h2.5M7 11.5h2.5M14.5 8.5H17M14.5 11.5H17" })
  ] });
}
return module.exports; } });
//# sourceMappingURL=client.js.map
