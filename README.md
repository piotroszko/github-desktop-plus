# 🐙 GitHub Desktop for VS Code

<p align="center">
  <img src="https://storage.googleapis.com/nprep-f64b1.firebasestorage.app/admin/1758528789562_icon.png" alt="GitHub Desktop for VS Code" width="128" height="128">
</p>

<p align="center">
  <strong>Bring GitHub Desktop's complete workflow experience directly into VS Code</strong>
</p>

<p align="center">
  Modern React UI • Multi-Account Support • Advanced Git Operations • Seamless GitHub Integration
</p>

---

## ✨ What You Get

🎨 **GitHub Desktop-style interface** right in your VS Code sidebar
👥 **Multiple GitHub accounts** with one-click switching
📝 **Visual commit history** with user avatars and detailed file changes
🌿 **Advanced branch management** with activity tracking
🔄 **Smart sync operations** with visual feedback
⚡ **Native VS Code integration** using built-in diff viewer

---

## 📸 Examples

### Main Interface
![Main Interface](https://storage.googleapis.com/nprep-f64b1.firebasestorage.app/admin/1758528839314_1.png)

### Timeline and Changes View
![Timeline View](https://storage.googleapis.com/nprep-f64b1.firebasestorage.app/admin/1758528841624_2.png)


---

## ✨ Features

### 🎨 **Modern React-Based Interface**
- **GitHub Desktop-style UI** with clean, responsive design
- **Material-UI components** styled with VS Code theming
- **Avatar integration** with user profile pictures
- **Dark/Light theme** support matching VS Code
- **Responsive layout** that adapts to panel sizes

### 📝 **Advanced Commit Management**
- **Interactive commit history** with detailed commit cards
- **Commit detail panel** opening in separate webview with file changes
- **Right-click context menu** on commits with full Git operations:
  - Reset to commit
  - Checkout commit
  - Revert changes
  - Create branch from commit
  - Create tags
  - Cherry-pick commits
  - Copy SHA/commit info
  - View on GitHub
- **File diff viewer** integrated with VS Code's native diff editor
- **Commit statistics** showing additions/deletions per file

### 🌿 **Branch Operations**
- **Advanced branch dropdown** with grouping (Default/Recent/Other)
- **Branch activity tracking** with last commit dates
- **Branch creation** from any commit
- **Branch merging** with merge dialog
- **Branch switching** with visual feedback

### 👥 **Multi-Account Support**
- **Multiple GitHub accounts** with visual indicators and easy switching
- **Secure token storage** using VS Code Secret Storage API
- **GitHub CLI integration** with automatic account detection
- **One-click account switching** directly from accounts panel
- **Per-repository account selection** — pin a repo to a specific account (right-click it in the Repositories panel, right-click an account in the Accounts panel, or click the avatar next to the commit summary) while other repos keep using the active account
- **Account-specific operations** with proper isolation
- **Smart CLI account selection** with guided switching process

### 🔄 **Repository Management**
- **Auto-detection** of workspace repositories with Git integration
- **Repository cloning** with account selection and progress tracking
- **Private repository** support with proper authentication
- **Repository switching** within VS Code without window changes
- **GitHub integration** for direct repository links and issue creation

### 📱 **Changes & History Panel**
- **VS Code Source Control UI** - Exact replica of native source control
- **Collapsible sections** for staged and unstaged changes
- **File staging/unstaging** with individual file controls
- **Commit message editing** with keyboard shortcuts (Ctrl+Enter)
- **Smart action buttons** (Stage All, Unstage All, Commit, Sync)
- **Stage / unstage / discard on hover** — per file, plus per-section buttons for multi-file operations; commit takes the staged files from the index, and with nothing staged it commits the ticked files together
- **Real-time updates** — refreshes on save, when the panel is shown or the window regains focus, and every 30 s while the panel is visible, so changes made outside VS Code (git commands in a terminal, other tools) show up without re-opening the view

### 🎛️ **Timeline Header**
- **Dynamic sync status** showing Push/Pull/Fetch operations
- **Interactive branch switching** with current branch display
- **Sync counters** showing commits ahead/behind
- **Contextual actions** (Force Push, Fetch Origin) when available
- **GitHub Desktop-style layout** with proper spacing and icons

## 🚀 Quick Start

### 1. **Install the Extension**
- Search for "GitHub Desktop" in VS Code Extensions
- Click **Install** and you're ready to go!

### 2. **Sign In to GitHub**
1. Look for the 🐙 icon in VS Code's activity bar
2. Click **"Add Account"** or use Command Palette: `GitHub Desktop: Sign In`
3. Choose your preferred method:
   - **Browser Sign-in** (Recommended) - Uses VS Code's built-in GitHub authentication
   - **GitHub CLI** - If you have `gh` installed
   - **Personal Access Token** - For manual setup
   - **Enterprise Server** - For GitHub Enterprise users

### 3. **Start Using**
- Any Git repository in your workspace is automatically detected
- Use the sidebar to view commit history, manage branches, and stage changes
- Right-click commits for advanced Git operations
- Switch between accounts instantly from the Accounts panel

> **💡 Pro Tip**: The extension works seamlessly with VS Code's built-in Source Control - no configuration needed!

## 💡 Key Features in Action

### **Multi-Account Support**
- Add multiple GitHub accounts (personal, work, enterprise)
- Switch between accounts with a single click
- Pin an individual repository to one account (`Select Account for Repository`)
  and leave the rest following the active account; unassigned or signed-out
  selections fall back to the active account
- Each account maintains its own repositories and settings

### **Visual Git Operations**
- **Native VS Code diffs**: in a narrow History panel (where the built-in diff pane is hidden) clicking a changed file or a commit opens VS Code's own diff/changes editor instead of rendering into an invisible pane
- **Commit History**: Timeline view with user avatars and commit details
- **File Changes**: Click any commit to see detailed file diffs
- **Branch Management**: Visual branch dropdown with recent/active branches
- **Right-click Context**: Access all Git operations via context menus

### **Seamless Workflow**
- **Auto-detection**: Any Git repo in your workspace appears automatically
- **Stage & Commit**: VS Code Source Control-style interface for staging files
- **Sync Operations**: Push/pull with visual feedback and conflict detection
- **GitHub Integration**: Direct links to view commits/repos on GitHub

## 🎛️ Available Commands

Access these commands via Command Palette (`Ctrl+Shift+P`):

- `GitHub Desktop: Sign In` - Add a new GitHub account
- `GitHub Desktop: Switch Active Account` - Switch between your accounts
- `GitHub Desktop: Clone Repository` - Clone a repo with account selection
- `GitHub Desktop: Open Repository` - Open any tracked repository
- `GitHub Desktop: Select Account for Repository` - Choose which account a single repository authenticates as
- `GitHub Desktop: Use Account for Current Repository` - Right-click an account in the Accounts panel to apply it to the repository you are working on
- `GitHub Desktop: Create Issue` - Create GitHub issues directly
- `GitHub Desktop: Refresh Views` - Refresh all panels

### **⚙️ Settings**

- `githubDesktop.autoRefreshInterval` (number, default `30`) - Seconds between automatic refreshes of the History panel while it is visible. Set to `0` to disable periodic refreshes; the panel still refreshes when it regains focus or a file is saved in VS Code.

### **🎨 Keyboard & Mouse Shortcuts**
- **Ctrl+Enter** - Commit staged changes
- **Click any account** - Switch to that account instantly
- **Right-click commits** - Access Git operations menu
- **Click commit** - View detailed file changes
- **Click branch name** - Open branch selector

---

## 🔒 Security & Privacy

Your data is safe with us:
- **Encrypted storage**: All GitHub tokens stored securely using VS Code's Secret Storage
- **Local processing**: Everything runs locally on your machine
- **No data collection**: We don't collect or transmit your personal data
- **Account isolation**: Each GitHub account's data is completely separated
- **Open source**: Full transparency - inspect the code yourself

---

## ⚙️ Requirements

- **VS Code**: Version 1.84.0 or higher
- **Git**: Must be installed and accessible in PATH
- **GitHub Account**: For full functionality (free accounts work perfectly)

### **Personal Access Token Scopes** (if using manual token setup)
When creating a personal access token, ensure these scopes:
- `repo` - Repository access
- `read:org` - Organization membership
- `user:email` - User email access

---

## 🆘 Need Help?

### **Common Issues & Solutions**

**🔐 Can't sign in?**
- Try "Browser Sign-in" first (recommended method)
- For tokens: Ensure scopes include `repo`, `read:org`, `user:email`
- For GitHub CLI: Run `gh auth status` to verify authentication

**📂 Repository not showing?**
- Make sure the folder contains a `.git` directory
- Use `GitHub Desktop: Refresh Views` command
- Check that you have access to the repository

**🔄 Sync not working?**
- Verify you have push permissions to the repository
- Check your internet connection
- For organization repos, ensure proper access rights

### **🐛 Found a Bug?**
[Report issues on GitHub](https://github.com/betaversionio/github-desktop/issues) - we fix them fast!

---

## 🤝 Contributing

We welcome contributions! Here's how you can help:

### **For Users**
- ⭐ **Star the repository** if you find it useful
- 🐛 **Report bugs** on our [GitHub Issues](https://github.com/betaversionio/github-desktop/issues)
- 💡 **Suggest features** via [GitHub Discussions](https://github.com/betaversionio/github-desktop/discussions)
- 📝 **Write reviews** and share your experience

### **For Developers**
- 🔧 **Fix bugs** or **add features** via pull requests
- 📚 **Improve documentation**
- 🧪 **Add tests** for better reliability
- 🎨 **Enhance UI/UX** to match GitHub Desktop even closer

Visit our [GitHub repository](https://github.com/betaversionio/github-desktop) to get started!

---

## 🎯 What's Coming Next

We're constantly improving! Here's what's on our roadmap:

### **🚀 Upcoming Features**
- 📝 **Pull Request Management** - View, create, and review PRs directly in VS Code
- 🔔 **GitHub Notifications** - Get notified about mentions, reviews, and issues
- ✅ **Status Checks** - See CI/CD pipeline status right in the extension
- 📦 **Stash Management** - Visual Git stash operations
- 🤝 **Conflict Resolution** - Better merge conflict resolution tools
- 📊 **Repository Insights** - Contribution graphs and repository statistics

### **🎉 Recently Added**
- ✅ Multi-account support with secure token storage
- ✅ Right-click context menus for all Git operations
- ✅ VS Code native diff integration
- ✅ GitHub CLI integration with account detection
- ✅ Branch activity tracking and smart grouping
- ✅ Dynamic sync status and operations

---

## 🌟 Why Choose This Extension?

**vs. GitLens**: We provide a dedicated GitHub Desktop-style interface, while GitLens focuses on inline annotations and blame features.

**vs. GitHub Pull Requests**: We offer complete Git workflow management with multi-account support, while GitHub PR extension focuses specifically on pull request operations.

**vs. Built-in Source Control**: We enhance VS Code's native Git support with GitHub-specific features, visual commit history, and multi-account management.

**Our Unique Value**: The only extension that brings the complete GitHub Desktop experience into VS Code with full multi-account support.

---

---

<p align="center">
  <strong>Made with ❤️ for the VS Code and GitHub communities</strong>
</p>

<p align="center">
  🚀 <strong>Happy coding with GitHub Desktop for VS Code!</strong> 🚀
</p>

<p align="center">
  <a href="https://github.com/betaversionio/github-desktop">⭐ Star on GitHub</a> •
  <a href="https://github.com/betaversionio/github-desktop/issues">🐛 Report Issues</a> •
  <a href="https://github.com/betaversionio/github-desktop/discussions">💡 Discussions</a>
</p>

---

**License**: MIT © 2024 GitHub Desktop for VS Code Contributors

