import { GitClientFactory } from "../../../core/git/git-authenticator";
import {
  MessageGenerator,
  Notifier,
  RepositoryContext,
  WebviewChannel,
} from "../ports";
import { RepositoryScopedService } from "./repository-scoped.service";

/**
 * @description Drafts the commit box's message from the changes in the
 * repository: the staged diff when there is one, otherwise everything that
 * differs from `HEAD`. Reads only — the index and the working tree are never
 * touched.
 */
export class CommitMessageService extends RepositoryScopedService {
  constructor(
    repos: RepositoryContext,
    notifier: Notifier,
    private readonly git: GitClientFactory,
    private readonly channel: WebviewChannel,
    private readonly generator: MessageGenerator,
  ) {
    super(repos, notifier);
  }

  generate(): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      try {
        const git = this.git.plain(repo.localPath);
        const staged = await git.raw(["diff", "--cached"]);
        const diff = staged.trim() ? staged : await git.raw(["diff", "HEAD"]);
        if (!diff.trim()) {
          this.fail("Nothing to describe — stage or change something first.");
          return;
        }

        const message = await this.generator.generate(diff);
        if (!message) {
          this.fail("The commit message command returned nothing usable.");
          return;
        }

        this.channel.post({
          command: "commitMessage",
          summary: message.summary,
          description: message.description,
          error: null,
        });
      } catch (error) {
        this.fail(error instanceof Error ? error.message : String(error));
      }
    });
  }

  private fail(message: string): void {
    this.notifier.error(message);
    this.channel.post({
      command: "commitMessage",
      summary: null,
      description: null,
      error: message,
    });
  }
}
