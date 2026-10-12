import { GitClientFactory } from "../../../core/git/git-authenticator";
import { Notifier, RepositoryContext, WebviewChannel } from "../ports";
import { RepositoryScopedService } from "./repository-scoped.service";
import { RepositoryDataService } from "./repository-data.service";

/**
 * @description Read-only diff/detail lookups requested from the History tab:
 * a commit's aggregate detail and the patch of one file within a commit.
 */
export class DiffService extends RepositoryScopedService {
  constructor(
    repos: RepositoryContext,
    notifier: Notifier,
    private readonly git: GitClientFactory,
    private readonly data: RepositoryDataService,
    private readonly channel: WebviewChannel,
  ) {
    super(repos, notifier);
  }

  async commitDetail(hash: string): Promise<void> {
    try {
      const payload = await this.data.getCommitDetail(hash);
      this.channel.post({ command: "commitDetail", payload });
    } catch (error) {
      this.channel.post({
        command: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  fileDiff(hash: string, filePath: string): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      const git = this.git.local(repo);
      let diff = await git.raw(["show", hash, "--patch", "--", filePath]);
      if (!diff.trim()) {
        diff = await git.raw(["show", hash, "--", filePath]);
      }
      this.channel.post({
        command: "fileDiff",
        payload: { path: filePath, diff },
      });
    });
  }
}
