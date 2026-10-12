# Multi-Account Authentication Guide

This guide explains how the extension enables multiple GitHub accounts and how to troubleshoot common credential issues.

## Supported Credentials
- **GitHub CLI (`gh`) session:** If the CLI is installed and logged in, the extension automatically reuses the stored token via `gh auth token`.
- **Personal Access Tokens (PATs):** When no CLI session is available, the extension prompts for a PAT. Tokens should include at least the `repo`, `read:org`, and `workflow` scopes to mirror GitHub Desktop defaults.
- **Device or OAuth flows:** Not implemented yet. The `@octokit/auth-oauth-device` dependency is available for future work but unused.

## Adding Accounts
1. Run `GitHub Desktop Plus: Sign In` from the command palette.
2. If a GitHub CLI session is present, it is used automatically. Otherwise paste the PAT for the account you want to add.
3. On success, the account appears in the **Accounts** tree view and becomes the active account.
4. Repeat for additional accounts; each account keeps its own token in VS Code Secret Storage.

## Switching Accounts
- Run `GitHub Desktop Plus: Switch Active Account`.
- Choose the target account from the quick pick list.
- The **Accounts** view updates to mark the active account, and subsequent commands (clone, issue creation) use its credentials.

## Commit Identity
Each account records the profile GitHub reports for its token: display name,
public email and numeric id. Whichever account a repository resolves to (its
pinned account, else the active one) is the identity the extension passes to
`git` for every object it creates in that repository — `commit`, `commitFiles`,
amend, cherry-pick, revert, merge, conflict "continue", pull and annotated tags.
The values arrive as `-c user.name=… -c user.email=…` on that one invocation:
`.git/config` is never touched, so your own git configuration stays intact and
your terminal keeps committing as whoever it always did.

The address used is the account's public profile email. When none is public the
extension falls back to GitHub's no-reply address,
`<id>+<login>@users.noreply.github.com`, which GitHub still attributes to the
account. `Select Account for Repository` and the History panel's account menu
show the resulting `name <email>`, and a repository with no signed-in account
leaves git's configured identity in place.

Accounts imported before the extension recorded these details are filled in on
the next activation — one API call per account, skipped once known, and retried
later when GitHub is unreachable.

## Removing Accounts
- Run `GitHub Desktop Plus: Sign Out` and select the account to remove.
- The token is deleted from secret storage and the account disappears from the tree view.
- If the active account is removed, the first remaining account becomes active automatically.

## Storage Locations
- **Account metadata:** Serialized in VS Code's `globalState` under the key `githubDesktop.accounts`.
- **Active account id:** Stored as `githubDesktop.activeAccountId`.
- **Tokens:** Saved in VS Code secret storage using randomized keys (e.g., `githubDesktop.token.<uuid>`). Tokens sourced from the GitHub CLI are copied into secret storage to avoid repeated CLI calls.

## Troubleshooting
- **GitHub CLI not detected:** Ensure `gh` is on the PATH. If absent, the extension falls back to manual PAT entry.
- **CLI logged into multiple accounts:** Run `gh auth token --hostname github.com` in a terminal to confirm which account holds the active token.
- **Missing token:** If secret storage is cleared, the extension prunes any accounts missing tokens the next time it loads. Sign in again to restore access.
- **Invalid/expired PAT:** Octokit throws an error when validating the token during sign-in. The extension surfaces the message and no state changes occur.
- **Clone failures for private repos:** Ensure the active account has permissions to the repository and that the PAT includes the `repo` scope.

## Future Enhancements
- Integrate OAuth device authorization for a GitHub Desktop-like sign-in experience.
- Display avatars and organizations in the Accounts view.
- Sync active account to workspace state to support per-workspace preferences.
- Offer an account picker when multiple GitHub CLI identities are configured.
