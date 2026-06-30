import { MagicClient } from "./client/magic-client.js";
import type { TargetConfig } from "./config.js";

export type TargetMode = "single" | "multi";

interface Entry {
  config: TargetConfig;
  promise?: Promise<MagicClient>;
}

/**
 * 后端注册表。single 模式仅有一个默认后端（legacy / stdio）；
 * multi 模式按 name 持有多个后端，懒创建 + 缓存 MagicClient。
 */
export class TargetRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly defaultKey = "__default__";

  private constructor(readonly mode: TargetMode) {}

  static forSingle(config: TargetConfig): TargetRegistry {
    const r = new TargetRegistry("single");
    r.entries.set(r.defaultKey, { config });
    return r;
  }

  static forMulti(targets: Map<string, TargetConfig>): TargetRegistry {
    const r = new TargetRegistry("multi");
    for (const [name, config] of targets) r.entries.set(name, { config });
    return r;
  }

  /** multi 模式下的 target 名列表（供错误提示）；single 模式返回 [] */
  targetNames(): string[] {
    if (this.mode !== "multi") return [];
    return [...this.entries.keys()];
  }

  /** /mcp（单服务 legacy）解析；multi 模式返回 null */
  resolveDefault(): Promise<MagicClient | null> {
    if (this.mode !== "single") return Promise.resolve(null);
    const entry = this.entries.get(this.defaultKey);
    return entry ? this.materialize(entry) : Promise.resolve(null);
  }

  /** /mcp/<name> 解析；未知或 single 模式返回 null */
  resolveByName(name: string): Promise<MagicClient | null> {
    if (this.mode !== "multi") return Promise.resolve(null);
    const entry = this.entries.get(name);
    return entry ? this.materialize(entry) : Promise.resolve(null);
  }

  /** 懒创建并 init()（登录）；缓存 promise，失败则清空以便下次重试 */
  private materialize(entry: Entry): Promise<MagicClient> {
    if (!entry.promise) {
      entry.promise = (async () => {
        const client = new MagicClient(entry.config);
        await client.init();
        return client;
      })();
      // 登录失败时丢弃缓存，下次请求重新尝试
      entry.promise.catch(() => {
        if (entry.promise) entry.promise = undefined;
      });
    }
    return entry.promise;
  }
}
