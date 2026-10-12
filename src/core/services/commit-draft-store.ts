import { Memento } from "vscode";
import { CommitDraft } from "../../shared/types";

const DRAFTS_KEY = "githubDesktop.commitDrafts";

/**
 * @description Stores the commit box draft per repository, so a half-written
 * commit message and the ticked files come back after the panel is recreated
 * (view hidden, window reloaded) or the user switches repositories.
 *
 * Satisfies the timeline's `DraftStore` port; kept free of any `vscode` runtime
 * API beyond the `Memento` it is handed.
 */
export class CommitDraftStore {
  constructor(private readonly state: Memento) {}

  get(localPath: string): CommitDraft | undefined {
    return this.read()[localPath];
  }

  async set(localPath: string, draft: CommitDraft): Promise<void> {
    const all = this.read();
    all[localPath] = draft;
    await this.state.update(DRAFTS_KEY, all);
  }

  private read(): Record<string, CommitDraft> {
    return this.state.get<Record<string, CommitDraft>>(DRAFTS_KEY, {});
  }
}
