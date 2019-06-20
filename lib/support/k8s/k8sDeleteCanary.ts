import {Deferred} from "@atomist/automation-client/lib/internal/util/Deferred";
import {
    DefaultGoalNameGenerator, goal,
} from "@atomist/sdm";
import {KubernetesApplication} from "@atomist/sdm-pack-k8s";
import {deleteApplication} from "@atomist/sdm-pack-k8s/lib/kubernetes/application";
import * as k8s from "@kubernetes/client-node";
import * as _ from "lodash";
import {GetGoalData, GetGoalSetGoalNames} from "../../typings/types";

export const k8sDeleteCanary = goal({
    displayName: "K8s Delete Canary Deployment",
    uniqueName: DefaultGoalNameGenerator.generateName("k8s-delete-canary"),
}, async g => {

    /**
     * Find the deployment name
     *
     * - Query the goalset for all the goal names
     * - Find the kubernetes-goal
     * - Parse the goal data for that goal (which is a KubernetesApplication)
     * - Delete the canary deployment
     */
    const gsn = await g.context.graphClient.query<GetGoalSetGoalNames.Query, GetGoalSetGoalNames.Variables>({
        name: "getGoalSetGoalNames",
        variables: {
            goalSetId: g.goalEvent.goalSetId,
        },
    });

    const name = gsn.SdmGoalSet[0].goals.filter(tg => tg.uniqueName.includes("kubernetes-deploy"))[0];
    const goalDetail = await g.context.graphClient.query<GetGoalData.Query, GetGoalData.Variables>({
        name: "getGoalData",
        variables: {
            goalName: name.uniqueName,
            goalSetId: g.goalEvent.goalSetId,
        },
    });

    /**
     * Go find K8s deployment info
     */
    const deployInfo = _.get(
        JSON.parse(goalDetail.SdmGoal[0].data), "@atomist/sdm-pack-k8s") as KubernetesApplication;

    /**
     * For the discovered deployment, wait until all unavailableReplicas has moved to 0, if this doesn't happen within 60 seconds, fail
     */
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    const k8sApi = kc.makeApiClient(k8s.AppsV1Api);
    const result = new Deferred<string>();
    const times = 20;
    let counter = 0;
    const timer = setInterval(async () => {
        if (counter >= times) {
            clearInterval(timer);
        }

        g.progressLog.write(`Testing if ${deployInfo.name} has converged`);
        const state = await k8sApi.readNamespacedDeployment(deployInfo.name, deployInfo.ns);
        if (state.body.status.unavailableReplicas === undefined) {
            g.progressLog.write(`${deployInfo.name} has converged, proceeding with canary cleanup`);
            result.resolve(true);
        } else {
            g.progressLog.write(`${deployInfo.name} has not yet converged, sleeping`);
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
        g.progressLog.write(`Removing old K8s canary ${deployInfo.name}!`);
        await deleteApplication(deployInfo);
        g.progressLog.write(`Succeeded removing old K8s canary ${deployInfo.name}!`);
    } else {
        const msg = `Deployment ${deployInfo.name} failed to start all replicas!`;
        g.progressLog.write(msg);
        return {code: 1, message: msg};
    }

    return {
        code: 0,
    };
});
