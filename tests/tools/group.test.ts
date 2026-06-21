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
    const res = await listGroupsTool.handler(client(), {} as any);
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
