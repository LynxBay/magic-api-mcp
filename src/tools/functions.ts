import type { ApiInfo } from "../client/types.js";
import {
  collectFilesByFolder, collectGroupNamesByFolder, fetchTree, resolveFileRef,
} from "../resolver/resource-resolver.js";
import { getFile } from "../resolver/resource-repo.js";
import type { ToolDef } from "./group.js";

export const listFunctionsTool: ToolDef<void, any[]> = {
  name: "list_functions",
  description: "列出所有 magic-script 函数。",
  inputSchema: { type: "object", properties: {} },
  readonly: true,
  handler: async (client) => {
    const tree = await fetchTree(client);
    const groups = collectGroupNamesByFolder(tree, "function");
    return collectFilesByFolder(tree, "function").map((f: any) => ({
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
    const id = await resolveFileRef(client, args.ref, "function");
    return getFile<ApiInfo>(client, id);
  },
};
