import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { MagicClient } from "../client/magic-client.js";
import type { SearchResult } from "../client/types.js";
import type { ToolDef } from "./group.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOC_PATH = join(__dirname, "..", "knowledge", "magic-script.md");
const DOC = readFileSync(DOC_PATH, "utf-8");

export const magicScriptHelpTool: ToolDef<{ topic: string }, string> = {
  name: "magic_script_help",
  description: "查询 magic-script 用法（db/http/response/env 模块、请求变量、分页、事务等）。",
  inputSchema: {
    type: "object",
    properties: { topic: { type: "string", description: "主题关键词，如 db / http / 分页 / query" } },
    required: ["topic"],
  },
  readonly: true,
  handler: async (_client, args) => {
    const sections = DOC.split(/^## /m).filter(Boolean);
    const hit = sections.find((s) => s.toLowerCase().includes(args.topic.toLowerCase()));
    return hit ? `## ${hit}` : DOC.slice(0, 1500);
  },
};

export const searchCodeTool: ToolDef<{ keyword: string }, SearchResult[]> = {
  name: "search_code",
  description: "在所有接口/函数脚本中全局搜索关键词。",
  inputSchema: {
    type: "object",
    properties: { keyword: { type: "string" } },
    required: ["keyword"],
  },
  readonly: true,
  handler: async (client, args) => {
    return client.managementGet<SearchResult[]>("search", { keyword: args.keyword });
  },
};
