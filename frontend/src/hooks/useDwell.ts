import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettings } from '../context/SettingsContext';

export interface DwellHandlers {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onClick: () => void;
}

export interface UseDwellResult {
  /** 0 → 1 fill of the current dwell; 0 when idle. */
  progress: number;
  /** True while a dwell is in flight (progress is being driven). */
  isDwelling: boolean;
  handlers: DwellHandlers;
}

export interface UseDwellOptions {
  onSelect: () => void;
  /** Override the global settings dwell duration (mostly for tests/demos). */
  dwellMs?: number;
  /** Disable dwell + click entirely. */
  disabled?: boolean;
}

/**
 * Dwell-to-select primitive — the selection-input abstraction.
 *
 * Lifecycle: enter/focus starts a timer for `dwellMs`, driving a 0→1 `progress`
 * value via requestAnimationFrame for the sonar loader; leave/blur cancels and
 * resets; on completion `onSelect()` fires exactly once. `click` fires
 * immediately (dev/touch convenience). A future eye-tracker driver feeds the
 * same enter/leave/complete lifecycle, so screens never depend on the input.
 */
export function useDwell({ onSelect, dwellMs, disabled }: UseDwellOptions): UseDwellResult {
  const { dwellMs: settingsDwellMs } = useSettings();
  const duration = dwellMs ?? settingsDwellMs;

  const [progress, setProgress] = useState(0);
  const [isDwelling, setIsDwelling] = useState(false);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const firedRef = useRef(false);

  // Keep the latest onSelect without restarting an in-flight dwell.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const cancel = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setIsDwelling(false);
    setProgress(0);
  }, []);

  const tick = useCallback(() => {
    const elapsed = Date.now() - startRef.current;
    const next = Math.min(1, elapsed / duration);
    setProgress(next);
    if (next < 1) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [duration]);

  const start = useCallback(() => {
    if (disabled) return;
    // Restart cleanly if a stale dwell is somehow still around.
    if (timeoutRef.current !== null || rafRef.current !== null) cancel();

    firedRef.current = false;
    startRef.current = Date.now();
    setIsDwelling(true);
    setProgress(0);

    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      if (firedRef.current) return;
      firedRef.current = true;
      cancel();
      onSelectRef.current();
    }, duration);

    rafRef.current = requestAnimationFrame(tick);
  }, [disabled, duration, cancel, tick]);

  const fireNow = useCallback(() => {
    if (disabled) return;
    if (firedRef.current) return;
    firedRef.current = true;
    cancel();
    onSelectRef.current();
  }, [disabled, cancel]);

  // Release timers if the tile unmounts mid-dwell.
  useEffect(() => cancel, [cancel]);

  return {
    progress,
    isDwelling,
    handlers: {
      onPointerEnter: start,
      onPointerLeave: cancel,
      onFocus: start,
      onBlur: cancel,
      onClick: fireNow,
    },
  };
}
