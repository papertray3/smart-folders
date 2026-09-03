import { describe, expect, it } from "vitest";
import { parseCustomJsRef, renderActionTemplate, resolveActionNotePath } from "./boundary-action-utils";
import { BoundaryAction } from "./types";

describe("resolveActionNotePath", () => {
  it("uses the action's own notePath when set", () => {
    const action: BoundaryAction = { type: "open-note", notePath: "Notes/Custom.md" };
    expect(resolveActionNotePath(action, { folderPath: "Notes/Projects/a", hubPage: "Notes/Projects/a/a.md" }))
      .toBe("Notes/Custom.md");
  });

  it("falls back to the boundary's hub page when notePath is unset", () => {
    const action: BoundaryAction = { type: "open-note" };
    expect(resolveActionNotePath(action, { folderPath: "Notes/Projects/a", hubPage: "Notes/Projects/a/a.md" }))
      .toBe("Notes/Projects/a/a.md");
  });

  it("returns undefined when neither is set", () => {
    const action: BoundaryAction = { type: "open-note" };
    expect(resolveActionNotePath(action, { folderPath: "Notes/Projects/a" })).toBeUndefined();
  });
});

describe("parseCustomJsRef", () => {
  it("splits ClassName.methodName on the first dot", () => {
    expect(parseCustomJsRef("MyClass.myMethod")).toEqual({ className: "MyClass", methodName: "myMethod" });
  });

  it("keeps everything after the first dot as the method name", () => {
    expect(parseCustomJsRef("MyClass.my.Method")).toEqual({ className: "MyClass", methodName: "my.Method" });
  });

  it("rejects malformed refs", () => {
    expect(parseCustomJsRef("NoDot")).toBeUndefined();
    expect(parseCustomJsRef(".methodOnly")).toBeUndefined();
    expect(parseCustomJsRef("ClassOnly.")).toBeUndefined();
  });
});

describe("renderActionTemplate", () => {
  const boundary = { folderPath: "Notes/Projects/smart-folders" };
  const previous = { folderPath: "Notes/Projects/agent-client" };
  const next = { folderPath: "Notes/Projects/LLM-Guide" };

  it("substitutes {{boundary}} with the firing boundary's folder name", () => {
    expect(renderActionTemplate("Entered {{boundary}}", { boundary })).toBe("Entered smart-folders");
  });

  it("substitutes {{previous}} and {{next}} when present", () => {
    expect(renderActionTemplate("{{previous}} -> {{boundary}}", { boundary, previous })).toBe("agent-client -> smart-folders");
    expect(renderActionTemplate("{{boundary}} -> {{next}}", { boundary, next })).toBe("smart-folders -> LLM-Guide");
  });

  it("leaves a token as literal text when its boundary isn't available", () => {
    expect(renderActionTemplate("from {{previous}}", { boundary })).toBe("from {{previous}}");
  });

  it("leaves unknown tokens untouched", () => {
    expect(renderActionTemplate("{{nonsense}}", { boundary })).toBe("{{nonsense}}");
  });

  it("uses the root label for the root boundary", () => {
    expect(renderActionTemplate("{{boundary}}", { boundary: { folderPath: "/" } })).toBe("/");
  });
});
