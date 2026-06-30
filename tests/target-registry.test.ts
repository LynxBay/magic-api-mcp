import { describe, expect, it } from "vitest";
import { TargetRegistry } from "../src/target-registry.js";
import type { TargetConfig } from "../src/config.js";

const cfg = (over: Partial<TargetConfig> = {}): TargetConfig => ({
  baseUrl: "http://ma",
  webPath: "/magic/web",
  readonly: false,
  prefix: "",
  ...over,
});

describe("TargetRegistry — single mode", () => {
  it("reports single mode and no named targets", () => {
    const r = TargetRegistry.forSingle(cfg());
    expect(r.mode).toBe("single");
    expect(r.targetNames()).toEqual([]);
  });

  it("resolveDefault returns a client bound to the backend config", async () => {
    const r = TargetRegistry.forSingle(cfg({ baseUrl: "http://prod:9999", readonly: true }));
    const client = await r.resolveDefault();
    expect(client).not.toBeNull();
    expect(client!.getBase()).toBe("http://prod:9999");
    expect(client!.isReadonly()).toBe(true);
  });

  it("caches the client (same instance across calls)", async () => {
    const r = TargetRegistry.forSingle(cfg());
    const a = await r.resolveDefault();
    const b = await r.resolveDefault();
    expect(a).toBe(b);
  });

  it("resolveByName always returns null in single mode", async () => {
    const r = TargetRegistry.forSingle(cfg());
    expect(await r.resolveByName("anything")).toBeNull();
  });
});

describe("TargetRegistry — multi mode", () => {
  const targets = new Map<string, TargetConfig>([
    ["prod", cfg({ baseUrl: "http://prod:9999", readonly: true })],
    ["dev", cfg({ baseUrl: "http://dev:9999" })],
  ]);

  it("reports multi mode and the target names", () => {
    const r = TargetRegistry.forMulti(targets);
    expect(r.mode).toBe("multi");
    expect(r.targetNames()).toEqual(["prod", "dev"]);
  });

  it("resolveByName returns the right backend per target", async () => {
    const r = TargetRegistry.forMulti(targets);
    expect((await r.resolveByName("prod"))?.getBase()).toBe("http://prod:9999");
    expect((await r.resolveByName("dev"))?.getBase()).toBe("http://dev:9999");
  });

  it("resolveByName returns null for unknown target", async () => {
    const r = TargetRegistry.forMulti(targets);
    expect(await r.resolveByName("nope")).toBeNull();
  });

  it("resolveDefault returns null in multi mode", async () => {
    const r = TargetRegistry.forMulti(targets);
    expect(await r.resolveDefault()).toBeNull();
  });

  it("caches one client per target; different targets are different instances", async () => {
    const r = TargetRegistry.forMulti(targets);
    const p1 = await r.resolveByName("prod");
    const p2 = await r.resolveByName("prod");
    const d1 = await r.resolveByName("dev");
    expect(p1).toBe(p2);
    expect(p1).not.toBe(d1);
  });
});
