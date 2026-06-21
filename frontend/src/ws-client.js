export function connectListen({ onUtterance, onSpeak }) {
  const ws = new WebSocket(`ws://${location.host}/expressive/listen`);
  ws.binaryType = "arraybuffer";
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "utterance") onUtterance(msg);
    else if (msg.type === "speak") onSpeak(msg);
  };
  return {
    sendFrame: (int16) => { if (ws.readyState === 1) ws.send(int16.buffer); },
    mute: () => ws.readyState === 1 && ws.send(JSON.stringify({ type: "mute" })),
    unmute: () => ws.readyState === 1 && ws.send(JSON.stringify({ type: "unmute" })),
    // Selecting reports her choice; the backend speaks it and releases the next set.
    select: (interactionId, optionId) => ws.readyState === 1 && ws.send(
      JSON.stringify({ type: "select", interaction_id: interactionId, option_id: optionId })),
  };
}
