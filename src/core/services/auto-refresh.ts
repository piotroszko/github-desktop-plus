/** Handle of the periodic refresh timer (Node timer in the extension host). */
export type TimerHandle = NodeJS.Timeout | number;

/**
 * @description Keeps the History panel's git state in step with the repository
 * even when the changes happen outside VS Code — a `git` command in a terminal,
 * another tool, a script. Refreshes on a fixed interval while the panel is
 * visible, and immediately whenever the window regains focus.
 */
export class AutoRefresh {
  private timer: TimerHandle | undefined;
  private disposed = false;

  constructor(
    private readonly options: {
      /** Recomputes and broadcasts the current repository's state. */
      refresh: () => void;
      /** Whether the panel showing that state is on screen right now. */
      isVisible: () => boolean;
      /** Configured interval in seconds; `0` disables periodic refreshes. */
      intervalSeconds: () => number;
      /** Injectable timer, for tests. */
      schedule?: (fn: () => void, ms: number) => TimerHandle;
      /** Injectable timer, for tests. */
      cancel?: (handle: TimerHandle) => void;
    },
  ) {}

  /**
   * @description (Re)arms the timer from the current `intervalSeconds`. Safe to
   * call again after the interval setting changes.
   */
  start(): void {
    this.stopTimer();
    if (this.disposed) {
      return;
    }
    const seconds = this.options.intervalSeconds();
    if (!(seconds > 0)) {
      return;
    }
    const schedule = this.options.schedule ?? ((fn, ms) => setInterval(fn, ms));
    this.timer = schedule(() => this.tick(), seconds * 1000);
  }

  /** @description Called when the VS Code window regains focus. */
  focusGained(): void {
    this.tick();
  }

  dispose(): void {
    this.disposed = true;
    this.stopTimer();
  }

  private tick(): void {
    if (this.disposed || !this.options.isVisible()) {
      return;
    }
    this.options.refresh();
  }

  private stopTimer(): void {
    if (this.timer === undefined) {
      return;
    }
    const cancel = this.options.cancel ?? ((handle) => clearInterval(handle));
    cancel(this.timer);
    this.timer = undefined;
  }
}
