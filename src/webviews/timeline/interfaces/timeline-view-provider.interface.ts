import * as vscode from "vscode";

/**
 * @description One entry in the Changes tab: a path and its git status code.
 */
export interface ChangeEntry {
  path: string;
  status: string;
  staged?: boolean;
}

/**
 * @description One row of the History tab.
 */
export interface CommitEntry {
  hash: string;
  shortHash: string;
  message: string;
  authorName: string;
  authorEmail: string;
  relativeTime: string;
  committedAt: string;
  tags?: string[];
  /** `false` when the commit is known to be ahead of the upstream. */
  isPushed?: boolean;
}

/**
 * @description Aggregate detail of a single commit shown in the diff pane.
 */
export interface CommitDetail {
  summary: CommitEntry & {
    additions: number;
    deletions: number;
    fileCount: number;
  };
  files: Array<{
    path: string;
    status: string;
    additions: number | null;
    deletions: number | null;
  }>;
}

/**
 * @description Contract the extension host relies on to refresh the timeline.
 */
export interface ITimelineViewProvider extends vscode.WebviewViewProvider {
  refresh(): Promise<void>;
  /** Whether the History panel is currently on screen. */
  isVisible(): boolean;
}
