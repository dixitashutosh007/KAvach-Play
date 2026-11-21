"use client";

/**
 * Browser pull-to-refresh for the primary (document) scroll area
 * (`hooks/usePullToRefresh.ts`). No dependencies.
 *
 * Starts only when:
 *  - the device uses a coarse pointer (touch) and the hook is enabled;
 *  - the page is scrolled to the very top;
 *  - no modal dialog is open;
 *  - the touch did not begin on a form control, slider, crop frame or any
 *    element opted out with [data-no-pull-refresh];
 *  - no scrollable ancestor of the touch target is itself scrolled down;
 *  - the gesture is predominantly vertical and downward (horizontal swipes such
 *    as the banner carousel are ignored).
 * A refresh in flight blocks new ones. While enabled, the browser's own
 * reload-on-overscroll is disabled so the two never both fire.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type PullStatus = "idle" | "pulling" | "ready" | "refreshing" | "done" | "error";

export const PULL_THRESHOLD_PX = 72;
const MAX_PULL_PX = 110;
const RESISTANCE = 0.5;
const MIN_SPINNER_MS = 600;
const RESULT_VISIBLE_MS = 1200;

const BLOCKING_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [role="slider"], [role="application"], [data-no-pull-refresh]';

export function isPullBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(BLOCKING_SELECTOR)) return true;
  // A scrollable ancestor that is not at its own top keeps the gesture.
  let el: Element | null = target;
  while (el && el !== document.body && el !== document.documentElement) {
    const style = window.getComputedStyle(el);
    const scrollsY = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
    if (scrollsY && el.scrollTop > 0) return true;
    el = el.parentElement;
  }
  return false;
}

export function usePullToRefresh({
  enabled,
  onRefresh,
}: {
  enabled: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [status, setStatus] = useState<PullStatus>("idle");
  const [distance, setDistance] = useState(0);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const decidedRef = useRef<"vertical" | "cancelled" | null>(null);
  const distanceRef = useRef(0);
  const busyRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const reset = useCallback(() => {
    startRef.current = null;
    decidedRef.current = null;
    distanceRef.current = 0;
    setDistance(0);
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    if (!coarse) return;

    const root = document.documentElement;
    const previousOverscroll = root.style.overscrollBehaviorY;
    root.style.overscrollBehaviorY = "contain";

    const atTop = () => (document.scrollingElement?.scrollTop ?? window.scrollY) <= 0;

    const onTouchStart = (e: TouchEvent) => {
      if (busyRef.current || e.touches.length !== 1 || !atTop()) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (isPullBlockedTarget(e.target)) return;
      const t = e.touches[0];
      startRef.current = { x: t.clientX, y: t.clientY };
      decidedRef.current = null;
    };

    const onTouchMove = (e: TouchEvent) => {
      const start = startRef.current;
      if (!start || decidedRef.current === "cancelled") return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (decidedRef.current === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || !atTop()) {
          decidedRef.current = "cancelled";
          return;
        }
        decidedRef.current = "vertical";
      }
      const pulled = Math.min(MAX_PULL_PX, Math.max(0, dy * RESISTANCE));
      distanceRef.current = pulled;
      setDistance(pulled);
      setStatus(pulled >= PULL_THRESHOLD_PX ? "ready" : "pulling");
    };

    const onTouchEnd = async () => {
      const pulled = distanceRef.current;
      const wasVertical = decidedRef.current === "vertical";
      reset();
      if (!wasVertical || pulled < PULL_THRESHOLD_PX || busyRef.current) {
        setStatus("idle");
        return;
      }
      busyRef.current = true;
      setStatus("refreshing");
      const started = Date.now();
      let ok = true;
      try {
        await onRefreshRef.current();
      } catch {
        ok = false;
      }
      const elapsed = Date.now() - started;
      if (elapsed < MIN_SPINNER_MS) await new Promise((r) => setTimeout(r, MIN_SPINNER_MS - elapsed));
      setStatus(ok ? "done" : "error");
      setTimeout(() => {
        busyRef.current = false;
        setStatus("idle");
      }, RESULT_VISIBLE_MS);
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("touchcancel", reset);
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", reset);
      root.style.overscrollBehaviorY = previousOverscroll;
    };
  }, [enabled, reset]);

  return { status, distance };
}
