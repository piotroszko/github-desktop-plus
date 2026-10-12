import * as path from "path";
import * as vscode from "vscode";
import simpleGit from "simple-git";

/**
 * @description Scheme of the virtual documents that serve a file as of a git
 * revision. Deliberately distinct from the built-in Git extension's `git:`
 * scheme, which this extension must not squat on.
 */
export const GIT_CONTENT_SCHEME = "github-desktop-git";

/** Refs we are willing to pass to `git show` (hashes, HEAD, `HEAD^`, ...). */
const SAFE_REF = /^[A-Za-z0-9._/~^-]+$/;

/**
 * @description Serves the "before" side of a diff as `git show <ref>:<path>`.
 * Read-only virtual documents: no working-tree file is written, no stash or
 * index entry is touched, and the content is never cached by us.
 */
export class GitContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    let repo = "";
    let ref = "";
    try {
      const params = JSON.parse(uri.query || "{}") as {
        repo?: unknown;
        ref?: unknown;
      };
      repo = typeof params.repo === "string" ? params.repo : "";
      ref = typeof params.ref === "string" ? params.ref : "";
    } catch {
      return "";
    }

    const filePath = path.resolve(uri.fsPath);
    const relative = path.relative(path.resolve(repo), filePath);
    // Never let a crafted URI read outside its repository, and never hand git
    // an option-shaped or otherwise unexpected revision.
    if (
      !repo ||
      !relative ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      return "";
    }
    if (!SAFE_REF.test(ref)) {
      return "";
    }

    try {
      return await simpleGit(repo).raw(["show", `${ref}:${relative}`]);
    } catch {
      // Not present at that revision — an added or deleted file, or a root
      // commit whose parent does not exist. An empty side is exactly right.
      return "";
    }
  }
}

/** One file of a diff, as the changes editor needs it. */
interface ChangeEntry {
  /** Resource the editor navigates to (the "after" side). */
  label: vscode.Uri;
  left: vscode.Uri;
  right: vscode.Uri;
}

/**
 * @description Opens changes in VS Code's own diff editors (`vscode.diff` for
 * a single file, `vscode.changes` for several) instead of the timeline's
 * webview pane, which is hidden in narrow layouts.
 */
export class NativeDiffViewer {
  /** Working tree vs `HEAD` — what the Changes list shows for a file. */
  async openWorkingFile(repoPath: string, filePath: string): Promise<void> {
    const abs = path.resolve(repoPath, filePath);
    await this.open(`${path.basename(abs)} (Working Tree)`, [
      {
        label: vscode.Uri.file(abs),
        left: gitUri(repoPath, "HEAD", abs),
        right: vscode.Uri.file(abs),
      },
    ]);
  }

  /** What one commit changed in one file (its parent vs the commit). */
  async openCommitFile(
    repoPath: string,
    hash: string,
    filePath: string,
  ): Promise<void> {
    const abs = path.resolve(repoPath, filePath);
    await this.open(`${hash.slice(0, 7)} — ${path.basename(abs)}`, [
      {
        label: gitUri(repoPath, hash, abs),
        left: gitUri(repoPath, `${hash}^`, abs),
        right: gitUri(repoPath, hash, abs),
      },
    ]);
  }

  /** Every file a commit touched, in the changes editor. */
  async openCommit(
    repoPath: string,
    hash: string,
    filePaths: string[],
  ): Promise<void> {
    const entries: ChangeEntry[] = filePaths.map((filePath) => {
      const abs = path.resolve(repoPath, filePath);
      return {
        label: gitUri(repoPath, hash, abs),
        left: gitUri(repoPath, `${hash}^`, abs),
        right: gitUri(repoPath, hash, abs),
      };
    });
    if (entries.length === 0) {
      return;
    }
    await this.open(`${hash.slice(0, 7)} — ${entries.length} file(s)`, entries);
  }

  private async open(title: string, entries: ChangeEntry[]): Promise<void> {
    if (entries.length === 1) {
      const only = entries[0];
      await vscode.commands.executeCommand(
        "vscode.diff",
        only.left,
        only.right,
        title,
      );
      return;
    }
    await vscode.commands.executeCommand(
      "vscode.changes",
      title,
      entries.map((entry) => [entry.label, entry.left, entry.right]),
    );
  }
}

/** A virtual document holding `filePath` as of git revision `ref`. */
function gitUri(repoPath: string, ref: string, filePath: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: GIT_CONTENT_SCHEME,
    path: filePath,
    query: JSON.stringify({ repo: repoPath, ref }),
  });
}
