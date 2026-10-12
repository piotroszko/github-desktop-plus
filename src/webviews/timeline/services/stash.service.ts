import { GitClientFactory } from "../../../core/git/git-authenticator";
import { Notifier, RepositoryContext, Refresher } from "../ports";
import { RepositoryScopedService } from "./repository-scoped.service";

/**
 * @description Stash management: save the working tree, re-apply an entry
 * (optionally dropping it), or discard one.
 */
export class StashService extends RepositoryScopedService {
  constructor(
    repos: RepositoryContext,
    notifier: Notifier,
    private readonly git: GitClientFactory,
    private readonly refresher: Refresher,
  ) {
    super(repos, notifier);
  }

  push(message: string): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      const args = ["stash", "push", "--include-untracked"];
      if (message.trim()) {
        args.push("-m", message.trim());
      }
      const out = await this.git.local(repo).raw(args);
      if (/No local changes/i.test(out)) {
        this.notifier.info("Nothing to stash");
        return;
      }
      this.notifier.info("Changes stashed");
      await this.refresher.refresh();
    });
  }

  apply(index: number, drop: boolean): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      await this.git
        .local(repo)
        .raw(["stash", drop ? "pop" : "apply", `stash@{${index}}`]);
      this.notifier.info(drop ? "Stash popped" : "Stash applied");
      await this.refresher.refresh();
    });
  }

  drop(index: number): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      const ok = await this.notifier.confirm(
        `Delete stash@{${index}}? This cannot be undone.`,
        "Delete",
      );
      if (!ok) {
        return;
      }
      await this.git.local(repo).raw(["stash", "drop", `stash@{${index}}`]);
      this.notifier.info("Stash deleted");
      await this.refresher.refresh();
    });
  }
}
