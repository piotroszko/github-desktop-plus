import * as path from "path";
import { StatusResult } from "simple-git";
import { GitClientFactory } from "../../../core/git/git-authenticator";
import { RepositoryContext } from "../ports";
import {
  COMMIT_LOG_FORMAT,
  formatRelativeTime,
  parseCommitLogLine,
} from "./commit-log";
import { detectInProgressOperation } from "./git-operation-state";
import {
  ChangeEntry,
  CommitEntry,
  CommitDetail,
} from "../interfaces/timeline-view-provider.interface";
import {
  COMMITS_PAGE_SIZE,
  InProgressOperation,
  RemoteStatus,
  RepositorySnapshot,
  StashEntry,
} from "../interfaces/repository-snapshot";

/**
 * @description Read model for the timeline. Given the active repository it
 * assembles a {@link RepositorySnapshot} (changes, history, branches, remote
 * status, tags) in one pass, and answers per-commit detail lookups.
 *
 * Purely read-only: it never mutates the repository.
 */
export class RepositoryDataService {
  constructor(
    private readonly repos: RepositoryContext,
    private readonly git: GitClientFactory,
  ) {}

  /**
   * @description Splits the working tree into the two sections the UI shows:
   * one entry per file *per side* that changed, so a partially staged file
   * (status `MM`) appears under both Staged and Changes, like VS Code's own
   * source control. Conflicted paths appear once, unstaged, because index and
   * working tree describe the same conflict.
   */
  private toChangeEntries(status: StatusResult): ChangeEntry[] {
    const conflicted = new Set(status.conflicted);
    const entries: ChangeEntry[] = [];
    for (const file of status.files) {
      const index = (file.index ?? " ").trim();
      const working = (file.working_dir ?? " ").trim();
      if (conflicted.has(file.path)) {
        entries.push({
          path: file.path,
          status: working || index || "U",
          staged: false,
        });
        continue;
      }
      // Untracked files have no other side.
      if (index === "?" || working === "?") {
        entries.push({ path: file.path, status: "??", staged: false });
        continue;
      }
      if (index) {
        entries.push({ path: file.path, status: index, staged: true });
      }
      if (working) {
        entries.push({ path: file.path, status: working, staged: false });
      }
    }
    return entries;
  }

  /**
   * Builds a full snapshot for the current repository.
   *
   * @returns The snapshot, or `null` when no repository is open
   */
  async getSnapshot(): Promise<RepositorySnapshot | null> {
    const repo = this.repos.getPrimary();
    if (!repo) {
      return null;
    }

    const git = this.git.plain(repo.localPath);
    const [status, log, branch, remotes] = await Promise.all([
      git.status(),
      // A repository with no commit yet has no log to read.
      git
        .log({ maxCount: COMMITS_PAGE_SIZE })
        .catch(() => ({ all: [], total: 0 })),
      git.branch(),
      git.getRemotes(true),
    ]);

    const tags = await this.getTagsForCommits(git);
    const remoteStatus = await this.getRemoteStatus(
      git,
      branch.current,
      remotes,
    );

    const changes = this.toChangeEntries(status);

    const commits: CommitEntry[] = log.all.map((commit, index) =>
      this.toCommitEntry(commit, index, remoteStatus),
    );

    const branchList = await this.listBranches(git, branch.all, branch.current);
    const operation = await this.detectOperation(git);
    const canUndo = operation === null && (await this.hasParentCommit(git));

    return {
      changes,
      commits,
      hasMoreCommits: log.all.length === COMMITS_PAGE_SIZE,
      branches: branchList,
      currentBranch: branch.current || null,
      branchActivity: await this.getBranchActivity(git),
      repository: {
        name: path.basename(repo.localPath),
        path: repo.localPath,
        remote: repo.remoteUrl,
      },
      remoteStatus,
      tags,
      operation,
      conflicted: status.conflicted,
      canUndo,
      stashes: await this.getStashes(git),
    };
  }

  /**
   * Loads a further page of history.
   *
   * @param offset - Number of commits already shown
   * @param remoteStatus - Reused from the last snapshot so ahead/behind need
   *   not be recomputed
   */
  async loadMoreCommits(
    offset: number,
    remoteStatus: RemoteStatus,
  ): Promise<{
    commits: CommitEntry[];
    hasMoreCommits: boolean;
    offset: number;
  }> {
    const repo = this.repos.getPrimary();
    if (!repo) {
      return { commits: [], hasMoreCommits: false, offset };
    }

    const raw = await this.git
      .plain(repo.localPath)
      .raw([
        "log",
        `--format=${COMMIT_LOG_FORMAT}`,
        "--date=iso",
        `--max-count=${COMMITS_PAGE_SIZE}`,
        `--skip=${offset}`,
      ]);

    const commits = raw
      .split("\n")
      .filter((line) => line.trim())
      .map((line, index) => ({
        ...parseCommitLogLine(line),
        isPushed: remoteStatus.isPublished
          ? offset + index >= remoteStatus.ahead
          : false,
      }));

    return {
      commits,
      hasMoreCommits: commits.length === COMMITS_PAGE_SIZE,
      offset: offset + COMMITS_PAGE_SIZE,
    };
  }

  /**
   * Aggregate detail (stats + per-file status) for a single commit.
   *
   * @throws When the commit cannot be read
   */
  async getCommitDetail(hash: string): Promise<CommitDetail> {
    const repo = this.repos.getPrimary();
    if (!repo) {
      throw new Error("No repository open");
    }
    const git = this.git.plain(repo.localPath);

    const raw = await git.raw([
      "show",
      hash,
      "--numstat",
      "--pretty=format:%H%n%an%n%ae%n%ad%n%s",
      "--date=iso",
    ]);
    const lines = raw.split("\n");
    const summaryHash = lines.shift() ?? hash;
    const authorName = lines.shift() ?? "";
    const authorEmail = lines.shift() ?? "";
    const committedAt = lines.shift() ?? "";
    const message = lines.shift() ?? "";
    if (lines[0] === "") {
      lines.shift();
    }

    const files: CommitDetail["files"] = [];
    let additions = 0;
    let deletions = 0;
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      const [addStr, delStr, filePath] = line.split("\t");
      if (!filePath) {
        continue;
      }
      const add = addStr === "-" ? null : Number.parseInt(addStr, 10);
      const del = delStr === "-" ? null : Number.parseInt(delStr, 10);
      if (typeof add === "number" && !Number.isNaN(add)) {
        additions += add;
      }
      if (typeof del === "number" && !Number.isNaN(del)) {
        deletions += del;
      }
      files.push({
        path: filePath,
        status: "M",
        additions: add,
        deletions: del,
      });
    }

    const statusRaw = await git.raw([
      "show",
      hash,
      "--name-status",
      "--pretty=format:",
    ]);
    const statusMap = new Map<string, string>();
    for (const line of statusRaw.split("\n")) {
      const [state, filePath] = line.split("\t");
      if (filePath) {
        statusMap.set(filePath, state);
      }
    }
    for (const file of files) {
      file.status = statusMap.get(file.path) ?? "M";
    }

    return {
      summary: {
        hash: summaryHash,
        shortHash: summaryHash.slice(0, 7),
        message,
        authorName,
        authorEmail,
        relativeTime: formatRelativeTime(committedAt),
        committedAt,
        additions,
        deletions,
        fileCount: files.length,
      },
      files,
    };
  }

  /* ---------------- internals ---------------- */

  private detectOperation(
    git: ReturnType<GitClientFactory["plain"]>,
  ): Promise<InProgressOperation | null> {
    return detectInProgressOperation(git);
  }

  private async hasParentCommit(
    git: ReturnType<GitClientFactory["plain"]>,
  ): Promise<boolean> {
    try {
      await git.raw(["rev-parse", "--verify", "-q", "HEAD^"]);
      return true;
    } catch {
      return false;
    }
  }

  private async getStashes(
    git: ReturnType<GitClientFactory["plain"]>,
  ): Promise<StashEntry[]> {
    try {
      const raw = await git.raw(["stash", "list", "--format=%gd%x09%gs"]);
      return raw
        .split("\n")
        .filter((l) => l.trim())
        .map((line, index) => {
          const [, subject = ""] = line.split("\t");
          const onBranch = subject.match(/^(?:WIP on|On) ([^:]+):/);
          return {
            index,
            message: subject.replace(/^(?:WIP on|On) [^:]+:\s*/, "") || subject,
            branch: onBranch ? onBranch[1] : null,
          };
        });
    } catch {
      return [];
    }
  }

  private toCommitEntry(
    commit: {
      hash?: string;
      author_name?: string;
      author_email?: string;
      date?: string;
      message?: string;
    },
    index: number,
    remoteStatus: RemoteStatus,
  ): CommitEntry {
    const hash = commit.hash ?? "";
    return {
      hash,
      shortHash: hash.slice(0, 7),
      message: commit.message ?? "",
      authorName: commit.author_name ?? "",
      authorEmail: commit.author_email ?? "",
      relativeTime: formatRelativeTime(commit.date ?? ""),
      committedAt: commit.date ?? "",
      isPushed: remoteStatus.isPublished ? index >= remoteStatus.ahead : false,
    };
  }

  /**
   * Local branches ordered most-recently-used first (current branch, then
   * branches by last `git checkout` from the reflog, then the rest by last
   * commit date), followed by remote-only branches. Never exposes
   * `remotes/<remote>/<name>` refs — checking one out detaches HEAD.
   */
  private async listBranches(
    git: ReturnType<GitClientFactory["plain"]>,
    all: string[],
    current: string | undefined,
  ): Promise<string[]> {
    const local = all.filter((b) => !b.startsWith("remotes/"));
    const localSet = new Set(local);
    const remoteOnly: string[] = [];
    for (const b of all) {
      const m = b.match(/^remotes\/[^/]+\/(.+)$/);
      if (
        m &&
        m[1] !== "HEAD" &&
        !localSet.has(m[1]) &&
        !remoteOnly.includes(m[1])
      ) {
        remoteOnly.push(m[1]);
      }
    }

    // Base order: last commit date, newest first.
    let ordered = local;
    try {
      const raw = await git.raw([
        "for-each-ref",
        "--sort=-committerdate",
        "--format=%(refname:short)",
        "refs/heads",
      ]);
      const byDate = raw
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      ordered = byDate.filter((b) => localSet.has(b));
      for (const b of local) {
        if (!ordered.includes(b)) {
          ordered.push(b);
        }
      }
    } catch {
      // keep git.branch() order
    }

    // Bump branches to the front in reflog checkout order (true MRU).
    try {
      const reflog = await git.raw(["reflog", "--format=%gs", "-n", "400"]);
      const mru: string[] = [];
      for (const line of reflog.split("\n")) {
        const m = line.match(/^checkout: moving from \S+ to (\S+)$/);
        if (m && localSet.has(m[1]) && !mru.includes(m[1])) {
          mru.push(m[1]);
        }
      }
      ordered = [...mru, ...ordered.filter((b) => !mru.includes(b))];
    } catch {
      // reflog unavailable — date order stands
    }

    if (current && localSet.has(current)) {
      ordered = [current, ...ordered.filter((b) => b !== current)];
    }
    return [...ordered, ...remoteOnly];
  }

  /** One `for-each-ref` call instead of one `git log` per branch. */
  private async getBranchActivity(
    git: ReturnType<GitClientFactory["plain"]>,
  ): Promise<Record<string, string>> {
    const activity: Record<string, string> = {};
    try {
      const raw = await git.raw([
        "for-each-ref",
        "--format=%(refname:short)%09%(committerdate:relative)",
        "refs/heads",
      ]);
      for (const line of raw.split("\n")) {
        const [name, when] = line.split("\t");
        if (name && when) {
          activity[name] = when;
        }
      }
    } catch {
      // Non-fatal: the dropdown just omits the "updated N ago" hint.
    }
    return activity;
  }

  private async getTagsForCommits(
    git: ReturnType<GitClientFactory["plain"]>,
  ): Promise<Record<string, string[]>> {
    const map: Record<string, string[]> = {};
    const add = (hash: string, tag: string) => {
      (map[hash] ??= []).includes(tag) || map[hash].push(tag);
    };
    try {
      const raw = await git.raw([
        "for-each-ref",
        "--format=%(objectname)%09%(refname:short)%09%(*objectname)",
        "refs/tags",
      ]);
      for (const line of raw.split("\n")) {
        if (!line.trim()) {
          continue;
        }
        const [objectName, tagName, peeled] = line.split("\t");
        const commitHash = peeled || objectName;
        if (commitHash && tagName) {
          add(commitHash, tagName);
        }
      }
    } catch {
      // Non-fatal.
    }
    return map;
  }

  private async getRemoteStatus(
    git: ReturnType<GitClientFactory["plain"]>,
    currentBranch: string | undefined,
    remotes: Array<{ name: string }>,
  ): Promise<RemoteStatus> {
    const empty: RemoteStatus = {
      hasRemote: remotes.length > 0,
      isPublished: false,
      ahead: 0,
      behind: 0,
      lastFetched: null,
      remoteBranch: null,
    };
    if (!currentBranch || remotes.length === 0) {
      return { ...empty, hasRemote: false };
    }

    let remoteBranch: string | null = null;
    try {
      remoteBranch =
        (
          await git.raw([
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
          ])
        ).trim() || null;
    } catch {
      remoteBranch = null;
    }
    if (!remoteBranch) {
      return empty;
    }

    let ahead = 0;
    let behind = 0;
    try {
      const [b, a] = (
        await git.raw([
          "rev-list",
          "--left-right",
          "--count",
          "@{upstream}...HEAD",
        ])
      )
        .trim()
        .split(/\s+/);
      behind = Number.parseInt(b, 10) || 0;
      ahead = Number.parseInt(a, 10) || 0;
    } catch {
      // leave at 0
    }

    let lastFetched: Date | null = null;
    try {
      const raw = await git.raw([
        "reflog",
        "show",
        "--date=iso",
        "-n",
        "1",
        "--format=%cd",
        `refs/remotes/${remoteBranch}`,
      ]);
      const date = new Date(raw.trim());
      if (!Number.isNaN(date.getTime())) {
        lastFetched = date;
      }
    } catch {
      // unknown
    }

    return {
      hasRemote: true,
      isPublished: true,
      ahead,
      behind,
      lastFetched,
      remoteBranch,
    };
  }
}
