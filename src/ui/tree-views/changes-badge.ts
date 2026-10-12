import * as vscode from "vscode";

/**
 * @description Puts the pending-change count on the extension's activity bar
 * icon, by badging a view of that container. VS Code sums the numeric badges of
 * a container's views, so exactly one view must carry it.
 *
 * Satisfies the timeline's `ChangesBadge` port.
 */
export class RepositoriesViewBadge<T> {
  constructor(private readonly view: vscode.TreeView<T>) {}

  update(changedFiles: number, repositoryName: string | null): void {
    if (changedFiles <= 0 || !repositoryName) {
      this.view.badge = undefined;
      return;
    }
    const files =
      changedFiles === 1 ? "1 changed file" : `${changedFiles} changed files`;
    this.view.badge = {
      value: changedFiles,
      tooltip: `${files} in ${repositoryName}`,
    };
  }
}
