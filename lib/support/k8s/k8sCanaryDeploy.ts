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
    GoalExecutionListener,
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

export const cleanupCanaryListener: GoalCompletionListener = async l => {
    if (l.completedGoal.uniqueName.includes("kubernetes-deploy") && l.completedGoal.state === SdmGoalState.success) {
        /**
         * Go find K8s deployment info
         */
        const deployInfo = _.get(
            JSON.parse(l.completedGoal.data as any), "@atomist/sdm-pack-k8s") as KubernetesApplication;

        /**
         * For the discovered deployment, wait until all unavailableReplicas has moved to 0, if this doesn't happen within 60 seconds, fail
         */
        const result = new Deferred<string>();
        const times = 20;
        let counter = 0;
        const timer = setInterval(async () => {
            if (counter >= times) {
                clearInterval(timer);
            }

            logger.debug(`------> Testing if ${deployInfo.name} has converged`);
            // Replace with kubernetes/client call
            const output = await execPromise(
                "kubectl",
                ["get", "deployment", "-n", "production", deployInfo.name, "-o", "json"],
            );

            // @ts-ignore
            const parsed = JSON.parse(output.stdout);
            if (!parsed.status.hasOwnProperty("unavailableReplicas")) {
                logger.debug(`------> ${deployInfo.name} has converged, proceeding with canary cleanup`);
                result.resolve(true);
            } else {
                logger.debug(`------> ${deployInfo.name} has not yet converged, sleeping`);
            }

            counter++;
        }, 3000);

        // Wait for polling to finish
        // @ts-ignore
        const status = await result.promise;
        clearInterval(timer);

        /**
         * If the production deployment successfully converged, cleanup canary
         */
        if (status) {
            deployInfo.name = deployInfo.name + "canary";
            logger.debug(`------> Removing old K8s canary ${deployInfo.name}!`);
            await deleteApplication(deployInfo);
            logger.debug(`------> Succeeded removing old K8s canary ${deployInfo.name}!`);
        } else {
            logger.debug(`------> Deployment ${deployInfo.name} failed to start all replicas!`);
        }
    }
};

function wait(seconds: number): Promise<void> {
    return new Promise<void>(resolve => {
        setTimeout(resolve, seconds * 1000);
    });
}
