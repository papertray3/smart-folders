import { App, FuzzySuggestModal, TFile } from "obsidian";

export class NotePickerModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private onChoose: (file: TFile) => void) {
    super(app);
    this.setPlaceholder("Select a note to use as the hub page");
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(item: TFile): string {
    return item.path;
  }

  onChooseItem(item: TFile): void {
    this.onChoose(item);
  }
}
