---
name: publish
description: Bump the extension's version and push a release tag, triggering .github/workflows/release.yml (GitHub release + Marketplace publish)
disable-model-invocation: true
argument-hint: '[patch|minor|major] (default: patch)'
allowed-tools:
  - Bash
  - Read
  - Edit
---

Cut a release of this VS Code extension. `release.yml` only runs on
`v*.*.*` tag pushes, so pushing the tag *is* what publishes — treat every
step here as leading up to a real, public action.

1. **Preflight — do not skip.**
   - `git status --porcelain` must be clean. If not, stop and tell the user
     what's uncommitted; do not stash or discard anything yourself.
   - `git branch --show-current` should be `main`. If not, ask before
     continuing.
   - `git fetch origin && git log origin/main..HEAD --oneline` — tell the
     user how many local commits are about to ship, so they're not
     surprised by what's in the release.
   - Run `npx tsc --noEmit -p .` and `npm run compile`. Both must succeed.
     A broken build must never be tagged.

2. **Determine the bump type.** Use `$ARGUMENTS` if it's `patch`, `minor`,
   or `major`. Otherwise default to `patch`, but if the commits since the
   last tag look feature-shaped (e.g. gitmoji ✨ or "feat:"), suggest
   `minor` instead and confirm with the user before proceeding — don't
   guess silently on anything above `patch`.

3. **Check `CHANGELOG.md` has an entry for the new version.**
   `release.yml`'s "Get changelog entry" step extracts the section headed
   `## [vX.Y.Z]` from `CHANGELOG.md` and uses it verbatim as the GitHub
   release body. If there's no such heading yet for the version you're
   about to create, add one now, above the previous top entry, following
   the file's existing `### Added` / `### Changed` / `### Fixed` structure.
   Base it on the actual commits since the last tag — don't invent
   features that weren't in this batch of changes.

4. **Bump the version.**
   ```bash
   npm version <patch|minor|major> --no-git-tag-version
   ```
   This updates `package.json` only. Then run `npm install` (not `npm ci`)
   so `package-lock.json`'s version fields stay in sync — verify with
   `grep -n '"version"' package-lock.json | head -3`.

5. **Verify the changelog extraction actually resolves** for the new
   version before committing anything (mirrors what `release.yml` runs):
   ```bash
   awk -v ver="## [v$NEW_VERSION]" '
     index($0, ver) == 1 { found=1; next }
     found && /^## \[/ { exit }
     found { print }
   ' CHANGELOG.md
   ```
   If this prints nothing, fix the changelog before continuing.

6. **Rebuild and re-verify** (`npx tsc --noEmit -p .` and `npm run compile`)
   now that `package.json`'s version changed — confirm still clean.

7. **Commit.** Stage exactly `package.json`, `package-lock.json`, and
   `CHANGELOG.md` (never a broad `git add .`). Use gitmoji convention
   matching this repo's history, e.g.:
   ```
   git commit -m "$(cat <<'EOF'
   🔖 bump version to X.Y.Z
   EOF
   )"
   ```
   No `Co-Authored-By` line.

8. **Confirm before the irreversible step.** Tell the user exactly what's
   about to happen: "This pushes `vX.Y.Z`, which triggers `release.yml` to
   build the VSIX, create the GitHub Release and publish it to the VS Code
   Marketplace and Open VSX. Proceed?" Wait for an explicit yes — never tag
   and push in the same breath as bumping the version.

   The publish steps need the repository secrets `VSCE_PAT` (Azure DevOps PAT
   with the Marketplace "Manage" scope) and `OVSX_PAT` (Open VSX access token
   for the `piotroszko` namespace). `release.yml` publishes the VSIX it built
   with `--skip-duplicate`, so re-running a release is safe. A missing secret
   fails the run instead of being skipped silently.

9. **Tag and push**, once confirmed:
   ```bash
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   ```

10. **Watch the workflow**, don't just fire and forget:
    ```bash
    gh run list --workflow=release.yml --limit 1
    ```
    Poll `gh run view <id> --json status,conclusion` until `completed`, then
    confirm the `Publish to VS Code Marketplace` and `Publish to Open VSX`
    steps both succeeded — `vsce publish` and `ovsx publish` write the real
    result there. A red run after the GitHub Release exists usually means a
    missing or expired secret; fix the secret and re-run the failed job
    rather than moving the tag.

If the marketplace step fails (e.g. a stale token, a secret-scanner false
positive), do not force-push or move the existing tag to "fix" it — cut
the next patch version instead, the same way v1.8.0 → v1.8.1 was handled
in this repo's history.

There is also a CI path: dispatching the `Version Bump` workflow
(`gh workflow run version-bump.yml -f version_type=patch -f create_tag=true`)
bumps the version, generates the `## [vX.Y.Z]` section from the commits since
the last tag (keeping a hand-written section if one already exists), commits
to `main`, and pushes the tag. It needs a `RELEASE_TOKEN` repository secret
(a fine-grained PAT with `Contents: read and write`), because a tag pushed
with the default `GITHUB_TOKEN` does **not** trigger `release.yml`. Prefer the
steps above when the changelog entry deserves hand-written prose.
