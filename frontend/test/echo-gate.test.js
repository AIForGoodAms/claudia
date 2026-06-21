import { describe, it, expect } from "vitest";
import { EchoGate } from "../src/echo-gate.js";

describe("EchoGate", () => {
  it("mutes while speaking and for the guard tail after", () => {
    let t = 0;
    const gate = new EchoGate({ guardMs: 300, now: () => t });
    expect(gate.isMuted()).toBe(false);
    gate.startSpeaking();
    expect(gate.isMuted()).toBe(true);
    gate.stopSpeaking();
    t = 200; expect(gate.isMuted()).toBe(true);
    t = 350; expect(gate.isMuted()).toBe(false);
  });
});
