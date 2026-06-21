import { describe, it, expect, vi } from "vitest";
import { DwellSelector } from "../src/selection-input.js";

describe("DwellSelector", () => {
  it("selects after dwelling long enough on one target", () => {
    let t = 0;
    const onSelect = vi.fn();
    const sel = new DwellSelector({ dwellMs: 500, onSelect, now: () => t });
    sel.enter("opt-1");
    t = 300; sel.tick(); expect(onSelect).not.toHaveBeenCalled();
    t = 600; sel.tick(); expect(onSelect).toHaveBeenCalledWith("opt-1");
  });
  it("resets the timer when gaze leaves", () => {
    let t = 0;
    const onSelect = vi.fn();
    const sel = new DwellSelector({ dwellMs: 500, onSelect, now: () => t });
    sel.enter("opt-1"); t = 300; sel.leave();
    sel.enter("opt-2"); t = 800; sel.tick();
    expect(onSelect).toHaveBeenCalledWith("opt-2");
  });
});
