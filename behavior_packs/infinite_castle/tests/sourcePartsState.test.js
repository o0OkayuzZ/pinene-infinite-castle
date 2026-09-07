import assert from "node:assert/strict";
import {
    compactSourcePartsPlan,
    parseSourcePartsPlans,
    serializeSourcePartsState,
} from "../scripts/infinite_castle/sourcePartsState.js";

const placement = (x) => ({
    origin: { x, y: 96, z: 1000 },
    size: { x: 25, y: 13, z: 25 },
    variantId: `discarded_${x}`,
});
const connection = (x) => ({
    from: { x, y: 97, z: 1000 },
    to: { x: x + 5, y: 97, z: 1000 },
    opening: { width: 4, height: 5 },
    floorNormal: "up",
});

const currentPlan = {
    dimensionId: "minecraft:overworld",
    placements: Array.from({ length: 12 }, (_, index) => placement(1000 + index * 32)),
    connections: Array.from({ length: 9 }, (_, index) => connection(1000 + index * 32)),
};
const legacyPlan = {
    dimensionId: "minecraft:overworld",
    placements: [{
        origin: { x: 0, y: 64, z: 0 },
        variant: {
            size: { x: 25, y: 13, z: 25 },
            obsoleteCatalogPayload: "x".repeat(30200),
        },
    }],
    connections: [connection(0)],
};
const legacyState = JSON.stringify({ schemaVersion: 3, status: "complete", plans: [legacyPlan] });
assert.ok(legacyState.length < 32767, "legacy state must fit before adding the next plan");
assert.ok(
    JSON.stringify({ schemaVersion: 3, status: "clearing", plans: [legacyPlan, currentPlan] }).length > 32767,
    "uncompacted clearing state must reproduce the Bedrock limit failure"
);

const loaded = parseSourcePartsPlans(legacyState);
assert.equal(loaded.length, 1);
assert.deepEqual(loaded[0].placements[0], {
    origin: { x: 0, y: 64, z: 0 },
    size: { x: 25, y: 13, z: 25 },
});
assert.equal("variant" in loaded[0].placements[0], false);

const serialized = serializeSourcePartsState("clearing", [...loaded, currentPlan]);
assert.ok(serialized.length < 32767);
assert.equal(JSON.parse(serialized).schemaVersion, 4);
assert.equal(parseSourcePartsPlans(serialized).length, 2);
assert.equal(compactSourcePartsPlan({ dimensionId: "minecraft:overworld" }), null);

console.log(`sourcePartsState: legacy=${legacyState.length} compact=${serialized.length}`);
