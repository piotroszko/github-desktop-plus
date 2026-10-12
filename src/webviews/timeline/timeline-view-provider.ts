import * as vscode from "vscode";
import { RepositoryManager } from "../../core/repositories/repository-manager";
import { AccountManager } from "../../core/accounts/account-manager";
import { AccountGitClientFactory } from "../../core/git/git-authenticator";
import { ITimelineViewProvider } from "./interfaces/timeline-view-provider.interface";
import {
  AccountGitHubApi,
  VsCodeBrowser,
  VsCodeNativeDiff,
  VsCodeNotifier,
  VsCodeWebviewChannel,
  WorkspaceRepositoryContext,
} from "./adapters/vscode-adapters";
import { NativeDiffViewer } from "../../core/git/native-diff";
import { CommitDraftStore } from "../../core/services/commit-draft-store";
import { ChangesBadge } from "./ports";
import { CliCommitMessageGenerator } from "../../core/git/commit-message";
import { TimelineController } from "./timeline-controller";
import { WebviewHtmlService } from "./services/webview-html.service";

const REFRESH_DEBOUNCE_MS = 400;

/**
 * @description Binds the timeline webview to a {@link TimelineController}.
 * Owns only VS Code lifecycle concerns: HTML, message plumbing, visibility and
 * a debounced refresh so a burst of file saves triggers one recompute.
 */
export class TimelineViewProvider implements ITimelineViewProvider {
  private controller: TimelineController | undefined;
  private readonly htmlService: WebviewHtmlService;
  private readonly drafts: CommitDraftStore;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private visible = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repositories: RepositoryManager,
    private readonly accounts: AccountManager,
    private readonly badge: ChangesBadge,
  ) {
    this.drafts = new CommitDraftStore(context.globalState);
    this.htmlService = new WebviewHtmlService(
      context,
      repositories,
      this.drafts,
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "out"),
      ],
    };
    webviewView.webview.html = this.htmlService.generateHtml(
      webviewView.webview,
    );

    this.controller = new TimelineController({
      repos: new WorkspaceRepositoryContext(this.repositories),
      notifier: new VsCodeNotifier(),
      channel: new VsCodeWebviewChannel(webviewView.webview),
      browser: new VsCodeBrowser(),
      git: new AccountGitClientFactory(this.accounts),
      accounts: this.accounts,
      githubApi: new AccountGitHubApi(this.accounts),
      nativeDiff: new VsCodeNativeDiff(new NativeDiffViewer()),
      drafts: this.drafts,
      badge: this.badge,
      generator: new CliCommitMessageGenerator(),
    });

    webviewView.webview.onDidReceiveMessage((message) =>
      this.controller?.handle(message),
    );
    this.visible = webviewView.visible;
    webviewView.onDidChangeVisibility(() => {
      this.visible = webviewView.visible;
      if (webviewView.visible) {
        void this.controller?.refresh();
      }
    });
    webviewView.onDidDispose(() => {
      this.visible = false;
    });

    void this.controller.refresh();
  }

  /** Whether the History panel is on screen (false before it is first shown). */
  isVisible(): boolean {
    return this.visible;
  }

  /** Debounced: coalesces bursts (e.g. save-all) into a single recompute. */
  refresh(): Promise<void> {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    return new Promise((resolve) => {
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = undefined;
        void this.controller?.refresh().finally(resolve);
      }, REFRESH_DEBOUNCE_MS);
    });
  }
}
