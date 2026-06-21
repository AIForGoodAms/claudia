export class EchoGate {
  constructor({ guardMs, now = () => Date.now() }) {
    this._guardMs = guardMs;
    this._now = now;
    this._speaking = false;
    this._unmuteAt = 0;
  }
  startSpeaking() { this._speaking = true; }
  stopSpeaking() { this._speaking = false; this._unmuteAt = this._now() + this._guardMs; }
  isMuted() { return this._speaking || this._now() < this._unmuteAt; }
}
