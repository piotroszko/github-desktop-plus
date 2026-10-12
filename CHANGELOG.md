# Changelog

All notable changes to GitHub Desktop Plus are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v2.0.1] - 2026-10-12

### Changed
- README rewritten: shorter, factual prose without the marketing and roadmap
  sections, the three screenshots kept as the visual introduction, and a note at
  the top stating that this is a fork of `vscode-github-desktop` with a link to
  the original repository. It no longer claims a "React / Material-UI" interface,
  which the extension does not have
- README screenshots replaced with current captures — Changes with the commit box
  and a real diff, History with a commit expanded to the files it touched, and the
  account menu showing the address each account commits as. They live in
  `media/example/` instead of the upstream author's Firebase bucket and no longer
  show the upstream extension over their own project; the second account carries a
  placeholder address
- This changelog now names the extension in its header and links to its own
  releases, instead of introducing itself as the upstream extension and pointing
  at the upstream project's releases

## [v2.0.0] - 2026-10-12

### Changed
- Branding: the icon keeps its artwork and gains a plus — a purple "+" badge in
  the marketplace PNG (the corner it sits in was empty) and, for the
  activity-bar mark, extra canvas so the plus sits clear of the Octocat
- Rebranded as **GitHub Desktop Plus** (publisher `piotroszko`, extension id
  `piotroszko.github-desktop-plus`): the manifest name/displayName, the activity
  bar container, every command/view id (`githubDesktop.` → `githubDesktopPlus.`),
  the command titles and the `githubDesktopPlus.autoRefreshInterval` setting key
  moved to the new namespace, so this fork no longer clashes with the original
  extension if both are installed. Stored state and secrets keep their
  `githubDesktop.*` keys (they are namespaced per extension, and renaming them
  would orphan existing repositories and tokens)

### Added
- Commits in the History list now expand: clicking one reveals the files it
  touched inline (status letter, path, `+n −m`), and clicking a file shows its
  changes — in the side-by-side diff pane when it is visible, in VS Code's own
  diff editor in a narrow panel — with an "Open all N files in VS Code" row for
  the whole commit. Several commits can be expanded at once, and in a narrow
  panel a commit click no longer dumps every file into a VS Code diff before you
  have picked one
- **Generate commit message** button next to the commit Summary field: pipes the
  diff into an agent CLI (default `omp -p --model commit`, configurable with
  `githubDesktopPlus.commitMessageCommand` / `commitMessageArgs`) and fills the
  message in. The prompt asks for a conventional-commit subject (`feat:`,
  `fix:`, `docs:`, …) and the whole message is kept within **100 characters** —
  the body is dropped first when it does not fit, and a still-too-long subject is
  clamped on a word boundary with an ellipsis. The diff is the staged one when
  anything is staged, otherwise everything that differs from `HEAD`; nothing is
  read from or written to the index. The button spins while it works, and
  failures (missing CLI, non-zero exit, timeout, nothing to describe) come back
  as a notification
- **Select Base Branch for Repository** (`githubDesktopPlus.selectBaseBranch`, on
  the Repositories tree item and in the palette): pick the branch the extension
  compares against when the tracked upstream is not the branch you work with
  (e.g. it tracks `prod` but you target `develop`). It drives the sync cell's
  ahead/behind and state, the pull-request compare link and pull-request list
  filter, and the branch menu (base first, marked `(base)`, plus a "Compare with
  <base>" entry). It is an extension setting only: git's upstream, and therefore
  push, pull and other tools, are untouched; "Follow the tracked branch" clears
  it, and a base that no longer exists falls back to the upstream
- The activity bar icon now carries a badge with the number of files that have
  uncommitted changes in the active repository (staged and unstaged counted
  once), with the repository name in its tooltip; it clears as soon as the tree
  is clean. The repositories tree is created via `createTreeView` so the badge
  exists from activation instead of only after the History panel is opened
- Commit box drafts persist per repository: the summary, description, co-authors
  and ticked files come back after the panel is recreated (view hidden, window
  reloaded) and when switching between repositories. Refreshes never overwrite
  what you are typing, and a successful commit clears that repository's draft
- The Changes tab now shows **Staged Changes** and **Changes** as separate
  sections, like VS Code's own source control: each is collapsible, carries a
  count, and has its own actions (stage all / unstage all / discard all). Every
  file row gains hover buttons — stage or unstage, plus discard. A file that is
  staged *and* edited again appears in both sections
- Commit precedence follows staging: with something staged, Commit runs on the
  index (`commit`) and only those files are committed; with nothing staged, the
  ticked files are staged and committed together as before. The commit button
  says which applies, and Amend follows the same rule
- Repositories with no commit yet no longer break the panel (`git log` has
  nothing to read there), and staging/unstaging works in them (`reset` has no
  HEAD, so unstage falls back to `rm --cached`)
- Loading states for the buttons that start long operations: the sync cell
  (Fetch / Pull / Push / Publish / Force-push) switches to a spinner with a
  progress label and ignores clicks until the operation settles, the Commit
  button shows "Committing…" and stays disabled, and Continue / Abort lock while
  a conflict operation is in flight. The state clears on success **and** on
  failure (a failed fetch cannot leave a button spinning), and the spinner
  honours `prefers-reduced-motion`
- Automatic refresh of the History panel's git state: every 30 s while the panel
  is visible (setting `githubDesktopPlus.autoRefreshInterval`, `0` disables it) and
  immediately when the VS Code window regains focus, so changes made outside
  VS Code (git commands in a terminal, other tools) appear without re-opening
  the view
- Native diff fallback: below ~620px the History panel hides its own diff pane,
  so clicking a changed file (working tree) or a commit now opens VS Code's own
  diff editor — `vscode.diff` for one file, the changes editor (`vscode.changes`)
  for a whole commit. The "before" side is served by this extension's own
  read-only `github-desktop-git:` documents (`git show <ref>:<path>`), never by
  the built-in Git extension's private `git:` scheme
- `GitHub Desktop: Select Account for Repository`: pins a single tracked
  repository to a GitHub account (context menu on the Repositories tree item, or
  the command palette). Pinned repositories fetch/pull/push/publish, push tags,
  check out PRs and load PRs/issues/avatars as that account, independent of the
  extension's active account; the picker's "Follow the active account" entry
  clears the pin. A signed-out selection falls back to the active account, and
  the Repositories tree shows the effective account per repo
- "Use Account for Current Repository" on the **Accounts** tree context menu:
  applies that account to the repository the extension is currently working on
- The History panel's account avatar (next to the commit summary) is now a
  button that opens an account menu for the current repository, marking the
  `active` and `selected` accounts and offering "Follow the active account".
  All three surfaces write the same per-repository default
- The account picker and that avatar menu now show the address commits will be
  authored with (`name <email>`), so the identity in effect for a repository is
  visible before anything is committed

### Fixed
- Commits made through the extension are now authored and committed as the
  account the repository is set to use, instead of whatever the machine's global
  git config held: `commit`, `commitFiles`, amend, cherry-pick, revert, merge,
  conflict "continue", pull and `tag -a` run with that account's name and email
  (passed as `-c user.name`/`-c user.email` per invocation, never written to
  `.git/config`). Accounts now record their public profile email, falling back
  to GitHub's `<id>+<login>@users.noreply.github.com` no-reply address when no
  email is public, and accounts imported before this change are backfilled on
  the next activation. A repository with no signed-in account still commits with
  git's own configured identity
- Ticked files now follow an *exception* list: everything is ticked by default,
  including files that appear after a draft was saved, and only the files you
  untick stay unticked (a plain toggle or "select all off" records them). A
  restored draft used to treat its saved tick list as the whole truth, so a file
  created since then came back unticked. Drafts written before this change are
  migrated the first time they are applied
- The repository / branch / sync dropdowns and the commit context menus no
  longer get cut off at the edge of the view: menus are now sized and placed
  against the actual space in the panel (opening upward when there is more room
  above), scroll internally when the list is long, and ellipsize long labels
  instead of widening past the panel edge
- The account avatar next to the commit summary in the History panel now
  follows account changes: switching accounts never refreshed the timeline, and
  the avatar always showed the active account instead of the repository's
  selected one

### Changed
- The commit form (Summary / Description / Amend / Commit) and the
  "Committed … · Undo" bar are now pinned to the bottom of the Changes panel,
  GitHub Desktop style: only the file list scrolls, so the form no longer
  scrolls out of view with long changesets. Section order is unchanged; a very
  short panel falls back to scrolling the pane so the form stays reachable
- Selecting another repository (repositories tree view, "Open Repository", or
  the timeline's repository picker) no longer switches the VS Code window: the
  choice is remembered in-extension for the session and the window keeps its
  current workspace folder
- `GitHub Desktop: Create Issue` no longer pins an as-yet-unassigned repository
  to the active account as a side effect; it uses the repository's effective
  account and leaves the selection untouched

## [v1.9.0] - 2026-09-18

### Added
- Git tags now show as badges on commits in the History tab
- Commit rows in the History tab show the author's GitHub avatar
- GitHub accounts stay in sync with the `gh` CLI: every account `gh` is
  logged into is imported automatically, tokens are refreshed live, and
  switching accounts in the extension also switches gh's own active
  account (and vice versa via "Switch GitHub CLI Account")
- `@core`, `@shared`, `@ui`, and `@webviews` path aliases for imports

### Changed
- Repository links updated to `betaversionio/github-desktop`
- Dependencies upgraded (`@octokit/rest`, `simple-git`, `webpack`,
  `webpack-cli`, `rimraf`, `ts-loader`); `typescript` held at ^6.0.3 and
  `@types/vscode` held at ^1.84.0 pending `ts-loader` support for
  TypeScript 7 and to match the extension's declared minimum VS Code version

## [v1.8.1] - 2026-09-17

### Fixed
- Marketplace publish step failing on a false-positive secret scan (a
  placeholder PAT string in the "enter your token" input box)

## [v1.8.0] - 2026-09-17

### Added
- Merge a branch into the current branch from the branch dropdown, with a
  confirmation guard against merging the default branch in the wrong
  direction

### Fixed
- CI/release workflows updated to the npm + webpack build introduced in
  v1.7.0 (previously still targeting the removed pnpm/vite/webview build)

## [v1.7.0] - 2026-09-17

### Changed
- SOLID rewrite of the extension backend: the message-handler god object
  split into cohesive services (working-tree, sync, branch, commit-actions,
  conflict, stash, diff, pull-request, repository-data) behind ports &
  adapters, with a single composition root (`TimelineController`)
- Webview replaced: React/MUI/vite timeline and commit-detail panel
  rewritten as one self-contained HTML/CSS/JS view modeled on the GitHub
  Desktop app; bundle size reduced from ~600 KB to ~300 KB
- New diff renderer styled like VS Code's native diff editor, with dual
  gutters and word-level intra-line highlighting
- Git auth now uses an ephemeral `-c http.extraheader` instead of writing
  the token into `.git/config`

### Added
- Force-push (`--force-with-lease`), branch comparison, undo last commit,
  amend, co-authors, conflict resolution (continue/abort/mark resolved),
  and stash (push/apply/drop)
- Branch dropdown ordered by recency (MRU via reflog)
- Repository picker that also opens the folder in VS Code
- Pull request list, with checkout via the GitHub REST API

### Removed
- History Explorer and the old React timeline

## [v1.1.0] - 2024-01-20

_Versions v1.1.1 through v1.6.1 were incremental fixes and UI iterations
released without individual changelog entries._

### Added
- Browser-based authentication using VS Code's built-in GitHub authentication
- GitHub CLI integration with automatic account detection
- GitHub Enterprise Server support
- Enhanced error logging for debugging authentication issues
- Dynamic sync status in timeline header
- Keyboard shortcuts documentation

### Changed
- Improved authentication token format for better GitHub compatibility
- Optimized README for VS Code Marketplace presentation
- Enhanced commit detail panel behavior
- Better file diff handling with dedicated panels
- Updated UI with Material-UI v7 components

### Fixed
- Authentication failures with push/pull operations (403 errors)
- Commit detail panel opening in wrong location
- Account switching not updating git credentials
- File diff panels creating multiple instances
- Extension auto-opening on startup

## [v1.0.6] - 2024-01-19

### Added
- Multi-account support with secure token storage
- Right-click context menus for Git operations
- Commit detail webview panels
- File staging/unstaging UI

### Changed
- Migrated to React 19
- Updated dependencies for security

### Fixed
- Repository detection issues
- Token persistence problems

## [v1.0.5] - 2024-01-18

### Added
- Initial release with core features
- GitHub Desktop-style UI
- Commit history visualization
- Branch management
- Basic Git operations

---

*For more details, see the [GitHub Releases](https://github.com/piotroszko/github-desktop-plus/releases)*