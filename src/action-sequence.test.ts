import { describe, expect, it, vi } from "vitest";
import { runOrderedActions } from "./action-sequence";

describe("runOrderedActions", () => {
  it("awaits actions in order and carries context forward", async () => {
    const observed: string[] = [];
    const result = await runOrderedActions(["move", "tag", "frontmatter"], "start", async (action, index, context) => {
      observed.push(`${index}:${action}:${context}`);
      return `${context}>${action}`;
    });

    expect(observed).toEqual([
      "0:move:start",
      "1:tag:start>move",
      "2:frontmatter:start>move>tag",
    ]);
    expect(result).toBe("start>move>tag>frontmatter");
  });

  it("stops at the first failed action", async () => {
    const execute = vi.fn(async (action: string, _index: number, context: string) => {
      if (action === "tag") throw new Error("tag failed");
      return `${context}>${action}`;
    });

    await expect(runOrderedActions(["move", "tag", "frontmatter"], "start", execute)).rejects.toThrow("tag failed");
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
