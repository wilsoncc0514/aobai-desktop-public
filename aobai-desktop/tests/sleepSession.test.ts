import { describe, expect, it } from "vitest";
import { MotionPlayer, type MotionLibrary } from "../src/animation/motion";
import { appendRecentAction } from "../src/behavior/context";
import { SleepSession } from "../src/behavior/sleepSession";

const library: MotionLibrary = {
  idle: { durations: [100], loop: true },
  belly: { durations: [100, 100] },
  sleep: { durations: [100, 100], loop: true },
  "sleep-enter": { durations: [100, 100] },
  "sleep-exit": { durations: [100, 100] },
};

function advance(player: MotionPlayer, session: SleepSession): void {
  const before = player.snapshot;
  player.advance();
  const command = session.observeAdvance(before, player.snapshot);
  if (command === "sleep" || command === "sleep-exit") player.replace(command);
  else if (command === "complete") player.reset();
}

describe("bounded sleep sessions", () => {
  it.each([
    [0, 2],
    [0.199999, 2],
    [0.2, 3],
    [0.8, 6],
    [0.999999, 6],
    [Number.NaN, 2],
  ])("maps sample %s to %s fixed rounds", (sample, expected) => {
    const session = new SleepSession();
    expect(session.start(sample)).toBe(expected);
    expect(session.snapshot).toEqual({
      active: true, phase: "sleeping", totalRounds: expected, completedRounds: 0,
    });
  });

  it.each([2, 6])("returns to idle after exactly %s complete sleep loops", (rounds) => {
    const session = new SleepSession();
    const player = new MotionPlayer(library);
    session.start((rounds - 2) / 5);
    player.request("sleep");

    const seen: string[] = [];
    for (let index = 0; player.snapshot.action !== "idle" && index < 20; index++) {
      seen.push(`${player.snapshot.action}:${player.snapshot.frame}`);
      advance(player, session);
    }

    expect(seen).toHaveLength(rounds * 2);
    expect(player.snapshot.action).toBe("idle");
    expect(session.snapshot.active).toBe(false);
  });

  it.each([2, 6])("wraps %s sleep loops with one entry and one exit", (rounds) => {
    const session = new SleepSession();
    const player = new MotionPlayer(library);
    session.start((rounds - 2) / 5, true);
    player.replace("sleep-enter");

    const actions: string[] = [];
    for (let index = 0; session.snapshot.active && index < 40; index++) {
      actions.push(player.snapshot.action);
      advance(player, session);
    }

    expect(actions.filter((action) => action === "sleep-enter")).toHaveLength(2);
    expect(actions.filter((action) => action === "sleep")).toHaveLength(rounds * 2);
    expect(actions.filter((action) => action === "sleep-exit")).toHaveLength(2);
    expect(player.snapshot.action).toBe("idle");
    expect(session.snapshot.phase).toBe("inactive");
  });

  it("cancels immediately and lets interaction take ownership", () => {
    const session = new SleepSession();
    const player = new MotionPlayer(library);
    session.start(0.5);
    player.request("sleep");
    player.advance();

    expect(session.cancel()).toBe(true);
    player.reset();
    player.press();

    expect(session.snapshot.active).toBe(false);
    expect(player.snapshot).toMatchObject({ action: "belly", frame: 0 });
  });

  it("records one behavior start rather than one entry per loop", () => {
    const session = new SleepSession();
    const player = new MotionPlayer(library);
    let recent = appendRecentAction([], "sleep");
    session.start(0.2);
    player.request("sleep");

    for (let index = 0; player.snapshot.action !== "idle" && index < 20; index++) {
      advance(player, session);
    }

    expect(recent.filter((action) => action === "sleep")).toHaveLength(1);
  });
});
