import type { MagicClient } from "../client/magic-client.js";
import type { TaskInfo } from "../client/types.js";
import { fetchTree, resolveGroupId } from "../resolver/resource-resolver.js";
import type { ToolDef } from "./group.js";

const FOLDER = "task";

/** 收集 task 文件节点（有 script、无 method，与分组区分） */
function collectTaskFiles(tree: any): TaskInfo[] {
  const root = tree[FOLDER];
  const out: TaskInfo[] = [];
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

/** task 分组 groupId → 分组名 */
function collectTaskGroupNames(tree: any): Map<string, string> {
  const m = new Map<string, string>();
  const root = tree[FOLDER];
  const walk = (node: any): void => {
    for (const c of node.children ?? []) {
      if (c.node.method === undefined) m.set(c.node.id, c.node.name);
      walk(c);
    }
  };
  if (root) walk(root);
  return m;
}

/** ref(id/name/path) → id */
async function resolveTaskRef(client: MagicClient, ref: string): Promise<string> {
  const tree = await fetchTree(client);
  const files = collectTaskFiles(tree);
  const byNameOrId = files.find((f) => f.name === ref || f.id === ref);
  if (byNameOrId) return byNameOrId.id!;
  const byPath = files.find((f) => f.path === ref);
  if (byPath) return byPath.id!;
  throw new Error(`未找到定时任务：${ref}`);
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
    const groups = collectTaskGroupNames(tree);
    return collectTaskFiles(tree)
      .filter((f) => !args.group || groups.get(f.groupId) === args.group)
      .map((f) => ({
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
    const id = await resolveTaskRef(client, args.ref);
    return client.managementGet<TaskInfo>(`resource/file/${id}`);
  },
};
