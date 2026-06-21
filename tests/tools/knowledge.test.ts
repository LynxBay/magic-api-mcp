import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../setup";
import { MagicClient } from "../../src/client/magic-client.js";
import type { Config } from "../../src/config.js";
import { magicScriptHelpTool, searchCodeTool } from "../../src/tools/knowledge.js";

const cfg: Config = { baseUrl: "http://ma", webPath: "/magic/web", readonly: false, prefix: "" };

describe("magic_script_help", () => {
  it("returns the section matching the topic", async () => {
    const res = await magicScriptHelpTool.handler(new MagicClient(cfg), { topic: "db" });
    expect(typeof res).toBe("string");
    expect(res).toContain("db.select");
  });
  it("returns full doc overview when topic not found", async () => {
    const res = await magicScriptHelpTool.handler(new MagicClient(cfg), { topic: "不存在的主题xyz" });
    expect(res).toContain("magic-script");
  });
});

describe("search_code", () => {
  it("proxies to /search", async () => {
    server.use(
      http.get("http://ma/magic/web/search", ({ request }) => {
        expect(new URL(request.url).searchParams.get("keyword")).toBe("page");
        return HttpResponse.json({ code: 1, message: "ok", data: [{ id: "a1", text: "db.page", line: 3 }] });
      })
    );
    const res = await searchCodeTool.handler(new MagicClient(cfg), { keyword: "page" });
    expect(res).toEqual([{ id: "a1", text: "db.page", line: 3 }]);
  });
});
