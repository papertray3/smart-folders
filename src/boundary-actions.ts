import { App, Notice, TFile, normalizePath } from "obsidian";
import { ContextBoundary } from "./context-boundary";
import { BoundaryAction } from "./types";
import { parseCustomJsRef, resolveActionNotePath } from "./boundary-action-utils";

interface AppWithCommands extends App {
  commands?: {
    executeCommandById(id: string): boolean;
  };
}

interface CustomJSWindow extends Window {
  cJS?: (moduleOrCallback?: string) => Promise<any>;
}

/**
 * Runs a boundary's On Enter/On Exit action list in order. Failures are
 * logged and skip to the next action rather than aborting the list - there's
 * no failure-aware transition engine here by design, see 08's Scope note.
 */
export async function runBoundaryActions(
  app: App,
  actions: BoundaryAction[] | undefined,
  boundary: ContextBoundary,
): Promise<void> {
  if (!actions?.length) return;
  for (const action of actions) {
    try {
      await runOne(app, action, boundary);
    } catch (error) {
      console.error(`Smart Folders: boundary action "${action.type}" failed for ${boundary.folderPath}`, error);
    }
  }
}

async function runOne(app: App, action: BoundaryAction, boundary: ContextBoundary): Promise<void> {
  switch (action.type) {
    case "open-note": {
      const file = resolveNoteFile(app, action, boundary);
      if (file) await app.workspace.getLeaf().openFile(file);
      break;
    }
    case "run-command": {
      if (!action.commandId) break;
      (app as AppWithCommands).commands?.executeCommandById(action.commandId);
      break;
    }
    case "show-notice": {
      new Notice(action.message || `Entered ${boundary.folderPath}`);
      break;
    }
    case "set-frontmatter": {
      const file = resolveNoteFile(app, action, boundary);
      if (file && action.field) {
        await app.fileManager.processFrontMatter(file, (frontmatter) => {
          frontmatter[action.field as string] = action.value ?? "";
        });
      }
      break;
    }
    case "append-line": {
      const file = resolveNoteFile(app, action, boundary);
      if (file) await app.vault.append(file, `\n${action.line ?? ""}`);
      break;
    }
    case "run-customjs": {
      const parsed = action.customJsRef ? parseCustomJsRef(action.customJsRef) : undefined;
      if (!parsed) break;
      const cJS = (window as CustomJSWindow).cJS;
      if (typeof cJS !== "function") break;
      const instance = await cJS(parsed.className);
      if (instance && typeof instance[parsed.methodName] === "function") {
        await instance[parsed.methodName]();
      }
      break;
    }
    case "delay": {
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, action.delayMs ?? 0)));
      break;
    }
  }
}

function resolveNoteFile(app: App, action: BoundaryAction, boundary: ContextBoundary): TFile | undefined {
  const path = resolveActionNotePath(action, boundary);
  if (!path) return undefined;
  const file = app.vault.getAbstractFileByPath(normalizePath(path));
  return file instanceof TFile ? file : undefined;
}
