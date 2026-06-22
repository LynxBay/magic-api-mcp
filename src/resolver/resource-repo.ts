import type { MagicClient } from "../client/magic-client.js";
import { fetchTree, resolveGroupId } from "./resource-resolver.js";

/** 取资源详情 */
export async function getFile<T>(client: MagicClient, id: string): Promise<T> {
  return client.managementGet<T>(`resource/file/${id}`);
}

/** 保存资源（update=true 走 auto=1，更新已有项） */
export async function saveFile<T>(
  client: MagicClient,
  type: string,
  body: T,
  update = false,
): Promise<string> {
  return client.managementPost<string>(
    `resource/file/${type}/save`,
    body,
    update ? { auto: "1" } : undefined,
  );
}

/** 删除资源 */
export async function deleteFile(client: MagicClient, id: string): Promise<boolean> {
  return !!(await client.managementPost<boolean>("resource/delete", undefined, { id }));
}

/** 解析分组 id，不存在则创建 */
export async function ensureFolder(client: MagicClient, name: string, type: string): Promise<string> {
  const tree = await fetchTree(client);
  const existing = resolveGroupId(tree, name, type);
  if (existing) return existing;
  return client.managementPost<string>("resource/folder/save", {
    name, path: name, type, parentId: "0",
  });
}
