export function downsampleTo16k(float32, inputRate) {
  const ratio = inputRate / 16000;
  const outLength = Math.round(float32.length / ratio);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[Math.floor(i * ratio)]));
    out[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
  }
  return out;
}
