import http from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListResourcesRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { MagicClient } from "./client/magic-client.js";
import type { ServerConfig } from "./config.js";
import type { TargetRegistry } from "./target-registry.js";
import { registerTools } from "./tools/registry.js";

/** 构造一个注册好全部工具的 MCP Server（stdio 与 http 模式共用） */
export function createMcpServer(client: MagicClient): Server {
  const server = new Server(
    { name: "magic-api-mcp", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } }
  );
  registerTools(server, client);
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));
  return server;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function jsonError(res: http.ServerResponse, status: number, message: string): void {
  if (res.headersSent) return;
  res
    .writeHead(status, { "content-type": "application/json" })
    .end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

class RouteError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** /mcp → single 默认后端；/mcp/<target> → multi 指名后端；其余 → 404 */
async function resolveClient(path: string, registry: TargetRegistry): Promise<MagicClient> {
  const available = () => registry.targetNames().join(", ") || "(none)";

  if (path === "/mcp") {
    const client = await registry.resolveDefault();
    if (!client) {
      throw new RouteError(404, `target required: use /mcp/<target>. available: ${available()}`);
    }
    return client;
  }

  const m = path.match(/^\/mcp\/([^/]+)$/);
  if (m) {
    const name = decodeURIComponent(m[1]);
    const client = await registry.resolveByName(name);
    if (!client) {
      throw new RouteError(404, `unknown target '${name}'. available: ${available()}`);
    }
    return client;
  }

  throw new RouteError(404, "Not found");
}

/** 启动 stateless streamable HTTP MCP server（每个请求独立 transport + server） */
export async function startHttpServer(
  server: ServerConfig,
  registry: TargetRegistry
): Promise<http.Server> {
  const httpServer = http.createServer(async (req, res) => {
    try {
      const path = (req.url ?? "").split("?")[0];

      // ACCESS_TOKEN 鉴权先行（不泄漏 target 列表给未授权请求）
      if (server.accessToken) {
        const auth = req.headers.authorization ?? "";
        if (auth !== `Bearer ${server.accessToken}`) {
          jsonError(res, 401, "Unauthorized: invalid or missing access token");
          return;
        }
      }

      if (req.method !== "POST") {
        // stateless 模式不维护长连接，仅接受 POST
        jsonError(res, 405, "Method not allowed (stateless mode, POST only)");
        return;
      }

      const body = await readBody(req);
      const client = await resolveClient(path, registry);
      const mcp = createMcpServer(client);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
      res.on("close", () => {
        transport.close();
        mcp.close();
      });
    } catch (e) {
      if (e instanceof RouteError) {
        jsonError(res, e.status, e.message);
        return;
      }
      console.error("magic-api-mcp http error:", e);
      jsonError(res, 500, "Internal server error");
    }
  });
  return new Promise((resolve) => {
    httpServer.listen(server.httpPort, server.httpHost, () => resolve(httpServer));
  });
}
