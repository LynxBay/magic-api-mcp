#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadServerConfig, loadTargets } from "./config.js";
import { TargetRegistry } from "./target-registry.js";
import { allTools } from "./tools/registry.js";
import { createMcpServer, startHttpServer } from "./http-server.js";

async function main(): Promise<void> {
  const server = loadServerConfig();
  const { mode, single, targets } = loadTargets();
  const registry = mode === "multi" ? TargetRegistry.forMulti(targets) : TargetRegistry.forSingle(single!);

  if (server.transport === "http") {
    const httpServer = await startHttpServer(server, registry);
    const addr = httpServer.address();
    const port = typeof addr === "object" && addr ? addr.port : server.httpPort;
    const backend =
      mode === "multi"
        ? `${targets.size} targets: ${[...targets.keys()].join(", ")}`
        : `${single!.baseUrl}${single!.webPath} (readonly=${single!.readonly})`;
    console.error(
      `magic-api-mcp (http) listening on ${server.httpHost}:${port} → ${backend} (auth=${!!server.accessToken}, tools=${allTools.length})`
    );
    return;
  }

  // stdio 没有 path/header，无法做多 target 路由
  if (mode === "multi") {
    throw new Error("multi-target mode requires HTTP transport (stdio has no target routing)");
  }

  const client = await registry.resolveDefault();
  if (!client) throw new Error("no backend configured");
  const mcp = createMcpServer(client);
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  console.error(
    `magic-api-mcp (stdio) ready → ${single!.baseUrl}${single!.webPath} (readonly=${single!.readonly}, tools=${allTools.length})`
  );
}

main().catch((e) => {
  console.error("magic-api-mcp failed to start:", e);
  process.exit(1);
});
