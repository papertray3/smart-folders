import { ContextBoundary } from "./context-boundary";
import { BoundaryAction } from "./types";
import { disambiguateBoundaryLabels } from "./boundary-labels";

/** Target note for an action that references one, falling back to the firing boundary's hub page when unset. */
export function resolveActionNotePath(action: BoundaryAction, boundary: ContextBoundary): string | undefined {
  return action.notePath || boundary.hubPage;
}

/** Split "ClassName.methodName" into its parts. Returns undefined if malformed. */
export function parseCustomJsRef(ref: string): { className: string; methodName: string } | undefined {
  const dotIndex = ref.indexOf(".");
  if (dotIndex <= 0 || dotIndex === ref.length - 1) return undefined;
  return { className: ref.slice(0, dotIndex), methodName: ref.slice(dotIndex + 1) };
}

export interface BoundaryActionContext {
  /** The specific boundary this action list belongs to (the new one for onEnter, the exiting one for each onExit). */
  boundary: ContextBoundary;
  /** Whatever was current immediately before this commit, if anything. Same value for every action fired by one commit, enter or exit alike. */
  previous?: ContextBoundary;
  /** The boundary this transition is heading to. Same value for every action fired by one commit, enter or exit alike. */
  next?: ContextBoundary;
}

/**
 * Replaces {{boundary}}, {{previous}}, {{next}} with each boundary's
 * disambiguated label (see boundary-labels.ts - not just the last path
 * segment, since two boundaries can share a leaf folder name). Unknown or
 * currently-unavailable tokens are left as literal text rather than erroring.
 */
export function renderActionTemplate(text: string, context: BoundaryActionContext, allBoundaries: readonly ContextBoundary[]): string {
  const labels = disambiguateBoundaryLabels(allBoundaries);
  return text.replace(/\{\{(boundary|previous|next)\}\}/g, (match, token: "boundary" | "previous" | "next") => {
    const boundary = token === "boundary" ? context.boundary : context[token];
    return boundary ? labels.get(boundary.folderPath) ?? boundary.folderPath : match;
  });
}
