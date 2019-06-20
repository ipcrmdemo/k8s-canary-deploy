import {
    allSatisfied,
    ExecuteGoalResult,
    GoalProjectListenerEvent,
    GoalProjectListenerRegistration,
} from "@atomist/sdm";
import {IsNode, npmCompilePreparation} from "@atomist/sdm-pack-node";
import {PackageJsonHasCompile} from "../pushTests";

export const NpmCompileProjectListener: GoalProjectListenerRegistration = {
    name: "npm compile",
    pushTest: allSatisfied(IsNode, PackageJsonHasCompile),
    listener: async (p, r): Promise<void | ExecuteGoalResult> => {
        return npmCompilePreparation(p, r);
    },
    events: [GoalProjectListenerEvent.before],
};

