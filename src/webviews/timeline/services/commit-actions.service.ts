import { GitClientFactory } from "../../../core/git/git-authenticator";
import { toGitHubWebUrl } from "../../../shared/utils/github-url";
import { Browser, Notifier, RepositoryContext, Refresher } from "../ports";
import { RepositoryScopedService } from "./repository-scoped.service";

const shortHash = (hash: string): string => hash.substring(0, 7);

/**
 * @description Actions available from a commit's context menu in the History
 * tab: reset, checkout, revert, branch-from, tag-from, cherry-pick and
 * "view on GitHub".
 */
export class CommitActionsService extends RepositoryScopedService {
  constructor(
    repos: RepositoryContext,
    notifier: Notifier,
    private readonly git: GitClientFactory,
    private readonly browser: Browser,
    private readonly refresher: Refresher,
  ) {
    super(repos, notifier);
  }

  reset(hash: string): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      const confirmed = await this.notifier.confirm(
        `Reset to ${shortHash(hash)}? All changes after this commit are discarded.`,
        "Reset",
      );
      if (!confirmed) {
        return;
      }
      await this.git.plain(repo.localPath).reset(["--hard", hash]);
      this.notifier.info(`Reset to ${shortHash(hash)}`);
      await this.refresher.refresh();
    });
  }

  checkout(hash: string): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      await this.git.plain(repo.localPath).checkout(hash);
      this.notifier.info(`Checked out ${shortHash(hash)} (detached HEAD)`);
      await this.refresher.refresh();
    });
  }

  revert(hash: string): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      const git = this.git.plain(repo.localPath);
      try {
        await git.revert(hash, ["--no-edit"]);
      } catch (error) {
        if (
          await this.reportConflict(repo.localPath, `revert ${shortHash(hash)}`)
        ) {
          return;
        }
        throw error;
      }
      this.notifier.info(`Reverted ${shortHash(hash)}`);
      await this.refresher.refresh();
    });
  }

  cherryPick(hash: string): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      const git = this.git.plain(repo.localPath);
      try {
        await git.raw(["cherry-pick", hash]);
      } catch (error) {
        if (
          await this.reportConflict(
            repo.localPath,
            `cherry-pick ${shortHash(hash)}`,
          )
        ) {
          return;
        }
        throw error;
      }
      this.notifier.info(`Cherry-picked ${shortHash(hash)}`);
      await this.refresher.refresh();
    });
  }

  branchFrom(hash: string): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      const name = await this.notifier.prompt({
        prompt: "New branch name",
        placeHolder: "feature/my-branch",
      });
      if (!name) {
        return;
      }
      await this.git.plain(repo.localPath).checkoutBranch(name, hash);
      this.notifier.info(`Created '${name}' from ${shortHash(hash)}`);
      await this.refresher.refresh();
    });
  }

  tagFrom(hash: string): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      const name = await this.notifier.prompt({
        prompt: "Tag name",
        placeHolder: "v1.0.0",
        validateInput: (v) =>
          /^[A-Za-z0-9._/-]+$/.test(v) ? null : "Invalid tag name",
      });
      if (!name) {
        return;
      }
      await this.git.withAuth(repo, async (g) => {
        await g.raw(["tag", "-a", name, hash, "-m", `Release ${name}`]);
        await g.raw(["push", "origin", `refs/tags/${name}`]);
      });
      this.notifier.info(`Created and pushed tag '${name}'`);
      await this.refresher.refresh();
    });
  }

  viewOnGitHub(hash: string): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      const base = toGitHubWebUrl(repo.remoteUrl);
      if (!base) {
        this.notifier.warn("No GitHub remote configured");
        return;
      }
      this.browser.open(`${base}/commit/${hash}`);
    });
  }

  private async reportConflict(
    repoPath: string,
    operation: string,
  ): Promise<boolean> {
    const status = await this.git.plain(repoPath).status();
    if (status.conflicted.length === 0) {
      return false;
    }
    this.notifier.warn(
      `${operation} stopped: ${status.conflicted.length} file(s) in conflict`,
    );
    await this.refresher.refresh();
    return true;
  }
}
