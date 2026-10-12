import { GitClientFactory } from "../../../core/git/git-authenticator";
import {
  Notifier,
  RepositoryContext,
  Refresher,
  WebviewChannel,
} from "../ports";
import { RepositoryScopedService } from "./repository-scoped.service";

/**
 * @description Working-tree operations of the Changes tab: staging, committing
 * a chosen set of files (the GitHub Desktop model), discarding, and producing
 * the diff of an uncommitted file.
 */
export class WorkingTreeService extends RepositoryScopedService {
  constructor(
    repos: RepositoryContext,
    notifier: Notifier,
    private readonly git: GitClientFactory,
    private readonly channel: WebviewChannel,
    private readonly refresher: Refresher,
  ) {
    super(repos, notifier);
  }

  stage(files: string[]): Promise<void | undefined> {
    return this.mutate(files, (g) => g.add(files));
  }

  unstage(files: string[]): Promise<void | undefined> {
    return this.mutate(files, async (g) => {
      try {
        await g.reset(["HEAD", "--", ...files]);
      } catch {
        // A repository with no commit yet has no HEAD to reset against.
        await g.raw(["rm", "-r", "--cached", "--", ...files]);
      }
    });
  }

  /** Commits exactly `files` (stages them first, then commits with a pathspec). */
  commitFiles(message: string, files: string[]): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      if (!message.trim() || files.length === 0) {
        return;
      }
      const git = this.git.plain(repo.localPath);
      await git.add(files);
      await git.commit(message, files);
      this.channel.post({ command: "commitSucceeded" });
      this.notifier.info("Commit created");
      await this.refresher.refresh();
    });
  }

  /** Commits whatever is already staged. */
  commit(message: string): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      if (!message.trim()) {
        return;
      }
      await this.git.plain(repo.localPath).commit(message);
      this.channel.post({ command: "commitSucceeded" });
      this.notifier.info("Commit created");
      await this.refresher.refresh();
    });
  }

  /**
   * Rewrites the last commit with `message` and, if `files` is non-empty, adds
   * those paths to it. Refuses when the commit is already published.
   */
  amend(message: string, files: string[]): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      if (!message.trim()) {
        return;
      }
      const git = this.git.plain(repo.localPath);
      const pushed = await git
        .raw(["branch", "-r", "--contains", "HEAD"])
        .catch(() => "");
      if (pushed.trim()) {
        const ok = await this.notifier.confirm(
          "The last commit is already on a remote. Amending rewrites history and will need a force-push. Continue?",
          "Amend anyway",
        );
        if (!ok) {
          return;
        }
      }
      if (files.length > 0) {
        await git.add(files);
      }
      await git.raw(["commit", "--amend", "-m", message]);
      this.channel.post({ command: "commitSucceeded" });
      this.notifier.info("Last commit amended");
      await this.refresher.refresh();
    });
  }

  /**
   * Undoes the last commit, keeping its changes staged in the working tree
   * (`git reset --soft HEAD~1`) — the GitHub Desktop "Undo" behaviour.
   */
  undoLastCommit(): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      const git = this.git.plain(repo.localPath);
      const summary = (
        await git.raw(["log", "-1", "--format=%s"]).catch(() => "")
      ).trim();
      const ok = await this.notifier.confirm(
        summary
          ? `Undo commit "${summary}"? Its changes stay in your working tree.`
          : "Undo the last commit? Its changes stay in your working tree.",
        "Undo",
      );
      if (!ok) {
        return;
      }
      await git.reset(["--soft", "HEAD~1"]);
      this.notifier.info("Last commit undone");
      await this.refresher.refresh();
    });
  }

  discard(files: string[]): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      if (files.length === 0) {
        return;
      }
      const confirmed = await this.notifier.confirm(
        files.length === 1
          ? `Discard changes to ${files[0]}?`
          : `Discard changes to ${files.length} files?`,
        "Discard",
      );
      if (!confirmed) {
        return;
      }
      const git = this.git.plain(repo.localPath);
      await git
        .raw(["checkout", "HEAD", "--", ...files])
        .catch(() => undefined);
      await git.raw(["clean", "-fd", "--", ...files]).catch(() => undefined);
      await this.refresher.refresh();
    });
  }

  workingDiff(filePath: string): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      const git = this.git.plain(repo.localPath);
      let diff = await git.raw(["diff", "HEAD", "--", filePath]);
      if (!diff.trim()) {
        diff = await git
          .raw(["diff", "--no-index", "--", "/dev/null", filePath])
          .catch(() => "");
      }
      this.channel.post({
        command: "workingDiff",
        payload: { path: filePath, diff },
      });
    });
  }

  private mutate(
    files: string[],
    op: (git: ReturnType<GitClientFactory["plain"]>) => Promise<unknown>,
  ): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      if (files.length === 0) {
        return;
      }
      await op(this.git.plain(repo.localPath));
      await this.refresher.refresh();
    });
  }
}
