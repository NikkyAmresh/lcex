import * as vscode from "vscode";

/** Per-problem cumulative timer state (seconds), keyed by titleSlug */
export const TIMER_ELAPSED_KEY = "leetcode-practice.timerElapsed";
export const TIMER_BY_DAY_KEY = "leetcode-practice.timerByDay";
const TICK_INTERVAL_MS = 1000;

/** Per-day breakdown: { "YYYY-MM-DD": { titleSlug: seconds } } */
export type TimerByDay = Record<string, Record<string, number>>;

// Gradient: green (0-10min) -> amber (10-30min) -> red (30-45min) -> black (45min+)
const GREEN = 0x26a641;
const AMBER = 0xd39b00;
const RED = 0xdc3545;
const BLACK = 0x1a1a1a;

function lerpHex(from: number, to: number, t: number): string {
  const r = Math.round(((from >> 16) & 0xff) * (1 - t) + ((to >> 16) & 0xff) * t);
  const g = Math.round(((from >> 8) & 0xff) * (1 - t) + ((to >> 8) & 0xff) * t);
  const b = Math.round((from & 0xff) * (1 - t) + (to & 0xff) * t);
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}

function colorForElapsed(sec: number): string {
  const m = sec / 60;
  if (m <= 10) return lerpHex(GREEN, AMBER, m / 10);
  if (m <= 30) return lerpHex(AMBER, RED, (m - 10) / 20);
  if (m <= 45) return lerpHex(RED, BLACK, (m - 30) / 15);
  return `#${BLACK.toString(16).padStart(6, "0")}`;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
}

interface TimerEntry {
  elapsed: number;
  paused: boolean;
}

interface RegisteredPanel {
  panel: vscode.WebviewPanel;
  problemTitle: string;
}

let instance: ProblemTimer | null = null;

export function initProblemTimer(
  context: vscode.ExtensionContext,
  statusBarItem: vscode.StatusBarItem,
  shouldShow: () => boolean,
  getTitleSlugForActiveSolutionFile: () => string | null
): ProblemTimer {
  instance = new ProblemTimer(context, statusBarItem, shouldShow, getTitleSlugForActiveSolutionFile);
  return instance;
}

export function getProblemTimer(): ProblemTimer | null {
  return instance;
}

export function disposeProblemTimer(): void {
  if (instance) {
    instance.dispose();
    instance = null;
  }
}

export class ProblemTimer {
  private readonly context: vscode.ExtensionContext;
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly shouldShow: () => boolean;
  private readonly getTitleSlugForActiveSolutionFile: () => string | null;
  private readonly panels = new Map<string, RegisteredPanel>();
  private activeTitleSlug: string | null = null;
  private lastActiveTitleSlug: string | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private focusCheckInterval: ReturnType<typeof setInterval> | null = null;
  private manualPause = new Map<string, boolean>();
  private windowFocused = true;
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly FOCUS_CHECK_MS = 500;

  constructor(
    context: vscode.ExtensionContext,
    statusBarItem: vscode.StatusBarItem,
    shouldShow: () => boolean,
    getTitleSlugForActiveSolutionFile: () => string | null
  ) {
    this.context = context;
    this.statusBarItem = statusBarItem;
    this.shouldShow = shouldShow;
    this.getTitleSlugForActiveSolutionFile = getTitleSlugForActiveSolutionFile;
    this.windowFocused = vscode.window.state?.focused ?? true;
    this.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => this.recomputeActive()));
    this.subscriptions.push(
      vscode.window.onDidChangeWindowState((e) => this.onWindowStateChange(e.focused))
    );
    this.focusCheckInterval = setInterval(() => this.checkWindowFocus(), this.FOCUS_CHECK_MS);
  }

  private onWindowStateChange(focused: boolean): void {
    if (this.windowFocused === focused) return;
    this.windowFocused = focused;
    if (!focused) {
      this.stopTick();
    } else if (this.activeTitleSlug && !this.isPaused(this.activeTitleSlug)) {
      this.startTick();
    }
  }

  private checkWindowFocus(): void {
    const focused = vscode.window.state?.focused ?? true;
    if (this.windowFocused !== focused) {
      this.onWindowStateChange(focused);
    }
  }

  /** Recompute which problem is "active" (panel focused OR its solution file focused). */
  private recomputeActive(): void {
    for (const [slug, r] of this.panels) {
      if (r.panel.active && r.panel.visible) {
        this.setActive(slug);
        return;
      }
    }
    const solutionSlug = this.getTitleSlugForActiveSolutionFile();
    if (solutionSlug && this.panels.has(solutionSlug)) {
      this.setActive(solutionSlug);
      return;
    }
    if (this.activeTitleSlug) this.setActive(null);
  }

  private getState(): Record<string, TimerEntry> {
    return this.context.globalState.get<Record<string, TimerEntry>>(TIMER_ELAPSED_KEY) ?? {};
  }

  private async saveState(state: Record<string, TimerEntry>): Promise<void> {
    await this.context.globalState.update(TIMER_ELAPSED_KEY, state);
  }

  private getElapsed(titleSlug: string): number {
    return this.getState()[titleSlug]?.elapsed ?? 0;
  }

  private isPaused(titleSlug: string): boolean {
    const manual = this.manualPause.get(titleSlug);
    if (manual !== undefined) return manual;
    return this.getState()[titleSlug]?.paused ?? false;
  }

  private async setElapsed(titleSlug: string, elapsed: number, paused?: boolean): Promise<void> {
    const state = this.getState();
    const entry = state[titleSlug] ?? { elapsed: 0, paused: false };
    entry.elapsed = elapsed;
    if (paused !== undefined) entry.paused = paused;
    state[titleSlug] = entry;
    await this.saveState(state);
  }

  private async setPaused(titleSlug: string, paused: boolean): Promise<void> {
    this.manualPause.set(titleSlug, paused);
    const state = this.getState();
    const entry = state[titleSlug] ?? { elapsed: this.getElapsed(titleSlug), paused: false };
    entry.paused = paused;
    state[titleSlug] = entry;
    await this.saveState(state);
  }

  private updateStatusBar(titleSlug: string | null, elapsed: number, isActive: boolean): void {
    if (!this.shouldShow()) {
      this.statusBarItem.hide();
      return;
    }
    if (this.panels.size === 0) {
      this.statusBarItem.hide();
      return;
    }
    const displaySlug = titleSlug ?? this.lastActiveTitleSlug;
    const reg = displaySlug ? this.panels.get(displaySlug) : null;
    const problemTitle = reg?.problemTitle ?? "—";
    const paused = titleSlug ? this.isPaused(titleSlug) : true;
    const displayElapsed = displaySlug ? this.getElapsed(displaySlug) : 0;
    this.statusBarItem.text = `$(watch) ${paused && !isActive && displayElapsed === 0 ? "—" : formatTime(displayElapsed)}`;
    this.statusBarItem.tooltip = `Problem: ${problemTitle} • ${formatTime(displayElapsed)} elapsed${paused ? " (paused)" : ""}`;
    this.statusBarItem.color = colorForElapsed(displayElapsed);
    this.statusBarItem.show();
  }

  private postToWebview(titleSlug: string, elapsed: number, paused: boolean, isActive: boolean): void {
    const reg = this.panels.get(titleSlug);
    if (!reg?.panel.webview) return;
    reg.panel.webview.postMessage({
      event: "timerUpdate",
      elapsed,
      paused,
      isActive,
    });
  }

  private broadcastToAllPanels(activeSlug: string | null): void {
    for (const [slug, reg] of this.panels) {
      const elapsed = this.getElapsed(slug);
      const paused = this.isPaused(slug);
      const isActive = slug === activeSlug && !paused;
      this.postToWebview(slug, elapsed, paused, isActive);
    }
  }

  private startTick(): void {
    if (this.tickInterval) return;
    this.tickInterval = setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  private stopTick(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  private tick(): void {
    const slug = this.activeTitleSlug;
    if (!slug || this.isPaused(slug)) return;
    const elapsed = this.getElapsed(slug) + 1;
    void this.setElapsed(slug, elapsed);
    void this.addTickToToday(slug);
    this.updateStatusBar(slug, elapsed, true);
    this.postToWebview(slug, elapsed, false, true);
  }

  private async addTickToToday(titleSlug: string): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const byDay = this.context.globalState.get<TimerByDay>(TIMER_BY_DAY_KEY) ?? {};
    const day = byDay[today] ?? {};
    day[titleSlug] = (day[titleSlug] ?? 0) + 1;
    byDay[today] = day;
    await this.context.globalState.update(TIMER_BY_DAY_KEY, byDay);
  }

  private setActive(titleSlug: string | null): void {
    if (this.activeTitleSlug === titleSlug) return;
    const wasActive = this.activeTitleSlug;
    if (wasActive) this.lastActiveTitleSlug = wasActive;
    this.activeTitleSlug = titleSlug;
    if (wasActive) {
      this.stopTick();
      this.broadcastToAllPanels(null);
    }
    if (titleSlug && !this.isPaused(titleSlug) && this.windowFocused) {
      this.startTick();
      this.updateStatusBar(titleSlug, this.getElapsed(titleSlug), true);
      this.broadcastToAllPanels(titleSlug);
    } else if (titleSlug) {
      this.updateStatusBar(titleSlug, this.getElapsed(titleSlug), false);
      this.postToWebview(titleSlug, this.getElapsed(titleSlug), true, false);
    } else {
      const displaySlug = this.lastActiveTitleSlug;
      const elapsed = displaySlug ? this.getElapsed(displaySlug) : 0;
      this.updateStatusBar(null, elapsed, false);
    }
  }

  private onViewStateChange(titleSlug: string): void {
    const reg = this.panels.get(titleSlug);
    if (!reg) return;
    if (reg.panel.active && reg.panel.visible) {
      this.setActive(titleSlug);
    } else if (this.activeTitleSlug === titleSlug) {
      this.recomputeActive();
    }
  }

  registerPanel(titleSlug: string, panel: vscode.WebviewPanel, problemTitle: string, solved?: boolean): void {
    this.panels.set(titleSlug, { panel, problemTitle });
    if (solved) {
      void this.setPaused(titleSlug, true);
    }
    const sub = panel.onDidChangeViewState(() => this.onViewStateChange(titleSlug));
    this.subscriptions.push(sub);
    const elapsed = this.getElapsed(titleSlug);
    const paused = this.isPaused(titleSlug);
    this.postToWebview(titleSlug, elapsed, paused, false);
    this.recomputeActive();
    this.updateStatusBar(this.activeTitleSlug, this.activeTitleSlug ? this.getElapsed(this.activeTitleSlug) : 0, !!this.activeTitleSlug && !this.isPaused(this.activeTitleSlug));
  }

  unregisterPanel(titleSlug: string): void {
    this.manualPause.delete(titleSlug);
    this.panels.delete(titleSlug);
    if (this.activeTitleSlug === titleSlug) {
      this.setActive(null);
      for (const [slug, r] of this.panels) {
        if (r.panel.active && r.panel.visible) {
          this.setActive(slug);
          break;
        }
      }
    }
    if (this.panels.size === 0) {
      this.statusBarItem.hide();
    }
  }

  sendInitialState(titleSlug: string): void {
    const elapsed = this.getElapsed(titleSlug);
    const paused = this.isPaused(titleSlug);
    const isActive = this.activeTitleSlug === titleSlug && !paused;
    this.postToWebview(titleSlug, elapsed, paused, isActive);
  }

  handleRestart(titleSlug: string): void {
    void this.setElapsed(titleSlug, 0, false);
    this.manualPause.delete(titleSlug);
    const isActive = this.activeTitleSlug === titleSlug;
    this.updateStatusBar(titleSlug, 0, isActive);
    this.broadcastToAllPanels(isActive ? titleSlug : null);
    if (isActive) this.startTick();
  }

  handlePause(titleSlug: string): void {
    void this.setPaused(titleSlug, true);
    const isActive = this.activeTitleSlug === titleSlug;
    if (isActive) this.stopTick();
    this.updateStatusBar(titleSlug, this.getElapsed(titleSlug), false);
    this.broadcastToAllPanels(isActive ? null : this.activeTitleSlug);
  }

  handleResume(titleSlug: string): void {
    void this.setPaused(titleSlug, false);
    const isActive = this.activeTitleSlug === titleSlug;
    if (isActive) this.startTick();
    this.updateStatusBar(titleSlug, this.getElapsed(titleSlug), isActive);
    this.broadcastToAllPanels(isActive ? titleSlug : this.activeTitleSlug);
  }

  dispose(): void {
    this.stopTick();
    if (this.focusCheckInterval) {
      clearInterval(this.focusCheckInterval);
      this.focusCheckInterval = null;
    }
    for (const sub of this.subscriptions) sub.dispose();
    this.subscriptions.length = 0;
    this.panels.clear();
    this.statusBarItem.hide();
  }
}
