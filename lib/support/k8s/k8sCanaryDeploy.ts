import {logger} from "@atomist/automation-client";
import {Deferred} from "@atomist/automation-client/lib/internal/util/Deferred";
import {
    DefaultGoalNameGenerator,
    execPromise,
    ExecuteGoal,
    ExecuteGoalResult,
    FulfillableGoalDetails,
    FulfillableGoalWithRegistrations,
    getGoalDefinitionFrom,
    Goal, GoalCompletionListener,
    GoalDefinition,
    GoalInvocation,
    SdmGoalState,
} from "@atomist/sdm";
import {isInLocalMode} from "@atomist/sdm-core";
import {KubernetesApplication, KubernetesDeploy, KubernetesDeployRegistration} from "@atomist/sdm-pack-k8s";
import {generateKubernetesGoalEventData} from "@atomist/sdm-pack-k8s/lib/deploy/data";
import {deployApplication} from "@atomist/sdm-pack-k8s/lib/deploy/deploy";
import {defaultDataSources} from "@atomist/sdm-pack-k8s/lib/deploy/goal";
import {deleteApplication} from "@atomist/sdm-pack-k8s/lib/kubernetes/application";
import * as _ from "lodash";

interface K8sCanaryDeployRegistration extends KubernetesDeployRegistration {
    /**
     * Specify the weight this canary deployment should use in the load balancing solution.  Valid values are dependent on implementation
     */
    weight: number;
}

export class K8sCanaryDeploy extends FulfillableGoalWithRegistrations<K8sCanaryDeployRegistration> {
    constructor(public readonly details?: FulfillableGoalDetails,
                ...dependsOn: Goal[]) {
        super({
            ...getGoalDefinitionFrom(details, DefaultGoalNameGenerator.generateName("k8s-deploy-canary")),
            preApprovalRequired: true,
        }, ...dependsOn);
    }

    /**
     * Register a deployment with the initiator fulfillment.
     */
    public with(registration: K8sCanaryDeployRegistration): this {
        const fulfillment = registration.name || this.sdm.configuration.name;
        this.addFulfillment({
            name: fulfillment,
            goalExecutor: initiateK8sCanaryDeployment(this as any as KubernetesDeploy, registration),
            pushTest: registration.pushTest,
        });
        this.updateMyGoalName(registration);
        return this;
    }

    public updateMyGoalName(registration: K8sCanaryDeployRegistration): this {
        const env = (this.details && this.details.environment) ? this.details.environment : this.environment;
        this.definition.displayName = `K8s Canary (${registration.weight}) deploy to \`${env}\``;
        const defaultDefinitions: Partial<GoalDefinition> = {
            canceledDescription: `Canceled: ${this.definition.displayName}`,
            completedDescription: `Deployed: ${this.definition.displayName}`,
            failedDescription: `Failed: ${this.definition.displayName}`,
            plannedDescription: `Planned: ${this.definition.displayName}`,
            requestedDescription: `Requested: ${this.definition.displayName}`,
            skippedDescription: `Skipped: ${this.definition.displayName}`,
            stoppedDescription: `Stopped: ${this.definition.displayName}`,
            waitingForApprovalDescription: `Pending Approval: ${this.definition.displayName}`,
            waitingForPreApprovalDescription: `Pending Pre-Approval: ${this.definition.displayName}`,
            workingDescription: `Deploying: ${this.definition.displayName}`,
        };
        _.defaultsDeep(this.definition, defaultDefinitions);
        return this;
    }
}

export function initiateK8sCanaryDeployment(k8Deploy: KubernetesDeploy, registration: K8sCanaryDeployRegistration): ExecuteGoal {
    return async (goalInvocation: GoalInvocation): Promise<ExecuteGoalResult> => {
        defaultDataSources(registration);

        /**
         * Store weight on the goal; this data will be overwritten when generateKubernetesGoalEventData runs,
         * but after the callback that uses the weight
         */
        goalInvocation.goalEvent.data = registration.weight.toString();

        const goalEvent = await generateKubernetesGoalEventData(k8Deploy, registration, goalInvocation);
        if (isInLocalMode()) {
            return deployApplication(goalEvent, goalInvocation.context, goalInvocation.progressLog);
        } else {
            goalEvent.state = SdmGoalState.in_process;
            return goalEvent;
        }
    };
}
