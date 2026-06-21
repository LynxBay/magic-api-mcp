import type { MagicClient } from "../client/magic-client.js";
import type { Group } from "../client/types.js";
import { collectGroups, fetchTree } from "../resolver/resource-resolver.js";

export interface ToolDef<A = Record<string, unknown>, R = unknown> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (client: MagicClient, args: A) => Promise<R>;
  readonly: boolean; // 是否为写工具
}

export const listGroupsTool: ToolDef<void, Group[]> = {
  name: "list_groups",
  description: "列出 magic-api 中所有分组（folder）。",
  inputSchema: { type: "object", properties: {} },
  readonly: true,
  handler: async (client) => {
    const tree = await fetchTree(client);
    const all: Group[] = [];
    for (const type of Object.keys(tree)) all.push(...collectGroups(tree, type));
    return all;
  },
};

export interface CreateGroupArgs {
  name: string;
  path: string;
  type?: string;
  parent?: string;
}

export const createGroupTool: ToolDef<CreateGroupArgs, string> = {
  name: "create_group",
  description: "创建分组。type 默认 api。返回新分组 id。",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "分组名称" },
      path: { type: "string", description: "分组路径段，如 user" },
      type: { type: "string", default: "api" },
      parent: { type: "string", description: "父分组 id，默认 0（根）" },
    },
    required: ["name", "path"],
  },
  readonly: false,
  handler: async (client, args) => {
    const body = {
      name: args.name,
      path: args.path,
      type: args.type ?? "api",
      parentId: args.parent ?? "0",
    };
    return client.managementPost<string>("resource/folder/save", body);
  },
};
