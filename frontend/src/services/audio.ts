import { downsampleTo16k, FRAME_SAMPLES } from './downsample';

/**
 * Microphone capture as PCM16 frames.
 *
 * `startCapture()` opens the mic via `getUserMedia` and a Web Audio graph, then
 * streams 16 kHz / mono / PCM16 frames (320 samples · 640 bytes — the format
 * the backend WS requires, api-contract.md) to `onFrame`. The mock transport
 * ignores frames; the real `WebSocketRecordingTransport` forwards them upstream.
 *
 * `stop()` halts processing and releases the mic tracks so the browser's
 * recording indicator goes away. `mute()/unmute()` gate frame emission during
 * TTS playback (echo guard) without tearing the graph down. Capture degrades
 * gracefully: if the mic is unavailable or permission is denied, `onError`
 * fires and the recording page still shows its suggestions.
 */

export interface AudioCapture {
  /** Stop recording and release the microphone. Safe to call more than once. */
  stop: () => void;
  /** Pause frame emission (during TTS playback). */
  mute: () => void;
  /** Resume frame emission. */
  unmute: () => void;
}

export interface StartCaptureOptions {
  /** Receives raw PCM16 frames (`Int16Array.buffer`, 640 bytes) as captured. */
  onFrame?: (frame: ArrayBuffer) => void;
  /** Receives setup/permission errors (mic denied, unsupported browser). */
  onError?: (err: Error) => void;
}

interface AudioWindow {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as AudioWindow;
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function hasMediaSupport(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    getAudioContextCtor() !== null
  );
}

/**
 * Begin capturing microphone audio as PCM16 frames. Returns immediately with a
 * handle whose `stop()` releases the mic; the underlying `getUserMedia` prompt
 * resolves asynchronously, after which frames start flowing to `onFrame`.
 */
export function startCapture({ onFrame, onError }: StartCaptureOptions = {}): AudioCapture {
  const AudioCtx = getAudioContextCtor();
  if (!hasMediaSupport() || !AudioCtx) {
    // getUserMedia needs a secure context: it's undefined over http on a non-
    // localhost host (e.g. the tablet at http://192.168.x.x). Serve over https
    // or localhost. We can't tell that apart from a truly old browser, so name
    // both causes.
    const err = new Error(
      'Microphone capture unavailable — needs a secure context (https or localhost) and a supporting browser.',
    );
    console.warn('[audio]', err.message);
    onError?.(err);
    return { stop: () => {}, mute: () => {}, unmute: () => {} };
  }

  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let stopped = false;
  let muted = false;

  // Carry leftover samples between callbacks so we emit fixed-size frames.
  let pending: number[] = [];

  const release = () => {
    try {
      processor?.disconnect();
      source?.disconnect();
    } catch {
      // Already disconnected.
    }
    processor = null;
    source = null;
    if (context && context.state !== 'closed') void context.close();
    context = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  };

  const stop = () => {
    stopped = true;
    release();
  };

  const handleAudio = (event: AudioProcessingEvent) => {
    if (stopped || muted || !onFrame || !context) return;
    const channel = event.inputBuffer.getChannelData(0);
    const frame16k = downsampleTo16k(channel, context.sampleRate);
    for (let i = 0; i < frame16k.length; i++) pending.push(frame16k[i]);

    while (pending.length >= FRAME_SAMPLES) {
      const slice = pending.slice(0, FRAME_SAMPLES);
      pending = pending.slice(FRAME_SAMPLES);
      onFrame(Int16Array.from(slice).buffer);
    }
  };

  navigator.mediaDevices
    .getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
    .then((mediaStream) => {
      stream = mediaStream;
      if (stopped) {
        release();
        return;
      }
      context = new AudioCtx();
      source = context.createMediaStreamSource(mediaStream);
      // ScriptProcessor is deprecated but universally available and adequate for
      // a 16 kHz mono uplink; swap for an AudioWorklet if latency demands it.
      processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = handleAudio;
      source.connect(processor);
      processor.connect(context.destination);
      // Autoplay policy can start the context suspended, which never fires
      // onaudioprocess — so no frames reach the backend. resume() is a no-op
      // when already running.
      void context.resume();
    })
    .catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      console.warn('[audio] microphone unavailable:', error.message);
      onError?.(error);
    });

  return {
    stop,
    mute: () => {
      muted = true;
      pending = [];
    },
    unmute: () => {
      muted = false;
    },
  };
}
