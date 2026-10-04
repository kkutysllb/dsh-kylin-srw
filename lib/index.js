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

// src/service.ts
var ServiceError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "ServiceError";
  }
};
var SrwService = class _SrwService {
  constructor(ctx, config, startedAt) {
    this.ctx = ctx;
    this.config = config;
    this.startedAt = startedAt;
  }
  static async open(ctx, rawConfig) {
    const config = {
      rootDir: typeof rawConfig?.rootDir === "string" ? rawConfig.rootDir : "",
      offlineMode: rawConfig?.offlineMode === true
    };
    return new _SrwService(ctx, config, Date.now());
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
  "webServer"
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
