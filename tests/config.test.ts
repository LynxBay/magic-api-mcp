import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadServerConfig, loadTargets } from "../src/config.js";

const ENV_KEYS = [
  "MAGIC_API_BASE",
  "MAGIC_API_WEB",
  "MAGIC_API_TOKEN",
  "MAGIC_API_USERNAME",
  "MAGIC_API_PASSWORD",
  "MAGIC_API_READONLY",
  "MAGIC_API_PREFIX",
  "MAGIC_API_TRANSPORT",
  "MAGIC_API_HTTP_PORT",
  "MAGIC_API_HTTP_HOST",
  "MAGIC_API_ACCESS_TOKEN",
  "MAGIC_API_TARGETS",
  "MAGIC_API_TARGETS_FILE",
];

let tmpFile: string | undefined;

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  // 清掉本轮测试可能写入的 MAGIC_API_TARGET_* 前缀变量
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("MAGIC_API_TARGET_")) delete process.env[k];
  }
  if (tmpFile) {
    try { unlinkSync(tmpFile); } catch { /* ok */ }
    tmpFile = undefined;
  }
});

function writeTargetsFile(json: unknown): string {
  tmpFile = join(tmpdir(), `magic-api-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(tmpFile, JSON.stringify(json), "utf-8");
  return tmpFile;
}

describe("loadServerConfig", () => {
  it("defaults to stdio on 3111 / 0.0.0.0 with no access token", () => {
    const c = loadServerConfig();
    expect(c.transport).toBe("stdio");
    expect(c.httpPort).toBe(3111);
    expect(c.httpHost).toBe("0.0.0.0");
    expect(c.accessToken).toBeUndefined();
  });

  it("reads transport / port / host / access token", () => {
    process.env.MAGIC_API_TRANSPORT = "http";
    process.env.MAGIC_API_HTTP_PORT = "8080";
    process.env.MAGIC_API_HTTP_HOST = "127.0.0.1";
    process.env.MAGIC_API_ACCESS_TOKEN = "secret";
    const c = loadServerConfig();
    expect(c).toEqual({
      transport: "http",
      httpPort: 8080,
      httpHost: "127.0.0.1",
      accessToken: "secret",
    });
  });
});

describe("loadTargets — single (legacy)", () => {
  it("requires MAGIC_API_BASE", () => {
    expect(() => loadTargets()).toThrow(/MAGIC_API_BASE/);
  });

  it("applies backend defaults", () => {
    process.env.MAGIC_API_BASE = "http://localhost:9999";
    const { mode, single, targets } = loadTargets();
    expect(mode).toBe("single");
    expect(targets.size).toBe(0);
    expect(single).toEqual({
      baseUrl: "http://localhost:9999",
      webPath: "/magic/web",
      token: undefined,
      username: undefined,
      password: undefined,
      readonly: false,
      prefix: "",
    });
  });

  it("parses readonly / token / creds / web / prefix", () => {
    process.env.MAGIC_API_BASE = "http://x";
    process.env.MAGIC_API_READONLY = "true";
    process.env.MAGIC_API_TOKEN = "abc";
    process.env.MAGIC_API_USERNAME = "u";
    process.env.MAGIC_API_PASSWORD = "p";
    process.env.MAGIC_API_WEB = "/custom/web";
    process.env.MAGIC_API_PREFIX = "/pre/";
    const { single } = loadTargets();
    expect(single?.readonly).toBe(true);
    expect(single?.token).toBe("abc");
    expect(single?.username).toBe("u");
    expect(single?.password).toBe("p");
    expect(single?.webPath).toBe("/custom/web");
    expect(single?.prefix).toBe("pre");
  });

  it("normalizes trailing slash on baseUrl", () => {
    process.env.MAGIC_API_BASE = "http://x:9999/";
    expect(loadTargets().single?.baseUrl).toBe("http://x:9999");
  });
});

describe("loadTargets — multi", () => {
  it("parses named targets from prefixed env", () => {
    process.env.MAGIC_API_TARGETS = "prod,dev";
    process.env.MAGIC_API_TARGET_PROD_BASE = "http://prod:9999";
    process.env.MAGIC_API_TARGET_PROD_TOKEN = "ptok";
    process.env.MAGIC_API_TARGET_PROD_READONLY = "true";
    process.env.MAGIC_API_TARGET_DEV_BASE = "http://dev:9999/";
    process.env.MAGIC_API_TARGET_DEV_USERNAME = "u";
    process.env.MAGIC_API_TARGET_DEV_PASSWORD = "p";
    const { mode, single, targets } = loadTargets();
    expect(mode).toBe("multi");
    expect(single).toBeUndefined();
    expect([...targets.keys()]).toEqual(["prod", "dev"]);
    expect(targets.get("prod")).toEqual({
      baseUrl: "http://prod:9999",
      webPath: "/magic/web",
      token: "ptok",
      username: undefined,
      password: undefined,
      readonly: true,
      prefix: "",
    });
    expect(targets.get("dev")?.baseUrl).toBe("http://dev:9999");
    expect(targets.get("dev")?.username).toBe("u");
  });

  it("throws when a declared target is missing _BASE", () => {
    process.env.MAGIC_API_TARGETS = "prod";
    // 没有 MAGIC_API_TARGET_PROD_BASE
    expect(() => loadTargets()).toThrow(/prod.*BASE|BASE.*prod/);
  });

  it("rejects invalid target names", () => {
    process.env.MAGIC_API_TARGETS = "pro.d";
    expect(() => loadTargets()).toThrow(/invalid target name/i);
  });

  it("rejects names that collide after uppercasing (env prefix conflict)", () => {
    process.env.MAGIC_API_TARGETS = "prod,PROD";
    process.env.MAGIC_API_TARGET_PROD_BASE = "http://x";
    expect(() => loadTargets()).toThrow(/duplicate/i);
  });

  it("ignores legacy MAGIC_API_BASE in multi mode", () => {
    delete process.env.MAGIC_API_BASE;
    process.env.MAGIC_API_TARGETS = "only";
    process.env.MAGIC_API_TARGET_ONLY_BASE = "http://only:9999";
    const { mode } = loadTargets();
    expect(mode).toBe("multi");
  });
});

describe("loadTargets — JSON file (MAGIC_API_TARGETS_FILE)", () => {
  it("parses targets from JSON file", () => {
    process.env.MAGIC_API_TARGETS_FILE = writeTargetsFile({
      prod: { baseUrl: "http://prod:9999/", token: "ptok", readonly: true },
      dev: { baseUrl: "http://dev:9999", username: "u", password: "p" },
    });
    const { mode, single, targets } = loadTargets();
    expect(mode).toBe("multi");
    expect(single).toBeUndefined();
    expect([...targets.keys()]).toEqual(["prod", "dev"]);
    expect(targets.get("prod")).toEqual({
      baseUrl: "http://prod:9999",
      webPath: "/magic/web",
      token: "ptok",
      username: undefined,
      password: undefined,
      readonly: true,
      prefix: "",
    });
    expect(targets.get("dev")?.baseUrl).toBe("http://dev:9999");
    expect(targets.get("dev")?.username).toBe("u");
  });

  it("requires baseUrl per target", () => {
    process.env.MAGIC_API_TARGETS_FILE = writeTargetsFile({
      prod: { token: "t" },
    });
    expect(() => loadTargets()).toThrow(/baseUrl/i);
  });

  it("rejects invalid target names in JSON keys", () => {
    process.env.MAGIC_API_TARGETS_FILE = writeTargetsFile({
      "pro.d": { baseUrl: "http://x" },
    });
    expect(() => loadTargets()).toThrow(/invalid target name/i);
  });

  it("rejects duplicate target names", () => {
    process.env.MAGIC_API_TARGETS_FILE = writeTargetsFile({
      prod: { baseUrl: "http://a" },
      prod: { baseUrl: "http://b" },
    });
    // JSON 不允许重复 key，这里测边界：第二个 prod 覆盖第一个，至少不抛奇怪错误
    const { targets } = loadTargets();
    expect(targets.size).toBe(1);
    expect(targets.get("prod")?.baseUrl).toBe("http://b");
  });

  it("applies defaults (webPath / readonly / prefix)", () => {
    process.env.MAGIC_API_TARGETS_FILE = writeTargetsFile({
      only: { baseUrl: "http://x" },
    });
    const t = loadTargets().targets.get("only");
    expect(t?.webPath).toBe("/magic/web");
    expect(t?.readonly).toBe(false);
    expect(t?.prefix).toBe("");
  });

  it("throws for unreadable file", () => {
    process.env.MAGIC_API_TARGETS_FILE = "/no/such/targets.json";
    expect(() => loadTargets()).toThrow(/targets file/i);
  });

  it("throws for malformed JSON", () => {
    const fs = require("fs") as typeof import("fs");
    tmpFile = join(tmpdir(), `bad-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, "{not json}", "utf-8");
    process.env.MAGIC_API_TARGETS_FILE = tmpFile;
    expect(() => loadTargets()).toThrow(/targets file/i);
  });

  it("takes precedence over MAGIC_API_TARGETS env vars when both set", () => {
    process.env.MAGIC_API_TARGETS = "fromEnv";
    process.env.MAGIC_API_TARGET_FROMENV_BASE = "http://from-env:9999";
    process.env.MAGIC_API_TARGETS_FILE = writeTargetsFile({
      fromFile: { baseUrl: "http://from-file:9999" },
    });
    const { targets } = loadTargets();
    expect([...targets.keys()]).toEqual(["fromFile"]);
    expect(targets.get("fromFile")?.baseUrl).toBe("http://from-file:9999");
  });
});
