import { SimpleGit } from "simple-git";
import { GitClientFactory } from "../../../core/git/git-authenticator";
import {
  Notifier,
  RepositoryContext,
  Refresher,
  WebviewChannel,
} from "../ports";
import { RepositoryScopedService } from "./repository-scoped.service";

/**
 * @description Owns the four remote-sync operations behind the toolbar's sync
 * cell: fetch, pull, push and publish. Authentication is delegated to
 * {@link GitClientFactory.withAuth} (no token ever touches `.git/config`).
 */
export class SyncService extends RepositoryScopedService {
  constructor(
    repos: RepositoryContext,
    notifier: Notifier,
    private readonly git: GitClientFactory,
    private readonly channel: WebviewChannel,
    private readonly refresher: Refresher,
  ) {
    super(repos, notifier);
  }

  fetch(): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      await this.git.withAuth(repo, (g) => g.fetch());
      this.notifier.info("Fetched from remote");
      await this.refresher.refresh();
    });
  }

  pull(): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      try {
        await this.git.withAuth(repo, (g) => g.pull());
      } catch (error) {
        if (await this.reportIfConflict(repo.localPath, "pull")) {
          return;
        }
        throw error;
      }
      this.notifier.info("Pulled from remote");
      await this.refresher.refresh();
    });
  }

  push(): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      const git = this.git.plain(repo.localPath);
      const { current, tracking } = await git.status();
      await this.git.withAuth(repo, (g) =>
        tracking ? g.push() : g.push(["-u", "origin", current ?? "HEAD"]),
      );
      this.notifier.info("Pushed to remote");
      await this.refresher.refresh();
    });
  }

  /**
   * Overwrites the upstream branch with the local one. Uses
   * `--force-with-lease` so it still fails if someone else pushed in the
   * meantime. Meant for after an amend / undo / reset that rewrote history.
   */
  forcePush(): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      const git = this.git.plain(repo.localPath);
      const { current, tracking } = await git.status();
      if (!tracking) {
        this.notifier.warn("This branch has no upstream — use Publish instead");
        return;
      }
      const ok = await this.notifier.confirm(
        `Force-push ${current}? This overwrites the remote branch with your local history.`,
        "Force push",
      );
      if (!ok) {
        return;
      }
      await this.git.withAuth(repo, (g) => g.push(["--force-with-lease"]));
      this.notifier.info("Force-pushed to remote");
      await this.refresher.refresh();
    });
  }

  publish(): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      const git = this.git.plain(repo.localPath);
      const { current } = await git.branch();
      if (!current) {
        this.notifier.error("No branch to publish");
        return;
      }
      const remotes = await git.getRemotes();
      if (remotes.length === 0) {
        this.notifier.error("No remote repository configured");
        return;
      }
      const remote = remotes[0].name;
      await this.git.withAuth(repo, (g) => g.push(["-u", remote, current]));
      this.notifier.info(`Published '${current}' to ${remote}`);
      await this.refresher.refresh();
    });
  }

  /**
   * If the working tree is now in a conflicted state, tells the webview and
   * returns `true`. Otherwise returns `false` and the caller rethrows.
   */
  private async reportIfConflict(
    repoPath: string,
    operation: string,
  ): Promise<boolean> {
    const status = await this.git.plain(repoPath).status();
    if (status.conflicted.length === 0) {
      return false;
    }
    this.channel.post({
      command: "mergeConflict",
      operation,
      files: status.conflicted,
    });
    this.notifier.warn(
      `${operation} stopped: ${status.conflicted.length} file(s) in conflict`,
    );
    return true;
  }
}
