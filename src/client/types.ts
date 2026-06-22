export interface JsonBean<T> {
  code: number;
  message: string;
  data: T;
}

export interface Group {
  id: string;
  name: string;
  path: string;
  type: string;
  parentId: string;
  node?: string;
}

export interface ApiInfo {
  id: string | null;
  name: string;
  path: string;
  method: string;
  script: string;
  groupId: string;
  description?: string;
  parameters?: unknown[];
  options?: { name: string; value: unknown }[];
  headers?: unknown[];
  requestBody?: string;
  responseBody?: string;
}

export interface TreeNode<T = any> {
  node: T;
  children: TreeNode[];
}

export type ResourceTree = Record<string, TreeNode<Group>>;

export interface SearchResult {
  id: string;
  text: string;
  line: number;
}

export interface RunResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface TaskInfo {
  id: string | null;
  name: string;
  path: string;
  groupId: string;
  script: string;
  cron: string;
  enabled: boolean;
  description?: string;
}
