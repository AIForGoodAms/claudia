import { downsampleTo16k } from "./downsample.js";

export async function startCapture({ onFrame, isMuted }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, channelCount: 1 },
  });
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule("/src/pcm-worklet.js");
  const source = ctx.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(ctx, "pcm-worklet");
  worklet.port.onmessage = (event) => {
    if (isMuted()) return;                       // echo guard: do not stream while speaking
    onFrame(downsampleTo16k(event.data, ctx.sampleRate));
  };
  source.connect(worklet);
  return ctx;
}
