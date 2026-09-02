import { describe, expect, it } from "vitest";
import { BoundaryStack } from "./boundary-state";
import { ContextBoundary } from "./context-boundary";

const boundary = (folderPath: string): ContextBoundary => ({ folderPath });

describe("BoundaryStack", () => {
  it("starts empty with no candidate", () => {
    const stack = new BoundaryStack();
    expect(stack.getStack()).toEqual([]);
    expect(stack.getCandidate()).toBeUndefined();
  });

  it("opening a file outside every boundary leaves the stack untouched", () => {
    const stack = new BoundaryStack();
    stack.handleDetection(boundary("Notes/Projects/a"));
    stack.commitCandidate();

    stack.handleDetection(undefined);
    expect(stack.getStack().map((b) => b.folderPath)).toEqual(["Notes/Projects/a"]);
    expect(stack.getCandidate()).toBeUndefined();
  });

  it("detecting a descendant of the current top raises a push candidate", () => {
    const stack = new BoundaryStack();
    stack.handleDetection(boundary("Notes/Projects/a"));
    stack.commitCandidate();

    stack.handleDetection(boundary("Notes/Projects/a/b"));
    expect(stack.getCandidate()).toEqual({ boundary: boundary("Notes/Projects/a/b"), kind: "push" });
    expect(stack.getStack().map((b) => b.folderPath)).toEqual(["Notes/Projects/a"]); // not committed yet

    stack.commitCandidate();
    expect(stack.getStack().map((b) => b.folderPath)).toEqual(["Notes/Projects/a", "Notes/Projects/a/b"]);
    expect(stack.getCandidate()).toBeUndefined();
  });

  it("detecting an unrelated boundary raises a replace candidate that unwinds the whole stack on commit", () => {
    const stack = new BoundaryStack();
    stack.handleDetection(boundary("Notes/Projects/a"));
    stack.commitCandidate();
    stack.handleDetection(boundary("Notes/Projects/a/b"));
    stack.commitCandidate();

    stack.handleDetection(boundary("Notes/Projects/z"));
    expect(stack.getCandidate()).toEqual({ boundary: boundary("Notes/Projects/z"), kind: "replace" });

    stack.commitCandidate();
    expect(stack.getStack().map((b) => b.folderPath)).toEqual(["Notes/Projects/z"]);
  });

  it("navigating back to a level already on the stack pops with no candidate", () => {
    const stack = new BoundaryStack();
    stack.handleDetection(boundary("Notes/Projects/a"));
    stack.commitCandidate();
    stack.handleDetection(boundary("Notes/Projects/a/b"));
    stack.commitCandidate();
    stack.handleDetection(boundary("Notes/Projects/a/b/c"));
    stack.commitCandidate();

    stack.handleDetection(boundary("Notes/Projects/a"));
    expect(stack.getCandidate()).toBeUndefined();
    expect(stack.getStack().map((b) => b.folderPath)).toEqual(["Notes/Projects/a"]);
  });

  it("navigating within the current top is a no-op", () => {
    const stack = new BoundaryStack();
    stack.handleDetection(boundary("Notes/Projects/a"));
    stack.commitCandidate();

    stack.handleDetection(boundary("Notes/Projects/a"));
    expect(stack.getCandidate()).toBeUndefined();
    expect(stack.getStack().map((b) => b.folderPath)).toEqual(["Notes/Projects/a"]);
  });

  it("dismissCandidate clears the candidate without touching the stack", () => {
    const stack = new BoundaryStack();
    stack.handleDetection(boundary("Notes/Projects/a"));
    stack.commitCandidate();
    stack.handleDetection(boundary("Notes/Projects/a/b"));

    stack.dismissCandidate();
    expect(stack.getCandidate()).toBeUndefined();
    expect(stack.getStack().map((b) => b.folderPath)).toEqual(["Notes/Projects/a"]);
  });

  it("commitCandidate is a no-op when there is no candidate", () => {
    const stack = new BoundaryStack();
    stack.commitCandidate();
    expect(stack.getStack()).toEqual([]);
  });

  it("popTo truncates directly to an already-committed level and clears any candidate", () => {
    const stack = new BoundaryStack();
    stack.handleDetection(boundary("Notes/Projects/a"));
    stack.commitCandidate();
    stack.handleDetection(boundary("Notes/Projects/a/b"));
    stack.commitCandidate();
    stack.handleDetection(boundary("Notes/Projects/a/b/c"));
    stack.commitCandidate();
    stack.handleDetection(boundary("Notes/Projects/z")); // leaves a pending replace candidate

    stack.popTo("Notes/Projects/a");
    expect(stack.getStack().map((b) => b.folderPath)).toEqual(["Notes/Projects/a"]);
    expect(stack.getCandidate()).toBeUndefined();
  });

  it("popTo is a no-op when the path isn't on the stack", () => {
    const stack = new BoundaryStack();
    stack.handleDetection(boundary("Notes/Projects/a"));
    stack.commitCandidate();

    stack.popTo("Notes/Projects/unrelated");
    expect(stack.getStack().map((b) => b.folderPath)).toEqual(["Notes/Projects/a"]);
  });
});
