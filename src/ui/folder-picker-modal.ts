import { App, FuzzySuggestModal, TFolder } from "obsidian";

export class FolderPickerModal extends FuzzySuggestModal<TFolder> {
  constructor(app: App, private onChoose: (folder: TFolder) => void) {
    super(app);
    this.setPlaceholder("Select a folder");
  }

  getItems(): TFolder[] {
    const folders: TFolder[] = [];
    const vault = this.app.vault;
    const walk = (folder: TFolder) => {
      folders.push(folder);
      folder.children.forEach((child) => {
        if (child instanceof TFolder) walk(child);
      });
    };
    walk(vault.getRoot());
    return folders;
  }

  getItemText(item: TFolder): string {
    return item.path || "/";
  }

  onChooseItem(item: TFolder): void {
    this.onChoose(item);
  }
}
