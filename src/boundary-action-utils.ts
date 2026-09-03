import { ContextBoundary } from "./context-boundary";
import { BoundaryAction } from "./types";

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
  /** The boundary this action list is firing for (onEnter's new boundary, or onExit's exiting one). */
  boundary: ContextBoundary;
  /** onEnter only: whatever was current immediately before this commit, if anything. */
  previous?: ContextBoundary;
  /** onExit only: the boundary this transition is heading to. */
  next?: ContextBoundary;
}

function shortName(folderPath: string): string {
  if (folderPath === "/") return "/";
  return folderPath.split("/").pop() || folderPath;
}

/** Replaces {{boundary}}, {{previous}}, {{next}} with the relevant boundary's folder name. Unknown/unavailable tokens are left as-is. */
export function renderActionTemplate(text: string, context: BoundaryActionContext): string {
  return text.replace(/\{\{(boundary|previous|next)\}\}/g, (match, token: "boundary" | "previous" | "next") => {
    const boundary = token === "boundary" ? context.boundary : context[token];
    return boundary ? shortName(boundary.folderPath) : match;
  });
}
