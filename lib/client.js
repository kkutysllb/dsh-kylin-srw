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
`;

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
  "sidebarRightTabs",
  "documentPreviews",
  "settings",
  "uiSession",
  "conversation"
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
  const rpc = ctx.connection?.rpc;
  const call = rpc?.call;
  if (call === void 0) throw new Error("connection.rpc.call \u4E0D\u53EF\u7528\uFF08connection \u672A\u6CE8\u5165\u6216\u7F3A rpc \u9762\uFF09");
  const raw = await call.call(rpc, RPC_CHANNEL, endpoint, payload);
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
function DiagView({ ctx }) {
  const [hostCaps, setHostCaps] = (0, import_react.useState)(null);
  const [info, setInfo] = (0, import_react.useState)(null);
  const [rpcError, setRpcError] = (0, import_react.useState)(null);
  const [log, setLog] = (0, import_react.useState)([]);
  const [sessionId, setSessionId] = (0, import_react.useState)("");
  const [busy, setBusy] = (0, import_react.useState)(false);
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
  const tryOpenViewer = (0, import_react.useCallback)(async (deferred) => {
    const sidebarRight = ctx["sidebarRight"];
    const name2 = deferred === true ? "openResourceIn" : "openResource";
    if (sidebarRight === void 0 || typeof sidebarRight[name2] !== "function") {
      pushLog("bad", `ctx.sidebarRight.${name2} \u4E0D\u53EF\u8FBE\uFF08\u670D\u52A1\u672A\u6CE8\u5165\u2014\u2014inject \u540D\u5355 E1 \u540E\u6269\uFF1B\u9884\u671F\u73B0\u8C61\u672C\u8EAB\u5373\u6570\u636E\uFF09`);
      return;
    }
    try {
      const args = deferred === true ? [sessionId, {}] : [{}];
      const result = await sidebarRight[name2].apply(sidebarRight, args);
      pushLog("ok", `sidebarRight.${name2} \u8FD4\u56DE\uFF1A${fmt(result)}`);
    } catch (error) {
      pushLog("bad", `sidebarRight.${name2} \u629B\u9519\uFF08\u4E3B\u533A\u88AB\u5360\u65F6\u9884\u671F "no session surface is mounted"\uFF09\uFF1A${String(error)}`);
    }
  }, [ctx, pushLog, sessionId]);
  const sendDraft = (0, import_react.useCallback)(async () => {
    const sid = sessionId.trim();
    const sessions = ctx.sessions;
    if (sid === "" || sessions === void 0) {
      pushLog("bad", "\u9001\u8349\u7A3F\u8DF3\u8FC7\uFF1A\u9700\u8981 sessionId\uFF08\u8F93\u5165\u6846\uFF09\u4E0E sessions \u670D\u52A1");
      return;
    }
    const submit = async (label, carrier) => {
      const scope = carrier;
      const shell = scope?.conversation?.input?.for?.(carrier);
      if (shell?.setDraft === void 0 || shell.submit === void 0) {
        pushLog("bad", `${label}: input shell \u4E0D\u53EF\u7528\uFF08for/setDraft/submit \u7F3A\u4E00\uFF09`);
        return false;
      }
      shell.setDraft(`[SRW E1] draft ping ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`);
      shell.submit();
      pushLog("ok", `${label}: setDraft+submit \u5DF2\u6267\u884C\uFF08\u8BF7\u5230\u76EE\u6807\u4F1A\u8BDD\u786E\u8BA4\u843D\u70B9\u6B63\u786E\u3001\u5207\u4F1A\u8BDD\u4E0D\u4E32\u53F0\uFF09`);
      return true;
    };
    const anySessions = sessions;
    if (typeof anySessions["retain"] === "function" && typeof anySessions["binding"] === "function") {
      try {
        const ref = anySessions["retain"].call(sessions, sid, { source: "srw" });
        if (ref?.ready !== void 0) await ref.ready;
        const bound = anySessions["binding"].call(sessions, sid);
        const carrier = bound?.ctx;
        ref?.release?.();
        if (carrier !== void 0 && await submit("\u8DEF\u5F84A retain+binding", carrier) === true) return;
      } catch (error) {
        pushLog("bad", `\u8DEF\u5F84A retain+binding \u629B\u9519\uFF1A${String(error)}`);
      }
    } else {
      pushLog("info", "\u8DEF\u5F84A \u4E0D\u53EF\u7528\uFF1Asessions.retain/binding \u672A\u6CE8\u5165");
    }
    if (typeof sessions.retainAgentScope === "function" && typeof sessions.scope === "function") {
      try {
        const ref = sessions.retainAgentScope.call(sessions, sid);
        const scope = sessions.scope.call(sessions, sid);
        const done = await submit("\u8DEF\u5F84B retainAgentScope+scope", scope);
        ref?.release?.();
        if (done) return;
      } catch (error) {
        pushLog("bad", `\u8DEF\u5F84B retainAgentScope+scope \u629B\u9519\uFF1A${String(error)}`);
      }
    } else {
      pushLog("info", "\u8DEF\u5F84B \u4E0D\u53EF\u7528\uFF1Asessions.retainAgentScope/scope \u672A\u6CE8\u5165");
    }
    pushLog("bad", "\u9001\u8349\u7A3F\u4E24\u6761\u8DEF\u5F84\u90FD\u672A\u6210\u529F\u2014\u2014E1 \u8BB0\u5F55\u539F\u59CB\u9519\u8BEF\u540E\u5B9A\u7A3F\u6B63\u786E\u901A\u8DEF");
  }, [ctx, pushLog, sessionId]);
  const tryOpenSettings = (0, import_react.useCallback)(async () => {
    const settings = ctx["settings"];
    if (settings === void 0) {
      pushLog("bad", "ctx.settings \u672A\u6CE8\u5165\uFF08settings.section \u69FD\u662F M1 \u8BBE\u7F6E\u9875\u7684\u6B63\u5F0F\u901A\u8DEF\uFF0C\u6B64\u6309\u94AE\u4EC5\u63A2\u6D4B\u670D\u52A1\u9762\uFF09");
      return;
    }
    const opener = Object.entries(settings).find(([, v]) => typeof v === "function");
    if (opener === void 0) {
      pushLog("info", `ctx.settings \u5B58\u5728\u4F46\u65E0\u53EF\u76F4\u8C03\u51FD\u6570\uFF1A${fmt(Object.keys(settings))}`);
      return;
    }
    try {
      const result = await opener[1].call(settings);
      pushLog("ok", `settings.${opener[0]}() \u8FD4\u56DE\uFF1A${fmt(result)}`);
    } catch (error) {
      pushLog("bad", `settings.${opener[0]}() \u629B\u9519\uFF1A${String(error)}`);
    }
  }, [ctx, pushLog]);
  const clientRows = CLIENT_PATHS.map((path) => ({ path, ...safeGet(ctx, path) }));
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "srw-panel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { className: "srw-h1", children: "\u79D1\u7814\u5DE5\u4F5C\u53F0 \xB7 M0 \u8BCA\u65AD" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "srw-sub", children: [
      info === null ? "\u5BBF\u4E3B\u4FE1\u606F\u52A0\u8F7D\u4E2D\u2026" : `v${String(info["version"] ?? "?")} \xB7 \u901A\u9053 ${String(info["home"]?.["channel"] ?? "?")} \xB7 home ${String(info["home"]?.["home"] ?? "?")} \xB7 \u79BB\u7EBF\u6A21\u5F0F ${info["offlineMode"] === true ? "\u5F00" : "\u5173"}`,
      rpcError !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: "var(--srw-error)" }, children: [
        " \xB7 RPC\uFF1A",
        rpcError
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "srw-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u5BBF\u4E3B\u80FD\u529B\uFF08RPC diag.caps\uFF09" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "srw-btn primary", disabled: busy, onClick: () => {
        void refresh();
      }, children: "\u91CD\u65B0\u63A2\u6D4B" }),
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
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "\u5BA2\u6237\u7AEF\u670D\u52A1\u9762\uFF08\u6CE8\u5165 10 + E1 \u5019\u9009\uFF09" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("table", { className: "srw-table", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: clientRows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: row.path }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `srw-dot ${row.present ? "ok" : "bad"}` }),
          row.present ? "\u53EF\u7528" : row.detail
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { className: "srw-detail", children: row.detail === "\u672A\u6CE8\u5165" ? "" : row.detail })
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
          void tryOpenViewer(false);
        }, children: "\u8BD5\u5F00\u6587\u6863\u67E5\u770B\u5668" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "srw-btn", onClick: () => {
          void tryOpenViewer(true);
        }, children: "\u8BD5\u5EF6\u8FDF\u6253\u5F00" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "srw-btn", onClick: () => {
          void sendDraft();
        }, children: "\u9001\u8349\u7A3F\u5230\u4F1A\u8BDD" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "srw-btn", onClick: () => {
          void tryOpenSettings();
        }, children: "\u8BBE\u7F6E\u9875\u5019\u9009\u63A2\u6D4B" })
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

// src/client/index.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
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
  "layout"
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
          return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(DiagView, { ctx });
        });
        return () => {
          disposePanel();
          disposeIcon();
        };
      });
    } catch (error) {
      console.warn("[dsh-kylin-srw] sidebar/main slot registration skipped:", error);
    }
  }
}
function PanelIcon(props) {
  const size = props.size ?? 18;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a1.6 1.6 0 0 0-1.6-1.6H5.5A1.5 1.5 0 0 1 4 15.9Z" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a1.6 1.6 0 0 1 1.6-1.6h4.9A1.5 1.5 0 0 0 20 15.9Z" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M7 8.5h2.5M7 11.5h2.5M14.5 8.5H17M14.5 11.5H17" })
  ] });
}
return module.exports; } });
//# sourceMappingURL=client.js.map
