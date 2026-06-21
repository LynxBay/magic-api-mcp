# magic-api MCP

让 AI 通过 MCP 操作运行中的 magic-api 实例：接口增删改查 + 运行、分组 / 函数 / 数据源管理，并内置 magic-script 知识。

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

只读模式（`MAGIC_API_READONLY=true`）下，写工具（`create_api` / `update_api_script` / `delete_api` / `create_group`）会被隐藏并在调用时拒绝。

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
