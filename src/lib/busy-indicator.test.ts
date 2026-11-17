import { test } from "node:test";
import assert from "node:assert/strict";
import { createBusyIndicator } from "./busy-indicator";

function harness() {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const log: boolean[] = [];
  let fetching = 0;
  const bi = createBusyIndicator({
    setVisible: (on) => log.push(on),
    fetching: () => fetching,
    setTimeout: (fn, ms) => {
      id += 1;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (h) => {
      timers.delete(h as number);
    },
  });
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
    }
    now = end;
  };
  return { bi, log, advance, setFetching: (n: number) => (fetching = n) };
}

test("save + sequential refetches => shown once, hidden once", () => {
  const h = harness();
  h.bi.begin(); // save POST
  h.advance(300);
  assert.deepEqual(h.log, [true]);
  h.bi.end();
  h.setFetching(3); // invalidate → refetches
  h.bi.sync();
  for (let i = 0; i < 3; i++) {
    h.advance(50);
    h.bi.begin();
    h.advance(120);
    h.bi.end();
  }
  h.advance(100);
  assert.deepEqual(h.log, [true]);
  h.setFetching(0);
  h.bi.sync();
  h.advance(399);
  assert.deepEqual(h.log, [true]);
  h.advance(2);
  assert.deepEqual(h.log, [true, false]);
});

test("gap between requests shorter than grace keeps it on", () => {
  const h = harness();
  h.bi.begin();
  h.advance(250);
  h.bi.end();
  h.advance(300);
  h.bi.begin();
  h.advance(250);
  h.bi.end();
  h.advance(500);
  assert.deepEqual(h.log, [true, false]);
});

test("fast request never shows", () => {
  const h = harness();
  h.bi.begin();
  h.advance(100);
  h.bi.end();
  h.advance(1000);
  assert.deepEqual(h.log, []);
});
