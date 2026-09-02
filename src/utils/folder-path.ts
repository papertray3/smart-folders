/**
 * Canonical folder-path normalization used as the key format for
 * SmartFoldersSettings.folderPolicies. Root is "/"; everything else has no
 * leading or trailing slash. Kept separate from Obsidian's own
 * normalizePath(), which uses different conventions (e.g. for root) and
 * would silently break folderPolicies lookups if used interchangeably.
 */
export function normalizeFolderPath(folder: string): string {
  if (!folder || folder === "/") return "/";
  return folder.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}
