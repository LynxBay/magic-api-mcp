# magic-api-mcp 定时任务管理工具设计

- 日期：2026-06-21
- 状态：已确认，待实现
- 范围：为 magic-api-mcp 补充定时任务（task）的完整管理工具集

## 背景

magic-api-mcp 当前覆盖接口（api）、分组（group）、函数（function）、数据源（datasource）等资源的操作，但**不支持定时任务**。用户最初的诉求是「打开/关闭定时任务」，经澄清后扩展为完整的定时任务管理套件。

在 magic-api 中，定时任务（`TaskInfo`）与接口（`ApiInfo`）一样是一种「资源（resource）」，其 CRUD 由通用的资源框架 `MagicResourceController`（`/resource/*`）统一处理；定时任务插件 `magic-api-plugin-task` 仅额外提供一个专属接口 `POST /task/execute`（手动执行一次）。这意味着 task 工具可以几乎完全镜像现有的 api 工具实现，复用既有的资源访问模式，无需引入新机制。

## 目标

补充 8 个工具，覆盖定时任务的查看、增删改、开关与手动执行：

`list_tasks`、`get_task`、`create_task`、`update_task`、`enable_task`、`disable_task`、`delete_task`、`run_task`。

## 非目标（YAGNI）

- 不做 cron 表达式语法校验。后端 `TaskInfoMagicResourceStorage.validate()` 仅校验 cron 非空（`CRON_ID_REQUIRED`），复杂语法校验交给 Spring 调度器，MCP 不重复实现。
- 不做批量开关。
- 不做执行历史 / 日志查询（magic-api 未通过 HTTP 暴露）。
- 不修改 `src/knowledge/magic-script.md`。

## 实现路径

task 与 api 同构，全部走通用资源接口：

| 操作 | 后端调用 |
|---|---|
| 列表 | `GET resource`（资源树）→ `collectFiles(tree, "task")` |
| 详情 | `GET resource/file/{id}` |
| 新建 | `POST resource/folder/save`（分组不存在时建分组）+ `POST resource/file/task/save` |
| 更新 | `GET resource/file/{id}` → 合并字段 → `POST resource/file/task/save`（带 `{ auto: "1" }`） |
| 删除 | `POST resource/delete?id={id}` |
| 手动执行 | `POST task/execute?id={id}` |

**enable/disable 的机制**：`enabled` 是 `TaskInfo` 的字段。通过 save 修改 `enabled` 会触发 `FileEvent(type='task')`，`TaskMagicDynamicRegistry` 监听到后先 `unregister` 再 `register`；`register()` 内 `if (entity.isEnabled())` 才真正执行脚本。因此 enable/disable = 改 `enabled` 字段后 save，与 update_task 同源。

## 工具清单

新增 `src/tools/task.ts`，导出 8 个 `ToolDef`，并在 `registry.ts` 的 `allTools` 中注册。

### `list_tasks`（只读）
- 入参：`{ group?: string }`（按分组名过滤，可选）
- 行为：`fetchTree` → `collectFiles(tree, "task")` → 按 group 过滤
- 返回：`Array<{ id, name, path, cron, enabled, group }>`

### `get_task`（只读）
- 入参：`{ ref: string }`（id / name / path）
- 行为：`resolveTaskRef` → `GET resource/file/{id}`
- 返回：完整 TaskInfo（`id, name, path, groupId, script, cron, enabled, description`）

### `create_task`（写）
- 入参：`{ name, group, cron, script, enabled?, description? }`
- 行为：解析/创建分组（`resolveGroupId(tree, group, "task")`，无则 `resource/folder/save`）→ `POST resource/file/task/save`
- 返回：`{ id }`
- 默认：`enabled` 未传时为 `false`（创建后不自动调度，需显式 `enable_task` 启用，避免误触发）

### `update_task`（写）
- 入参：`{ ref, cron?, script?, description?, enabled? }`（任意组合，未传字段保留原值）
- 行为：`GET resource/file/{id}` 取旧值 → 合并入参非空字段 → `POST resource/file/task/save`（带 `{ auto: "1" }`）
- 返回：`{ id }`

### `enable_task`（写）
- 入参：`{ ref: string }`
- 行为：等价于 `update_task(ref, { enabled: true })`，底层共用 `setTaskEnabled` helper
- 返回：`{ id, enabled: true }`

### `disable_task`（写）
- 入参：`{ ref: string }`
- 行为：等价于 `update_task(ref, { enabled: false })`
- 返回：`{ id, enabled: false }`

### `delete_task`（写）
- 入参：`{ ref: string }`
- 行为：`resolveTaskRef` → `POST resource/delete?id={id}`
- 返回：`{ deleted: true }`

### `run_task`（写，有副作用）
- 入参：`{ ref: string }`
- 行为：`resolveTaskRef` → `POST task/execute?id={id}`
- 返回：脚本执行结果（`JsonBean.data` 原样，类型取决于脚本）

## 关键设计决策

1. **enable/disable 拆分为两个工具**（`enable_task` / `disable_task`），而非合并为 `set_task_enabled(ref, enabled)`。  
   理由：LLM 调用更直觉（「关闭 X」→ `disable_task`），与 `create_task` / `delete_task` 的动作式命名一致；底层共用 `setTaskEnabled(client, ref, enabled)` helper 避免重复。

2. **`update_task` 为全能更新**（cron/script/description/enabled 任意组合），而非像 api 仅有 `update_api_script`。  
   理由：task 可变字段多（cron 经常调整），逐字段建工具会导致工具爆炸；走「get 旧值 → 合并 → save」，未传字段自动保留。

3. **`create_task` 的 `enabled` 默认 `false`**。  
   理由：新建即调度有副作用风险，默认禁用、显式启用更安全、可预测。

4. **ref 解析简化**：task 无 `method`，`resolveTaskRef` 支持 id / name / path 三选一（先按 name 在 task 资源中查找，未命中则视为 id）。

## 数据类型

`src/client/types.ts` 新增：

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

## 改动文件

- 新增 `src/tools/task.ts`：8 个 `ToolDef` + `resolveTaskRef` + `setTaskEnabled` helper
- 改 `src/client/types.ts`：新增 `TaskInfo`
- 改 `src/tools/registry.ts`：import 8 个工具并加入 `allTools`
- 新增 `tests/tools/task.test.ts`：msw 镜像 `tests/tools/api.test.ts`，每个工具 1–2 个 case

readonly 模式自动隐藏 6 个写工具（`create/update/enable/disable/delete/run`），由现有 `registry.ts` 的 `readonly && isWriteTool` 逻辑处理，无需额外代码。

## 测试策略

镜像 `api.test.ts` 的 msw 模式：
- mock 资源树（`GET resource`）含一个 task 节点
- mock `GET resource/file/{id}` 返回 TaskInfo
- mock `POST resource/file/task/save` 捕获请求体、断言合并后的字段
- mock `POST resource/delete` 断言 id 走 query
- mock `POST task/execute` 断言 id 走 query、返回值透传
- 覆盖 `enabled` 默认值（create 不传 → false）、ref 按 name 解析、enable/disable 写入正确布尔值

预期测试数量约 12–16 个，沿用现有 vitest + msw 体系。

## 风险与待验证

- **`task/execute` 的 URL 前缀**：已由前端 `request.sendPost('/task/execute', { id })` 确认与 `resource/*` 同为相对 `webPath`（即 `${baseUrl}${webPath}/task/execute`）。实现后需用真实 magic-api 实例冒烟一次确认。
- **`POST task/execute` 的 `id` 传参方式**：沿用 `delete_api` 的做法走 query string（`?id=`），Spring `execute(String id, ...)` 可从 query 取。若实测不通过则改 form body。
- **`run_task` 的返回类型**：脚本返回任意值，工具直接透传 `JsonBean.data`，不做形状假设。

## 验收标准

1. `npm test` 全绿，含新增 `task.test.ts`，且现有 35 个测试不回归。
2. `npm run build`（tsc）通过，无类型错误。
3. `registry.ts` 的 `allTools` 含全部 8 个新工具；readonly 配置下仅暴露 `list_tasks` / `get_task`。
4. 用真实 magic-api 实例冒烟：`create_task` → `enable_task` → `get_task`（确认 enabled=true）→ `run_task` → `disable_task` → `delete_task` 全链路成功。
