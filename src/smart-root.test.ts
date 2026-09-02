import { describe, expect, it } from "vitest";
import { findSmartFolderRoots, isIgnoredPath } from "./smart-root";

describe("Smart Folders roots", () => {
  it("returns the shallowest configured folder even when configured later", () => {
    expect(findSmartFolderRoots([
      "Notes/Projects/smart-folders",
      "Notes/Hopper",
      "Notes",
    ], [])).toEqual(["Notes"]);
  });

  it("preserves configuration order when there are multiple roots", () => {
    expect(findSmartFolderRoots([
      "Notes/Projects",
      "Archive",
      "Notes",
      "Archive/2025",
    ], [])).toEqual(["Archive", "Notes"]);
  });

  it("does not treat an ignored vault root as ignoring every descendant", () => {
    expect(findSmartFolderRoots(["/", "Notes", "Published"], [""]))
      .toEqual(["Notes", "Published"]);
  });

  it("removes configured roots inside an explicitly ignored folder", () => {
    expect(findSmartFolderRoots(["_kants/Admin", "Notes"], ["_kants"]))
      .toEqual(["Notes"]);
  });

  it("normalizes duplicate paths", () => {
    expect(findSmartFolderRoots(["/Notes/", "Notes", "Published"], []))
      .toEqual(["Notes", "Published"]);
  });

  it("matches ignored folders and their descendants", () => {
    expect(isIgnoredPath("_sf/lost+found", ["_sf"])).toBe(true);
    expect(isIgnoredPath("Notes", [""])).toBe(false);
  });
});
