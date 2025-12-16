import { App, Modal } from "obsidian";
import { SmartFoldersSettings, SimpleRule } from "../types";
import { nanoid } from "../utils/nanoid";
import { renderRuleForm } from "./shared-rule-form";

type SaveHandler = (settings: SmartFoldersSettings) => Promise<void>;

export class RuleBuilderModal extends Modal {
  private working: SmartFoldersSettings;

  constructor(app: App, current: SmartFoldersSettings, private onSave: SaveHandler) {
    super(app);
    this.working = JSON.parse(JSON.stringify(current));
    if (!this.working.rules) this.working.rules = [];
    if (!this.working.rules.length) {
      this.working.rules.push(makeDefaultRule());
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Smart Folders – MVP Rule" });
    contentEl.createEl("p", {
      text: "Move a file when a frontmatter field equals the specified value.",
    });

    renderRuleForm(contentEl, this.working.rules[0], async (nextRule) => {
      this.working.rules[0] = nextRule;
      await this.onSave(this.working);
      this.close();
    });
  }
}

function makeDefaultRule(): SimpleRule {
  return {
    id: nanoid(),
    name: "Frontmatter equals → move",
    enabled: true,
    folderPath: "/",
    scopeFolder: "/",
    condition: { type: "frontmatter", operator: "equals", field: "status", value: "processed" },
    action: { type: "move-file", targetFolder: "_inbox/processed" },
  };
}
