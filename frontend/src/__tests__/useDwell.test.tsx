import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useDwell } from '../hooks/useDwell';
import { SettingsProvider } from '../context/SettingsContext';

const wrapper = ({ children }: { children: ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
);

describe('useDwell', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('fires onSelect once after dwellMs elapses', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useDwell({ onSelect, dwellMs: 2000 }), { wrapper });

    act(() => result.current.handlers.onPointerEnter());
    expect(onSelect).not.toHaveBeenCalled();
    expect(result.current.isDwelling).toBe(true);

    act(() => vi.advanceTimersByTime(1999));
    expect(onSelect).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onSelect).toHaveBeenCalledTimes(1);
    // Progress resets after firing.
    expect(result.current.isDwelling).toBe(false);
  });

  it('cancels on pointer leave before completion', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useDwell({ onSelect, dwellMs: 2000 }), { wrapper });

    act(() => result.current.handlers.onPointerEnter());
    act(() => vi.advanceTimersByTime(1000));
    act(() => result.current.handlers.onPointerLeave());

    expect(result.current.isDwelling).toBe(false);
    expect(result.current.progress).toBe(0);

    act(() => vi.advanceTimersByTime(5000));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('fires immediately on click (dev/touch convenience)', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useDwell({ onSelect, dwellMs: 2000 }), { wrapper });

    act(() => result.current.handlers.onClick());
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(
      () => useDwell({ onSelect, dwellMs: 2000, disabled: true }),
      { wrapper },
    );

    act(() => result.current.handlers.onPointerEnter());
    act(() => vi.advanceTimersByTime(5000));
    act(() => result.current.handlers.onClick());
    expect(onSelect).not.toHaveBeenCalled();
  });
});
