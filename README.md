# magic-api MCP

让 AI 通过 MCP 操作运行中的 magic-api 实例：接口增删改查 + 运行、分组 / 函数 / 数据源管理，并内置 magic-script 知识。

支持两种部署：
- **stdio**：本地跑，Claude 启动子进程（适合个人开发机）
- **http**：远程服务，全公司 / 团队共用一个（适合集中部署）

## 安装

```bash
cd magic-api-mcp
npm install
npm run build
```

## 配置（环境变量）

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `MAGIC_API_BASE` | 是 | — | magic-api 地址，如 `http://your-magic-api-host:9999` |
| `MAGIC_API_WEB` | 否 | `/magic/web` | 管理端路径（非默认实例要改，如 `/your-app/magic/dev`） |
| `MAGIC_API_TOKEN` | 否\* | — | 静态 token |
| `MAGIC_API_USERNAME` / `MAGIC_API_PASSWORD` | 否\* | — | 账号密码（自动 login） |
| `MAGIC_API_READONLY` | 否 | `false` | 只读模式，禁用写工具 |
| `MAGIC_API_PREFIX` | 否 | 空 | 接口路径前缀 |
| `MAGIC_API_TRANSPORT` | 否 | `stdio` | `stdio` 或 `http` |
| `MAGIC_API_HTTP_PORT` | 否 | `3111` | http 模式监听端口 |
| `MAGIC_API_HTTP_HOST` | 否 | `0.0.0.0` | http 模式监听地址 |
| `MAGIC_API_ACCESS_TOKEN` | 否 | — | http 模式访问令牌（Bearer），不设则不鉴权 |

\* 鉴权二选一（账号密码优先）。

## 多 target（一套服务操作多个 magic-api 实例）

如果同一个 MCP 部署需要操作多个 magic-api 实例（如 prod / dev），无需再部署多套，用 `MAGIC_API_TARGETS` 声明即可。

**原理：** 目标实例由 URL path 选定（`/mcp/<target>`），path 写死在 `claude mcp add` 命令里，**整个 session 不可变，AI 没有任何工具能跨 target**——选择权完全在人手里。

**服务端（多 target 启动）**：
```bash
MAGIC_API_TARGETS=prod,dev \
MAGIC_API_TARGET_PROD_BASE=http://prod-host:9999 \
MAGIC_API_TARGET_PROD_TOKEN=静态令牌 \
MAGIC_API_TARGET_PROD_READONLY=true \
MAGIC_API_TARGET_DEV_BASE=http://dev-host:9999 \
MAGIC_API_TARGET_DEV_USERNAME=admin \
MAGIC_API_TARGET_DEV_PASSWORD=密码 \
MAGIC_API_TRANSPORT=http \
MAGIC_API_ACCESS_TOKEN=团队令牌 \
node dist/index.js
```

**每 target 的字段**（前缀为 `MAGIC_API_TARGET_<NAME>_`，NAME 转为大写）：

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `_BASE` | target 必填 | — | magic-api 地址 |
| `_WEB` | 否 | `/magic/web` | 管理端路径 |
| `_TOKEN` | 否* | — | 静态 token |
| `_USERNAME` / `_PASSWORD` | 否* | — | 账号密码（自动 login） |
| `_READONLY` | 否 | `false` | 只读模式 |
| `_PREFIX` | 否 | 空 | 接口路径前缀 |

**同事连接（每人按需选 target）**：
```bash
# 连生产
claude mcp add --transport http magic-api-prod http://部署机:3111/mcp/prod \
  --header "Authorization: Bearer 团队令牌"

# 连开发
claude mcp add --transport http magic-api-dev http://部署机:3111/mcp/dev \
  --header "Authorization: Bearer 团队令牌"
```

- target 名仅允许 `[A-Za-z0-9_-]+`，同一 session 锁定一个 target。
- 不设 `MAGIC_API_TARGETS` 时仍为单 target（legacy 模式），现有部署零改动。
- **stdio 不支持多 target**（无 path 路由），设了 `MAGIC_API_TARGETS` 又用 stdio 会启动报错。
- 全局 `MAGIC_API_ACCESS_TOKEN` 守卫所有 path；per-target 隔离由 URL 完成。

## 模式一：stdio（本地，个人用）

Claude 直接启动本地进程。

**Claude Code**
```bash
claude mcp add magic-api --scope user \
  -e MAGIC_API_BASE=http://your-magic-api-host:9999 \
  -e MAGIC_API_WEB=/your-app/magic/dev \
  -e MAGIC_API_USERNAME=your-username \
  -e MAGIC_API_PASSWORD=your-password \
  -- node /绝对路径/magic-api-mcp/dist/index.js
```

**Claude Desktop**（`claude_desktop_config.json`）
```json
{
  "mcpServers": {
    "magic-api": {
      "command": "node",
      "args": ["/绝对路径/magic-api-mcp/dist/index.js"],
      "env": {
        "MAGIC_API_BASE": "http://your-magic-api-host:9999",
        "MAGIC_API_WEB": "/your-app/magic/dev",
        "MAGIC_API_USERNAME": "your-username",
        "MAGIC_API_PASSWORD": "your-password"
      }
    }
  }
}
```

## 模式二：http（远程，团队共用）

在一台服务器（如内网）常驻运行，所有人连同一个地址。凭据集中在服务端，客户端无需知道 magic-api 密码。

**直接启动**
```bash
MAGIC_API_TRANSPORT=http \
MAGIC_API_HTTP_PORT=3111 \
MAGIC_API_ACCESS_TOKEN=团队令牌 \
MAGIC_API_BASE=http://your-magic-api-host:9999 \
MAGIC_API_WEB=/your-app/magic/dev \
MAGIC_API_USERNAME=your-username \
MAGIC_API_PASSWORD=your-password \
node dist/index.js
```

**常驻（pm2）**
```bash
pm2 start dist/index.js --name magic-api-mcp
pm2 save && pm2 startup
```

**Docker**
```bash
docker build -t magic-api-mcp .
docker run -d -p 3111:3111 \
  -e MAGIC_API_BASE=http://your-magic-api-host:9999 \
  -e MAGIC_API_WEB=/your-app/magic/dev \
  -e MAGIC_API_USERNAME=your-username -e MAGIC_API_PASSWORD=your-password \
  -e MAGIC_API_ACCESS_TOKEN=团队令牌 \
  magic-api-mcp
```

**同事的 Claude Code 连接**
```bash
claude mcp add --transport http magic-api http://部署机:3111/mcp \
  --header "Authorization: Bearer 团队令牌"
```

> http 模式为**无状态**（每个请求独立 transport），适合低频管理操作。**强烈建议设置 `MAGIC_API_ACCESS_TOKEN`**，否则任何能访问该端口的人都能操作 magic-api。

## 工具一览

- 接口：`list_apis` `get_api` `create_api` `update_api_script` `delete_api` `run_api`
- 分组：`list_groups` `create_group`
- 函数：`list_functions` `get_function`
- 数据源：`list_datasources`
- 知识：`magic_script_help` `search_code`

只读模式（`MAGIC_API_READONLY=true`）下，写工具被隐藏并在调用时拒绝。

## 冒烟测试

手动脚本（只读，对真实实例）：
```bash
MAGIC_API_BASE=... MAGIC_API_WEB=... MAGIC_API_USERNAME=... MAGIC_API_PASSWORD=... \
node scripts/smoke.mjs
```

或接进 Claude 后试：「列出所有接口分组，看看 getPrintData 的脚本」。

## 开发

```bash
npm test        # 单元 + 集成（73 测试）
npm run dev     # tsx 直跑（stdio）
npm run build
```
