/*
 * Copyright © 2018 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
    goals,
    SoftwareDeliveryMachine,
    SoftwareDeliveryMachineConfiguration, ToDefaultBranch, whenPushSatisfies,
} from "@atomist/sdm";
import {
    createSoftwareDeliveryMachine,
} from "@atomist/sdm-core";
import {HasDockerfile} from "@atomist/sdm-pack-docker";
import {k8sSupport} from "@atomist/sdm-pack-k8s";
import {IsNode} from "@atomist/sdm-pack-node";
import {
    addGoalImplementations,
    dockerBuildGoal, k8sCanary10Deploy, k8sCanary50Deploy, k8sProductionDeploy,
    nodeVersion,
} from "./goals";

/**
 * Initialize an sdm definition, and add functionality to it.
 *
 * @param configuration All the configuration for this service
 */
export function machine(
    configuration: SoftwareDeliveryMachineConfiguration,
): SoftwareDeliveryMachine {

    const sdm = createSoftwareDeliveryMachine({
        name: "Example SDM performing K8s Canary Deployments",
        configuration,
    });

    /**
     * Setup Extension Packs
     */
    sdm.addExtensionPacks(
        k8sSupport(),
    );

    /**
     * Configure Goals
     */
    const buildGoals = goals("build")
        .plan(nodeVersion)
        .plan(dockerBuildGoal).after(nodeVersion);

    const k8sCanaryDeploy = goals("k8s-canary")
        .plan(k8sCanary10Deploy).after(buildGoals)
        .plan(k8sCanary50Deploy).after(k8sCanary10Deploy)
        .plan(k8sProductionDeploy).after(k8sCanary50Deploy);

    /**
     * Define Push Rules
     */
    sdm.withPushRules(
        whenPushSatisfies(HasDockerfile, IsNode)
            .setGoals(buildGoals),
        whenPushSatisfies(HasDockerfile, IsNode, ToDefaultBranch)
            .setGoals(k8sCanaryDeploy),
    );

    /**
     * Add Required Goal Implementations
     */
    addGoalImplementations(sdm);
    return sdm;
}
