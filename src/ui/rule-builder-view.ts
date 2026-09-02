import { App, ItemView, Modal, Notice, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import SmartFoldersPlugin from "../main";
import { ContentPolicy, FolderPolicy, SmartFoldersSettings, SimpleRule, SingleCondition, isCompositeCondition, ConditionType, ConditionOperator, TagOperator } from "../types";
import { FolderPickerModal } from "./folder-picker-modal";
import { NotePickerModal } from "./note-picker-modal";
import { nanoid } from "../utils/nanoid";

export const VIEW_TYPE_RULE_BUILDER = "smart-folders-rule-builder";

interface RuleBuilderState extends Record<string, unknown> {
  folder: string;
}

export class RuleBuilderView extends ItemView {
  private folder: string = "/";
  private isDirty: boolean = false;
  private saveButtonEl: HTMLButtonElement | null = null;
  private recheckTimeout: NodeJS.Timeout | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: SmartFoldersPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_RULE_BUILDER;
  }

  getDisplayText(): string {
    return "Smart Folders";
  }

  async setState(state: RuleBuilderState, result?: any): Promise<void> {
    this.folder = (state?.folder as string) || "/";
    await super.setState(state, result);
    this.render();
  }

  getState(): RuleBuilderState {
    return { folder: this.folder };
  }

  async onOpen(): Promise<void> {
    this.render();
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file) return;
        const nextFolder = file.parent?.path ?? "/";
        if (nextFolder !== this.folder) {
          this.folder = nextFolder;
          this.render();
        }
      })
    );

    // Listen for file changes to update violations/exceptions dynamically
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) {
          const fileFolder = file.parent?.path ?? "/";
          // If the modified file is in the current folder or a subfolder, re-check
          if (fileFolder === this.folder || fileFolder.startsWith(this.folder + "/")) {
            // Debounce to avoid too many re-renders
            this.scheduleRecheck();
          }
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile) {
          const fileFolder = file.parent?.path ?? "/";
          if (fileFolder === this.folder || fileFolder.startsWith(this.folder + "/")) {
            this.scheduleRecheck();
          }
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          const fileFolder = file.parent?.path ?? "/";
          if (fileFolder === this.folder || fileFolder.startsWith(this.folder + "/")) {
            this.scheduleRecheck();
          }
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) {
          const fileFolder = file.parent?.path ?? "/";
          const oldFolder = oldPath.substring(0, oldPath.lastIndexOf("/"));
          if (fileFolder === this.folder || fileFolder.startsWith(this.folder + "/") ||
              oldFolder === this.folder || oldFolder.startsWith(this.folder + "/")) {
            this.scheduleRecheck();
          }
        }
      })
    );

    // Obsidian has no public workspace event for "folder clicked in file
    // explorer" (folders don't become the active file, so "file-open" above
    // never fires for them). This DOM listener is the only way to track that
    // selection; it's scoped to just the folder case (file clicks are already
    // covered by "file-open") to keep the internal-DOM surface as small as
    // possible. If the explorer's internal structure changes, this silently
    // stops updating rather than throwing - the "file-open" listener still
    // keeps the view in sync for file-driven navigation.
    const explorer = this.app.workspace.getLeavesOfType("file-explorer")[0]?.view as any;
    const explorerEl: HTMLElement | undefined = explorer?.containerEl;
    if (explorerEl) {
      this.registerDomEvent(explorerEl, "click", (evt) => {
        const target = (evt.target as HTMLElement)?.closest("[data-path]") as HTMLElement | null;
        const path = target?.getAttribute("data-path");
        if (!path) return;
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFolder && file.path !== this.folder) {
          this.folder = file.path;
          this.render();
        }
      });
    }
  }

  private async render() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("smart-folders-view");

    try {

    // Check if this folder is ignored
    const isIgnored = this.isFolderIgnored(this.folder);

    if (isIgnored) {
      // Show ignored folder message
      const header = containerEl.createDiv({ cls: "smart-folders-header" });
      header.createEl("h2", { text: "Smart Folders – Rule Builder" });

      const toolbar = containerEl.createDiv({ cls: "smart-folders-toolbar" });
      const breadcrumb = toolbar.createDiv({ cls: "smart-folders-breadcrumb" });
      renderBreadcrumb(breadcrumb, this.folder || "/", (folder) => {
        if (folder === this.folder) return;
        this.folder = folder;
        this.render();
      });

      const buttons = toolbar.createDiv({ cls: "smart-folders-toolbar-buttons" });
      const rootBtn = buttons.createEl("button", { text: "Open vault root" });
      rootBtn.onclick = () => this.plugin.openViewForFolder("/");

      const ignoredNotice = containerEl.createDiv({ cls: "smart-folders-ignored-notice" });
      ignoredNotice.createEl("h3", { text: "⚠️ Ignored Folder" });
      ignoredNotice.createEl("p", {
        text: "This folder and all its subfolders are in the ignored folders list. Smart Folders will not process any files or folders within this location."
      });
      ignoredNotice.createEl("p", {
        text: "To enable Smart Folders for this location, remove it from the ignored folders list in plugin settings."
      });

      const settingsBtn = ignoredNotice.createEl("button", { text: "Open Settings", cls: "mod-cta" });
      settingsBtn.onclick = () => {
        // app.setting isn't part of the public obsidian.d.ts surface, but it's
        // the standard community-plugin way to jump into a plugin's settings
        // tab - there's no publicly documented alternative. Guarded with a
        // try/catch so an internal API shape change degrades to a Notice
        // instead of throwing.
        try {
          // @ts-ignore - accessing private API
          this.app.setting.open();
          // @ts-ignore
          this.app.setting.openTabById(this.plugin.manifest.id);
        } catch (error) {
          console.error("Smart Folders: failed to open settings tab", error);
          new Notice("Couldn't open settings automatically - open it from the Obsidian settings menu.");
        }
      };

      return;
    }

    const savedPolicy = getOrCreatePolicy(this.plugin.settings, this.folder);
    const folderEnabled = savedPolicy.enabled ?? true; // default to enabled

    // Header with title and enable toggle
    const header = containerEl.createDiv({ cls: "smart-folders-header" });
    header.createEl("h2", { text: "Smart Folders – Rule Builder" });

    const toggleContainer = header.createDiv({ cls: "smart-folders-toggle-container" });
    toggleContainer.createSpan({
      text: folderEnabled ? "Enabled" : "Disabled",
      cls: "smart-folders-toggle-label"
    });

    const toggleSwitch = toggleContainer.createDiv({ cls: "smart-folders-toggle-switch" });
    toggleSwitch.createDiv({ cls: folderEnabled ? "slider slider-on" : "slider" });

    toggleSwitch.onclick = async () => {
      const newEnabled = !folderEnabled;
      savedPolicy.enabled = newEnabled;
      setPolicy(this.plugin.settings, this.folder, savedPolicy);
      await this.plugin.saveSettings();
      this.render();
    };

    const toolbar = containerEl.createDiv({ cls: "smart-folders-toolbar" });

    const breadcrumb = toolbar.createDiv({ cls: "smart-folders-breadcrumb" });
    renderBreadcrumb(breadcrumb, this.folder || "/", (folder) => {
      if (folder === this.folder) return;
      this.folder = folder;
      this.render();
    });

    const buttons = toolbar.createDiv({ cls: "smart-folders-toolbar-buttons" });
    const rootBtn = buttons.createEl("button", { text: "Open vault root" });
    rootBtn.onclick = () => this.plugin.openViewForFolder("/");

    const auditToggle = buttons.createEl("button", { text: this.plugin.settings.auditLogEnabled ? "Audit: On" : "Audit: Off" });
    auditToggle.onclick = async () => {
      this.plugin.settings.auditLogEnabled = !this.plugin.settings.auditLogEnabled;
      auditToggle.textContent = this.plugin.settings.auditLogEnabled ? "Audit: On" : "Audit: Off";
      await this.plugin.saveSettings();
    };

    const workingPolicy = { ...savedPolicy };
    await this.plugin.manager?.handlePolicyChange(this.folder, false);

    // Auto-scan for highlight violations if there are highlight rules but no violations yet
    const localRules = this.plugin.settings.rules.filter((r) => r.folderPath === normalize(this.folder));
    const hasHighlightRules = localRules.some(r => r.action.type === "highlight");
    const storedViolationsCount = (this.plugin.manager?.getStoredViolations(this.folder) ?? []).length;
    if (hasHighlightRules && storedViolationsCount === 0) {
      // Scan and wait for completion before rendering violations section
      await this.runRulesForFolder(this.folder).catch(e => console.error("Auto-scan failed:", e));
    }

    const policySection = containerEl.createDiv({ cls: "smart-folders-policy" });
    const policyRow = policySection.createDiv({ cls: "setting-item" });
    policyRow.createEl("div", { text: "Content policy" });
    const select = policyRow.createEl("select");
    ["any", "files-only", "folders-only", "locked"].forEach((value) => {
      const opt = select.createEl("option", { value, text: labelForPolicy(value as ContentPolicy) });
      if (workingPolicy.contentPolicy === value) opt.selected = true;
    });

    // Get effective quarantine path (with inheritance)
    const effectiveQuarantinePath = this.plugin.manager?.getEffectivePolicy(this.folder).quarantinePath ?? this.plugin.settings.defaultQuarantinePath;
    const hasOwnQuarantinePath = savedPolicy.quarantinePath !== undefined;

    const qRow = policySection.createDiv({ cls: "setting-item" });
    const qLabel = qRow.createEl("div", { text: "Quarantine path" });
    if (!hasOwnQuarantinePath && this.folder !== "/") {
      qLabel.createSpan({ text: " (inherited)", cls: "sf-inherited-label" });
    }
    const qInput = qRow.createEl("input", {
      type: "text",
      value: savedPolicy.quarantinePath ?? "",
      attr: { placeholder: effectiveQuarantinePath }
    });

    select.onchange = async () => {
      savedPolicy.contentPolicy = select.value as ContentPolicy;
      setPolicy(this.plugin.settings, this.folder, savedPolicy);
      await this.plugin.saveSettings();
      await this.plugin.manager?.handlePolicyChange(this.folder, this.plugin.settings.autoMoveOnPolicyChange);
      this.render();
    };

    const saveQuarantinePath = async () => {
      const val = qInput.value.trim();
      savedPolicy.quarantinePath = val || undefined;
      setPolicy(this.plugin.settings, this.folder, savedPolicy);
      await this.plugin.saveSettings();
      await this.plugin.manager?.handlePolicyChange(this.folder, this.plugin.settings.autoMoveOnPolicyChange);
      this.render();
    };

    qInput.onblur = saveQuarantinePath;

    qInput.onkeydown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveQuarantinePath();
        qInput.blur();
      }
    };

    // Hub page: which note represents this folder on the Hubpage board
    const hubRow = policySection.createDiv({ cls: "setting-item" });
    hubRow.createEl("div", { text: "Hub page" });
    const hubControls = hubRow.createDiv({ cls: "sf-hub-page-controls" });
    hubControls.createSpan({
      text: savedPolicy.hubPage ?? "Not set",
      cls: "sf-hub-page-value",
    });
    const hubPickBtn = hubControls.createEl("button", { text: savedPolicy.hubPage ? "Change" : "Choose note" });
    hubPickBtn.onclick = () => {
      new NotePickerModal(this.app, async (file) => {
        savedPolicy.hubPage = file.path;
        setPolicy(this.plugin.settings, this.folder, savedPolicy);
        await this.plugin.saveSettings();
        this.render();
      }).open();
    };
    if (savedPolicy.hubPage) {
      const hubClearBtn = hubControls.createEl("button", { text: "Clear" });
      hubClearBtn.onclick = async () => {
        savedPolicy.hubPage = undefined;
        savedPolicy.promoted = false; // promoted requires a hubPage
        setPolicy(this.plugin.settings, this.folder, savedPolicy);
        await this.plugin.saveSettings();
        this.render();
      };
    }

    // Promoted: whether this folder's hub page shows up as a card on the Hubpage
    const promotedRow = policySection.createDiv({ cls: "setting-item" });
    const promotedLabelEl = promotedRow.createEl("div", { text: "Promoted (shown on Hubpage)" });
    const canPromote = !!savedPolicy.hubPage;
    if (!canPromote) {
      promotedLabelEl.createSpan({ text: " (set a hub page first)", cls: "sf-inherited-label" });
    }
    const isPromoted = !!savedPolicy.promoted && canPromote;
    const promotedToggle = promotedRow.createDiv({ cls: "smart-folders-toggle-switch" });
    promotedToggle.createDiv({ cls: isPromoted ? "slider slider-on" : "slider" });
    if (!canPromote) {
      promotedToggle.style.cursor = "not-allowed";
      promotedToggle.style.opacity = "0.5";
    } else {
      promotedToggle.onclick = async () => {
        savedPolicy.promoted = !savedPolicy.promoted;
        setPolicy(this.plugin.settings, this.folder, savedPolicy);
        await this.plugin.saveSettings();
        this.render();
      };
    }

    const storedViolations = this.plugin.manager?.getStoredViolations(this.folder) ?? [];

    if (storedViolations.length > 0) {
      const violationList = policySection.createEl("div", { cls: "sf-violations" });

      const header = violationList.createEl("div", { cls: "sf-violations-header" });
      header.createEl("h4", { text: "Violations" });

      // Add refresh button for violations
      const refreshBtn = header.createEl("button", { text: "↻ Refresh", cls: "sf-violations-refresh" });
      refreshBtn.onclick = async () => {
        refreshBtn.textContent = "⏳ Scanning...";
        refreshBtn.disabled = true;
        await this.runRulesForFolder(this.folder);
        await this.plugin.manager?.handlePolicyChange(this.folder, false);
        this.render();
      };

      // Bulk action buttons for multiple violations
      if (storedViolations.length > 1) {
        const bulkActions = header.createEl("div", { cls: "sf-bulk-actions" });

        const allowAllBtn = bulkActions.createEl("button", { text: "Allow All" });
        allowAllBtn.onclick = async () => {
          for (const violation of storedViolations) {
            this.plugin.manager?.addException(this.folder, violation.path);
          }
          await this.plugin.saveSettings();
          await this.plugin.manager?.handlePolicyChange(this.folder, false);
          this.render();
        };

        const quarantineAllBtn = bulkActions.createEl("button", { text: "Quarantine All" });
        quarantineAllBtn.onclick = async () => {
          for (const violation of storedViolations) {
            await this.plugin.manager?.rerouteByPath(violation.path, savedPolicy);
          }
          await this.plugin.manager?.handlePolicyChange(this.folder, false);
          this.render();
        };

        const moveAllBtn = bulkActions.createEl("button", { text: "Move All" });
        moveAllBtn.onclick = () => {
          new FolderPickerModal(this.app, async (folder) => {
            for (const violation of storedViolations) {
              await this.plugin.manager?.movePath(violation.path, folder.path || "/");
            }
            await this.plugin.manager?.handlePolicyChange(this.folder, false);
            this.render();
          }).open();
        };
      }

      storedViolations.forEach((violation) => {
        const row = violationList.createEl("div", { cls: "sf-violation-row" });
        const display = trimPath(violation.path, this.folder, this.plugin);
        const pathEl = row.createEl("div", { cls: "sf-violation-info" });
        const pathSpan = pathEl.createSpan({ text: display, cls: "sf-violation-path" });
        pathSpan.style.cursor = "pointer";
        pathSpan.onclick = () => {
          const file = this.app.vault.getAbstractFileByPath(violation.path);
          if (file instanceof TFile) {
            this.app.workspace.getLeaf().openFile(file);
          }
        };
        pathEl.createSpan({ text: `(${violation.reason})`, cls: "sf-violation-reason" });

        const allowBtn = row.createEl("button", { text: "Allow" });
        allowBtn.onclick = async () => {
          // Both content policy and highlight violations should be added as exceptions
          await this.plugin.manager?.logDebug(
            this.folder,
            `Allow clicked: folder="${this.folder}", file="${violation.path}", reason="${violation.reason}"`
          );

          // Add to exceptions
          this.plugin.manager?.addException(this.folder, violation.path);
          await this.plugin.saveSettings();

          const exceptions = this.plugin.manager?.getExceptions(this.folder) ?? [];
          await this.plugin.manager?.logDebug(
            this.folder,
            `After adding exception, exceptions list: ${JSON.stringify(exceptions)}`
          );

          // For highlight violations, also remove from current violations list
          if (violation.reason !== "Content Policy") {
            this.plugin.manager?.removeHighlightViolation(this.folder, violation.path, violation.ruleId);
          }

          // Recheck policy to clear violations for exceptions
          await this.plugin.manager?.handlePolicyChange(this.folder, false);
          this.render();
        };

        const quarantineBtn = row.createEl("button", { text: "Quarantine" });
        quarantineBtn.onclick = async () => {
          await this.plugin.manager?.rerouteByPath(violation.path, savedPolicy);
          await this.plugin.manager?.handlePolicyChange(this.folder, false);
          this.render();
        };

        const moveBtn = row.createEl("button", { text: "Move" });
        moveBtn.onclick = () => {
          new FolderPickerModal(this.app, async (folder) => {
            await this.plugin.manager?.movePath(violation.path, folder.path || "/");
            await this.plugin.manager?.handlePolicyChange(this.folder, false);
            this.render();
          }).open();
        };

        const delBtn = row.createEl("button", { text: "Delete", cls: "mod-warning" });
        delBtn.onclick = async () => {
          const confirmed = await confirmDeletion(this.app, display);
          if (confirmed) {
            await this.plugin.manager?.deletePath(violation.path);
            await this.plugin.manager?.handlePolicyChange(this.folder, false);
            this.render();
          }
        };
      });
    }

    const exceptions = this.plugin.manager?.getExceptions(this.folder) ?? [];
    // Show exceptions if there are any (for content policy or highlight rules)
    if (exceptions.length > 0) {
      const excList = policySection.createEl("div", { cls: "sf-violations" });

      const excHeader = excList.createEl("div", { cls: "sf-violations-header" });
      excHeader.createEl("h4", { text: "Exceptions" });

      // Bulk remove button for multiple exceptions
      if (exceptions.length > 2) {
        const bulkActions = excHeader.createEl("div", { cls: "sf-bulk-actions" });
        const removeAllBtn = bulkActions.createEl("button", { text: "Remove All" });
        removeAllBtn.onclick = async () => {
          for (const path of exceptions) {
            this.plugin.manager?.removeException(this.folder, path);
          }
          await this.plugin.saveSettings();
          await this.plugin.manager?.handlePolicyChange(this.folder, this.plugin.settings.autoMoveOnPolicyChange);
          this.render();
        };
      }

      exceptions.forEach((path) => {
        const row = excList.createEl("div", { cls: "sf-violation-row" });

        // Determine if this exception is for a highlight rule or content policy
        // Check if any highlight rules in this folder would match this file
        const localRules = this.plugin.settings.rules.filter(
          (r) => normalize(r.folderPath) === normalize(this.folder) && r.action.type === "highlight"
        );
        const hasHighlightRules = localRules.length > 0;

        const display = trimPath(path, this.folder, this.plugin);
        const pathEl = row.createEl("div", { cls: "sf-violation-info" });
        const pathSpan = pathEl.createSpan({ text: display, cls: "sf-violation-path" });
        pathSpan.style.cursor = "pointer";
        pathSpan.onclick = () => {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) {
            this.app.workspace.getLeaf().openFile(file);
          }
        };

        // Show reason: "Content Policy" or highlight rule names
        let reason = "Content Policy";
        if (hasHighlightRules) {
          const ruleNames = localRules.map(r => r.name).join(", ");
          reason = ruleNames;
        }
        pathEl.createSpan({ text: `(${reason})`, cls: "sf-violation-reason" });

        const removeBtn = row.createEl("button", { text: "Remove" });
        removeBtn.onclick = async () => {
          this.plugin.manager?.removeException(this.folder, path);
          await this.plugin.saveSettings();
          await this.plugin.manager?.handlePolicyChange(this.folder, this.plugin.settings.autoMoveOnPolicyChange);
          this.render();
        };
      });
    }

    renderChips(this.plugin.manager?.getStoredViolations(this.folder) ?? []);

    // Inherited Rules section
    const inheritedRules = this.plugin.manager?.getInheritedRules(this.folder) ?? [];
    if (inheritedRules.length > 0) {
      const inheritedSection = containerEl.createDiv({ cls: "sf-rules-section" });
      inheritedSection.createEl("h3", { text: "Inherited Rules" });

      // Show folder disabled notice for inherited rules too
      if (!folderEnabled) {
        const disabledNotice = inheritedSection.createDiv({ cls: "sf-folder-disabled-notice" });
        disabledNotice.createEl("span", {
          text: "⚠️ Folder disabled - all inherited rules are inactive",
          cls: "sf-folder-disabled-text"
        });
      }

      const inheritedList = inheritedSection.createDiv({ cls: "sf-inherited-rules-list" });

      inheritedRules.forEach(({ rule, sourceFolder, enabledHere }) => {
        const inheritedCard = inheritedList.createDiv({
          cls: folderEnabled ? "sf-inherited-rule-card" : "sf-inherited-rule-card sf-inherited-rule-card-disabled"
        });

        const header = inheritedCard.createDiv({ cls: "sf-inherited-rule-header" });
        header.createEl("span", { text: rule.name || "Untitled Rule", cls: "sf-inherited-rule-name" });

        const sourceLink = header.createEl("span", {
          text: `From ${sourceFolder}`,
          cls: "sf-inherited-rule-source sf-inherited-rule-source-link"
        });
        sourceLink.onclick = () => {
          this.folder = sourceFolder;
          this.render();
        };

        const body = inheritedCard.createDiv({ cls: "sf-inherited-rule-body" });
        body.createEl("p", { text: formatRuleAsSentence(rule), cls: "sf-inherited-rule-text" });

        const footer = inheritedCard.createDiv({ cls: "sf-inherited-rule-footer" });
        footer.createEl("span", { text: "Enabled for this folder", cls: "sf-inherited-rule-label" });

        const toggle = footer.createDiv({
          cls: folderEnabled ? "smart-folders-toggle-switch sf-small-toggle" : "smart-folders-toggle-switch sf-small-toggle sf-toggle-disabled"
        });
        toggle.createDiv({ cls: enabledHere ? "slider slider-on" : "slider" });

        if (folderEnabled) {
          toggle.onclick = async () => {
            this.plugin.manager?.toggleInheritedRule(this.folder, rule.id, !enabledHere);
            await this.plugin.saveSettings();
            this.render();
          };
        } else {
          toggle.style.cursor = "not-allowed";
        }
      });
    }

    // Rules section
    const rulesSection = containerEl.createDiv({ cls: "sf-rules-section" });
    const rulesHeader = rulesSection.createDiv({ cls: "sf-rules-header" });
    rulesHeader.createEl("h3", { text: "Local Rules" });

    const rulesButtonGroup = rulesHeader.createDiv({ cls: "sf-rules-button-group" });

    // Get rules for this folder to check if button should be enabled
    const folderRules: SimpleRule[] = this.plugin.settings.rules.filter((r) => normalize(r.folderPath) === normalize(this.folder));

    // Run Rules button (only enabled if there are local rules)
    const runRulesBtn = rulesButtonGroup.createEl("button", {
      text: "▶ Run Rules",
      cls: "sf-run-rules-btn"
    });
    runRulesBtn.disabled = folderRules.length === 0;
    runRulesBtn.onclick = async () => {
      if (folderRules.length === 0) return;

      // Show confirmation
      const fileCount = await this.countFilesInFolderTree(this.folder);
      const confirmed = confirm(
        `Run all rules for "${this.folder}" and subfolders?\n\n` +
        `This will process approximately ${fileCount} file(s).\n\n` +
        `Rules will be applied according to their scope and conditions.`
      );

      if (!confirmed) return;

      // Disable button and show processing
      runRulesBtn.disabled = true;
      runRulesBtn.textContent = "⏳ Processing...";

      try {
        await this.runRulesForFolder(this.folder);

        // Show success
        runRulesBtn.textContent = "✓ Complete";
        setTimeout(() => {
          runRulesBtn.textContent = "▶ Run Rules";
          runRulesBtn.disabled = folderRules.length === 0;
        }, 2000);
      } catch (error) {
        console.error("Error running rules:", error);
        runRulesBtn.textContent = "✗ Error";
        setTimeout(() => {
          runRulesBtn.textContent = "▶ Run Rules";
          runRulesBtn.disabled = folderRules.length === 0;
        }, 2000);
      }
    };

    const addRuleBtn = rulesButtonGroup.createEl("button", { text: "+ Add Rule", cls: "sf-add-rule-btn" });
    addRuleBtn.onclick = async () => {
      // Find the highest rule number so far
      const allRules = this.plugin.settings.rules;
      let maxNumber = 0;
      allRules.forEach((r) => {
        const match = r.name.match(/^Rule (\d+)/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNumber) maxNumber = num;
        }
      });

      const newRule: SimpleRule = {
        id: nanoid(),
        name: `Rule ${maxNumber + 1}`,
        enabled: false, // Disabled by default to prevent accidental execution
        folderPath: normalize(this.folder), // Where rule is displayed in UI
        scopeFolder: normalize(this.folder), // Where rule searches (defaults to same folder)
        condition: { type: "frontmatter", operator: "equals", field: "status", value: "" },
        action: { type: "move-file", targetFolder: normalize(this.folder) },
      };
      this.plugin.settings.rules.push(newRule);
      this.markDirty();
      this.render();
    };

    // Save Rules button
    this.saveButtonEl = rulesButtonGroup.createEl("button", { text: "Save Rules", cls: "mod-cta sf-save-rules-btn" });
    this.saveButtonEl.disabled = !this.isDirty;
    this.saveButtonEl.onclick = async () => {
      await this.plugin.saveSettings();
      this.markClean();
      if (this.saveButtonEl) {
        this.saveButtonEl.textContent = "Saved!";
        setTimeout(() => {
          if (this.saveButtonEl) {
            this.saveButtonEl.textContent = "Save Rules";
          }
        }, 1500);
      }
    };

    // Show folder disabled notice if folder is disabled
    if (!folderEnabled && folderRules.length > 0) {
      const disabledNotice = rulesSection.createDiv({ cls: "sf-folder-disabled-notice" });
      disabledNotice.createEl("span", {
        text: "⚠️ Folder disabled - all local rules are inactive",
        cls: "sf-folder-disabled-text"
      });
    }

    if (folderRules.length > 0) {
      const rulesList = rulesSection.createDiv({ cls: "sf-rules-list" });

      folderRules.forEach((rule, index) => {
        const ruleCard = rulesList.createDiv({
          cls: folderEnabled ? "sf-rule-card" : "sf-rule-card sf-rule-card-disabled"
        });

        // Rule header with name and controls
        const ruleHeader = ruleCard.createDiv({ cls: "sf-rule-card-header" });

        // Editable rule name
        const nameInput = ruleHeader.createEl("input", {
          type: "text",
          value: rule.name || "Untitled Rule",
          cls: "sf-rule-name"
        });
        nameInput.oninput = () => {
          rule.name = nameInput.value;
          this.markDirty();
        };

        const ruleControls = ruleHeader.createDiv({ cls: "sf-rule-controls" });

        // Enabled toggle (disabled if folder is disabled)
        const enabledToggle = ruleControls.createDiv({
          cls: folderEnabled ? "smart-folders-toggle-switch sf-small-toggle" : "smart-folders-toggle-switch sf-small-toggle sf-toggle-disabled"
        });
        enabledToggle.createDiv({ cls: rule.enabled ? "slider slider-on" : "slider" });
        if (folderEnabled) {
          enabledToggle.onclick = () => {
            rule.enabled = !rule.enabled;
            this.markDirty();
            this.render();
          };
        } else {
          enabledToggle.style.cursor = "not-allowed";
        }

        // Up arrow
        const upBtn = ruleControls.createEl("button", { text: "↑", cls: "sf-rule-arrow-btn" });
        upBtn.onclick = async () => {
          if (index > 0) {
            // Get IDs BEFORE swapping
            const allRules = this.plugin.settings.rules;
            const currentId = folderRules[index].id;
            const prevId = folderRules[index - 1].id;

            const currentGlobalIdx = allRules.findIndex((r) => r.id === currentId);
            const prevGlobalIdx = allRules.findIndex((r) => r.id === prevId);

            if (currentGlobalIdx >= 0 && prevGlobalIdx >= 0) {
              // Swap in the global array
              [allRules[prevGlobalIdx], allRules[currentGlobalIdx]] = [allRules[currentGlobalIdx], allRules[prevGlobalIdx]];
            }

            await this.plugin.saveSettings();
            this.render();
          }
        };
        if (index === 0) upBtn.disabled = true;

        // Down arrow
        const downBtn = ruleControls.createEl("button", { text: "↓", cls: "sf-rule-arrow-btn" });
        downBtn.onclick = async () => {
          if (index < folderRules.length - 1) {
            // Get IDs BEFORE swapping
            const allRules = this.plugin.settings.rules;
            const currentId = folderRules[index].id;
            const nextId = folderRules[index + 1].id;

            const currentGlobalIdx = allRules.findIndex((r) => r.id === currentId);
            const nextGlobalIdx = allRules.findIndex((r) => r.id === nextId);

            if (currentGlobalIdx >= 0 && nextGlobalIdx >= 0) {
              // Swap in the global array
              [allRules[currentGlobalIdx], allRules[nextGlobalIdx]] = [allRules[nextGlobalIdx], allRules[currentGlobalIdx]];
            }

            await this.plugin.saveSettings();
            this.render();
          }
        };
        if (index === folderRules.length - 1) downBtn.disabled = true;

        // Duplicate button
        const duplicateBtn = ruleControls.createEl("button", {
          text: "⎘",
          cls: "sf-rule-arrow-btn",
          attr: { title: "Duplicate rule" }
        });
        duplicateBtn.onclick = async () => {
          // Create deep copy of the rule with proper handling of composite conditions
          const duplicatedRule: SimpleRule = {
            id: nanoid(),
            name: `${rule.name} (copy)`,
            enabled: false, // Start disabled to prevent accidental execution
            folderPath: rule.folderPath,
            scopeFolder: rule.scopeFolder,
            condition: JSON.parse(JSON.stringify(rule.condition)), // Deep copy handles both single and composite
            action: {
              type: rule.action.type,
              targetFolder: rule.action.targetFolder,
              tag: rule.action.tag,
              field: rule.action.field,
              value: rule.action.value,
              lazyMatch: rule.action.lazyMatch
            }
          };

          // Find global index and insert after current rule
          const allRules = this.plugin.settings.rules;
          const globalIndex = allRules.findIndex((r) => r.id === rule.id);
          if (globalIndex >= 0) {
            allRules.splice(globalIndex + 1, 0, duplicatedRule);
            await this.plugin.saveSettings();
            this.render();
          }
        };

        // Delete button
        const delBtn = ruleControls.createEl("button", { text: "Delete", cls: "mod-warning" });
        delBtn.onclick = async () => {
          const confirmed = await confirmDeletion(this.app, rule.name || "this rule");
          if (confirmed) {
            const allRules = this.plugin.settings.rules;
            const globalIndex = allRules.findIndex((r) => r.id === rule.id);
            if (globalIndex >= 0) {
              allRules.splice(globalIndex, 1);
              await this.plugin.saveSettings();
              this.render();
            }
          }
        };

        // Rule body
        const ruleBody = ruleCard.createDiv({ cls: "sf-rule-card-body" });

        // Migrate legacy rules (only for single conditions)
        if (!isCompositeCondition(rule.condition)) {
          if ((rule.condition.type as any) === "frontmatter-equals") {
            rule.condition.type = "frontmatter";
            rule.condition.operator = "equals";
          }
          if (!rule.condition.operator) {
            rule.condition.operator = rule.condition.type === "tag" ? "has" : "equals";
          }
        }

        // Scope section
        const scopeRow = ruleBody.createDiv({ cls: "sf-rule-row" });
        scopeRow.createSpan({ text: "Scope:", cls: "sf-rule-label" });

        const scopeInput = scopeRow.createEl("input", {
          type: "text",
          placeholder: this.folder,
          cls: "sf-rule-input sf-rule-input-wide"
        });
        scopeInput.value = rule.scopeFolder || this.folder;
        scopeInput.oninput = () => {
          rule.scopeFolder = scopeInput.value || this.folder;
          this.markDirty();
        };

        const scopeBrowseBtn = scopeRow.createEl("button", {
          text: "Browse",
          cls: "sf-rule-browse-btn"
        });
        scopeBrowseBtn.onclick = () => {
          new FolderPickerModal(this.app, (folder) => {
            const folderPath = folder.path || "/";
            scopeInput.value = folderPath;
            rule.scopeFolder = folderPath;
            this.markDirty();
          }).open();
        };

        scopeRow.createSpan({
          text: "(Where to search for files)",
          cls: "sf-rule-hint"
        });

        // Condition section - handles both single and composite conditions
        const conditionSection = ruleBody.createDiv({ cls: "sf-condition-section" });
        const isComposite = isCompositeCondition(rule.condition);

        if (isComposite) {
          // Render composite condition (multiple conditions with AND/OR)
          const headerRow = conditionSection.createDiv({ cls: "sf-rule-row" });
          headerRow.createSpan({ text: "When:", cls: "sf-rule-label" });

          const logicSelect = headerRow.createEl("select", { cls: "sf-rule-select" });
          logicSelect.createEl("option", { text: "ALL conditions match (AND)", value: "AND" });
          logicSelect.createEl("option", { text: "ANY condition matches (OR)", value: "OR" });
          logicSelect.value = isCompositeCondition(rule.condition) ? rule.condition.operator : "AND";
          logicSelect.onchange = () => {
            if (isCompositeCondition(rule.condition)) {
              rule.condition.operator = logicSelect.value as "AND" | "OR";
              this.markDirty();
            }
          };

          // Render each condition
          if (isCompositeCondition(rule.condition)) {
            rule.condition.conditions.forEach((cond, idx) => {
              this.renderSingleConditionRow(conditionSection, cond, idx, () => {
                // Remove condition callback
                if (isCompositeCondition(rule.condition) && rule.condition.conditions.length > 1) {
                  rule.condition.conditions.splice(idx, 1);
                  // If only one condition left, convert back to single
                  if (rule.condition.conditions.length === 1) {
                    rule.condition = rule.condition.conditions[0];
                  }
                  this.markDirty();
                  this.render();
                }
              });
            });
          }

          // Add condition button
          const addCondRow = conditionSection.createDiv({ cls: "sf-rule-row" });
          const addCondBtn = addCondRow.createEl("button", { text: "+ Add Condition", cls: "sf-add-condition-btn" });
          addCondBtn.onclick = () => {
            if (isCompositeCondition(rule.condition)) {
              rule.condition.conditions.push({
                type: "frontmatter",
                operator: "equals",
                field: "",
                value: ""
              });
              this.markDirty();
              this.render();
            }
          };
        } else {
          // Render single condition with option to add more
          const conditionRow = conditionSection.createDiv({ cls: "sf-rule-row" });
          conditionRow.createSpan({ text: "When:", cls: "sf-rule-label" });

          this.renderSingleConditionInputs(conditionRow, rule.condition as SingleCondition);

          // Add condition button to convert to composite
          const addCondBtn = conditionRow.createEl("button", { text: "+ Add Condition", cls: "sf-add-condition-btn" });
          addCondBtn.onclick = () => {
            // Convert single condition to composite
            const currentCondition = JSON.parse(JSON.stringify(rule.condition)) as SingleCondition;
            rule.condition = {
              operator: "AND",
              conditions: [
                currentCondition,
                { type: "frontmatter", operator: "equals", field: "", value: "" }
              ]
            };
            this.markDirty();
            this.render();
          };
        }

        // Action section
        const actionRow = ruleBody.createDiv({ cls: "sf-rule-row" });
        actionRow.createSpan({ text: "Then:", cls: "sf-rule-label" });

        const actionTypeSelect = actionRow.createEl("select", { cls: "sf-rule-select" });
        actionTypeSelect.createEl("option", { text: "Move to folder", value: "move-file" });
        actionTypeSelect.createEl("option", { text: "Quarantine", value: "quarantine" });
        actionTypeSelect.createEl("option", { text: "Highlight", value: "highlight" });
        actionTypeSelect.createEl("option", { text: "Add tag", value: "add-tag" });
        actionTypeSelect.createEl("option", { text: "Remove tag", value: "remove-tag" });
        actionTypeSelect.createEl("option", { text: "Set frontmatter", value: "set-frontmatter" });
        actionTypeSelect.createEl("option", { text: "Remove frontmatter", value: "remove-frontmatter" });
        actionTypeSelect.value = rule.action.type;
        actionTypeSelect.onchange = () => {
          rule.action.type = actionTypeSelect.value as any;
          this.markDirty();
          this.render(); // Re-render to show appropriate fields
        };

        // Dynamic action fields based on type
        if (rule.action.type === "move-file") {
          const targetInput = actionRow.createEl("input", {
            type: "text",
            placeholder: "target/folder/path",
            cls: "sf-rule-input sf-rule-input-wide"
          });
          targetInput.value = rule.action.targetFolder || "";
          targetInput.oninput = () => {
            rule.action.targetFolder = targetInput.value;
            this.markDirty();
          };

          const browseBtn = actionRow.createEl("button", { text: "Browse", cls: "sf-rule-browse-btn" });
          browseBtn.onclick = () => {
            new FolderPickerModal(this.app, (folder) => {
              const folderPath = folder.path || "/";
              targetInput.value = folderPath;
              rule.action.targetFolder = folderPath;
              this.markDirty();
            }).open();
          };

          // Lazy match checkbox (only for move-file)
          const lazyMatchRow = ruleBody.createDiv({ cls: "sf-rule-row sf-rule-checkbox-row" });

          const lazyCheckbox = lazyMatchRow.createEl("input", {
            type: "checkbox",
            cls: "sf-rule-checkbox"
          });
          lazyCheckbox.checked = rule.action.lazyMatch ?? false;
          lazyCheckbox.onchange = () => {
            rule.action.lazyMatch = lazyCheckbox.checked;
            this.markDirty();
          };

          const lazyLabel = lazyMatchRow.createEl("label", {
            text: "Skip if already in folder or subfolders",
            cls: "sf-rule-checkbox-label"
          });
          lazyLabel.onclick = () => {
            lazyCheckbox.checked = !lazyCheckbox.checked;
            rule.action.lazyMatch = lazyCheckbox.checked;
            this.markDirty();
          };
        } else if (rule.action.type === "add-tag" || rule.action.type === "remove-tag") {
          const tagInput = actionRow.createEl("input", {
            type: "text",
            placeholder: "tag (with or without #)",
            cls: "sf-rule-input"
          });
          tagInput.value = rule.action.tag || "";
          tagInput.oninput = () => {
            rule.action.tag = tagInput.value;
            this.markDirty();
          };
        } else if (rule.action.type === "set-frontmatter") {
          const fieldInput = actionRow.createEl("input", {
            type: "text",
            placeholder: "field name",
            cls: "sf-rule-input"
          });
          fieldInput.value = rule.action.field || "";
          fieldInput.oninput = () => {
            rule.action.field = fieldInput.value;
            this.markDirty();
          };

          actionRow.createSpan({ text: "=", cls: "sf-rule-operator" });

          const valueInput = actionRow.createEl("input", {
            type: "text",
            placeholder: "value",
            cls: "sf-rule-input"
          });
          valueInput.value = rule.action.value || "";
          valueInput.oninput = () => {
            rule.action.value = valueInput.value;
            this.markDirty();
          };
        } else if (rule.action.type === "remove-frontmatter") {
          const fieldInput = actionRow.createEl("input", {
            type: "text",
            placeholder: "field name",
            cls: "sf-rule-input"
          });
          fieldInput.value = rule.action.field || "";
          fieldInput.oninput = () => {
            rule.action.field = fieldInput.value;
            this.markDirty();
          };
        }
      });
    }

    // Subfolders section at the bottom
    const subfolders = this.getDescendantFolders(this.folder);
    if (subfolders.length > 0) {
      const subfoldersSection = containerEl.createDiv({ cls: "sf-subfolders-section" });
      subfoldersSection.createEl("h3", { text: "Descendant Folders" });

      subfolders.forEach((folderPath) => {
        const folderPolicy = getOrCreatePolicy(this.plugin.settings, folderPath);
        const isEnabled = folderPolicy.enabled ?? true;

        // Count rules for this folder
        const ruleCount = this.plugin.settings.rules.filter((r) => normalize(r.folderPath) === normalize(folderPath)).length;

        const row = subfoldersSection.createDiv({ cls: "sf-subfolder-row" });

        const folderName = row.createEl("span", {
          text: this.getRelativePath(folderPath, this.folder),
          cls: "sf-subfolder-name"
        });
        folderName.onclick = () => {
          this.folder = folderPath;
          this.render();
        };

        if (ruleCount > 0) {
          row.createEl("span", {
            text: `${ruleCount} rules`,
            cls: "sf-subfolder-rule-count"
          });
        }

        const toggleSwitch = row.createDiv({ cls: "smart-folders-toggle-switch sf-small-toggle" });
        toggleSwitch.createDiv({ cls: isEnabled ? "slider slider-on" : "slider" });

        toggleSwitch.onclick = async (e) => {
          e.stopPropagation();
          folderPolicy.enabled = !isEnabled;
          setPolicy(this.plugin.settings, folderPath, folderPolicy);
          await this.plugin.saveSettings();
          this.render();
        };
      });
    }

    // Quarantined Files section
    const policy = this.plugin.manager?.getEffectivePolicy(this.folder);
    if (policy) {
      const quarantinePath = policy.quarantinePath || this.plugin.settings.defaultQuarantinePath;

      // Log quarantine search to audit log
      await this.plugin.manager?.logDebug(
        this.folder,
        `Quarantine View: Looking for quarantine folder at: ${quarantinePath}`
      );

      const quarantineFolder = this.app.vault.getAbstractFileByPath(normalize(quarantinePath));

      await this.plugin.manager?.logDebug(
        this.folder,
        `Quarantine View: Found folder: ${quarantineFolder ? quarantineFolder.path : 'null/not found'}`
      );

      if (quarantineFolder instanceof TFolder) {
        // Recursively collect all files in quarantine folder
        const quarantinedFiles: TFile[] = [];
        const collectFiles = (folder: TFolder) => {
          folder.children.forEach(child => {
            if (child instanceof TFile) {
              quarantinedFiles.push(child);
            } else if (child instanceof TFolder) {
              collectFiles(child);
            }
          });
        };
        collectFiles(quarantineFolder);

        await this.plugin.manager?.logDebug(
          this.folder,
          `Quarantine View: Found ${quarantinedFiles.length} files in quarantine (${quarantinedFiles.map(f => f.path).join(', ')})`
        );

        if (quarantinedFiles.length > 0) {
          const quarantineSection = containerEl.createDiv({ cls: "sf-quarantine-section" });
          quarantineSection.createEl("h3", { text: `Quarantined Files (${quarantinePath})` });

          quarantinedFiles.forEach((file) => {
            const row = quarantineSection.createDiv({ cls: "sf-quarantine-row" });

            // Show relative path from quarantine root
            const relativePath = file.path.startsWith(quarantinePath + "/")
              ? file.path.substring(quarantinePath.length + 1)
              : file.name;

            const fileName = row.createEl("span", {
              text: relativePath,
              cls: "sf-quarantine-filename"
            });
            fileName.onclick = () => {
              // Open the file
              this.app.workspace.getLeaf().openFile(file);
            };

            const actions = row.createDiv({ cls: "sf-quarantine-actions" });

            const allowBtn = actions.createEl("button", {
              text: "Allow",
              cls: "sf-quarantine-btn"
            });
            allowBtn.onclick = async (e) => {
              e.stopPropagation();
              try {
                // Calculate original path before restoring
                const originalPath = file.path.startsWith(quarantinePath + "/")
                  ? file.path.substring(quarantinePath.length + 1)
                  : file.path;

                await this.plugin.manager?.logDebug(
                  this.folder,
                  `Quarantine Allow clicked: folder="${this.folder}", quarantined="${file.path}", original="${originalPath}"`
                );

                // Restore the file first
                await this.plugin.manager?.restoreFromQuarantine(file.path, quarantinePath);

                // Then add as exception using the original path
                this.plugin.manager?.addException(this.folder, originalPath);
                await this.plugin.saveSettings();

                const exceptions = this.plugin.manager?.getExceptions(this.folder) ?? [];
                await this.plugin.manager?.logDebug(
                  this.folder,
                  `After adding exception, exceptions list: ${JSON.stringify(exceptions)}`
                );

                // Recheck policy to clear violations for exceptions
                await this.plugin.manager?.handlePolicyChange(this.folder, false);

                this.render();
              } catch (error) {
                new Notice(`Error allowing ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
              }
            };

            const restoreBtn = actions.createEl("button", {
              text: "Restore",
              cls: "sf-quarantine-btn"
            });
            restoreBtn.onclick = async (e) => {
              e.stopPropagation();
              try {
                await this.plugin.manager?.restoreFromQuarantine(file.path, quarantinePath);
                this.render(); // Refresh the view
              } catch (error) {
                new Notice(`Error restoring ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
              }
            };

            const deleteBtn = actions.createEl("button", {
              text: "Delete",
              cls: "sf-quarantine-btn mod-warning"
            });
            deleteBtn.onclick = async (e) => {
              e.stopPropagation();
              if (await confirmDeletion(this.app, file.name)) {
                await this.plugin.manager?.deletePath(file.path);
                this.render();
              }
            };
          });
        }
      }
    }

    } catch (error) {
      console.error("Smart Folders render error:", error);
      containerEl.createEl("div", {
        text: `Error rendering view: ${error instanceof Error ? error.message : String(error)}`,
        cls: "mod-warning"
      });
    }
  }

  private renderSingleConditionRow(
    container: HTMLElement,
    condition: SingleCondition,
    index: number,
    onRemove: () => void
  ) {
    const row = container.createDiv({ cls: "sf-rule-row sf-condition-row" });
    row.createSpan({ text: `${index + 1}.`, cls: "sf-condition-number" });

    this.renderSingleConditionInputs(row, condition);

    const removeBtn = row.createEl("button", { text: "✕", cls: "sf-remove-condition-btn" });
    removeBtn.onclick = onRemove;
  }

  private renderSingleConditionInputs(container: HTMLElement, condition: SingleCondition) {
    const conditionTypeSelect = container.createEl("select", { cls: "sf-rule-select" });
    conditionTypeSelect.createEl("option", { text: "Frontmatter", value: "frontmatter" });
    conditionTypeSelect.createEl("option", { text: "Tag", value: "tag" });
    conditionTypeSelect.value = condition.type;
    conditionTypeSelect.onchange = () => {
      condition.type = conditionTypeSelect.value as ConditionType;
      // Set default operator for the new type
      if (condition.type === "tag") {
        condition.operator = "has";
      } else {
        condition.operator = "equals";
      }
      this.markDirty();
      this.render(); // Re-render to update UI
    };

    // Field/Tag input (before operator)
    if (condition.type === "frontmatter") {
      const fieldInput = container.createEl("input", {
        type: "text",
        placeholder: "field name",
        cls: "sf-rule-input"
      });
      fieldInput.value = condition.field || "";
      fieldInput.oninput = () => {
        condition.field = fieldInput.value;
        this.markDirty();
      };
    } else {
      // For tag conditions, show tag input first
      const tagInput = container.createEl("input", {
        type: "text",
        placeholder: "tag (with or without #)",
        cls: "sf-rule-input"
      });
      tagInput.value = condition.value || "";
      tagInput.oninput = () => {
        condition.value = tagInput.value;
        this.markDirty();
      };
    }

    // Operator dropdown (changes based on condition type)
    const operatorSelect = container.createEl("select", { cls: "sf-rule-select" });
    if (condition.type === "frontmatter") {
      operatorSelect.createEl("option", { text: "equals", value: "equals" });
      operatorSelect.createEl("option", { text: "does not equal", value: "not-equals" });
      operatorSelect.createEl("option", { text: "contains", value: "contains" });
      operatorSelect.createEl("option", { text: "does not contain", value: "not-contains" });
      operatorSelect.createEl("option", { text: "exists", value: "exists" });
      operatorSelect.createEl("option", { text: "does not exist", value: "not-exists" });
    } else {
      operatorSelect.createEl("option", { text: "exists", value: "has" });
      operatorSelect.createEl("option", { text: "does not exist", value: "does-not-have" });
    }
    operatorSelect.value = condition.operator || "equals";
    operatorSelect.onchange = () => {
      condition.operator = operatorSelect.value as ConditionOperator | TagOperator;
      this.markDirty();
      this.render(); // Re-render to show/hide fields
    };

    // Value input (only for frontmatter with value-based operators)
    if (condition.type === "frontmatter") {
      const needsValue = condition.operator !== "exists" && condition.operator !== "not-exists";
      if (needsValue) {
        const valueInput = container.createEl("input", {
          type: "text",
          placeholder: "value",
          cls: "sf-rule-input"
        });
        valueInput.value = condition.value || "";
        valueInput.oninput = () => {
          condition.value = valueInput.value;
          this.markDirty();
        };
      }
    }
  }

  private markDirty() {
    this.isDirty = true;
    if (this.saveButtonEl) {
      this.saveButtonEl.disabled = false;
    }
  }

  private markClean() {
    this.isDirty = false;
    if (this.saveButtonEl) {
      this.saveButtonEl.disabled = true;
    }
  }

  private scheduleRecheck() {
    // Clear any existing timeout
    if (this.recheckTimeout) {
      clearTimeout(this.recheckTimeout);
    }

    // Schedule a recheck after 500ms of no changes (debounce)
    this.recheckTimeout = setTimeout(async () => {
      await this.plugin.manager?.handlePolicyChange(this.folder, false);
      this.render();
    }, 500);
  }

  private isFolderIgnored(folderPath: string): boolean {
    const ignoredFolders = this.plugin.settings.ignoredFolders || [];
    const normalizedPath = normalize(folderPath);
    for (const ignored of ignoredFolders) {
      const normalizedIgnored = normalize(ignored);
      if (normalizedPath === normalizedIgnored || normalizedPath.startsWith(normalizedIgnored + "/")) {
        return true;
      }
    }
    return false;
  }

  private async countFilesInFolderTree(folderPath: string): Promise<number> {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) return 0;

    let count = 0;
    const countRecursive = (f: TFolder) => {
      for (const child of f.children) {
        if (child instanceof TFile) {
          count++;
        } else if (child instanceof TFolder) {
          countRecursive(child);
        }
      }
    };
    countRecursive(folder);
    return count;
  }

  private async runRulesForFolder(folderPath: string): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) return;

    // Clear existing highlight violations before rescanning
    this.plugin.manager?.clearHighlightViolations(folderPath);

    const filesToProcess: TFile[] = [];
    const collectFiles = (f: TFolder) => {
      for (const child of f.children) {
        if (child instanceof TFile) {
          filesToProcess.push(child);
        } else if (child instanceof TFolder) {
          collectFiles(child);
        }
      }
    };
    collectFiles(folder);

    // Process files in batches
    for (const file of filesToProcess) {
      try {
        await this.plugin.manager?.processFile(file, "manual-run");
      } catch (error) {
        console.error(`Error processing ${file.path}:`, error);
      }
    }
  }

  private getDescendantFolders(folderPath: string): string[] {
    const folder = this.app.vault.getAbstractFileByPath(normalize(folderPath) || "/");
    if (!(folder instanceof TFolder)) return [];

    const descendants: string[] = [];
    const collectDescendants = (f: TFolder) => {
      for (const child of f.children) {
        if (child instanceof TFolder) {
          if (!this.isFolderIgnored(child.path)) {
            descendants.push(child.path);
            collectDescendants(child);
          }
        }
      }
    };
    collectDescendants(folder);
    return descendants.sort();
  }

  private getRelativePath(fullPath: string, basePath: string): string {
    const normBase = normalize(basePath);
    const normFull = normalize(fullPath);

    if (normBase === "/") {
      return normFull;
    }

    if (normFull.startsWith(normBase + "/")) {
      return normFull.slice(normBase.length + 1);
    }

    return normFull;
  }
}

function renderChips(violations: import("../types").Violation[]) {
  const existing = document.querySelector(".smart-folders-chips");
  if (existing) existing.remove();
  const container = document.querySelector(".smart-folders-toolbar");
  if (!container) return;
  const chips = container.createDiv({ cls: "smart-folders-chips" });
  if (violations.length > 0) {
    chips.createSpan({ cls: "sf-chip sf-chip-warn", text: "Violations pending" });
  }
}

function renderBreadcrumb(container: HTMLElement, folder: string, onNavigate: (folder: string) => void) {
  container.empty();
  const norm = normalize(folder);
  const parts = norm === "/" ? [] : norm.split("/").filter((p) => p.length > 0);
  const segments = ["/"];
  parts.reduce((acc, cur) => {
    // Build paths without leading slash (except for root)
    const next = acc === "/" ? cur : `${acc}/${cur}`;
    segments.push(next);
    return next;
  }, "/");

  segments.forEach((seg, idx) => {
    if (idx > 0) {
      container.createSpan({ text: " › " });
    }
    const label = seg === "/" ? "/" : seg.split("/").pop() ?? seg;
    const link = container.createEl("a", { text: label, href: "#" });
    link.onclick = (evt) => {
      evt.preventDefault();
      onNavigate(seg);
    };
  });
}

function normalize(folder: string): string {
  if (!folder || folder === "/") return "/";
  // Replace backslashes, remove trailing slash, remove leading slash
  return folder.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function trimPath(fullPath: string, scopeFolder: string, plugin: SmartFoldersPlugin): string {
  const normScope = normalize(scopeFolder);
  const normFull = normalize(fullPath);
  let trimmed: string;
  if (normScope !== "/" && normFull.startsWith(normScope + "/")) {
    trimmed = normFull.slice(normScope.length + 1);
  } else {
    trimmed = normFull.split("/").pop() ?? normFull;
  }

  // Check if this is a folder and add trailing slash
  const file = plugin.app.vault.getAbstractFileByPath(fullPath);
  if (file instanceof TFolder) {
    return trimmed + "/";
  }
  return trimmed;
}

function getOrCreatePolicy(settings: SmartFoldersSettings, folder: string) {
  const path = normalize(folder);
  if (!settings.folderPolicies[path]) {
    settings.folderPolicies[path] = {
      contentPolicy: "any",
      quarantinePath: undefined,
    };
  }
  return settings.folderPolicies[path];
}

function setPolicy(settings: SmartFoldersSettings, folder: string, policy: FolderPolicy) {
  settings.folderPolicies[normalize(folder)] = policy;
}

function labelForPolicy(policy: ContentPolicy): string {
  switch (policy) {
    case "any":
      return "Any";
    case "files-only":
      return "Files only";
    case "folders-only":
      return "Folders only";
    case "locked":
      return "Locked";
  }
}

function formatRuleAsSentence(rule: SimpleRule): string {
  // Format condition
  let condition = "When: ";

  if (isCompositeCondition(rule.condition)) {
    // Format composite condition
    const operator = rule.condition.operator === "AND" ? "ALL" : "ANY";
    condition += `${operator} of: `;
    const conditionStrings = rule.condition.conditions.map((cond, idx) => {
      let condStr = "";
      if (cond.type === "frontmatter") {
        const field = cond.field || "field";
        const op = cond.operator || "equals";
        const value = cond.value || "";

        switch (op) {
          case "equals":
            condStr = `\`${field}\` = \`${value}\``;
            break;
          case "not-equals":
            condStr = `\`${field}\` ≠ \`${value}\``;
            break;
          case "contains":
            condStr = `\`${field}\` contains \`${value}\``;
            break;
          case "not-contains":
            condStr = `\`${field}\` !contains \`${value}\``;
            break;
          case "exists":
            condStr = `\`${field}\` exists`;
            break;
          case "not-exists":
            condStr = `\`${field}\` !exists`;
            break;
        }
      } else if (cond.type === "tag") {
        const tag = cond.value || "tag";
        const op = cond.operator || "has";
        condStr = op === "has" ? `tag \`${tag}\`` : `!tag \`${tag}\``;
      }
      return `(${idx + 1}) ${condStr}`;
    });
    condition += conditionStrings.join(", ");
  } else {
    // Format single condition
    if (rule.condition.type === "frontmatter") {
      const field = rule.condition.field || "field";
      const operator = rule.condition.operator || "equals";
      const value = rule.condition.value || "";

      switch (operator) {
        case "equals":
          condition += `Frontmatter \`${field}\` equals \`${value}\``;
          break;
        case "not-equals":
          condition += `Frontmatter \`${field}\` does not equal \`${value}\``;
          break;
        case "contains":
          condition += `Frontmatter \`${field}\` contains \`${value}\``;
          break;
        case "not-contains":
          condition += `Frontmatter \`${field}\` does not contain \`${value}\``;
          break;
        case "exists":
          condition += `Frontmatter \`${field}\` exists`;
          break;
        case "not-exists":
          condition += `Frontmatter \`${field}\` does not exist`;
          break;
      }
    } else if (rule.condition.type === "tag") {
      const tag = rule.condition.value || "tag";
      const operator = rule.condition.operator || "has";

      if (operator === "has") {
        condition += `Tag \`${tag}\` exists`;
      } else {
        condition += `Tag \`${tag}\` does not exist`;
      }
    }
  }

  // Format action
  let action = " Then: ";
  switch (rule.action.type) {
    case "move-file":
      action += `Move to \`${rule.action.targetFolder || "folder"}\``;
      break;
    case "quarantine":
      action += `Quarantine (move to configured quarantine path)`;
      break;
    case "highlight":
      action += `Highlight as violation (no file modification)`;
      break;
    case "add-tag":
      action += `Add tag \`${rule.action.tag || "tag"}\``;
      break;
    case "remove-tag":
      action += `Remove tag \`${rule.action.tag || "tag"}\``;
      break;
    case "set-frontmatter":
      action += `Set frontmatter \`${rule.action.field || "field"}\` = \`${rule.action.value || "value"}\``;
      break;
    case "remove-frontmatter":
      action += `Remove frontmatter \`${rule.action.field || "field"}\``;
      break;
  }

  return condition + action;
}

async function confirmDeletion(app: App, itemName: string): Promise<boolean> {
  return new Promise((resolve) => {
    class ConfirmModal extends Modal {
      constructor(app: App) {
        super(app);
      }

      onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Confirm deletion" });
        contentEl.createEl("p", { text: `Are you sure you want to permanently delete "${itemName}"? This action cannot be undone.` });

        const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

        const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
        cancelBtn.onclick = () => {
          this.close();
          resolve(false);
        };

        const confirmBtn = buttonContainer.createEl("button", { text: "Delete", cls: "mod-warning" });
        confirmBtn.onclick = () => {
          this.close();
          resolve(true);
        };
      }

      onClose() {
        const { contentEl } = this;
        contentEl.empty();
      }
    }

    const modal = new ConfirmModal(app);
    modal.open();
  });
}
