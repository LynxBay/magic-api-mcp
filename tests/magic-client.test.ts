import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import { MagicClient } from "../src/client/magic-client.js";
import type { Config } from "../src/config.js";
import { decrypt } from "../src/client/rot13.js";

const cfg = (over: Partial<Config> = {}): Config => ({
  baseUrl: "http://ma",
  webPath: "/magic/web",
  readonly: false,
  prefix: "",
  ...over,
});

describe("MagicClient.managementGet", () => {
  it("unwraps JsonBean.data on code===1", async () => {
    server.use(
      http.get("http://ma/magic/web/resource", () =>
        HttpResponse.json({ code: 1, message: "success", data: { ok: true } })
      )
    );
    const c = new MagicClient(cfg());
    expect(await c.managementGet("resource")).toEqual({ ok: true });
  });

  it("throws business error when code!==1", async () => {
    server.use(
      http.get("http://ma/magic/web/resource", () =>
        HttpResponse.json({ code: 0, message: "权限不足", data: null })
      )
    );
    const c = new MagicClient(cfg());
    await expect(c.managementGet("resource")).rejects.toThrow("权限不足");
  });

  it("injects Magic-Token header", async () => {
    let seen: string | null = null;
    server.use(
      http.get("http://ma/magic/web/resource", ({ request }) => {
        seen = request.headers.get("Magic-Token");
        return HttpResponse.json({ code: 1, message: "ok", data: 1 });
      })
    );
    const c = new MagicClient(cfg({ token: "tok" }));
    await c.managementGet("resource");
    expect(seen).toBe("tok");
  });
});

describe("MagicClient login flow", () => {
  it("logs in on init and stores token from header", async () => {
    let usedToken: string | null = null;
    server.use(
      http.post("http://ma/magic/web/login", () =>
        new HttpResponse(null, { headers: { "Magic-Token": "T1" } })
      ),
      http.get("http://ma/magic/web/resource", ({ request }) => {
        usedToken = request.headers.get("Magic-Token");
        return HttpResponse.json({ code: 1, message: "ok", data: {} });
      })
    );
    const c = new MagicClient(cfg({ username: "u", password: "p" }));
    await c.init();
    await c.managementGet("resource");
    expect(usedToken).toBe("T1");
  });

  it("retries login once on 401 then succeeds", async () => {
    let loginCount = 0;
    let resCount = 0;
    server.use(
      http.post("http://ma/magic/web/login", () => {
        loginCount++;
        return new HttpResponse(null, { headers: { "Magic-Token": "T2" } });
      }),
      http.get("http://ma/magic/web/resource", () => {
        resCount++;
        if (resCount === 1) return new HttpResponse(null, { status: 401 });
        return HttpResponse.json({ code: 1, message: "ok", data: {} });
      })
    );
    const c = new MagicClient(cfg({ username: "u", password: "p" }));
    await c.init();
    const data = await c.managementGet("resource");
    expect(data).toEqual({});
    expect(loginCount).toBe(2);
  });
});

describe("MagicClient.runApi", () => {
  it("calls the live endpoint and returns status/headers/body", async () => {
    server.use(
      http.get("http://ma/api/hello", () =>
        new HttpResponse("hi", { status: 200, headers: { "x-test": "1" } })
      )
    );
    const c = new MagicClient(cfg());
    const r = await c.runApi("/api/hello", { method: "GET" });
    expect(r.status).toBe(200);
    expect(r.body).toBe("hi");
    expect(r.headers["x-test"]).toBe("1");
  });
});

describe("MagicClient usePostForGet", () => {
  it("uses POST instead of GET when usePostForGet is true", async () => {
    let method = "";
    server.use(
      http.post("http://ma/magic/web/resource", ({ request }) => {
        method = request.method;
        return HttpResponse.json({ code: 1, message: "ok", data: { ok: true } });
      })
    );
    const c = new MagicClient(cfg({ usePostForGet: true }));
    const result = await c.managementGet("resource");
    expect(result).toEqual({ ok: true });
    expect(method).toBe("POST");
  });

  it("uses GET by default (usePostForGet omitted)", async () => {
    let method = "";
    server.use(
      http.get("http://ma/magic/web/resource", ({ request }) => {
        method = request.method;
        return HttpResponse.json({ code: 1, message: "ok", data: { ok: true } });
      })
    );
    const c = new MagicClient(cfg());
    await c.managementGet("resource");
    expect(method).toBe("GET");
  });
});

describe("MagicClient useEncrypt", () => {
  it("encrypts managementPost body with useEncrypt", async () => {
    let body = "";
    server.use(
      http.post("http://ma/magic/web/resource/file/api/save", async ({ request }) => {
        body = await request.text();
        return HttpResponse.json({ code: 1, message: "ok", data: "id" });
      })
    );
    const c = new MagicClient(cfg({ useEncrypt: true }));
    const result = await c.managementPost("resource/file/api/save", { name: "test", path: "/api" });
    expect(result).toBe("id");
    // body should be ROT13-encrypted, not plain JSON
    expect(body).not.toBe('{"name":"test","path":"/api"}');
    // verify round-trip by decrypting
    expect(decrypt(body)).toBe('{"name":"test","path":"/api"}');
  });

  it("does NOT encrypt managementPost body without useEncrypt", async () => {
    let body = "";
    server.use(
      http.post("http://ma/magic/web/resource/file/api/save", async ({ request }) => {
        body = await request.text();
        return HttpResponse.json({ code: 1, message: "ok", data: "id" });
      })
    );
    const c = new MagicClient(cfg());
    await c.managementPost("resource/file/api/save", { name: "test" });
    expect(body).toBe('{"name":"test"}');
  });

  it("does NOT encrypt on non-file-save paths even with useEncrypt", async () => {
    let body = "";
    server.use(
      http.post("http://ma/magic/web/resource/folder/save", async ({ request }) => {
        body = await request.text();
        return HttpResponse.json({ code: 1, message: "ok", data: "id" });
      })
    );
    const c = new MagicClient(cfg({ useEncrypt: true }));
    await c.managementPost("resource/folder/save", { name: "test" });
    expect(body).toBe('{"name":"test"}');
  });
});
