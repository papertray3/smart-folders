import { describe, expect, it } from "vitest";
import { disambiguateBoundaryLabels, getBoundaryLabel } from "./boundary-labels";

const boundary = (folderPath: string) => ({ folderPath });

describe("disambiguateBoundaryLabels", () => {
  it("uses just the folder name when there's no collision", () => {
    const boundaries = [boundary("Notes/Projects/LLM-Guide"), boundary("Notes/Projects/agent-client")];
    const labels = disambiguateBoundaryLabels(boundaries);
    expect(labels.get("Notes/Projects/LLM-Guide")).toBe("LLM-Guide");
    expect(labels.get("Notes/Projects/agent-client")).toBe("agent-client");
  });

  it("extends colliding entries with just enough parent context to disambiguate", () => {
    const boundaries = [boundary("Notes/ProjectA/Drafts"), boundary("Notes/ProjectB/Drafts")];
    const labels = disambiguateBoundaryLabels(boundaries);
    expect(labels.get("Notes/ProjectA/Drafts")).toBe("ProjectA/Drafts");
    expect(labels.get("Notes/ProjectB/Drafts")).toBe("ProjectB/Drafts");
  });

  it("does not extend non-colliding entries just because something else collides", () => {
    const boundaries = [boundary("Notes/ProjectA/Drafts"), boundary("Notes/ProjectB/Drafts"), boundary("Notes/Unique")];
    const labels = disambiguateBoundaryLabels(boundaries);
    expect(labels.get("Notes/Unique")).toBe("Unique");
  });

  it("keeps extending until unique when a shallow collision remains", () => {
    const boundaries = [boundary("Notes/A/X/Drafts"), boundary("Notes/B/X/Drafts")];
    const labels = disambiguateBoundaryLabels(boundaries);
    expect(labels.get("Notes/A/X/Drafts")).toBe("A/X/Drafts");
    expect(labels.get("Notes/B/X/Drafts")).toBe("B/X/Drafts");
  });

  it("falls all the way back to the full path when nesting alone can't disambiguate", () => {
    // Same leaf name nested at different depths under otherwise-identical parent names is a pathological
    // case, but the loop must still terminate at the full path rather than looping forever.
    const boundaries = [boundary("A/B"), boundary("X/A/B")];
    const labels = disambiguateBoundaryLabels(boundaries);
    expect(labels.get("A/B")).toBe("A/B");
    expect(labels.get("X/A/B")).toBe("X/A/B");
  });

  it("handles the root boundary", () => {
    const labels = disambiguateBoundaryLabels([boundary("/")]);
    expect(labels.get("/")).toBe("/");
  });
});

describe("getBoundaryLabel", () => {
  it("resolves a single boundary's label from the full set", () => {
    const boundaries = [boundary("Notes/ProjectA/Drafts"), boundary("Notes/ProjectB/Drafts")];
    expect(getBoundaryLabel("Notes/ProjectA/Drafts", boundaries)).toBe("ProjectA/Drafts");
  });

  it("falls back to the raw path if it isn't in the given set", () => {
    expect(getBoundaryLabel("Notes/Missing", [])).toBe("Notes/Missing");
  });
});
