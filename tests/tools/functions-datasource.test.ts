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
    const res = await listFunctionsTool.handler(client(), {} as any);
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
    const res = await listDatasourcesTool.handler(client(), {} as any);
    expect(res).toEqual([{ id: "d1", name: "主库", type: "datasource" }]);
  });
});
