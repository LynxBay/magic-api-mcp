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
      http.get("http://ma/user/list", () =>
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
