import {predicatePushTest, PredicatePushTest} from "@atomist/sdm";

export const PackageJsonHasCompile: PredicatePushTest = predicatePushTest(
    "npmHasBuildScript",
    async p => {
        if (await p.hasFile("package.json")) {
            const npmFile = await p.getFile("package.json");
            const packageFile = JSON.parse(await npmFile.getContent());
            const hasBuild = packageFile.scripts.hasOwnProperty("compile");
            return hasBuild;
        } else {
            return false;
        }
    });
