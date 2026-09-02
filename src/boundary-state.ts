import { ContextBoundary } from "./context-boundary";

export interface BoundaryCandidate {
  boundary: ContextBoundary;
  /** push = descends from the current stack top; replace = unrelated to it. */
  kind: "push" | "replace";
}

type BoundaryTransition =
  | { type: "none" }
  | { type: "pop"; toIndex: number }
  | { type: "candidate"; candidate: BoundaryCandidate };

/**
 * Pure decision: given the current committed stack and the boundary detected
 * at the newly active file (if any), what should happen? Doesn't mutate
 * anything - BoundaryStack applies the result.
 */
function computeBoundaryTransition(
  stack: readonly ContextBoundary[],
  detected: ContextBoundary | undefined,
): BoundaryTransition {
  // Outside every boundary: the committed context is untouched, any pending candidate clears.
  if (!detected) return { type: "none" };

  const existingIndex = stack.findIndex((boundary) => boundary.folderPath === detected.folderPath);
  if (existingIndex !== -1) {
    // Already on the stack. Top of stack = no-op; anywhere else = free pop-back, no gate.
    return existingIndex === stack.length - 1 ? { type: "none" } : { type: "pop", toIndex: existingIndex };
  }

  const top = stack[stack.length - 1];
  if (top && isDescendantPath(top.folderPath, detected.folderPath)) {
    return { type: "candidate", candidate: { boundary: detected, kind: "push" } };
  }

  return { type: "candidate", candidate: { boundary: detected, kind: "replace" } };
}

function isDescendantPath(ancestor: string, candidate: string): boolean {
  if (ancestor === "/") return candidate !== "/";
  return candidate.startsWith(`${ancestor}/`);
}

/**
 * In-memory only, per 08-context-boundary-events.md - resets on every Obsidian
 * restart/plugin reload. Never persisted: see that doc's "Persistence" note
 * for why (green means actions already ran this session; restoring that
 * state across a restart is either misleading or triggers unwanted re-firing).
 */
export class BoundaryStack {
  private stack: ContextBoundary[] = [];
  private candidate: BoundaryCandidate | undefined;

  getStack(): readonly ContextBoundary[] {
    return this.stack;
  }

  getCandidate(): BoundaryCandidate | undefined {
    return this.candidate;
  }

  /** Call on every file-open with the boundary resolved for the newly active file (or path). */
  handleDetection(detected: ContextBoundary | undefined): void {
    const transition = computeBoundaryTransition(this.stack, detected);
    if (transition.type === "none") {
      this.candidate = undefined;
    } else if (transition.type === "pop") {
      this.stack = this.stack.slice(0, transition.toIndex + 1);
      this.candidate = undefined;
    } else {
      this.candidate = transition.candidate;
    }
  }

  /** The widget's yellow -> green click. No-op if there's no pending candidate. */
  commitCandidate(): void {
    if (!this.candidate) return;
    this.stack = this.candidate.kind === "push" ? [...this.stack, this.candidate.boundary] : [this.candidate.boundary];
    this.candidate = undefined;
  }

  /** Candidate dismissed without committing; stack is untouched. */
  dismissCandidate(): void {
    this.candidate = undefined;
  }
}
