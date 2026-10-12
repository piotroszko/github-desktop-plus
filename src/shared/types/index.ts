export interface StoredAccount {
  id: string;
  login: string;
  name?: string;
  avatarUrl?: string;
  /**
   * The account's public profile email, used as the address of commits made
   * for this account. Absent when GitHub reports none (or for accounts
   * imported before it was recorded).
   */
  email?: string;
  /**
   * GitHub's numeric user id, used to build the account's no-reply commit
   * address when no public email is available.
   */
  githubId?: number;
  tokenKey: string;
  baseUrl?: string; // For GitHub Enterprise Server
  managedByCli?: boolean; // Token is kept in sync with the `gh` CLI's own auth state
  cliHost?: string; // The `gh`-reported hostname this account belongs to (e.g. "github.com")
}

export interface TrackedRepository {
  id: string;
  owner: string;
  name: string;
  defaultBranch?: string;
  localPath: string;
  remoteUrl?: string;
  accountId?: string;
  /**
   * Branch the extension compares against (ahead/behind, today's sync state,
   * pull-request base) instead of the branch's tracked upstream. A git ref, e.g.
   * `origin/develop`. Unset means "follow the tracked upstream".
   */
  baseBranch?: string;
}

/**
 * @description The commit box draft for one repository: what the user typed plus
 * the files they ticked. Persisted so it survives the panel being recreated
 * (hiding the view, reloading the window) and switching repositories.
 */
export interface CommitDraft {
  summary?: string;
  description?: string;
  coAuthors?: string;
  /**
   * Paths the user unticked on purpose. Everything else is ticked by default,
   * including files that did not exist when the draft was written.
   */
  unselected?: string[];
  /** @deprecated Drafts used to store the ticked set; read only to migrate them. */
  selected?: string[];
}

/**
 * @description How commit dates are rendered in the History list: as a coarse
 * "3 days ago" phrase, or as the wall-clock time git recorded.
 */
export type CommitDateFormat = "relative" | "absolute";

/**
 * @description Where avatars come from. `none` keeps the extension offline:
 * no `avatar_url` lookup against the GitHub API and no avatar images requested
 * by the trees or the History list.
 */
export type AvatarMode = "github" | "none";

/**
 * @description Where a diff is shown. `auto` keeps the panel's own diff pane
 * when the panel is wide enough and falls back to VS Code's editor when it is
 * not; `panel` always uses the pane; `editor` never renders the pane and sends
 * every diff to VS Code's editor instead.
 */
export type DiffViewMode = "auto" | "panel" | "editor";

/**
 * @description A commit message produced for the user (by the configured agent
 * CLI, or typed by hand before being read back).
 */
export interface GeneratedMessage {
  /** First line: the subject, e.g. `feat: add base branch picker`. */
  summary: string;
  /** Everything after the subject, or `null` when the model sent only a subject. */
  description: string | null;
}
