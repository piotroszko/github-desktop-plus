import * as vscode from "vscode";
import { Octokit } from "@octokit/rest";
import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { promisify } from "util";
import { StoredAccount } from "../../shared/types";

const ACCOUNTS_KEY = "githubDesktop.accounts";
const ACTIVE_ACCOUNT_KEY = "githubDesktop.activeAccountId";
const execFileAsync = promisify(execFile);

interface AccountQuickPickItem extends vscode.QuickPickItem {
  account: StoredAccount;
}

/** The profile fields the account list and commit identity are built from. */
interface GitHubProfile {
  login: string;
  name?: string;
  avatarUrl?: string;
  email?: string;
  githubId?: number;
}

export class AccountManager {
  private accounts: StoredAccount[] = [];
  private activeAccountId: string | undefined;
  private readonly _onDidChangeAccounts = new vscode.EventEmitter<void>();

  public readonly onDidChangeAccounts = this._onDidChangeAccounts.event;

  constructor(
    private readonly globalState: vscode.Memento,
    private readonly secretStorage: vscode.SecretStorage,
  ) {}

  async initialize(): Promise<void> {
    this.accounts = this.globalState.get<StoredAccount[]>(ACCOUNTS_KEY, []);
    this.activeAccountId = this.globalState.get<string>(ACTIVE_ACCOUNT_KEY);

    const filtered: StoredAccount[] = [];
    for (const account of this.accounts) {
      const token = await this.secretStorage.get(account.tokenKey);
      if (token) {
        filtered.push(account);
      }
    }

    if (filtered.length !== this.accounts.length) {
      this.accounts = filtered;
      await this.persist();
    }

    await this.syncGitHubCliAccounts();
    await this.backfillIdentities();

    if (this.accounts.length > 0 && !this.activeAccountId) {
      this.activeAccountId = this.accounts[0].id;
      await this.globalState.update(ACTIVE_ACCOUNT_KEY, this.activeAccountId);
    }
  }

  /**
   * Pulls every account `gh` currently knows about (across all hosts) into
   * the extension's own account list, refreshing tokens for accounts already
   * imported this way. `gh auth token --user <login>` reads a specific
   * account's token without disturbing which one `gh` itself considers
   * active, so this is safe to run opportunistically.
   */
  async syncGitHubCliAccounts(): Promise<boolean> {
    const cliAccounts = await this.getGitHubCliAccounts();
    if (cliAccounts.length === 0) {
      return false;
    }

    let changed = false;

    for (const cli of cliAccounts) {
      const token = await this.getGitHubCliTokenFor(cli.host, cli.login);
      if (!token) {
        continue;
      }

      const baseUrl = cli.host === "github.com" ? undefined : `https://${cli.host}`;

      try {
        const profile = await this.readProfile(token, baseUrl);

        const existing = this.accounts.find(
          (acc) =>
            acc.login === profile.login &&
            (acc.cliHost ?? "github.com") === cli.host,
        );

        if (existing) {
          const currentToken = await this.secretStorage.get(existing.tokenKey);
          if (currentToken !== token) {
            await this.secretStorage.store(existing.tokenKey, token);
            changed = true;
          }
          if (!existing.managedByCli || existing.cliHost !== cli.host) {
            existing.managedByCli = true;
            existing.cliHost = cli.host;
            changed = true;
          }
          if (this.applyProfile(existing, profile)) {
            changed = true;
          }
        } else {
          const tokenKey = `githubDesktop.token.${randomUUID()}`;
          await this.secretStorage.store(tokenKey, token);
          this.accounts.push({
            id: randomUUID(),
            login: profile.login,
            name: profile.name,
            avatarUrl: profile.avatarUrl,
            email: profile.email,
            githubId: profile.githubId,
            tokenKey,
            baseUrl,
            managedByCli: true,
            cliHost: cli.host,
          });
          changed = true;
        }
      } catch {
        // Token invalid/expired/revoked for this gh account — skip it silently,
        // it'll be picked up again next sync once gh has a working token for it.
      }
    }

    if (changed) {
      await this.persist();
      this._onDidChangeAccounts.fire();
    }

    return changed;
  }

  /**
   * Reads the token's GitHub profile: the display name, avatar and the commit
   * identity details (public email, numeric id) the extension records.
   */
  private async readProfile(
    token: string,
    baseUrl?: string,
  ): Promise<GitHubProfile> {
    const octokit = new Octokit({
      auth: token,
      ...(baseUrl ? { baseUrl: `${baseUrl.replace(/\/$/, "")}/api/v3` } : {}),
    });
    const { data } = await octokit.rest.users.getAuthenticated();
    return {
      login: data.login,
      name: data.name ?? undefined,
      avatarUrl: data.avatar_url ?? undefined,
      email: data.email ?? undefined,
      githubId: data.id,
    };
  }

  /**
   * Copies a freshly read profile onto a stored account, reporting whether
   * anything changed so the caller knows whether the change needs persisting.
   */
  private applyProfile(
    account: StoredAccount,
    profile: GitHubProfile,
  ): boolean {
    let changed = false;
    if (account.name !== profile.name) {
      account.name = profile.name;
      changed = true;
    }
    if (account.avatarUrl !== profile.avatarUrl && profile.avatarUrl) {
      account.avatarUrl = profile.avatarUrl;
      changed = true;
    }
    if (account.email !== profile.email && profile.email) {
      account.email = profile.email;
      changed = true;
    }
    if (
      account.githubId !== profile.githubId &&
      profile.githubId !== undefined
    ) {
      account.githubId = profile.githubId;
      changed = true;
    }
    return changed;
  }

  /**
   * Fills in the profile of accounts stored before the extension recorded
   * commit identities, so commits made for them are authored as the account
   * instead of as the machine's global git identity. Only accounts that have
   * neither an email nor a numeric id are queried, so this settles after one
   * activation.
   */
  private async backfillIdentities(): Promise<void> {
    let changed = false;

    for (const account of this.accounts) {
      if (account.email || account.githubId) {
        continue;
      }
      const token = await this.secretStorage.get(account.tokenKey);
      if (!token) {
        continue;
      }
      try {
        const profile = await this.readProfile(token, account.baseUrl);
        if (this.applyProfile(account, profile)) {
          changed = true;
        }
      } catch {
        // Offline, or a token GitHub rejects — retried on the next activation.
      }
    }

    if (changed) {
      await this.persist();
    }
  }

  getAccounts(): StoredAccount[] {
    return [...this.accounts];
  }

  getActiveAccount(): StoredAccount | undefined {
    if (!this.activeAccountId) {
      return undefined;
    }
    return this.accounts.find((account) => account.id === this.activeAccountId);
  }

  getAccountById(id: string): StoredAccount | undefined {
    return this.accounts.find((account) => account.id === id);
  }

  async signIn(forceNew: boolean = false): Promise<StoredAccount | undefined> {
    await this.syncGitHubCliAccounts();

    // Check if GitHub CLI is available
    const cliInfo = await this.getGitHubCliInfo();

    // Provide sign-in options
    const signInMethod = await vscode.window.showQuickPick(
      [
        {
          label: "$(browser) Sign in with GitHub",
          description:
            "Authenticate using VS Code's built-in GitHub authentication (Recommended)",
          value: "browser",
        },
        ...(cliInfo
          ? [
              {
                label: "$(github) Use GitHub CLI",
                description: cliInfo.multipleAccounts
                  ? `${cliInfo.accountCount} accounts available`
                  : `Signed in as ${cliInfo.currentUser}`,
                value: "cli",
              },
            ]
          : []),
        {
          label: "$(key) Enter Personal Access Token",
          description: "Manually enter a GitHub PAT",
          value: "token",
        },
        {
          label: "$(server-environment) GitHub Enterprise Server",
          description: "Connect to GitHub Enterprise Server",
          value: "enterprise",
        },
        ...(cliInfo?.multipleAccounts
          ? [
              {
                label: "$(terminal) Switch GitHub CLI Account",
                description: "Switch to a different GitHub CLI account first",
                value: "switch-cli",
              },
            ]
          : []),
      ],
      {
        placeHolder: forceNew ? "Choose how to add another GitHub account" : "Choose how to sign in to GitHub",
        ignoreFocusOut: true,
      },
    );

    if (!signInMethod) {
      return undefined;
    }

    switch (signInMethod.value) {
      case "browser":
        return this.signInWithBrowser(forceNew);
      case "cli":
        return this.authenticateWithCLI();
      case "token":
        return this.signInWithToken();
      case "enterprise":
        return this.signInWithEnterprise();
      case "switch-cli":
        return this.switchCLIAccountAndSignIn();
      default:
        return undefined;
    }
  }

  async addAccount(): Promise<StoredAccount | undefined> {
    return this.signIn(true);
  }

  async signOut(accountId?: string): Promise<void> {
    const target = accountId
      ? this.accounts.find((account) => account.id === accountId)
      : await this.pickAccount("Select the account to sign out");

    if (!target) {
      return;
    }

    const index = this.accounts.findIndex(
      (account) => account.id === target.id,
    );
    if (index === -1) {
      return;
    }

    await this.secretStorage.delete(target.tokenKey);
    this.accounts.splice(index, 1);

    if (this.activeAccountId === target.id) {
      this.activeAccountId = this.accounts[0]?.id;
      await this.globalState.update(ACTIVE_ACCOUNT_KEY, this.activeAccountId);
    }

    await this.persist();
    this._onDidChangeAccounts.fire();

    vscode.window.showInformationMessage(`Signed out ${target.login}.`);
  }

  async switchAccount(): Promise<StoredAccount | undefined> {
    await this.syncGitHubCliAccounts();

    if (this.accounts.length === 0) {
      const signIn = await vscode.window.showInformationMessage(
        "No GitHub accounts available.",
        "Sign In",
      );
      if (signIn) {
        return this.signIn();
      }
      return undefined;
    }

    if (this.accounts.length === 1) {
      vscode.window.showInformationMessage(
        `Only one account available: ${this.accounts[0].login}`,
      );
      return this.accounts[0];
    }

    const activeAccount = this.getActiveAccount();
    const items = this.accounts.map((account) => ({
      label: account.login,
      description: account.name || "",
      detail: account.id === activeAccount?.id ? "● Currently active" : "",
      account,
    }));

    const chosen = await vscode.window.showQuickPick(items, {
      placeHolder: "Select the active GitHub account",
      matchOnDescription: true,
      ignoreFocusOut: true,
    });

    if (!chosen) {
      return undefined;
    }

    if (chosen.account.id === activeAccount?.id) {
      vscode.window.showInformationMessage(
        `${chosen.account.login} is already active.`,
      );
      return chosen.account;
    }

    try {
      return await this.setActiveAccount(chosen.account.id);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to switch account: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return undefined;
    }
  }

  async setActiveAccount(
    accountId: string,
  ): Promise<StoredAccount | undefined> {
    const account = this.getAccountById(accountId);
    if (!account) {
      throw new Error("Account not found");
    }

    if (this.activeAccountId === accountId) {
      return account;
    }

    // Verify the account token is still valid
    const token = await this.getToken(accountId);
    if (!token) {
      throw new Error("Account token not found. Please sign in again.");
    }

    try {
      // Test the token by making a simple API call
      const octokit = new Octokit({ auth: token });
      await octokit.rest.users.getAuthenticated();
    } catch (error) {
      throw new Error("Account token is invalid. Please sign in again.");
    }

    const previousActiveId = this.activeAccountId;
    this.activeAccountId = accountId;

    try {
      await this.globalState.update(ACTIVE_ACCOUNT_KEY, this.activeAccountId);
      this._onDidChangeAccounts.fire();

      if (account.managedByCli) {
        // Best-effort: keep gh's own active account following the extension,
        // so terminal git/gh commands see the same identity. A failure here
        // (e.g. gh uninstalled since import) shouldn't block the switch.
        void execFileAsync("gh", [
          "auth",
          "switch",
          "--hostname",
          account.cliHost ?? "github.com",
          "--user",
          account.login,
        ]).catch(() => {});
      }

      return account;
    } catch (error) {
      // Revert on error
      this.activeAccountId = previousActiveId;
      throw error;
    }
  }

  async getOctokit(accountId?: string): Promise<Octokit | undefined> {
    const token = await this.getToken(accountId);
    if (!token) {
      return undefined;
    }
    return new Octokit({ auth: token });
  }

  async getToken(accountId?: string): Promise<string | undefined> {
    const account = accountId
      ? this.accounts.find((acc) => acc.id === accountId)
      : this.getActiveAccount();

    if (!account) {
      vscode.window.showWarningMessage(
        "No active GitHub account. Please sign in.",
      );
      return undefined;
    }

    const token = await this.secretStorage.get(account.tokenKey);
    if (!token) {
      vscode.window.showWarningMessage(
        "Stored credentials missing for the selected account. Please sign in again.",
      );
      return undefined;
    }

    return token;
  }

  private async persist(): Promise<void> {
    await this.globalState.update(ACCOUNTS_KEY, this.accounts);
  }

  private async pickAccount(
    placeHolder: string,
  ): Promise<StoredAccount | undefined> {
    const selection = await vscode.window.showQuickPick<AccountQuickPickItem>(
      this.accounts.map<AccountQuickPickItem>((account) => ({
        label: account.login,
        description: account.name ? account.name : undefined,
        account,
      })),
      {
        placeHolder,
        ignoreFocusOut: true,
      },
    );
    return selection?.account;
  }

  /**
   * All accounts `gh` is currently logged into, across every host, parsed
   * from its structured JSON output rather than scraping human-readable text.
   */
  private async getGitHubCliAccounts(): Promise<
    { host: string; login: string; active: boolean }[]
  > {
    try {
      const { stdout } = await execFileAsync(
        "gh",
        ["auth", "status", "--json", "hosts"],
        { encoding: "utf8" },
      );
      const parsed = JSON.parse(stdout) as {
        hosts?: Record<
          string,
          { state: string; active: boolean; host: string; login: string }[]
        >;
      };
      const accounts: { host: string; login: string; active: boolean }[] = [];
      for (const entries of Object.values(parsed.hosts ?? {})) {
        for (const entry of entries) {
          if (entry.state === "success") {
            accounts.push({
              host: entry.host,
              login: entry.login,
              active: entry.active,
            });
          }
        }
      }
      return accounts;
    } catch {
      return [];
    }
  }

  /** The token for one specific `gh`-known account, without switching gh's own active account. */
  private async getGitHubCliTokenFor(
    host: string,
    login: string,
  ): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync(
        "gh",
        ["auth", "token", "--hostname", host, "--user", login],
        { encoding: "utf8" },
      );
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private async getGitHubCliInfo(): Promise<
    | { currentUser: string; multipleAccounts: boolean; accountCount: number }
    | undefined
  > {
    const accounts = await this.getGitHubCliAccounts();
    if (accounts.length === 0) {
      return undefined;
    }
    const active = accounts.find((a) => a.active) ?? accounts[0];
    return {
      currentUser: active.login,
      multipleAccounts: accounts.length > 1,
      accountCount: accounts.length,
    };
  }

  private async getGitHubCliToken(): Promise<
    { token: string; source: string } | undefined
  > {
    try {
      const { stdout: tokenOutput } = await execFileAsync(
        "gh",
        ["auth", "token"],
        { encoding: "utf8" },
      );
      const token = tokenOutput.trim();
      if (!token) {
        return undefined;
      }

      try {
        const octokit = new Octokit({ auth: token });
        const { data } = await octokit.rest.users.getAuthenticated();
        return { token, source: `GitHub CLI session for ${data.login}` };
      } catch {
        return { token, source: "GitHub CLI session" };
      }
    } catch {
      return undefined;
    }
  }

  private async authenticateWithCLI(): Promise<StoredAccount | undefined> {
    const cliToken = await this.getGitHubCliToken();
    if (!cliToken) {
      vscode.window.showErrorMessage("Failed to get token from GitHub CLI.");
      return undefined;
    }
    const accounts = await this.getGitHubCliAccounts();
    const active = accounts.find((a) => a.active);
    return this.completeAuthentication(
      cliToken.token,
      cliToken.source,
      undefined,
      active?.host ?? "github.com",
    );
  }

  private async signInWithBrowser(forceNew: boolean = false): Promise<StoredAccount | undefined> {
    try {
      // Use VS Code's built-in GitHub authentication
      const session = await vscode.authentication.getSession(
        "github",
        ["repo", "user:email", "read:org"],
        forceNew
          ? { forceNewSession: true }
          : { createIfNone: true }
      );

      if (!session) {
        vscode.window.showErrorMessage("Failed to authenticate with GitHub.");
        return undefined;
      }

      return this.completeAuthentication(
        session.accessToken,
        "VS Code GitHub authentication",
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Browser authentication failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return undefined;
    }
  }

  private async signInWithToken(): Promise<StoredAccount | undefined> {
    const token = await vscode.window.showInputBox({
      prompt: "Enter your GitHub Personal Access Token",
      placeHolder: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value) return "Token is required";
        if (!value.startsWith("ghp_") && !value.startsWith("github_pat_")) {
          return "Invalid token format";
        }
        return null;
      },
    });

    if (!token) {
      return undefined;
    }

    return this.completeAuthentication(token, "Personal Access Token");
  }

  private async signInWithEnterprise(): Promise<StoredAccount | undefined> {
    const serverUrl = await vscode.window.showInputBox({
      prompt: "Enter your GitHub Enterprise Server URL",
      placeHolder: "https://github.your-company.com",
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value) return "Server URL is required";
        try {
          new URL(value);
          return null;
        } catch {
          return "Please enter a valid URL";
        }
      },
    });

    if (!serverUrl) {
      return undefined;
    }

    const token = await vscode.window.showInputBox({
      prompt: `Enter your Personal Access Token for ${serverUrl}`,
      placeHolder: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value) return "Token is required";
        return null;
      },
    });

    if (!token) {
      return undefined;
    }

    return this.completeAuthentication(
      token,
      `GitHub Enterprise (${serverUrl})`,
      serverUrl,
    );
  }

  private async switchCLIAccountAndSignIn(): Promise<
    StoredAccount | undefined
  > {
    const cliAccounts = await this.getGitHubCliAccounts();
    if (cliAccounts.length === 0) {
      vscode.window.showErrorMessage("No GitHub CLI accounts found.");
      return undefined;
    }

    const chosen = await vscode.window.showQuickPick(
      cliAccounts.map((a) => ({
        label: a.login,
        description: `${a.host}${a.active ? " · currently active in gh" : ""}`,
        account: a,
      })),
      { placeHolder: "Choose the gh account to switch to", ignoreFocusOut: true },
    );
    if (!chosen) {
      return undefined;
    }

    try {
      await execFileAsync("gh", [
        "auth",
        "switch",
        "--hostname",
        chosen.account.host,
        "--user",
        chosen.account.login,
      ]);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to switch gh account: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return undefined;
    }

    await this.syncGitHubCliAccounts();
    const account = this.accounts.find(
      (acc) =>
        acc.login === chosen.account.login &&
        (acc.cliHost ?? "github.com") === chosen.account.host,
    );
    if (!account) {
      vscode.window.showErrorMessage(
        `Switched gh to ${chosen.account.login}, but couldn't import it. Try signing in again.`,
      );
      return undefined;
    }

    try {
      const active = await this.setActiveAccount(account.id);
      vscode.window.showInformationMessage(`✓ Switched to ${account.login}.`);
      return active;
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to activate ${account.login}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return undefined;
    }
  }

  private async completeAuthentication(
    token: string,
    source?: string,
    baseUrl?: string,
    cliHost?: string,
  ): Promise<StoredAccount | undefined> {
    try {
      const profile = await this.readProfile(token, baseUrl);
      const existing = this.accounts.find((acc) => acc.login === profile.login);
      const tokenKey =
        existing?.tokenKey ?? `githubDesktop.token.${randomUUID()}`;
      const account: StoredAccount = existing ?? {
        id: randomUUID(),
        login: profile.login,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        email: profile.email,
        githubId: profile.githubId,
        tokenKey,
        baseUrl,
        managedByCli: !!cliHost,
        cliHost,
      };

      if (existing) {
        this.applyProfile(existing, profile);
        if (baseUrl) existing.baseUrl = baseUrl;
        if (cliHost) {
          existing.managedByCli = true;
          existing.cliHost = cliHost;
        }
      } else {
        this.accounts.push(account);
      }

      await this.secretStorage.store(tokenKey, token);

      this.activeAccountId = account.id;
      await this.persist();
      await this.globalState.update(ACTIVE_ACCOUNT_KEY, this.activeAccountId);
      this._onDidChangeAccounts.fire();

      if (source) {
        vscode.window.showInformationMessage(
          `✓ Signed in as ${account.login} using ${source}.`,
        );
      } else {
        vscode.window.showInformationMessage(
          `✓ Signed in as ${account.login}.`,
        );
      }
      return account;
    } catch (error) {
      if (error instanceof Error) {
        vscode.window.showErrorMessage(
          `Failed to authenticate with GitHub: ${error.message}`,
        );
      } else {
        vscode.window.showErrorMessage("Failed to authenticate with GitHub.");
      }
      return undefined;
    }
  }
}
