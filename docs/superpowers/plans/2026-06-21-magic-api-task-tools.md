# magic-api 定时任务管理工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 magic-api-mcp 补充 8 个定时任务管理工具（list/get/create/update/enable/disable/delete/run），复用现有 `/resource/*` 资源模式。

**Architecture:** task 与 api/function 同为 magic-api「资源」，CRUD 走通用 `/resource/*`（`resource/file/{id}`、`resource/file/task/save`、`resource/delete`、`resource/folder/save`），唯一专属接口是手动执行 `POST task/execute?id=`。新增 `src/tools/task.ts` 镜像 `functions.ts` 模式（function 与 task 都无 `method`，用 `script !== undefined` 判定文件节点），helpers 自带于本文件（遵循 api.ts/functions.ts 各自维护本地 helper 的惯例）。enable/disable 复用 `applyPatch(id, {enabled})`，update_task 复用同一 patch 机制。

**Tech Stack:** TypeScript（ESM，Node16，`strict`，import 须带 `.js`）、@modelcontextprotocol/sdk、zod、vitest + msw（node 端 mock）。

**对 spec 的细化（实现补充，不改变设计）：**
- `create_task` 增加可选入参 `path`（magic-api 前端 `requirePath: true`，task 需 path 标识），未传时默认 `"/" + name`。
- 新增内部 helper `applyPatch(client, id, patch)`，供 `update_task` 与 `enable/disable` 共用（DRY）。

---

## 文件结构

| 文件 | 责任 | 动作 |
|---|---|---|
| `src/client/types.ts` | 新增 `TaskInfo` 类型 | 修改 |
| `src/tools/task.ts` | 8 个工具 + 本地 helper（`collectTaskFiles`/`collectTaskGroupNames`/`resolveTaskRef`/`applyPatch`/`setTaskEnabled`） | 新建 |
| `src/tools/registry.ts` | 把 8 个工具加入 `allTools` | 修改 |
| `tests/tools/task.test.ts` | msw 测试，覆盖全部 8 个工具 + 注册断言 | 新建 |

每个工具文件自带本地 helper 是本项目既定惯例（`api.ts` 有 `resolveRefToId`/`collectGroupNameMap`，`functions.ts` 有 `collectNamedFiles`/`resolveRef`），故 task.ts 不抽取共享模块，避免改动无关文件。

---

## Task 1: TaskInfo 类型 + task.ts 骨架 + list_tasks / get_task

**Files:**
- Modify: `src/client/types.ts`（末尾追加 `TaskInfo`）
- Create: `src/tools/task.ts`
- Create: `tests/tools/task.test.ts`

- [ ] **Step 1: 在 `src/client/types.ts` 末尾追加 TaskInfo 类型**

```ts
export interface TaskInfo {
  id: string | null;
  name: string;
  path: string;
  groupId: string;
  script: string;
  cron: string;
  enabled: boolean;
  description?: string;
}
```

- [ ] **Step 2: 写 list_tasks / get_task 的失败测试**

创建 `tests/tools/task.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../setup";
import { MagicClient } from "../../src/client/magic-client.js";
import type { Config } from "../../src/config.js";
import {
  listTasksTool, getTaskTool, createTaskTool, updateTaskTool,
  enableTaskTool, disableTaskTool, deleteTaskTool, runTaskTool,
} from "../../src/tools/task.js";

const cfg: Config = { baseUrl: "http://ma", webPath: "/magic/web", readonly: false, prefix: "" };
const client = () => new MagicClient(cfg);

const TREE = {
  code: 1, message: "ok",
  data: {
    task: {
      node: { id: "0", name: "root", path: "", type: "task", parentId: "" },
      children: [
        {
          node: { id: "tg1", name: "清理", path: "clean", type: "task", parentId: "0" },
          children: [
            {
              node: {
                id: "t1", name: "每日清理", path: "/daily", script: "return 1",
                cron: "0 0 * * * ?", enabled: true, groupId: "tg1", description: "每日",
              },
              children: [],
            },
          ],
        },
      ],
    },
  },
};

describe("list_tasks", () => {
  it("lists tasks with cron/enabled/group", async () => {
    server.use(http.get("http://ma/magic/web/resource", () => HttpResponse.json(TREE)));
    const res = await listTasksTool.handler(client(), {});
    expect(res).toEqual([
      { id: "t1", name: "每日清理", path: "/daily", cron: "0 0 * * * ?", enabled: true, group: "清理" },
    ]);
  });

  it("filters by group name", async () => {
    server.use(http.get("http://ma/magic/web/resource", () => HttpResponse.json(TREE)));
    const res = await listTasksTool.handler(client(), { group: "不存在" });
    expect(res).toEqual([]);
  });
});

describe("get_task", () => {
  it("returns detail by id", async () => {
    server.use(
      http.get("http://ma/magic/web/resource", () => HttpResponse.json(TREE)),
      http.get("http://ma/magic/web/resource/file/t1", () =>
        HttpResponse.json({ code: 1, message: "ok", data: { id: "t1", name: "每日清理", script: "return 1", cron: "0 0 * * * ?", enabled: true } }))
    );
    const res = await getTaskTool.handler(client(), { ref: "t1" });
    expect(res).toMatchObject({ id: "t1", cron: "0 0 * * * ?", enabled: true });
  });

  it("resolves ref by name", async () => {
    server.use(
      http.get("http://ma/magic/web/resource", () => HttpResponse.json(TREE)),
      http.get("http://ma/magic/web/resource/file/t1", () =>
        HttpResponse.json({ code: 1, message: "ok", data: { id: "t1", name: "每日清理" } }))
    );
    const res = await getTaskTool.handler(client(), { ref: "每日清理" });
    expect(res).toMatchObject({ id: "t1" });
  });
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `cd magic-api-mcp && npx vitest run tests/tools/task.test.ts`
Expected: FAIL —— `Failed to resolve import "../../src/tools/task.js"`（文件尚未创建）。

- [ ] **Step 4: 创建 `src/tools/task.ts`（含 helper + list_tasks + get_task）**

```ts
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
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `cd magic-api-mcp && npx vitest run tests/tools/task.test.ts`
Expected: PASS（list_tasks ×2、get_task ×2 全绿）。

- [ ] **Step 6: 提交**

```bash
cd magic-api-mcp
git add src/client/types.ts src/tools/task.ts tests/tools/task.test.ts
git commit -m "feat(tools): list_tasks and get_task with TaskInfo type" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: create_task

**Files:**
- Modify: `src/tools/task.ts`（追加 `CreateTaskArgs` + `createTaskTool`）
- Modify: `tests/tools/task.test.ts`（追加 describe）

- [ ] **Step 1: 追加失败测试**

在 `tests/tools/task.test.ts` 末尾追加：

```ts
describe("create_task", () => {
  it("saves with enabled defaulting to false and path derived from name", async () => {
    let saved: any;
    server.use(
      http.get("http://ma/magic/web/resource", () => HttpResponse.json(TREE)),
      http.post("http://ma/magic/web/resource/file/task/save", async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json({ code: 1, message: "ok", data: "t2" });
      })
    );
    const res = await createTaskTool.handler(client(), {
      name: "每小时同步", group: "清理", cron: "0 0 * * * ?", script: "return 2",
    });
    expect(res).toEqual({ id: "t2" });
    expect(saved).toMatchObject({
      name: "每小时同步", groupId: "tg1", cron: "0 0 * * * ?",
      script: "return 2", enabled: false, path: "/每小时同步",
    });
  });

  it("creates folder when group does not exist", async () => {
    let folderSaved: any;
    server.use(
      http.get("http://ma/magic/web/resource", () => HttpResponse.json(TREE)),
      http.post("http://ma/magic/web/resource/folder/save", async ({ request }) => {
        folderSaved = await request.json();
        return HttpResponse.json({ code: 1, message: "ok", data: "tg-new" });
      }),
      http.post("http://ma/magic/web/resource/file/task/save", () =>
        HttpResponse.json({ code: 1, message: "ok", data: "t3" }))
    );
    const res = await createTaskTool.handler(client(), {
      name: "x", group: "新分组", cron: "0 0 * * * ?", script: "return 3", enabled: true, path: "/x",
    });
    expect(res).toEqual({ id: "t3" });
    expect(folderSaved).toMatchObject({ name: "新分组", path: "新分组", type: "task", parentId: "0" });
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd magic-api-mcp && npx vitest run tests/tools/task.test.ts -t create_task`
Expected: FAIL —— `createTaskTool` 未导出。

- [ ] **Step 3: 在 `src/tools/task.ts` 追加 createTaskTool**

在文件末尾追加：

```ts
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
    const tree = await fetchTree(client);
    let groupId = resolveGroupId(tree, args.group, FOLDER);
    if (!groupId) {
      groupId = await client.managementPost<string>("resource/folder/save", {
        name: args.group, path: args.group, type: FOLDER, parentId: "0",
      });
    }
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
    const id = await client.managementPost<string>("resource/file/task/save", body);
    return { id };
  },
};
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd magic-api-mcp && npx vitest run tests/tools/task.test.ts -t create_task`
Expected: PASS（2 个 case）。

- [ ] **Step 5: 提交**

```bash
cd magic-api-mcp
git add src/tools/task.ts tests/tools/task.test.ts
git commit -m "feat(tools): create_task with auto folder and enabled default" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: update_task（含 applyPatch helper）

**Files:**
- Modify: `src/tools/task.ts`（追加 `applyPatch` + `UpdateTaskArgs` + `updateTaskTool`）
- Modify: `tests/tools/task.test.ts`

- [ ] **Step 1: 追加失败测试**

```ts
describe("update_task", () => {
  it("merges patch onto old value and saves with auto flag", async () => {
    let saved: any;
    server.use(
      http.get("http://ma/magic/web/resource", () => HttpResponse.json(TREE)),
      http.get("http://ma/magic/web/resource/file/t1", () =>
        HttpResponse.json({ code: 1, message: "ok", data: { id: "t1", name: "每日清理", path: "/daily", groupId: "tg1", script: "return 1", cron: "0 0 * * * ?", enabled: true, description: "每日" } })),
      http.post("http://ma/magic/web/resource/file/task/save", async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json({ code: 1, message: "ok", data: "t1" });
      })
    );
    const res = await updateTaskTool.handler(client(), { ref: "t1", cron: "0 30 * * * ?", script: "return 9" });
    expect(res).toEqual({ id: "t1" });
    expect(saved).toMatchObject({ id: "t1", cron: "0 30 * * * ?", script: "return 9", enabled: true, name: "每日清理" });
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd magic-api-mcp && npx vitest run tests/tools/task.test.ts -t update_task`
Expected: FAIL —— `updateTaskTool` 未导出。

- [ ] **Step 3: 在 `src/tools/task.ts` 追加 applyPatch 与 updateTaskTool**

在 `createTaskTool` 之后追加：

```ts
/** 取旧值 → 仅覆盖 patch 中非 undefined 字段 → 保存（auto=1 表示更新） */
async function applyPatch(client: MagicClient, id: string, patch: Partial<TaskInfo>): Promise<void> {
  const old = await client.managementGet<TaskInfo>(`resource/file/${id}`);
  const next: TaskInfo = { ...old };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (next as any)[k] = v;
  }
  await client.managementPost<string>("resource/file/task/save", next, { auto: "1" });
}

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
    const id = await resolveTaskRef(client, args.ref);
    await applyPatch(client, id, {
      cron: args.cron, script: args.script, description: args.description, enabled: args.enabled,
    });
    return { id };
  },
};
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd magic-api-mcp && npx vitest run tests/tools/task.test.ts -t update_task`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
cd magic-api-mcp
git add src/tools/task.ts tests/tools/task.test.ts
git commit -m "feat(tools): update_task with applyPatch merge helper" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: enable_task / disable_task（复用 applyPatch）

**Files:**
- Modify: `src/tools/task.ts`（追加 `setTaskEnabled` + 两个工具）
- Modify: `tests/tools/task.test.ts`

- [ ] **Step 1: 追加失败测试**

```ts
describe("enable_task", () => {
  it("saves enabled=true and returns id+flag", async () => {
    let saved: any;
    server.use(
      http.get("http://ma/magic/web/resource", () => HttpResponse.json(TREE)),
      http.get("http://ma/magic/web/resource/file/t1", () =>
        HttpResponse.json({ code: 1, message: "ok", data: { id: "t1", name: "每日清理", path: "/daily", groupId: "tg1", script: "return 1", cron: "0 0 * * * ?", enabled: false } })),
      http.post("http://ma/magic/web/resource/file/task/save", async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json({ code: 1, message: "ok", data: "t1" });
      })
    );
    const res = await enableTaskTool.handler(client(), { ref: "t1" });
    expect(res).toEqual({ id: "t1", enabled: true });
    expect(saved.enabled).toBe(true);
  });
});

describe("disable_task", () => {
  it("saves enabled=false and returns id+flag", async () => {
    let saved: any;
    server.use(
      http.get("http://ma/magic/web/resource", () => HttpResponse.json(TREE)),
      http.get("http://ma/magic/web/resource/file/t1", () =>
        HttpResponse.json({ code: 1, message: "ok", data: { id: "t1", name: "每日清理", path: "/daily", groupId: "tg1", script: "return 1", cron: "0 0 * * * ?", enabled: true } })),
      http.post("http://ma/magic/web/resource/file/task/save", async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json({ code: 1, message: "ok", data: "t1" });
      })
    );
    const res = await disableTaskTool.handler(client(), { ref: "每日清理" });
    expect(res).toEqual({ id: "t1", enabled: false });
    expect(saved.enabled).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd magic-api-mcp && npx vitest run tests/tools/task.test.ts -t enable_task -t disable_task`
Expected: FAIL —— 两个工具未导出。

- [ ] **Step 3: 在 `src/tools/task.ts` 追加 setTaskEnabled + 两个工具**

在 `updateTaskTool` 之后追加：

```ts
/** ref → 改 enabled → 保存，返回 id（enable/disable 共用） */
async function setTaskEnabled(client: MagicClient, ref: string, enabled: boolean): Promise<string> {
  const id = await resolveTaskRef(client, ref);
  await applyPatch(client, id, { enabled });
  return id;
}

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
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd magic-api-mcp && npx vitest run tests/tools/task.test.ts -t enable_task -t disable_task`
Expected: PASS（2 个 case）。

- [ ] **Step 5: 提交**

```bash
cd magic-api-mcp
git add src/tools/task.ts tests/tools/task.test.ts
git commit -m "feat(tools): enable_task and disable_task via setTaskEnabled" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: delete_task

**Files:**
- Modify: `src/tools/task.ts`
- Modify: `tests/tools/task.test.ts`

- [ ] **Step 1: 追加失败测试**

```ts
describe("delete_task", () => {
  it("posts delete with resolved id in query", async () => {
    let got: any;
    server.use(
      http.get("http://ma/magic/web/resource", () => HttpResponse.json(TREE)),
      http.post("http://ma/magic/web/resource/delete", ({ request }) => {
        got = new URL(request.url).searchParams.get("id");
        return HttpResponse.json({ code: 1, message: "ok", data: true });
      })
    );
    const res = await deleteTaskTool.handler(client(), { ref: "每日清理" });
    expect(res).toEqual({ deleted: true });
    expect(got).toBe("t1");
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd magic-api-mcp && npx vitest run tests/tools/task.test.ts -t delete_task`
Expected: FAIL —— `deleteTaskTool` 未导出。

- [ ] **Step 3: 在 `src/tools/task.ts` 末尾追加 deleteTaskTool**

```ts
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
    const id = await resolveTaskRef(client, args.ref);
    const ok = await client.managementPost<boolean>("resource/delete", undefined, { id });
    return { deleted: !!ok };
  },
};
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd magic-api-mcp && npx vitest run tests/tools/task.test.ts -t delete_task`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
cd magic-api-mcp
git add src/tools/task.ts tests/tools/task.test.ts
git commit -m "feat(tools): delete_task" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: run_task

**Files:**
- Modify: `src/tools/task.ts`
- Modify: `tests/tools/task.test.ts`

- [ ] **Step 1: 追加失败测试**

```ts
describe("run_task", () => {
  it("posts task/execute with id in query and passes through result", async () => {
    let got: any;
    server.use(
      http.get("http://ma/magic/web/resource", () => HttpResponse.json(TREE)),
      http.post("http://ma/magic/web/task/execute", ({ request }) => {
        got = new URL(request.url).searchParams.get("id");
        return HttpResponse.json({ code: 1, message: "ok", data: { ok: 1 } });
      })
    );
    const res = await runTaskTool.handler(client(), { ref: "t1" });
    expect(got).toBe("t1");
    expect(res).toEqual({ ok: 1 });
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd magic-api-mcp && npx vitest run tests/tools/task.test.ts -t run_task`
Expected: FAIL —— `runTaskTool` 未导出。

- [ ] **Step 3: 在 `src/tools/task.ts` 末尾追加 runTaskTool**

```ts
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
    const id = await resolveTaskRef(client, args.ref);
    return client.managementPost<unknown>("task/execute", undefined, { id });
  },
};
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd magic-api-mcp && npx vitest run tests/tools/task.test.ts -t run_task`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
cd magic-api-mcp
git add src/tools/task.ts tests/tools/task.test.ts
git commit -m "feat(tools): run_task via POST task/execute" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 注册到 registry + readonly 行为验证

**Files:**
- Modify: `src/tools/registry.ts`
- Modify: `tests/tools/task.test.ts`（追加注册断言）

- [ ] **Step 1: 追加失败测试（注册 + readonly 标记）**

在 `tests/tools/task.test.ts` 顶部 import 区追加：

```ts
import { allTools, isWriteTool } from "../../src/tools/registry.js";
```

在文件末尾追加：

```ts
describe("registry", () => {
  it("registers all 8 task tools", () => {
    const names = allTools.map((t) => t.name);
    for (const n of [
      "list_tasks", "get_task", "create_task", "update_task",
      "enable_task", "disable_task", "delete_task", "run_task",
    ]) {
      expect(names).toContain(n);
    }
  });

  it("marks task write tools as non-readonly, read tools as readonly", () => {
    expect(isWriteTool("run_task")).toBe(true);
    expect(isWriteTool("enable_task")).toBe(true);
    expect(isWriteTool("disable_task")).toBe(true);
    expect(isWriteTool("create_task")).toBe(true);
    expect(isWriteTool("update_task")).toBe(true);
    expect(isWriteTool("delete_task")).toBe(true);
    expect(isWriteTool("list_tasks")).toBe(false);
    expect(isWriteTool("get_task")).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd magic-api-mcp && npx vitest run tests/tools/task.test.ts -t registry`
Expected: FAIL —— 8 个工具名未出现在 `allTools`。

- [ ] **Step 3: 修改 `src/tools/registry.ts`**

在 import 区（第 6 行 `import { createApiTool, ... } from "./api.js";` 之后）追加一行：

```ts
import {
  createTaskTool, deleteTaskTool, disableTaskTool, enableTaskTool,
  getTaskTool, listTasksTool, runTaskTool, updateTaskTool,
} from "./task.js";
```

在 `allTools` 数组中（`runApiTool,` 之后）追加 8 个工具：

```ts
  listTasksTool, getTaskTool, createTaskTool, updateTaskTool,
  enableTaskTool, disableTaskTool, deleteTaskTool, runTaskTool,
```

修改后 `allTools` 完整形态：

```ts
export const allTools: ToolDef<any, any>[] = [
  listGroupsTool, createGroupTool,
  listApisTool, getApiTool, createApiTool, updateApiScriptTool, deleteApiTool, runApiTool,
  listTasksTool, getTaskTool, createTaskTool, updateTaskTool,
  enableTaskTool, disableTaskTool, deleteTaskTool, runTaskTool,
  listFunctionsTool, getFunctionTool, listDatasourcesTool,
  magicScriptHelpTool, searchCodeTool,
];
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd magic-api-mcp && npx vitest run tests/tools/task.test.ts -t registry`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
cd magic-api-mcp
git add src/tools/registry.ts tests/tools/task.test.ts
git commit -m "feat(registry): register 8 task tools" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 构建与全量回归

**Files:** 无（验证步骤）

- [ ] **Step 1: 跑全量测试，确认无回归**

Run: `cd magic-api-mcp && npm test`
Expected: PASS —— 全部测试通过，含原有 ~35 个 + 新增 task 测试（list×2、get×2、create×2、update×1、enable×1、disable×1、delete×1、run×1、registry×2 = 13 个）。

- [ ] **Step 2: 类型构建，确认无类型错误**

Run: `cd magic-api-mcp && npm run build`
Expected: 成功（`tsc` 无错，`dist/` 生成）。

- [ ] **Step 3: 若步骤 1/2 有失败，修复后追加提交**

仅当出现失败时执行：

```bash
cd magic-api-mcp
git add -A
git commit -m "fix(tools): address task tools test/build issues" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: 真实 magic-api 冒烟（人工，需可访问的 magic-api 实例）**

启动 magic-api-mcp 连到真实实例，依次调用验证全链路：
`create_task`（enabled 默认 false）→ `list_tasks`（看到新任务）→ `enable_task` → `get_task`（确认 `enabled:true`）→ `run_task`（返回脚本结果）→ `disable_task` → `get_task`（确认 `enabled:false`）→ `delete_task`。

若 `run_task` 报 404/路径错误，将 `task/execute` 的 `id` 改为 form body（`managementPost("task/execute", { id })`）后重试——这是 spec「风险与待验证」标注的备选。

---

## Self-Review（已执行）

- **Spec 覆盖**：8 个工具逐一对应 Task 1–6；TaskInfo 类型 Task 1；registry 注册 + readonly Task 7；构建/冒烟 Task 8。spec 的「风险：task/execute 前缀与 id 传参」在 Task 8 Step 4 给出验证与备选。
- **占位符扫描**：无 TBD/TODO；每个实现 step 含完整可粘贴代码；命令含 `cd magic-api-mcp` 与 expected 输出。
- **类型一致性**：`TaskInfo` 字段（id/name/path/groupId/script/cron/enabled/description）在 types.ts、create body、update patch、测试断言中一致；`applyPatch`/`setTaskEnabled`/`resolveTaskRef` 在 Task 1/3/4 引入后，后续 Task 引用名称一致；工具导出名与 registry import、测试 import 三处一致（如 `listTasksTool` / `runTaskTool`）。
