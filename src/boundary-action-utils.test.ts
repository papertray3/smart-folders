import { describe, expect, it } from "vitest";
import { parseCustomJsRef, resolveActionNotePath } from "./boundary-action-utils";
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
