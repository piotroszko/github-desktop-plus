import * as path from "path";
import * as vscode from "vscode";
import { RepositoryManager } from "../../core/repositories/repository-manager";
import { TrackedRepository } from "../types";

export function getPrimaryRepository(
  repositoryManager: RepositoryManager,
): TrackedRepository | undefined {
  // An explicit in-extension selection wins; it never changes the workspace.
  const selected = repositoryManager.getActiveRepository();
  if (selected) {
    return selected;
  }

  const repositories = repositoryManager.getRepositories();
  if (repositories.length === 0) {
    return undefined;
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    for (const folder of workspaceFolders) {
      const folderPath = path.resolve(folder.uri.fsPath);
      const match = repositories.find(
        (repo) => path.resolve(repo.localPath) === folderPath,
      );
      if (match) {
        return match;
      }
    }
  }

  return repositories[0];
}
