import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { http as mswHttp, HttpResponse } from "msw";
import { server as mswServer } from "./setup";
import type { AddressInfo } from "node:net";
import { MagicClient } from "../src/client/magic-client.js";
import type { Config, ServerConfig, TargetConfig } from "../src/config.js";
import { TargetRegistry } from "../src/target-registry.js";
import { startHttpServer } from "../src/http-server.js";

const baseCfg = (over: Partial<Config> = {}): Config => ({
  baseUrl: "http://ma",
  webPath: "/magic/web",
  readonly: false,
  prefix: "",
  transport: "http",
  httpPort: 0,
  httpHost: "127.0.0.1",
  ...over,
});

const serverCfg = (over: Partial<ServerConfig> = {}): ServerConfig => ({
  transport: "http",
  httpPort: 0,
  httpHost: "127.0.0.1",
  ...over,
});

const targetCfg = (over: Partial<TargetConfig> = {}): TargetConfig => ({
  baseUrl: "http://ma",
  webPath: "/magic/web",
  readonly: false,
  prefix: "",
  ...over,
});

const EMPTY_TREE = {
  code: 1,
  message: "ok",
  data: {
    api: { node: { id: "0", name: "root", path: "", type: "api", parentId: "" }, children: [] },
  },
};

const treeWith = (name: string, id: string) => ({
  code: 1,
  message: "ok",
  data: {
    api: {
      node: { id: "0", name: "root", path: "", type: "api", parentId: "" },
      children: [{ node: { id, name, path: "p" }, children: [] }],
    },
  },
});

async function rpc(
  port: number,
  method: string,
  id: number,
  params: Record<string, unknown> = {},
  token?: string,
  path = "/mcp"
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

/** 兼容 JSON 与 SSE 两种响应体 */
async function parseRpc(res: Response): Promise<any> {
  const text = await res.text();
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    let last: string | null = null;
    for (const line of text.split("\n")) {
      if (line.startsWith("data:")) last = line.slice(5).trim();
    }
    return last ? JSON.parse(last) : null;
  }
  return JSON.parse(text);
}

describe("http transport — single mode (legacy /mcp)", () => {
  let port: number;
  const closes: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    const registry = TargetRegistry.forSingle(baseCfg());
    const srv = await startHttpServer(serverCfg(), registry);
    port = (srv.address() as AddressInfo).port;
    closes.push(() => new Promise<void>((r) => srv.close(() => r())));
  });
  beforeEach(() => {
    mswServer.use(
      mswHttp.get("http://ma/magic/web/resource", () => HttpResponse.json(EMPTY_TREE))
    );
  });
  afterAll(async () => {
    for (const c of closes) await c();
  });
  afterEach(() => mswServer.resetHandlers());

  it("responds to tools/list with all 21 tools", async () => {
    const res = await rpc(port, "tools/list", 1);
    expect(res.status).toBe(200);
    const msg = await parseRpc(res);
    expect(msg.result.tools).toHaveLength(21);
    expect(msg.result.tools.map((t: any) => t.name)).toContain("create_api");
  });

  it("handles tools/call list_groups end-to-end", async () => {
    const res = await rpc(port, "tools/call", 2, { name: "list_groups", arguments: {} });
    expect(res.status).toBe(200);
    const msg = await parseRpc(res);
    const payload = JSON.parse(msg.result.content[0].text);
    expect(Array.isArray(payload)).toBe(true);
  });
});

describe("http transport — multi mode (/mcp/<target>)", () => {
  let port: number;
  const closes: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    const registry = TargetRegistry.forMulti(
      new Map<string, TargetConfig>([
        ["prod", targetCfg({ baseUrl: "http://prod:9999" })],
        ["dev", targetCfg({ baseUrl: "http://dev:9999", readonly: true })],
      ])
    );
    const srv = await startHttpServer(serverCfg(), registry);
    port = (srv.address() as AddressInfo).port;
    closes.push(() => new Promise<void>((r) => srv.close(() => r())));
  });
  beforeEach(() => {
    mswServer.use(
      mswHttp.get("http://prod:9999/magic/web/resource", () => HttpResponse.json(treeWith("prod-group", "g1"))),
      mswHttp.get("http://dev:9999/magic/web/resource", () => HttpResponse.json(EMPTY_TREE))
    );
  });
  afterAll(async () => {
    for (const c of closes) await c();
  });
  afterEach(() => mswServer.resetHandlers());

  it("routes /mcp/prod to the prod backend", async () => {
    const res = await rpc(port, "tools/call", 1, { name: "list_groups", arguments: {} }, undefined, "/mcp/prod");
    expect(res.status).toBe(200);
    const msg = await parseRpc(res);
    const payload = JSON.parse(msg.result.content[0].text);
    expect(payload).toHaveLength(1);
    expect(payload[0].name).toBe("prod-group");
  });

  it("routes /mcp/dev to a different backend (isolation)", async () => {
    const res = await rpc(port, "tools/call", 1, { name: "list_groups", arguments: {} }, undefined, "/mcp/dev");
    expect(res.status).toBe(200);
    const msg = await parseRpc(res);
    const payload = JSON.parse(msg.result.content[0].text);
    expect(payload).toHaveLength(0); // dev 返回空树，与 prod 不同
  });

  it("404 on unknown target and lists available targets", async () => {
    const res = await rpc(port, "tools/list", 1, {}, undefined, "/mcp/unknown");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.message).toMatch(/unknown target.*unknown/i);
    expect(body.error.message).toContain("prod");
    expect(body.error.message).toContain("dev");
  });

  it("404 on bare /mcp in multi mode (target required)", async () => {
    const res = await rpc(port, "tools/list", 1); // 默认 path /mcp
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.message).toMatch(/target required/i);
  });
});

describe("http transport — auth", () => {
  afterEach(() => mswServer.resetHandlers());

  it("rejects requests without token when ACCESS_TOKEN set (single)", async () => {
    const registry = TargetRegistry.forSingle(baseCfg());
    const srv = await startHttpServer(serverCfg({ accessToken: "sekret" }), registry);
    const p = (srv.address() as AddressInfo).port;
    try {
      const noToken = await rpc(p, "tools/list", 1);
      expect(noToken.status).toBe(401);
      const withToken = await rpc(p, "tools/list", 2, {}, "sekret");
      expect(withToken.status).toBe(200);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });

  it("auth guards every target path (multi)", async () => {
    const registry = TargetRegistry.forMulti(
      new Map<string, TargetConfig>([["prod", targetCfg({ baseUrl: "http://prod:9999" })]])
    );
    const srv = await startHttpServer(serverCfg({ accessToken: "sekret" }), registry);
    const p = (srv.address() as AddressInfo).port;
    try {
      const noToken = await rpc(p, "tools/list", 1, {}, undefined, "/mcp/prod");
      expect(noToken.status).toBe(401);
      const withToken = await rpc(p, "tools/list", 2, {}, "sekret", "/mcp/prod");
      expect(withToken.status).toBe(200);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});

// 兜底：确保 MagicClient 仍接受完整 Config（向后兼容构造）
describe("MagicClient still accepts a full Config", () => {
  it("constructs and reports base/readonly", () => {
    const client = new MagicClient(baseCfg({ baseUrl: "http://x", readonly: true }));
    expect(client.getBase()).toBe("http://x");
    expect(client.isReadonly()).toBe(true);
  });
});
