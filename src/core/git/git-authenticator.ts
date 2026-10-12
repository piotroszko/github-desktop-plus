import simpleGit, { SimpleGit } from "simple-git";
import { AccountManager } from "../accounts/account-manager";
import { TrackedRepository } from "../../shared/types";
import { resolveRepositoryAccount } from "../../shared/utils/repo-account";

/**
 * @description
 * Abstraction over the creation of `simple-git` clients. High-level services
 * depend on this port instead of importing `simpleGit` directly, which keeps
 * them testable (Dependency Inversion) and confines all credential handling to
 * a single place.
 */
export interface GitClientFactory {
  /**
   * A plain client with no credentials attached. Use for read-only or purely
   * local operations (status, log, checkout, merge, reset...).
   *
   * @param repoPath - Absolute path to the repository working directory
   */
  plain(repoPath: string): SimpleGit;

  /**
   * Runs `fn` with a client whose network operations carry the token of the
   * account selected for `repo` (falling back to the active account when the
   * repository has no selection, or the selected account is signed out).
   *
   * The token is injected as an ephemeral `-c http.<url>.extraheader=…` on each
   * git invocation. It is **never** written to `.git/config`, so there is
   * nothing to clean up and no shared state to race on.
   *
   * If no account is available, `fn` still runs with a plain client (git may
   * then fall back to a system credential helper).
   *
   * @param repo - The tracked repository the operation targets
   * @param fn - Callback receiving the (possibly authenticated) client
   * @returns Whatever `fn` resolves to
   * @throws Propagates any error thrown by `fn`
   *
   * @example
   * await gitFactory.withAuth(repo, (git) => git.push(["-u", "origin", branch]));
   */
  withAuth<T>(
    repo: TrackedRepository,
    fn: (git: SimpleGit) => Promise<T>,
  ): Promise<T>;
}

/**
 * @description Default {@link GitClientFactory} backed by the extension's
 * {@link AccountManager}. Resolves the token of the account selected for the
 * repository, falling back to the active account.
 */
export class AccountGitClientFactory implements GitClientFactory {
  constructor(private readonly accounts: AccountManager) {}

  plain(repoPath: string): SimpleGit {
    return simpleGit(repoPath);
  }

  async withAuth<T>(
    repo: TrackedRepository,
    fn: (git: SimpleGit) => Promise<T>,
  ): Promise<T> {
    const token = await this.resolveToken(repo);
    if (!token) {
      return fn(simpleGit(repo.localPath));
    }

    const header = `Authorization: Basic ${Buffer.from(
      `x-access-token:${token}`,
    ).toString("base64")}`;

    // `-c http.<url>.extraheader=…` on every invocation. Not written to config,
    // nothing to clean up. (We do NOT call `.env()` here — passing GIT_* vars
    // through trips simple-git's unsafe-env guard; GIT_TERMINAL_PROMPT is set
    // once at activation instead.)
    const git = simpleGit(repo.localPath, {
      config: [`http.https://github.com/.extraheader=${header}`],
    });

    return fn(git);
  }

  private async resolveToken(
    repo: TrackedRepository,
  ): Promise<string | undefined> {
    const selected = resolveRepositoryAccount(this.accounts, repo);
    if (!selected) {
      return undefined;
    }

    const token = await this.accounts.getToken(selected.id);
    if (token) {
      return token;
    }

    // The selected account's credentials are gone (signed out, token revoked);
    // keep working with the active account rather than dropping to anonymous.
    const active = this.accounts.getActiveAccount();
    if (!active || active.id === selected.id) {
      return undefined;
    }
    return (await this.accounts.getToken(active.id)) ?? undefined;
  }
}
