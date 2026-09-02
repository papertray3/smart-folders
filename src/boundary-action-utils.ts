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
