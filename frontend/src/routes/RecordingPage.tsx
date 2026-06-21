import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import { startCapture, type AudioCapture } from '../services/audio';
import { speak } from '../services/speech';
import { createRecordingTransport } from '../services/transport';
import type { OptionDTO, RecordingTransport } from '../services/transport/types';
import SuggestionTile from '../components/SuggestionTile';
import DwellTile from '../components/DwellTile';
import './page.css';

/** Echo-guard tail (ms) before resuming the mic after TTS ends (contract: ~300). */
const ECHO_GUARD_MS = 300;

/** An option plus the interaction it belongs to (needed for the select call). */
interface OptionEntry {
  option: OptionDTO;
  interactionId: number;
}

/**
 * Record → suggestions page.
 *
 * On mount it opens the mic and the recording transport (mock by default, real
 * WebSocket via env). Suggestions stream in as the transport emits contract
 * `utterance` batches; captured PCM16 frames are forwarded to the transport.
 * Dwelling a tile runs the select round-trip (`POST /expressive/select`),
 * speaks the returned reply, and mutes the mic during playback so the spoken
 * reply is not transcribed back as a new turn (echo guard). Stop and Back both
 * end recording and return home; unmount cleans up too.
 */
export default function RecordingPage() {
  const navigate = useNavigate();
  const { lang } = useSettings();
  const [entries, setEntries] = useState<OptionEntry[]>([]);
  const [recording, setRecording] = useState(true);
  // option_id of the last pronounced tile — kept highlighted until the next pick.
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const transportRef = useRef<RecordingTransport | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const endedRef = useRef(false);

  // The backend returns the full icon set each batch, so replace all tiles at
  // once rather than appending — the newest batch is the complete board.
  const replaceOptions = useCallback((interactionId: number, incoming: OptionDTO[]) => {
    setEntries(incoming.map((option) => ({ option, interactionId })));
  }, []);

  // Pause/resume recording in place — does NOT navigate away. Pausing mutes the
  // mic + transport (no new tiles), resuming unmutes; the latest tiles stay on
  // screen either way.
  const toggleRecording = useCallback(() => {
    setRecording((on) => {
      if (on) {
        captureRef.current?.mute();
        transportRef.current?.mute();
      } else {
        captureRef.current?.unmute();
        transportRef.current?.unmute();
      }
      return !on;
    });
  }, []);

  const endSession = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    captureRef.current?.stop();
    captureRef.current = null;
    void transportRef.current?.stop();
    transportRef.current = null;
  }, []);

  // Select round-trip + echo guard: mute mic + transport, speak the returned
  // reply, then resume the mic after a short guard tail once playback ends.
  const handleSelect = useCallback(async (interactionId: number, optionId: number) => {
    const transport = transportRef.current;
    if (!transport) return;
    // Highlight the pronounced tile; it stays lit until the next one is chosen.
    setSelectedId(optionId);
    transport.mute();
    captureRef.current?.mute();
    try {
      const { text, lang: replyLang } = await transport.selectOption(interactionId, optionId);
      if (text) await speak(text, replyLang);
    } catch (e) {
      console.warn('[transport] select failed', e);
    } finally {
      window.setTimeout(() => {
        captureRef.current?.unmute();
        transportRef.current?.unmute();
      }, ECHO_GUARD_MS);
    }
  }, []);

  useEffect(() => {
    endedRef.current = false;

    const transport = createRecordingTransport();
    transportRef.current = transport;
    transport.onOptions((r) => replaceOptions(r.interaction_id, r.options));
    transport.onError((e) => console.warn('[transport]', e.message));

    void transport.start({ lang });

    captureRef.current = startCapture({
      onFrame: (frame) => transportRef.current?.sendFrame(frame),
      onError: (e) => console.warn('[audio]', e.message),
    });

    // Spacebar requests the next batch of options — suggestions never rotate
    // on their own, only when the user asks for a fresh chunk.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        transportRef.current?.requestNext();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    // Release the mic + abort the transport if we leave mid-recording.
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      endSession();
    };
  }, [lang, replaceOptions, endSession]);

  const goHome = () => {
    endSession();
    navigate('/');
  };

  return (
    <main className="page page--record">
      {/* Main area: the grid of suggestion tiles the backend returns fills it. */}
      <div className="record__main">
        <div className="record__grid">
          {entries.map(({ option, interactionId }) => (
            <SuggestionTile
              key={option.option_id}
              option={option}
              interactionId={interactionId}
              onSelect={handleSelect}
              selected={option.option_id === selectedId}
            />
          ))}
        </div>
      </div>

      {/* Right sidebar: the record toggle + back, then the listening loader. */}
      <aside className="record__sidebar">
        <DwellTile
          label={recording ? 'Pauze' : 'Opnemen'}
          color={recording ? 'var(--record-color)' : 'var(--tile-green)'}
          onSelect={toggleRecording}
          className="record__control"
        >
          <span className="record__control-glyph" aria-hidden="true">
            {recording ? '⏸' : '●'}
          </span>
        </DwellTile>
        <DwellTile
          label="Terug"
          color="var(--tile-darkblue)"
          onSelect={goHome}
          className="record__control"
        >
          <span className="record__control-glyph" aria-hidden="true">
            ←
          </span>
        </DwellTile>
        {recording && (
          <div className="record__loader" aria-label="Listening" role="status">
            <span className="record__loader-dot" />
            <span className="record__loader-dot" />
            <span className="record__loader-dot" />
          </div>
        )}
      </aside>
    </main>
  );
}
