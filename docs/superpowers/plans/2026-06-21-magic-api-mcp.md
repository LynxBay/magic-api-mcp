# magic-api MCP 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 TypeScript MCP server，让 AI 通过 HTTP 操作运行中的 magic-api 实例（接口增删改查 + 运行、分组/函数/数据源管理）并内置 magic-script 知识。

**Architecture:** 独立 TS 进程，stdio 与 MCP 客户端通信，HTTP 连接 magic-api（默认 `/magic/web`）。无本地缓存，所有 name/path→id 解析实时拉 `GET /resource`。读写在注册层按 `READONLY` 开关拦截。

**Tech Stack:** TypeScript（Node 18+，原生 fetch）、`@modelcontextprotocol/sdk`、Vitest + msw（测试）。

**关联 spec：** `docs/superpowers/specs/2026-06-21-magic-api-mcp-design.md`
**项目根：** `/Users/lynx/projects/lynx/magic-api/magic-api-mcp/`（下文路径均相对此根）

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `package.json` / `tsconfig.json` / `vitest.config.ts` | 工具链与脚本 |
| `src/config.ts` | 读取/校验配置（env + 默认值），导出 `Config` 与 `loadConfig()` |
| `src/client/types.ts` | magic-api 端类型：`JsonBean`/`ApiInfo`/`Group`/`TreeNode`/`ResourceTree`/`RunResult` |
| `src/client/magic-client.ts` | 唯一 HTTP 出口：路径拼接、`Magic-Token` 注入、`JsonBean` 解包、401 重试 login |
| `src/resolver/resource-resolver.ts` | 无状态实时解析：拉资源树、name/path→id、runPath 拼接 |
| `src/tools/group.ts` / `api.ts` / `functions.ts` / `datasource.ts` / `knowledge.ts` | 各类 MCP 工具实现 |
| `src/tools/registry.ts` | 把工具注册到 `McpServer`，READONLY 拦截写工具 |
| `src/knowledge/magic-script.md` | 内嵌 magic-script 文档 |
| `src/index.ts` | 入口：loadConfig → init client → start MCP server (stdio) |
| `tests/` | 单元 + 集成测试（vitest + msw） |
| `README.md` | 配置说明 + Claude MCP 接入示例 + 冒烟步骤 |

**统一命名约定（跨任务必须一致）：**
- `MagicClient` 方法：`login()`、`managementGet<T>(path, params?)`、`managementPost<T>(path, body?, params?)`、`runApi(runPath, opts)`、`getWebBase()`、`getBase()`
- `resource-resolver.ts` 导出：`fetchTree(client)`、`collectFiles(tree, folder)`、`resolveApiId(tree, q)`、`resolveGroupId(tree, name, type)`、`buildGroupPathIndex(tree)`、`resolveRunPath(api, prefix, index)`、`joinPath(...parts)`
- `Config` 字段：`baseUrl`、`webPath`、`token?`、`username?`、`password?`、`readonly`、`prefix`

---

## Task 1: 项目脚手架与工具链

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `.gitignore`

- [ ] **Step 1: 写 `package.json`**

```json
{
  "name": "magic-api-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "magic-api-mcp": "dist/index.js" },
  "scripts": {
    "build": "tsc && cp -r src/knowledge dist",
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "msw": "^2.3.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: 写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: 写 `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
  },
});
```

- [ ] **Step 4: 写 `tests/setup.ts`（msw 生命周期占位，handlers 在各测试 import）**

```ts
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

export const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

- [ ] **Step 5: 写 `.gitignore`**

```
node_modules/
dist/
*.log
.DS_Store
```

- [ ] **Step 6: 安装依赖并初始化 git**

Run:
```bash
npm install
git init
git add -A
git commit -m "chore: scaffold magic-api-mcp project"
```
Expected: 依赖安装成功；首个 commit 创建。

- [ ] **Step 7: 验证测试空跑可用**

Run: `npm test`
Expected: vitest 启动，无测试用例（或 "No test files found"），无配置错误。

---

## Task 2: 配置加载 `src/config.ts`

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: 写失败测试 `tests/config.test.ts`**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

afterEach(() => {
  delete process.env.MAGIC_API_BASE;
  delete process.env.MAGIC_API_WEB;
  delete process.env.MAGIC_API_TOKEN;
  delete process.env.MAGIC_API_USERNAME;
  delete process.env.MAGIC_API_PASSWORD;
  delete process.env.MAGIC_API_READONLY;
  delete process.env.MAGIC_API_PREFIX;
});

describe("loadConfig", () => {
  it("uses defaults and requires base", () => {
    delete process.env.MAGIC_API_BASE;
    expect(() => loadConfig()).toThrow(/MAGIC_API_BASE/);
  });

  it("applies defaults", () => {
    process.env.MAGIC_API_BASE = "http://localhost:9999";
    const c = loadConfig();
    expect(c.baseUrl).toBe("http://localhost:9999");
    expect(c.webPath).toBe("/magic/web");
    expect(c.readonly).toBe(false);
    expect(c.prefix).toBe("");
    expect(c.token).toBeUndefined();
  });

  it("parses readonly flag and token", () => {
    process.env.MAGIC_API_BASE = "http://x";
    process.env.MAGIC_API_READONLY = "true";
    process.env.MAGIC_API_TOKEN = "abc";
    const c = loadConfig();
    expect(c.readonly).toBe(true);
    expect(c.token).toBe("abc");
  });

  it("normalizes trailing slash on baseUrl", () => {
    process.env.MAGIC_API_BASE = "http://x:9999/";
    const c = loadConfig();
    expect(c.baseUrl).toBe("http://x:9999");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/config.test.ts`
Expected: FAIL（`../src/config.js` 不存在，import 失败）。

- [ ] **Step 3: 实现 `src/config.ts`**

```ts
export interface Config {
  baseUrl: string;
  webPath: string;
  token?: string;
  username?: string;
  password?: string;
  readonly: boolean;
  prefix: string;
}

function env(key: string): string | undefined {
  return process.env[key];
}

function parseBool(v: string | undefined): boolean {
  return v === "true" || v === "1";
}

export function loadConfig(): Config {
  const baseUrl = env("MAGIC_API_BASE");
  if (!baseUrl) {
    throw new Error("MAGIC_API_BASE is required (e.g. http://localhost:9999)");
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    webPath: env("MAGIC_API_WEB") ?? "/magic/web",
    token: env("MAGIC_API_TOKEN"),
    username: env("MAGIC_API_USERNAME"),
    password: env("MAGIC_API_PASSWORD"),
    readonly: parseBool(env("MAGIC_API_READONLY")),
    prefix: (env("MAGIC_API_PREFIX") ?? "").replace(/^\/+|\/+$/g, ""),
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/config.test.ts`
Expected: PASS（4 个用例全过）。

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat(config): env-driven config with defaults and validation"
```

---

## Task 3: 类型定义 `src/client/types.ts`

**Files:**
- Create: `src/client/types.ts`

- [ ] **Step 1: 写类型文件**

```ts
export interface JsonBean<T> {
  code: number;
  message: string;
  data: T;
}

export interface Group {
  id: string;
  name: string;
  path: string;
  type: string;
  parentId: string;
  node?: string;
}

export interface ApiInfo {
  id: string | null;
  name: string;
  path: string;
  method: string;
  script: string;
  groupId: string;
  description?: string;
  parameters?: unknown[];
  options?: { name: string; value: unknown }[];
  headers?: unknown[];
  requestBody?: string;
  responseBody?: string;
}

export interface TreeNode<T = any> {
  node: T;
  children: TreeNode[];
}

export type ResourceTree = Record<string, TreeNode<Group>>;

export interface SearchResult {
  id: string;
  text: string;
  line: number;
}

export interface RunResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/client/types.ts
git commit -m "feat(client): add magic-api type definitions"
```

---

## Task 4: HTTP 客户端 `src/client/magic-client.ts`

**Files:**
- Create: `src/client/magic-client.ts`
- Test: `tests/magic-client.test.ts`

- [ ] **Step 1: 写失败测试 `tests/magic-client.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import { MagicClient } from "../src/client/magic-client.js";
import type { Config } from "../src/config.js";

const cfg = (over: Partial<Config> = {}): Config => ({
  baseUrl: "http://ma",
  webPath: "/magic/web",
  readonly: false,
  prefix: "",
  ...over,
});

describe("MagicClient.managementGet", () => {
  it("unwraps JsonBean.data on code===1", async () => {
    server.use(
      http.get("http://ma/magic/web/resource", () =>
        HttpResponse.json({ code: 1, message: "success", data: { ok: true } })
      )
    );
    const c = new MagicClient(cfg());
    expect(await c.managementGet("resource")).toEqual({ ok: true });
  });

  it("throws business error when code!==1", async () => {
    server.use(
      http.get("http://ma/magic/web/resource", () =>
        HttpResponse.json({ code: 0, message: "权限不足", data: null })
      )
    );
    const c = new MagicClient(cfg());
    await expect(c.managementGet("resource")).rejects.toThrow("权限不足");
  });

  it("injects Magic-Token header", async () => {
    let seen: string | null = null;
    server.use(
      http.get("http://ma/magic/web/resource", ({ request }) => {
        seen = request.headers.get("Magic-Token");
        return HttpResponse.json({ code: 1, message: "ok", data: 1 });
      })
    );
    const c = new MagicClient(cfg({ token: "tok" }));
    await c.managementGet("resource");
    expect(seen).toBe("tok");
  });
});

describe("MagicClient login flow", () => {
  it("logs in on init and stores token from header", async () => {
    let usedToken: string | null = null;
    server.use(
      http.post("http://ma/magic/web/login", () =>
        new HttpResponse(null, { headers: { "Magic-Token": "T1" } })
      ),
      http.get("http://ma/magic/web/resource", ({ request }) => {
        usedToken = request.headers.get("Magic-Token");
        return HttpResponse.json({ code: 1, message: "ok", data: {} });
      })
    );
    const c = new MagicClient(cfg({ username: "u", password: "p" }));
    await c.init();
    await c.managementGet("resource");
    expect(usedToken).toBe("T1");
  });

  it("retries login once on 401 then succeeds", async () => {
    let loginCount = 0;
    let resCount = 0;
    server.use(
      http.post("http://ma/magic/web/login", () => {
        loginCount++;
        return new HttpResponse(null, { headers: { "Magic-Token": "T2" } });
      }),
      http.get("http://ma/magic/web/resource", () => {
        resCount++;
        // 第一次 401，之后正常
        if (resCount === 1) return new HttpResponse(null, { status: 401 });
        return HttpResponse.json({ code: 1, message: "ok", data: {} });
      })
    );
    const c = new MagicClient(cfg({ username: "u", password: "p" }));
    await c.init();
    const data = await c.managementGet("resource");
    expect(data).toEqual({});
    expect(loginCount).toBe(2); // init + 重试
  });
});

describe("MagicClient.runApi", () => {
  it("calls the live endpoint and returns status/headers/body", async () => {
    server.use(
      http.get("http://ma/api/hello", () =>
        new HttpResponse("hi", { status: 200, headers: { "x-test": "1" } })
      )
    );
    const c = new MagicClient(cfg());
    const r = await c.runApi("/api/hello", { method: "GET" });
    expect(r.status).toBe(200);
    expect(r.body).toBe("hi");
    expect(r.headers["x-test"]).toBe("1");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/magic-client.test.ts`
Expected: FAIL（`magic-client.js` 不存在）。

- [ ] **Step 3: 实现 `src/client/magic-client.ts`**

```ts
import type { Config } from "../config.js";
import type { JsonBean, RunResult } from "./types.js";

export interface RunOptions {
  method: string;
  params?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
}

export class MagicClient {
  private token?: string;

  constructor(private readonly config: Config) {
    this.token = config.token;
  }

  getWebBase(): string {
    return `${this.config.baseUrl}${this.config.webPath}`;
  }

  getBase(): string {
    return this.config.baseUrl;
  }

  isReadonly(): boolean {
    return this.config.readonly;
  }

  /** 若配置了账号密码则登录换 token */
  async init(): Promise<void> {
    if (this.config.username && this.config.password) {
      await this.login();
    }
  }

  async login(): Promise<void> {
    const res = await fetch(`${this.getWebBase()}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: this.config.username!,
        password: this.config.password!,
      }),
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("magic-api login failed (auth rejected)");
    }
    const tok = res.headers.get("Magic-Token");
    if (tok) this.token = tok;
  }

  private authHeaders(): Record<string, string> {
    return this.token ? { "Magic-Token": this.token } : {};
  }

  /** 管理端 GET，返回 JsonBean.data */
  async managementGet<T = unknown>(path: string, params?: Record<string, unknown>): Promise<T> {
    const url = this.buildManagementUrl(path, params);
    return this.managementRequest<T>(url, { method: "GET" });
  }

  /** 管理端 POST，body 序列化为 JSON 原始流，返回 JsonBean.data */
  async managementPost<T = unknown>(
    path: string,
    body?: unknown,
    params?: Record<string, unknown>
  ): Promise<T> {
    const url = this.buildManagementUrl(path, params);
    const headers: Record<string, string> = {
      ...this.authHeaders(),
      "Content-Type": "application/json",
    };
    const init: RequestInit = {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    };
    return this.managementRequest<T>(url, init);
  }

  private async managementRequest<T>(url: string, init: RequestInit): Promise<T> {
    const merged: RequestInit = {
      ...init,
      headers: { ...this.authHeaders(), ...(init.headers as Record<string, string>) },
    };
    let res = await fetch(url, merged);
    if (res.status === 401 && this.canRefresh()) {
      await this.login();
      const retry: RequestInit = {
        ...merged,
        headers: { ...(merged.headers as Record<string, string>), ...this.authHeaders() },
      };
      res = await fetch(url, retry);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("magic-api auth failed (invalid or expired token)");
    }
    const bean = (await res.json()) as JsonBean<T>;
    if (bean.code !== 1) {
      throw new Error(bean.message || `magic-api error code=${bean.code}`);
    }
    return bean.data;
  }

  private canRefresh(): boolean {
    return !!(this.config.username && this.config.password);
  }

  private buildManagementUrl(path: string, params?: Record<string, unknown>): string {
    const base = `${this.getWebBase()}/${path.replace(/^\/+/, "")}`;
    if (!params) return base;
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) sp.set(k, String(v));
    }
    const qs = sp.toString();
    return qs ? `${base}?${qs}` : base;
  }

  /** 向真实接口发请求（被测接口的错误不算工具错误） */
  async runApi(runPath: string, opts: RunOptions): Promise<RunResult> {
    const path = runPath.startsWith("/") ? runPath : `/${runPath}`;
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.params ?? {})) {
      if (v !== undefined && v !== null) sp.set(k, String(v));
    }
    const qs = sp.toString();
    const url = `${this.getBase()}${path}${qs ? `?${qs}` : ""}`;
    const headers: Record<string, string> = { ...this.authHeaders(), ...(opts.headers ?? {}) };
    const init: RequestInit = {
      method: opts.method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    };
    const res = await fetch(url, init);
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => (outHeaders[k] = v));
    const text = await res.text();
    return { status: res.status, headers: outHeaders, body: text };
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/magic-client.test.ts`
Expected: PASS（6 个用例全过）。

- [ ] **Step 5: Commit**

```bash
git add src/client/magic-client.ts tests/magic-client.test.ts
git commit -m "feat(client): HTTP client with JsonBean unwrap, token injection, login retry"
```

---

## Task 5: 资源解析器 `src/resolver/resource-resolver.ts`

**Files:**
- Create: `src/resolver/resource-resolver.ts`
- Test: `tests/resource-resolver.test.ts`

- [ ] **Step 1: 写失败测试 `tests/resource-resolver.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { ApiInfo, ResourceTree } from "../src/client/types.js";
import {
  buildGroupPathIndex,
  collectFiles,
  resolveApiId,
  resolveGroupId,
  resolveRunPath,
  joinPath,
} from "../src/resolver/resource-resolver.js";

// 构造一棵 api 树：分组「用户」(id=g1, path=user) 下有接口 list (path=/list, method=GET)
function apiTree(): ResourceTree {
  const api: ApiInfo = {
    id: "a1", name: "用户列表", path: "/list", method: "GET",
    script: "return 1", groupId: "g1",
  };
  return {
    api: {
      node: { id: "0", name: "root", path: "", type: "api", parentId: "" },
      children: [
        {
          node: { id: "g1", name: "用户", path: "user", type: "api", parentId: "0" },
          children: [{ node: api, children: [] }],
        },
      ],
    },
  };
}

describe("collectFiles", () => {
  it("flattens api files from the tree", () => {
    const files = collectFiles(apiTree(), "api");
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("用户列表");
  });
});

describe("resolveApiId", () => {
  it("resolves by name", () => {
    expect(resolveApiId(apiTree(), { name: "用户列表" })).toBe("a1");
  });
  it("resolves by path+method", () => {
    expect(resolveApiId(apiTree(), { path: "/user/list", method: "GET" })).toBe("a1");
  });
  it("throws when ambiguous by name", () => {
    const t = apiTree();
    (t.api.children[0].children[0].node as ApiInfo).name = "用户列表";
    t.api.children[0].children.push({
      node: { ...(t.api.children[0].children[0].node as ApiInfo), id: "a2" },
      children: [],
    });
    expect(() => resolveApiId(t, { name: "用户列表" })).toThrow(/多个|ambiguous/i);
  });
});

describe("resolveGroupId", () => {
  it("finds group by name", () => {
    expect(resolveGroupId(apiTree(), "用户", "api")).toBe("g1");
  });
  it("returns undefined when missing", () => {
    expect(resolveGroupId(apiTree(), "不存在", "api")).toBeUndefined();
  });
});

describe("runPath", () => {
  it("builds full run path from prefix + group + api path", () => {
    const tree = apiTree();
    const index = buildGroupPathIndex(tree);
    const api = collectFiles(tree, "api")[0];
    expect(resolveRunPath(api, "api", index)).toBe("/api/user/list");
    expect(resolveRunPath(api, "", index)).toBe("/user/list");
  });
});

describe("joinPath", () => {
  it("normalizes slashes", () => {
    expect(joinPath("a", "b")).toBe("/a/b");
    expect(joinPath("/a/", "/b/")).toBe("/a/b");
    expect(joinPath("")).toBe("");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/resource-resolver.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/resolver/resource-resolver.ts`**

```ts
import type { MagicClient } from "../client/magic-client.js";
import type { ApiInfo, Group, ResourceTree, TreeNode } from "../client/types.js";

export function joinPath(...parts: string[]): string {
  const joined = parts.map((p) => p ?? "").join("/").replace(/\/+/g, "/");
  return joined === "/" ? "" : joined.replace(/\/+$/, "");
}

/** 拉取整棵资源树（无缓存） */
export async function fetchTree(client: MagicClient): Promise<ResourceTree> {
  return client.managementGet<ResourceTree>("resource");
}

/** 收集某 folder 下的所有文件（ApiInfo）叶节点 */
export function collectFiles(tree: ResourceTree, folder: string): ApiInfo[] {
  const root = tree[folder];
  if (!root) return [];
  const out: ApiInfo[] = [];
  const walk = (node: TreeNode): void => {
    for (const child of node.children ?? []) {
      // 文件节点：path 形如 /xxx 且 children 为空，node 含 method（接口）或无 path 的分组
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
    matches = files.filter((f) => resolveRunPath(f, "", index) === q.path && (!q.method || f.method.toUpperCase() === q.method.toUpperCase()));
  }
  if (matches.length === 0) {
    throw new Error(`未找到接口：${q.name ?? `${q.method} ${q.path}`}`);
  }
  if (matches.length > 1) {
    throw new Error(`匹配到多个接口，请用 path+method 精确指定：${matches.map((m) => `${m.method} ${resolveRunPath(m, "", index)} (${m.name})`).join("; ")}`);
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
        // 分组节点（非文件）有 type 或无 method
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

/** 列出分组（某 type 下） */
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/resource-resolver.test.ts`
Expected: PASS（8 个用例全过）。

- [ ] **Step 5: Commit**

```bash
git add src/resolver/resource-resolver.ts tests/resource-resolver.test.ts
git commit -m "feat(resolver): stateless resource tree parsing (name/path->id, runPath)"
```

---

## Task 6: 分组工具 `src/tools/group.ts`

**Files:**
- Create: `src/tools/group.ts`
- Test: `tests/tools/group.test.ts`

- [ ] **Step 1: 写失败测试 `tests/tools/group.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../setup";
import { MagicClient } from "../../src/client/magic-client.js";
import type { Config } from "../../src/config.js";
import { createGroupTool, listGroupsTool } from "../../src/tools/group.js";

const cfg: Config = { baseUrl: "http://ma", webPath: "/magic/web", readonly: false, prefix: "" };
const client = () => new MagicClient(cfg);

describe("list_groups", () => {
  it("returns flattened group list from tree", async () => {
    server.use(
      http.get("http://ma/magic/web/resource", () =>
        HttpResponse.json({
          code: 1, message: "ok",
          data: {
            api: {
              node: { id: "0", name: "root", path: "", type: "api", parentId: "" },
              children: [
                { node: { id: "g1", name: "用户", path: "user", type: "api", parentId: "0" }, children: [] },
              ],
            },
          },
        })
      )
    );
    const res = await listGroupsTool.handler(client());
    expect(res).toEqual([{ id: "g1", name: "用户", path: "user", type: "api", parentId: "0" }]);
  });
});

describe("create_group", () => {
  it("posts Group JSON and returns id", async () => {
    let received: any;
    server.use(
      http.post("http://ma/magic/web/resource/folder/save", async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ code: 1, message: "ok", data: "newg" });
      })
    );
    const id = await createGroupTool.handler(client(), { name: "订单", path: "order", type: "api", parent: "0" });
    expect(id).toBe("newg");
    expect(received).toEqual({ name: "订单", path: "order", type: "api", parentId: "0" });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/tools/group.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/tools/group.ts`**

约定：所有工具模块导出形如 `{ name, description, inputSchema, handler }` 的对象（`handler` 接收 `(client, args)`），由 `registry.ts` 统一注册到 `McpServer`。

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/tools/group.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/tools/group.ts tests/tools/group.test.ts
git commit -m "feat(tools): list_groups and create_group"
```

---

## Task 7: 接口工具 `src/tools/api.ts`

**Files:**
- Create: `src/tools/api.ts`
- Test: `tests/tools/api.test.ts`

- [ ] **Step 1: 写失败测试 `tests/tools/api.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../setup";
import { MagicClient } from "../../src/client/magic-client.js";
import type { Config } from "../../src/config.js";
import {
  createApiTool, deleteApiTool, getApiTool, listApisTool, runApiTool, updateApiScriptTool,
} from "../../src/tools/api.js";

const cfg: Config = { baseUrl: "http://ma", webPath: "/magic/web", readonly: false, prefix: "" };
const client = () => new MagicClient(cfg);

const TREE = {
  code: 1, message: "ok",
  data: {
    api: {
      node: { id: "0", name: "root", path: "", type: "api", parentId: "" },
      children: [
        {
          node: { id: "g1", name: "用户", path: "user", type: "api", parentId: "0" },
          children: [
            { node: { id: "a1", name: "用户列表", path: "/list", method: "GET", script: "return 1", groupId: "g1" }, children: [] },
          ],
        },
      ],
    },
  },
};

describe("list_apis", () => {
  it("lists apis with runPath", async () => {
    server.use(http.get("http://ma/magic/web/resource", () => HttpResponse.json(TREE)));
    const res = await listApisTool.handler(client(), {});
    expect(res).toEqual([{ id: "a1", name: "用户列表", method: "GET", path: "/user/list", group: "用户" }]);
  });
});

describe("get_api", () => {
  it("returns detail by id", async () => {
    server.use(
      http.get("http://ma/magic/web/resource", () => HttpResponse.json(TREE)),
      http.get("http://ma/magic/web/resource/file/a1", () =>
        HttpResponse.json({ code: 1, message: "ok", data: { id: "a1", name: "用户列表", script: "return 1" } })
      )
    );
    const res = await getApiTool.handler(client(), { ref: "a1" });
    expect(res).toMatchObject({ id: "a1", script: "return 1" });
  });
});

describe("create_api", () => {
  it("creates group if missing then saves api and returns id+runPath", async () => {
    let saved: any;
    server.use(
      http.get("http://ma/magic/web/resource", () => HttpResponse.json(TREE)),
      http.post("http://ma/magic/web/resource/file/api/save", async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json({ code: 1, message: "ok", data: "newid" });
      })
    );
    // 用已存在的分组「用户」
    const res = await createApiTool.handler(client(), {
      path: "/detail", method: "GET", name: "详情", group: "用户", script: "return 2",
    });
    expect(res).toEqual({ id: "newid", runPath: "/user/detail" });
    expect(saved).toMatchObject({ name: "详情", method: "GET", path: "/detail", script: "return 2", groupId: "g1" });
  });
});

describe("update_api_script", () => {
  it("fetches old, replaces script, saves", async () => {
    let saved: any;
    server.use(
      http.get("http://ma/magic/web/resource", () => HttpResponse.json(TREE)),
      http.get("http://ma/magic/web/resource/file/a1", () =>
        HttpResponse.json({ code: 1, message: "ok", data: { id: "a1", name: "用户列表", path: "/list", method: "GET", script: "return 1", groupId: "g1" } })
      ),
      http.post("http://ma/magic/web/resource/file/api/save", async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json({ code: 1, message: "ok", data: "a1" });
      })
    );
    const res = await updateApiScriptTool.handler(client(), { ref: "a1", script: "return 99" });
    expect(res).toEqual({ id: "a1" });
    expect(saved.script).toBe("return 99");
  });
});

describe("delete_api", () => {
  it("posts delete with resolved id", async () => {
    let got: any;
    server.use(
      http.get("http://ma/magic/web/resource", () => HttpResponse.json(TREE)),
      http.post("http://ma/magic/web/resource/delete", ({ request }) => {
        got = new URL(request.url).searchParams.get("id");
        return HttpResponse.json({ code: 1, message: "ok", data: true });
      })
    );
    const res = await deleteApiTool.handler(client(), { ref: "用户列表" });
    expect(res).toEqual({ deleted: true });
    expect(got).toBe("a1");
  });
});

describe("run_api", () => {
  it("calls live endpoint by runPath and returns raw result", async () => {
    server.use(
      http.get("http://ma/magic/web/resource", () => HttpResponse.json(TREE)),
      http.get("http://ma/user/list", ({ request }) =>
        new HttpResponse(JSON.stringify({ ok: 1 }), { status: 200, headers: { "content-type": "application/json" } })
      )
    );
    const res = await runApiTool.handler(client(), { path: "/user/list", method: "GET", params: { page: 1 } });
    expect(res.status).toBe(200);
    expect(res.body).toContain('"ok":1');
  });
  it("returns 500 body as a normal result (not error)", async () => {
    server.use(
      http.get("http://ma/magic/web/resource", () => HttpResponse.json(TREE)),
      http.get("http://ma/user/list", () => new HttpResponse("boom", { status: 500 }))
    );
    const res = await runApiTool.handler(client(), { path: "/user/list", method: "GET" });
    expect(res.status).toBe(500);
    expect(res.body).toBe("boom");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/tools/api.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/tools/api.ts`**

```ts
import type { MagicClient } from "../client/magic-client.js";
import type { ApiInfo } from "../client/types.js";
import {
  buildGroupPathIndex, collectFiles, fetchTree, resolveApiId, resolveGroupId, resolveRunPath,
} from "../resolver/resource-resolver.js";
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
    const groupIndex = new Map<string, string>();
    for (const folder of Object.keys(tree)) {
      for (const g of listGroupNodes(tree, folder)) groupIndex.set(g.id, g.name);
    }
    return files
      .filter((f) => !args.group || groupIndex.get(f.groupId) === args.group)
      .map((f) => ({
        id: f.id,
        name: f.name,
        method: f.method,
        path: resolveRunPath(f, "", index),
        group: groupIndex.get(f.groupId) ?? "",
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
    return client.managementGet<ApiInfo>(`resource/file/${id}`);
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
    const tree = await fetchTree(client);
    let groupId = resolveGroupId(tree, args.group, "api");
    if (!groupId) {
      groupId = await client.managementPost<string>("resource/folder/save", {
        name: args.group, path: args.group, type: "api", parentId: "0",
      });
    }
    const body: ApiInfo = {
      id: null, name: args.name, method: args.method.toUpperCase(),
      path: args.path, script: args.script, groupId, description: args.description,
    };
    const id = await client.managementPost<string>("resource/file/api/save", body);
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
    const old = await client.managementGet<ApiInfo>(`resource/file/${id}`);
    const updated: ApiInfo = { ...old, script: args.script };
    await client.managementPost<string>("resource/file/api/save", updated, { auto: "1" });
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
    const ok = await client.managementPost<boolean>("resource/delete", undefined, { id });
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

function listGroupNodes(tree: any, folder: string): any[] {
  const root = tree[folder];
  const out: any[] = [];
  const walk = (node: any): void => {
    for (const c of node.children ?? []) {
      if (c.node.method === undefined) out.push(c.node);
      walk(c);
    }
  };
  if (root) walk(root);
  return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/tools/api.test.ts`
Expected: PASS（7 个用例全过）。

- [ ] **Step 5: Commit**

```bash
git add src/tools/api.ts tests/tools/api.test.ts
git commit -m "feat(tools): api CRUD + run_api with ref resolution"
```

---

## Task 8: 函数与数据源工具

**Files:**
- Create: `src/tools/functions.ts`
- Create: `src/tools/datasource.ts`
- Test: `tests/tools/functions-datasource.test.ts`

- [ ] **Step 1: 写失败测试 `tests/tools/functions-datasource.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../setup";
import { MagicClient } from "../../src/client/magic-client.js";
import type { Config } from "../../src/config.js";
import { listDatasourcesTool } from "../../src/tools/datasource.js";
import { getFunctionTool, listFunctionsTool } from "../../src/tools/functions.js";

const cfg: Config = { baseUrl: "http://ma", webPath: "/magic/web", readonly: false, prefix: "" };
const client = () => new MagicClient(cfg);

const fnTree = {
  code: 1, message: "ok",
  data: {
    function: {
      node: { id: "0", name: "root", path: "", type: "function", parentId: "" },
      children: [
        { node: { id: "fg1", name: "工具", path: "util", type: "function", parentId: "0" },
          children: [{ node: { id: "f1", name: "now", path: "/now", method: "function", script: "return date()", groupId: "fg1" }, children: [] }] },
      ],
    },
    datasource: {
      node: { id: "0", name: "root", path: "", type: "datasource", parentId: "" },
      children: [
        { node: { id: "d1", name: "主库", path: "primary", type: "datasource", parentId: "0" }, children: [] },
      ],
    },
  },
};

describe("list_functions", () => {
  it("lists functions", async () => {
    server.use(http.get("http://ma/magic/web/resource", () => HttpResponse.json(fnTree)));
    const res = await listFunctionsTool.handler(client(), {});
    expect(res).toEqual([{ id: "f1", name: "now", path: "/now", group: "工具" }]);
  });
});

describe("get_function", () => {
  it("returns detail by id", async () => {
    server.use(
      http.get("http://ma/magic/web/resource", () => HttpResponse.json(fnTree)),
      http.get("http://ma/magic/web/resource/file/f1", () =>
        HttpResponse.json({ code: 1, message: "ok", data: { id: "f1", name: "now", script: "return date()" } }))
    );
    const res = await getFunctionTool.handler(client(), { ref: "f1" });
    expect(res).toMatchObject({ id: "f1", script: "return date()" });
  });
});

describe("list_datasources", () => {
  it("lists datasources", async () => {
    server.use(http.get("http://ma/magic/web/resource", () => HttpResponse.json(fnTree)));
    const res = await listDatasourcesTool.handler(client(), {});
    expect(res).toEqual([{ id: "d1", name: "主库", type: "datasource" }]);
  });
});
```

> 注：函数文件节点在真实 magic-api 中不带 `method`，但 collectFiles 用 `method` 区分接口。函数/数据源文件识别改用「有 script 且有 id」。为避免与 collectFiles 冲突，下面用独立遍历。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/tools/functions-datasource.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/tools/functions.ts`**

```ts
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
```

- [ ] **Step 4: 实现 `src/tools/datasource.ts`**

```ts
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
    const root = tree.datasource;
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
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test -- tests/tools/functions-datasource.test.ts`
Expected: PASS（3 个用例全过）。

- [ ] **Step 6: Commit**

```bash
git add src/tools/functions.ts src/tools/datasource.ts tests/tools/functions-datasource.test.ts
git commit -m "feat(tools): list/get functions and list datasources"
```

---

## Task 9: 知识工具 `src/tools/knowledge.ts` 与文档

**Files:**
- Create: `src/knowledge/magic-script.md`
- Create: `src/tools/knowledge.ts`
- Test: `tests/tools/knowledge.test.ts`

- [ ] **Step 1: 写 `src/knowledge/magic-script.md`（节选用 `## ` 二级标题分片）**

```markdown
# magic-script 速查

## 请求变量
- `query`：URL 参数对象。`query.page`
- `body`：请求体（JSON 自动解析）。`body.name`
- `header`：请求头。`header["content-type"]`
- `path`：路径变量。`path.id`
- `session` / `cookie`：会话与 Cookie。

## db 模块（SQL）
- 查询：`return db.select("select * from user where id = #{id}", { id: path.id })`
- 单条：`db.selectOne(...)`
- 新增：`db.insert("user", { name: "x", age: 18 })` 返回主键
- 更新：`db.update("user", { age: 19 }, { id: 1 })`
- 删除：`db.delete("user", { id: 1 })`
- 占位符：`#{var}` 走参数化；`${var}` 字符串拼接（慎用）
- 条件拼接：`?{name != null, and name like #{name}}`

## 分页
- `return db.page("select * from user").where(...).orderBy("id desc").page(query.page ?? 1, query.size ?? 10)`

## 事务
- `db.transaction(() => { db.insert(...); db.update(...); })`

## http 模块
- `return http.get("https://api.x.com/y").body()`
- `http.post(url, jsonBody)`

## response 模块
- `response.setImage(bytes)` 输出图片；`response.download(filename, bytes)` 下载
- 自定义状态码：`response.setStatus(404); return "not found"`

## env 模块
- `env.get("spring.application.name")`

## 返回值
- 直接 `return` 对象/数组，magic-api 自动包装为 `{code,message,data}`（除非自定义）。

## 接口选项（options）
- `timeout`：超时毫秒；`forward`：内部转发；详见 magic-api 文档。
```

- [ ] **Step 2: 写失败测试 `tests/tools/knowledge.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../setup";
import { MagicClient } from "../../src/client/magic-client.js";
import type { Config } from "../../src/config.js";
import { magicScriptHelpTool, searchCodeTool } from "../../src/tools/knowledge.js";

const cfg: Config = { baseUrl: "http://ma", webPath: "/magic/web", readonly: false, prefix: "" };

describe("magic_script_help", () => {
  it("returns the section matching the topic", async () => {
    const res = await magicScriptHelpTool.handler(new MagicClient(cfg), { topic: "db" });
    expect(typeof res).toBe("string");
    expect(res).toContain("db.select");
  });
  it("returns full doc overview when topic not found", async () => {
    const res = await magicScriptHelpTool.handler(new MagicClient(cfg), { topic: "不存在的主题xyz" });
    expect(res).toContain("magic-script");
  });
});

describe("search_code", () => {
  it("proxies to /search", async () => {
    server.use(
      http.get("http://ma/magic/web/search", ({ request }) => {
        expect(new URL(request.url).searchParams.get("keyword")).toBe("page");
        return HttpResponse.json({ code: 1, message: "ok", data: [{ id: "a1", text: "db.page", line: 3 }] });
      })
    );
    const res = await searchCodeTool.handler(new MagicClient(cfg), { keyword: "page" });
    expect(res).toEqual([{ id: "a1", text: "db.page", line: 3 }]);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npm test -- tests/tools/knowledge.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 4: 实现 `src/tools/knowledge.ts`**

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { MagicClient } from "../client/magic-client.js";
import type { SearchResult } from "../client/types.js";
import type { ToolDef } from "./group.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOC_PATH = join(__dirname, "..", "knowledge", "magic-script.md");
const DOC = readFileSync(DOC_PATH, "utf-8");

export const magicScriptHelpTool: ToolDef<{ topic: string }, string> = {
  name: "magic_script_help",
  description: "查询 magic-script 用法（db/http/response/env 模块、请求变量、分页、事务等）。",
  inputSchema: {
    type: "object",
    properties: { topic: { type: "string", description: "主题关键词，如 db / http / 分页 / query" } },
    required: ["topic"],
  },
  readonly: true,
  handler: async (_client, args) => {
    const sections = DOC.split(/^## /m).filter(Boolean);
    const hit = sections.find((s) => s.toLowerCase().includes(args.topic.toLowerCase()));
    return hit ? `## ${hit}` : DOC.slice(0, 1500);
  },
};

export const searchCodeTool: ToolDef<{ keyword: string }, SearchResult[]> = {
  name: "search_code",
  description: "在所有接口/函数脚本中全局搜索关键词。",
  inputSchema: {
    type: "object",
    properties: { keyword: { type: "string" } },
    required: ["keyword"],
  },
  readonly: true,
  handler: async (client, args) => {
    return client.managementGet<SearchResult[]>("search", { keyword: args.keyword });
  },
};
```

> 注：`readFileSync` 在 import 时执行；路径 `join(__dirname, "..", "knowledge", ...)` 在 `dist/tools/knowledge.js` 下解析为 `dist/knowledge/magic-script.md`。Task 1 的 `build` 脚本已包含 `cp -r src/knowledge dist` 来复制该文件，构建后路径正确。测试用 tsx 直跑 `src/`，`__dirname` 指向 `src/tools`，同样解析到 `src/knowledge/`，正确。

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test -- tests/tools/knowledge.test.ts`
Expected: PASS（3 个用例全过）。

- [ ] **Step 6: Commit**

```bash
git add src/knowledge/magic-script.md src/tools/knowledge.ts tests/tools/knowledge.test.ts
git commit -m "feat(tools): magic_script_help (embedded docs) and search_code"
```

---

## Task 10: 工具注册与 READONLY 拦截 `src/tools/registry.ts`

**Files:**
- Create: `src/tools/registry.ts`
- Test: `tests/tools/registry.test.ts`

- [ ] **Step 1: 写失败测试 `tests/tools/registry.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { allTools, isWriteTool } from "../../src/tools/registry.js";

describe("registry", () => {
  it("exposes the full tool set", () => {
    const names = allTools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "create_api", "create_group", "delete_api", "get_api", "get_function",
        "list_apis", "list_datasources", "list_functions", "list_groups",
        "magic_script_help", "run_api", "search_code", "update_api_script",
      ].sort()
    );
  });
  it("marks write tools", () => {
    expect(isWriteTool("create_api")).toBe(true);
    expect(isWriteTool("delete_api")).toBe(true);
    expect(isWriteTool("update_api_script")).toBe(true);
    expect(isWriteTool("create_group")).toBe(true);
    expect(isWriteTool("list_apis")).toBe(false);
    expect(isWriteTool("run_api")).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/tools/registry.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/tools/registry.ts`**

```ts
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { MagicClient } from "../client/magic-client.js";
import type { ToolDef } from "./group.js";
import { createGroupTool, listGroupsTool } from "./group.js";
import { createApiTool, deleteApiTool, getApiTool, listApisTool, runApiTool, updateApiScriptTool } from "./api.js";
import { getFunctionTool, listFunctionsTool } from "./functions.js";
import { listDatasourcesTool } from "./datasource.js";
import { magicScriptHelpTool, searchCodeTool } from "./knowledge.js";

export const allTools: ToolDef<any, any>[] = [
  listGroupsTool, createGroupTool,
  listApisTool, getApiTool, createApiTool, updateApiScriptTool, deleteApiTool, runApiTool,
  listFunctionsTool, getFunctionTool, listDatasourcesTool,
  magicScriptHelpTool, searchCodeTool,
];

export function isWriteTool(name: string): boolean {
  const t = allTools.find((x) => x.name === name);
  return !!t && !t.readonly;
}

export function registerTools(server: Server, client: MagicClient): void {
  const readonly = client.isReadonly();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools
      .filter((t) => !(readonly && isWriteTool(t.name))) // readonly 模式隐藏写工具
      .map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as any,
      })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const tool = allTools.find((t) => t.name === name);
    if (!tool) throw new Error(`未知工具：${name}`);
    if (readonly && isWriteTool(name)) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, kind: "readonly", message: `只读模式已禁用写工具：${name}` }) }] };
    }
    try {
      const result = await tool.handler(client, (req.params.arguments ?? {}) as any);
      return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, kind: "error", message: (e as Error).message }) }], isError: true };
    }
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/tools/registry.test.ts`
Expected: PASS（2 个用例全过）。

- [ ] **Step 5: Commit**

```bash
git add src/tools/registry.ts tests/tools/registry.test.ts
git commit -m "feat(registry): register all tools, hide/block writes in readonly mode"
```

---

## Task 11: 入口 `src/index.ts` 与构建校验

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: 写 `src/index.ts`**

```ts
#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { MagicClient } from "./client/magic-client.js";
import { allTools, registerTools } from "./tools/registry.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new MagicClient(config);
  await client.init();

  const server = new Server(
    { name: "magic-api-mcp", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } }
  );

  registerTools(server, client);

  // 暴露 magic-script 文档为 resource（可选，便于检索）
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`magic-api-mcp ready → ${config.baseUrl}${config.webPath} (readonly=${config.readonly}, tools=${allTools.length})`);
}

main().catch((e) => {
  console.error("magic-api-mcp failed to start:", e);
  process.exit(1);
});
```

- [ ] **Step 2: 全量构建**

Run: `npm run build`
Expected: `dist/` 生成，无 TS 错误。若有 `import.meta`/路径问题，修正。

- [ ] **Step 3: 全量测试**

Run: `npm test`
Expected: 所有测试通过。

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: entry point with stdio transport and client init"
```

---

## Task 12: README 与冒烟文档

**Files:**
- Create: `README.md`

- [ ] **Step 1: 写 `README.md`**

````markdown
# magic-api MCP

让 AI 通过 MCP 操作运行中的 magic-api 实例：接口增删改查 + 运行、分组/函数/数据源管理，并内置 magic-script 知识。

## 安装

```bash
cd magic-api-mcp
npm install
npm run build
```

## 配置（环境变量）

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `MAGIC_API_BASE` | 是 | — | magic-api 地址，如 `http://localhost:9999` |
| `MAGIC_API_WEB` | 否 | `/magic/web` | 管理端路径 |
| `MAGIC_API_TOKEN` | 否* | — | 静态 token |
| `MAGIC_API_USERNAME` / `MAGIC_API_PASSWORD` | 否* | — | 账号密码（自动 login） |
| `MAGIC_API_READONLY` | 否 | `false` | 只读模式，禁用写工具 |
| `MAGIC_API_PREFIX` | 否 | 空 | 接口路径前缀 |

\* 鉴权二选一；账号密码优先。

## Claude Desktop / Code 接入

在 MCP 配置中加入：

```json
{
  "mcpServers": {
    "magic-api": {
      "command": "node",
      "args": ["/Users/lynx/projects/lynx/magic-api/magic-api-mcp/dist/index.js"],
      "env": {
        "MAGIC_API_BASE": "http://localhost:9999",
        "MAGIC_API_USERNAME": "your-username",
        "MAGIC_API_PASSWORD": "your-username"
      }
    }
  }
}
```

## 工具一览

- 接口：`list_apis` `get_api` `create_api` `update_api_script` `delete_api` `run_api`
- 分组：`list_groups` `create_group`
- 函数：`list_functions` `get_function`
- 数据源：`list_datasources`
- 知识：`magic_script_help` `search_code`

## 冒烟测试（手动）

1. 启动一个 magic-api 实例（`server.port=9999`，`magic-api.web=/magic/web`）。
2. 配置 MCP 并重启 Claude。
3. 让 AI：`用 magic-api 创建一个 GET /hello 接口，脚本返回 {msg:"hi"}，然后运行它`。
4. 预期：`create_api` 返回 id 与 runPath；`run_api` 返回 200 与响应体。

## 开发

```bash
npm test        # 单元 + 集成（msw 模拟）
npm run dev     # tsx 直跑
npm run build
```
````

- [ ] **Step 2: 最终全量校验**

Run: `npm run build && npm test`
Expected: 构建成功，全部测试通过。

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with config, Claude setup, smoke test"
```

---

## 完成标准

- `npm run build` 无错误，`npm test` 全绿。
- 13 个工具全部注册并可被 MCP 客户端发现；`READONLY=true` 时写工具被隐藏并在调用时拒绝。
- 端到端：在真实/模拟 magic-api 上能完成「创建接口 → 运行接口」。
```
