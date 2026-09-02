import { App, FuzzySuggestModal, TFile } from "obsidian";
import { normalizeFolderPath } from "../utils/folder-path";

export class NotePickerModal extends FuzzySuggestModal<TFile> {
  private normalizedFolder: string;

  constructor(app: App, folderPath: string, private onChoose: (file: TFile) => void) {
    super(app);
    this.normalizedFolder = normalizeFolderPath(folderPath);
    this.setPlaceholder(`Select a note in ${this.normalizedFolder}`);
  }

  getItems(): TFile[] {
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => normalizeFolderPath(file.parent?.path ?? "/") === this.normalizedFolder);
  }

  getItemText(item: TFile): string {
    return item.path;
  }

  onChooseItem(item: TFile): void {
    this.onChoose(item);
  }
}
