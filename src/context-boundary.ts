import { FolderPolicy } from "./types";
import { normalizeFolderPath } from "./utils/folder-path";

export interface ContextBoundary {
  folderPath: string;
  hubPage?: string;
}

export function getContextBoundaries(policies: Record<string, FolderPolicy>): ContextBoundary[] {
  return Object.entries(policies)
    .filter(([, policy]) => policy.contextBoundary === true)
    .map(([folderPath, policy]) => ({
      folderPath: normalizeFolderPath(folderPath),
      hubPage: policy.hubPage,
    }))
    .sort((a, b) => a.folderPath.localeCompare(b.folderPath));
}

export function resolveContextBoundary(
  path: string,
  policies: Record<string, FolderPolicy>,
): ContextBoundary | undefined {
  const normalizedPath = normalizeFolderPath(path);
  return getContextBoundaries(policies)
    .filter((boundary) => containsPath(boundary.folderPath, normalizedPath))
    .sort((a, b) => pathDepth(b.folderPath) - pathDepth(a.folderPath))[0];
}

function containsPath(folderPath: string, candidatePath: string): boolean {
  if (folderPath === "/") return true;
  return candidatePath === folderPath || candidatePath.startsWith(`${folderPath}/`);
}

function pathDepth(path: string): number {
  return path === "/" ? 0 : path.split("/").length;
}
