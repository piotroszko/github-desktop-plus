import { iconThemeService } from "./core/services/icon-theme.service";
import * as path from "path";
import { promises as fs } from "fs";
import * as vscode from "vscode";
import simpleGit from "simple-git";
import { AccountManager } from "./core/accounts/account-manager";
import { AutoRefresh } from "./core/services/auto-refresh";
import { RepositoryManager } from "./core/repositories/repository-manager";
import { GIT_CONTENT_SCHEME, GitContentProvider } from "./core/git/native-diff";
import { AccountsProvider } from "./ui/tree-views/accounts-provider";
import { RepositoriesProvider } from "./ui/tree-views/repositories-provider";
import { RepositoriesViewBadge } from "./ui/tree-views/changes-badge";
import { TimelineViewProvider } from "./webviews/timeline/timeline-view-provider";
import { StoredAccount, TrackedRepository } from "./shared/types";
import { getPrimaryRepository } from "./shared/utils/repo-selection";
import { listBranchRefs } from "./shared/utils/git-branches";
import {
  accountCommitEmail,
  resolveCommitIdentity,
  resolveRepositoryAccount,
} from "./shared/utils/repo-account";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  // Never let a spawned git block on an interactive credential prompt.
  process.env.GIT_TERMINAL_PROMPT = "0";

  const accountManager = new AccountManager(
    context.globalState,
    context.secrets,
  );
  const repositoryManager = new RepositoryManager(context.globalState);
  await accountManager.initialize();
  await repositoryManager.initialize();

  const accountsProvider = new AccountsProvider(accountManager);
  const repositoriesProvider = new RepositoriesProvider(
    repositoryManager,
    accountManager,
  );
  // The repositories tree is created (rather than just registered) so the
  // activity bar icon can carry the pending-change count from activation, not
  // only once the History panel has been opened.
  const repositoriesView = vscode.window.createTreeView(
    "githubDesktopPlus.repositories",
    { treeDataProvider: repositoriesProvider },
  );
  const changesBadge = new RepositoriesViewBadge(repositoriesView);

  const timelineProvider = new TimelineViewProvider(
    context,
    repositoryManager,
    accountManager,
    changesBadge,
  );

  const refreshAllViews = () => {
    void timelineProvider.refresh();
    accountsProvider.refresh();
    repositoriesProvider.refresh();
  };

  // Git state can change without VS Code noticing (a `git` command in a
  // terminal, another tool, an IDE plugin): poll the visible panel and refresh
  // as soon as the window regains focus.
  const autoRefresh = new AutoRefresh({
    refresh: () => void timelineProvider.refresh(),
    isVisible: () => timelineProvider.isVisible(),
    intervalSeconds: () =>
      vscode.workspace
        .getConfiguration("githubDesktopPlus")
        .get<number>("autoRefreshInterval", 30),
  });
  autoRefresh.start();

  context.subscriptions.push(
    autoRefresh,
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        autoRefresh.focusGained();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("githubDesktopPlus.autoRefreshInterval")) {
        autoRefresh.start();
      }
    }),
    vscode.workspace.registerTextDocumentContentProvider(
      GIT_CONTENT_SCHEME,
      new GitContentProvider(),
    ),
    vscode.window.registerTreeDataProvider(
      "githubDesktopPlus.accounts",
      accountsProvider,
    ),
    repositoriesView,
    vscode.window.registerWebviewViewProvider(
      "githubDesktopPlus.timeline",
      timelineProvider,
    ),
    vscode.commands.registerCommand("githubDesktopPlus.signIn", async () => {
      const account = await accountManager.signIn();
      if (account) {
        await linkUnassignedRepositories(repositoryManager, account.id);
        refreshAllViews();
      }
    }),
    vscode.commands.registerCommand("githubDesktopPlus.signOut", () =>
      accountManager.signOut(),
    ),
    vscode.commands.registerCommand(
      "githubDesktopPlus.signOutAccount",
      (item: any) => {
        const accountId = item?.account?.id;
        return accountManager.signOut(accountId);
      },
    ),
    vscode.commands.registerCommand("githubDesktopPlus.switchAccount", () =>
      accountManager.switchAccount(),
    ),
    vscode.commands.registerCommand(
      "githubDesktopPlus.switchToAccount",
      (accountId: string) => accountsProvider.switchToAccount(accountId),
    ),
    vscode.commands.registerCommand("githubDesktopPlus.cloneRepository", () =>
      cloneRepository(accountManager, repositoryManager, timelineProvider),
    ),
    vscode.commands.registerCommand(
      "githubDesktopPlus.openRepository",
      (repo?: TrackedRepository) =>
        openRepository(repositoryManager, timelineProvider, repo),
    ),
    vscode.commands.registerCommand(
      "githubDesktopPlus.selectRepositoryAccount",
      (repo?: TrackedRepository) =>
        selectRepositoryAccount(
          accountManager,
          repositoryManager,
          timelineProvider,
          repo,
        ),
    ),
    vscode.commands.registerCommand(
      "githubDesktopPlus.selectBaseBranch",
      (repo?: TrackedRepository) =>
        selectBaseBranch(repositoryManager, timelineProvider, repo),
    ),
    vscode.commands.registerCommand(
      "githubDesktopPlus.useAccountForRepository",
      (item?: { account?: StoredAccount }) =>
        useAccountForRepository(
          accountManager,
          repositoryManager,
          timelineProvider,
          item?.account?.id,
        ),
    ),
    vscode.commands.registerCommand("githubDesktopPlus.createIssue", () =>
      createIssue(accountManager, repositoryManager),
    ),
    vscode.commands.registerCommand("githubDesktopPlus.refreshViews", () =>
      refreshAllViews(),
    ),
    vscode.commands.registerCommand("githubDesktopPlus.addAccount", async () => {
      const account = await accountManager.addAccount();
      if (account) {
        await linkUnassignedRepositories(repositoryManager, account.id);
        refreshAllViews();
      }
    }),
    vscode.commands.registerCommand(
      "githubDesktopPlus.manageAccounts",
      async () => {
        const accounts = accountManager.getAccounts();
        if (accounts.length === 0) {
          vscode.window.showInformationMessage(
            "No GitHub accounts available. Sign in first.",
          );
          return;
        }

        const activeAccount = accountManager.getActiveAccount();
        const items = accounts.map((account) => ({
          label: account.login,
          description: account.name || "",
          detail: account.id === activeAccount?.id ? "● Active Account" : "",
          account,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: "Select an account to manage",
          matchOnDescription: true,
        });

        if (selected) {
          const action = await vscode.window.showQuickPick(
            [
              { label: "$(arrow-right) Set as Active", value: "activate" },
              { label: "$(sign-out) Sign Out", value: "signout" },
              { label: "$(sync) Refresh Token", value: "refresh" },
            ],
            {
              placeHolder: `Manage ${selected.account.login}`,
            },
          );

          if (action?.value === "activate") {
            await accountManager.setActiveAccount(selected.account.id);
            refreshAllViews();
          } else if (action?.value === "signout") {
            await accountManager.signOut(selected.account.id);
            refreshAllViews();
          } else if (action?.value === "refresh") {
            // Refresh token by re-authenticating
            const newAccount = await accountManager.signIn();
            if (newAccount) {
              refreshAllViews();
            }
          }
        }
      },
    ),
    vscode.commands.registerCommand(
      "githubDesktopPlus.removeAccount",
      async (item: any) => {
        const accountId = item?.account?.id;
        if (accountId) {
          await accountManager.signOut(accountId);
          refreshAllViews();
        } else {
          await accountManager.signOut();
          refreshAllViews();
        }
      },
    ),
    vscode.commands.registerCommand("githubDesktopPlus.refreshAccounts", async () => {
      await accountManager.syncGitHubCliAccounts();
      accountsProvider.refresh();
    }),
    accountManager.onDidChangeAccounts(() => {
      void timelineProvider.refresh();
    }),
    vscode.workspace.onDidSaveTextDocument(() => {
      void timelineProvider.refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await syncWorkspaceRepositories(accountManager, repositoryManager);
      refreshAllViews();
    }),
  );

  await syncWorkspaceRepositories(accountManager, repositoryManager);
  refreshAllViews();

  const active = accountManager.getActiveAccount();
  if (active) {
    await linkUnassignedRepositories(repositoryManager, active.id);
  }
}

export function deactivate(): void {
  // nothing to clean up
}

async function cloneRepository(
  accounts: AccountManager,
  repositories: RepositoryManager,
  timeline: TimelineViewProvider,
): Promise<void> {
  const account = accounts.getActiveAccount() ?? (await accounts.signIn());
  if (!account) {
    return;
  }

  const repoInput = await vscode.window.showInputBox({
    prompt: "Enter a repository URL or owner/name",
    placeHolder: "owner/name or https://github.com/owner/name",
    ignoreFocusOut: true,
  });

  if (!repoInput) {
    return;
  }

  const parsed = parseRepositoryIdentifier(repoInput.trim());
  if (!parsed) {
    vscode.window.showErrorMessage(
      "Could not parse the repository identifier.",
    );
    return;
  }

  const folderSelection = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Select destination folder",
  });
  if (!folderSelection || folderSelection.length === 0) {
    return;
  }

  const baseDir = folderSelection[0].fsPath;
  const targetPath = path.join(baseDir, parsed.name);
  if (await exists(targetPath)) {
    const overwrite = await vscode.window.showWarningMessage(
      `The folder ${parsed.name} already exists. Overwrite?`,
      { modal: true },
      "Overwrite",
      "Cancel",
    );
    if (overwrite !== "Overwrite") {
      return;
    }
    await fs.rm(targetPath, { recursive: true, force: true });
  }

  const token = await accounts.getToken(account.id);
  if (!token) {
    return;
  }

  const encodedUser = encodeURIComponent(account.login);
  const remoteWithToken = `https://${encodedUser}:${encodeURIComponent(
    token,
  )}@github.com/${parsed.owner}/${parsed.name}.git`;
  const cleanRemote = `https://github.com/${parsed.owner}/${parsed.name}.git`;

  const git = simpleGit();
  const progress = vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Cloning ${parsed.owner}/${parsed.name}`,
      cancellable: false,
    },
    async (progressState) => {
      progressState.report({ message: "Fetching repository data..." });
      await git.clone(remoteWithToken, targetPath, ["--progress"]);
      const repoGit = simpleGit(targetPath);
      await repoGit.remote(["set-url", "origin", cleanRemote]);
    },
  );

  try {
    await progress;
    await repositories.addRepository({
      accountId: account.id,
      localPath: targetPath,
      owner: parsed.owner,
      name: parsed.name,
      remoteUrl: cleanRemote,
    });
    await timeline.refresh();
    vscode.window.showInformationMessage(
      `Cloned ${parsed.owner}/${parsed.name} successfully.`,
    );
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(
        `Failed to clone repository: ${error.message}`,
      );
    } else {
      vscode.window.showErrorMessage("Failed to clone repository.");
    }
  }
}

async function openRepository(
  repositories: RepositoryManager,
  timeline: TimelineViewProvider,
  repoArg?: TrackedRepository,
): Promise<void> {
  let repo = repoArg;
  if (!repo) {
    const selection = await pickRepository(repositories);
    repo = selection ?? undefined;
  }
  if (!repo) {
    return;
  }

  // Select the repo inside the extension only: the VS Code window keeps its
  // current workspace (and focus) instead of switching to the picked folder.
  repositories.setActiveRepository(repo.localPath);
  await timeline.refresh();
}

/**
 * @description Pins `accountId` — or, with `undefined`, "follow the active
 * account" — as the account `repo` authenticates as, then repaints the panel.
 * Every account-selection surface (picker command, Accounts tree, History
 * avatar menu) funnels through here, so they cannot disagree.
 */
async function applyRepositoryAccount(
  repositories: RepositoryManager,
  timeline: TimelineViewProvider,
  repo: TrackedRepository,
  accountId: string | undefined,
): Promise<void> {
  await repositories.updateRepository(repo.id, { accountId });
  await timeline.refresh();
}

/**
 * @description Accounts tree entry ("Use Account for Current Repository"):
 * applies one account to whichever repository the extension is currently
 * working on. Falls back to an account picker when invoked without an account
 * (e.g. from the command palette).
 */
async function useAccountForRepository(
  accounts: AccountManager,
  repositories: RepositoryManager,
  timeline: TimelineViewProvider,
  accountIdArg?: string,
): Promise<void> {
  const repo = getPrimaryRepository(repositories);
  if (!repo) {
    vscode.window.showInformationMessage("Select or clone a repository first.");
    return;
  }

  let account: StoredAccount | undefined;
  if (accountIdArg) {
    account = accounts.getAccountById(accountIdArg);
    if (!account) {
      vscode.window.showErrorMessage("Account not found.");
      return;
    }
  } else {
    const active = accounts.getActiveAccount();
    const picked = await vscode.window.showQuickPick(
      accounts.getAccounts().map((candidate) => ({
        label: candidate.login,
        description: candidate.id === active?.id ? "active" : "",
        account: candidate,
      })),
      {
        placeHolder: `Account for ${repo.owner}/${repo.name}`,
        ignoreFocusOut: true,
      },
    );
    account = picked?.account;
  }
  if (!account) {
    return;
  }

  await applyRepositoryAccount(repositories, timeline, repo, account.id);
  vscode.window.showInformationMessage(
    `${repo.owner}/${repo.name} now authenticates as ${account.login}.`,
  );
}

/**
 * @description Picks the branch the extension compares against for one
 * repository — the ahead/behind numbers in the sync cell, the pull-request
 * compare link and the pull-request list. It is an extension setting only: the
 * repository's tracked upstream, and therefore push and pull, stay untouched.
 */
async function selectBaseBranch(
  repositories: RepositoryManager,
  timeline: TimelineViewProvider,
  repoArg?: TrackedRepository,
): Promise<void> {
  const repo = repoArg ?? (await pickRepository(repositories));
  if (!repo) {
    vscode.window.showInformationMessage("Select or clone a repository first.");
    return;
  }

  const refs = await listBranchRefs(repo.localPath);
  if (refs.length === 0) {
    vscode.window.showInformationMessage(
      "This repository has no branches to compare against yet.",
    );
    return;
  }

  const items: (vscode.QuickPickItem & { ref?: string })[] = [
    ...(repo.baseBranch
      ? [
          {
            label: "$(sync) Follow the tracked branch",
            description: `currently ${repo.baseBranch}`,
          },
        ]
      : []),
    ...refs.map((ref) => ({
      label: ref,
      description: ref === repo.baseBranch ? "current base" : "",
      ref,
    })),
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `Compare ${repo.owner}/${repo.name} against…`,
    ignoreFocusOut: true,
  });
  if (!picked) {
    return;
  }

  await repositories.updateRepository(repo.id, { baseBranch: picked.ref });
  await timeline.refresh();
  vscode.window.showInformationMessage(
    picked.ref
      ? `${repo.owner}/${repo.name} now compares against ${picked.ref}.`
      : `${repo.owner}/${repo.name} follows its tracked branch again.`,
  );
}

/**
 * @description Picks the GitHub account a single repository authenticates as.
 * Scoping is per-repository only: it never changes the extension's active
 * account, so other repositories keep the account they were using.
 */
async function selectRepositoryAccount(
  accounts: AccountManager,
  repositories: RepositoryManager,
  timeline: TimelineViewProvider,
  repoArg?: TrackedRepository,
): Promise<void> {
  const repo = repoArg ?? (await pickRepository(repositories));
  if (!repo) {
    vscode.window.showInformationMessage("Select or clone a repository first.");
    return;
  }

  const stored = accounts.getAccounts();
  if (stored.length === 0) {
    vscode.window.showInformationMessage("Sign in to a GitHub account first.");
    return;
  }

  const active = accounts.getActiveAccount();
  const current = repo.accountId
    ? accounts.getAccountById(repo.accountId)
    : undefined;

  const items: (vscode.QuickPickItem & { accountId?: string })[] = stored.map(
    (account) => {
      const email = accountCommitEmail(account);
      return {
        label: account.login,
        description: [
          account.id === repo.accountId ? "selected" : undefined,
          account.id === active?.id ? "active" : undefined,
        ]
          .filter(Boolean)
          .join(" • "),
        detail: email
          ? `commits as ${account.name?.trim() || account.login} <${email}>`
          : "no commit email yet — commits use your git config",
        accountId: account.id,
      };
    },
  );
  if (repo.accountId) {
    items.push({
      label: "$(sync) Follow the active account",
      description: `currently ${current?.login ?? repo.accountId}`,
    });
  }

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `Account for ${repo.owner}/${repo.name}${
      current
        ? ` (currently ${current.login})`
        : " (currently the active account)"
    }`,
    ignoreFocusOut: true,
  });
  if (!picked) {
    return;
  }

  await applyRepositoryAccount(repositories, timeline, repo, picked.accountId);

  const effective = resolveRepositoryAccount(accounts, repo);
  const identity = resolveCommitIdentity(accounts, repo);
  const authoredAs = identity
    ? ` — commits as ${identity.name} <${identity.email}>`
    : "";
  vscode.window.showInformationMessage(
    picked.accountId
      ? `${repo.owner}/${repo.name} now authenticates as ${effective?.login ?? picked.label}${authoredAs}.`
      : `${repo.owner}/${repo.name} now follows the active account${
          active ? ` (${active.login})` : ""
        }${authoredAs}.`,
  );
}

async function createIssue(
  accounts: AccountManager,
  repositories: RepositoryManager,
): Promise<void> {
  const repo = await pickRepository(repositories);
  if (!repo) {
    vscode.window.showInformationMessage("Select or clone a repository first.");
    return;
  }

  const account = resolveRepositoryAccount(accounts, repo);
  if (!account) {
    vscode.window.showInformationMessage(
      "Sign in to a GitHub account to create an issue.",
    );
    return;
  }

  const octokit = await accounts.getOctokit(account.id);
  if (!octokit) {
    return;
  }

  const title = await vscode.window.showInputBox({
    prompt: "Issue title",
    ignoreFocusOut: true,
  });
  if (!title) {
    return;
  }

  const body = await vscode.window.showInputBox({
    prompt: "Issue description (optional)",
    ignoreFocusOut: true,
    value: "",
  });

  try {
    const response = await octokit.rest.issues.create({
      owner: repo.owner,
      repo: repo.name,
      title,
      body: body ?? undefined,
    });
    vscode.window.showInformationMessage(
      `Issue created: ${response.data.title}`,
    );
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(
        `Failed to create issue: ${error.message}`,
      );
    } else {
      vscode.window.showErrorMessage("Failed to create issue.");
    }
  }
}

function parseRepositoryIdentifier(
  input: string,
): { owner: string; name: string } | undefined {
  const patterns = [
    /github.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i,
    /^([^/]+)\/([^/]+)$/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(input.trim());
    if (match) {
      return { owner: match[1], name: match[2] };
    }
  }
  return undefined;
}

async function pickRepository(
  repositories: RepositoryManager,
): Promise<TrackedRepository | undefined> {
  const repos = repositories.getRepositories();
  if (repos.length === 0) {
    return undefined;
  }

  const selection = await vscode.window.showQuickPick(
    repos.map((repo) => ({
      label: `${repo.owner}/${repo.name}`,
      description: repo.localPath,
      repo,
    })),
    {
      placeHolder: "Select a repository",
      ignoreFocusOut: true,
    },
  );
  return selection?.repo;
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function syncWorkspaceRepositories(
  accounts: AccountManager,
  repositories: RepositoryManager,
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    const localPath = folder.uri.fsPath;
    if (repositories.findByPath(localPath)) {
      continue;
    }

    if (!(await exists(path.join(localPath, ".git")))) {
      continue;
    }

    const metadata = await detectRepositoryMetadata(localPath);
    if (!metadata) {
      continue;
    }

    await repositories.addRepository({
      localPath,
      owner: metadata.owner,
      name: metadata.name,
      remoteUrl: metadata.remoteUrl,
      accountId: accounts.getActiveAccount()?.id,
    });
  }
}

async function detectRepositoryMetadata(
  localPath: string,
): Promise<{ owner: string; name: string; remoteUrl?: string }> {
  try {
    const git = simpleGit(localPath);
    const remotes = await git.getRemotes(true);
    const origin =
      remotes.find((remote) => remote.name === "origin") ?? remotes[0];
    const remoteUrl = origin?.refs.fetch ?? origin?.refs.push;
    if (remoteUrl) {
      const parsed = parseRepositoryIdentifier(remoteUrl);
      if (parsed) {
        return { ...parsed, remoteUrl };
      }
    }
  } catch {
    // fall through to folder-based metadata
  }

  const folderName = path.basename(localPath);
  return { owner: "local", name: folderName };
}

async function linkUnassignedRepositories(
  repositories: RepositoryManager,
  accountId: string,
): Promise<void> {
  const repos = repositories.getRepositories();
  const updates = repos.filter((repo) => !repo.accountId);
  for (const repo of updates) {
    await repositories.updateRepository(repo.id, { accountId });
  }
}
