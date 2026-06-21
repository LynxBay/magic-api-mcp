import type { MagicClient } from "../client/magic-client.js";
import type { ApiInfo } from "../client/types.js";
import { fetchTree } from "../resolver/resource-resolver.js";
import type { ToolDef } from "./group.js";

interface NamedFile extends ApiInfo {}

function collectNamedFiles(tree: any, folder: string): NamedFile[] {
  const root = tree[folder];
  const out: NamedFile[] = [];
  const walk = (node: any): void => {
    for (const c of node.children ?? []) {
      const n = c.node;
      if (n.id && n.name && n.script !== undefined && n.path) out.push(n);
      walk(c);
    }
  };
  if (root) walk(root);
  return out;
}

function collectGroupNames(tree: any, folder: string): Map<string, string> {
  const m = new Map<string, string>();
  const root = tree[folder];
  const walk = (node: any): void => {
    for (const c of node.children ?? []) {
      if (c.node.method === undefined) m.set(c.node.id, c.node.name);
      walk(c);
    }
  };
  if (root) walk(root);
  return m;
}

async function resolveRef(client: MagicClient, ref: string, folder: string): Promise<string> {
  const tree = await fetchTree(client);
  const files = collectNamedFiles(tree, folder);
  const byName = files.find((f) => f.name === ref || f.id === ref);
  if (byName) return byName.id!;
  throw new Error(`未找到${folder}资源：${ref}`);
}

export const listFunctionsTool: ToolDef<void, any[]> = {
  name: "list_functions",
  description: "列出所有 magic-script 函数。",
  inputSchema: { type: "object", properties: {} },
  readonly: true,
  handler: async (client) => {
    const tree = await fetchTree(client);
    const groups = collectGroupNames(tree, "function");
    return collectNamedFiles(tree, "function").map((f) => ({
      id: f.id, name: f.name, path: f.path, group: groups.get(f.groupId) ?? "",
    }));
  },
};

export const getFunctionTool: ToolDef<{ ref: string }, ApiInfo> = {
  name: "get_function",
  description: "获取函数详情（含脚本）。ref 为 id 或 name。",
  inputSchema: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] },
  readonly: true,
  handler: async (client, args) => {
    const id = await resolveRef(client, args.ref, "function");
    return client.managementGet<ApiInfo>(`resource/file/${id}`);
  },
};
