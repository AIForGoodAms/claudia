export class DwellSelector {
  constructor({ dwellMs, onSelect, now = () => Date.now() }) {
    this._dwellMs = dwellMs;
    this._onSelect = onSelect;
    this._now = now;
    this._target = null;
    this._enteredAt = 0;
    this._fired = false;
  }
  enter(targetId) { this._target = targetId; this._enteredAt = this._now(); this._fired = false; }
  leave() { this._target = null; }
  tick() {
    if (this._target === null || this._fired) return;
    if (this._now() - this._enteredAt >= this._dwellMs) {
      this._fired = true;
      this._onSelect(this._target);
    }
  }
}
