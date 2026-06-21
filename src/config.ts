export interface Config {
  baseUrl: string;
  webPath: string;
  token?: string;
  username?: string;
  password?: string;
  readonly: boolean;
  prefix: string;
  transport: "stdio" | "http";
  httpPort: number;
  httpHost: string;
  accessToken?: string;
}

function env(key: string): string | undefined {
  return process.env[key];
}

function parseBool(v: string | undefined): boolean {
  return v === "true" || v === "1";
}

export function loadConfig(): Config {
  const baseUrl = env("MAGIC_API_BASE");
  if (!baseUrl) {
    throw new Error("MAGIC_API_BASE is required (e.g. http://localhost:9999)");
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    webPath: env("MAGIC_API_WEB") ?? "/magic/web",
    token: env("MAGIC_API_TOKEN"),
    username: env("MAGIC_API_USERNAME"),
    password: env("MAGIC_API_PASSWORD"),
    readonly: parseBool(env("MAGIC_API_READONLY")),
    prefix: (env("MAGIC_API_PREFIX") ?? "").replace(/^\/+|\/+$/g, ""),
    transport: env("MAGIC_API_TRANSPORT") === "http" ? "http" : "stdio",
    httpPort: Number(env("MAGIC_API_HTTP_PORT") ?? 3111),
    httpHost: env("MAGIC_API_HTTP_HOST") ?? "0.0.0.0",
    accessToken: env("MAGIC_API_ACCESS_TOKEN"),
  };
}
