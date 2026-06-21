/**
 * Resample mono Float32 PCM to 16 kHz Int16 — the format the backend WS expects
 * (api-contract.md: "16 kHz, mono, PCM16"). Browsers capture at the hardware
 * rate (typically 44.1/48 kHz), so we decimate with simple averaging and clamp
 * to the Int16 range.
 */
export function downsampleTo16k(input: Float32Array, inputRate: number): Int16Array {
  const targetRate = 16000;
  if (inputRate === targetRate) return floatToInt16(input);
  if (inputRate < targetRate) {
    // Upsampling isn't expected; just convert (backend tolerates the rate hint).
    return floatToInt16(input);
  }

  const ratio = inputRate / targetRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Int16Array(outLength);

  let outIndex = 0;
  let inIndex = 0;
  while (outIndex < outLength) {
    const nextIn = Math.floor((outIndex + 1) * ratio);
    // Average the source samples folding into this output sample (anti-alias).
    let sum = 0;
    let count = 0;
    for (let i = inIndex; i < nextIn && i < input.length; i++) {
      sum += input[i];
      count++;
    }
    const sample = count > 0 ? sum / count : input[inIndex] ?? 0;
    out[outIndex] = clampToInt16(sample);
    outIndex++;
    inIndex = nextIn;
  }
  return out;
}

function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = clampToInt16(input[i]);
  return out;
}

function clampToInt16(sample: number): number {
  const s = Math.max(-1, Math.min(1, sample));
  return s < 0 ? s * 0x8000 : s * 0x7fff;
}

/** Samples per WS frame (~20 ms at 16 kHz) → 320 samples / 640 bytes. */
export const FRAME_SAMPLES = 320;
