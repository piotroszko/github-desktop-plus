/**
 * @description Normalises a git remote URL (SSH or HTTPS, with or without a
 * trailing `.git`) into its browsable `https://github.com/owner/repo` form.
 *
 * @param remoteUrl - The value of `remote.origin.url`, or `undefined`
 * @returns The web URL, or `null` when `remoteUrl` is missing
 *
 * @example
 * toGitHubWebUrl("git@github.com:owner/repo.git"); // "https://github.com/owner/repo"
 */
export function toGitHubWebUrl(remoteUrl: string | undefined): string | null {
  if (!remoteUrl) {
    return null;
  }
  return remoteUrl
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "");
}

/**
 * @description The plain branch name GitHub's compare and pull-request APIs
 * expect, derived from a git ref: `remotes/origin/develop` → `develop`.
 *
 * Assumes the default `origin` remote, which is what the base-branch picker
 * offers first; a ref from another remote would keep its remote prefix.
 *
 * @param ref - A branch ref, or `undefined`/`null`
 * @returns The branch name, or `null` when there is nothing to name
 */
export function toGitHubBranchName(ref: string | undefined | null): string | null {
  if (!ref) {
    return null;
  }
  const name = ref
    .replace(/^refs\/remotes\//, "")
    .replace(/^refs\/heads\//, "")
    .replace(/^remotes\//, "")
    .replace(/^origin\//, "");
  return name || null;
}
