import { describe, expect, it } from "vitest";
import { allTools, isWriteTool } from "../../src/tools/registry.js";

describe("registry", () => {
  it("exposes the full tool set", () => {
    const names = allTools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "create_api", "create_group", "delete_api", "get_api", "get_function",
        "list_apis", "list_datasources", "list_functions", "list_groups",
        "magic_script_help", "run_api", "search_code", "update_api_script",
      ].sort()
    );
  });
  it("marks write tools", () => {
    expect(isWriteTool("create_api")).toBe(true);
    expect(isWriteTool("delete_api")).toBe(true);
    expect(isWriteTool("update_api_script")).toBe(true);
    expect(isWriteTool("create_group")).toBe(true);
    expect(isWriteTool("list_apis")).toBe(false);
    expect(isWriteTool("run_api")).toBe(false);
  });
});
