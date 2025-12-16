import { TFile } from "obsidian";

export type ConditionType = "frontmatter" | "tag";
export type ConditionOperator = "equals" | "not-equals" | "contains" | "not-contains" | "exists" | "not-exists";
export type TagOperator = "has" | "does-not-have";
export type LogicalOperator = "AND" | "OR";
export type ActionType = "move-file" | "quarantine" | "highlight" | "add-tag" | "remove-tag" | "set-frontmatter" | "remove-frontmatter";
export type ContentPolicy = "any" | "files-only" | "folders-only" | "locked";

// Simple condition (single check)
export interface SingleCondition {
  type: ConditionType;
  operator?: ConditionOperator | TagOperator;
  field?: string; // For frontmatter conditions
  value?: string; // For frontmatter/tag conditions
}

// Composite condition (multiple checks with AND/OR logic)
export interface CompositeCondition {
  operator: LogicalOperator; // "AND" | "OR"
  conditions: SingleCondition[];
}

// Rule condition can be either simple or composite
export type RuleCondition = SingleCondition | CompositeCondition;

// Type guard to check if a condition is composite
export function isCompositeCondition(condition: RuleCondition): condition is CompositeCondition {
  return 'operator' in condition &&
         (condition.operator === 'AND' || condition.operator === 'OR') &&
         'conditions' in condition;
}

export interface SimpleRule {
  id: string;
  name: string;
  enabled: boolean;
  folderPath: string; // Where the rule is defined/displayed in UI
  scopeFolder: string; // Where the rule searches for files ("/" = vault root)
  condition: RuleCondition;
  action: {
    type: ActionType;
    targetFolder?: string; // For move-file action
    tag?: string; // For add-tag/remove-tag actions
    field?: string; // For set-frontmatter/remove-frontmatter actions
    value?: string; // For set-frontmatter action
    lazyMatch?: boolean; // For move-file: skip if already in target folder tree
  };
}

export interface RuleContext {
  file: TFile;
  frontmatter: Record<string, any> | undefined;
  tags: string[]; // All tags (frontmatter and inline)
}

export interface Violation {
  path: string;
  reason: string; // "Content Policy" or rule name
  ruleId?: string; // Optional rule ID for highlight violations
}

export interface SmartFoldersSettings {
  enabled: boolean;
  auditLogEnabled: boolean;
  auditLogPath: string;
  auditEntriesPerFile: number;
  version: string;
  rules: SimpleRule[];
  inheritContentPolicy: boolean;
  defaultQuarantinePath: string;
  folderPolicies: Record<string, FolderPolicy>;
  autoMoveOnPolicyChange: boolean;
  ignoredFolders: string[];
}

export interface FolderPolicy {
  contentPolicy: ContentPolicy;
  quarantinePath?: string;
  exceptions?: string[]; // full paths allowed even if policy would block
  enabled?: boolean; // per-folder enable/disable
  disabledInheritedRules?: string[]; // rule IDs that are disabled for this folder
}

export const DEFAULT_SETTINGS: SmartFoldersSettings = {
  enabled: true,
  auditLogEnabled: false,
  auditLogPath: "_sf/logs",
  auditEntriesPerFile: 100,
  version: "0.1.0",
  rules: [],
  inheritContentPolicy: false,
  defaultQuarantinePath: "_sf/lost+found",
  folderPolicies: {},
  autoMoveOnPolicyChange: false,
  ignoredFolders: [],
};
