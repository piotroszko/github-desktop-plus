import { GitClientFactory } from "../../../core/git/git-authenticator";
import { TrackedRepository } from "../../../shared/types";
import { InProgressOperation } from "../interfaces/repository-snapshot";
import { Notifier, RepositoryContext, Refresher } from "../ports";
import { detectInProgressOperation } from "./git-operation-state";
import { RepositoryScopedService } from "./repository-scoped.service";

const CONTINUE: Record<InProgressOperation, string[]> = {
  merge: ["merge", "--continue"],
  "cherry-pick": ["cherry-pick", "--continue"],
  revert: ["revert", "--continue"],
  rebase: ["rebase", "--continue"],
};

const ABORT: Record<InProgressOperation, string[]> = {
  merge: ["merge", "--abort"],
  "cherry-pick": ["cherry-pick", "--abort"],
  revert: ["revert", "--abort"],
  rebase: ["rebase", "--abort"],
};

/**
 * @description Drives a merge/cherry-pick/revert/rebase that stopped in
 * conflict: mark files resolved, continue, or abort. The operation in progress
 * is detected from the repository, not passed by the webview.
 */
export class ConflictService extends RepositoryScopedService {
  constructor(
    repos: RepositoryContext,
    notifier: Notifier,
    private readonly git: GitClientFactory,
    private readonly refresher: Refresher,
  ) {
    super(repos, notifier);
  }

  /** `git add`s the given paths, marking them resolved. */
  markResolved(files: string[]): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      if (files.length === 0) {
        return;
      }
      await this.git.local(repo).add(files);
      await this.refresher.refresh();
    });
  }

  /** Finishes the operation once every conflict is resolved. */
  continue(): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      const git = this.git.local(repo);
      const op = await this.currentOperation(repo);
      if (!op) {
        this.notifier.warn("No operation in progress");
        return;
      }
      const status = await git.status();
      if (status.conflicted.length > 0) {
        this.notifier.warn(
          `${status.conflicted.length} file(s) still in conflict`,
        );
        return;
      }
      await git
        .raw([...CONTINUE[op], "--no-edit"])
        .catch(() => git.raw(CONTINUE[op]));
      this.notifier.info(`${op} completed`);
      await this.refresher.refresh();
    });
  }

  /** Rolls the operation back to its pre-conflict state. */
  abort(): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      const op = await this.currentOperation(repo);
      if (!op) {
        this.notifier.warn("No operation in progress");
        return;
      }
      await this.git.local(repo).raw(ABORT[op]);
      this.notifier.info(`${op} aborted`);
      await this.refresher.refresh();
    });
  }

  private currentOperation(
    repo: TrackedRepository,
  ): Promise<InProgressOperation | null> {
    return detectInProgressOperation(this.git.local(repo));
  }
}
