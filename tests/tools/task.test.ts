import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../setup";
import { MagicClient } from "../../src/client/magic-client.js";
import type { Config } from "../../src/config.js";
import { listTasksTool, getTaskTool, createTaskTool } from "../../src/tools/task.js";

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
