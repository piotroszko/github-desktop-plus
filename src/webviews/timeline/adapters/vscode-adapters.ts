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
  CommitAvatars,
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
    await vscode.commands.executeCommand("githubDesktopPlus.cloneRepository");
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
  constructor(private readonly confirmEnabled: () => boolean) {}

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
    if (!this.confirmEnabled()) {
      return true;
    }
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
  constructor(
    private readonly accounts: AccountManager,
    private readonly avatarsEnabled: () => boolean,
  ) {}

  async listPullRequests(
    repo: TrackedRepository,
    base?: string | null,
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
      ...(base ? { base } : {}),
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
  ): Promise<CommitAvatars> {
    const empty: CommitAvatars = { byHash: {}, byAuthorEmail: {} };
    if (!this.avatarsEnabled()) {
      return empty;
    }
    const slug = gitHubSlug(repo);
    if (!slug) {
      return empty;
    }
    const octokit = await this.accounts.getOctokit(repo.accountId);
    if (!octokit) {
      return empty;
    }
    try {
      const { data } = await octokit.rest.repos.listCommits({
        owner: slug.owner,
        repo: slug.name,
        sha: ref || undefined,
        per_page: 100,
      });
      const byHash: Record<string, string> = {};
      const byAuthorEmail: Record<string, string> = {};
      for (const commit of data) {
        const avatarUrl = commit.author?.avatar_url;
        if (!avatarUrl) {
          continue;
        }
        // SHA for the exact commit; the author email additionally teaches us
        // what avatar a local-only commit by the same author should borrow.
        byHash[commit.sha] = avatarUrl;
        const email = commit.commit?.author?.email;
        if (email) {
          byAuthorEmail[email.toLowerCase()] = avatarUrl;
        }
      }
      return { byHash, byAuthorEmail };
    } catch {
      return empty;
    }
  }
}
