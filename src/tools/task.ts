import type { MagicClient } from "../client/magic-client.js";
import type { TaskInfo } from "../client/types.js";
import {
  collectFilesByFolder, collectGroupNamesByFolder, fetchTree, resolveFileRef,
} from "../resolver/resource-resolver.js";
import { deleteFile, ensureFolder, getFile, saveFile } from "../resolver/resource-repo.js";
import type { ToolDef } from "./group.js";

const FOLDER = "task";

/** 取旧值 → 仅覆盖 patch 中非 undefined 字段 → 保存（update=true 走 auto=1） */
async function applyPatch(client: MagicClient, id: string, patch: Partial<TaskInfo>): Promise<void> {
  const old = await getFile<TaskInfo>(client, id);
  const next: TaskInfo = { ...old };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (next as any)[k] = v;
  }
  await saveFile(client, FOLDER, next, true);
}

/** ref → 改 enabled → 保存，返回 id（enable/disable 共用） */
async function setTaskEnabled(client: MagicClient, ref: string, enabled: boolean): Promise<string> {
  const id = await resolveFileRef(client, ref, FOLDER);
  await applyPatch(client, id, { enabled });
  return id;
}

export const listTasksTool: ToolDef<{ group?: string }, any[]> = {
  name: "list_tasks",
  description: "列出所有定时任务，含 id/name/path/cron/enabled/group。可按分组名过滤。",
  inputSchema: {
    type: "object",
    properties: { group: { type: "string", description: "分组名（可选）" } },
  },
  readonly: true,
  handler: async (client, args) => {
    const tree = await fetchTree(client);
    const groups = collectGroupNamesByFolder(tree, FOLDER);
    return collectFilesByFolder(tree, FOLDER)
      .filter((f: any) => !args.group || groups.get(f.groupId) === args.group)
      .map((f: any) => ({
        id: f.id, name: f.name, path: f.path, cron: f.cron, enabled: f.enabled,
        group: groups.get(f.groupId) ?? "",
      }));
  },
};

export const getTaskTool: ToolDef<{ ref: string }, TaskInfo> = {
  name: "get_task",
  description: "获取定时任务详情（含脚本/cron/enabled）。ref 可为 id、name 或 path。",
  inputSchema: {
    type: "object",
    properties: { ref: { type: "string" } },
    required: ["ref"],
  },
  readonly: true,
  handler: async (client, args) => {
    const id = await resolveFileRef(client, args.ref, FOLDER);
    return getFile<TaskInfo>(client, id);
  },
};

export interface CreateTaskArgs {
  name: string;
  group: string;
  cron: string;
  script: string;
  path?: string;
  enabled?: boolean;
  description?: string;
}

export const createTaskTool: ToolDef<CreateTaskArgs, { id: string }> = {
  name: "create_task",
  description: "创建定时任务。自动建立缺失分组。enabled 默认 false（需显式启用）。返回 id。",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      group: { type: "string", description: "分组名（不存在则自动创建）" },
      cron: { type: "string", description: "cron 表达式" },
      script: { type: "string", description: "magic-script 脚本" },
      path: { type: "string", description: "任务标识路径，默认 /${name}" },
      enabled: { type: "boolean", description: "是否启用，默认 false" },
      description: { type: "string" },
    },
    required: ["name", "group", "cron", "script"],
  },
  readonly: false,
  handler: async (client, args) => {
    const groupId = await ensureFolder(client, args.group, FOLDER);
    const body: TaskInfo = {
      id: null,
      name: args.name,
      path: args.path ?? `/${args.name}`,
      groupId,
      script: args.script,
      cron: args.cron,
      enabled: args.enabled ?? false,
      description: args.description,
    };
    const id = await saveFile(client, FOLDER, body);
    return { id };
  },
};

export interface UpdateTaskArgs {
  ref: string;
  cron?: string;
  script?: string;
  description?: string;
  enabled?: boolean;
}

export const updateTaskTool: ToolDef<UpdateTaskArgs, { id: string }> = {
  name: "update_task",
  description: "更新定时任务，未传字段保留原值。ref 可为 id/name/path。",
  inputSchema: {
    type: "object",
    properties: {
      ref: { type: "string" },
      cron: { type: "string" },
      script: { type: "string" },
      description: { type: "string" },
      enabled: { type: "boolean" },
    },
    required: ["ref"],
  },
  readonly: false,
  handler: async (client, args) => {
    const id = await resolveFileRef(client, args.ref, FOLDER);
    await applyPatch(client, id, {
      cron: args.cron, script: args.script, description: args.description, enabled: args.enabled,
    });
    return { id };
  },
};

export const enableTaskTool: ToolDef<{ ref: string }, { id: string; enabled: boolean }> = {
  name: "enable_task",
  description: "启用定时任务。ref 可为 id/name/path。",
  inputSchema: {
    type: "object",
    properties: { ref: { type: "string" } },
    required: ["ref"],
  },
  readonly: false,
  handler: async (client, args) => {
    const id = await setTaskEnabled(client, args.ref, true);
    return { id, enabled: true };
  },
};

export const disableTaskTool: ToolDef<{ ref: string }, { id: string; enabled: boolean }> = {
  name: "disable_task",
  description: "关闭定时任务。ref 可为 id/name/path。",
  inputSchema: {
    type: "object",
    properties: { ref: { type: "string" } },
    required: ["ref"],
  },
  readonly: false,
  handler: async (client, args) => {
    const id = await setTaskEnabled(client, args.ref, false);
    return { id, enabled: false };
  },
};

export const deleteTaskTool: ToolDef<{ ref: string }, { deleted: boolean }> = {
  name: "delete_task",
  description: "删除定时任务。ref 可为 id/name/path。",
  inputSchema: {
    type: "object",
    properties: { ref: { type: "string" } },
    required: ["ref"],
  },
  readonly: false,
  handler: async (client, args) => {
    const id = await resolveFileRef(client, args.ref, FOLDER);
    return { deleted: await deleteFile(client, id) };
  },
};

export const runTaskTool: ToolDef<{ ref: string }, unknown> = {
  name: "run_task",
  description: "手动执行一次定时任务。ref 可为 id/name/path。返回脚本执行结果。",
  inputSchema: {
    type: "object",
    properties: { ref: { type: "string" } },
    required: ["ref"],
  },
  readonly: false,
  handler: async (client, args) => {
    const id = await resolveFileRef(client, args.ref, FOLDER);
    return client.managementPost<unknown>("task/execute", undefined, { id });
  },
};
