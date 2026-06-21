import { describe, expect, it } from "vitest";
import type { ApiInfo, ResourceTree } from "../src/client/types.js";
import {
  buildGroupPathIndex,
  collectFiles,
  resolveApiId,
  resolveGroupId,
  resolveRunPath,
  joinPath,
} from "../src/resolver/resource-resolver.js";

// 构造一棵 api 树：分组「用户」(id=g1, path=user) 下有接口 list (path=/list, method=GET)
function apiTree(): ResourceTree {
  const api: ApiInfo = {
    id: "a1", name: "用户列表", path: "/list", method: "GET",
    script: "return 1", groupId: "g1",
  };
  return {
    api: {
      node: { id: "0", name: "root", path: "", type: "api", parentId: "" },
      children: [
        {
          node: { id: "g1", name: "用户", path: "user", type: "api", parentId: "0" },
          children: [{ node: api, children: [] }],
        },
      ],
    },
  };
}

describe("collectFiles", () => {
  it("flattens api files from the tree", () => {
    const files = collectFiles(apiTree(), "api");
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("用户列表");
  });
});

describe("resolveApiId", () => {
  it("resolves by name", () => {
    expect(resolveApiId(apiTree(), { name: "用户列表" })).toBe("a1");
  });
  it("resolves by path+method", () => {
    expect(resolveApiId(apiTree(), { path: "/user/list", method: "GET" })).toBe("a1");
  });
  it("throws when ambiguous by name", () => {
    const t = apiTree();
    (t.api.children[0].children[0].node as ApiInfo).name = "用户列表";
    t.api.children[0].children.push({
      node: { ...(t.api.children[0].children[0].node as ApiInfo), id: "a2" },
      children: [],
    });
    expect(() => resolveApiId(t, { name: "用户列表" })).toThrow(/多个|ambiguous/i);
  });
});

describe("resolveGroupId", () => {
  it("finds group by name", () => {
    expect(resolveGroupId(apiTree(), "用户", "api")).toBe("g1");
  });
  it("returns undefined when missing", () => {
    expect(resolveGroupId(apiTree(), "不存在", "api")).toBeUndefined();
  });
});

describe("runPath", () => {
  it("builds full run path from prefix + group + api path", () => {
    const tree = apiTree();
    const index = buildGroupPathIndex(tree);
    const api = collectFiles(tree, "api")[0];
    expect(resolveRunPath(api, "api", index)).toBe("/api/user/list");
    expect(resolveRunPath(api, "", index)).toBe("/user/list");
  });
});

describe("joinPath", () => {
  it("normalizes slashes", () => {
    expect(joinPath("a", "b")).toBe("/a/b");
    expect(joinPath("/a/", "/b/")).toBe("/a/b");
    expect(joinPath("")).toBe("");
  });
});
