import { describe, expect, it } from "vitest";
import { getContextBoundaries, resolveContextBoundary } from "./context-boundary";
import { FolderPolicy } from "./types";

const policy = (hubPage?: string, contextBoundary = false): FolderPolicy => ({
  contentPolicy: "any",
  hubPage,
  contextBoundary,
});

describe("context boundaries", () => {
  const policies: Record<string, FolderPolicy> = {
    "Notes/Projects/smart-folders": policy("Notes/Projects/smart-folders/smart-folders.md", true),
    "Notes/Projects/smart-folders/00_Admin": policy("Notes/Projects/smart-folders/00_Admin/Admin.md"),
    "Notes/Projects/agent-client": policy("Notes/Projects/agent-client/agent-client.md", true),
    "Notes/Projects/no-hub": policy(undefined, true),
  };

  it("lists all enabled boundaries, with or without a hub page", () => {
    expect(getContextBoundaries(policies).map((boundary) => boundary.folderPath)).toEqual([
      "Notes/Projects/agent-client",
      "Notes/Projects/no-hub",
      "Notes/Projects/smart-folders",
    ]);
  });

  it("resolves a file or nested folder to its owning boundary", () => {
    expect(resolveContextBoundary("Notes/Projects/smart-folders/00_Admin/03-visual-ui.md", policies)?.folderPath)
      .toBe("Notes/Projects/smart-folders");
    expect(resolveContextBoundary("Notes/Projects/agent-client", policies)?.folderPath)
      .toBe("Notes/Projects/agent-client");
  });

  it("does not resolve paths outside every boundary", () => {
    expect(resolveContextBoundary("Notes/Reference/example.md", policies)).toBeUndefined();
  });

  it("resolves to the deepest boundary when boundaries are nested", () => {
    const nested = {
      Root: policy("Root/Root.md", true),
      "Root/Nested": policy("Root/Nested/Nested.md", true),
    };
    expect(resolveContextBoundary("Root/Nested/file.md", nested)?.folderPath).toBe("Root/Nested");
  });
});
