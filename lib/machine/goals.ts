import {SoftwareDeliveryMachine} from "@atomist/sdm";
import {cacheRemove, cacheRestore, GoalCacheOptions, Version} from "@atomist/sdm-core";
import {DockerBuild} from "@atomist/sdm-pack-docker";
import {KubernetesDeploy} from "@atomist/sdm-pack-k8s";
import {IsNode, NodeProjectVersioner, NpmInstallProjectListener} from "@atomist/sdm-pack-node";
import {k8sCallback} from "../support/k8s/callback";
import {K8sCanaryDeploy} from "../support/k8s/k8sCanaryDeploy";
import {K8sDeleteCanary} from "../support/k8s/k8sDeleteCanary";
import {NpmCompileProjectListener} from "../support/node/compileProjectListener";

export const nodeVersion = new Version().withVersioner(NodeProjectVersioner);
const NodeModulesCacheOptions: GoalCacheOptions = {
    entries: [{ classifier: "nodeModules", pattern: { directory: "node_modules" }}],
    onCacheMiss: [NpmInstallProjectListener, NpmCompileProjectListener],
};

export const dockerBuildGoal: DockerBuild = new DockerBuild();
export const k8sCanary10Deploy = new K8sCanaryDeploy({ environment: "production" });
export const k8sCanary50Deploy = new K8sCanaryDeploy({ environment: "production" });
export const k8sProductionDeploy = new KubernetesDeploy({ environment: "production", preApproval: true });
export const k8sCleanupCanary = new K8sDeleteCanary({environment: "production"});

export function addGoalImplementations(sdm: SoftwareDeliveryMachine): SoftwareDeliveryMachine {
    k8sCanary10Deploy
        .with({weight: 10, applicationData: k8sCallback});

    k8sCanary50Deploy
        .with({weight: 50, applicationData: k8sCallback});

    k8sProductionDeploy
        .with({applicationData: k8sCallback});

    k8sCleanupCanary
        .with({namespace: "production"});

    dockerBuildGoal
        .with({pushTest: IsNode, options: sdm.configuration.sdm.docker})
        .withProjectListener(cacheRestore(NodeModulesCacheOptions))
        .withProjectListener(cacheRemove(NodeModulesCacheOptions));

    return sdm;
}
