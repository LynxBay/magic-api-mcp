import http from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListResourcesRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { MagicClient } from "./client/magic-client.js";
import type { Config } from "./config.js";
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

/** 启动 stateless streamable HTTP MCP server（每个请求独立 transport + server） */
export async function startHttpServer(config: Config, client: MagicClient): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url || !req.url.split("?")[0].endsWith("/mcp")) {
        jsonError(res, 404, "Not found");
        return;
      }
      // ACCESS_TOKEN 鉴权
      if (config.accessToken) {
        const auth = req.headers.authorization ?? "";
        if (auth !== `Bearer ${config.accessToken}`) {
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
      const mcp = createMcpServer(client);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
      res.on("close", () => {
        transport.close();
        mcp.close();
      });
    } catch (e) {
      console.error("magic-api-mcp http error:", e);
      jsonError(res, 500, "Internal server error");
    }
  });
  return new Promise((resolve) => {
    server.listen(config.httpPort, config.httpHost, () => resolve(server));
  });
}
