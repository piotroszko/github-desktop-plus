import * as path from "path";
import { promises as fs } from "fs";
import * as vscode from "vscode";
import simpleGit from "simple-git";
import { RepositoryManager } from "../../../core/repositories/repository-manager";
import { AccountManager } from "../../../core/accounts/account-manager";
import { NativeDiffViewer } from "../../../core/git/native-diff";
import { getPrimaryRepository } from "../../../shared/utils/repo-selection";
import { TrackedRepository } from "../../../shared/types";
import { toGitHubWebUrl } from "../../../shared/utils/github-url";
import { OutboundMessage } from "../messages";
import {
  Browser,
  GitHubApi,
  NativeDiff,
  Notifier,
  PullRequestSummary,
  RepositoryContext,
  WebviewChannel,
} from "../ports";

/**
 * @description {@link RepositoryContext} backed by the extension's
 * {@link RepositoryManager}. The user can switch repos from the picker without
 * changing the VS Code workspace folder: the selection is remembered
 * in-extension (see {@link RepositoryManager.setActiveRepository}) and the
 * window is never reloaded or opened elsewhere.
 */
export class WorkspaceRepositoryContext implements RepositoryContext {
  constructor(private readonly repositories: RepositoryManager) {}

  getPrimary(): TrackedRepository | undefined {
    return getPrimaryRepository(this.repositories);
  }

  list(): TrackedRepository[] {
    return this.repositories.getRepositories();
  }

  async setActive(localPath: string): Promise<void> {
    this.repositories.setActiveRepository(localPath);
  }

  async setAccount(
    repo: TrackedRepository,
    accountId: string | undefined,
  ): Promise<void> {
    await this.repositories.updateRepository(repo.id, { accountId });
  }

  async addLocal(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Add repository",
    });
    const folder = picked?.[0]?.fsPath;
    if (!folder) {
      return;
    }
    if (!(await exists(path.join(folder, ".git")))) {
      void vscode.window.showErrorMessage(
        "That folder is not a git repository.",
      );
      return;
    }
    let owner = "local";
    let name = path.basename(folder);
    let remoteUrl: string | undefined;
    try {
      const remotes = await simpleGit(folder).getRemotes(true);
      const origin = remotes.find((r) => r.name === "origin") ?? remotes[0];
      remoteUrl = origin?.refs.fetch ?? origin?.refs.push;
      const m = remoteUrl?.match(/[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
      if (m) {
        owner = m[1];
        name = m[2];
      }
    } catch {
      // keep folder-name defaults
    }
    await this.repositories.addRepository({
      localPath: folder,
      owner,
      name,
      remoteUrl,
    });
    await this.setActive(folder);
  }

  async clone(): Promise<void> {
    await vscode.commands.executeCommand("githubDesktop.cloneRepository");
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * @description {@link NativeDiff} backed by {@link NativeDiffViewer}, which
 * drives VS Code's built-in diff and changes editors.
 */
export class VsCodeNativeDiff implements NativeDiff {
  constructor(private readonly viewer: NativeDiffViewer) {}

  openWorkingFile(repo: TrackedRepository, filePath: string): Promise<void> {
    return this.viewer.openWorkingFile(repo.localPath, filePath);
  }

  openCommitFile(
    repo: TrackedRepository,
    hash: string,
    filePath: string,
  ): Promise<void> {
    return this.viewer.openCommitFile(repo.localPath, hash, filePath);
  }

  openCommit(
    repo: TrackedRepository,
    hash: string,
    files: string[],
  ): Promise<void> {
    return this.viewer.openCommit(repo.localPath, hash, files);
  }
}

/**
 * @description {@link Notifier} backed by `vscode.window`.
 */
export class VsCodeNotifier implements Notifier {
  info(message: string): void {
    void vscode.window.showInformationMessage(message);
  }

  warn(message: string): void {
    void vscode.window.showWarningMessage(message);
  }

  error(message: string): void {
    void vscode.window.showErrorMessage(message);
  }

  async confirm(message: string, confirmLabel: string): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      confirmLabel,
    );
    return choice === confirmLabel;
  }

  async prompt(options: {
    prompt: string;
    placeHolder?: string;
    validateInput?: (value: string) => string | null;
  }): Promise<string | undefined> {
    const value = await vscode.window.showInputBox({
      prompt: options.prompt,
      placeHolder: options.placeHolder,
      ignoreFocusOut: true,
      validateInput: options.validateInput,
    });
    return value?.trim() || undefined;
  }
}

/**
 * @description {@link Browser} backed by `vscode.env.openExternal`.
 */
export class VsCodeBrowser implements Browser {
  open(url: string): void {
    void vscode.env.openExternal(vscode.Uri.parse(url));
  }
}

/**
 * @description {@link WebviewChannel} backed by a concrete `vscode.Webview`.
 */
export class VsCodeWebviewChannel implements WebviewChannel {
  constructor(private readonly webview: vscode.Webview) {}

  post(message: OutboundMessage): void {
    void this.webview.postMessage(message);
  }
}

/**
 * @description Resolves a repository's `owner/name` GitHub slug, preferring the
 * remote URL (authoritative) over the tracked fields (which fall back to the
 * folder name for repos added without a GitHub remote).
 */
function gitHubSlug(
  repo: TrackedRepository,
): { owner: string; name: string } | null {
  const web = toGitHubWebUrl(repo.remoteUrl);
  const m = web?.match(/github\.com\/([^/]+)\/([^/]+?)$/);
  if (m) {
    return { owner: m[1], name: m[2] };
  }
  if (repo.owner && repo.owner !== "local" && repo.name) {
    return { owner: repo.owner, name: repo.name };
  }
  return null;
}

/**
 * @description {@link GitHubApi} backed by {@link AccountManager}'s
 * authenticated Octokit.
 */
export class AccountGitHubApi implements GitHubApi {
  constructor(private readonly accounts: AccountManager) {}

  async listPullRequests(
    repo: TrackedRepository,
  ): Promise<PullRequestSummary[]> {
    const slug = gitHubSlug(repo);
    if (!slug) {
      throw new Error("This repository has no GitHub remote.");
    }
    const octokit = await this.accounts.getOctokit(repo.accountId);
    if (!octokit) {
      throw new Error("Sign in to a GitHub account to see pull requests.");
    }
    const { data } = await octokit.rest.pulls.list({
      owner: slug.owner,
      repo: slug.name,
      state: "open",
      sort: "updated",
      direction: "desc",
      per_page: 50,
    });
    return data.map((pr) => ({
      number: pr.number,
      title: pr.title,
      author: pr.user?.login ?? "",
      headRef: pr.head.ref,
      baseRef: pr.base.ref,
      isFork: pr.head.repo?.fork ?? pr.head.repo?.full_name !== `${slug.owner}/${slug.name}`,
      isDraft: pr.draft ?? false,
      updatedAt: pr.updated_at,
    }));
  }

  async getCommitAvatars(
    repo: TrackedRepository,
    ref?: string,
  ): Promise<Record<string, string>> {
    const slug = gitHubSlug(repo);
    if (!slug) {
      return {};
    }
    const octokit = await this.accounts.getOctokit(repo.accountId);
    if (!octokit) {
      return {};
    }
    try {
      const { data } = await octokit.rest.repos.listCommits({
        owner: slug.owner,
        repo: slug.name,
        sha: ref || undefined,
        per_page: 100,
      });
      const avatars: Record<string, string> = {};
      for (const commit of data) {
        if (commit.author?.avatar_url) {
          avatars[commit.sha] = commit.author.avatar_url;
        }
      }
      return avatars;
    } catch {
      return {};
    }
  }
}
