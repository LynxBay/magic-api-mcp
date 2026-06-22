import type { MagicClient } from "../client/magic-client.js";
import type { ApiInfo } from "../client/types.js";
import {
  buildGroupPathIndex, collectFiles, collectGroupNamesByFolder, fetchTree, resolveApiId, resolveRunPath,
} from "../resolver/resource-resolver.js";
import { deleteFile, ensureFolder, getFile, saveFile } from "../resolver/resource-repo.js";
import type { ToolDef } from "./group.js";

export interface ApiRefArgs {
  ref: string; // id 或 name 或 "METHOD /path"
}

export const listApisTool: ToolDef<{ group?: string }, any[]> = {
  name: "list_apis",
  description: "列出所有接口，含 id/name/method/path/runPath/group。可按分组名过滤。",
  inputSchema: {
    type: "object",
    properties: { group: { type: "string", description: "分组名（可选）" } },
  },
  readonly: true,
  handler: async (client, args) => {
    const tree = await fetchTree(client);
    const index = buildGroupPathIndex(tree);
    const files = collectFiles(tree, "api");
    const groupNames = collectGroupNamesByFolder(tree, "api");
    return files
      .filter((f) => !args.group || groupNames.get(f.groupId) === args.group)
      .map((f) => ({
        id: f.id,
        name: f.name,
        method: f.method,
        path: resolveRunPath(f, "", index),
        group: groupNames.get(f.groupId) ?? "",
      }));
  },
};

export const getApiTool: ToolDef<ApiRefArgs, ApiInfo> = {
  name: "get_api",
  description: "获取接口详情（含脚本）。ref 可为 id、name 或 path。",
  inputSchema: {
    type: "object",
    properties: { ref: { type: "string" } },
    required: ["ref"],
  },
  readonly: true,
  handler: async (client, args) => {
    const id = await resolveRefToId(client, args.ref);
    return getFile<ApiInfo>(client, id);
  },
};

export interface CreateApiArgs {
  path: string;
  method: string;
  name: string;
  group: string;
  script: string;
  description?: string;
}

export const createApiTool: ToolDef<CreateApiArgs, { id: string; runPath: string }> = {
  name: "create_api",
  description: "创建接口。自动建立缺失分组。返回 id 与完整运行路径 runPath。",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "接口路径，如 /detail" },
      method: { type: "string", description: "HTTP 方法，如 GET/POST" },
      name: { type: "string" },
      group: { type: "string", description: "分组名（不存在则自动创建）" },
      script: { type: "string", description: "magic-script 脚本" },
      description: { type: "string" },
    },
    required: ["path", "method", "name", "group", "script"],
  },
  readonly: false,
  handler: async (client, args) => {
    const groupId = await ensureFolder(client, args.group, "api");
    const body: ApiInfo = {
      id: null, name: args.name, method: args.method.toUpperCase(),
      path: args.path, script: args.script, groupId, description: args.description,
    };
    const id = await saveFile(client, "api", body);
    const index = buildGroupPathIndex(await fetchTree(client));
    const runPath = resolveRunPath({ ...body, id } as ApiInfo, "", index);
    return { id, runPath };
  },
};

export const updateApiScriptTool: ToolDef<ApiRefArgs & { script: string }, { id: string }> = {
  name: "update_api_script",
  description: "更新接口脚本。ref 可为 id/name/path。",
  inputSchema: {
    type: "object",
    properties: { ref: { type: "string" }, script: { type: "string" } },
    required: ["ref", "script"],
  },
  readonly: false,
  handler: async (client, args) => {
    const id = await resolveRefToId(client, args.ref);
    const old = await getFile<ApiInfo>(client, id);
    const updated: ApiInfo = { ...old, script: args.script };
    await saveFile(client, "api", updated, true);
    return { id };
  },
};

export const deleteApiTool: ToolDef<ApiRefArgs, { deleted: boolean }> = {
  name: "delete_api",
  description: "删除接口。ref 可为 id/name/path。",
  inputSchema: {
    type: "object",
    properties: { ref: { type: "string" } },
    required: ["ref"],
  },
  readonly: false,
  handler: async (client, args) => {
    const id = await resolveRefToId(client, args.ref);
    const ok = await deleteFile(client, id);
    return { deleted: !!ok };
  },
};

export interface RunApiArgs {
  path: string;
  method: string;
  params?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
}

export const runApiTool: ToolDef<RunApiArgs, { status: number; headers: Record<string, string>; body: string }> = {
  name: "run_api",
  description: "运行（测试）接口。向真实路径发请求并返回 status/headers/body。被测接口的错误不算工具错误。",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "完整运行路径，如 /user/list" },
      method: { type: "string" },
      params: { type: "object", description: "query 参数" },
      body: { description: "请求体（任意 JSON）" },
      headers: { type: "object" },
    },
    required: ["path", "method"],
  },
  readonly: true,
  handler: async (client, args) => {
    return client.runApi(args.path, {
      method: args.method.toUpperCase(),
      params: args.params,
      body: args.body,
      headers: args.headers,
    });
  },
};

/** ref → id（支持 id 直传、name、"METHOD /path"） */
async function resolveRefToId(client: MagicClient, ref: string): Promise<string> {
  const tree = await fetchTree(client);
  const trimmed = ref.trim();
  // METHOD /path 形式
  const m = /^([A-Za-z]+)\s+(\/.*)$/.exec(trimmed);
  if (m) return resolveApiId(tree, { path: m[2], method: m[1] });
  // 纯 path
  if (trimmed.startsWith("/")) return resolveApiId(tree, { path: trimmed });
  // 否则当作 id 或 name：先按 name，失败则当 id
  try {
    return resolveApiId(tree, { name: trimmed });
  } catch {
    return trimmed;
  }
}
