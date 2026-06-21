// 手动冒烟：对真实 magic-api 实例跑只读工具链。
// 用法：MAGIC_API_BASE=... MAGIC_API_WEB=... MAGIC_API_USERNAME=... MAGIC_API_PASSWORD=... node scripts/smoke.mjs
if (!process.env.MAGIC_API_BASE || !process.env.MAGIC_API_USERNAME || !process.env.MAGIC_API_PASSWORD) {
  console.error("请通过环境变量设置 MAGIC_API_BASE / MAGIC_API_WEB / MAGIC_API_USERNAME / MAGIC_API_PASSWORD");
  process.exit(1);
}

const { loadConfig } = await import("../dist/config.js");
const { MagicClient } = await import("../dist/client/magic-client.js");
const { listApisTool, getApiTool } = await import("../dist/tools/api.js");
const { listGroupsTool } = await import("../dist/tools/group.js");
const { listFunctionsTool } = await import("../dist/tools/functions.js");
const { listDatasourcesTool } = await import("../dist/tools/datasource.js");

const client = new MagicClient(loadConfig());
await client.init();
console.log("web base:", client.getWebBase());

console.log("groups:", (await listGroupsTool.handler(client, {})).length);
const apis = await listApisTool.handler(client, {});
console.log("apis:", apis.length);
console.log("functions:", (await listFunctionsTool.handler(client, {})).length);
console.log("datasources:", (await listDatasourcesTool.handler(client, {})).length);

if (apis[0]) {
  console.log("sample api:", apis[0]);
  const detail = await getApiTool.handler(client, { ref: apis[0].id });
  console.log("sample script (first 160 chars):", String(detail.script ?? "").slice(0, 160).replace(/\n/g, " "));
}
console.log("SMOKE OK");
