import {SdmGoalEvent} from "@atomist/sdm";
import {KubernetesApplication} from "@atomist/sdm-pack-k8s";
import {ApplicationDataCallback} from "@atomist/sdm-pack-k8s/lib/deploy/goal";
import * as _ from "lodash";

const setCanaryIngressAnnotations = async (e: SdmGoalEvent, annotation: any): Promise<any> => {
    if (e.uniqueName.includes("k8s-deploy-canary")) {
        /**
         * Use the weight data that has been temporarily assigned to the goal data
         */
        return _.merge({
            "nginx.ingress.kubernetes.io/canary": "true",
            "nginx.ingress.kubernetes.io/canary-weight": `${e.data}`,
        }, annotation);
    } else {
        return annotation;
    }
};

const setCanaryDeploymentDetails = async (
    e: SdmGoalEvent,
    a: KubernetesApplication,
): Promise<KubernetesApplication> => {
    if (e.uniqueName.includes("k8s-deploy-canary")) {
        a.name = `${a.name}canary`;
    }
    return a;
};

export const k8sCallback: ApplicationDataCallback = async (a, p, g, e) => {
    const app = await setCanaryDeploymentDetails(e, a);
    app.ns = e.environment.includes("prod") ? "production" : "testing";
    app.path = `/${app.ns}/${p.name}`;

    let annotations: any;
    if (
        app.ingressSpec &&
        app.ingressSpec.metadata &&
        app.ingressSpec.metadata.annotations
    ) {
        annotations = await setCanaryIngressAnnotations(e, _.merge({
                "kubernetes.io/ingress.class": "nginx",
                "nginx.ingress.kubernetes.io/rewrite-target": "/",
                "nginx.ingress.kubernetes.io/ssl-redirect": "false",
            },
            a.ingressSpec.metadata.annotations,
        ));
    } else {
        annotations = await setCanaryIngressAnnotations(e, {
            "kubernetes.io/ingress.class": "nginx",
            "nginx.ingress.kubernetes.io/rewrite-target": "/",
            "nginx.ingress.kubernetes.io/ssl-redirect": "false",
        });
    }
    a.ingressSpec = {
        metadata: {
            annotations,
        },
    };
    return app;
};
