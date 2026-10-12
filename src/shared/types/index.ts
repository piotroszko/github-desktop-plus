export interface StoredAccount {
  id: string;
  login: string;
  name?: string;
  avatarUrl?: string;
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
  /** Ticked file paths. An empty array means "nothing ticked", which is not the
   * same as an absent draft (that defaults to everything ticked). */
  selected?: string[];
}
