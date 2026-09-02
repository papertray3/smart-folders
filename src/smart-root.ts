import { normalizeFolderPath } from "./utils/folder-path";

/**
 * Return the shallowest configured Smart Folders paths, preserving their
 * configuration order. These are the usable entry points when vault root is
 * ignored or when a vault deliberately has more than one managed tree.
 */
export function findSmartFolderRoots(
  configuredPaths: string[],
  ignoredFolders: string[],
): string[] {
  const candidates = uniqueNormalizedPaths(configuredPaths).filter(
    (path) => path !== "/" && !isIgnoredPath(path, ignoredFolders),
  );

  return candidates.filter(
    (candidate) => !candidates.some(
      (other) => other !== candidate && containsPath(other, candidate),
    ),
  );
}

export function isIgnoredPath(path: string, ignoredFolders: string[]): boolean {
  const normalizedPath = normalizeFolderPath(path);
  return ignoredFolders.some((ignored) => {
    const normalizedIgnored = normalizeFolderPath(ignored);
    if (normalizedIgnored === "/") return normalizedPath === "/";
    return normalizedPath === normalizedIgnored
      || normalizedPath.startsWith(`${normalizedIgnored}/`);
  });
}

function uniqueNormalizedPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.reduce<string[]>((result, path) => {
    const normalized = normalizeFolderPath(path);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
    return result;
  }, []);
}

function containsPath(folderPath: string, candidatePath: string): boolean {
  if (folderPath === "/") return true;
  return candidatePath === folderPath || candidatePath.startsWith(`${folderPath}/`);
}
