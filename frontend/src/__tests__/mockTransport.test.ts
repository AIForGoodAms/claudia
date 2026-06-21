import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockRecordingTransport } from '../services/transport/MockRecordingTransport';
import type { OptionsResponse } from '../services/transport/types';
import { STATIC_OPTIONS } from '../data/mockSuggestions';

/** Assert a payload matches the api-contract.md OptionsResponse shape. */
function expectValidResponse(r: OptionsResponse) {
  expect(typeof r.interaction_id).toBe('number');
  expect(Array.isArray(r.options)).toBe(true);
  expect(r.options.length).toBeGreaterThan(0);
  for (const opt of r.options) {
    expect(typeof opt.option_id).toBe('number');
    expect(typeof opt.text).toBe('string');
    expect(Array.isArray(opt.symbols)).toBe(true);
    for (const sym of opt.symbols) {
      expect(typeof sym.id).toBe('number');
      expect(typeof sym.label).toBe('string');
      // image_url is "/media/..." or null (null when as_text is true).
      expect(sym.image_url === null || typeof sym.image_url === 'string').toBe(true);
      expect(typeof sym.confidence).toBe('number');
      expect(typeof sym.as_text).toBe('boolean');
    }
  }
}

describe('MockRecordingTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('emits the static options synchronously on start()', async () => {
    const transport = new MockRecordingTransport();
    const received: OptionsResponse[] = [];
    transport.onOptions((r) => received.push(r));

    await transport.start({ lang: 'nl' });

    expect(received).toHaveLength(1);
    expect(received[0].options).toHaveLength(STATIC_OPTIONS.length);
    expectValidResponse(received[0]);

    await transport.stop();
  });

  it('emits a dynamic OptionsResponse only when requestNext() is called', async () => {
    const transport = new MockRecordingTransport();
    const received: OptionsResponse[] = [];
    transport.onOptions((r) => received.push(r));

    await transport.start({ lang: 'nl' });
    expect(received).toHaveLength(1); // static only — no auto rotation

    transport.requestNext();
    expect(received.length).toBeGreaterThanOrEqual(2);

    const dynamic = received[1];
    expectValidResponse(dynamic);
    // Distinct interaction id per emission.
    expect(dynamic.interaction_id).not.toBe(received[0].interaction_id);

    await transport.stop();
  });

  it('echoes the chosen option text + active lang from selectOption()', async () => {
    const transport = new MockRecordingTransport();
    const received: OptionsResponse[] = [];
    transport.onOptions((r) => received.push(r));

    await transport.start({ lang: 'nl' });
    const first = received[0].options[0];

    const reply = await transport.selectOption(received[0].interaction_id, first.option_id);
    expect(reply).toEqual({ text: first.text, lang: 'nl' });

    await transport.stop();
  });

  it('stops emitting after stop()', async () => {
    const transport = new MockRecordingTransport();
    const received: OptionsResponse[] = [];
    transport.onOptions((r) => received.push(r));

    await transport.start({ lang: 'nl' });
    await transport.stop();
    const countAtStop = received.length;

    // requestNext() must not emit once the session has stopped.
    transport.requestNext();
    expect(received).toHaveLength(countAtStop);
  });
});
