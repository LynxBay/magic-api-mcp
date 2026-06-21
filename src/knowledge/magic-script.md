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
