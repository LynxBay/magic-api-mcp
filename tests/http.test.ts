import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { http as mswHttp, HttpResponse } from "msw";
import { server as mswServer } from "./setup";
import type { AddressInfo } from "node:net";
import { MagicClient } from "../src/client/magic-client.js";
import type { Config } from "../src/config.js";
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

const EMPTY_TREE = {
  code: 1,
  message: "ok",
  data: {
    api: { node: { id: "0", name: "root", path: "", type: "api", parentId: "" }, children: [] },
  },
};

async function rpc(
  port: number,
  method: string,
  id: number,
  params: Record<string, unknown> = {},
  token?: string
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`http://127.0.0.1:${port}/mcp`, {
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

describe("http transport (no auth)", () => {
  let port: number;
  const closes: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    const client = new MagicClient(baseCfg());
    const srv = await startHttpServer(baseCfg({ httpPort: 0 }), client);
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

  it("responds to tools/list with all 13 tools", async () => {
    const res = await rpc(port, "tools/list", 1);
    expect(res.status).toBe(200);
    const msg = await parseRpc(res);
    expect(msg.result.tools).toHaveLength(13);
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

describe("http transport (auth)", () => {
  afterEach(() => mswServer.resetHandlers());

  it("rejects requests without token when ACCESS_TOKEN set", async () => {
    const client = new MagicClient(baseCfg());
    const srv = await startHttpServer(baseCfg({ httpPort: 0, accessToken: "sekret" }), client);
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
});
