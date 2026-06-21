import type { MagicClient } from "../client/magic-client.js";
import { fetchTree } from "../resolver/resource-resolver.js";
import type { ToolDef } from "./group.js";

export const listDatasourcesTool: ToolDef<void, any[]> = {
  name: "list_datasources",
  description: "列出所有数据源。",
  inputSchema: { type: "object", properties: {} },
  readonly: true,
  handler: async (client) => {
    const tree = await fetchTree(client);
    const root = (tree as any).datasource;
    const out: any[] = [];
    const walk = (node: any): void => {
      for (const c of node.children ?? []) {
        out.push({ id: c.node.id, name: c.node.name, type: c.node.type ?? "datasource" });
        walk(c);
      }
    };
    if (root) walk(root);
    return out;
  },
};
