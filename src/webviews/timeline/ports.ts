import { TrackedRepository } from "../../shared/types";
import { OutboundMessage } from "./messages";

/**
 * @description Resolves which repository the timeline currently operates on.
 * Abstracts {@link getPrimaryRepository} so services never touch the
 * repository manager or the VS Code workspace API directly.
 */
export interface RepositoryContext {
  /** The active repository, or `undefined` when there is none. */
  getPrimary(): TrackedRepository | undefined;
  /** Every tracked repository, for the repository picker. */
  list(): TrackedRepository[];
  /**
   * Makes `localPath` the active repository for this session. Purely
   * in-extension: the VS Code workspace folder, and therefore the window, is
   * never changed.
   */
  setActive(localPath: string): Promise<void>;
  /**
   * Pins the account `repo` authenticates as, or — with `accountId` undefined —
   * makes it follow the extension's active account.
   */
  setAccount(
    repo: TrackedRepository,
    accountId: string | undefined,
  ): Promise<void>;
  /** Prompts for a local folder and tracks it as a repository. */
  addLocal(): Promise<void>;
  /** Runs the "clone repository" flow. */
  clone(): Promise<void>;
}

/**
 * @description Thin abstraction over the user-facing notification surface
 * (`vscode.window.*`). Keeps services free of the `vscode` namespace and
 * trivially mockable in tests.
 */
export interface Notifier {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;

  /**
   * Asks the user to confirm a destructive action.
   *
   * @param message - The question to display (modal)
   * @param confirmLabel - Label of the confirming button
   * @returns `true` only when the user picked the confirming button
   */
  confirm(message: string, confirmLabel: string): Promise<boolean>;

  /**
   * Prompts the user for a single line of text.
   *
   * @returns The trimmed input, or `undefined` when cancelled
   */
  prompt(options: {
    prompt: string;
    placeHolder?: string;
    validateInput?: (value: string) => string | null;
  }): Promise<string | undefined>;
}

/**
 * @description Outbound half of the webview message channel. Services push
 * {@link OutboundMessage}s; they never receive through this port.
 */
export interface WebviewChannel {
  post(message: OutboundMessage): void;
}

/**
 * @description Opens URLs in the user's external browser.
 */
export interface Browser {
  open(url: string): void;
}

/**
 * @description One open pull request, as shown in the branch dropdown's
 * "Pull requests" tab.
 */
export interface PullRequestSummary {
  number: number;
  title: string;
  author: string;
  headRef: string;
  baseRef: string;
  isFork: boolean;
  isDraft: boolean;
  updatedAt: string;
}

/**
 * @description Read-only GitHub REST access scoped to the active repository.
 * Backed by the account manager's authenticated Octokit; kept behind a port so
 * services stay free of `@octokit/*` and are mockable in tests.
 */
export interface GitHubApi {
  /**
   * Lists open pull requests for `repo`, most-recently-updated first.
   *
   * @throws when no GitHub account is signed in or the repo has no
   *   `owner`/`name` resolvable to a GitHub slug.
   */
  listPullRequests(repo: TrackedRepository): Promise<PullRequestSummary[]>;

  /**
   * Maps commit SHA to the committer's GitHub avatar URL, for commits near
   * the tip of `ref` (repo default branch if omitted) that GitHub can
   * resolve to an account. Commits it can't match (unpushed, no linked
   * account, etc.) are simply absent from the result.
   *
   * Never throws — returns `{}` when signed out, offline, or the repo has
   * no GitHub remote, since this is a decorative enrichment, not a
   * blocking dependency of the history view.
   */
  getCommitAvatars(
    repo: TrackedRepository,
    ref?: string,
  ): Promise<Record<string, string>>;
}

/**
 * @description Triggers a full recompute-and-broadcast of the timeline state.
 * Mutating services call this after a successful operation instead of pushing
 * partial updates themselves.
 */
export interface Refresher {
  refresh(): Promise<void>;
}
