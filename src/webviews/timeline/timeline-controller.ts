import { AccountManager } from "../../core/accounts/account-manager";
import { resolveRepositoryAccount } from "../../shared/utils/repo-account";
import { GitClientFactory } from "../../core/git/git-authenticator";
import { BusyTask, InboundMessage } from "./messages";
import { RemoteStatus } from "./interfaces/repository-snapshot";
import { MessageRouter } from "./message-router";
import {
  Browser,
  ChangesBadge,
  DraftStore,
  MessageGenerator,
  GitHubApi,
  NativeDiff,
  Notifier,
  RepositoryContext,
  Refresher,
  WebviewChannel,
} from "./ports";
import { BranchService } from "./services/branch.service";
import { CommitActionsService } from "./services/commit-actions.service";
import { ConflictService } from "./services/conflict.service";
import { DiffService } from "./services/diff.service";
import { PullRequestService } from "./services/pull-request.service";
import { RepositoryDataService } from "./services/repository-data.service";
import { StashService } from "./services/stash.service";
import { CommitMessageService } from "./services/commit-message.service";
import { SyncService } from "./services/sync.service";
import { WorkingTreeService } from "./services/working-tree.service";

/**
 * @description Composition root for the timeline webview's message handling.
 *
 * It owns nothing git-specific itself: it wires the cohesive services to the
 * {@link MessageRouter}, implements {@link Refresher} (the single place that
 * recomputes and broadcasts timeline state), and validates raw webview
 * payloads into a typed {@link InboundMessage} before dispatch.
 */
export class TimelineController implements Refresher {
  private readonly router: MessageRouter;
  private readonly data: RepositoryDataService;
  private lastRemoteStatus: RemoteStatus = {
    hasRemote: false,
    isPublished: false,
    ahead: 0,
    behind: 0,
    lastFetched: null,
    remoteBranch: null,
  };
  private readonly commitAvatars: Record<string, string> = {};
  private lastAvatarFetchKey: string | null = null;

  constructor(
    private readonly deps: {
      repos: RepositoryContext;
      notifier: Notifier;
      channel: WebviewChannel;
      browser: Browser;
      git: GitClientFactory;
      accounts: AccountManager;
      githubApi: GitHubApi;
      nativeDiff: NativeDiff;
      drafts: DraftStore;
      badge: ChangesBadge;
      generator: MessageGenerator;
    },
  ) {
    const { repos, notifier, channel, browser, git, nativeDiff, drafts } = deps;

    this.data = new RepositoryDataService(repos, git);

    const working = new WorkingTreeService(repos, notifier, git, channel, this);
    const sync = new SyncService(repos, notifier, git, channel, this);
    const branch = new BranchService(repos, notifier, git, channel, this);
    const commitActions = new CommitActionsService(
      repos,
      notifier,
      git,
      browser,
      this,
    );
    const pr = new PullRequestService(
      repos,
      notifier,
      browser,
      git,
      channel,
      deps.githubApi,
      this,
    );
    const diff = new DiffService(repos, notifier, git, this.data, channel);
    const conflict = new ConflictService(repos, notifier, git, this);
    const stash = new StashService(repos, notifier, git, this);
    const message = new CommitMessageService(
      repos,
      notifier,
      git,
      channel,
      deps.generator,
    );

    // Long-running operations announce themselves so the webview can disable
    // and animate the button that started them until they settle.
    const busy = <M, T>(task: BusyTask, run: (message: M) => T) =>
      this.withBusy(channel, task, run);

    this.router = new MessageRouter(notifier)
      .on("ready", () => this.refresh())
      .on("refresh", () => this.refresh())
      .on("selectRepository", async (m) => {
        await repos.setActive(m.path);
        await this.refresh();
      })
      .on("updateDraft", async (m) => {
        // Store under the path the webview was showing when it typed: a late
        // debounce after a repository switch must not land on the new one.
        const known = repos.list().some((repo) => repo.localPath === m.path);
        if (known) {
          await drafts.set(m.path, m.draft);
        }
      })
      .on("selectRepoAccount", async (m) => {
        const repo = repos.getPrimary();
        if (!repo) {
          notifier.warn("No repository selected");
          return;
        }
        await repos.setAccount(repo, m.accountId);
        await this.refresh();
      })
      .on("openNativeDiff", async (m) => {
        const repo = repos.getPrimary();
        if (!repo) {
          notifier.warn("No repository selected");
          return;
        }
        if (!m.hash) {
          if (m.filePath) {
            await nativeDiff.openWorkingFile(repo, m.filePath);
          }
          return;
        }
        if (m.filePath) {
          await nativeDiff.openCommitFile(repo, m.hash, m.filePath);
          return;
        }
        const detail = await this.data.getCommitDetail(m.hash);
        await nativeDiff.openCommit(
          repo,
          m.hash,
          detail.files.map((file) => file.path),
        );
      })
      .on("addLocalRepository", async () => {
        await repos.addLocal();
        await this.refresh();
      })
      .on("cloneRepository", () => repos.clone())
      .on("stageFiles", (m) => working.stage(m.files))
      .on("unstageFiles", (m) => working.unstage(m.files))
      .on("commit", busy("commit", (m) => working.commit(m.message)))
      .on("commitFiles", busy("commit", (m) => working.commitFiles(m.message, m.files)))
      .on("amendCommit", busy("commit", (m) => working.amend(m.message, m.files)))
      .on("undoLastCommit", busy("commit", () => working.undoLastCommit()))
      .on("discardFiles", (m) => working.discard(m.files))
      .on("markResolved", (m) => conflict.markResolved(m.files))
      .on("continueOperation", busy("continue", () => conflict.continue()))
      .on("abortOperation", busy("abort", () => conflict.abort()))
      .on("getStashes", () => this.refresh())
      .on("stashPush", (m) => stash.push(m.message))
      .on("stashApply", (m) => stash.apply(m.index, m.drop))
      .on("stashDrop", (m) => stash.drop(m.index))
      .on("getWorkingDiff", (m) => working.workingDiff(m.filePath))
      .on("generateCommitMessage", () => message.generate())
      .on("fetch", busy("fetch", () => sync.fetch()))
      .on("pull", busy("pull", () => sync.pull()))
      .on("push", busy("push", () => sync.push()))
      .on("forcePush", busy("forcePush", () => sync.forcePush()))
      .on("publish", busy("publish", () => sync.publish()))
      .on("checkoutBranch", (m) => branch.checkout(m.branch))
      .on("createBranch", (m) => branch.create(m.branchName))
      .on("createBranchWithChanges", (m) =>
        branch.createWithChanges(m.branchName, m.bringChanges),
      )
      .on("mergeBranch", (m) => branch.merge(m.fromBranch, m.toBranch))
      .on("compareBranch", (m) => branch.compare(m.branch))
      .on("createPullRequest", (m) => pr.openCompare(m.branch))
      .on("getPullRequests", () => pr.list())
      .on("checkoutPullRequest", (m) => pr.checkout(m.number))
      .on("openRepoOnGitHub", () => pr.openRepo())
      .on("loadMoreCommits", (m) => this.loadMore(m.offset))
      .on("getCommitDetails", (m) => diff.commitDetail(m.hash))
      .on("selectCommit", (m) => diff.commitDetail(m.hash))
      .on("getFileDiff", (m) => diff.fileDiff(m.hash, m.filePath))
      .on("selectFile", (m) => diff.fileDiff(m.hash, m.path))
      .on("resetToCommit", (m) => commitActions.reset(m.hash))
      .on("checkoutCommit", (m) => commitActions.checkout(m.hash))
      .on("revertCommit", (m) => commitActions.revert(m.hash))
      .on("cherryPickCommit", (m) => commitActions.cherryPick(m.hash))
      .on("createBranchFromCommit", (m) => commitActions.branchFrom(m.hash))
      .on("createTagFromCommit", (m) => commitActions.tagFrom(m.hash))
      .on("viewCommitOnGitHub", (m) => commitActions.viewOnGitHub(m.hash));
  }

  /**
   * @description Wraps an operation so the webview shows `task` as in flight
   * until it settles. The end announcement also fires when the operation
   * throws, so a failed fetch cannot leave a button spinning forever.
   */
  private withBusy<M, T>(
    channel: WebviewChannel,
    task: BusyTask,
    run: (message: M) => T,
  ): (message: M) => Promise<void> {
    return async (message: M) => {
      channel.post({ command: "busy", task });
      try {
        await run(message);
      } finally {
        channel.post({ command: "busy", task: null });
      }
    };
  }

  /**
   * Validates a raw `postMessage` payload and dispatches it. Malformed
   * payloads are dropped.
   */
  handle(raw: unknown): Promise<void> {
    const message = coerceInbound(raw);
    if (!message) {
      return Promise.resolve();
    }
    return this.router.dispatch(message);
  }

  /** Recomputes the whole snapshot and broadcasts it to the webview. */
  async refresh(): Promise<void> {
    const { channel, accounts } = this.deps;
    const snapshot = await this.data.getSnapshot();

    if (!snapshot) {
      channel.post({ command: "updateRepository", repository: null });
      this.deps.badge.update(0, null);
      return;
    }

    this.lastRemoteStatus = snapshot.remoteStatus;

    // The activity bar badge mirrors the change list: one per changed file,
    // cleared as soon as the working tree is clean.
    this.deps.badge.update(
      new Set(snapshot.changes.map((change) => change.path)).size,
      snapshot.repository.name,
    );

    const draftRepo = this.deps.repos.getPrimary();
    channel.post({
      command: "draft",
      path: draftRepo?.localPath ?? null,
      draft: draftRepo
        ? this.deps.drafts.get(draftRepo.localPath) ?? null
        : null,
    });
    channel.post({ command: "updateChanges", changes: snapshot.changes });
    channel.post({
      command: "updateHistory",
      history: snapshot.commits,
      hasMoreCommits: snapshot.hasMoreCommits,
      offset: 0,
    });

    if (Object.keys(this.commitAvatars).length) {
      channel.post({ command: "updateCommitAvatars", avatars: this.commitAvatars });
    }
    this.refreshCommitAvatars(snapshot.currentBranch, snapshot.commits[0]?.hash);
    channel.post({
      command: "updateBranches",
      branches: snapshot.branches,
      currentBranch: snapshot.currentBranch,
      branchActivity: snapshot.branchActivity,
    });
    channel.post({
      command: "updateRepository",
      repository: snapshot.repository,
    });
    channel.post({
      command: "updateRepositoryList",
      repositories: this.deps.repos
        .list()
        .map((r) => ({ name: r.name, path: r.localPath })),
      activePath: snapshot.repository.path,
    });

    const repo = this.deps.repos.getPrimary();
    const activeAccount = accounts.getActiveAccount();
    const account = repo
      ? resolveRepositoryAccount(accounts, repo)
      : activeAccount;
    const pinnedAccountId = repo?.accountId ?? null;
    channel.post({
      command: "updateAccounts",
      account: account
        ? {
            login: account.login,
            name: account.name,
            avatarUrl: account.avatarUrl,
          }
        : null,
      accounts: accounts.getAccounts().map((candidate) => ({
        id: candidate.id,
        login: candidate.login,
        avatarUrl: candidate.avatarUrl,
        active: candidate.id === activeAccount?.id,
        selected: candidate.id === pinnedAccountId,
      })),
      pinnedAccountId,
    });

    channel.post({
      command: "updateRemoteStatus",
      remoteStatus: snapshot.remoteStatus,
      tags: snapshot.tags,
    });

    channel.post({
      command: "updateOperation",
      operation: snapshot.operation,
      conflicted: snapshot.conflicted,
      canUndo: snapshot.canUndo,
      lastCommitSummary: snapshot.commits[0]?.message.split("\n")[0] ?? null,
    });

    channel.post({ command: "updateStashes", stashes: snapshot.stashes });
  }

  /**
   * Fetches GitHub avatar URLs for commits near the tip of `branch` and
   * broadcasts them once resolved. Skipped when the branch/tip haven't
   * changed since the last successful fetch, so a `git commit` or `pull`
   * triggers one network call while unrelated refreshes (e.g. every file
   * save) don't. Runs in the background — history renders immediately from
   * local data regardless of how this resolves.
   */
  private refreshCommitAvatars(
    branch: string | null,
    topHash: string | undefined,
  ): void {
    const repo = this.deps.repos.getPrimary();
    if (!repo) {
      return;
    }
    const key = `${repo.owner ?? ""}/${repo.name ?? ""}@${branch ?? ""}:${topHash ?? ""}`;
    if (key === this.lastAvatarFetchKey) {
      return;
    }
    this.lastAvatarFetchKey = key;

    void this.deps.githubApi
      .getCommitAvatars(repo, branch ?? undefined)
      .then((avatars) => {
        const hasNew = Object.entries(avatars).some(
          ([hash, url]) => this.commitAvatars[hash] !== url,
        );
        if (!hasNew) {
          return;
        }
        Object.assign(this.commitAvatars, avatars);
        this.deps.channel.post({
          command: "updateCommitAvatars",
          avatars: this.commitAvatars,
        });
      })
      .catch(() => {
        // Decorative enrichment only — offline/rate-limited/signed-out is fine.
      });
  }

  private async loadMore(offset: number): Promise<void> {
    const page = await this.data.loadMoreCommits(offset, this.lastRemoteStatus);
    this.deps.channel.post({
      command: "loadMoreCommitsResponse",
      history: page.commits,
      hasMoreCommits: page.hasMoreCommits,
      offset: page.offset,
    });
  }
}

/**
 * @description Narrows an untrusted `postMessage` value to an
 * {@link InboundMessage}. Only the `command` discriminant is checked here; each
 * service still guards its own inputs.
 */
function coerceInbound(raw: unknown): InboundMessage | null {
  if (
    typeof raw === "object" &&
    raw !== null &&
    typeof (raw as { command?: unknown }).command === "string"
  ) {
    return raw as InboundMessage;
  }
  return null;
}
