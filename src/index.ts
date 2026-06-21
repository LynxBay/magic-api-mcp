#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListResourcesRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { MagicClient } from "./client/magic-client.js";
import { allTools, registerTools } from "./tools/registry.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new MagicClient(config);
  await client.init();

  const server = new Server(
    { name: "magic-api-mcp", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } }
  );

  registerTools(server, client);

  // 暴露 magic-script 文档为 resource（占位，便于后续扩展）
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `magic-api-mcp ready → ${config.baseUrl}${config.webPath} (readonly=${config.readonly}, tools=${allTools.length})`
  );
}

main().catch((e) => {
  console.error("magic-api-mcp failed to start:", e);
  process.exit(1);
});
