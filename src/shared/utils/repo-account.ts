import { AccountManager } from "../../core/accounts/account-manager";
import { StoredAccount, TrackedRepository } from "../types";

/**
 * @description The account that network and API operations for `repo` act as.
 *
 * A repository's explicit selection (`TrackedRepository.accountId`, set from
 * "Select Account for Repository") wins as long as that account is still
 * signed in; otherwise the operation falls back to the extension's active
 * account.
 */
export function resolveRepositoryAccount(
  accounts: AccountManager,
  repo: TrackedRepository,
): StoredAccount | undefined {
  if (repo.accountId) {
    const selected = accounts.getAccountById(repo.accountId);
    if (selected) {
      return selected;
    }
  }
  return accounts.getActiveAccount();
}

/**
 * @description The name/email pair commits made for a repository are authored
 * with, derived from the account {@link resolveRepositoryAccount} picks.
 */
export interface CommitIdentity {
  name: string;
  email: string;
}

/**
 * @description The address commits made as `account` are authored with: the
 * account's public profile email when GitHub reports one, otherwise GitHub's
 * no-reply address for the account — which still attributes the commit to it
 * without publishing an address the user keeps private.
 *
 * `undefined` when neither is known, i.e. for accounts imported before the
 * extension recorded them.
 */
export function accountCommitEmail(account: StoredAccount): string | undefined {
  if (account.email) {
    return account.email;
  }
  if (account.githubId && account.login) {
    return `${account.githubId}+${account.login}@users.noreply.github.com`;
  }
  return undefined;
}

/**
 * @description Who a commit made for `repo` should be authored and committed
 * as — the repository's selected account (or the active one), so committing
 * from the extension never silently uses the machine's global git identity.
 *
 * `undefined` when the repository has no usable account, in which case git's
 * own configured identity is left in place.
 */
export function resolveCommitIdentity(
  accounts: AccountManager,
  repo: TrackedRepository,
): CommitIdentity | undefined {
  const account = resolveRepositoryAccount(accounts, repo);
  if (!account) {
    return undefined;
  }
  const email = accountCommitEmail(account);
  if (!email) {
    return undefined;
  }
  return {
    name: account.name?.trim() || account.login,
    email,
  };
}
