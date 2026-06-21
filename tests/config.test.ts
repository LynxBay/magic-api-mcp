import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

afterEach(() => {
  delete process.env.MAGIC_API_BASE;
  delete process.env.MAGIC_API_WEB;
  delete process.env.MAGIC_API_TOKEN;
  delete process.env.MAGIC_API_USERNAME;
  delete process.env.MAGIC_API_PASSWORD;
  delete process.env.MAGIC_API_READONLY;
  delete process.env.MAGIC_API_PREFIX;
  delete process.env.MAGIC_API_TRANSPORT;
  delete process.env.MAGIC_API_HTTP_PORT;
  delete process.env.MAGIC_API_HTTP_HOST;
  delete process.env.MAGIC_API_ACCESS_TOKEN;
});

describe("loadConfig", () => {
  it("uses defaults and requires base", () => {
    delete process.env.MAGIC_API_BASE;
    expect(() => loadConfig()).toThrow(/MAGIC_API_BASE/);
  });

  it("applies defaults", () => {
    process.env.MAGIC_API_BASE = "http://localhost:9999";
    const c = loadConfig();
    expect(c.baseUrl).toBe("http://localhost:9999");
    expect(c.webPath).toBe("/magic/web");
    expect(c.readonly).toBe(false);
    expect(c.prefix).toBe("");
    expect(c.token).toBeUndefined();
  });

  it("parses readonly flag and token", () => {
    process.env.MAGIC_API_BASE = "http://x";
    process.env.MAGIC_API_READONLY = "true";
    process.env.MAGIC_API_TOKEN = "abc";
    const c = loadConfig();
    expect(c.readonly).toBe(true);
    expect(c.token).toBe("abc");
  });

  it("normalizes trailing slash on baseUrl", () => {
    process.env.MAGIC_API_BASE = "http://x:9999/";
    const c = loadConfig();
    expect(c.baseUrl).toBe("http://x:9999");
  });
});

describe("loadConfig transport & http", () => {
  it("defaults to stdio transport", () => {
    process.env.MAGIC_API_BASE = "http://x";
    const c = loadConfig();
    expect(c.transport).toBe("stdio");
    expect(c.httpPort).toBe(3111);
    expect(c.httpHost).toBe("0.0.0.0");
    expect(c.accessToken).toBeUndefined();
  });
  it("enables http transport and reads port/host/token", () => {
    process.env.MAGIC_API_BASE = "http://x";
    process.env.MAGIC_API_TRANSPORT = "http";
    process.env.MAGIC_API_HTTP_PORT = "8080";
    process.env.MAGIC_API_HTTP_HOST = "127.0.0.1";
    process.env.MAGIC_API_ACCESS_TOKEN = "secret";
    const c = loadConfig();
    expect(c.transport).toBe("http");
    expect(c.httpPort).toBe(8080);
    expect(c.httpHost).toBe("127.0.0.1");
    expect(c.accessToken).toBe("secret");
  });
});
