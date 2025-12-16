import { MetadataCache } from "obsidian";
import { RuleContext, SimpleRule, SingleCondition, isCompositeCondition } from "./types";

export class RuleEvaluator {
  constructor(private readonly metadata: MetadataCache) {}

  buildContext(file: RuleContext["file"]): RuleContext {
    const cache = this.metadata.getFileCache(file);
    const frontmatter = cache?.frontmatter ?? undefined;

    // Extract all tags (frontmatter and inline)
    const tags: string[] = [];

    if (cache?.tags) {
      cache.tags.forEach(tag => {
        // Tags from cache include the # prefix
        tags.push(tag.tag);
      });
    }
    if (frontmatter?.tags) {
      const fmTags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [frontmatter.tags];
      fmTags.forEach(tag => {
        const normalized = tag.startsWith('#') ? tag : `#${tag}`;
        if (!tags.includes(normalized)) {
          tags.push(normalized);
        }
      });
    }

    return { file, frontmatter, tags };
  }

  matches(rule: SimpleRule, context: RuleContext): boolean {
    if (!rule.enabled) return false;

    // Handle composite conditions (AND/OR)
    if (isCompositeCondition(rule.condition)) {
      const { operator, conditions } = rule.condition;

      if (operator === "AND") {
        // All conditions must be true
        return conditions.every(cond => this.evaluateSingleCondition(cond, context));
      } else {
        // At least one condition must be true
        return conditions.some(cond => this.evaluateSingleCondition(cond, context));
      }
    }

    // Handle single condition (backward compatible)
    return this.evaluateSingleCondition(rule.condition, context);
  }

  private evaluateSingleCondition(condition: SingleCondition, context: RuleContext): boolean {
    const { type, operator, field, value } = condition;

    // Handle legacy rules (backward compatibility)
    if ((type as any) === "frontmatter-equals" || (type === "frontmatter" && !operator)) {
      const fmVal = context.frontmatter?.[field || ""];
      if (fmVal === undefined) return false;
      if (Array.isArray(fmVal)) return fmVal.includes(value || "");
      return String(fmVal) === (value || "");
    }

    // Frontmatter conditions
    if (type === "frontmatter" && field) {
      const fmVal = context.frontmatter?.[field];

      switch (operator) {
        case "equals":
          if (fmVal === undefined) return false;
          if (Array.isArray(fmVal)) return fmVal.includes(value || "");
          return String(fmVal) === (value || "");

        case "not-equals":
          if (fmVal === undefined) return true;
          if (Array.isArray(fmVal)) return !fmVal.includes(value || "");
          return String(fmVal) !== (value || "");

        case "contains":
          if (fmVal === undefined) return false;
          if (Array.isArray(fmVal)) return fmVal.some(v => String(v).includes(value || ""));
          return String(fmVal).includes(value || "");

        case "not-contains":
          if (fmVal === undefined) return true;
          if (Array.isArray(fmVal)) return !fmVal.some(v => String(v).includes(value || ""));
          return !String(fmVal).includes(value || "");

        case "exists":
          return fmVal !== undefined;

        case "not-exists":
          return fmVal === undefined;
      }
    }

    // Tag conditions
    if (type === "tag") {
      const tagToCheck = value?.startsWith('#') ? value : `#${value || ""}`;

      switch (operator) {
        case "has":
          return context.tags.includes(tagToCheck);

        case "does-not-have":
          return !context.tags.includes(tagToCheck);
      }
    }

    return false;
  }
}
