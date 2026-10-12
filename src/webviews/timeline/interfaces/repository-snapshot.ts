import { ChangeEntry, CommitEntry } from "./timeline-view-provider.interface";

/**
 * @description Tracking state of the current branch against its upstream.
 */
export interface RemoteStatus {
  hasRemote: boolean;
  isPublished: boolean;
  ahead: number;
  behind: number;
  lastFetched: Date | null;
  remoteBranch: string | null;
}

/**
 * @description Minimal repository identity shown in the timeline toolbar.
 */
export interface RepositorySummary {
  name: string;
  path: string;
  remote?: string;
  /** Explicit comparison base for this repository, `null` when following the upstream. */
  baseBranch?: string | null;
}

/**
 * @description A multi-step git operation left mid-flight by a conflict.
 */
export type InProgressOperation = "merge" | "cherry-pick" | "revert" | "rebase";

/**
 * @description One entry of `git stash list`.
 */
export interface StashEntry {
  index: number;
  message: string;
  branch: string | null;
}

/**
 * @description Everything the timeline needs for one render pass, assembled by
 * the repository read model in a single call.
 */
export interface RepositorySnapshot {
  changes: ChangeEntry[];
  commits: CommitEntry[];
  hasMoreCommits: boolean;
  branches: string[];
  currentBranch: string | null;
  branchActivity: Record<string, string>;
  repository: RepositorySummary;
  remoteStatus: RemoteStatus;
  tags: Record<string, string[]>;
  /** Non-null when a merge/cherry-pick/revert/rebase is stopped in conflict. */
  operation: InProgressOperation | null;
  conflicted: string[];
  /** True when HEAD has a parent and no operation is in progress (undo is safe). */
  canUndo: boolean;
  stashes: StashEntry[];
}

/** Shared page size for commit history queries. */
export const COMMITS_PAGE_SIZE = 50;
