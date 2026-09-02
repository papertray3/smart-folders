import { App, Command, FuzzySuggestModal } from "obsidian";

interface AppWithCommands extends App {
  commands: {
    commands: Record<string, Command>;
    executeCommandById(id: string): boolean;
  };
}

export class CommandPickerModal extends FuzzySuggestModal<Command> {
  constructor(app: App, private onChoose: (command: Command) => void) {
    super(app);
    this.setPlaceholder("Select a command");
  }

  getItems(): Command[] {
    // app.commands isn't part of the public obsidian.d.ts surface, but it's the
    // standard community-plugin way to enumerate registered commands - there's
    // no public alternative.
    const commands = (this.app as AppWithCommands).commands?.commands ?? {};
    return Object.values(commands).sort((a, b) => a.name.localeCompare(b.name));
  }

  getItemText(item: Command): string {
    return item.name;
  }

  onChooseItem(item: Command): void {
    this.onChoose(item);
  }
}
