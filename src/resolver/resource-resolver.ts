import type { MagicClient } from "../client/magic-client.js";
import type { ApiInfo, Group, ResourceTree, TreeNode } from "../client/types.js";

export function joinPath(...parts: string[]): string {
  const joined = parts
    .map((p) => p ?? "")
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
  return joined ? `/${joined}` : "";
}

/** 拉取整棵资源树（无缓存） */
export async function fetchTree(client: MagicClient): Promise<ResourceTree> {
  return client.managementGet<ResourceTree>("resource");
}

/** 收集某 folder 下的所有接口文件（有 method 的节点） */
export function collectFiles(tree: ResourceTree, folder: string): ApiInfo[] {
  const root = tree[folder];
  if (!root) return [];
  const out: ApiInfo[] = [];
  const walk = (node: TreeNode): void => {
    for (const child of node.children ?? []) {
      const n = child.node as ApiInfo & Partial<Group>;
      if (n.method && n.path) {
        out.push(n as ApiInfo);
      }
      walk(child);
    }
  };
  walk(root);
  return out;
}

interface ApiQuery {
  name?: string;
  path?: string;
  method?: string;
}

/** name 或 path+method → id */
export function resolveApiId(tree: ResourceTree, q: ApiQuery): string {
  const files = collectFiles(tree, "api");
  const index = buildGroupPathIndex(tree);
  let matches = files;
  if (q.name) {
    matches = files.filter((f) => f.name === q.name);
  } else if (q.path) {
    matches = files.filter(
      (f) =>
        resolveRunPath(f, "", index) === q.path &&
        (!q.method || f.method.toUpperCase() === q.method.toUpperCase())
    );
  }
  if (matches.length === 0) {
    throw new Error(`未找到接口：${q.name ?? `${q.method} ${q.path}`}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `匹配到多个接口，请用 path+method 精确指定：${matches
        .map((m) => `${m.method} ${resolveRunPath(m, "", index)} (${m.name})`)
        .join("; ")}`
    );
  }
  return matches[0].id!;
}

/** 分组名 + type → groupId */
export function resolveGroupId(tree: ResourceTree, name: string, type: string): string | undefined {
  const root = tree[type];
  if (!root) return undefined;
  let found: string | undefined;
  const walk = (node: TreeNode): void => {
    for (const child of node.children ?? []) {
      const g = child.node as Group;
      if (g.name === name && (g as any).method === undefined) {
        found = g.id;
      }
      walk(child);
    }
  };
  walk(root);
  return found;
}

/** groupId → 累积分组完整路径 */
export function buildGroupPathIndex(tree: ResourceTree): Map<string, string> {
  const index = new Map<string, string>();
  for (const folder of Object.keys(tree)) {
    const walk = (node: TreeNode, acc: string): void => {
      for (const child of node.children ?? []) {
        const g = child.node as Group;
        if ((g as any).method === undefined) {
          const here = joinPath(acc, g.path ?? "");
          index.set(g.id, here);
          walk(child, here);
        }
      }
    };
    walk(tree[folder], "");
  }
  return index;
}

/** prefix + groupPath + api.path → 完整运行路径 */
export function resolveRunPath(api: ApiInfo, prefix: string, index: Map<string, string>): string {
  const groupPath = index.get(api.groupId) ?? "";
  return joinPath(prefix, groupPath, api.path) || "/";
}

/** 列出分组（某 type 下，非文件节点） */
export function collectGroups(tree: ResourceTree, type: string): Group[] {
  const root = tree[type];
  if (!root) return [];
  const out: Group[] = [];
  const walk = (node: TreeNode): void => {
    for (const child of node.children ?? []) {
      const g = child.node as Group;
      if ((g as any).method === undefined) out.push(g);
      walk(child);
    }
  };
  walk(root);
  return out;
}
