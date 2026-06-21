import type { Config } from "../config.js";
import type { JsonBean, RunResult } from "./types.js";

export interface RunOptions {
  method: string;
  params?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
}

export class MagicClient {
  private token?: string;

  constructor(private readonly config: Config) {
    this.token = config.token;
  }

  getWebBase(): string {
    return `${this.config.baseUrl}${this.config.webPath}`;
  }

  getBase(): string {
    return this.config.baseUrl;
  }

  isReadonly(): boolean {
    return this.config.readonly;
  }

  /** 若配置了账号密码则登录换 token */
  async init(): Promise<void> {
    if (this.config.username && this.config.password) {
      await this.login();
    }
  }

  async login(): Promise<void> {
    const res = await fetch(`${this.getWebBase()}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: this.config.username!,
        password: this.config.password!,
      }),
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("magic-api login failed (auth rejected)");
    }
    const tok = res.headers.get("Magic-Token");
    if (tok) this.token = tok;
  }

  private authHeaders(): Record<string, string> {
    return this.token ? { "Magic-Token": this.token } : {};
  }

  /** 管理端 GET，返回 JsonBean.data */
  async managementGet<T = unknown>(path: string, params?: Record<string, unknown>): Promise<T> {
    const url = this.buildManagementUrl(path, params);
    return this.managementRequest<T>(url, { method: "GET" });
  }

  /** 管理端 POST，body 序列化为 JSON 原始流，返回 JsonBean.data */
  async managementPost<T = unknown>(
    path: string,
    body?: unknown,
    params?: Record<string, unknown>
  ): Promise<T> {
    const url = this.buildManagementUrl(path, params);
    const headers: Record<string, string> = {
      ...this.authHeaders(),
      "Content-Type": "application/json",
    };
    const init: RequestInit = {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    };
    return this.managementRequest<T>(url, init);
  }

  private async managementRequest<T>(url: string, init: RequestInit): Promise<T> {
    const merged: RequestInit = {
      ...init,
      headers: { ...this.authHeaders(), ...(init.headers as Record<string, string>) },
    };
    let res = await fetch(url, merged);
    if (res.status === 401 && this.canRefresh()) {
      await this.login();
      const retry: RequestInit = {
        ...merged,
        headers: { ...(merged.headers as Record<string, string>), ...this.authHeaders() },
      };
      res = await fetch(url, retry);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("magic-api auth failed (invalid or expired token)");
    }
    const bean = (await res.json()) as JsonBean<T>;
    if (bean.code !== 1) {
      throw new Error(bean.message || `magic-api error code=${bean.code}`);
    }
    return bean.data;
  }

  private canRefresh(): boolean {
    return !!(this.config.username && this.config.password);
  }

  private buildManagementUrl(path: string, params?: Record<string, unknown>): string {
    const base = `${this.getWebBase()}/${path.replace(/^\/+/, "")}`;
    if (!params) return base;
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) sp.set(k, String(v));
    }
    const qs = sp.toString();
    return qs ? `${base}?${qs}` : base;
  }

  /** 向真实接口发请求（被测接口的错误不算工具错误） */
  async runApi(runPath: string, opts: RunOptions): Promise<RunResult> {
    const path = runPath.startsWith("/") ? runPath : `/${runPath}`;
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.params ?? {})) {
      if (v !== undefined && v !== null) sp.set(k, String(v));
    }
    const qs = sp.toString();
    const url = `${this.getBase()}${path}${qs ? `?${qs}` : ""}`;
    const headers: Record<string, string> = { ...this.authHeaders(), ...(opts.headers ?? {}) };
    const init: RequestInit = {
      method: opts.method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    };
    const res = await fetch(url, init);
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => (outHeaders[k] = v));
    const text = await res.text();
    return { status: res.status, headers: outHeaders, body: text };
  }
}
