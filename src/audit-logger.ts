import { normalizePath, Vault } from "obsidian";

export interface AuditEntry {
  timestamp: string;
  operation: "policy-check" | "policy-violation" | "policy-quarantine" | "rule-match" | "rule-action" | "file-move" | "tag-add" | "tag-remove" | "frontmatter-set" | "debug";
  filePath: string;
  details: string;
  ruleName?: string;
  folderPath?: string;
}

type SettingsProvider = () => {
  auditLogEnabled: boolean;
  auditLogPath: string;
  auditEntriesPerFile: number;
};

export class AuditLogger {
  private currentFile: string | null = null;
  private entryCount: number = 0;

  constructor(private vault: Vault, private readonly settings: SettingsProvider) {}

  async log(entry: AuditEntry): Promise<void> {
    const config = this.settings();
    if (!config.auditLogEnabled) return;

    // Determine current log file
    const logFile = await this.getCurrentLogFile();

    // Format entry as markdown
    const markdown = this.formatEntry(entry);

    // Append to file
    const existing = await this.readOrCreateFile(logFile);
    const updated = existing + markdown;

    await this.vault.adapter.write(logFile, updated);
    this.entryCount++;

    // Check if we need to rotate to a new file
    if (this.entryCount >= config.auditEntriesPerFile) {
      this.currentFile = null;
      this.entryCount = 0;
    }
  }

  private async getCurrentLogFile(): Promise<string> {
    const config = this.settings();
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const basePath = normalizePath(config.auditLogPath);

    // If we already have a current file for today, use it
    if (this.currentFile && this.currentFile.includes(today)) {
      return this.currentFile;
    }

    // Find the next available file number for today
    let fileNum = 1;
    let filePath: string;

    while (true) {
      const suffix = fileNum === 1 ? "" : `-${fileNum}`;
      filePath = normalizePath(`${basePath}/${today}${suffix}.md`);

      if (!(await this.vault.adapter.exists(filePath))) {
        // File doesn't exist, we can use it
        this.currentFile = filePath;
        this.entryCount = 0;
        return filePath;
      }

      // File exists, check entry count
      const content = await this.vault.adapter.read(filePath);
      const entryCount = (content.match(/^## /gm) || []).length;

      if (entryCount < config.auditEntriesPerFile) {
        // This file has room
        this.currentFile = filePath;
        this.entryCount = entryCount;
        return filePath;
      }

      // This file is full, try next number
      fileNum++;
    }
  }

  private async readOrCreateFile(filePath: string): Promise<string> {
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));

    // Ensure directory exists
    if (!(await this.vault.adapter.exists(dir))) {
      await this.vault.createFolder(dir);
    }

    // Read existing file or create header
    if (await this.vault.adapter.exists(filePath)) {
      return await this.vault.adapter.read(filePath);
    }

    // Create new file with header
    const date = filePath.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || "unknown";
    return `# Smart Folders Audit Log - ${date}\n\n`;
  }

  private formatEntry(entry: AuditEntry): string {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const lines: string[] = [
      `## ${time} - ${entry.operation}`,
      `- **File**: \`${entry.filePath}\``,
    ];

    if (entry.folderPath) {
      lines.push(`- **Folder**: \`${entry.folderPath}\``,);
    }

    if (entry.ruleName) {
      lines.push(`- **Rule**: ${entry.ruleName}`);
    }

    lines.push(`- **Details**: ${entry.details}`);
    lines.push(""); // blank line

    return lines.join("\n") + "\n";
  }
}
