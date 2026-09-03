import { Menu, TFile, normalizePath } from "obsidian";
import SmartFoldersPlugin from "../main";
import { ContextBoundary } from "../context-boundary";

/**
 * Status-bar widget for the boundary stack (see 00_Admin/08-context-boundary-events.md
 * Widget UX). Collapsed by default - just the current boundary's name with a
 * dot, not the full breadcrumb - since the status bar should stay lightweight
 * enough to leave on continuously. Click (not hover: no equivalent on touch)
 * reveals the full stack as a menu.
 */
export class BoundaryWidget {
  private el: HTMLElement;

  constructor(private plugin: SmartFoldersPlugin, statusBarEl: HTMLElement) {
    this.el = statusBarEl;
    this.el.addClass("sf-boundary-widget");
    this.render();
  }

  render(): void {
    this.el.empty();

    const stack = this.plugin.getBoundaryStack();
    const candidate = this.plugin.getBoundaryCandidate();

    if (stack.length === 0 && !candidate) {
      this.el.createSpan({ text: "○ No context", cls: "sf-boundary-widget-empty" });
      return;
    }

    if (stack.length > 0) {
      const current = stack[stack.length - 1];
      const currentEl = this.el.createSpan({
        cls: "sf-boundary-widget-current",
        attr: { "aria-label": "View/manage the active context stack" },
      });
      currentEl.createSpan({ text: "● ", cls: "sf-boundary-widget-dot" });
      currentEl.createSpan({ text: this.plugin.getBoundaryLabel(current.folderPath) });
      currentEl.onclick = (event) => this.openStackMenu(event, stack);

      if (candidate) this.el.createSpan({ text: " → ", cls: "sf-boundary-widget-arrow" });
    }

    if (candidate) {
      const label = `Click to commit to ${candidate.boundary.folderPath}`;
      const candidateEl = this.el.createSpan({
        text: this.plugin.getBoundaryLabel(candidate.boundary.folderPath),
        cls: "sf-boundary-widget-candidate",
        attr: { "aria-label": label, title: label },
      });
      candidateEl.onclick = async () => {
        await this.plugin.commitBoundaryCandidate();
        this.render();
      };
    }
  }

  private openStackMenu(event: MouseEvent, stack: readonly ContextBoundary[]): void {
    const menu = new Menu();

    stack.forEach((boundary, index) => {
      const isCurrent = index === stack.length - 1;
      menu.addItem((item) => {
        item.setTitle(this.plugin.getBoundaryLabel(boundary.folderPath)).setChecked(isCurrent);
        item.onClick(async () => {
          if (isCurrent) {
            if (!boundary.hubPage) return;
            const file = this.plugin.app.vault.getAbstractFileByPath(normalizePath(boundary.hubPage));
            if (file instanceof TFile) await this.plugin.app.workspace.getLeaf().openFile(file);
            return;
          }
          this.plugin.popBoundaryStackTo(boundary.folderPath);
          this.render();
        });
      });
    });

    const candidate = this.plugin.getBoundaryCandidate();
    if (candidate) {
      menu.addSeparator();
      menu.addItem((item) => {
        item.setTitle(`Dismiss ${this.plugin.getBoundaryLabel(candidate.boundary.folderPath)}`).setIcon("x");
        item.onClick(() => {
          this.plugin.dismissBoundaryCandidate();
          this.render();
        });
      });
    }

    menu.showAtMouseEvent(event);
  }
}
