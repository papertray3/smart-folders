import { ContextBoundary } from "./context-boundary";

/**
 * Human-readable label for each boundary, unique within the given set.
 * folderPath is already globally unique (no two vault folders can share a
 * path) and stays the real identity everywhere internally - this is purely
 * about what gets *displayed* (widget, stack menu, {{boundary}} template
 * tokens). Starts with just the folder's own name; for any boundaries that
 * collide on that, walks up parent segments - for the colliding ones only -
 * until every label in the set is distinct.
 */
export function disambiguateBoundaryLabels(boundaries: readonly ContextBoundary[]): Map<string, string> {
  const segmentsByPath = new Map<string, string[]>();
  for (const boundary of boundaries) {
    segmentsByPath.set(boundary.folderPath, boundary.folderPath === "/" ? ["/"] : boundary.folderPath.split("/"));
  }

  const labelAtDepth = (folderPath: string, depth: number): string => {
    const segments = segmentsByPath.get(folderPath) as string[];
    return segments.slice(-depth).join("/");
  };

  const labels = new Map<string, string>();
  for (const boundary of boundaries) {
    const segments = segmentsByPath.get(boundary.folderPath) as string[];
    let depth = 1;
    while (
      depth < segments.length &&
      boundaries.some(
        (other) => other.folderPath !== boundary.folderPath && labelAtDepth(other.folderPath, depth) === labelAtDepth(boundary.folderPath, depth)
      )
    ) {
      depth++;
    }
    labels.set(boundary.folderPath, labelAtDepth(boundary.folderPath, depth));
  }
  return labels;
}

/** Convenience single-lookup wrapper. Prefer disambiguateBoundaryLabels() directly when resolving several labels at once (e.g. rendering a whole stack). */
export function getBoundaryLabel(folderPath: string, boundaries: readonly ContextBoundary[]): string {
  return disambiguateBoundaryLabels(boundaries).get(folderPath) ?? folderPath;
}
