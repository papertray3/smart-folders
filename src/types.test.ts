import { describe, expect, it } from "vitest";
import { SimpleRule, getRuleActions, normalizeRuleActions } from "./types";

function baseRule(): Omit<SimpleRule, "actions" | "action"> {
  return {
    id: "rule-1",
    name: "Legacy rule",
    enabled: true,
    folderPath: "Projects",
    scopeFolder: "Projects",
    condition: { type: "tag", operator: "has", value: "project" },
  };
}

describe("rule action compatibility", () => {
  it("migrates a legacy single action into actions[]", () => {
    const legacy: SimpleRule = {
      ...baseRule(),
      action: { type: "move-file", targetFolder: "Projects/Active" },
    };

    const normalized = normalizeRuleActions(legacy);
    expect(normalized.action).toBeUndefined();
    expect(normalized.actions).toEqual([{ type: "move-file", targetFolder: "Projects/Active" }]);
  });

  it("keeps an existing ordered action list when legacy data contains both shapes", () => {
    const rule: SimpleRule = {
      ...baseRule(),
      action: { type: "move-file", targetFolder: "Legacy" },
      actions: [{ type: "add-tag", tag: "current" }],
    };

    expect(normalizeRuleActions(rule).actions).toEqual([{ type: "add-tag", tag: "current" }]);
  });

  it("reads legacy actions without requiring migration first", () => {
    const legacy: SimpleRule = {
      ...baseRule(),
      action: { type: "add-tag", tag: "project" },
    };

    expect(getRuleActions(legacy)).toEqual([{ type: "add-tag", tag: "project" }]);
  });
});
