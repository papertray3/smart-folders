import { normalizePath, Notice, Plugin, TAbstractFile, TFile, TFolder, Vault } from "obsidian";
import { RuleEvaluator } from "./rule-evaluator";
import { ContentPolicy, FolderPolicy, RuleAction, SimpleRule, Violation, getRuleActions } from "./types";
import { AuditLogger } from "./audit-logger";
import { runOrderedActions } from "./action-sequence";

type SettingsProvider = () => {
  rules: SimpleRule[];
  enabled: boolean;
  inheritContentPolicy: boolean;
  defaultQuarantinePath: string;
  folderPolicies: Record<string, FolderPolicy>;
  autoMoveOnPolicyChange: boolean;
  auditLogEnabled: boolean;
  auditLogPath: string;
  auditEntriesPerFile: number;
  ignoredFolders: string[];
};

interface ActionExecutionContext {
  file: TFile;
  originalPath: string;
  currentPath: string;
}

interface ActionExecutionResult {
  context: ActionExecutionContext;
  details: string;
}

export class SmartFoldersManager {
  private evaluator: RuleEvaluator;
  private auditLogger: AuditLogger;
  private recentReroutes = new Map<string, number>(); // file path -> timestamp ms
  private lastViolations = new Map<string, Violation[]>(); // folder path -> violations (policy + highlight)
  private lastPolicyType = new Map<string, ContentPolicy>(); // folder path -> last policy type
  private pendingCreates = new Map<string, number>(); // file path -> timestamp of create event
  private activeActionFiles = new WeakSet<TFile>();
  private recentlyCompletedActionFiles = new WeakMap<TFile, number>();

  constructor(private plugin: Plugin, private readonly settings: SettingsProvider) {
    this.evaluator = new RuleEvaluator(plugin.app.metadataCache);
    this.auditLogger = new AuditLogger(plugin.app.vault, settings);
  }

  async start(): Promise<void> {
    this.registerEvents();
  }

  async stop(): Promise<void> {
    // Events are auto-cleaned up via registerEvent in the plugin; nothing additional here yet.
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private registerEvents() {
    const app = this.plugin.app;
    this.plugin.registerEvent(app.vault.on("create", (file) => this.processMaybe(file, "create")));
    this.plugin.registerEvent(app.vault.on("modify", (file) => this.processMaybe(file, "modify")));
    this.plugin.registerEvent(app.vault.on("rename", (file) => this.processMaybe(file, "rename")));
    this.plugin.registerEvent(app.metadataCache.on("changed", (file) => this.processMaybe(file, "frontmatter")));
  }

  private processMaybe(file: TAbstractFile, trigger: string) {
    if (file instanceof TFile) {
      if (this.activeActionFiles.has(file)) return;
      const completedAt = this.recentlyCompletedActionFiles.get(file);
      if (completedAt && Date.now() - completedAt < 750) return;
    }

    const debugMsg = (msg: string) => {
      this.auditLogger.log({
        timestamp: new Date().toISOString(),
        operation: "debug",
        filePath: file.path,
        details: msg
      }).catch(e => console.error("Audit log failed:", e));
    };

    debugMsg(`processMaybe called: trigger="${trigger}", path="${file.path}"`);

    // Skip audit log files to prevent recursive logging
    const auditPath = normalizePath(this.settings().auditLogPath);
    if (normalizePath(file.path).startsWith(auditPath)) {
      debugMsg(`Skipping (audit log): ${file.path}`);
      return;
    }

    // Skip ignored folders and their subfolders
    const ignoredFolders = this.settings().ignoredFolders;
    const normalizedPath = normalizePath(file.path);
    for (const ignored of ignoredFolders) {
      const normalizedIgnored = normalizePath(ignored);
      if (normalizedPath === normalizedIgnored || normalizedPath.startsWith(normalizedIgnored + "/")) {
        debugMsg(`Skipping (ignored folder): ${file.path}`);
        return;
      }
    }

    // Handle race condition: on "create", mark file as pending and wait for frontmatter to be parsed
    if (trigger === "create" && file instanceof TFile) {
      debugMsg(`CREATE event for: ${file.path}`);
      this.pendingCreates.set(file.path, Date.now());
      debugMsg(`Marked as pending, waiting for frontmatter parse...`);
      // Don't process immediately - wait for metadataCache.changed event
      return;
    }

    // Also defer MODIFY events for recently created files (Templater fires modify before frontmatter is parsed)
    if (trigger === "modify" && file instanceof TFile) {
      const createTime = this.pendingCreates.get(file.path);
      if (createTime) {
        debugMsg(`MODIFY event for pending file: ${file.path}, deferring...`);
        // Don't process - still waiting for frontmatter
        return;
      }
    }

    // On frontmatter change, check if this was a recently created file
    if (trigger === "frontmatter" && file instanceof TFile) {
      const createTime = this.pendingCreates.get(file.path);
      const cache = this.plugin.app.metadataCache.getFileCache(file);
      const fileClass = cache?.frontmatter?.fileClass;
      const hasFrontmatter = cache?.frontmatter !== undefined;
      debugMsg(`FRONTMATTER event for: ${file.path}, pending=${!!createTime}, fileClass="${fileClass || 'none'}", hasFrontmatter=${hasFrontmatter}`);
      if (createTime) {
        // Only process if frontmatter parsing is complete (cache has frontmatter object, even if empty)
        // The first frontmatter event may fire before parsing is complete (frontmatter is undefined)
        if (hasFrontmatter) {
          debugMsg(`Processing deferred create, fileClass="${fileClass || 'none'}"`);
          this.pendingCreates.delete(file.path);
          // Process with trigger set to "create" so audit logs show correct event
          this.processEntry(file, "create").catch((err) => console.error("Smart Folders: process error", err));
        } else {
          debugMsg(`Frontmatter not parsed yet (cache.frontmatter is undefined), waiting for next frontmatter event...`);
        }
        return;
      }
    }

    // Per-folder enabled check happens in enforcePlacement
    debugMsg(`Calling processEntry with trigger="${trigger}" for: ${file.path}`);
    this.processEntry(file, trigger).catch((err) => console.error("Smart Folders: process error", err));
  }

  private async processEntry(file: TAbstractFile, trigger: string): Promise<void> {
    if (file instanceof TFolder) {
      const parentPath = file.parent?.path ?? "/";
      await this.enforcePlacement(file, parentPath, trigger);
      return;
    }
    if (!(file instanceof TFile)) return;
    const parentPath = file.parent?.path ?? "/";
    await this.enforcePlacement(file, parentPath, trigger);
    await this.processFile(file, trigger);
  }

  async processFile(file: TFile, _trigger: string): Promise<void> {
    if (this.activeActionFiles.has(file)) return;

    const { rules, folderPolicies } = this.settings();
    if (!rules?.length) return;

    const fileFolder = normalizePath(file.parent?.path ?? "/");
    const folderPolicy = folderPolicies[fileFolder];
    const folderEnabled = folderPolicy?.enabled ?? true;

    // If folder is disabled, skip all rules (both local and inherited)
    if (!folderEnabled) {
      return;
    }

    const disabledInheritedRules = folderPolicy?.disabledInheritedRules ?? [];

    const conditionContext = this.evaluator.buildContext(file);
    const applicable = rules.filter((r) => this.inScope(file.path, r.scopeFolder));
    let executionContext: ActionExecutionContext = {
      file,
      originalPath: file.path,
      currentPath: file.path,
    };

    this.activeActionFiles.add(file);
    try {
      for (const rule of applicable) {
        // Skip if this is an inherited rule that's been disabled for this folder
        if (normalizePath(rule.scopeFolder) !== fileFolder && disabledInheritedRules.includes(rule.id)) {
          continue;
        }

        if (!this.evaluator.matches(rule, conditionContext)) continue;

        await this.auditLogger.log({
          timestamp: new Date().toISOString(),
          operation: "rule-match",
          filePath: executionContext.currentPath,
          ruleName: rule.name,
          details: `Rule matched: ${rule.name}`,
        });

        const actions = getRuleActions(rule);
        executionContext = await runOrderedActions(actions, executionContext, async (action, index, currentContext) => {
          try {
            const result = await this.executeAction(rule, action, currentContext);
            await this.auditLogger.log({
              timestamp: new Date().toISOString(),
              operation: "rule-action",
              filePath: result.context.currentPath,
              ruleName: rule.name,
              details: `Action ${index + 1}/${actions.length}: ${result.details}`,
            });
            return result.context;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.auditLogger.log({
              timestamp: new Date().toISOString(),
              operation: "rule-action",
              filePath: currentContext.currentPath,
              ruleName: rule.name,
              details: `Action ${index + 1}/${actions.length} failed: ${message}`,
            });
            new Notice(`Smart Folders: "${rule.name}" stopped at action ${index + 1}: ${message}`);
            throw error;
          }
        });

        // Execute all matching rules (not stop on first).
        // Conditions retain the pre-action snapshot for this processing pass.
      }
    } finally {
      this.activeActionFiles.delete(file);
      this.recentlyCompletedActionFiles.set(file, Date.now());
    }
  }

  private async executeAction(
    rule: SimpleRule,
    action: RuleAction,
    context: ActionExecutionContext,
  ): Promise<ActionExecutionResult> {
    const file = context.file;
    switch (action.type) {
      case "move-file":
        await this.executeMove(rule, action, file);
        return {
          context: { ...context, file, currentPath: file.path },
          details: `Moved to ${action.targetFolder}`,
        };

      case "quarantine":
        const quarantinePath = await this.executeQuarantine(file);
        return {
          context: { ...context, file, currentPath: file.path },
          details: `Quarantined to ${quarantinePath}`,
        };

      case "highlight":
        await this.executeHighlight(rule, file);
        return { context, details: `Highlighted: ${rule.name}` };

      case "add-tag":
        await this.executeAddTag(action, file);
        return { context, details: `Added tag ${action.tag}` };

      case "remove-tag":
        await this.executeRemoveTag(action, file);
        return { context, details: `Removed tag ${action.tag}` };

      case "set-frontmatter":
        await this.executeSetFrontmatter(action, file);
        return { context, details: `Set frontmatter ${action.field} = ${action.value}` };

      case "remove-frontmatter":
        await this.executeRemoveFrontmatter(action, file);
        return { context, details: `Removed frontmatter ${action.field}` };

      default:
        throw new Error(`Unknown action type: ${(action as RuleAction).type}`);
    }
  }

  private async executeMove(rule: SimpleRule, action: RuleAction, file: TFile): Promise<void> {
    if (!action.targetFolder) return;
    let targetFolder = action.targetFolder.replace(/\\/g, "/");

    // Resolve relative paths (starting with ./) relative to the rule's scope folder
    if (targetFolder.startsWith("./")) {
      const scopeFolder = normalizePath(rule.scopeFolder || "/");
      const relativePath = targetFolder.slice(2); // Remove "./"
      targetFolder = scopeFolder === "/" ? relativePath : `${scopeFolder}/${relativePath}`;
    }

    targetFolder = normalizePath(targetFolder);

    // Lazy match: skip if file is already in target folder or any subfolder
    if (action.lazyMatch) {
      const currentFolder = normalizePath(file.parent?.path ?? "/");
      if (currentFolder === targetFolder || currentFolder.startsWith(targetFolder + "/")) {
        return; // Already in target hierarchy, skip move
      }
    }

    const targetPolicy = this.getEffectivePolicy(targetFolder);

    if (this.violatesPolicy(file, targetPolicy.contentPolicy)) {
      const quarantine = this.getQuarantinePath(targetFolder, targetPolicy);
      await this.ensureFolder(this.plugin.app.vault, quarantine);
      await this.reroute(file, quarantine, "Policy violation");
      return;
    }

    const vault = this.plugin.app.vault;
    await this.ensureFolder(vault, targetFolder);

    const targetPath = normalizePath(`${targetFolder}/${file.name}`);
    if (targetPath === file.path) return;
    await vault.rename(file, targetPath);
  }

  private async executeAddTag(action: RuleAction, file: TFile): Promise<void> {
    if (!action.tag) return;
    const tag = action.tag.startsWith('#') ? action.tag.slice(1) : action.tag;

    await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
      if (!fm.tags) {
        fm.tags = [];
      } else if (!Array.isArray(fm.tags)) {
        fm.tags = [fm.tags];
      }
      if (!fm.tags.includes(tag)) {
        fm.tags.push(tag);
      }
    });
  }

  private async executeRemoveTag(action: RuleAction, file: TFile): Promise<void> {
    if (!action.tag) return;
    const tag = action.tag.startsWith('#') ? action.tag.slice(1) : action.tag;

    await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
      if (Array.isArray(fm.tags)) {
        fm.tags = fm.tags.filter((t: string) => t !== tag);
        if (fm.tags.length === 0) {
          delete fm.tags;
        }
      } else if (fm.tags === tag) {
        delete fm.tags;
      }
    });
  }

  private async executeSetFrontmatter(action: RuleAction, file: TFile): Promise<void> {
    if (!action.field) return;
    const field = action.field;
    const value = action.value || "";

    await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
      fm[field] = value;
    });
  }

  private async executeRemoveFrontmatter(action: RuleAction, file: TFile): Promise<void> {
    if (!action.field) return;
    const field = action.field;

    await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
      delete fm[field];
    });
  }

  private async executeQuarantine(file: TFile): Promise<string> {
    const fileFolder = normalizePath(file.parent?.path ?? "/");
    const policy = this.getEffectivePolicy(fileFolder);
    const quarantinePath = this.getQuarantinePath(fileFolder, policy);

    await this.reroute(file, quarantinePath, "Quarantined by rule");

    return quarantinePath;
  }

  private async executeHighlight(rule: SimpleRule, file: TFile): Promise<void> {
    // Highlight action doesn't modify the file, just flags it as a violation
    const ruleFolder = normalizePath(rule.folderPath);

    // Check if this file is an exception - if so, don't highlight it
    const exceptions = this.getExceptions(ruleFolder);
    const isException = exceptions.includes(normalizePath(file.path));
    if (isException) {
      await this.auditLogger.log({
        timestamp: new Date().toISOString(),
        operation: "debug",
        filePath: file.path,
        folderPath: ruleFolder,
        ruleName: rule.name,
        details: `Skipping highlight: ${file.path} is an exception in folder ${ruleFolder}`
      });
      return;
    }

    const existing = this.lastViolations.get(ruleFolder) ?? [];

    // Check if this file is already flagged by this rule
    const alreadyFlagged = existing.some(v => v.path === file.path && v.ruleId === rule.id);
    if (alreadyFlagged) return;

    // Add violation to the list for the RULE's folder, not the file's folder
    existing.push({
      path: file.path,
      reason: rule.name,
      ruleId: rule.id
    });

    this.lastViolations.set(ruleFolder, existing);

    // Log to audit
    await this.auditLogger.log({
      timestamp: new Date().toISOString(),
      operation: "debug",
      filePath: file.path,
      folderPath: ruleFolder,
      ruleName: rule.name,
      details: `Highlight violation added: ${file.path} flagged in folder ${ruleFolder} by rule "${rule.name}"`
    });
  }

  private async ensureFolder(vault: Vault, folderPath: string) {
    const path = normalizePath(folderPath);
    if (await vault.adapter.exists(path)) return;
    await vault.createFolder(path);
  }

  private inScope(filePath: string, scopeFolder: string): boolean {
    const scope = normalizePath(scopeFolder || "/");
    if (scope === "/") return true;
    const normalizedFile = normalizePath(filePath);
    return normalizedFile === scope || normalizedFile.startsWith(scope + "/");
  }

  getEffectivePolicy(folderPath: string): FolderPolicy {
    const path = normalizePath(folderPath || "/");
    const { folderPolicies, inheritContentPolicy, defaultQuarantinePath } = this.settings();
    const direct = folderPolicies[path];

    // If folder has direct policy, use it but cascade quarantine path if not set
    if (direct) {
      let effectiveQuarantinePath: string;

      // If quarantine path is set, resolve it relative to this folder
      if (direct.quarantinePath) {
        effectiveQuarantinePath = this.resolveRelativePath(direct.quarantinePath, path);
      } else {
        // Otherwise, inherit from parent
        effectiveQuarantinePath = this.getInheritedQuarantinePath(path) ?? defaultQuarantinePath;
      }

      return {
        contentPolicy: direct.contentPolicy,
        quarantinePath: effectiveQuarantinePath,
        exceptions: direct.exceptions ?? [],
        enabled: direct.enabled ?? true,
      };
    }

    // If no direct policy and inheritance disabled, use defaults
    if (!inheritContentPolicy) {
      const inheritedQuarantinePath = this.getInheritedQuarantinePath(path) ?? defaultQuarantinePath;
      return { contentPolicy: "any", quarantinePath: inheritedQuarantinePath, exceptions: [], enabled: true };
    }

    // Look up parent hierarchy for inherited policy
    const parts = path.split("/").filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const candidate = normalizePath("/" + parts.slice(0, i + 1).join("/"));
      const policy = folderPolicies[candidate];
      if (policy) {
        let inheritedQuarantinePath: string;
        if (policy.quarantinePath) {
          inheritedQuarantinePath = this.resolveRelativePath(policy.quarantinePath, candidate);
        } else {
          inheritedQuarantinePath = this.getInheritedQuarantinePath(candidate) ?? defaultQuarantinePath;
        }
        return {
          contentPolicy: policy.contentPolicy,
          quarantinePath: inheritedQuarantinePath,
          exceptions: policy.exceptions ?? [],
          enabled: policy.enabled ?? true,
        };
      }
    }
    return { contentPolicy: "any", quarantinePath: defaultQuarantinePath, exceptions: [], enabled: true };
  }

  private resolveRelativePath(path: string, baseFolder: string): string {
    if (!path.startsWith("./") && !path.startsWith("../")) {
      return path; // Not a relative path
    }

    const base = normalizePath(baseFolder || "/");
    const parts = base === "/" ? [] : base.split("/").filter(Boolean);

    // Process the relative path
    const pathParts = path.split("/");
    for (const part of pathParts) {
      if (part === "..") {
        parts.pop(); // Go up one level
      } else if (part === ".") {
        // Stay at current level, do nothing
      } else if (part) {
        parts.push(part); // Add the path component
      }
    }

    return parts.length === 0 ? "/" : parts.join("/");
  }

  private getInheritedQuarantinePath(folderPath: string): string | undefined {
    const path = normalizePath(folderPath || "/");
    const { folderPolicies } = this.settings();

    // Walk up parent hierarchy to find quarantine path
    const parts = path.split("/").filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const candidate = normalizePath("/" + parts.slice(0, i).join("/"));
      if (candidate === "") continue; // Skip empty path
      const policy = folderPolicies[candidate];
      if (policy?.quarantinePath) {
        // Resolve relative paths relative to where they were defined
        return this.resolveRelativePath(policy.quarantinePath, candidate);
      }
    }

    // Check root
    const rootPolicy = folderPolicies["/"];
    if (rootPolicy?.quarantinePath) {
      return this.resolveRelativePath(rootPolicy.quarantinePath, "/");
    }

    return undefined;
  }

  async handlePolicyChange(folderPath: string, forceMove = false): Promise<{ violations: number; moved: number }> {
    const policy = this.getEffectivePolicy(folderPath);
    const key = normalizePath(folderPath);
    const previousPolicyType = this.lastPolicyType.get(key);
    const currentPolicyType = policy.contentPolicy;

    this.pruneExceptions(folderPath);

    // Clear exceptions when the policy TYPE changes
    // Exceptions should only persist for "locked" policy or when staying on the same policy type
    const policyTypeChanged = previousPolicyType !== undefined && previousPolicyType !== currentPolicyType;
    const shouldClearExceptions = policyTypeChanged && currentPolicyType !== "locked";

    if (shouldClearExceptions) {
      const policies = this.settings().folderPolicies;
      if (policies[key]?.exceptions) {
        policies[key].exceptions = [];
      }
    }

    // Track the current policy type for future changes
    this.lastPolicyType.set(key, currentPolicyType);

    // Only seed exceptions when FIRST changing TO "locked" policy
    if (policy.contentPolicy === "locked" && previousPolicyType !== "locked") {
      await this.seedExceptionsForLocked(folderPath);
    }
    const policyViolations = this.findViolations(folderPath, policy);
    const violations: Violation[] = policyViolations.map(file => ({
      path: file.path,
      reason: "Content Policy"
    }));
    this.lastViolations.set(normalizePath(folderPath), violations);

    if (policyViolations.length === 0) return { violations: 0, moved: 0 };

    if (!forceMove && !this.settings().autoMoveOnPolicyChange) {
      return { violations: policyViolations.length, moved: 0 };
    }

    let moved = 0;
    const quarantine = this.getQuarantinePath(folderPath, policy);
    for (const file of policyViolations) {
      await this.reroute(file, quarantine, `Policy violation (${policy.contentPolicy}) on ${folderPath}`);
      moved++;
    }
    this.lastViolations.set(normalizePath(folderPath), []);
    return { violations: policyViolations.length, moved };
  }

  getStoredViolations(folderPath: string): Violation[] {
    return this.lastViolations.get(normalizePath(folderPath)) ?? [];
  }

  clearHighlightViolations(folderPath: string): void {
    const key = normalizePath(folderPath);
    const existing = this.lastViolations.get(key) ?? [];
    // Keep only content policy violations, remove highlight violations
    const contentPolicyOnly = existing.filter(v => v.reason === "Content Policy");
    this.lastViolations.set(key, contentPolicyOnly);
  }

  removeHighlightViolation(folderPath: string, filePath: string, ruleId?: string): void {
    const key = normalizePath(folderPath);
    const existing = this.lastViolations.get(key) ?? [];
    // Remove the specific violation
    const updated = existing.filter(v => {
      if (v.path !== filePath) return true; // Keep violations for other files
      if (v.reason === "Content Policy") return true; // Keep content policy violations
      if (ruleId && v.ruleId !== ruleId) return true; // Keep violations from other rules
      return false; // Remove this specific highlight violation
    });
    this.lastViolations.set(key, updated);
  }

  async logDebug(folderPath: string, details: string): Promise<void> {
    await this.auditLogger.log({
      timestamp: new Date().toISOString(),
      operation: "debug",
      filePath: folderPath,
      folderPath: folderPath,
      details: details
    });
  }

  async rerouteByPath(path: string, policyOverride?: FolderPolicy): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!file) throw new Error("File not found");
    const policy = policyOverride ?? this.getEffectivePolicy(file.parent?.path ?? "/");
    const quarantine = this.getQuarantinePath(file.parent?.path ?? "/", policy);
    await this.reroute(file, quarantine, `Policy violation (${policy.contentPolicy})`);
  }

  async movePath(path: string, targetFolder: string): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile || file instanceof TFolder)) return;
    await this.ensureFolder(this.plugin.app.vault, targetFolder);
    const name = file.name;
    const dest = normalizePath(`${targetFolder}/${name}`);
    await this.plugin.app.vault.rename(file, dest);
  }

  async deletePath(path: string): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!file) return;
    await this.plugin.app.vault.delete(file, true);
  }

  async restoreFromQuarantine(filePath: string, quarantinePath: string): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) throw new Error("File not found");

    // Calculate original path by removing quarantine prefix
    // e.g., "_sf/lost+found/Notes/Projects/LLM-Guide/Testing.md" → "Notes/Projects/LLM-Guide/Testing.md"
    const normalizedQuarantine = normalizePath(quarantinePath);
    const normalizedFilePath = normalizePath(filePath);

    if (!normalizedFilePath.startsWith(normalizedQuarantine + "/")) {
      throw new Error("File is not in quarantine folder");
    }

    const originalPath = normalizedFilePath.substring(normalizedQuarantine.length + 1);

    // Ensure parent folder exists
    const parentPath = originalPath.substring(0, originalPath.lastIndexOf("/"));
    if (parentPath) {
      await this.ensureFolder(this.plugin.app.vault, parentPath);
    }

    // Check if destination already exists
    if (await this.plugin.app.vault.adapter.exists(originalPath)) {
      throw new Error(`Cannot restore: ${originalPath} already exists`);
    }

    // Move file back to original location
    await this.plugin.app.vault.rename(file, originalPath);
    new Notice(`Restored ${file.name} to ${originalPath}`);
  }

  private pruneExceptions(folderPath: string) {
    const policies = this.settings().folderPolicies;
    const key = normalizePath(folderPath);
    const policy = policies[key];
    if (!policy?.exceptions?.length) return;
    policy.exceptions = policy.exceptions.filter((p) => normalizePath(p).startsWith(key + "/") || normalizePath(p) === key);
  }

  private violatesPolicy(file: TAbstractFile, policy: ContentPolicy, exceptions: string[] = []): boolean {
    if (policy === "any") return false;
    const norm = normalizePath(file.path);
    if (exceptions.map(normalizePath).includes(norm)) return false;
    const isFile = file instanceof TFile;
    const isFolder = file instanceof TFolder;
    if (policy === "locked") return true;
    if (policy === "files-only") return isFolder;
    if (policy === "folders-only") return isFile;
    return false;
  }

  private findViolations(folderPath: string, policy: FolderPolicy): TAbstractFile[] {
    const folder = this.plugin.app.vault.getAbstractFileByPath(normalizePath(folderPath));
    if (!(folder instanceof TFolder)) return [];
    const violations: TAbstractFile[] = [];
    const exc = (policy.exceptions ?? []).map(normalizePath);
    for (const child of folder.children) {
      if (this.violatesPolicy(child, policy.contentPolicy, exc)) {
        violations.push(child);
      }
    }
    return violations;
  }

  private getQuarantinePath(_targetFolder: string, policy: FolderPolicy): string {
    const base = policy.quarantinePath ?? this.settings().defaultQuarantinePath;
    return normalizePath(base || "/lost+found");
  }

  private async reroute(file: TAbstractFile, quarantineFolder: string, reason: string) {
    const now = Date.now();
    const key = file.path;
    const last = this.recentReroutes.get(key) ?? 0;
    if (now - last < 500) return; // debounce duplicate reroutes
    this.recentReroutes.set(key, now);

    // If already inside quarantine, skip to avoid churn
    const normalizedQuarantine = normalizePath(quarantineFolder);
    if (normalizePath(file.path).startsWith(normalizedQuarantine)) return;

    const vault = this.plugin.app.vault;

    // Preserve the original path structure in quarantine
    // e.g., "Notes/Projects/LLM-Guide/Testing.md" → "_sf/lost+found/Notes/Projects/LLM-Guide/Testing.md"
    const originalPath = file.path;
    let dest = normalizePath(`${quarantineFolder}/${originalPath}`);

    // Ensure parent folders exist
    const destParentPath = dest.substring(0, dest.lastIndexOf("/"));
    await this.ensureFolder(vault, destParentPath);

    // Handle filename conflicts with counter
    let counter = 2;
    while (await vault.adapter.exists(dest)) {
      const ext = file instanceof TFile ? `.${file.extension}` : "";
      const baseName = file instanceof TFile ? file.basename : file.name;
      const parentPath = dest.substring(0, dest.lastIndexOf("/"));
      const attemptName = `${baseName} (${counter})${ext}`;
      dest = normalizePath(`${parentPath}/${attemptName}`);
      counter++;
    }
    await vault.rename(file, dest);
    new Notice(`Smart Folders: ${reason}; moved to ${dest}`);
  }

  private async enforcePlacement(file: TAbstractFile, containerPath: string, _trigger: string) {
    const policy = this.getEffectivePolicy(containerPath);
    // Check if folder policy is enabled (default to enabled if not set)
    if (policy.enabled === false) return;

    if (!this.violatesPolicy(file, policy.contentPolicy, policy.exceptions)) {
      // Don't log routine passes - only log violations
      return;
    }

    await this.auditLogger.log({
      timestamp: new Date().toISOString(),
      operation: "policy-violation",
      filePath: file.path,
      folderPath: containerPath,
      details: `Violated ${policy.contentPolicy} policy - quarantining to ${this.getQuarantinePath(containerPath, policy)}`,
    });

    const quarantine = this.getQuarantinePath(containerPath, policy);
    await this.reroute(file, quarantine, `Policy violation (${policy.contentPolicy}) on ${containerPath}`);
  }

  private async seedExceptionsForLocked(folderPath: string) {
    const folder = this.plugin.app.vault.getAbstractFileByPath(normalizePath(folderPath));
    if (!(folder instanceof TFolder)) return;
    const policies = this.settings().folderPolicies;
    const key = normalizePath(folderPath);
    if (!policies[key]) policies[key] = { contentPolicy: "locked", exceptions: [] } as FolderPolicy;
    const list = policies[key].exceptions ?? [];
    folder.children.forEach((child) => {
      const norm = normalizePath(child.path);
      if (!list.includes(norm)) list.push(norm);
    });
    policies[key].exceptions = list;
  }

  addException(folderPath: string, filePath: string) {
    const policies = this.settings().folderPolicies;
    const key = normalizePath(folderPath);
    if (!policies[key]) policies[key] = { contentPolicy: "any", exceptions: [] } as FolderPolicy;
    const list = policies[key].exceptions ?? [];
    const norm = normalizePath(filePath);
    if (!list.includes(norm)) list.push(norm);
    policies[key].exceptions = list;
  }

  getExceptions(folderPath: string): string[] {
    const key = normalizePath(folderPath);
    return this.settings().folderPolicies[key]?.exceptions ?? [];
  }

  removeException(folderPath: string, filePath: string) {
    const policies = this.settings().folderPolicies;
    const key = normalizePath(folderPath);
    if (!policies[key]?.exceptions) return;
    const norm = normalizePath(filePath);
    policies[key].exceptions = policies[key].exceptions!.filter((p) => p !== norm);
  }

  getInheritedRules(folderPath: string): Array<{ rule: SimpleRule; sourceFolder: string; enabledHere: boolean }> {
    const normalizedFolder = normalizePath(folderPath);
    const { rules, folderPolicies } = this.settings();
    const disabledHere = folderPolicies[normalizedFolder]?.disabledInheritedRules ?? [];

    // Get all parent folders
    const parents: string[] = [];
    if (normalizedFolder !== "/") {
      const parts = normalizedFolder.split("/");
      for (let i = 0; i < parts.length; i++) {
        const parent = i === 0 ? "/" : parts.slice(0, i).join("/");
        if (parent !== normalizedFolder) {
          parents.push(parent);
        }
      }
      parents.push("/"); // Always include root
    }

    // Find rules from parent folders
    const inherited: Array<{ rule: SimpleRule; sourceFolder: string; enabledHere: boolean }> = [];
    for (const parent of parents) {
      const parentRules = rules.filter((r) => normalizePath(r.folderPath) === parent);
      for (const rule of parentRules) {
        inherited.push({
          rule,
          sourceFolder: parent,
          enabledHere: !disabledHere.includes(rule.id)
        });
      }
    }

    return inherited;
  }

  toggleInheritedRule(folderPath: string, ruleId: string, enabled: boolean) {
    const policies = this.settings().folderPolicies;
    const key = normalizePath(folderPath);

    if (!policies[key]) {
      policies[key] = { contentPolicy: "any" };
    }

    if (!policies[key].disabledInheritedRules) {
      policies[key].disabledInheritedRules = [];
    }

    const disabled = policies[key].disabledInheritedRules!;

    if (enabled) {
      // Remove from disabled list
      policies[key].disabledInheritedRules = disabled.filter((id) => id !== ruleId);
    } else {
      // Add to disabled list
      if (!disabled.includes(ruleId)) {
        disabled.push(ruleId);
      }
    }
  }
}
