import * as vscode from "vscode";
import { RepositoryManager } from "../../core/repositories/repository-manager";
import { AccountManager } from "../../core/accounts/account-manager";
import { TrackedRepository } from "../../shared/types";
import { resolveRepositoryAccount } from "../../shared/utils/repo-account";

class RepositoryItem extends vscode.TreeItem {
  constructor(repo: TrackedRepository, accountLabel: string | undefined) {
    super(`${repo.owner}/${repo.name}`, vscode.TreeItemCollapsibleState.None);
    const contextParts: string[] = [];
    if (accountLabel) {
      contextParts.push(accountLabel);
    }
    contextParts.push(repo.localPath);
    this.description = contextParts.join(" � ");
    this.tooltip = `${repo.owner}/${repo.name}\n${repo.localPath}`;
    this.iconPath = new vscode.ThemeIcon(
      repo.remoteUrl ? "repo" : "repo-forked",
    );
    this.resourceUri = vscode.Uri.file(repo.localPath);
    this.contextValue = "githubDesktop.repository";
    this.command = {
      command: "githubDesktop.openRepository",
      title: "Open Repository",
      arguments: [repo],
    };
  }
}

export class RepositoriesProvider
  implements vscode.TreeDataProvider<RepositoryItem>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    RepositoryItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly repositories: RepositoryManager,
    private readonly accounts: AccountManager,
  ) {
    this.repositories.onDidChangeRepositories(() => this.refresh());
    this.accounts.onDidChangeAccounts(() => this.refresh());
  }

  getTreeItem(element: RepositoryItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.ProviderResult<RepositoryItem[]> {
    const repos = this.repositories.getRepositories();
    if (repos.length === 0) {
      const item = new vscode.TreeItem(
        "Clone or open a repository",
        vscode.TreeItemCollapsibleState.None,
      );
      item.command = {
        command: "githubDesktop.cloneRepository",
        title: "Clone Repository",
      };
      item.iconPath = new vscode.ThemeIcon("cloud-download");
      return [item];
    }

    return repos.map((repo) => {
      const account = resolveRepositoryAccount(this.accounts, repo);
      const label = account
        ? repo.accountId
          ? account.login
          : `${account.login} (active)`
        : undefined;
      return new RepositoryItem(repo, label);
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
}
