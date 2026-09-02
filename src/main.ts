import { App, Plugin, PluginSettingTab, WorkspaceLeaf, TFolder, Setting, normalizePath } from "obsidian";
import { SmartFoldersManager } from "./manager";
import { RuleBuilderView, VIEW_TYPE_RULE_BUILDER } from "./ui/rule-builder-view";
import { DEFAULT_SETTINGS, SmartFoldersSettings, normalizeRuleActions } from "./types";
import { normalizeFolderPath } from "./utils/folder-path";
import { ContextBoundary, getContextBoundaries, resolveContextBoundary } from "./context-boundary";
import { BoundaryCandidate, BoundaryStack } from "./boundary-state";
import { runBoundaryActions } from "./boundary-actions";
import { findSmartFolderRoots, isIgnoredPath } from "./smart-root";

export default class SmartFoldersPlugin extends Plugin {
  settings: SmartFoldersSettings = DEFAULT_SETTINGS;
  manager: SmartFoldersManager | null = null;
  /** In-memory only - see 08-context-boundary-events.md's Persistence note. */
  readonly boundaryStack = new BoundaryStack();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.manager = new SmartFoldersManager(this, () => this.settings);
    await this.manager.start();

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.boundaryStack.handleDetection(file ? this.resolveContextBoundary(file.path) : undefined);
      })
    );

    this.addRibbonIcon("folder", "Open Smart Folders root", () => this.openRootView());

    this.addCommand({
      id: "smart-folders-run-on-active-file",
      name: "Process active file with Smart Folders rules",
      callback: () => this.runOnActiveFile(),
    });

    this.addCommand({
      id: "smart-folders-open-view",
      name: "Configure Smart Folders for current folder",
      callback: () => this.openViewForCurrentFolder(),
    });

    this.registerFolderContextMenu();

    this.registerView(VIEW_TYPE_RULE_BUILDER, (leaf) => new RuleBuilderView(leaf, this));

    this.addSettingTab(new MinimalSettingTab(this.app, this));

    console.info("Smart Folders: plugin loaded", this.settings);
  }

  async onunload(): Promise<void> {
    await this.manager?.stop();
    console.info("Smart Folders: plugin unloaded");
  }

  private async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
    };

    let migratedLegacyActions = false;
    this.settings.rules = this.settings.rules.map((rule) => {
      const normalized = normalizeRuleActions(rule);
      if (normalized !== rule) migratedLegacyActions = true;
      return normalized;
    });

    if (migratedLegacyActions) {
      await this.saveData(this.settings);
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    await this.manager?.restart();
  }

  /**
   * Public API for other plugins/dataviewjs to read the Hubpage's card list,
   * e.g. app.plugins.plugins["smart-folders"].getHubPages(). A folder counts
   * as promoted simply by having a hubPage set - no separate toggle.
   */
  getHubPages(): { folderPath: string; hubPage: string }[] {
    return Object.entries(this.settings.folderPolicies)
      .filter(([, policy]) => policy.hubPage)
      .map(([folderPath, policy]) => ({ folderPath, hubPage: policy.hubPage as string }));
  }

  /** Single-folder lookup, e.g. for the agent-client opened-note handshake. */
  getHubPageForFolder(folderPath: string): string | undefined {
    return this.settings.folderPolicies[normalizeFolderPath(folderPath)]?.hubPage;
  }

  /** All configured workspace context boundaries. Boundaries may nest. */
  getContextBoundaries(): ContextBoundary[] {
    return getContextBoundaries(this.settings.folderPolicies);
  }

  /** Resolve a vault-relative file or folder path to its owning context boundary. */
  resolveContextBoundary(path: string): ContextBoundary | undefined {
    return resolveContextBoundary(path, this.settings.folderPolicies);
  }

  /** Committed boundary stack, innermost last. In-memory only - resets on reload. */
  getBoundaryStack(): readonly ContextBoundary[] {
    return this.boundaryStack.getStack();
  }

  /** A newly-detected boundary not yet committed, if any. */
  getBoundaryCandidate(): BoundaryCandidate | undefined {
    return this.boundaryStack.getCandidate();
  }

  /**
   * Explicit commit of the current candidate (the future widget's yellow ->
   * green click). A push only runs the new boundary's onEnter actions; a
   * replace also runs onExit for everything the commit unwinds, innermost
   * first - see 08-context-boundary-events.md's Enter/exit hooks section.
   * Free backward pops (handled in handleDetection, not here) never fire
   * anything - only an explicit commit does.
   */
  async commitBoundaryCandidate(): Promise<void> {
    const candidate = this.boundaryStack.getCandidate();
    if (!candidate) return;
    const outgoing = candidate.kind === "replace" ? [...this.boundaryStack.getStack()].reverse() : [];

    this.boundaryStack.commitCandidate();

    for (const boundary of outgoing) {
      const policy = this.settings.folderPolicies[boundary.folderPath];
      await runBoundaryActions(this.app, policy?.onExitActions, boundary);
    }
    const policy = this.settings.folderPolicies[candidate.boundary.folderPath];
    await runBoundaryActions(this.app, policy?.onEnterActions, candidate.boundary);
  }

  /** Explicit dismissal of the current candidate; the committed stack is untouched. */
  dismissBoundaryCandidate(): void {
    this.boundaryStack.dismissCandidate();
  }

  /** Top-level configured folders that act as Smart Folders entry points. */
  getSmartFolderRoots(): string[] {
    const configuredPaths = [
      ...Object.keys(this.settings.folderPolicies),
      ...this.settings.rules.map((rule) => rule.folderPath),
    ].filter((path) => this.app.vault.getAbstractFileByPath(normalizeFolderPath(path)) instanceof TFolder);

    const configuredRoots = findSmartFolderRoots(configuredPaths, this.settings.ignoredFolders);
    if (configuredRoots.length > 0) return configuredRoots;

    return this.app.vault.getRoot().children
      .filter((child): child is TFolder => child instanceof TFolder)
      .map((folder) => folder.path)
      .filter((path) => !isIgnoredPath(path, this.settings.ignoredFolders))
      .sort((a, b) => a.localeCompare(b));
  }

  async openRootView(): Promise<void> {
    await this.openViewForFolder(this.getSmartFolderRoots()[0] ?? "/");
  }

  private async openViewForCurrentFolder() {
    const folder = await this.getCurrentFolder();
    await this.openViewForFolder(folder);
  }

  async openViewForFolder(folder: string) {
    const leaf = this.getRuleLeaf();
    await leaf.setViewState({ type: VIEW_TYPE_RULE_BUILDER, state: { folder } });
    this.app.workspace.revealLeaf(leaf);
  }

  private async getCurrentFolder(): Promise<string> {
    // First, try to get folder from active file
    const file = this.app.workspace.getActiveFile();
    if (file) return file.parent?.path ?? "/";

    // If no active file, check if there's already a Smart Folders view open and use its folder
    const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_RULE_BUILDER)[0];
    if (existingLeaf) {
      // A restored leaf can be deferred (view not yet instantiated); casting
      // .view before it loads would be unsafe. See WorkspaceLeaf#isDeferred, @since 1.7.2.
      if (existingLeaf.isDeferred) await existingLeaf.loadIfDeferred();
      const view = existingLeaf.view as RuleBuilderView;
      const state = view.getState();
      if (state?.folder) return state.folder;
    }

    // Default to root
    return "/";
  }

  private getRuleLeaf(): WorkspaceLeaf {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_RULE_BUILDER)[0];
    if (existing) return existing;
    // Open in main editor area (like a regular note tab)
    return this.app.workspace.getLeaf(true);
  }

  private registerFolderContextMenu() {
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFolder) {
          menu.addItem((item) =>
            item
              .setTitle("Smart Folders: Configure")
              .setIcon("folder")
              .onClick(() => this.openViewForFolder(file.path))
          );
        }
      })
    );
  }

  private async runOnActiveFile() {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    await this.manager?.processFile(file, "manual-command");
  }
}

class MinimalSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly pluginInstance: SmartFoldersPlugin) {
    super(app, pluginInstance);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Smart Folders" });

    new Setting(containerEl)
      .setName("Open rule builder")
      .setDesc("Use the command palette: Open Smart Folders view for current folder")
      .addButton((btn) => btn.setButtonText("Open root").onClick(() => this.pluginInstance.openRootView()));

    new Setting(containerEl)
      .setName("Inherit content policy")
      .setDesc("If enabled, children inherit parent content policy unless they set their own.")
      .addToggle((t) =>
        t
          .setValue(this.pluginInstance.settings.inheritContentPolicy)
          .onChange(async (v) => {
            this.pluginInstance.settings.inheritContentPolicy = v;
            await this.pluginInstance.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default quarantine path")
      .setDesc("Used when folders do not specify their own.")
      .addText((t) =>
        t
          .setPlaceholder("_sf/lost+found")
          .setValue(this.pluginInstance.settings.defaultQuarantinePath)
          .onChange(async (v) => {
            this.pluginInstance.settings.defaultQuarantinePath = v.trim() || "_sf/lost+found";
            await this.pluginInstance.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-move on policy change")
      .setDesc("When enabled, existing violations are rerouted automatically after changing a folder's content policy.")
      .addToggle((t) =>
        t
          .setValue(this.pluginInstance.settings.autoMoveOnPolicyChange)
          .onChange(async (v) => {
            this.pluginInstance.settings.autoMoveOnPolicyChange = v;
            await this.pluginInstance.saveSettings();
          })
      );

    // Ignored folders section
    containerEl.createEl("h3", { text: "Ignored Folders" });

    const ignoredDesc = containerEl.createDiv({ cls: "setting-item-description" });
    ignoredDesc.setText("Folders listed here (and their subfolders) will be completely ignored by Smart Folders.");
    ignoredDesc.style.marginBottom = "10px";

    this.pluginInstance.settings.ignoredFolders.forEach((folder, index) => {
      new Setting(containerEl)
        .setName(`Folder ${index + 1}`)
        .addText((text) =>
          text
            .setPlaceholder("folder/path")
            .setValue(folder)
            .onChange(async (value) => {
              this.pluginInstance.settings.ignoredFolders[index] = normalizePath(value);
              await this.pluginInstance.saveSettings();
            })
        )
        .addButton((btn) =>
          btn
            .setButtonText("Remove")
            .setWarning()
            .onClick(async () => {
              this.pluginInstance.settings.ignoredFolders.splice(index, 1);
              await this.pluginInstance.saveSettings();
              this.display();
            })
        );
    });

    new Setting(containerEl)
      .addButton((btn) =>
        btn
          .setButtonText("Add ignored folder")
          .setCta()
          .onClick(async () => {
            this.pluginInstance.settings.ignoredFolders.push("");
            await this.pluginInstance.saveSettings();
            this.display();
          })
      );

    // Audit logging section
    containerEl.createEl("h3", { text: "Audit Logging" });

    new Setting(containerEl)
      .setName("Enable audit logging")
      .setDesc("Log all Smart Folders operations to markdown files for review.")
      .addToggle((t) =>
        t
          .setValue(this.pluginInstance.settings.auditLogEnabled)
          .onChange(async (v) => {
            this.pluginInstance.settings.auditLogEnabled = v;
            await this.pluginInstance.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Audit log path")
      .setDesc("Folder path where audit logs will be stored (relative to vault root).")
      .addText((t) =>
        t
          .setPlaceholder("_sf/logs")
          .setValue(this.pluginInstance.settings.auditLogPath)
          .onChange(async (v) => {
            this.pluginInstance.settings.auditLogPath = v.trim() || "_sf/logs";
            await this.pluginInstance.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Entries per file")
      .setDesc("Maximum number of log entries per file before rotating to a new file. Daily logs will automatically create new files as needed.")
      .addText((t) =>
        t
          .setPlaceholder("100")
          .setValue(String(this.pluginInstance.settings.auditEntriesPerFile))
          .onChange(async (v) => {
            const num = parseInt(v, 10);
            if (!isNaN(num) && num > 0) {
              this.pluginInstance.settings.auditEntriesPerFile = num;
              await this.pluginInstance.saveSettings();
            }
          })
      );
  }
}
