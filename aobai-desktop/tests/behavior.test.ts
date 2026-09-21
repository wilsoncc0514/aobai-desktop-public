import { describe, expect, it } from "vitest";
import { isPetState } from "../src/animation/catalog";
import {
  availableBehaviorActionsForMotions,
  behaviorActionToMotionAction,
  motionActionToBehaviorAction,
  type BehaviorAction,
} from "../src/behavior/actions";
import {
  appendRecentAction,
  type PetContext,
} from "../src/behavior/context";
import { RuleDecisionProvider } from "../src/behavior/ruleDecisionProvider";
import { selectAmbientAction } from "../src/behavior/stateMachine";

describe("behavior semantics", () => {
  it.each([
    ["idle", "idle"],
    ["groom", "waving"],
    ["knead", "running"],
    ["stretch", "review"],
    ["sleep", "sleep"],
  ] as const)("maps %s to the existing %s motion", (behavior, motion) => {
    expect(behaviorActionToMotionAction(behavior)).toBe(motion);
    expect(motionActionToBehaviorAction(motion)).toBe(behavior);
  });

  it("exposes only semantics backed by motions that actually exist", () => {
    expect(availableBehaviorActionsForMotions([
      "idle", "belly", "waving", "running", "review", "sleep",
    ])).toEqual(["idle", "groom", "knead", "stretch", "sleep"]);
    expect(availableBehaviorActionsForMotions([
      "idle", "waiting", "failed", "jumping", "running-left",
    ])).toEqual(["idle"]);
  });
});

describe("short-lived pet context", () => {
  it("keeps a bounded immutable action history", () => {
    const original = ["idle", "groom"] as const;
    const recent = appendRecentAction(original, "knead", 2);
    expect(recent).toEqual(["groom", "knead"]);
    expect(original).toEqual(["idle", "groom"]);
    expect(appendRecentAction(recent, "stretch", 0)).toEqual([]);
    const sequence: readonly BehaviorAction[] = [
      "idle", "groom", "knead", "stretch", "groom", "knead",
    ];
    expect(sequence
      .reduce<readonly BehaviorAction[]>(
        (history, action) => appendRecentAction(history, action),
        [],
      )).toHaveLength(5);
  });

  it("contains only runtime decision inputs", () => {
    const context: PetContext = {
      mode: "normal",
      currentAction: "idle",
      previousAction: "groom",
      recentActions: ["groom"],
      secondsSinceLastAmbientAction: 12,
      secondsSinceUserInteraction: 34,
      hour: 9,
    };
    expect(Object.keys(context).sort()).toEqual([
      "currentAction",
      "hour",
      "mode",
      "previousAction",
      "recentActions",
      "secondsSinceLastAmbientAction",
      "secondsSinceUserInteraction",
    ]);
  });
});

describe("local rule decision provider", () => {
  const provider = new RuleDecisionProvider();
  const available = ["idle", "groom", "knead", "stretch"] as const;
  const context: PetContext = {
    mode: "normal",
    currentAction: "idle",
    previousAction: null,
    recentActions: [],
    secondsSinceLastAmbientAction: 30,
    secondsSinceUserInteraction: 30,
    hour: 12,
  };

  it("keeps quiet mode idle", () => {
    expect(provider.decide({ ...context, mode: "quiet" }, available, 0.9)).toBe("idle");
  });

  it("keeps the existing normal and active weighted ordering", () => {
    expect(provider.decide(context, available, 0)).toBe("stretch");
    expect(provider.decide(context, available, 0.5)).toBe("groom");
    expect(provider.decide({ ...context, mode: "active" }, available, 0)).toBe("groom");
    expect(provider.decide({ ...context, mode: "active" }, available, 0.5)).toBe("stretch");
  });

  it("matches the legacy bundled schedule across samples and previous actions", () => {
    const motions = available.map(behaviorActionToMotionAction);
    for (const mode of ["normal", "active"] as const) {
      for (const previousAction of [null, ...available] as const) {
        for (let i = 0; i < 100; i++) {
          const sample = i / 100;
          const previousMotion = previousAction === null
            ? null
            : behaviorActionToMotionAction(previousAction);
          if (previousMotion !== null && !isPetState(previousMotion)) {
            throw new Error("legacy compatibility sample must map to PetState");
          }
          const expectedMotion = selectAmbientAction(
            mode,
            sample,
            previousMotion,
            motions,
          );
          expect(provider.decide(
            { ...context, mode, previousAction },
            available,
            sample,
          )).toBe(motionActionToBehaviorAction(expectedMotion));
        }
      }
    }
  });

  it("avoids the most recent action when another available action exists", () => {
    const recentGroom = { ...context, recentActions: ["groom"] as const };
    expect(provider.decide(recentGroom, ["idle", "groom", "stretch"], 0.5)).toBe("stretch");
    expect(provider.decide(recentGroom, ["idle", "groom"], 0.5)).toBe("groom");
  });

  it("never chooses unavailable or guessed legacy semantics", () => {
    expect(provider.decide(context, ["idle", "stretch"], 0.9)).toBe("stretch");
    expect(provider.decide(context, ["idle"], 0.9)).toBe("idle");
  });

  it("makes normal-mode sleep more likely at night than during the day", () => {
    const withSleep = [...available, "sleep"] as const;
    const countSleep = (hour: number) => Array.from({ length: 1_000 }, (_, index) =>
      provider.decide({ ...context, hour, secondsSinceUserInteraction: 300 }, withSleep, index / 1_000))
      .filter((action) => action === "sleep").length;
    expect(countSleep(23)).toBeGreaterThan(countSleep(12));
    expect(countSleep(12)).toBeGreaterThan(0);
  });

  it("does not auto-sleep in quiet or active mode", () => {
    const withSleep = [...available, "sleep"] as const;
    for (let index = 0; index < 1_000; index++) {
      const sample = index / 1_000;
      expect(provider.decide({ ...context, mode: "quiet" }, withSleep, sample)).toBe("idle");
      expect(provider.decide({ ...context, mode: "active" }, withSleep, sample)).not.toBe("sleep");
    }
  });

  it("suppresses sleep immediately after sleep or recent user interaction", () => {
    const withSleep = [...available, "sleep"] as const;
    expect(provider.decide({
      ...context,
      previousAction: "sleep",
      recentActions: ["sleep"],
      secondsSinceUserInteraction: 300,
      hour: 23,
    }, withSleep, 0)).not.toBe("sleep");
    expect(provider.decide({
      ...context,
      secondsSinceUserInteraction: 5,
      hour: 23,
    }, withSleep, 0)).not.toBe("sleep");
  });
});
