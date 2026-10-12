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
