import simpleGit, { SimpleGit } from "simple-git";
import { AccountManager } from "../accounts/account-manager";
import { TrackedRepository } from "../../shared/types";
import {
  resolveCommitIdentity,
  resolveRepositoryAccount,
} from "../../shared/utils/repo-account";

/**
 * @description
 * Abstraction over the creation of `simple-git` clients. High-level services
 * depend on this port instead of importing `simpleGit` directly, which keeps
 * them testable (Dependency Inversion) and confines all credential handling to
 * a single place.
 */
export interface GitClientFactory {
  /**
   * A client for local (offline) operations in `repo` — staging, committing,
   * status, log, diff, checkout, merge, reset.
   *
   * Every command runs with `-c user.name=… -c user.email=…` for the account
   * selected for the repository, so commits the extension creates are authored
   * as the account the user picked instead of whatever the machine's global
   * git config happens to hold. The values are passed per invocation and never
   * written to `.git/config`. When the repository has no usable account, git's
   * own configured identity is left in place.
   *
   * Carries no credentials: use {@link withAuth} for network operations.
   *
   * @param repo - The tracked repository the operation targets
   */
  local(repo: TrackedRepository): SimpleGit;

  /**
   * Runs `fn` with a client whose network operations carry the token of the
   * account selected for `repo` (falling back to the active account when the
   * repository has no selection, or the selected account is signed out).
   *
   * The token is injected as an ephemeral `-c http.<url>.extraheader=…` on each
   * git invocation. It is **never** written to `.git/config`, so there is
   * nothing to clean up and no shared state to race on.
   *
   * The client also carries the same commit identity as {@link local}, since
   * `pull` and `tag -a` create objects that are attributed to it.
   *
   * If no account is available, `fn` still runs with a client that has no
   * credentials (git may then fall back to a system credential helper).
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
  constructor(
    private readonly accounts: AccountManager,
    private readonly gitPath: () => string,
  ) {}

  local(repo: TrackedRepository): SimpleGit {
    return this.client(repo.localPath, this.identityConfig(repo));
  }

  async withAuth<T>(
    repo: TrackedRepository,
    fn: (git: SimpleGit) => Promise<T>,
  ): Promise<T> {
    const config = this.identityConfig(repo);
    const token = await this.resolveToken(repo);
    if (token) {
      const header = `Authorization: Basic ${Buffer.from(
        `x-access-token:${token}`,
      ).toString("base64")}`;

      // `-c http.<url>.extraheader=…` on every invocation. Not written to
      // config, nothing to clean up. (We do NOT call `.env()` here — passing
      // GIT_* vars through trips simple-git's unsafe-env guard;
      // GIT_TERMINAL_PROMPT is set once at activation instead.)
      config.push(`http.https://github.com/.extraheader=${header}`);
    }

    return fn(this.client(repo.localPath, config));
  }

  /**
   * A local client over `localPath` carrying `config` as `-c` arguments and,
   * when `git.path` is set, that executable instead of the one on `PATH`.
   */
  private client(localPath: string, config: string[]): SimpleGit {
    const binary = this.gitPath();
    return simpleGit(localPath, binary ? { config, binary } : { config });
  }

  /**
   * `-c` arguments holding the `user.name`/`user.email` commits for `repo` are
   * authored with — the repository's selected account, or the active one. Empty
   * when no account (or no address for it) is known, leaving git's own
   * configured identity in place.
   */
  private identityConfig(repo: TrackedRepository): string[] {
    const identity = resolveCommitIdentity(this.accounts, repo);
    if (!identity) {
      return [];
    }
    return [`user.name=${identity.name}`, `user.email=${identity.email}`];
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
