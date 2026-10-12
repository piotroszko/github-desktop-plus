import {
  ChangeEntry,
  CommitEntry,
  CommitDetail,
} from "./interfaces/timeline-view-provider.interface";
import {
  InProgressOperation,
  RemoteStatus,
  RepositorySummary,
  StashEntry,
} from "./interfaces/repository-snapshot";
import { PullRequestSummary } from "./ports";
import { CommitDraft, DiffViewMode } from "../../shared/types";

/* ------------------------------------------------------------------ *
 *  Inbound: webview -> extension
 * ------------------------------------------------------------------ */

/**
 * @description Every message the timeline webview can send, as a discriminated
 * union keyed on `command`. Handlers narrow on `command` and get fully typed
 * payloads — no `any`, no manual casts.
 */
export type InboundMessage =
  | { command: "ready" }
  | { command: "refresh" }
  | { command: "selectRepository"; path: string }
  | {
      command: "selectRepoAccount";
      /** Account to pin the active repository to; omit to follow the active account. */
      accountId?: string;
    }
  | { command: "generateCommitMessage" }
  | {
      command: "updateDraft";
      /** Repository the draft belongs to (the webview's current one). */
      path: string;
      draft: CommitDraft;
    }
  | {
      command: "openNativeDiff";
      /** File to show; omit to show every file `hash` touched. */
      filePath?: string;
      /** Commit to show changes for; omit for the working-tree changes. */
      hash?: string;
    }
  | { command: "addLocalRepository" }
  | { command: "cloneRepository" }
  | { command: "stageFiles"; files: string[] }
  | { command: "unstageFiles"; files: string[] }
  | { command: "commit"; message: string }
  | { command: "commitFiles"; message: string; files: string[] }
  | { command: "amendCommit"; message: string; files: string[] }
  | { command: "undoLastCommit" }
  | { command: "discardFiles"; files: string[] }
  | { command: "markResolved"; files: string[] }
  | { command: "abortOperation" }
  | { command: "continueOperation" }
  | { command: "getStashes" }
  | { command: "stashPush"; message: string }
  | { command: "stashApply"; index: number; drop: boolean }
  | { command: "stashDrop"; index: number }
  | { command: "getWorkingDiff"; filePath: string }
  | { command: "fetch" }
  | { command: "pull" }
  | { command: "push" }
  | { command: "forcePush" }
  | { command: "publish" }
  | { command: "checkoutBranch"; branch: string }
  | { command: "createBranch"; branchName: string }
  | {
      command: "createBranchWithChanges";
      branchName: string;
      bringChanges: boolean;
    }
  | { command: "mergeBranch"; fromBranch: string; toBranch: string }
  | { command: "compareBranch"; branch: string }
  | { command: "createPullRequest"; branch: string }
  | { command: "getPullRequests" }
  | { command: "checkoutPullRequest"; number: number }
  | { command: "openRepoOnGitHub" }
  | { command: "loadMoreCommits"; offset: number }
  | { command: "getCommitDetails"; hash: string }
  | { command: "getFileDiff"; hash: string; filePath: string }
  | { command: "selectCommit"; hash: string }
  | { command: "selectFile"; hash: string; path: string }
  | { command: "resetToCommit"; hash: string }
  | { command: "checkoutCommit"; hash: string }
  | { command: "revertCommit"; hash: string }
  | { command: "cherryPickCommit"; hash: string }
  | { command: "createBranchFromCommit"; hash: string }
  | { command: "createTagFromCommit"; hash: string }
  | { command: "viewCommitOnGitHub"; hash: string };

export type InboundCommand = InboundMessage["command"];

/* ------------------------------------------------------------------ *
 *  Outbound: extension -> webview
 * ------------------------------------------------------------------ */

/**
 * @description A long-running operation the webview should show as in flight,
 * so buttons can disable and animate until it finishes (or fails).
 */
export type BusyTask =
  | "fetch"
  | "pull"
  | "push"
  | "forcePush"
  | "publish"
  | "commit"
  | "continue"
  | "abort";

export type OutboundMessage =
  | { command: "busy"; task: BusyTask | null }
  | {
      command: "commitMessage";
      /** Generated subject, or `null` when generation failed. */
      summary: string | null;
      /** Generated body, when the model returned one. */
      description: string | null;
      /** Why generation failed, or `null` on success. */
      error: string | null;
    }
  | { command: "draft"; path: string | null; draft: CommitDraft | null }
  | { command: "updateRepository"; repository: RepositorySummary | null }
  | {
      command: "updateRepositoryList";
      repositories: Array<{ name: string; path: string }>;
      activePath: string | null;
    }
  | { command: "updateChanges"; changes: ChangeEntry[] }
  | {
      command: "updateHistory";
      history: CommitEntry[];
      hasMoreCommits: boolean;
      offset: number;
    }
  | {
      command: "updateBranches";
      branches: string[];
      currentBranch: string | null;
      branchActivity: Record<string, string>;
    }
  | {
      command: "updateAccounts";
      /**
       * The account the timeline acts as: the active repository's selected
       * account when it has one, otherwise the extension-wide active account.
       * `null` when no account is available.
       */
      account: {
        login: string;
        name?: string;
        avatarUrl?: string;
      } | null;
      /** Every signed-in account, for the avatar's account menu. */
      accounts: {
        id: string;
        login: string;
        avatarUrl?: string;
        /**
         * Address commits this account creates are authored with (`undefined`
         * when nothing is known yet, in which case git's own config applies).
         */
        commitEmail?: string;
        /** The extension-wide active account. */
        active: boolean;
        /** The account currently pinned on the active repository. */
        selected: boolean;
      }[];
      /** The active repository's pinned account, or `null` when it follows the active one. */
      pinnedAccountId: string | null;
    }
  | {
      command: "updateRemoteStatus";
      remoteStatus: RemoteStatus;
      tags: Record<string, string[]>;
    }
  | {
      command: "updateCommitAvatars";
      avatars: Record<string, string>;
    }
  | {
      command: "loadMoreCommitsResponse";
      history: CommitEntry[];
      hasMoreCommits: boolean;
      offset: number;
    }
  | {
      command: "branchComparison";
      branch: string;
      ahead: CommitEntry[];
      behind: CommitEntry[];
    }
  | { command: "commitSucceeded" }
  | { command: "mergeConflict"; operation: string; files: string[] }
  | {
      command: "updateOperation";
      operation: InProgressOperation | null;
      conflicted: string[];
      canUndo: boolean;
      lastCommitSummary: string | null;
    }
  | { command: "updateStashes"; stashes: StashEntry[] }
  | {
      command: "updatePullRequests";
      pullRequests: PullRequestSummary[];
      error?: string;
    }
  | { command: "workingDiff"; payload: { path: string; diff: string } }
  | { command: "fileDiff"; payload: { path: string; diff: string } }
  | { command: "commitDetail"; payload: CommitDetail }
  | { command: "updateDiffMode"; mode: DiffViewMode }
  | { command: "error"; message: string };
