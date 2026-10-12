import { GitClientFactory } from "../../../core/git/git-authenticator";
import {
  toGitHubBranchName,
  toGitHubWebUrl,
} from "../../../shared/utils/github-url";
import {
  Browser,
  GitHubApi,
  Notifier,
  Refresher,
  RepositoryContext,
  WebviewChannel,
} from "../ports";
import { RepositoryScopedService } from "./repository-scoped.service";

/**
 * @description Pull request surface for the branch dropdown: lists open PRs
 * through the GitHub API and checks one out locally. Creating a PR still hands
 * off to the browser, matching GitHub Desktop.
 */
export class PullRequestService extends RepositoryScopedService {
  constructor(
    repos: RepositoryContext,
    notifier: Notifier,
    private readonly browser: Browser,
    private readonly git: GitClientFactory,
    private readonly channel: WebviewChannel,
    private readonly api: GitHubApi,
    private readonly refresher: Refresher,
    private readonly remote: () => string,
  ) {
    super(repos, notifier);
  }

  openCompare(branch: string): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      const remote = toGitHubWebUrl(repo.remoteUrl);
      if (!remote) {
        this.notifier.warn("No GitHub remote configured");
        return;
      }
      // Compare against the repository's chosen base when it has one: that is
      // often not the default branch GitHub would pick.
      const base = toGitHubBranchName(repo.baseBranch);
      const compare = base ? `${base}...${branch}` : branch;
      this.browser.open(`${remote}/compare/${compare}?expand=1`);
    });
  }

  /** Opens the repository's GitHub page in the browser. */
  openRepo(): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      const base = toGitHubWebUrl(repo.remoteUrl);
      if (!base) {
        this.notifier.warn("No GitHub remote configured");
        return;
      }
      this.browser.open(base);
    });
  }

  /** Fetches open PRs and pushes them to the webview. */
  list(): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      try {
        const pullRequests = await this.api.listPullRequests(
          repo,
          toGitHubBranchName(repo.baseBranch),
        );
        this.channel.post({ command: "updatePullRequests", pullRequests });
      } catch (error) {
        this.channel.post({
          command: "updatePullRequests",
          pullRequests: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /**
   * Checks out PR #`number` into a local `pr/<number>` branch.
   *
   * Uses `git fetch origin pull/<n>/head:pr/<n>`, which GitHub serves for both
   * same-repo and fork PRs, so no fork remote juggling is needed.
   */
  checkout(prNumber: number): Promise<void | undefined> {
    return this.withRepo(async (repo) => {
      if (!Number.isInteger(prNumber) || prNumber <= 0) {
        return;
      }
      const local = `pr/${prNumber}`;
      try {
        await this.git.withAuth(repo, (git) =>
          git.fetch([this.remote(), `pull/${prNumber}/head:${local}`]),
        );
      } catch (error) {
        this.notifier.error(
          `Could not fetch PR #${prNumber}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }
      await this.git.local(repo).checkout(local);
      this.notifier.info(`Checked out PR #${prNumber} as ${local}`);
      await this.refresher.refresh();
    });
  }
}
