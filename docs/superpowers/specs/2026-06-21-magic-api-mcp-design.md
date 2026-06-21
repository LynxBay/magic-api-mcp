# magic-api MCP 设计文档

- 日期：2026-06-21
- 状态：待评审
- 作者：Claude + lynx
- 关联源码：`../magic-api-2.0.1/`（magic-api 2.0.1）

## 1. 背景与目标

magic-api 是基于 Java/Spring Boot 的接口快速开发框架：在 Web UI 里写 `magic-script` 脚本，脚本自动映射为 HTTP 接口，无需编写 Controller/Service/Dao/Mapper。它本身暴露一套**管理 REST API**（默认基路径 `/magic/web`），用于管理接口脚本、函数、数据源、分组、备份等。

本项目的目标：开发一套 **MCP（Model Context Protocol）server**，让 AI（如 Claude）能够：

1. **操作一个运行中的 magic-api 实例**——列出/创建/编辑/删除接口与函数、管理数据源、在线运行测试接口；
2. **内嵌 magic-script 知识**——提供脚本语法、内置模块（`db`/`http`/`response`/`request`/`env`）、请求变量与模板，帮助 AI 写出正确的脚本。

AI 在此 MCP 下扮演「接口开发者」的角色：从需求到写出脚本、保存发布、并测试运行。

## 2. 非目标（v1 不做）

- 备份 / 回滚（`/backup*`）
- 定时任务（`magic-api-plugin-task`）
- 集群同步、上传下载、远程推送（`/upload`、`/push`、`/download`）
- WebSocket 断点调试与日志流
- 多实例管理（v1 只连一个 magic-api 实例）
- 修改 magic-api 源码本身

以上作为后续可扩展点保留。

## 3. 总体架构

一个**独立的 TypeScript MCP server**，通过 **HTTP（fetch）连接一个运行中的 magic-api 实例**。不嵌入 Java、不依赖 JVM，纯 HTTP 客户端。

```
Claude (MCP 客户端)  ──stdio──▶  magic-api-mcp (TS)  ──HTTP──▶  运行中的 magic-api
                                                              (默认 /magic/web)
```

技术栈：
- 语言：TypeScript（Node.js）
- MCP SDK：`@modelcontextprotocol/sdk`（stdio transport）
- HTTP：Node 原生 `fetch`（Node 18+）
- 测试：Vitest + `msw`（模拟 magic-api HTTP）

## 4. 配置

通过环境变量或 Claude 的 MCP 配置参数注入（优先级：env > 显式参数 > 默认值）：

| 配置项 | 默认 | 说明 |
|---|---|---|
| `MAGIC_API_BASE` | 必填 | 实例地址，如 `http://localhost:9999` |
| `MAGIC_API_WEB` | `/magic/web` | 管理端 web 路径 |
| `MAGIC_API_TOKEN` | — | 静态 token，直接作为 `Magic-Token` 头 |
| `MAGIC_API_USERNAME` | — | 账号（与 PASSWORD 配合，启动时 `/login` 换 token） |
| `MAGIC_API_PASSWORD` | — | 密码 |
| `MAGIC_API_READONLY` | `false` | `true` 时屏蔽所有写工具，不发请求 |
| `MAGIC_API_PREFIX` | 空 | 接口路径前缀（拼 `run_api` 真实路径用，见 §6） |

**鉴权规则**：
- 若提供 `USERNAME` + `PASSWORD`：启动时调 `POST {web}/login`，从响应头取 `Magic-Token`，缓存于进程内存。
- 否则用 `MAGIC_API_TOKEN` 作为静态 token。
- 二者都没有：magic-api 若未开启 `requireLogin`，请求可不带 token；若开启则报错。
- token 失效（收到 401）时，仅当配置了 `USERNAME`+`PASSWORD` 才自动重试一次 `/login`；静态 token 无法刷新。

## 5. 组件结构

```
magic-api-mcp/
  src/
    index.ts              // 入口：读配置 → 启动 stdio MCP server → 注册工具
    config.ts             // 加载/校验配置；readonly 标志
    client/
      magic-client.ts     // 唯一 HTTP 出口：base url、Magic-Token 注入、
                          //   JsonBean 解包、401→重试 login
      types.ts            // magic-api 端类型：ApiInfo / Group / JsonBean 等
    resolver/
      resource-resolver.ts// 无状态实时解析：name|path|method → id、runPath
    tools/
      api.ts              // list_apis / get_api / create_api /
                          //   update_api_script / delete_api / run_api
      group.ts            // list_groups / create_group
      functions.ts        // list_functions / get_function
      datasource.ts       // list_datasources
      knowledge.ts        // magic_script_help / search_code
      registry.ts         // 注册全部工具；readonly 拦截
    knowledge/
      magic-script.md     // 内嵌文档：模块 + 请求变量 + 选项 + 模板
  docs/superpowers/specs/ // 本设计文档
  tests/                  // 单元 + 集成测试
  package.json / tsconfig.json / README.md
```

**关键组件职责**：

- **`magic-client`** — 唯一 HTTP 出口。统一处理：管理端路径拼接（`{base}{web}/...`）、真实接口路径拼接（`{base}/...`）、`Magic-Token` 注入、`JsonBean` 解包（见 §7）、401 重试。所有工具经它，不直接 `fetch`。
- **`resource-resolver`** — 无状态。提供 `resolveApiId(name|path, method?)`、`resolveGroupId(name)`、`resolveRunPath(id)` 等纯函数；每次调用实时拉 `GET /resource` 解析，**不缓存、不持有本地状态**（见 §6）。
- **`knowledge/magic-script.md`** — 手写文档，`magic_script_help(topic)` 按关键词切片返回。

## 6. 名称 / 路径实时解析（无缓存）

magic-api 支持多人 / 集群同时操作，本地缓存易脏且难失效，因此 **v1 不做任何缓存**：每次需要把人类可读的 `name`/`path` 翻译成内部 `id` 时，实时调用 magic-api 一次。

解析依据（已对照源码确认）：
- 接口的**完整运行路径** = `MAGIC_API_PREFIX`（可选）+ 分组路径（`group.path`）+ `ApiInfo.path`。对应 `ApiInfoMagicResourceStorage.buildMappingKey`：`METHOD : prefix + groupPath + api.path`。
- 接口唯一性键：`method + 完整路径`。

解析行为：
- `resolveApiId(name)`：`GET /resource` 取 `api` 树，按 `name` 匹配；重名时返回列表并要求 AI 指定 path。
- `resolveApiId(path, method)`：按 `groupPath + api.path` 与 `method` 精确匹配。
- `resolveRunPath(id)`：`GET /resource/file/{id}` 取详情，拼出完整运行路径。
- `resolveGroupId(name)`：从树中找分组；找不到时由 `create_group` 先建。

代价：每次多一次 HTTP（`GET /resource` 一次返回整棵树，成本可控）。收益：永不过期、无需失效逻辑、多人安全。

## 7. 工具集

所有工具走 `magic-client`。底层 HTTP 已对照源码验证。

### 通用约定
- magic-api 业务响应统一为 `JsonBean{ code, message, data }`；`code == 1` 为成功，`magic-client` 取 `data` 返回，否则抛带 `message` 的业务错误。
- 写工具在 `MAGIC_API_READONLY=true` 时由 `registry.ts` 拦截，直接返回「只读模式禁用」，不发请求。

### 7.1 接口（API）

| 工具 | 入参 | 底层 HTTP | 返回 |
|---|---|---|---|
| `list_apis(group?)` | 分组名（可选） | `GET {web}/resource` 取 `api` 树 | `[{id, name, method, path, group, runPath}]` |
| `get_api(ref)` | `ref` = id 或 name 或 path+method | `GET {web}/resource/file/{id}`（name/path 先经 resolver） | 完整 `ApiInfo`（含 `script`、`parameters` 等） |
| `create_api(...)` | `path, method, name, group, script, description?` | 必要时 `POST {web}/resource/folder/save` 建分组；`POST {web}/resource/file/api/save?auto=1`，body = `ApiInfo` JSON | `{id, runPath}` |
| `update_api_script(ref, script)` | `ref` 同上 + 新 `script` | `GET /resource/file/{id}` 取旧值 → 替换 `script` → `POST /resource/file/api/save` | `{id}` |
| `delete_api(ref)` | `ref` 同上 | `POST {web}/resource/delete?id=` | `{deleted: true}` |
| `run_api(...)` | `path, method, params?, body?, headers?` | 实时解析 `runPath` → 向 `{base}/{runPath}` 发指定 method 请求，带 `Magic-Token` | `{status, headers, body}`（见 §8 例外） |

`create_api` 构造的 `ApiInfo` JSON 关键字段（基于 `ApiInfo`/`PathMagicEntity`/`MagicEntity`）：
`{ id:null, name, method, path, script, groupId, description }`（其余字段如 `parameters`/`options`/`headers` 默认空数组）。保存端点 `folder` 固定为 `"api"`，故路径为 `/resource/file/api/save`。

备注：
- `run_api` 的 `method` 参数即「用什么 HTTP 方法调用」，应与接口注册的 `method` 一致，否则 magic-api 返回 405。resolver 用 `path+method` 定位接口；若同 path 有多个 method，AI 必须指定。
- `/resource/file/api/save` 的 `auto` query 参数（值为 `1`）语义为「与旧版对比，内容一致则跳过写入」。`update_api_script` 用 `auto=1` 可避免无变化时的重复写；`create_api`（新接口）不传 `auto`。

### 7.2 分组

| 工具 | 入参 | 底层 HTTP | 返回 |
|---|---|---|---|
| `list_groups()` | — | `GET {web}/resource` 取分组节点 | 树形 `[{id, name, path, type, parentId}]` |
| `create_group(name, path, parent?, type?)` | `type` 默认 `api` | `POST {web}/resource/folder/save`，body = `Group` JSON `{name, path, type, parentId}` | `{id}` |

### 7.3 函数 / 数据源（只读为主）

| 工具 | 入参 | 底层 HTTP | 返回 |
|---|---|---|---|
| `list_functions()` | — | `GET {web}/resource` 取 `function` 树 | `[{id, name, path, group}]` |
| `get_function(ref)` | id 或 name | `GET {web}/resource/file/{id}` | 完整函数信息（含 `script`） |
| `list_datasources()` | — | `GET {web}/resource` 取 `datasource` 树 | `[{id, name, type}]` |

### 7.4 知识与搜索

| 工具 | 入参 | 行为 | 返回 |
|---|---|---|---|
| `magic_script_help(topic)` | `topic` 如 `db`/`http`/`query`/`分页`/`事务` | 按关键词切片返回 `knowledge/magic-script.md` 相关段 | markdown 片段 |
| `search_code(keyword)` | 关键词 | `GET {web}/search?keyword=` | `[{id, text, line}]` |

## 8. 数据流：典型场景「创建并测试一个接口」

```
① AI: create_api(path="/user/list", method="GET", name="用户列表",
                  group="用户", script=<magic-script>)
   MCP:
     ├─ resolveGroupId("用户")：实时 GET /resource → 找到 groupId；
     │   不存在则 POST /resource/folder/save 建分组「用户」(type=api)
     ├─ 构造 ApiInfo JSON → POST /resource/file/api/save
     └─ 返回 {id, runPath:"/api/user/list"}

② AI: run_api(path="/user/list", method="GET", params={page:1})
   MCP:
     ├─ 实时解析 path+method → id 与 runPath（拼 MAGIC_API_PREFIX）
     ├─ GET {base}/runPath?page=1  （带 Magic-Token）
     └─ 返回 {status, headers, body}
```

两个关键点：
1. **写后立即可测**——`create_api` 保存即注册（magic-api 热发布），`run_api` 无需额外「发布」步骤。
2. **`run_api` 的失败 ≠ 工具失败**——被测接口的 4xx/5xx/异常正是 AI 要看的结果，原样返回；只有「连不上 magic-api」「鉴权失败」才算工具报错。

## 9. 错误处理与只读边界

错误分层：
- **连接/鉴权层**：网络错误 → 工具返回结构化错误。401 时**仅当配置了 `USERNAME`+`PASSWORD`** 才自动重试一次 `/login` 换 token；静态 token 模式下 401 直接返回鉴权错误（无法刷新）。仍失败 → `{ok:false, kind:"auth"|"network", message}`。
- **业务层**：`JsonBean.code != 1` → 抛带 `message` 的业务错误（如「路径已存在」「权限不足」「SCRIPT_REQUIRED」「REQUEST_PATH_REQUIRED」）。
- **`run_api` 例外**：被测接口本身错误不算工具错误，原样返回 `status/headers/body`。

只读边界：`MAGIC_API_READONLY=true` 时，`create_api`/`update_api_script`/`delete_api`/`create_group` 在注册层拦截，直接返回 `{ok:false, kind:"readonly"}`，不发任何请求。

## 10. magic-script 知识范围

`knowledge/magic-script.md` 覆盖（基于源码 `modules/` 下带 `@MagicModule` 注解的类与 `Constants` 中的请求变量）：

- **内置模块**：`db`（`SQLModule`：select/update/insert/batch/事务/分页）、`http`（`HttpModule`）、`response`（`ResponseModule`）、`request`（`RequestModule`）、`env`（`EnvModule`）。
- **请求上下文变量**：`query`、`body`、`header`、`path`（路径变量）、`session`、`cookie`。
- **接口选项**（`options`）：从 `Options` 枚举整理。
- **常见模板**：分页查询、带条件 SQL、事务、HTTP 调用、返回 JSON。

## 11. 测试策略

- **单元**（Vitest）：
  - 配置解析与校验、默认值合并；
  - `ApiInfo` payload 构造（字段、`folder="api"`）；
  - `JsonBean` 解包与业务错误抛出；
  - `resource-resolver` 实时解析（mock `GET /resource` 树）；
  - readonly 拦截。
- **集成**（Vitest + `msw`）：模拟 `/login`、`/resource`、`/resource/file/api/save`、真实接口，跑「创建→运行」端到端，验证 token 注入、401 重试、错误传播。
- **冒烟（手动，不进 CI）**：对接真实 magic-api 实例，README 给出步骤（启动 magic-api → 配置 MCP → Claude 里创建并运行一个接口）。

## 12. 项目布局与交付

- 项目根：`/Users/lynx/projects/lynx/magic-api/magic-api-mcp/`
- 交付物：可 `npm run build` 的 TS 包；`README.md` 含 Claude Desktop / Claude Code 的 MCP 配置示例（命令 + env）。
- 入口：`node dist/index.js`，stdio transport。

## 13. 未来扩展点（v2 候选）

备份/回滚、定时任务、上传下载/推送、WebSocket 调试日志流、多实例、`run_api` 的断点调试（`Magic-Request-Breakpoints` 头）。
