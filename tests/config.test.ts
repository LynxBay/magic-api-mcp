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
