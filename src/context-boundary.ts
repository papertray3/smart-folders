import { FolderPolicy } from "./types";
import { normalizeFolderPath } from "./utils/folder-path";

export interface ContextBoundary {
  folderPath: string;
  hubPage: string;
}

export interface ContextBoundaryConflict {
  type: "ancestor" | "descendant";
  boundary: ContextBoundary;
}

export function getContextBoundaries(policies: Record<string, FolderPolicy>): ContextBoundary[] {
  return Object.entries(policies)
    .filter(([, policy]) => policy.contextBoundary === true && Boolean(policy.hubPage))
    .map(([folderPath, policy]) => ({
      folderPath: normalizeFolderPath(folderPath),
      hubPage: policy.hubPage as string,
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

/** All context boundaries nested beneath (not equal to) the given folder. */
export function getDescendantBoundaries(
  folderPath: string,
  policies: Record<string, FolderPolicy>,
): ContextBoundary[] {
  const normalizedFolder = normalizeFolderPath(folderPath);
  return getContextBoundaries(policies).filter(
    (boundary) => boundary.folderPath !== normalizedFolder && containsPath(normalizedFolder, boundary.folderPath),
  );
}

export function getContextBoundaryConflict(
  folderPath: string,
  policies: Record<string, FolderPolicy>,
): ContextBoundaryConflict | undefined {
  const normalizedFolder = normalizeFolderPath(folderPath);
  const boundaries = getContextBoundaries(policies).filter(
    (boundary) => boundary.folderPath !== normalizedFolder,
  );

  const ancestor = boundaries
    .filter((boundary) => containsPath(boundary.folderPath, normalizedFolder))
    .sort((a, b) => pathDepth(b.folderPath) - pathDepth(a.folderPath))[0];
  if (ancestor) return { type: "ancestor", boundary: ancestor };

  const descendant = boundaries
    .filter((boundary) => containsPath(normalizedFolder, boundary.folderPath))
    .sort((a, b) => pathDepth(a.folderPath) - pathDepth(b.folderPath))[0];
  return descendant ? { type: "descendant", boundary: descendant } : undefined;
}

function containsPath(folderPath: string, candidatePath: string): boolean {
  if (folderPath === "/") return true;
  return candidatePath === folderPath || candidatePath.startsWith(`${folderPath}/`);
}

function pathDepth(path: string): number {
  return path === "/" ? 0 : path.split("/").length;
}
