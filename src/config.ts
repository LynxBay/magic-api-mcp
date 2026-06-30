import { readFileSync } from "node:fs";

/** 单个 magic-api 后端的连接配置 */
export interface TargetConfig {
  baseUrl: string;
  webPath: string;
  token?: string;
  username?: string;
  password?: string;
  readonly: boolean;
  prefix: string;
  /** 部分旧版 magic-api 的 /resource 不接受 GET，设为 true 时 managementGet 改走 POST */
  usePostForGet?: boolean;
  /** magic-api 2.2.x 对 /resource/file/save 需要 ROT13(Base64(body)) 加密 */
  useEncrypt?: boolean;
}

/** MCP server 自身旋钮（与后端无关） */
export interface ServerConfig {
  transport: "stdio" | "http";
  httpPort: number;
  httpHost: string;
  accessToken?: string;
}

/** 完整配置：legacy 单服务模式下 = 后端 + server 旋钮的并集 */
export interface Config extends TargetConfig, ServerConfig {}

function env(key: string): string | undefined {
  return process.env[key];
}

function parseBool(v: string | undefined): boolean {
  return v === "true" || v === "1";
}

/** server 旋钮从不依赖后端，multi 模式下也能独立加载 */
export function loadServerConfig(): ServerConfig {
  return {
    transport: env("MAGIC_API_TRANSPORT") === "http" ? "http" : "stdio",
    httpPort: Number(env("MAGIC_API_HTTP_PORT") ?? 3111),
    httpHost: env("MAGIC_API_HTTP_HOST") ?? "0.0.0.0",
    accessToken: env("MAGIC_API_ACCESS_TOKEN"),
  };
}

export interface TargetsResult {
  mode: "single" | "multi";
  /** single 模式下的唯一后端；multi 模式下为 undefined */
  single?: TargetConfig;
  /** multi 模式下 name → 后端配置；single 模式下为空 map */
  targets: Map<string, TargetConfig>;
}

const TARGET_NAME_RE = /^[A-Za-z0-9_-]+$/;

function backend(
  base: string | undefined,
  webPath: string | undefined,
  token: string | undefined,
  username: string | undefined,
  password: string | undefined,
  readonly: string | undefined,
  prefix: string | undefined,
  usePostForGet?: boolean,
  useEncrypt?: boolean
): TargetConfig {
  return {
    baseUrl: (base ?? "").replace(/\/+$/, ""),
    webPath: webPath ?? "/magic/web",
    token,
    username,
    password,
    readonly: parseBool(readonly),
    prefix: (prefix ?? "").replace(/^\/+|\/+$/g, ""),
    usePostForGet,
    useEncrypt,
  };
}

/**
 * 解析后端注册表。
 * - 设了 MAGIC_API_TARGETS_FILE → multi：从 JSON 文件读取 { "<name>": { ... } } 映射。
 * - 设了 MAGIC_API_TARGETS → multi：按 MAGIC_API_TARGET_<NAME>_ 前缀逐个解析。
 * - 否则 → single（legacy）：从 MAGIC_API_BASE 等读取唯一后端。
 */
export function loadTargets(): TargetsResult {
  const file = env("MAGIC_API_TARGETS_FILE");
  if (file) {
    return loadFromJsonFile(file);
  }

  const list = env("MAGIC_API_TARGETS");
  if (list) {
    return loadFromEnvPrefixes(list);
  }

  return { mode: "single", targets: new Map(), single: singleTarget() };
}

function loadFromJsonFile(path: string): TargetsResult {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    throw new Error(`cannot read targets file: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON in targets file: ${path}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`targets file must be a JSON object: ${path}`);
  }
  const obj = parsed as Record<string, unknown>;
  const targets = new Map<string, TargetConfig>();
  for (const name of Object.keys(obj)) {
    if (!TARGET_NAME_RE.test(name)) {
      throw new Error(`invalid target name '${name}' in ${path} (allowed: A-Z a-z 0-9 _ -)`);
    }
    if (targets.has(name)) {
      throw new Error(`duplicate target name '${name}' in ${path}`);
    }
    const entry = obj[name] as Record<string, unknown> | null;
    if (!entry || typeof entry !== "object") {
      throw new Error(`target '${name}' in ${path} must be an object`);
    }
    const baseUrl = typeof entry.baseUrl === "string" ? entry.baseUrl : undefined;
    if (!baseUrl) {
      throw new Error(`target '${name}' in ${path} missing required field "baseUrl"`);
    }
    const webPath = typeof entry.webPath === "string" ? entry.webPath : undefined;
    const token = typeof entry.token === "string" ? entry.token : undefined;
    const username = typeof entry.username === "string" ? entry.username : undefined;
    const password = typeof entry.password === "string" ? entry.password : undefined;
    const readonly = entry.readonly !== undefined ? String(entry.readonly) : undefined;
    const prefix = typeof entry.prefix === "string" ? entry.prefix : undefined;
    const usePostForGet = typeof entry.usePostForGet === "boolean" ? entry.usePostForGet : undefined;
    const useEncrypt = typeof entry.useEncrypt === "boolean" ? entry.useEncrypt : undefined;

    targets.set(name, backend(baseUrl, webPath, token, username, password, readonly, prefix, usePostForGet, useEncrypt));
  }
  if (targets.size === 0) {
    throw new Error(`targets file contains no targets: ${path}`);
  }
  return { mode: "multi", targets };
}

function loadFromEnvPrefixes(list: string): TargetsResult {
  const targets = new Map<string, TargetConfig>();
  const seenEnvKeys = new Set<string>();
  for (const raw of list.split(",")) {
    const name = raw.trim();
    if (!name) continue;
    if (!TARGET_NAME_RE.test(name)) {
      throw new Error(`invalid target name '${name}' (allowed: A-Z a-z 0-9 _ -)`);
    }
    const envKey = name.toUpperCase();
    if (seenEnvKeys.has(envKey)) {
      throw new Error(`duplicate target '${name}' (env prefix MAGIC_API_TARGET_${envKey}_ already used)`);
    }
    seenEnvKeys.add(envKey);
    const prefix = `MAGIC_API_TARGET_${envKey}_`;
    const base = env(`${prefix}BASE`);
    if (!base) {
      throw new Error(`target '${name}' missing ${prefix}BASE`);
    }
    targets.set(
      name,
      backend(
        base,
        env(`${prefix}WEB`),
        env(`${prefix}TOKEN`),
        env(`${prefix}USERNAME`),
        env(`${prefix}PASSWORD`),
        env(`${prefix}READONLY`),
        env(`${prefix}PREFIX`),
        parseBool(env(`${prefix}USE_POST_FOR_GET`)) || undefined,
        parseBool(env(`${prefix}USE_ENCRYPT`)) || undefined
      )
    );
  }
  if (targets.size === 0) {
    throw new Error("MAGIC_API_TARGETS set but contained no targets");
  }
  return { mode: "multi", targets };
}

/** legacy 单后端：MAGIC_API_BASE 必填 */
function singleTarget(): TargetConfig {
  const baseUrl = env("MAGIC_API_BASE");
  if (!baseUrl) {
    throw new Error("MAGIC_API_BASE is required (e.g. http://localhost:9999)");
  }
  return backend(
    baseUrl,
    env("MAGIC_API_WEB"),
    env("MAGIC_API_TOKEN"),
    env("MAGIC_API_USERNAME"),
    env("MAGIC_API_PASSWORD"),
    env("MAGIC_API_READONLY"),
    env("MAGIC_API_PREFIX")
  );
}
