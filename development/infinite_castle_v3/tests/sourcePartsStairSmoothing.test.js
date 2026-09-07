import assert from "node:assert/strict";
import { GENERATED_SOURCE_VARIANTS } from "../scripts/infinite_castle/sourcePartsGeneratedCatalog.js";
import {
    DEFAULT_STAIR_SMOOTHING_STYLE,
    STAIR_SMOOTHING_STYLE,
    createPlanStairSmoothingOperations,
    createStairSmoothingProfile,
    normalizeStairSmoothingStyle,
    validateStairSmoothingProfile,
} from "../scripts/infinite_castle/sourcePartsStairSmoothing.js";

const STATE_BY_DIRECTION = { east: 0, west: 1, south: 2, north: 3 };
const stairVariants = GENERATED_SOURCE_VARIANTS.filter((variant) => variant.category === "stairs");

assert.equal(stairVariants.length, 8);
assert.equal(normalizeStairSmoothingStyle(), DEFAULT_STAIR_SMOOTHING_STYLE);
assert.equal(normalizeStairSmoothingStyle("authored"), STAIR_SMOOTHING_STYLE.AUTHORED);
assert.throws(() => normalizeStairSmoothingStyle("dark_oak_bridge"), /unsupported/);

for (const variant of stairVariants) {
    assert.equal(createStairSmoothingProfile(variant.id, "authored"), null);
    const profile = createStairSmoothingProfile(variant.id, "oak_stairs");
    assert.ok(validateStairSmoothingProfile(profile), `${variant.id}: invalid profile`);
    assert.equal(profile.width, 11, `${variant.id}: smoothing width`);
    assert.equal(profile.operations.length, (variant.verticalSpan + 1) * profile.width);
    assert.equal(profile.operations[0].states.weirdo_direction, STATE_BY_DIRECTION[profile.uphillDirection]);

    const positions = new Set();
    for (const operation of profile.operations) {
        const point = operation.localPosition;
        assert.ok(point.x >= 0 && point.x < variant.size.x, `${variant.id}: x bounds`);
        assert.ok(point.y >= 0 && point.y < variant.size.y, `${variant.id}: y bounds`);
        assert.ok(point.z >= 0 && point.z < variant.size.z, `${variant.id}: z bounds`);
        assert.equal(operation.blockType, "minecraft:oak_stairs");
        assert.equal(operation.states.upside_down_bit, false);
        assert.equal(operation.states.weirdo_direction, STATE_BY_DIRECTION[profile.uphillDirection]);
        positions.add(`${point.x},${point.y},${point.z}`);
    }
    assert.equal(positions.size, profile.operations.length, `${variant.id}: duplicate operation`);

    const minimumSupportY = profile.low.y - 1;
    const landing = profile.operations.filter((operation) =>
        operation.localPosition.y === minimumSupportY
    );
    assert.equal(landing.length, profile.width, `${variant.id}: landing width`);
    assert.ok(landing.every((operation) =>
        operation.replaceTypes.length === 1
        && operation.replaceTypes[0] === "minecraft:oak_stairs"
    ), `${variant.id}: plank landing must be retained`);
    assert.ok(profile.operations.filter((operation) => operation.localPosition.y > minimumSupportY)
        .every((operation) => operation.replaceTypes.includes("minecraft:oak_planks")));
}

const plan = {
    placements: stairVariants.map((variant, index) => ({
        variantId: variant.id,
        origin: { x: index * 1000, y: 80, z: -index * 1000 },
    })),
};
assert.deepEqual(createPlanStairSmoothingOperations(plan, "authored"), []);
const planned = createPlanStairSmoothingOperations(plan);
assert.equal(planned.length, stairVariants.length);
for (const item of planned) {
    for (const operation of item.operations) {
        assert.deepEqual(operation.worldPosition, {
            x: item.placement.origin.x + operation.localPosition.x,
            y: item.placement.origin.y + operation.localPosition.y,
            z: item.placement.origin.z + operation.localPosition.z,
        });
    }
}

console.log(
    `sourcePartsStairSmoothing: ${stairVariants.length} variants, `
    + `${planned.reduce((sum, item) => sum + item.operations.length, 0)} replacements`
);
