import type { BehaviorAction } from "./actions";
import type { PetContext } from "./context";

export interface BehaviorDecisionProvider {
  decide(
    context: PetContext,
    availableActions: readonly BehaviorAction[],
    sample: number,
  ): BehaviorAction | Promise<BehaviorAction>;
}
