import { connectListen } from "./ws-client.js";
import { startCapture } from "./audio-capture.js";
import { createSpeaker } from "./tts.js";
import { DwellSelector } from "./selection-input.js";

const grid = document.getElementById("options");
let currentInteraction = null;

let ws;
const speaker = createSpeaker({
  guardMs: 300,
  onMuteChange: (muted) => (muted ? ws.mute() : ws.unmute()),
});
ws = connectListen({
  onUtterance: renderOptions,
  onSpeak: (message) => speaker.speak(message.text, message.lang),
});
const selector = new DwellSelector({ dwellMs: 800, onSelect: choose });
setInterval(() => selector.tick(), 100);

startCapture({ onFrame: ws.sendFrame, isMuted: speaker.isMuted });

function renderOptions(message) {
  currentInteraction = message.interaction_id;
  grid.innerHTML = "";
  for (const option of message.options) {
    const row = document.createElement("button");
    row.className = "option";
    row.dataset.optionId = option.option_id;
    row.onmouseenter = () => selector.enter(String(option.option_id));
    row.onmouseleave = () => selector.leave();
    row.onclick = () => choose(String(option.option_id));
    for (const symbol of option.symbols) {
      const card = document.createElement("span");
      card.className = "card";
      card.innerHTML = symbol.as_text
        ? `<span class="text">${symbol.label}</span>`
        : `<img alt="${symbol.label}" src="${symbol.image_url}"><span>${symbol.label}</span>`;
      row.appendChild(card);
    }
    grid.appendChild(row);
  }
}

// Selecting reports her choice over the WS; the backend speaks it back (handled
// by onSpeak) and releases the next queued option-set. Clear the grid meanwhile.
function choose(optionId) {
  if (currentInteraction === null) return;
  grid.innerHTML = "";
  ws.select(currentInteraction, Number(optionId));
  currentInteraction = null;
}
