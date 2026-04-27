import type { SupportedLanguage } from "../interface/Problem";
import type { LoopNode } from "./IR";

/**
 * Detect amortized-O(n) patterns formed by nested or sibling loops.
 *
 * When a pattern is recognized, we tag the inner loop with `amortizedTag`
 * and rewrite its bound to {kind: "amortized", reason}. The Engine then
 * does NOT multiply this loop's cost into the outer loop's depth.
 *
 * Patterns covered:
 *   - two-pointer:        `while l < r: ... l += 1 ... r -= 1`
 *   - sliding window:     for-loop with inner while where one pointer
 *                         monotonically advances toward the outer index
 *   - monotonic stack:    for-loop with inner `while stack and ...: stack.pop()`
 *
 * This module mutates the LoopNodes' `bound`/`amortizedTag` in place.
 */
export function applyAmortizedPatterns(
  topLoops: LoopNode[],
  lang: SupportedLanguage,
): void {
  for (const loop of topLoops) {
    detectInLoop(loop, lang);
  }
}

function detectInLoop(loop: LoopNode, lang: SupportedLanguage): void {
  // Two-pointer at this loop level: a single `while l < r` with both pointers moving toward each other in the body.
  if (loop.kind === "while" && isTwoPointerHeader(loop.headerText) && isTwoPointerBody(loop.bodyText, loop.headerText)) {
    loop.bound = { kind: "amortized", size: undefined, reason: "two-pointer" };
    loop.amortizedTag = "two-pointer";
    // do not recurse into nested loops — they're conceptually within the amortized envelope
    return;
  }

  // Sliding window: a for-loop containing an inner while-loop that advances a window-start pointer monotonically
  if (loop.kind === "for" && loop.loops.length > 0) {
    for (const inner of loop.loops) {
      if (
        inner.kind === "while"
        && isSlidingWindowInner(inner, loop)
      ) {
        inner.bound = { kind: "amortized", size: undefined, reason: "sliding-window" };
        inner.amortizedTag = "sliding-window";
        loop.amortizedTag = loop.amortizedTag ?? "sliding-window-outer";
        continue;
      }
      if (
        inner.kind === "while"
        && isMonotonicStackInner(inner)
      ) {
        inner.bound = { kind: "amortized", size: undefined, reason: "monotonic-stack" };
        inner.amortizedTag = "monotonic-stack";
        loop.amortizedTag = loop.amortizedTag ?? "monotonic-stack-outer";
        continue;
      }
      // recurse for deeper nests
      detectInLoop(inner, lang);
    }
    return;
  }

  // Recurse for non-amortized while loops
  for (const inner of loop.loops) {
    detectInLoop(inner, lang);
  }
}

function isTwoPointerHeader(header: string): boolean {
  // Accept: `l < r`, `left < right`, `lo < hi`, `i < j`, `i <= j`
  return /^\s*([A-Za-z_$][\w$]*)\s*<=?\s*([A-Za-z_$][\w$]*)\s*$/.test(header.trim());
}

function isTwoPointerBody(body: string, header: string): boolean {
  const m = /^\s*([A-Za-z_$][\w$]*)\s*<=?\s*([A-Za-z_$][\w$]*)\s*$/.exec(header.trim());
  if (!m) return false;
  const left = m[1];
  const right = m[2];
  // both pointers advance: left += 1 or left++ AND right -= 1 or right--
  const leftMoves = new RegExp(`\\b${escape(left)}\\s*(?:\\+=\\s*[0-9]+|\\+\\+|=\\s*${escape(left)}\\s*\\+\\s*[0-9]+)`).test(body);
  const rightMoves = new RegExp(`\\b${escape(right)}\\s*(?:-=\\s*[0-9]+|--|=\\s*${escape(right)}\\s*-\\s*[0-9]+)`).test(body);
  return leftMoves && rightMoves;
}

function isSlidingWindowInner(inner: LoopNode, outer: LoopNode): boolean {
  // The inner while moves a "window-left" pointer forward (l += 1, l++)
  // AND its loop variable does NOT cross the outer loop iteration variable backwards.
  const body = inner.bodyText;
  if (!/\b([A-Za-z_$][\w$]*)\s*(?:\+=\s*[0-9]+|\+\+|=\s*\1\s*\+\s*[0-9]+)/.test(body)) {
    return false;
  }
  // Heuristic: we expect the inner header to compare the moving pointer to the outer index, or to a condition derived from it.
  // Common shapes:
  //   while window_count[c] > k: l += 1
  //   while seen[s[r]] >= 1: l += 1; seen[s[l]] -= 1
  //   while sum > target: sum -= nums[l]; l += 1
  // The defining property is that the inner pointer is bounded above by the outer pointer's monotonic progress.
  // We detect this structurally by:
  //   - inner.kind === "while"
  //   - inner body advances a pointer forward
  //   - the inner loop is INSIDE the outer for-loop body (already implied)
  //   - the pointer being advanced is not declared inside the inner loop
  // Without scope analysis we accept the pattern when the inner advances a single named pointer
  // (commonly `l`, `left`, `lo`, `start`, `j`).
  return /\b(l|left|lo|low|start|j|i)\s*(?:\+=\s*[0-9]+|\+\+|=\s*(?:l|left|lo|low|start|j|i)\s*\+\s*[0-9]+)/.test(body);
}

function isMonotonicStackInner(inner: LoopNode): boolean {
  const body = inner.bodyText;
  const header = inner.headerText;
  // Header references a stack-like name AND body pops from it.
  const stackName = /(\b[A-Za-z_$][\w$]*\b)\s*(?:\.length|\.size\(\)|\b)\s*(?:&&|and)/.exec(header)?.[1]
    ?? /\b([A-Za-z_$][\w$]*)\s*\[\s*-?\s*1\s*\]/.exec(header)?.[1]
    ?? /\b([A-Za-z_$][\w$]*)\b/.exec(header)?.[1];
  if (!stackName) return false;
  if (!/^(stack|stk|st|monoStack|q|queue|deque|dq|window)$/i.test(stackName)) return false;
  return new RegExp(`\\b${escape(stackName)}\\.pop\\s*\\(`).test(body)
    || new RegExp(`\\b${escape(stackName)}\\.popleft\\s*\\(`).test(body);
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
