// One action at a time for a button. If the press handler returns a promise
// (saving, sending, joining…), further presses are ignored until it settles —
// success or failure — so a single-submit action can't be sent twice by a
// double tap. Synchronous handlers (navigation, toggles) are never blocked.
// Nothing is delayed and the handler itself is unchanged.

export interface PressGuard {
  /** Runs the handler unless one is still running. True when it ran. */
  press(handler: (() => unknown) | undefined): boolean;
  readonly running: boolean;
}

export function createPressGuard(onChange?: (running: boolean) => void): PressGuard {
  let running = false;
  const set = (v: boolean) => { running = v; onChange?.(v); };
  return {
    get running() { return running; },
    press(handler) {
      if (running || !handler) return false;
      const result = handler();
      if (result && typeof (result as Promise<unknown>).then === "function") {
        set(true);
        (result as Promise<unknown>).then(() => set(false), () => set(false));
      }
      return true;
    },
  };
}
