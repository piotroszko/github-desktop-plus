import * as path from "path";
import * as vscode from "vscode";
import { RepositoryManager } from "@core/repositories/repository-manager";
import { getPrimaryRepository } from "@shared/utils/repo-selection";
import { CommitDraftStore } from "@core/services/commit-draft-store";

/**
 * Renders the timeline webview as a self-contained GitHub Desktop-style UI:
 * a three-cell toolbar (repository / branch / sync), a left column with the
 * Changes and History tabs plus the commit box, and a diff pane on the right.
 *
 * Everything is inlined (no bundle, no CDN, nonce-based CSP) so the view keeps
 * working regardless of the webview module loader.
 */
export class WebviewHtmlService {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repositories: RepositoryManager,
    private readonly drafts: CommitDraftStore,
  ) {}

  generateHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const repository = getPrimaryRepository(this.repositories);
    const initialData = {
      repository: repository
        ? {
            name: path.basename(repository.localPath),
            path: repository.localPath,
            remote: repository.remoteUrl,
          }
        : null,
      // Restore the half-written commit message and ticks the panel was showing
      // before it was recreated.
      draftPath: repository?.localPath ?? null,
      draft: repository
        ? (this.drafts.get(repository.localPath) ?? null)
        : null,
    };

    const csp = [
      `default-src 'none'`,
      `style-src 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} https: data:`,
      `font-src ${webview.cspSource}`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GitHub Desktop Plus</title>
<style nonce="${nonce}">
${STYLES}
</style>
</head>
<body>
<div id="toolbar">
  <button class="cell" id="repoCell" type="button" title="Current repository">
    <span class="cell-ico">${ICON.repo}</span>
    <span class="cell-text">
      <span class="cell-label">Current repository</span>
      <span class="cell-value" id="repoName">&mdash;</span>
    </span>
    <span class="cell-caret">${ICON.caret}</span>
  </button>
  <button class="cell" id="branchCell" type="button" title="Current branch">
    <span class="cell-ico">${ICON.branch}</span>
    <span class="cell-text">
      <span class="cell-label">Current branch</span>
      <span class="cell-value" id="branchName">&mdash;</span>
    </span>
    <span class="cell-caret">${ICON.caret}</span>
  </button>
  <button class="cell" id="syncCell" type="button">
    <span class="cell-ico" id="syncIco">${ICON.fetch}</span>
    <span class="cell-text">
      <span class="cell-value" id="syncLabel">Fetch origin</span>
      <span class="cell-label" id="syncSub">Never fetched</span>
    </span>
    <span class="cell-count" id="syncCount" hidden></span>
  </button>
</div>

<div id="body">
  <div id="left">
    <div id="tabs">
      <button class="tab is-active" data-tab="changes" type="button">Changes <span class="badge" id="changesBadge">0</span></button>
      <button class="tab" data-tab="history" type="button">History</button>
    </div>

    <div class="tabpane" id="pane-changes">
      <div id="conflictBar" hidden>
        <div id="conflictText"></div>
        <div id="conflictActions">
          <button id="conflictAbort" type="button">Abort</button>
          <button id="conflictContinue" type="button">Continue</button>
        </div>
      </div>
      <div id="filterWrap">
        <input id="filter" type="text" placeholder="Filter changed files" autocomplete="off" spellcheck="false">
      </div>
      <label id="allRow">
        <input type="checkbox" id="allCheck">
        <span id="allText">0 changed files</span>
      </label>
      <div id="fileList"></div>
      <div id="noChanges" class="empty-block">
        <div class="empty-emoji">${ICON.check}</div>
        <div class="empty-title">No local changes</div>
        <div class="empty-sub">There are no uncommitted changes in this repository.</div>
      </div>
      <div id="commitBox">
        <div class="commit-summary">
          <button type="button" class="avatar" id="avatar" title="Account for this repository">?</button>
          <input id="summary" type="text" placeholder="Summary (required)" autocomplete="off">
          <button id="genSummary" class="row-btn" type="button" title="Draft a commit message from the staged changes (feat:, fix:, … — max 100 characters)">${ICON.wand}</button>
        </div>
        <textarea id="description" placeholder="Description"></textarea>
        <input id="coAuthors" type="text" hidden autocomplete="off"
          placeholder="Co-authors: @handle, Name &lt;email&gt;">
        <div id="commitMeta">
          <button id="coAuthToggle" type="button" title="Add co-authors">${ICON.people}</button>
          <label id="amendRow"><input type="checkbox" id="amendCheck"> Amend</label>
        </div>
        <button id="commitBtn" type="button" disabled>Commit to <strong id="commitBranch">branch</strong></button>
      </div>
      <div id="lastCommitBar" hidden>
        <span id="lastCommitText"></span>
        <button id="undoBtn2" type="button">Undo</button>
      </div>
    </div>

    <div class="tabpane" id="pane-history" hidden>
      <div id="compareBar" hidden>
        <span id="compareText"></span>
        <button id="compareExit" type="button">✕</button>
      </div>
      <div id="commitList"></div>
      <div id="noHistory" class="empty-block" hidden>
        <div class="empty-title">No history</div>
      </div>
    </div>
  </div>

  <div id="right">
    <div id="rightEmpty">
      <div id="emptyHeading">No local changes</div>
      <div id="emptySub">There are no uncommitted changes in this repository. Here is what you can do next.</div>
      <div id="emptyCards"></div>
    </div>
    <div id="diffHeader" hidden><span id="diffPath"></span></div>
    <div id="diffBody" hidden></div>
  </div>
</div>

<div id="menu" class="menu" hidden></div>

<script nonce="${nonce}">
window.__INITIAL__ = ${JSON.stringify(initialData)};
${SCRIPT}
</script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

const ICON = {
  repo: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.5 2.5 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.5 2.5 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.25.25 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z"/></svg>`,
  branch: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/></svg>`,
  fetch: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0Zm.5 4.75a.75.75 0 0 0-1.5 0v3.5c0 .414.336.75.75.75h2.5a.75.75 0 0 0 0-1.5H8.5Z"/></svg>`,
  push: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 1.5 3.75 5.75l1.06 1.06L7.25 4.4v7.35h1.5V4.4l2.44 2.41 1.06-1.06Z"/></svg>`,
  pull: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 14.5 3.75 10.25l1.06-1.06L7.25 11.6V4.25h1.5v7.35l2.44-2.41 1.06 1.06Z"/></svg>`,
  publish: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 1 4 5h2.5v5h3V5H12ZM3 12.5h10V14H3Z"/></svg>`,
  wand: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M6 1.2 7.15 4.35 10.3 5.5 7.15 6.65 6 9.8 4.85 6.65 1.7 5.5 4.85 4.35ZM11.4 8.6l.75 2.05 2.05.75-2.05.75-.75 2.05-.75-2.05-2.05-.75 2.05-.75Z"/></svg>`,
  spinner: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="6" opacity=".3"/><path d="M14 8a6 6 0 0 0-6-6"/></svg>`,
  caret: `<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M4 6l4 4 4-4Z"/></svg>`,
  plus: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>`,
  minus: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3.5 8h9"/></svg>`,
  discard: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3.5v4h4"/><path d="M3.4 7.4A5.2 5.2 0 1 1 5 12.6"/></svg>`,
  check: `<svg viewBox="0 0 16 16" width="28" height="28" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>`,
  file: `<svg viewBox="0 0 16 16" width="28" height="28" fill="currentColor"><path d="M2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 12.25 16h-8.5A1.75 1.75 0 0 1 2 14.25Zm7.5-.25v2.75c0 .414.336.75.75.75h2.75Z"/></svg>`,
  people: `<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor"><path d="M5.5 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm0 5c2 0 3.5 1 3.5 2.75V12H2v-.75C2 9.5 3.5 8.5 5.5 8.5Zm5.5-4a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5Zm.25 4.5c1.66 0 2.75.9 2.75 2.4V12h-3.2c.06-.28.2-.85.2-1.25 0-.7-.2-1.3-.55-1.8.27-.06.55-.1.85-.1Z"/></svg>`,
  linkExt: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M3.75 2h3a.75.75 0 0 1 0 1.5h-3a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3a.75.75 0 0 1 1.5 0v3A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm5.5-.5a.75.75 0 0 1 .75-.75h3.75a.75.75 0 0 1 .75.75V5.5a.75.75 0 0 1-1.5 0V3.56L8.53 8.28a.75.75 0 0 1-1.06-1.06L12.19 2.5H10a.75.75 0 0 1-.75-.75Z"/></svg>`,
};

const STYLES = `
* { box-sizing: border-box; margin: 0; padding: 0; }
[hidden] { display: none !important; }
:root {
  color-scheme: light dark;
  --gd-accent: var(--vscode-button-background, #1f6feb);
  --gd-accent-fg: var(--vscode-button-foreground, #fff);
  --gd-chrome: var(--vscode-sideBarSectionHeader-background, var(--vscode-sideBar-background));
  --gd-border: var(--vscode-panel-border, rgba(128,128,128,.28));
  --gd-radius: 6px;
}
html, body { height: 100%; }
body {
  display: flex; flex-direction: column;
  font-family: var(--vscode-font-family, -apple-system, "Segoe UI", system-ui, sans-serif);
  font-size: 12px; line-height: 1.4;
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
  overflow: hidden;
}
button, input, textarea { font: inherit; color: inherit; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); border-radius: 5px; background-clip: padding-box; border: 2px solid transparent; }
::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); }

/* ---- toolbar (compact single line — the panel is short on height) ---- */
#toolbar {
  display: flex; flex: 0 0 auto; height: 30px;
  background: var(--gd-chrome);
  border-bottom: 1px solid var(--gd-border);
}
.cell {
  display: flex; align-items: center; gap: 6px;
  flex: 1 1 0; min-width: 0; padding: 0 9px;
  background: transparent; border: 0;
  border-right: 1px solid var(--gd-border);
  cursor: pointer; text-align: left;
}
.cell:last-child { border-right: 0; }
.cell:hover { background: var(--vscode-list-hoverBackground); }
.cell:active { background: var(--vscode-list-activeSelectionBackground); }
.cell:disabled { cursor: default; }
.cell:disabled:hover, .cell:disabled:active { background: transparent; }
.cell.is-busy .cell-ico { opacity: 1; color: var(--gd-accent); }
/* Long-running operations: a rotating arc next to the label. */
.spin { animation: gd-spin .9s linear infinite; }
@keyframes gd-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin, .row-btn.is-busy svg { animation: none; } }
.cell-ico { flex: 0 0 auto; display: flex; opacity: .75; }
.cell-ico svg { width: 13px; height: 13px; }
.cell-text { display: flex; min-width: 0; }
.cell-label { display: none; }
.cell-value {
  flex: 1 1 auto; font-weight: 600; font-size: 11px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cell-caret { flex: 0 0 auto; opacity: .45; }
.cell-caret svg { width: 9px; height: 9px; }
.cell-count {
  flex: 0 0 auto; display: inline-flex; align-items: center; gap: 2px;
  font-size: 10px; font-weight: 600; padding: 0 5px; border-radius: 9px;
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
}

/* ---- body split ---- */
#body { flex: 1 1 auto; display: flex; min-height: 0; }
#left {
  flex: 0 0 46%; max-width: 340px; min-width: 220px;
  display: flex; flex-direction: column; min-height: 0;
  background: var(--vscode-sideBar-background);
  border-right: 1px solid var(--gd-border);
}
body.narrow #left { flex: 1 1 auto; max-width: none; border-right: 0; }
body.narrow #right { display: none; }
#right { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; background: var(--vscode-editor-background); }

/* ---- right: rich empty state (GitHub Desktop "No local changes") ---- */
#rightEmpty { flex: 1 1 auto; overflow: auto; padding: 32px 28px; }
#emptyHeading { font-size: 26px; font-weight: 300; color: var(--vscode-foreground); }
#emptySub { margin-top: 8px; font-size: 12px; color: var(--vscode-descriptionForeground); max-width: 420px; line-height: 1.5; }
#emptyCards { margin-top: 22px; display: flex; flex-direction: column; gap: 12px; max-width: 520px; }
.empty-card {
  border: 1px solid var(--gd-border); border-radius: 8px; padding: 14px 16px;
  display: flex; align-items: center; gap: 14px;
}
.empty-card.is-primary { border-color: var(--gd-accent); background: color-mix(in srgb, var(--gd-accent) 8%, transparent); }
.empty-card-body { flex: 1 1 auto; min-width: 0; }
.empty-card-title { font-size: 12px; font-weight: 600; }
.empty-card-desc { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 3px; line-height: 1.45; }
.empty-card-btn {
  flex: 0 0 auto; padding: 6px 14px; border-radius: var(--gd-radius); cursor: pointer;
  font-size: 12px; font-weight: 600; border: 1px solid var(--gd-border);
  background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-foreground);
  display: inline-flex; align-items: center; gap: 6px;
}
.empty-card.is-primary .empty-card-btn { background: var(--gd-accent); color: var(--gd-accent-fg); border-color: transparent; }
.empty-card-btn:hover { filter: brightness(1.1); }

/* ---- tabs ---- */
#tabs { display: flex; flex: 0 0 auto; background: var(--gd-chrome); border-bottom: 1px solid var(--gd-border); }
.tab {
  flex: 1 1 0; height: 28px; background: transparent; border: 0;
  border-bottom: 2px solid transparent; cursor: pointer; font-size: 12px;
  color: var(--vscode-descriptionForeground); font-weight: 500;
  display: flex; align-items: center; justify-content: center; gap: 6px;
}
.tab:hover { color: var(--vscode-foreground); }
.tab.is-active { color: var(--vscode-foreground); border-bottom-color: var(--gd-accent); }
.badge {
  font-size: 10px; font-weight: 600; min-width: 16px; padding: 1px 5px; border-radius: 9px;
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
}
.tabpane { flex: 1 1 auto; min-height: 0; }
/* Changes: the file list is the only scrolling part; the commit form and the
   "Committed …" bar stay pinned to the bottom of the panel, GitHub Desktop
   style, whatever the list length. The pane itself only scrolls when it is
   shorter than the form. */
#pane-changes { display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden; }
#pane-history { display: flex; flex-direction: column; overflow: hidden; }

/* ---- changed files ---- */
#filterWrap { flex: 0 0 auto; padding: 8px 10px 4px; }
#filter {
  width: 100%; padding: 5px 8px; border-radius: var(--gd-radius); font-size: 12px;
  background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--gd-border));
}
#filter:focus { outline: 0; border-color: var(--vscode-focusBorder); }
#allRow {
  flex: 0 0 auto; display: flex; align-items: center; gap: 8px;
  padding: 6px 12px; font-size: 11px; color: var(--vscode-descriptionForeground);
  cursor: pointer;
}
#allRow input, .file-row input[type=checkbox] { width: 13px; height: 13px; accent-color: var(--gd-accent); cursor: pointer; }
#fileList { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.file-row {
  display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 12px; cursor: pointer;
  white-space: nowrap; font-size: 12px;
}
.file-row:hover { background: var(--vscode-list-hoverBackground); }
.file-row.is-selected { background: var(--vscode-list-inactiveSelectionBackground); }
.file-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; }
.file-dir { opacity: .55; }
.status-sq {
  flex: 0 0 auto; width: 16px; height: 16px; border-radius: 3px;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; line-height: 1; color: #fff;
}
.st-M { background: var(--vscode-gitDecoration-modifiedResourceForeground, #d0a215); }
.st-A, .st-U { background: var(--vscode-gitDecoration-untrackedResourceForeground, #2ea043); }
.st-D { background: var(--vscode-gitDecoration-deletedResourceForeground, #d73a49); }
.st-R { background: var(--vscode-gitDecoration-renamedResourceForeground, #8250df); }
.st-C { background: var(--vscode-gitDecoration-conflictingResourceForeground, #e4676b); }
/* ---- staged / unstaged sections ---- */
.group { display: flex; flex-direction: column; }
.group + .group { border-top: 1px solid var(--gd-border); }
.group-head {
  display: flex; align-items: center; gap: 6px;
  height: 26px; padding: 0 8px 0 6px; background: var(--gd-chrome);
}
.group-head:hover { background: var(--vscode-list-hoverBackground); }
.group-toggle {
  flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; border: 0; background: transparent; cursor: pointer;
  color: var(--vscode-descriptionForeground);
}
.group-toggle svg { transition: transform .12s ease-out; }
.group.is-collapsed .group-toggle svg { transform: rotate(-90deg); }
.group.is-collapsed .group-rows { display: none; }
.group-title {
  flex: 1 1 auto; font-size: 11px; font-weight: 600; letter-spacing: .02em;
  text-transform: uppercase; color: var(--vscode-descriptionForeground);
}
.group-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; opacity: 0; }
.group-head:hover .group-actions, .group-head:focus-within .group-actions { opacity: 1; }
.row-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; opacity: 0; }
.file-row:hover .row-actions, .file-row:focus-within .row-actions { opacity: 1; }
.row-btn {
  flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border: 0; border-radius: 4px; cursor: pointer;
  background: transparent; color: var(--vscode-foreground); opacity: .7;
}
.row-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.2)); }
.row-btn:disabled { cursor: default; opacity: .8; }
.row-btn.is-busy svg { animation: gd-spin .9s linear infinite; }
#genSummary { flex: 0 0 auto; }
@media (prefers-reduced-motion: reduce) { .group-toggle svg { transition: none; } }

/* ---- commit box (pinned to the bottom of the panel) ---- */
#commitBox {
  flex: 0 0 auto; margin-top: auto;
  padding: 7px 8px; border-top: 1px solid var(--gd-border);
  display: flex; flex-direction: column; gap: 5px;
  background: var(--gd-chrome);
}
.commit-summary { display: flex; align-items: center; gap: 8px; }
.avatar {
  flex: 0 0 auto; width: 28px; height: 28px; border-radius: 50%; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  background: var(--gd-accent); color: var(--gd-accent-fg);
  border: 0; padding: 0; cursor: pointer;
}
.avatar:hover { outline: 1px solid var(--vscode-focusBorder, var(--gd-border)); }
.avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
#summary, #description {
  width: 100%; padding: 6px 9px; border-radius: var(--gd-radius); font-size: 12px;
  background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--gd-border));
}
#summary { font-weight: 600; }
#summary:focus, #description:focus { outline: 0; border-color: var(--vscode-focusBorder); }
#description { resize: vertical; min-height: 38px; max-height: 120px; }
#commitBtn {
  width: 100%; padding: 8px 12px; border: 0; border-radius: var(--gd-radius); cursor: pointer;
  font-size: 12px; font-weight: 600;
  background: var(--gd-accent); color: var(--gd-accent-fg);
}
#commitBtn:hover:not(:disabled) { background: var(--vscode-button-hoverBackground, var(--gd-accent)); filter: brightness(1.08); }
#commitBtn:disabled { opacity: .45; cursor: default; }
#commitBtn strong { font-weight: 700; }

/* ---- history ---- */
#commitList { flex: 1 1 auto; overflow: auto; min-height: 0; }
.commit-row {
  display: flex; flex-direction: column; gap: 3px; padding: 9px 12px; cursor: pointer;
  border-bottom: 1px solid var(--gd-border);
}
.commit-row:hover { background: var(--vscode-list-hoverBackground); }
.commit-row.is-selected { background: var(--vscode-list-inactiveSelectionBackground); box-shadow: inset 2px 0 0 var(--gd-accent); }
.commit-msg { display: flex; align-items: center; gap: 5px; font-weight: 500; font-size: 12px; overflow: hidden; }
.commit-msg-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.commit-tags { display: flex; gap: 4px; flex: 0 0 auto; }
.commit-tag {
  display: inline-flex; align-items: center; gap: 2px; font-size: 10px; font-weight: 600;
  line-height: 1.5; padding: 0 5px; border-radius: 3px; white-space: nowrap;
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
}
.commit-meta { font-size: 11px; color: var(--vscode-descriptionForeground); display: flex; align-items: center; gap: 6px; }
.unpushed-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--gd-accent); flex: 0 0 auto; }
.commit-avatar {
  width: 14px; height: 14px; border-radius: 50%; flex: 0 0 auto;
  object-fit: cover; background: var(--vscode-badge-background);
}

/* ---- diff ---- */
#diffHeader {
  flex: 0 0 auto; padding: 10px 16px; font-size: 12px; font-weight: 600;
  background: var(--gd-chrome);
  border-bottom: 1px solid var(--gd-border);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#diffBody {
  flex: 1 1 auto; overflow: auto; min-height: 0;
  background: var(--vscode-editor-background);
  font-family: var(--vscode-editor-font-family, ui-monospace, "SF Mono", Menlo, monospace);
  font-size: var(--vscode-editor-font-size, 12px); line-height: 1.5;
}
.dl { display: flex; white-space: pre; align-items: flex-start; }
.dg {
  flex: 0 0 auto; width: 40px; padding: 0 6px; text-align: right;
  color: var(--vscode-editorLineNumber-foreground); opacity: .55;
  user-select: none; font-variant-numeric: tabular-nums;
}
.ds { flex: 0 0 auto; width: 16px; text-align: center; user-select: none; opacity: .6; }
.dt { flex: 1 1 auto; padding: 0 10px 0 4px; white-space: pre-wrap; word-break: break-word; }
.d-add { background: var(--vscode-diffEditor-insertedLineBackground, var(--vscode-diffEditor-insertedTextBackground, rgba(46,160,67,.12))); }
.d-del { background: var(--vscode-diffEditor-removedLineBackground, var(--vscode-diffEditor-removedTextBackground, rgba(248,81,73,.12))); }
.d-add .ds { color: var(--vscode-gitDecoration-addedResourceForeground, #2ea043); opacity: 1; }
.d-del .ds { color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149); opacity: 1; }
.dw-add { background: var(--vscode-diffEditor-insertedTextBackground, rgba(46,160,67,.4)); border-radius: 2px; }
.dw-del { background: var(--vscode-diffEditor-removedTextBackground, rgba(248,81,73,.4)); border-radius: 2px; }
.dh {
  color: var(--vscode-descriptionForeground);
  background: var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,.12));
  padding: 2px 10px; margin: 4px 0; font-size: 11px;
}
.dh .dt { padding: 0; white-space: pre; }
.diff-meta { color: var(--vscode-descriptionForeground); }

/* ---- commit detail ---- */
.cd-head {
  padding: 12px 16px; border-bottom: 1px solid var(--gd-border);
  background: var(--gd-chrome); font-family: var(--vscode-font-family);
}
.cd-subject { font-size: 12px; font-weight: 600; margin-bottom: 4px; }
.cd-meta { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
.cd-sha { font-family: var(--vscode-editor-font-family, monospace); }
.cd-add { color: var(--vscode-gitDecoration-addedResourceForeground, #2ea043); }
.cd-del { color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149); }
.cd-files { font-family: var(--vscode-font-family); }
.cd-file {
  display: flex; align-items: center; gap: 8px; padding: 6px 16px; cursor: pointer;
  border-bottom: 1px solid var(--gd-border); font-size: 12px;
}
.cd-file:hover { background: var(--vscode-list-hoverBackground); }
.cd-file-path { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
.cd-file-stat { flex: 0 0 auto; font-size: 11px; }
.cd-back {
  display: flex; align-items: center; gap: 10px; padding: 8px 16px;
  border-bottom: 1px solid var(--gd-border); background: var(--gd-chrome);
}
.cd-back button {
  background: none; border: 0; color: var(--gd-accent); cursor: pointer;
  font-size: 12px; padding: 0;
}
.cd-back-path {
  font-size: 11px; color: var(--vscode-descriptionForeground);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ---- empty states ---- */
.empty-block {
  flex: 1 1 auto; display: flex; flex-direction: column; align-items: center;
  justify-content: center; text-align: center; padding: 24px 20px; gap: 8px;
}
#noChanges { padding: 28px 20px; }
/* The rich "No local changes" lives in the right pane; only show the left
   placeholder when the right pane is hidden (narrow / sidebar). */
body:not(.narrow) #noChanges { display: none !important; }
.empty-emoji { opacity: .3; }
.empty-emoji svg { width: 32px; height: 32px; }
.empty-title { font-size: 13px; font-weight: 400; color: var(--vscode-foreground); }
.empty-sub { font-size: 11px; color: var(--vscode-descriptionForeground); max-width: 240px; line-height: 1.5; }

/* ---- popup menu ---- */
.menu {
  position: fixed; z-index: 50;
  min-width: min(240px, calc(100vw - 16px));
  max-width: calc(100vw - 16px); max-height: calc(100vh - 16px);
  overflow-x: hidden; overflow-y: auto;
  background: var(--vscode-menu-background, var(--vscode-dropdown-background, var(--gd-chrome)));
  border: 1px solid var(--vscode-menu-border, var(--gd-border));
  border-radius: 8px; box-shadow: 0 8px 28px rgba(0,0,0,.45); padding: 5px;
}
/* Long labels (branch names, paths) ellipsize instead of widening the menu
   past the edge of the view, which the webview would clip. Every span inside a
   row gets its own truncating box, whatever inline styles the row was built
   with. */
.menu-item span { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.menu input.menu-filter {
  width: 100%; margin-bottom: 4px; padding: 6px 8px; border-radius: var(--gd-radius);
  background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--gd-border));
}
.menu input.menu-filter:focus { outline: 0; border-color: var(--vscode-focusBorder); }
.menu-item {
  display: flex; align-items: center; gap: 8px; padding: 6px 9px; border-radius: var(--gd-radius);
  cursor: pointer; white-space: nowrap; font-size: 12px;
}
.menu-item:hover { background: var(--vscode-list-hoverBackground); }
.menu-item.is-current { color: var(--vscode-descriptionForeground); }
.menu-sep { height: 1px; margin: 5px 4px; background: var(--gd-border); }
.menu-tabs { display: flex; gap: 4px; margin-bottom: 5px; }
.menu-tab {
  flex: 1 1 0; padding: 5px 6px; border: 0; border-radius: var(--gd-radius); cursor: pointer;
  font-size: 11px; font-weight: 600; background: transparent;
  color: var(--vscode-descriptionForeground);
}
.menu-tab:hover { background: var(--vscode-list-hoverBackground); }
.menu-tab.is-active { background: var(--gd-accent); color: var(--gd-accent-fg); }
.menu-empty { padding: 7px 9px; color: var(--vscode-descriptionForeground); font-size: 12px; }
.menu-item.is-danger { color: var(--vscode-errorForeground, #f14c4c); }
.menu-btn {
  flex: 1 1 0; padding: 6px 8px; border: 0; border-radius: var(--gd-radius); cursor: pointer; font-size: 11px; font-weight: 600;
  background: var(--vscode-button-secondaryBackground, var(--gd-accent));
  color: var(--vscode-button-secondaryForeground, var(--gd-accent-fg));
}
.menu-btn:hover { background: var(--vscode-button-hoverBackground); }
.load-more {
  width: 100%; padding: 9px; border: 0; background: transparent; cursor: pointer;
  color: var(--vscode-textLink-foreground); font-size: 12px;
}
.load-more:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
#conflictBar {
  flex: 0 0 auto; padding: 8px 12px; font-size: 11px; line-height: 1.45;
  display: flex; flex-direction: column; gap: 6px;
  background: var(--vscode-inputValidation-warningBackground, rgba(228,103,107,.15));
  border-bottom: 1px solid var(--vscode-inputValidation-warningBorder, #e4676b);
}
#conflictActions { display: flex; gap: 6px; }
#conflictActions button {
  flex: 1 1 0; padding: 5px 8px; border: 0; border-radius: var(--gd-radius);
  cursor: pointer; font-size: 11px; font-weight: 600;
  background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.25));
  color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
}
#conflictContinue { background: var(--gd-accent); color: var(--gd-accent-fg); }
#conflictActions button:disabled { opacity: .45; cursor: default; }

/* ---- commit meta (amend / co-authors) ---- */
#commitMeta { display: flex; align-items: center; gap: 10px; }
#coAuthToggle {
  flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border: 0; border-radius: 4px; cursor: pointer;
  background: transparent; color: var(--vscode-descriptionForeground);
}
#coAuthToggle:hover, #coAuthToggle.is-on { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.18)); }
#amendRow { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--vscode-descriptionForeground); cursor: pointer; }
#amendRow input { width: 13px; height: 13px; accent-color: var(--gd-accent); }
#coAuthors {
  width: 100%; padding: 6px 9px; border-radius: var(--gd-radius); font-size: 12px;
  background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--gd-border));
}
#coAuthors:focus { outline: 0; border-color: var(--vscode-focusBorder); }

/* ---- last commit bar (Committed … · Undo) ---- */
#lastCommitBar {
  flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 6px 10px; font-size: 11px; color: var(--vscode-descriptionForeground);
  background: var(--gd-chrome); border-top: 1px solid var(--gd-border);
}
#lastCommitText { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#undoBtn2 {
  flex: 0 0 auto; padding: 3px 10px; border: 1px solid var(--gd-border); border-radius: var(--gd-radius);
  background: transparent; color: var(--vscode-foreground); cursor: pointer; font-size: 11px; font-weight: 600;
}
#undoBtn2:hover { background: var(--vscode-list-hoverBackground); }

/* ---- compare bar ---- */
#compareBar {
  flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding: 7px 12px; font-size: 11px;
  background: var(--vscode-list-inactiveSelectionBackground, var(--gd-chrome));
  border-bottom: 1px solid var(--gd-border);
}
#compareText { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#compareExit { flex: 0 0 auto; border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 13px; opacity: .7; }
#compareExit:hover { opacity: 1; }
.compare-section {
  padding: 6px 12px; font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .04em; color: var(--vscode-descriptionForeground);
  background: var(--gd-chrome); border-bottom: 1px solid var(--gd-border); position: sticky; top: 0;
}

.file-row.is-conflict .file-name { color: var(--vscode-errorForeground, #f14c4c); }
.file-resolve {
  flex: 0 0 auto; padding: 1px 7px; border: 1px solid var(--gd-border); border-radius: 10px;
  background: transparent; color: inherit; cursor: pointer; font-size: 10px;
}
.file-resolve:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.2)); }
`;

const SCRIPT = String.raw`
const vscode = acquireVsCodeApi();
const post = (command, extra) => vscode.postMessage(Object.assign({ command }, extra || {}));
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]
));

const state = {
  repository: (window.__INITIAL__ && window.__INITIAL__.repository) || null,
  repositories: [],
  activeRepoPath: null,
  draftPath: null,
  draftedSelection: null,
  selectionInitialized: false,
  account: null,
  accounts: [],
  accountPinned: false,
  busy: null,
  collapsed: {},
  changes: [],
  history: [],
  branches: [],
  currentBranch: null,
  branchActivity: {},
  remote: null,
  tags: {},
  commitAvatars: {},
  tab: "changes",
  selectedFiles: new Set(),
  selectedPath: null,
  selectedCommit: null,
  commitDetail: null,
  commitFilePath: null,
  filter: "",
  hasMore: false,
  loadingMore: false,
  operation: null,
  conflicted: [],
  canUndo: false,
  lastCommitSummary: null,
  stashes: [],
  amend: false,
  coAuthors: "",
  compare: null,
  prMenuTab: "branches",
  pullRequests: null,
  prError: null,
  prLoading: false,
};

/* ---------- toolbar ---------- */
function renderToolbar() {
  $("repoName").textContent = state.repository ? state.repository.name : "No repository";
  $("branchName").textContent = state.currentBranch || "—";
  // (the commit button label — including the branch — is owned by updateCommitBtn)

  const r = state.remote || {};
  const ico = $("syncIco"), label = $("syncLabel"), count = $("syncCount"), cell = $("syncCell");
  const sub = $("syncSub");
  const svg = { fetch: ${JSON.stringify(ICON.fetch)}, push: ${JSON.stringify(ICON.push)}, pull: ${JSON.stringify(ICON.pull)}, publish: ${JSON.stringify(ICON.publish)} };
  // A sync operation in flight owns the cell: spinner, progress label, and no
  // clicks until it settles (a second fetch/push just queues a second process).
  const SYNC_BUSY_LABEL = { fetch: "Fetching…", pull: "Pulling…", push: "Pushing…", forcePush: "Force-pushing…", publish: "Publishing…" };
  const busyLabel = state.busy ? SYNC_BUSY_LABEL[state.busy] : null;
  if (busyLabel) {
    cell.disabled = true;
    cell.classList.add("is-busy");
    ico.classList.add("spin");
    ico.innerHTML = ${JSON.stringify(ICON.spinner)};
    label.textContent = busyLabel;
    sub.textContent = "In progress";
    count.hidden = true;
    cell.title = busyLabel;
    cell.dataset.mode = "busy";
    return;
  }
  cell.disabled = false;
  cell.classList.remove("is-busy");
  ico.classList.remove("spin");
  // Only claim "not published" when we positively know: a remote exists and
  // git reported no upstream. Anything uncertain (status not received yet)
  // defaults to Fetch rather than a misleading "Publish branch".
  let mode = "fetch";
  if (r.hasRemote === true && r.isPublished === false && r.ahead === 0 && r.behind === 0) mode = "publish";
  else if (r.ahead > 0 && r.behind > 0) mode = "diverged";
  else if (r.behind > 0) mode = "pull";
  else if (r.ahead > 0) mode = "push";

  ico.innerHTML = svg[mode === "diverged" ? "push" : mode];
  count.hidden = true;
  if (mode === "publish") { label.textContent = "Publish branch"; sub.textContent = "This branch is not on GitHub yet"; }
  else if (mode === "diverged") { label.textContent = "Diverged"; sub.textContent = "Local and origin differ — click for options"; count.hidden = false; count.textContent = "↑" + r.ahead + " ↓" + r.behind; }
  else if (mode === "pull") { label.textContent = "Pull origin"; sub.textContent = relFetched(r.lastFetched); count.hidden = false; count.textContent = "↓ " + r.behind; }
  else if (mode === "push") { label.textContent = "Push origin"; sub.textContent = relFetched(r.lastFetched); count.hidden = false; count.textContent = "↑ " + r.ahead; }
  else { label.textContent = "Fetch origin"; sub.textContent = relFetched(r.lastFetched); }
  const comparedWith = baseBranchName();
  if (comparedWith) {
    sub.textContent = sub.textContent + " · base " + comparedWith;
  }
  cell.title = sub.textContent;
  cell.dataset.mode = mode;
}
const SYNC_MENU = [
  ["fetch", "Fetch origin"],
  ["pull", "Pull origin"],
  ["push", "Push origin"],
  ["forcePush", "Force-push origin (overwrite remote)"],
];
function openSyncMenu(x, y) {
  openMenuAt(x, y, (m) => {
    for (const [cmd, label] of SYNC_MENU) {
      m.appendChild(
        menuItem(label, () => { closeMenu(); post(cmd); }, cmd === "forcePush" ? "is-danger" : ""),
      );
    }
  });
}
$("syncCell").oncontextmenu = (e) => { e.preventDefault(); openSyncMenu(e.clientX, e.clientY); };
function relFetched(d) {
  if (!d) return "Never fetched";
  const t = new Date(d).getTime();
  if (isNaN(t)) return "Last fetched recently";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "Last fetched just now";
  if (mins < 60) return "Last fetched " + mins + "m ago";
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return "Last fetched " + hrs + "h ago";
  return "Last fetched " + Math.round(hrs / 24) + "d ago";
}

$("syncCell").onclick = (e) => {
  const mode = $("syncCell").dataset.mode;
  if (mode === "diverged") { openSyncMenu(e.clientX, e.clientY); return; }
  if (mode === "publish") post("publish");
  else if (mode === "pull") post("pull");
  else if (mode === "push") post("push");
  else post("fetch");
};

/* ---------- tabs ---------- */
document.querySelectorAll(".tab").forEach((btn) => {
  btn.onclick = () => {
    state.tab = btn.dataset.tab;
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("is-active", b === btn));
    $("pane-changes").hidden = state.tab !== "changes";
    $("pane-history").hidden = state.tab !== "history";
    if (state.tab === "changes" && state.selectedCommit) {
      state.selectedCommit = null;
      state.commitDetail = null;
      state.commitFilePath = null;
    }
    updateLayout();
    renderLastCommitBar();
  };
});

/* ---------- changed files ---------- */
function fileParts(p) {
  const i = p.lastIndexOf("/");
  return i < 0 ? { dir: "", name: p } : { dir: p.slice(0, i + 1), name: p.slice(i + 1) };
}
function statusLetter(st) {
  const s = (st || "").replace(/\s/g, "");
  if (s.indexOf("D") >= 0) return "D";
  if (s.indexOf("A") >= 0 || s === "??" || s.indexOf("?") >= 0) return "A";
  if (s.indexOf("R") >= 0) return "R";
  if (s.indexOf("U") >= 0 || s.indexOf("C") >= 0) return "C";
  return "M";
}
function visibleChanges() {
  const f = state.filter.trim().toLowerCase();
  return state.changes.filter((c) => !f || c.path.toLowerCase().indexOf(f) >= 0);
}
const INITIAL_DRAFT = (window.__INITIAL__ && window.__INITIAL__.draft) || null;
const ACTIONS = { plus: ${JSON.stringify(ICON.plus)}, minus: ${JSON.stringify(ICON.minus)}, discard: ${JSON.stringify(ICON.discard)}, caret: ${JSON.stringify(ICON.caret)}, wand: ${JSON.stringify(ICON.wand)}, spinner: ${JSON.stringify(ICON.spinner)} };
/* ---------- commit draft persistence ---------- */
function applyDraft(draft, path) {
  const d = draft || {};
  state.draftPath = path || null;
  state.draftedSelection = Array.isArray(d.selected) ? d.selected : null;
  state.selectedFiles = new Set(state.draftedSelection || []);
  state.selectionInitialized = false;
  $("summary").value = d.summary || "";
  $("description").value = d.description || "";
  state.coAuthors = d.coAuthors || "";
  $("coAuthors").value = state.coAuthors;
  $("coAuthors").hidden = !state.coAuthors;
  $("coAuthToggle").classList.toggle("is-on", !!state.coAuthors);
  updateCommitBtn();
}
function currentDraft() {
  return {
    summary: $("summary").value,
    description: $("description").value,
    coAuthors: state.coAuthors || "",
    selected: Array.from(state.selectedFiles),
  };
}
let draftTimer = null;
function saveDraft(now) {
  if (!state.draftPath) return;
  if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
  if (now) { post("updateDraft", { path: state.draftPath, draft: currentDraft() }); return; }
  draftTimer = setTimeout(() => { draftTimer = null; saveDraft(true); }, 400);
}
function baseBranchName() {
  return (state.repository && state.repository.baseBranch) || null;
}
// The list shows branch names ("develop"); the base is stored as the git ref the
// user picked ("origin/develop"), so both spellings have to match.
function isBaseBranch(b) {
  const base = baseBranchName();
  return !!base && (b === base || base.endsWith("/" + b));
}
function uniquePaths(entries) {
  const paths = new Set();
  for (const c of entries) paths.add(c.path);
  return Array.from(paths);
}
function stagedPaths() { return uniquePaths(state.changes.filter((c) => c.staged)); }
function changeRow(c, section) {
  const parts = fileParts(c.path);
  const isConflict = state.conflicted.indexOf(c.path) >= 0;
  const L = isConflict ? "C" : statusLetter(c.status);
  const row = document.createElement("div");
  row.className = "file-row" + (state.selectedPath === c.path ? " is-selected" : "") + (isConflict ? " is-conflict" : "");
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = state.selectedFiles.has(c.path);
  cb.disabled = isConflict;
  cb.onclick = (e) => {
    e.stopPropagation();
    if (isConflict) return;
    if (cb.checked) state.selectedFiles.add(c.path); else state.selectedFiles.delete(c.path);
    renderChanges();
    saveDraft();
  };
  const sq = document.createElement("span");
  sq.className = "status-sq st-" + L;
  sq.textContent = L;
  const name = document.createElement("span");
  name.className = "file-name";
  name.innerHTML = '<span class="file-dir">' + esc(parts.dir) + '</span>' + esc(parts.name);
  const actions = document.createElement("span");
  actions.className = "row-actions";
  const action = (icon, title, run) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "row-btn"; b.title = title; b.innerHTML = icon;
    b.onclick = (e) => { e.stopPropagation(); run(); };
    return b;
  };
  if (isConflict) {
    const resolve = document.createElement("button");
    resolve.type = "button"; resolve.className = "file-resolve"; resolve.textContent = "Mark resolved";
    resolve.onclick = (e) => { e.stopPropagation(); post("markResolved", { files: [c.path] }); };
    actions.appendChild(resolve);
  } else if (section === "staged") {
    actions.appendChild(action(ACTIONS.minus, "Unstage", () => post("unstageFiles", { files: [c.path] })));
    actions.appendChild(action(ACTIONS.discard, "Discard changes", () => post("discardFiles", { files: [c.path] })));
  } else {
    actions.appendChild(action(ACTIONS.plus, "Stage", () => post("stageFiles", { files: [c.path] })));
    actions.appendChild(action(ACTIONS.discard, "Discard changes", () => post("discardFiles", { files: [c.path] })));
  }
  row.appendChild(cb); row.appendChild(sq); row.appendChild(name); row.appendChild(actions);
  row.onclick = () => selectFile(c.path);
  return row;
}
function renderChanges() {
  const list = $("fileList");
  const vis = visibleChanges();
  const visPaths = uniquePaths(vis);
  const allPaths = uniquePaths(state.changes);
  const staged = vis.filter((c) => c.staged);
  const unstaged = vis.filter((c) => !c.staged);
  const stagedList = uniquePaths(staged);
  const unstagedList = uniquePaths(unstaged);
  const has = state.changes.length > 0;
  $("changesBadge").textContent = String(allPaths.length);
  $("noChanges").hidden = has;
  $("fileList").hidden = !has;
  // The commit box stays visible even with a clean tree so "Amend last commit"
  // is reachable (GitHub Desktop behaviour).
  $("commitBox").hidden = false;
  $("allRow").hidden = !has;
  $("filterWrap").hidden = !has;

  const n = state.selectedFiles.size;
  $("allText").textContent = n + " of " + allPaths.length + " file" + (allPaths.length === 1 ? "" : "s") + " selected" +
    (stagedList.length > 0 ? " · staged files commit first" : "");
  $("allCheck").checked = visPaths.length > 0 && visPaths.every((p) => state.selectedFiles.has(p));
  $("allCheck").indeterminate = n > 0 && !$("allCheck").checked;

  list.innerHTML = "";
  // Two sections, staged first, like VS Code's own source control. A file that
  // is staged *and* edited again appears in both (one row per side).
  const section = (key, title, rows, actions) => {
    const group = document.createElement("div");
    group.className = "group" + (state.collapsed[key] ? " is-collapsed" : "");
    const head = document.createElement("div");
    head.className = "group-head";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "group-toggle";
    toggle.title = (state.collapsed[key] ? "Expand " : "Collapse ") + title;
    toggle.setAttribute("aria-expanded", String(!state.collapsed[key]));
    toggle.innerHTML = ACTIONS.caret;
    toggle.onclick = () => { state.collapsed[key] = !state.collapsed[key]; renderChanges(); };
    const name = document.createElement("span");
    name.className = "group-title";
    name.textContent = title;
    const count = document.createElement("span");
    count.className = "badge";
    count.textContent = String(uniquePaths(rows).length);
    const tools = document.createElement("span");
    tools.className = "group-actions";
    for (const item of actions) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "row-btn"; b.title = item.title; b.innerHTML = item.icon;
      b.onclick = (e) => { e.stopPropagation(); item.run(); };
      tools.appendChild(b);
    }
    head.appendChild(toggle); head.appendChild(name); head.appendChild(count); head.appendChild(tools);
    const body = document.createElement("div");
    body.className = "group-rows";
    for (const c of rows) body.appendChild(changeRow(c, key));
    group.appendChild(head);
    group.appendChild(body);
    list.appendChild(group);
  };

  if (staged.length > 0) {
    section("staged", "Staged Changes", staged, [
      { title: "Unstage all", icon: ACTIONS.minus, run: () => post("unstageFiles", { files: stagedList }) },
      { title: "Discard all staged changes", icon: ACTIONS.discard, run: () => post("discardFiles", { files: stagedList }) },
    ]);
  }
  if (unstaged.length > 0) {
    section("changes", "Changes", unstaged, [
      { title: "Stage all changes", icon: ACTIONS.plus, run: () => post("stageFiles", { files: unstagedList }) },
      { title: "Discard all changes", icon: ACTIONS.discard, run: () => post("discardFiles", { files: unstagedList }) },
    ]);
  }
  updateCommitBtn();
}
function applyWidth() {
  document.body.classList.toggle("narrow", window.innerWidth < 620);
}
window.addEventListener("resize", applyWidth);

function updateLayout() {
  if (state.selectedCommit) {
    renderCommitDetail();
    return;
  }
  const hasDiff = !!state.selectedPath;
  const hasChanges = state.changes.length > 0;
  // Right pane: a file's diff > "pick a file" hint (when there are changes) >
  // the rich "No local changes" state.
  $("diffHeader").hidden = !hasDiff;
  $("diffBody").hidden = !hasDiff && !hasChanges;
  $("rightEmpty").hidden = hasDiff || hasChanges;
  if (hasChanges && !hasDiff) {
    $("diffBody").innerHTML =
      '<div class="diff-meta" style="padding:16px">Select a file on the left to see its changes.</div>';
  }
  if (!hasDiff && !hasChanges) renderRightEmpty();
}

const CARD_ICO = { linkExt: ${JSON.stringify(ICON.linkExt)} };
function renderRightEmpty() {
  const host = $("emptyCards");
  host.innerHTML = "";
  const r = state.remote || {};
  const card = (primary, title, desc, btn, onClick, icoHtml) => {
    const el = document.createElement("div");
    el.className = "empty-card" + (primary ? " is-primary" : "");
    el.innerHTML =
      '<div class="empty-card-body"><div class="empty-card-title">' + esc(title) + '</div>' +
      '<div class="empty-card-desc">' + esc(desc) + '</div></div>' +
      '<button class="empty-card-btn" type="button">' + (icoHtml || "") + esc(btn) + '</button>';
    el.querySelector("button").onclick = onClick;
    host.appendChild(el);
  };

  const mode = $("syncCell").dataset.mode;
  if (mode === "publish") {
    card(true, "Publish your branch", "This branch is not on GitHub yet. Publish it to share and open a pull request.", "Publish branch", () => post("publish"));
  } else if (mode === "push") {
    card(true, "Push commits to origin", "You have local commits waiting to be pushed to GitHub.", "Push origin", () => post("push"));
  } else if (mode === "pull") {
    card(true, "Pull from origin", "origin has commits you don't have locally.", "Pull origin", () => post("pull"));
  } else if (mode === "diverged") {
    card(true, "Your branch has diverged", "Local and origin have both moved. Review the options before pushing.", "Sync options", (e) => openSyncMenu(e.clientX, e.clientY));
  }
  if (state.currentBranch) {
    card(false, "Open a pull request", "Start a pull request for " + state.currentBranch + " on GitHub.", "Create pull request", () => post("createPullRequest", { branch: state.currentBranch }), CARD_ICO.linkExt);
  }
  if (state.repository && state.repository.remote) {
    card(false, "View this repository on GitHub", "Open the repository page in your browser.", "View on GitHub", () => post("openRepoOnGitHub"), CARD_ICO.linkExt);
  }
}
function selectFile(p) {
  state.selectedPath = p;
  state.selectedCommit = null;
  renderChanges();
  updateLayout();
  // At narrow widths the diff pane is hidden, so show the change the native
  // way (VS Code's own diff editor) instead of rendering into an invisible pane.
  if (document.body.classList.contains("narrow")) {
    post("openNativeDiff", { filePath: p });
    return;
  }
  $("diffHeader").hidden = false;
  $("diffPath").textContent = p;
  $("diffBody").innerHTML = '<div class="diff-meta" style="padding:8px">Loading…</div>';
  post("getWorkingDiff", { filePath: p });
}
$("allCheck").onclick = () => {
  if ($("allCheck").checked) state.changes.forEach((c) => state.selectedFiles.add(c.path));
  else state.selectedFiles.clear();
  renderChanges();
  saveDraft();
};
$("filter").oninput = (e) => { state.filter = e.target.value; renderChanges(); };

/* ---------- commit ---------- */
function coAuthorTrailers() {
  const raw = state.coAuthors.trim();
  if (!raw) return "";
  const parts = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  const lines = parts.map((p) => {
    const m = p.match(/^(.*?)\s*<([^>]+)>$/);
    if (m) return "Co-Authored-By: " + m[1].trim() + " <" + m[2].trim() + ">";
    const h = p.replace(/^@/, "");
    return "Co-Authored-By: " + h + " <" + h + "@users.noreply.github.com>";
  });
  return lines.length ? "\n\n" + lines.join("\n") : "";
}
function countLabel(count, word) {
  return count + " " + word + (count === 1 ? "" : "s");
}
function updateCommitBtn() {
  // Staged files win; with nothing staged the ticked files are committed.
  const stagedCount = stagedPaths().length;
  const n = state.selectedFiles.size;
  const hasMsg = $("summary").value.trim().length > 0;
  const btn = $("commitBtn");
  if (state.busy === "commit") {
    btn.disabled = true;
    btn.textContent = "Committing…";
    return;
  }
  const ok = hasMsg && (state.amend || stagedCount > 0 || n > 0);
  btn.disabled = !ok;
  const count = stagedCount > 0 ? stagedCount : n;
  const what = count > 0 ? countLabel(count, "file") : "";
  if (state.amend) {
    btn.innerHTML = "Amend last commit" + (what ? " (+" + what + ")" : "");
  } else {
    btn.innerHTML = "Commit " + (what ? what + " " : "") +
      "to <strong>" + esc(state.currentBranch || "branch") + "</strong>";
  }
}
$("summary").oninput = () => { updateCommitBtn(); saveDraft(); };
let generating = false;
function setGenerating(on) {
  generating = on;
  const btn = $("genSummary");
  btn.disabled = on;
  btn.classList.toggle("is-busy", on);
  btn.innerHTML = on ? ACTIONS.spinner : ACTIONS.wand;
}
$("genSummary").onclick = () => {
  if (generating) return;
  setGenerating(true);
  post("generateCommitMessage");
};
$("description").oninput = () => saveDraft();
function doCommit() {
  const summary = $("summary").value.trim();
  const n = state.selectedFiles.size;
  if (!summary || (!state.amend && stagedPaths().length === 0 && n === 0)) return;
  const desc = $("description").value.trim();
  const message = summary + (desc ? "\n\n" + desc : "") + coAuthorTrailers();
  const staged = stagedPaths();
  // Staged files take precedence: they commit from the index. With nothing
  // staged, the ticked files are staged and committed together.
  if (state.amend) {
    post("amendCommit", { message: message, files: staged.length > 0 ? [] : Array.from(state.selectedFiles) });
  } else if (staged.length > 0) {
    post("commit", { message: message });
  } else {
    post("commitFiles", { message: message, files: Array.from(state.selectedFiles) });
  }
  $("commitBtn").disabled = true;
  // Inputs cleared only on the "commitSucceeded" ack.
}
$("commitBtn").onclick = doCommit;
["summary", "description", "coAuthors"].forEach((id) => {
  $(id).addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); doCommit(); }
  });
});
$("coAuthors").oninput = (e) => { state.coAuthors = e.target.value; saveDraft(); };
$("coAuthToggle").onclick = () => {
  const el = $("coAuthors");
  el.hidden = !el.hidden;
  $("coAuthToggle").classList.toggle("is-on", !el.hidden);
  $("coAuthToggle").title = el.hidden ? "Add co-authors" : "Hide co-authors";
  if (!el.hidden) el.focus();
};
$("amendCheck").onchange = (e) => {
  state.amend = e.target.checked;
  if (state.amend && !$("summary").value.trim() && state.lastCommitSummary) {
    $("summary").value = state.lastCommitSummary;
  }
  updateCommitBtn();
};
$("undoBtn2").onclick = () => post("undoLastCommit");
$("conflictAbort").onclick = () => post("abortOperation");
$("conflictContinue").onclick = () => post("continueOperation");

/* ---------- operation / undo bars ---------- */
function renderOperation() {
  const bar = $("conflictBar");
  if (!state.operation) { bar.hidden = true; return; }
  bar.hidden = false;
  const nc = state.conflicted.length;
  $("conflictText").textContent = nc > 0
    ? "⚠ " + state.operation + " paused — " + nc + " file(s) in conflict. Resolve each, then Continue."
    : "✔ All conflicts resolved. Click Continue to finish the " + state.operation + ".";
  renderConflictButtons();
  if (state.operation) { state.tab = "changes"; $("pane-changes").hidden = false; $("pane-history").hidden = true;
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === "changes")); }
}
/* A continue/abort in flight locks both buttons — the operation must settle
   before the other one makes sense. */
function renderConflictButtons() {
  const busy = !!state.busy;
  $("conflictContinue").disabled = busy || state.conflicted.length > 0;
  $("conflictAbort").disabled = busy;
}
function renderLastCommitBar() {
  const show = !state.operation && state.canUndo && !!state.lastCommitSummary;
  $("lastCommitBar").hidden = !show;
  if (show) $("lastCommitText").textContent = 'Committed "' + (state.lastCommitSummary || "") + '"';
}

/* ---------- history ---------- */
function commitRow(c) {
  const row = document.createElement("div");
  row.className = "commit-row" + (state.selectedCommit === c.hash ? " is-selected" : "");
  const tags = (state.tags && state.tags[c.hash]) || [];
  const tagsHtml = tags.length
    ? '<span class="commit-tags">' +
      tags.map((t) => '<span class="commit-tag">🏷 ' + esc(t) + "</span>").join("") +
      "</span>"
    : "";
  const avatarUrl = state.commitAvatars && state.commitAvatars[c.hash];
  const avatarHtml = avatarUrl
    ? '<img class="commit-avatar" alt="" src="' + esc(avatarUrl) + '">'
    : "";
  row.innerHTML =
    '<div class="commit-msg">' + tagsHtml +
    '<span class="commit-msg-text">' + esc((c.message || "").split("\n")[0]) + "</span></div>" +
    '<div class="commit-meta">' + (c.isPushed === false ? '<span class="unpushed-dot"></span>' : "") +
    avatarHtml +
    esc(c.authorName || c.author || "") + " · " + esc(c.relativeTime || "") + "</div>";
  row.onclick = () => {
    state.selectedCommit = c.hash;
    state.selectedPath = null;
    state.commitDetail = null;
    state.commitFilePath = null;
    renderHistory();
    // Narrow layout: the detail pane is hidden, so hand the commit to VS Code's
    // changes editor (every file it touched) instead of an invisible pane.
    if (document.body.classList.contains("narrow")) {
      post("openNativeDiff", { hash: c.hash });
      return;
    }
    $("diffHeader").hidden = false;
    $("diffPath").textContent = (c.message || "").split("\n")[0];
    $("rightEmpty").hidden = true;
    $("diffBody").hidden = false;
    $("diffBody").innerHTML = '<div class="diff-meta" style="padding:12px">Loading…</div>';
    post("getCommitDetails", { hash: c.hash });
  };
  row.oncontextmenu = (e) => { e.preventDefault(); openCommitMenu(e.clientX, e.clientY, c); };
  return row;
}
function renderHistory() {
  const list = $("commitList");
  list.innerHTML = "";

  if (state.compare) {
    $("compareBar").hidden = false;
    $("compareText").textContent = "Comparing " + (state.currentBranch || "HEAD") + " ⇄ " + state.compare.branch;
    $("noHistory").hidden = true;
    const section = (title, commits) => {
      const h = document.createElement("div");
      h.className = "compare-section";
      h.textContent = title + " (" + commits.length + ")";
      list.appendChild(h);
      if (!commits.length) {
        const e = document.createElement("div"); e.className = "menu-empty"; e.textContent = "none"; list.appendChild(e);
      }
      for (const c of commits) list.appendChild(commitRow(c));
    };
    section("On " + (state.currentBranch || "HEAD") + ", not on " + state.compare.branch, state.compare.ahead);
    section("On " + state.compare.branch + ", not here", state.compare.behind);
    return;
  }

  $("compareBar").hidden = true;
  $("noHistory").hidden = state.history.length > 0;
  for (const c of state.history) list.appendChild(commitRow(c));
  if (state.hasMore) {
    const more = document.createElement("button");
    more.className = "load-more"; more.type = "button";
    more.textContent = state.loadingMore ? "Loading…" : "Load more commits";
    more.disabled = state.loadingMore;
    more.onclick = loadMore;
    list.appendChild(more);
  }
}
$("compareExit").onclick = () => { state.compare = null; renderHistory(); renderLastCommitBar(); };
function loadMore() {
  if (state.compare || state.loadingMore || !state.hasMore) return;
  state.loadingMore = true;
  renderHistory();
  post("loadMoreCommits", { offset: state.history.length });
}
$("commitList").addEventListener("scroll", () => {
  const el = $("commitList");
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) loadMore();
});

const COMMIT_MENU = [
  ["checkout", "Checkout this commit"],
  ["createBranch", "Create branch from commit…"],
  ["createTag", "Create tag…"],
  ["sep"],
  ["cherryPick", "Cherry-pick to current branch"],
  ["revert", "Revert this commit"],
  ["reset", "Reset current branch to here"],
  ["sep"],
  ["copySha", "Copy SHA"],
  ["viewOnGitHub", "View on GitHub"],
];
function openCommitMenu(x, y, commit) {
  openMenuAt(x, y, (m) => {
    for (const entry of COMMIT_MENU) {
      if (entry[0] === "sep") { const s = document.createElement("div"); s.className = "menu-sep"; m.appendChild(s); continue; }
      m.appendChild(
        menuItem(entry[1], () => { closeMenu(); runCommitAction(entry[0], commit); }, entry[0] === "reset" ? "is-danger" : ""),
      );
    }
  });
}
function runCommitAction(action, commit) {
  const h = commit.hash;
  switch (action) {
    case "checkout": post("checkoutCommit", { hash: h }); break;
    case "createBranch": post("createBranchFromCommit", { hash: h }); break;
    case "createTag": post("createTagFromCommit", { hash: h }); break;
    case "cherryPick": post("cherryPickCommit", { hash: h }); break;
    case "revert": post("revertCommit", { hash: h }); break;
    case "reset": post("resetToCommit", { hash: h }); break;
    case "copySha": navigator.clipboard && navigator.clipboard.writeText(h); break;
    case "viewOnGitHub": post("viewCommitOnGitHub", { hash: h }); break;
  }
}

/* ---------- commit detail (right pane) ---------- */
function exitCommitDetail() {
  state.selectedCommit = null;
  state.commitDetail = null;
  state.commitFilePath = null;
  renderHistory();
  updateLayout();
}
function renderCommitDetail() {
  $("rightEmpty").hidden = true;
  $("diffHeader").hidden = false;
  $("diffBody").hidden = false;
  const d = state.commitDetail;
  const s = d && d.summary;
  $("diffPath").textContent = s ? (s.message || "").split("\n")[0] : "Commit";
  if (!d) return;
  if (state.commitFilePath) return; // a file diff is showing

  const body = $("diffBody");
  const stat =
    '<span class="cd-add">+' + (s.additions || 0) + '</span> ' +
    '<span class="cd-del">-' + (s.deletions || 0) + '</span> · ' +
    (s.fileCount || d.files.length) + ' file' + ((s.fileCount || d.files.length) === 1 ? '' : 's');
  let html =
    '<div class="cd-head">' +
    '<div class="cd-subject">' + esc((s.message || "").split("\n")[0]) + '</div>' +
    '<div class="cd-meta">' + esc(s.authorName || "") + ' · ' + esc(s.relativeTime || "") +
    ' · <span class="cd-sha">' + esc(s.shortHash || (s.hash || state.selectedCommit).slice(0, 7)) + '</span></div>' +
    '<div class="cd-meta">' + stat + '</div>' +
    '</div><div class="cd-files">';
  for (const f of d.files) {
    const n =
      (f.additions != null ? '<span class="cd-add">+' + f.additions + '</span> ' : '') +
      (f.deletions != null ? '<span class="cd-del">-' + f.deletions + '</span>' : '');
    html +=
      '<div class="cd-file" data-path="' + esc(f.path) + '">' +
      '<span class="cd-file-path">' + esc(f.path) + '</span>' +
      '<span class="cd-file-stat">' + n + '</span></div>';
  }
  html += '</div>';
  body.innerHTML = html;
  body.scrollTop = 0;
  body.querySelectorAll(".cd-file").forEach((el) => {
    el.onclick = () => {
      state.commitFilePath = el.dataset.path;
      body.innerHTML = '<div class="diff-meta" style="padding:12px">Loading…</div>';
      post("selectFile", { hash: state.selectedCommit, path: el.dataset.path });
    };
  });
}
function renderCommitFileDiff(diff) {
  const body = $("diffBody");
  body.innerHTML =
    '<div class="cd-back"><button type="button" id="cdBack">‹ All files</button>' +
    '<span class="cd-back-path">' + esc(state.commitFilePath || "") + '</span></div>' +
    '<div id="cdDiff"></div>';
  $("cdBack").onclick = () => { state.commitFilePath = null; renderCommitDetail(); };
  renderDiffInto($("cdDiff"), diff);
}

/* ---------- diff rendering ---------- */
function renderDiff(text) {
  renderDiffInto($("diffBody"), text);
}
// Token-level LCS, used to highlight the exact words that changed between a
// removed line and the added line that replaced it (like VS Code's diff editor).
function wordDiff(a, b) {
  const split = (s) => s.match(/\s+|\w+|[^\s\w]/g) || [];
  const at = split(a), bt = split(b);
  const n = at.length, m = bt.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = at[i] === bt[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const aOut = [], bOut = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (at[i] === bt[j]) { aOut.push([0, at[i]]); bOut.push([0, bt[j]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { aOut.push([-1, at[i]]); i++; }
    else { bOut.push([1, bt[j]]); j++; }
  }
  while (i < n) aOut.push([-1, at[i++]]);
  while (j < m) bOut.push([1, bt[j++]]);
  return [aOut, bOut];
}
function paintTokens(tokens, changedCls) {
  let html = "";
  for (const [flag, tok] of tokens) {
    html += flag === 0 ? esc(tok) : '<span class="' + changedCls + '">' + esc(tok) + "</span>";
  }
  return html;
}

function renderDiffInto(body, text) {
  if (!text || !text.trim()) {
    body.innerHTML = '<div class="diff-meta" style="padding:8px">No textual changes (binary file or whitespace only).</div>';
    return;
  }
  const src = text.split("\n");
  // Parse into typed rows first so we can pair adjacent -/+ runs for word diff.
  const rows = [];
  let oldNo = 0, newNo = 0;
  for (const raw of src) {
    if (raw.indexOf("@@") === 0) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      if (m) { oldNo = +m[1]; newNo = +m[2]; }
      rows.push({ t: "hunk", text: m ? m[3].trim() || raw : raw });
    } else if (/^(diff |index |--- |\+\+\+ |new file|deleted file|similarity |rename |Binary )/.test(raw)) {
      continue; // file headers are shown in the pane header already
    } else if (raw.charAt(0) === "+") {
      rows.push({ t: "add", n: newNo++, text: raw.slice(1) });
    } else if (raw.charAt(0) === "-") {
      rows.push({ t: "del", o: oldNo++, text: raw.slice(1) });
    } else {
      rows.push({ t: "ctx", o: oldNo++, n: newNo++, text: raw.slice(1) });
    }
  }

  let out = "";
  const cell = (o, n, sign, cls, inner) =>
    '<div class="dl ' + cls + '">' +
    '<span class="dg">' + (o == null ? "" : o) + '</span>' +
    '<span class="dg">' + (n == null ? "" : n) + '</span>' +
    '<span class="ds">' + sign + '</span>' +
    '<span class="dt">' + inner + '</span></div>';

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.t === "hunk") { out += '<div class="dl dh"><span class="dt">' + esc(r.text) + '</span></div>'; continue; }
    if (r.t === "ctx") { out += cell(r.o + 1, r.n + 1, " ", "", esc(r.text) || " "); continue; }
    if (r.t === "del") {
      // collect the del run and the following add run
      const dels = []; while (i < rows.length && rows[i].t === "del") dels.push(rows[i++]);
      const adds = []; while (i < rows.length && rows[i].t === "add") adds.push(rows[i++]);
      i--;
      for (let k = 0; k < dels.length; k++) {
        const d = dels[k], pair = adds[k];
        const inner = pair ? paintTokens(wordDiff(d.text, pair.text)[0], "dw-del") : (esc(d.text) || " ");
        out += cell(d.o + 1, null, "-", "d-del", inner);
      }
      for (let k = 0; k < adds.length; k++) {
        const a = adds[k], pair = dels[k];
        const inner = pair ? paintTokens(wordDiff(pair.text, a.text)[1], "dw-add") : (esc(a.text) || " ");
        out += cell(null, a.n + 1, "+", "d-add", inner);
      }
      continue;
    }
    if (r.t === "add") { out += cell(null, r.n + 1, "+", "d-add", esc(r.text) || " "); continue; }
  }
  body.innerHTML = out || '<div class="diff-meta" style="padding:8px">No changes.</div>';
  body.scrollTop = 0;
}

/* ---------- dropdown menus ---------- */
const menu = $("menu");
let redrawBranchMenu = null;
function closeMenu() { menu.hidden = true; menu.innerHTML = ""; document.removeEventListener("mousedown", onDocDown, true); redrawBranchMenu = null; }
function onDocDown(e) { if (!menu.contains(e.target)) closeMenu(); }
/* Rows/labels: keeping the label in its own box lets long text ellipsize
   instead of widening the menu past the edge of the view. */
function menuItem(label, onClick, className) {
  const it = document.createElement("div");
  it.className = "menu-item" + (className ? " " + className : "");
  const span = document.createElement("span");
  span.textContent = label;
  it.appendChild(span);
  it.onclick = onClick;
  return it;
}
/* Sizes and positions the menu inside the webview's viewport — the view clips
   anything drawn outside it, which used to cut the repository/branch dropdowns
   off at the panel edge. Opens on the side with more room and scrolls
   internally when the content still does not fit. */
function placeMenu(anchor) {
  const edge = 8, gap = 2;
  const vw = window.innerWidth, vh = window.innerHeight;
  menu.style.maxHeight = "";
  menu.style.maxWidth = "";
  const natural = menu.getBoundingClientRect();
  const width = Math.min(natural.width, vw - edge * 2);
  const roomAbove = anchor.top - edge - gap;
  const roomBelow = vh - anchor.bottom - edge - gap;
  const openAbove = roomBelow < natural.height && roomAbove > roomBelow;
  const room = Math.max(0, openAbove ? roomAbove : roomBelow);
  const ceiling = Math.max(0, vh - edge * 2);
  const maxHeight = Math.min(ceiling, Math.max(room, Math.min(ceiling, 240)));
  if (natural.height > maxHeight) { menu.style.maxHeight = maxHeight + "px"; }
  const h = Math.min(natural.height, maxHeight);
  const x = Math.max(edge, Math.min(anchor.left, vw - edge - width));
  const y = openAbove ? anchor.top - gap - h : anchor.bottom + gap;
  menu.style.maxWidth = (vw - edge * 2) + "px";
  menu.style.left = Math.round(x) + "px";
  menu.style.top = Math.round(Math.max(edge, Math.min(y, vh - edge - h))) + "px";
}
function openMenu(anchor, build) {
  menu.innerHTML = ""; build(menu);
  menu.hidden = false;
  menu.style.visibility = "hidden";
  requestAnimationFrame(() => {
    placeMenu(anchor.getBoundingClientRect());
    menu.style.visibility = "";
  });
  setTimeout(() => document.addEventListener("mousedown", onDocDown, true), 0);
}
function openMenuAt(x, y, build) {
  menu.innerHTML = ""; build(menu);
  menu.hidden = false;
  menu.style.visibility = "hidden";
  requestAnimationFrame(() => {
    placeMenu({ top: y, bottom: y, left: x });
    menu.style.visibility = "";
  });
  setTimeout(() => document.addEventListener("mousedown", onDocDown, true), 0);
}

$("branchCell").onclick = () => {
  openMenu($("branchCell"), (m) => {
    const tabs = document.createElement("div");
    tabs.className = "menu-tabs";
    const mkTab = (id, label) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = label;
      b.className = "menu-tab" + (state.prMenuTab === id ? " is-active" : "");
      b.onclick = () => {
        state.prMenuTab = id;
        if (id === "prs") { state.prLoading = true; state.prError = null; post("getPullRequests"); }
        rebuild();
      };
      tabs.appendChild(b);
    };
    mkTab("branches", "Branches");
    mkTab("prs", "Pull requests");

    const rebuild = () => { closeMenu(); $("branchCell").onclick(); };
    redrawBranchMenu = () => {
      if (state.prMenuTab === "prs") { closeMenu(); $("branchCell").onclick(); }
    };

    m.appendChild(tabs);

    if (state.prMenuTab === "prs") {
      renderPrMenu(m);
      return;
    }

    const mkAction = (label, fn) => {
      m.appendChild(menuItem(label, () => { closeMenu(); fn(); }));
    };
    mkAction("＋  New branch…", startNewBranch);
    if (state.currentBranch && state.branches.filter((b) => !b.startsWith("remotes/")).length > 1) {
      mkAction("⑂  Merge into current branch…", startMergeBranch);
    }
    if (state.currentBranch) mkAction("⇡  Create pull request…", () => post("createPullRequest", { branch: state.currentBranch }));
    const base = baseBranchName();
    if (base && base !== state.currentBranch) {
      mkAction("⇄  Compare with " + base, () => post("compareBranch", { branch: base }));
    }
    if (state.changes.length > 0) mkAction("⇩  Stash all changes", () => post("stashPush", { message: "" }));
    for (const s of state.stashes) {
      const it = document.createElement("div");
      it.className = "menu-item";
      it.innerHTML = '<span style="flex:1;overflow:hidden;text-overflow:ellipsis">↤ ' + esc(s.message || ("stash@{" + s.index + "}")) + '</span>' +
        '<button class="file-resolve" data-a="pop">Pop</button><button class="file-resolve" data-a="drop">✕</button>';
      it.querySelector('[data-a=pop]').onclick = (e) => { e.stopPropagation(); closeMenu(); post("stashApply", { index: s.index, drop: true }); };
      it.querySelector('[data-a=drop]').onclick = (e) => { e.stopPropagation(); closeMenu(); post("stashDrop", { index: s.index }); };
      m.appendChild(it);
    }
    const sep = document.createElement("div"); sep.className = "menu-sep"; m.appendChild(sep);

    const filter = document.createElement("input");
    filter.className = "menu-filter"; filter.placeholder = "Find a branch…";
    m.appendChild(filter);
    const holder = document.createElement("div");
    m.appendChild(holder);
    const draw = () => {
      const q = filter.value.trim().toLowerCase();
      holder.innerHTML = "";
      const items = state.branches
        .filter((b) => !q || b.toLowerCase().indexOf(q) >= 0)
        .sort((a, b) => (isBaseBranch(a) ? -1 : isBaseBranch(b) ? 1 : 0));
      if (!items.length) { holder.innerHTML = '<div class="menu-empty">No branches</div>'; return; }
      for (const b of items) {
        const it = document.createElement("div");
        const isCur = b === state.currentBranch;
        it.className = "menu-item" + (isCur ? " is-current" : "");
        const suffix = isCur ? "  (current)" : isBaseBranch(b) ? "  (base)" : "";
        it.innerHTML = '<span style="flex:1;overflow:hidden;text-overflow:ellipsis">' + esc(b) + suffix + '</span>';
        it.onclick = () => { closeMenu(); if (!isCur) post("checkoutBranch", { branch: b }); };
        if (!isCur) {
          const cmp = document.createElement("button");
          cmp.className = "file-resolve"; cmp.type = "button"; cmp.textContent = "⇄";
          cmp.title = "Compare with this branch";
          cmp.onclick = (e) => { e.stopPropagation(); closeMenu(); post("compareBranch", { branch: b }); };
          it.appendChild(cmp);
        }
        holder.appendChild(it);
      }
    };
    filter.oninput = draw; draw();
    setTimeout(() => filter.focus(), 0);
  });
};

function renderPrMenu(m) {
  if (state.prLoading && !state.pullRequests) {
    const d = document.createElement("div"); d.className = "menu-empty"; d.textContent = "Loading pull requests…";
    m.appendChild(d); return;
  }
  if (state.prError) {
    const d = document.createElement("div"); d.className = "menu-empty"; d.textContent = state.prError;
    m.appendChild(d); return;
  }
  const prs = state.pullRequests || [];
  if (!prs.length) {
    const d = document.createElement("div"); d.className = "menu-empty"; d.textContent = "No open pull requests";
    m.appendChild(d); return;
  }
  const filter = document.createElement("input");
  filter.className = "menu-filter"; filter.placeholder = "Find a pull request…";
  m.appendChild(filter);
  const holder = document.createElement("div"); m.appendChild(holder);
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    holder.innerHTML = "";
    const items = prs.filter((p) => !q ||
      ("#" + p.number).indexOf(q) >= 0 ||
      p.title.toLowerCase().indexOf(q) >= 0 ||
      (p.author || "").toLowerCase().indexOf(q) >= 0);
    if (!items.length) { holder.innerHTML = '<div class="menu-empty">No matches</div>'; return; }
    for (const p of items) {
      const it = document.createElement("div");
      it.className = "menu-item";
      it.innerHTML =
        '<span style="flex:1;min-width:0">' +
        '<span style="display:block;overflow:hidden;text-overflow:ellipsis">#' + p.number + '  ' + esc(p.title) +
        (p.isDraft ? ' <span style="opacity:.5">(draft)</span>' : '') + '</span>' +
        '<span style="display:block;font-size:10px;opacity:.55;overflow:hidden;text-overflow:ellipsis">by ' +
        esc(p.author || "?") + (p.isFork ? " · fork" : "") + " · " + esc(p.headRef) + '</span></span>';
      it.onclick = () => { closeMenu(); post("checkoutPullRequest", { number: p.number }); };
      holder.appendChild(it);
    }
  };
  filter.oninput = draw; draw();
  setTimeout(() => filter.focus(), 0);
}

function startNewBranch() {
  openMenu($("branchCell"), (m) => {
    const input = document.createElement("input");
    input.className = "menu-filter"; input.placeholder = "New branch name";
    m.appendChild(input);
    const dirty = state.changes.length > 0;
    const hint = document.createElement("div");
    hint.className = "menu-empty";
    hint.textContent = dirty
      ? "You have uncommitted changes — choose what to do:"
      : "Press Enter to create from " + (state.currentBranch || "HEAD");
    m.appendChild(hint);
    const submit = (bringChanges) => {
      const name = input.value.trim();
      if (!name) return;
      closeMenu();
      if (dirty) post("createBranchWithChanges", { branchName: name, bringChanges: bringChanges });
      else post("createBranch", { branchName: name });
    };
    if (dirty) {
      const row = document.createElement("div"); row.style.display = "flex"; row.style.gap = "4px"; row.style.padding = "4px";
      const a = document.createElement("button"); a.className = "menu-btn"; a.type = "button"; a.textContent = "Bring changes";
      a.onclick = () => submit(true);
      const b = document.createElement("button"); b.className = "menu-btn"; b.type = "button"; b.textContent = "Stash them";
      b.onclick = () => submit(false);
      row.appendChild(a); row.appendChild(b); m.appendChild(row);
    }
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(true); } });
    setTimeout(() => input.focus(), 0);
  });
}

function startMergeBranch() {
  openMenu($("branchCell"), (m) => {
    const into = state.currentBranch || "HEAD";
    const hint = document.createElement("div");
    hint.className = "menu-empty";
    hint.textContent = "Merge a branch into " + into + ":";
    m.appendChild(hint);

    const filter = document.createElement("input");
    filter.className = "menu-filter"; filter.placeholder = "Find a branch to merge…";
    m.appendChild(filter);
    const holder = document.createElement("div"); m.appendChild(holder);
    const candidates = state.branches
      .filter((b) => b !== state.currentBranch)
      .sort((a, b) => (isBaseBranch(a) ? -1 : isBaseBranch(b) ? 1 : 0));
    const draw = () => {
      const q = filter.value.trim().toLowerCase();
      holder.innerHTML = "";
      const items = candidates.filter((b) => !q || b.toLowerCase().indexOf(q) >= 0);
      if (!items.length) { holder.innerHTML = '<div class="menu-empty">No other branches</div>'; return; }
      for (const b of items) {
        const it = document.createElement("div");
        it.className = "menu-item";
        it.innerHTML = '<span style="flex:1;overflow:hidden;text-overflow:ellipsis">' + esc(b) + (isBaseBranch(b) ? "  (base)" : "") + '</span>';
        it.onclick = () => {
          closeMenu();
          post("mergeBranch", { fromBranch: b, toBranch: state.currentBranch });
        };
        holder.appendChild(it);
      }
    };
    filter.oninput = draw; draw();
    setTimeout(() => filter.focus(), 0);
  });
}

$("repoCell").onclick = () => {
  openMenu($("repoCell"), (m) => {
    const repos = state.repositories || [];
    if (repos.length > 1 || (repos.length && repos[0].path !== state.activeRepoPath)) {
      const filter = document.createElement("input");
      filter.className = "menu-filter"; filter.placeholder = "Find a repository…";
      m.appendChild(filter);
      const holder = document.createElement("div"); m.appendChild(holder);
      const draw = () => {
        const q = filter.value.trim().toLowerCase();
        holder.innerHTML = "";
        const items = repos.filter((r) => !q || r.name.toLowerCase().indexOf(q) >= 0 || r.path.toLowerCase().indexOf(q) >= 0);
        if (!items.length) { holder.innerHTML = '<div class="menu-empty">No repositories</div>'; return; }
        for (const r of items) {
          const isCur = r.path === state.activeRepoPath;
          const it = document.createElement("div");
          it.className = "menu-item" + (isCur ? " is-current" : "");
          it.innerHTML = '<span style="flex:1;min-width:0"><span style="display:block;overflow:hidden;text-overflow:ellipsis">' + esc(r.name) + (isCur ? "  (current)" : "") +
            '</span><span style="display:block;font-size:10px;opacity:.55;overflow:hidden;text-overflow:ellipsis">' + esc(r.path) + '</span></span>';
          it.onclick = () => { closeMenu(); if (!isCur) post("selectRepository", { path: r.path }); };
          holder.appendChild(it);
        }
      };
      filter.oninput = draw; draw();
      setTimeout(() => filter.focus(), 0);
    } else if (repos.length === 1) {
      const it = document.createElement("div");
      it.className = "menu-item is-current";
      it.innerHTML = '<span style="overflow:hidden;text-overflow:ellipsis">' + esc(repos[0].path) + '</span>';
      m.appendChild(it);
    }
    const sep = document.createElement("div"); sep.className = "menu-sep"; m.appendChild(sep);
    const add = (label, cmd) => {
      m.appendChild(menuItem(label, () => { closeMenu(); post(cmd); }));
    };
    add("＋  Add local repository…", "addLocalRepository");
    add("⤓  Clone repository…", "cloneRepository");
  });
};

$("avatar").onclick = () => {
  openMenu($("avatar"), (m) => {
    const head = document.createElement("div");
    head.className = "menu-empty";
    head.textContent = "Account for this repository";
    m.appendChild(head);
    const accounts = state.accounts || [];
    if (!accounts.length) {
      const none = document.createElement("div");
      none.className = "menu-empty";
      none.textContent = "No GitHub account signed in";
      m.appendChild(none);
      return;
    }
    for (const acc of accounts) {
      const flags = [];
      if (acc.selected) flags.push("selected");
      if (acc.active) flags.push("active");
      const it = document.createElement("div");
      it.className = "menu-item" + (acc.selected ? " is-current" : "");
      it.innerHTML = '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">' +
        esc(acc.login) + (flags.length ? "  (" + esc(flags.join(", ")) + ")" : "") + "</span>";
      it.onclick = () => {
        closeMenu();
        if (!acc.selected) post("selectRepoAccount", { accountId: acc.id });
      };
      m.appendChild(it);
    }
    if (state.accountPinned) {
      const sep = document.createElement("div"); sep.className = "menu-sep"; m.appendChild(sep);
      m.appendChild(menuItem("Follow the active account", () => { closeMenu(); post("selectRepoAccount", {}); }));
    }
  });
};

/* ---------- inbound messages ---------- */
window.addEventListener("message", (ev) => {
  const msg = ev.data || {};
  switch (msg.command || msg.type) {
    case "updateChanges": {
      const prevPaths = new Set(state.changes.map((c) => c.path));
      state.changes = msg.changes || [];
      const paths = new Set(state.changes.map((c) => c.path));
      // Auto-check newly appeared files (GitHub Desktop checks everything by default),
      // keep the user's choices for files that were already listed.
      state.selectedFiles = new Set(
        Array.from(state.selectedFiles).filter((p) => paths.has(p)),
      );
      if (!state.selectionInitialized) {
        // First snapshot after (re)load: a restored draft's ticks win; without
        // one, everything is ticked like before.
        state.selectionInitialized = true;
        const drafted = state.draftedSelection;
        state.changes.forEach((c) => {
          if (!drafted || drafted.indexOf(c.path) >= 0) state.selectedFiles.add(c.path);
        });
      } else {
        state.changes.forEach((c) => {
          if (!prevPaths.has(c.path)) state.selectedFiles.add(c.path);
        });
      }
      if (state.selectedPath && !paths.has(state.selectedPath)) {
        state.selectedPath = null;
        $("diffHeader").hidden = true;
      }
      if (!state.changes.some((c) => /[UC]/.test(c.status || ""))) $("conflictBar").hidden = true;
      renderChanges();
      updateLayout();
      break;
    }
    case "updateHistory":
      state.history = msg.history || [];
      state.hasMore = !!msg.hasMoreCommits;
      state.loadingMore = false;
      state.compare = null;
      if (state.selectedCommit && !state.history.some((c) => c.hash === state.selectedCommit)) {
        state.selectedCommit = null;
        state.commitDetail = null;
        state.commitFilePath = null;
        updateLayout();
      }
      renderHistory();
      break;
    case "loadMoreCommitsResponse": {
      const seen = new Set(state.history.map((c) => c.hash));
      state.history = state.history.concat((msg.history || []).filter((c) => !seen.has(c.hash)));
      state.hasMore = !!msg.hasMoreCommits;
      state.loadingMore = false;
      renderHistory();
      break;
    }
    case "commitSucceeded":
      $("summary").value = ""; $("description").value = ""; $("coAuthors").value = "";
      state.coAuthors = "";
      state.selectedFiles.clear();
      state.amend = false; $("amendCheck").checked = false;
      state.draftedSelection = [];
      updateCommitBtn();
      saveDraft(true);
      break;
    case "mergeConflict":
      // Detailed state arrives via updateOperation on the following refresh;
      // this just flips to the Changes tab immediately.
      state.tab = "changes";
      $("pane-changes").hidden = false; $("pane-history").hidden = true;
      document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === "changes"));
      break;
    case "updateOperation":
      state.operation = msg.operation || null;
      state.conflicted = msg.conflicted || [];
      state.canUndo = !!msg.canUndo;
      state.lastCommitSummary = msg.lastCommitSummary || null;
      renderOperation(); renderChanges(); renderLastCommitBar();
      break;
    case "updateStashes":
      state.stashes = msg.stashes || [];
      break;
    case "updatePullRequests":
      state.prLoading = false;
      state.pullRequests = msg.pullRequests || [];
      state.prError = msg.error || null;
      if (redrawBranchMenu) redrawBranchMenu();
      break;
    case "branchComparison":
      state.compare = { branch: msg.branch, ahead: msg.ahead || [], behind: msg.behind || [] };
      state.tab = "history";
      $("pane-changes").hidden = true; $("pane-history").hidden = false;
      document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === "history"));
      renderHistory(); renderLastCommitBar();
      break;
    case "updateBranches":
      state.branches = msg.branches || [];
      state.currentBranch = msg.currentBranch || null;
      state.branchActivity = msg.branchActivity || {};
      renderToolbar(); updateCommitBtn(); updateLayout();
      break;
    case "busy":
      state.busy = msg.task || null;
      renderToolbar();
      updateCommitBtn();
      renderConflictButtons();
      break;
    case "commitMessage":
      setGenerating(false);
      if (msg.summary) {
        $("summary").value = msg.summary;
        if (msg.description) $("description").value = msg.description;
        updateCommitBtn();
        saveDraft(true);
      }
      break;
    case "draft":
      // Only re-key the inputs when the repository in view actually changed, so
      // a refresh (or the 30 s poll) never clobbers what is being typed.
      if (msg.path !== state.draftPath) {
        applyDraft(msg.draft, msg.path);
        renderChanges();
        updateLayout();
      }
      break;
    case "updateRepository":
      state.repository = msg.repository || null;
      renderToolbar(); setAvatar(); updateLayout();
      break;
    case "updateRepositoryList":
      state.repositories = msg.repositories || [];
      state.activeRepoPath = msg.activePath || null;
      break;
    case "updateAccounts":
      state.account = msg.account || null;
      state.accounts = msg.accounts || [];
      state.accountPinned = !!msg.pinnedAccountId;
      setAvatar();
      break;
    case "updateRemoteStatus":
      state.remote = msg.remoteStatus || null;
      state.tags = msg.tags || {};
      renderToolbar(); renderHistory(); updateLayout();
      break;
    case "updateCommitAvatars":
      state.commitAvatars = msg.avatars || {};
      renderHistory();
      break;
    case "commitDetail":
      state.commitDetail = msg.payload || null;
      if (state.selectedCommit) renderCommitDetail();
      break;
    case "workingDiff":
      if (msg.payload && msg.payload.path === state.selectedPath) renderDiff(msg.payload.diff);
      break;
    case "fileDiff":
      if (!msg.payload) break;
      if (state.selectedCommit && state.commitFilePath === msg.payload.path) {
        renderCommitFileDiff(msg.payload.diff);
      } else if (!state.selectedCommit) {
        renderDiff(msg.payload.diff);
      }
      break;
    case "error":
      if (state.selectedCommit || state.selectedPath) {
        $("diffBody").innerHTML = '<div class="diff-meta" style="padding:8px">' + esc(msg.message || "Error") + "</div>";
      }
      break;
  }
});

/* ---------- avatar ---------- */
function setAvatar() {
  const a = state.account;
  const el = $("avatar");
  const tip = "Click to choose the account for this repository";
  if (a && a.avatarUrl) {
    el.innerHTML = '<img alt="" src="' + esc(a.avatarUrl) + '">';
    el.title = (a.login ? a.login + "\n" : "") + tip;
    return;
  }
  const s = (a && (a.name || a.login)) || (state.repository && state.repository.name) || "?";
  el.textContent = s.slice(0, 2);
  el.title = (a && a.login ? a.login + "\n" : "") + tip;
}
applyDraft(INITIAL_DRAFT, (window.__INITIAL__ && window.__INITIAL__.draftPath) || null);
applyWidth();
setAvatar();
renderToolbar();
renderOperation();
renderLastCommitBar();
updateLayout();
post("ready");
`;
