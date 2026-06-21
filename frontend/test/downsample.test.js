import { describe, it, expect } from "vitest";
import { downsampleTo16k } from "../src/downsample.js";

describe("downsampleTo16k", () => {
  it("halves a 32 kHz buffer to 16 kHz", () => {
    const out = downsampleTo16k(new Float32Array(32000).fill(1.0), 32000);
    expect(out.length).toBe(16000);
    expect(out[0]).toBe(32767);
  });
  it("passes 16 kHz through unchanged in length", () => {
    expect(downsampleTo16k(new Float32Array(1600), 16000).length).toBe(1600);
  });
});
