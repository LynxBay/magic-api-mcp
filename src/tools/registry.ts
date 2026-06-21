import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { MagicClient } from "../client/magic-client.js";
import type { ToolDef } from "./group.js";
import { createGroupTool, listGroupsTool } from "./group.js";
import { createApiTool, deleteApiTool, getApiTool, listApisTool, runApiTool, updateApiScriptTool } from "./api.js";
import { getFunctionTool, listFunctionsTool } from "./functions.js";
import { listDatasourcesTool } from "./datasource.js";
import { magicScriptHelpTool, searchCodeTool } from "./knowledge.js";

export const allTools: ToolDef<any, any>[] = [
  listGroupsTool, createGroupTool,
  listApisTool, getApiTool, createApiTool, updateApiScriptTool, deleteApiTool, runApiTool,
  listFunctionsTool, getFunctionTool, listDatasourcesTool,
  magicScriptHelpTool, searchCodeTool,
];

export function isWriteTool(name: string): boolean {
  const t = allTools.find((x) => x.name === name);
  return !!t && !t.readonly;
}

export function registerTools(server: Server, client: MagicClient): void {
  const readonly = client.isReadonly();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools
      .filter((t) => !(readonly && isWriteTool(t.name))) // readonly 模式隐藏写工具
      .map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as any,
      })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const tool = allTools.find((t) => t.name === name);
    if (!tool) throw new Error(`未知工具：${name}`);
    if (readonly && isWriteTool(name)) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ ok: false, kind: "readonly", message: `只读模式已禁用写工具：${name}` }) },
        ],
      };
    }
    try {
      const result = await tool.handler(client, (req.params.arguments ?? {}) as any);
      return {
        content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: false, kind: "error", message: (e as Error).message }) }],
        isError: true,
      };
    }
  });
}
