// src/diag.ts
var HOST_SERVICE_PATHS = [
  "connection",
  "connection.rpc",
  "connection.requestRejection",
  "webServer",
  "settings",
  "storageDomain",
  "workspaceRegistry",
  "fs",
  "fs.contains",
  "fs.writeBytes",
  "fs.watch",
  "llm",
  "llm.stream",
  "agentDefaultModel",
  "ssh",
  "schedule",
  "agents",
  "sessions",
  "jobs",
  "tools",
  "skills",
  "commands",
  "credentials",
  "systemPrompt",
  "directoryPickerController",
  "spillStore",
  "reflect"
];
function probe(ctx, path) {
  let current = ctx;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") {
      return { name: path, available: false, detail: "parent absent" };
    }
    try {
      current = current[part];
    } catch (error) {
      return { name: path, available: false, detail: `threw: ${String(error)}` };
    }
    if (current === void 0) return { name: path, available: false, detail: "absent" };
  }
  return { name: path, available: true, detail: typeof current };
}
function collectCaps(ctx) {
  return HOST_SERVICE_PATHS.map((path) => probe(ctx, path));
}

// src/host.ts
function hostHome(env = process.env) {
  if (env["QILIN_HOME"] !== void 0) return { channel: "qilin", home: env["QILIN_HOME"] };
  if (env["DSH_HOME"] !== void 0) return { channel: "dsh", home: env["DSH_HOME"] };
  return { channel: "unknown", home: "" };
}

// src/workspace/project.ts
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

// src/core/schema.ts
var STAGES = ["idea", "literature", "reading", "writing", "experiments", "submission"];
var SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
function validateProjectMeta(value) {
  if (typeof value !== "object" || value === null) return ["project.json \u5FC5\u987B\u662F\u5BF9\u8C61"];
  const m = value;
  const errors = [];
  if (m["schemaVersion"] !== 1) errors.push("schemaVersion \u5FC5\u987B\u4E3A 1");
  if (typeof m["slug"] !== "string" || !SLUG_RE.test(m["slug"])) {
    errors.push("slug \u5FC5\u987B\u5339\u914D ^[a-z0-9][a-z0-9-]{0,63}$");
  }
  if (typeof m["title"] !== "string" || m["title"] === "" || m["title"].length > 200) {
    errors.push("title \u5FC5\u586B\uFF08\u2264200\uFF09");
  }
  if (typeof m["stage"] !== "string" || !STAGES.includes(m["stage"])) {
    errors.push(`stage \u5FC5\u987B\u662F ${STAGES.join("|")}`);
  }
  for (const key of ["createdAt", "updatedAt"]) {
    const v = m[key];
    if (typeof v !== "string" || v === "" || Number.isNaN(Date.parse(v))) {
      errors.push(`${key} \u5FC5\u987B\u662F ISO \u65F6\u95F4`);
    }
  }
  return errors;
}

// src/workspace/project.ts
var PROJECT_SUBDIRS = [
  ".srw",
  "literature/pdf",
  "literature/notes",
  "literature/readings",
  "paper",
  "experiments",
  "materials"
];
var TITLE_LIMIT = 200;
function assertTitle(title) {
  if (typeof title !== "string" || title.trim() === "" || title.length > TITLE_LIMIT) {
    throw new ServiceError("INVALID", `title \u5FC5\u586B\uFF08\u2264${TITLE_LIMIT}\uFF09`);
  }
}
function projectMetaPath(rootAbs, slug) {
  return join(rootAbs, slug, ".srw", "project.json");
}
var WorkspaceStore = class {
  constructor(rootAbs) {
    this.rootAbs = rootAbs;
  }
  dir(slug) {
    if (!SLUG_RE.test(slug)) throw new ServiceError("INVALID", `slug \u975E\u6CD5\uFF1A${JSON.stringify(slug)}`);
    const root = this.rootAbs();
    if (root === void 0 || root === "") throw new ServiceError("NO_ROOT", "\u79D1\u7814\u603B\u6839\u672A\u8BBE\u7F6E\uFF08\u5148\u5728\u9762\u677F\u9009\u62E9\uFF09");
    return join(root, slug);
  }
  /** 实扫总根：目录名合 slug 法 + project.json 可校验才算项目。 */
  async list() {
    const root = this.rootAbs();
    if (root === void 0 || root === "") return [];
    const entries = await readdir(root, { withFileTypes: true });
    const projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !SLUG_RE.test(entry.name)) continue;
      try {
        const meta = JSON.parse(await readFile(projectMetaPath(root, entry.name), "utf8"));
        if (validateProjectMeta(meta).length === 0) projects.push(meta);
      } catch {
      }
    }
    return projects.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async create(input) {
    assertTitle(input.title);
    const dir = this.dir(input.slug);
    let exists = false;
    try {
      await stat(dir);
      exists = true;
    } catch {
    }
    if (exists) throw new ServiceError("CONFLICT", `\u9879\u76EE\u76EE\u5F55\u5DF2\u5B58\u5728\uFF1A${input.slug}`);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const meta = {
      schemaVersion: 1,
      slug: input.slug,
      title: input.title,
      ...input.field === void 0 ? {} : { field: input.field },
      stage: "idea",
      createdAt: now,
      updatedAt: now
    };
    for (const sub of PROJECT_SUBDIRS) {
      await mkdir(join(dir, sub), { recursive: true });
    }
    await writeFile(join(dir, ".srw", "project.json"), JSON.stringify(meta, null, 2) + "\n");
    return meta;
  }
  async open(slug) {
    let raw;
    try {
      raw = await readFile(join(this.dir(slug), ".srw", "project.json"), "utf8");
    } catch (error) {
      const code = error.code;
      if (code === "ENOENT") throw new ServiceError("NOT_FOUND", `\u9879\u76EE\u4E0D\u5B58\u5728\uFF1A${slug}`);
      throw error;
    }
    let meta;
    try {
      meta = JSON.parse(raw);
    } catch {
      throw new ServiceError("INVALID", `project.json \u4E0D\u662F\u5408\u6CD5 JSON\uFF1A${slug}`);
    }
    const errors = validateProjectMeta(meta);
    if (errors.length > 0) throw new ServiceError("INVALID", `project.json \u635F\u574F\uFF1A${errors.join("\uFF1B")}`);
    return meta;
  }
  /** 危险操作：二次确认由调用方负责（面板对话框 / 工具 pre-execute ask）。 */
  async remove(slug) {
    await rm(this.dir(slug), { recursive: true, force: false });
  }
  async rename(slug, title) {
    assertTitle(title);
    const meta = await this.open(slug);
    const next = { ...meta, title, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    await writeFile(join(this.dir(slug), ".srw", "project.json"), JSON.stringify(next, null, 2) + "\n");
    return next;
  }
  /** 目录级重命名（slug 变更）：项目元数据随目录移动，slug 字段同步改写。 */
  async moveSlug(fromSlug, toSlug) {
    const from = this.dir(fromSlug);
    const to = this.dir(toSlug);
    let exists = false;
    try {
      await stat(to);
      exists = true;
    } catch {
    }
    if (exists) throw new ServiceError("CONFLICT", `\u76EE\u6807\u76EE\u5F55\u5DF2\u5B58\u5728\uFF1A${toSlug}`);
    await rename(from, to);
    const meta = await this.open(toSlug);
    const next = { ...meta, slug: toSlug, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    await writeFile(join(to, ".srw", "project.json"), JSON.stringify(next, null, 2) + "\n");
    return next;
  }
};

// src/service.ts
var ServiceError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "ServiceError";
  }
};
async function awaited(value) {
  return await value;
}
var SrwService = class _SrwService {
  constructor(ctx, config, startedAt, workspace) {
    this.ctx = ctx;
    this.config = config;
    this.startedAt = startedAt;
    this.workspace = workspace;
  }
  /** storage 全局里的总根（Task 1.4 srw_index 写入；config 缺省时的回落源）。 */
  storageRootDir;
  static async open(ctx, rawConfig) {
    const config = {
      rootDir: typeof rawConfig?.rootDir === "string" ? rawConfig.rootDir : "",
      offlineMode: rawConfig?.offlineMode === true
    };
    const service = new _SrwService(
      ctx,
      config,
      Date.now(),
      new WorkspaceStore(() => service.currentRoot())
    );
    return service;
  }
  /** 当前科研总根（未设置 = undefined）。单源判定：config 优先，storage 全局回落。 */
  currentRoot() {
    const fromConfig = (this.config.rootDir ?? "").trim();
    if (fromConfig !== "") return fromConfig;
    const fromStorage = this.storageRootDir?.trim();
    return fromStorage !== void 0 && fromStorage !== "" ? fromStorage : void 0;
  }
  /** Task 1.4：root.set 落定后的总根更新入口（进程内生效；持久化在 srw_index）。 */
  adoptRoot(rootDir) {
    this.storageRootDir = rootDir;
  }
  /** 轻量探活（`diag.ping` 端点）。 */
  ping() {
    return { pong: true, at: (/* @__PURE__ */ new Date()).toISOString(), uptimeMs: Date.now() - this.startedAt };
  }
  info(version) {
    return {
      version,
      offlineMode: this.config.offlineMode === true,
      rootDir: this.config.rootDir ?? "",
      home: hostHome()
    };
  }
  /** 宿主能力表（`diag.caps` 端点；E1/E2 与 V 系列核对的数据源）。 */
  caps() {
    return collectCaps(this.ctx);
  }
  /** `diag.contains`（Task 1.2 / V4 实测端点）：宿主 fs 的 resolve→contains
   * 真值测量。**这是诊断不是护栏**——越界返回 contained:false 而非抛错；
   * 正式放行必须走 assertInsideRoot（fail-closed）。 */
  async diagContains(rootAbs, targetRel) {
    const fs = this.ctx.fs;
    if (fs?.resolve === void 0 || fs.contains === void 0) {
      throw new ServiceError("NO_PROVIDER", "\u5BBF\u4E3B fs.resolve/contains \u7F3A\u5E2D");
    }
    try {
      const rootTarget = await awaited(fs.resolve(rootAbs));
      const target = await awaited(fs.resolve(targetRel, { cwd: rootAbs }));
      return { contained: fs.contains(rootTarget, target) === true };
    } catch (error) {
      return { contained: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }
  /** 宿主 schedule 服务面（E3 边界试验专用；经 ctx.get 动态取，不进 inject
   * 名单——避免缺名导致激活失败）。M3 正式接入时再按 ADR-8 定稿。 */
  schedule() {
    const schedule = this.ctx["schedule"];
    if (schedule === void 0) {
      throw new ServiceError("NO_PROVIDER", "\u5BBF\u4E3B schedule \u670D\u52A1\u7F3A\u5E2D\uFF08ctx.get \u672A\u53D6\u5230\uFF1B\u5BBF\u4E3B\u6216 profile \u672A\u6302\u8F7D\uFF09");
    }
    return schedule;
  }
  /** E3-A/B：创建提醒（恰一个 selector）。 */
  async scheduleCreate(input) {
    const schedule = this.schedule();
    const request = { title: input.title, prompt: input.prompt };
    if (input.afterSeconds !== void 0) request["after_seconds"] = input.afterSeconds;
    if (input.everySeconds !== void 0) request["every_seconds"] = input.everySeconds;
    return await schedule["create"]?.call(schedule, input.sessionId, request);
  }
  /** E3：列出某会话的 active 任务。 */
  async scheduleList(sessionId) {
    const schedule = this.schedule();
    return await schedule["list"]?.call(schedule, { sessionId });
  }
  /** E3：删除任务。 */
  async scheduleDelete(sessionId, id) {
    const schedule = this.schedule();
    return await schedule["delete"]?.call(schedule, { sessionId, id });
  }
  /** E3-C：读 schedule 存储落点（宿主 home 下 storages/schedule.json）。 */
  scheduleStoragePath() {
    return `${hostHome().home}/storages/schedule.json`;
  }
  async dispose() {
  }
};

// src/rpc.ts
var RPC_CHANNEL = "/dsh-kylin-srw";
var RPC_BODY_LIMIT_BYTES = 4 * 1024 * 1024;
function ok(value) {
  return { ok: true, value };
}
function fail(code, message) {
  return { ok: false, error: { code, message } };
}
function toErrorResult(error, aborted) {
  if (aborted) return fail("aborted", "The request was aborted.");
  if (error instanceof ServiceError) return fail(error.code, error.message);
  return fail("internal", error instanceof Error ? error.message : String(error));
}
function record(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ServiceError("INVALID", "payload must be an object");
  }
  return value;
}
function reqString(body, key) {
  const value = body[key];
  if (typeof value !== "string" || value === "" || value.length > 5e3) {
    throw new ServiceError("INVALID", `${key} must be a non-empty string (\u22645000)`);
  }
  return value;
}
function optNumber(body, key) {
  const value = body[key];
  if (value === void 0) return void 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 86400) {
    throw new ServiceError("INVALID", `${key} must be an integer 1..86400`);
  }
  return value;
}
function registerSrwRpc(ctx, service) {
  const webServer = ctx.webServer;
  if (webServer?.register === void 0) {
    throw new ServiceError("NO_PROVIDER", "\u5BBF\u4E3B webServer \u670D\u52A1\u7F3A\u5E2D\uFF0CRPC \u901A\u9053\u65E0\u6CD5\u6CE8\u518C");
  }
  const route = {
    kind: "prefix",
    path: RPC_CHANNEL,
    handler: (req, res) => {
      void serveRpcRequest(ctx, service, req, res);
    }
  };
  if (ctx.effect !== void 0) {
    return ctx.effect(() => webServer.register(route), "dsh-kylin-srw: rpc channel");
  }
  const disposer = webServer.register(route);
  return async () => {
    await disposer?.();
  };
}
async function serveRpcRequest(ctx, service, req, res) {
  const reply = (status, payload) => {
    res.writeHead(status, { "content-type": "application/json", connection: "close" });
    res.end(JSON.stringify(payload));
  };
  const rejection = ctx.connection?.requestRejection?.(req);
  if (rejection !== void 0) {
    res.writeHead(rejection);
    res.end(rejection === 401 ? "unauthorized" : "forbidden");
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "text/plain" });
    res.end("method not allowed");
    return;
  }
  const url = new URL(req.url ?? "/", "http://dsh.internal");
  const endpoint = url.pathname === RPC_CHANNEL ? "" : url.pathname.startsWith(`${RPC_CHANNEL}/`) ? url.pathname.slice(RPC_CHANNEL.length + 1) : void 0;
  if (endpoint === void 0 || !/^[A-Za-z0-9_$.:-]+$/.test(endpoint)) {
    reply(404, { type: "server-response", rpcId: "invalid-request", result: fail("not-found", "unknown endpoint") });
    return;
  }
  const contentType = String(req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    reply(415, { type: "server-response", rpcId: "invalid-request", result: fail("invalid", "content type must be application/json") });
    return;
  }
  const declared = req.headers["content-length"];
  if (declared !== void 0 && Number(declared) > RPC_BODY_LIMIT_BYTES) {
    res.writeHead(413, { connection: "close" });
    res.end();
    return;
  }
  let raw = "";
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });
  try {
    let received = 0;
    for await (const chunk of req) {
      received += chunk.byteLength;
      if (received > RPC_BODY_LIMIT_BYTES) throw new Error("body too large");
      raw += String(chunk);
    }
  } catch {
    res.writeHead(400, { connection: "close" });
    res.end("body read failure");
    req.destroy();
    return;
  }
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    reply(400, { type: "server-response", rpcId: "invalid-request", result: fail("invalid", "body is not JSON") });
    return;
  }
  if (envelope?.type !== "client-request" || typeof envelope.rpcId !== "string" || typeof envelope.method !== "string") {
    reply(200, {
      type: "server-response",
      rpcId: typeof envelope?.rpcId === "string" ? envelope.rpcId : "invalid-request",
      result: fail("invalid", "invalid client-request message")
    });
    return;
  }
  if (envelope.method !== endpoint) {
    reply(200, {
      type: "server-response",
      rpcId: envelope.rpcId,
      result: fail("invalid", `method ${JSON.stringify(envelope.method)} does not match endpoint ${JSON.stringify(endpoint)}`)
    });
    return;
  }
  const result = await handleSrwRpc(service, envelope.method, envelope.payload, abort.signal);
  reply(200, { type: "server-response", rpcId: envelope.rpcId, result });
}
async function handleSrwRpc(service, endpoint, payload, signal) {
  try {
    signal.throwIfAborted();
    switch (endpoint) {
      case "diag.ping":
        return ok(service.ping());
      case "diag.caps":
        return ok({ caps: service.caps(), info: service.info(SRW_VERSION) });
      case "diag.echo":
        return ok({ echoed: payload });
      case "diag.contains": {
        const body = record(payload);
        return ok(await service.diagContains(reqString(body, "root"), reqString(body, "target")));
      }
      case "diag.schedule.create": {
        const body = record(payload);
        const afterSeconds = optNumber(body, "afterSeconds");
        const everySeconds = optNumber(body, "everySeconds");
        return ok(await service.scheduleCreate({
          sessionId: reqString(body, "sessionId"),
          title: reqString(body, "title"),
          prompt: reqString(body, "prompt"),
          ...afterSeconds === void 0 ? {} : { afterSeconds },
          ...everySeconds === void 0 ? {} : { everySeconds }
        }));
      }
      case "diag.schedule.list":
        return ok(await service.scheduleList(reqString(record(payload), "sessionId")));
      case "diag.schedule.delete": {
        const body = record(payload);
        return ok(await service.scheduleDelete(reqString(body, "sessionId"), reqString(body, "id")));
      }
      case "diag.schedule.storage":
        return ok({ path: service.scheduleStoragePath() });
      default:
        return fail("not-found", `unknown endpoint ${JSON.stringify(endpoint)}`);
    }
  } catch (error) {
    return toErrorResult(error, signal.aborted);
  }
}
var SRW_VERSION = "0.0.1";

// src/index.ts
var name = "dsh-kylin-srw";
var inject = [
  "connection",
  "webServer",
  "storageDomain",
  "workspaceRegistry",
  "settings",
  "fs"
];
async function apply(ctx, rawConfig) {
  await ctx.effect(async () => {
    const service = await SrwService.open(ctx, rawConfig);
    ctx.reflect?.provide("srw", service);
    const removeRpc = registerSrwRpc(ctx, service);
    return async () => {
      await removeRpc();
      await service.dispose();
    };
  }, "dsh-kylin-srw: host");
}
export {
  apply,
  inject,
  name
};
