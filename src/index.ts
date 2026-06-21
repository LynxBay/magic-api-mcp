#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { MagicClient } from "./client/magic-client.js";
import { allTools } from "./tools/registry.js";
import { createMcpServer, startHttpServer } from "./http-server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new MagicClient(config);
  await client.init();

  if (config.transport === "http") {
    const httpServer = await startHttpServer(config, client);
    const addr = httpServer.address();
    const port = typeof addr === "object" && addr ? addr.port : config.httpPort;
    console.error(
      `magic-api-mcp (http) listening on ${config.httpHost}:${port} → ${config.baseUrl}${config.webPath} (readonly=${config.readonly}, auth=${!!config.accessToken}, tools=${allTools.length})`
    );
    return;
  }

  const server = createMcpServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `magic-api-mcp (stdio) ready → ${config.baseUrl}${config.webPath} (readonly=${config.readonly}, tools=${allTools.length})`
  );
}

main().catch((e) => {
  console.error("magic-api-mcp failed to start:", e);
  process.exit(1);
});
