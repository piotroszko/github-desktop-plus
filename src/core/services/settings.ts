import * as vscode from "vscode";
import { AvatarMode, CommitDateFormat, DiffViewMode } from "../../shared/types";

/** Namespace every setting of this extension lives under. */
export const SETTINGS_NAMESPACE = "githubDesktopPlus";

/**
 * @description The extension's settings, grouped the way the Settings UI shows
 * them. Read through {@link readSettings} — never with ad-hoc
 * `getConfiguration` calls, so defaults and validation live in one place.
 */
export interface ExtensionSettings {
  git: {
    /** Executable to run, or `""` for the `git` on `PATH`. */
    path: string;
    /** Remote that operations naming a remote act on. */
    defaultRemote: string;
  };
  stash: {
    /** Include untracked files when stashing. */
    includeUntracked: boolean;
  };
  diff: {
    /** Context lines shown around each hunk. */
    contextLines: number;
    /** Where diffs are shown: the panel's pane, VS Code's editor, or both by width. */
    view: DiffViewMode;
  };
  history: {
    /** Commits per page in the History list. */
    pageSize: number;
    dateFormat: CommitDateFormat;
  };
  ui: {
    avatars: AvatarMode;
    activityBarBadge: boolean;
  };
  confirm: {
    /** Ask before discarding, resetting, force-pushing, dropping a stash. */
    destructiveActions: boolean;
  };
}

/** The values {@link normalizeSettings} works from, straight out of the config. */
export interface RawSettings {
  gitPath?: unknown;
  defaultRemote?: unknown;
  stashIncludeUntracked?: unknown;
  diffContextLines?: unknown;
  diffView?: unknown;
  historyPageSize?: unknown;
  historyDateFormat?: unknown;
  avatars?: unknown;
  activityBarBadge?: unknown;
  confirmDestructiveActions?: unknown;
}

/** Fallbacks used when a setting is absent, empty or unusable. */
export const DEFAULT_SETTINGS: ExtensionSettings = {
  git: { path: "", defaultRemote: "origin" },
  stash: { includeUntracked: true },
  diff: { contextLines: 3, view: "auto" },
  history: { pageSize: 50, dateFormat: "relative" },
  ui: { avatars: "github", activityBarBadge: true },
  confirm: { destructiveActions: true },
};

const CONTEXT_LINE_LIMITS = { min: 0, max: 50 };
const PAGE_SIZE_LIMITS = { min: 10, max: 500 };

/**
 * @description Validates raw configuration into {@link ExtensionSettings}:
 * numbers are rounded and clamped, unknown enum values and empty strings fall
 * back to the defaults, so a hand-edited `settings.json` can never put the
 * extension into a state it cannot render.
 */
export function normalizeSettings(raw: RawSettings): ExtensionSettings {
  return {
    git: {
      path: typeof raw.gitPath === "string" ? raw.gitPath.trim() : "",
      defaultRemote:
        typeof raw.defaultRemote === "string" && raw.defaultRemote.trim()
          ? raw.defaultRemote.trim()
          : DEFAULT_SETTINGS.git.defaultRemote,
    },
    stash: {
      includeUntracked:
        typeof raw.stashIncludeUntracked === "boolean"
          ? raw.stashIncludeUntracked
          : DEFAULT_SETTINGS.stash.includeUntracked,
    },
    diff: {
      contextLines: clamp(
        raw.diffContextLines,
        DEFAULT_SETTINGS.diff.contextLines,
        CONTEXT_LINE_LIMITS,
      ),
      view:
        raw.diffView === "panel" || raw.diffView === "editor"
          ? raw.diffView
          : "auto",
    },
    history: {
      pageSize: clamp(
        raw.historyPageSize,
        DEFAULT_SETTINGS.history.pageSize,
        PAGE_SIZE_LIMITS,
      ),
      dateFormat:
        raw.historyDateFormat === "absolute" ? "absolute" : "relative",
    },
    ui: {
      avatars: raw.avatars === "none" ? "none" : "github",
      activityBarBadge:
        typeof raw.activityBarBadge === "boolean"
          ? raw.activityBarBadge
          : DEFAULT_SETTINGS.ui.activityBarBadge,
    },
    confirm: {
      destructiveActions:
        typeof raw.confirmDestructiveActions === "boolean"
          ? raw.confirmDestructiveActions
          : DEFAULT_SETTINGS.confirm.destructiveActions,
    },
  };
}

/**
 * @description The settings as they are right now. Cheap enough to call per
 * operation: VS Code caches configuration reads, so a change is picked up
 * without any listener.
 */
export function readSettings(): ExtensionSettings {
  const config = vscode.workspace.getConfiguration(SETTINGS_NAMESPACE);
  return normalizeSettings({
    gitPath: config.get("git.path"),
    defaultRemote: config.get("git.defaultRemote"),
    stashIncludeUntracked: config.get("stash.includeUntracked"),
    diffContextLines: config.get("diff.contextLines"),
    diffView: config.get("diff.view"),
    historyPageSize: config.get("history.pageSize"),
    historyDateFormat: config.get("history.dateFormat"),
    avatars: config.get("ui.avatars"),
    activityBarBadge: config.get("ui.activityBarBadge"),
    confirmDestructiveActions: config.get("confirm.destructiveActions"),
  });
}

/**
 * @description Rounds to a whole number and holds it inside `limits`, so a
 * hand-edited `settings.json` cannot ask for a 0-commit page or a
 * 10 000-line diff.
 */
function clamp(
  value: unknown,
  fallback: number,
  limits: { min: number; max: number },
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(Math.round(parsed), limits.min), limits.max);
}
