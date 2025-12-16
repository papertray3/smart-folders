import { Setting } from "obsidian";
import { SimpleRule, SingleCondition, isCompositeCondition } from "../types";

type SaveRule = (rule: SimpleRule) => Promise<void>;

export function renderRuleForm(containerEl: HTMLElement, rule: SimpleRule, onSave: SaveRule) {
  const working: SimpleRule = JSON.parse(JSON.stringify(rule));
  let dirty = false;
  let saveBtn: ReturnType<Setting["addButton"]> | null = null;
  let pendingEnable = false;

  // This form only supports single conditions
  if (isCompositeCondition(working.condition)) {
    containerEl.createEl("p", {
      text: "This form does not support composite conditions. Please use the main rule builder.",
      cls: "mod-warning"
    });
    return;
  }

  const condition = working.condition as SingleCondition;

  const setDirty = () => {
    dirty = true;
    if (saveBtn) saveBtn.setDisabled(false);
    else pendingEnable = true;
  };

  new Setting(containerEl)
    .setName("Enabled")
    .addToggle((t) => t.setValue(working.enabled).onChange((v) => {
      working.enabled = v;
      setDirty();
    }));

  new Setting(containerEl)
    .setName("Rule name")
    .addText((t) => t.setValue(working.name).onChange((v) => {
      working.name = v || "Frontmatter equals → move";
      setDirty();
    }));

  new Setting(containerEl)
    .setName("Scope folder")
    .setDesc("Folder where this rule applies (use '/' for entire vault)")
    .addText((t) =>
      t
        .setPlaceholder("/")
        .setValue(working.scopeFolder)
        .onChange((v) => {
          working.scopeFolder = normalize(v);
          setDirty();
        })
    );

  new Setting(containerEl)
    .setName("Frontmatter field")
    .setDesc("YAML key to watch")
    .addText((t) => t.setValue(condition.field || "").onChange((v) => {
      condition.field = v.trim();
      setDirty();
    }));

  new Setting(containerEl)
    .setName("Value")
    .setDesc("Matches exact string or array entry")
    .addText((t) => t.setValue(condition.value || "").onChange((v) => {
      condition.value = v;
      setDirty();
    }));

  new Setting(containerEl)
    .setName("Target folder")
    .setDesc("Folder path to move the file into")
    .addText((t) =>
      t
        .setPlaceholder("e.g. Notes/Processed")
        .setValue(working.action.targetFolder || "")
        .onChange((v) => {
          working.action.targetFolder = v.trim();
          setDirty();
        })
    );

  const saveSetting = new Setting(containerEl);
  saveBtn = saveSetting.addButton((btn) => {
    btn.setButtonText("Save").setCta().onClick(async () => {
      if (dirty) {
        await onSave({ ...working, scopeFolder: normalize(working.scopeFolder) });
        dirty = false;
        btn.setDisabled(true);
      }
    });
  });
  saveSetting.addExtraButton((btn) =>
    btn
      .setIcon("cross")
      .setTooltip("Reset changes")
      .onClick(() => {
        dirty = false;
        containerEl.empty();
        renderRuleForm(containerEl, rule, onSave);
      })
  );
  saveBtn.setDisabled(!pendingEnable ? true : false);
  if (pendingEnable) {
    saveBtn.setDisabled(false);
    pendingEnable = false;
  }
}

function normalize(folder: string): string {
  const trimmed = (folder || "").trim();
  if (!trimmed || trimmed === "/") return "/";
  return trimmed.replace(/\\/g, "/").replace(/\/$/, "");
}
