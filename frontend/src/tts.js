import { EchoGate } from "./echo-gate.js";

export function createSpeaker({ guardMs, onMuteChange }) {
  const gate = new EchoGate({ guardMs });
  function emit() { onMuteChange(gate.isMuted()); }
  return {
    isMuted: () => gate.isMuted(),
    speak(text, lang) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === "nl" ? "nl-NL" : "en-US";
      u.onstart = () => { gate.startSpeaking(); emit(); };
      u.onend = () => { gate.stopSpeaking(); emit(); setTimeout(emit, guardMs + 20); };
      window.speechSynthesis.speak(u);
    },
  };
}
