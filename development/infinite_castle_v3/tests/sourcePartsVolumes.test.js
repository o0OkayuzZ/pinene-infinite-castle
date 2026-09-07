import assert from "node:assert/strict";
import {
    boundsVolume,
    clipBoundsToHeight,
    fitPlanToHeightRange,
    MAX_FILL_BLOCKS,
    splitBoundsForFill,
} from "../scripts/infinite_castle/sourcePartsVolumes.js";

const oversized = {
    from: { x: -31, y: 64, z: 1000 },
    to: { x: 30, y: 99, z: 1031 },
};
assert.equal(boundsVolume(oversized), 71424);
const sections = splitBoundsForFill(oversized);
assert.ok(sections.length > 1);
assert.equal(
    sections.reduce((total, section) => total + boundsVolume(section), 0),
    boundsVolume(oversized)
);
for (const section of sections) {
    assert.ok(boundsVolume(section) <= MAX_FILL_BLOCKS);
}

const exactLimit = {
    from: { x: 0, y: 0, z: 0 },
    to: { x: 31, y: 31, z: 31 },
};
assert.equal(boundsVolume(exactLimit), MAX_FILL_BLOCKS);
assert.equal(splitBoundsForFill(exactLimit).length, 1);

const clipped = clipBoundsToHeight({
    from: { x: 0, y: 312, z: 0 },
    to: { x: 15, y: 348, z: 15 },
}, { min: -64, max: 320 });
assert.deepEqual(clipped, {
    from: { x: 0, y: 312, z: 0 },
    to: { x: 15, y: 319, z: 15 },
});
assert.equal(clipBoundsToHeight({
    from: { x: 0, y: 320, z: 0 },
    to: { x: 1, y: 400, z: 1 },
}, { min: -64, max: 320 }), null);

const elevatedPlan = {
    tierBases: {
        lower: { x: 0, y: 188, z: 0 },
        middle: { x: 0, y: 260, z: 0 },
        upper: { x: 0, y: 332, z: 0 },
    },
    placements: [
        { origin: { x: 0, y: 188, z: 0 }, size: { x: 13, y: 48, z: 45 } },
        { origin: { x: 0, y: 310, z: 0 }, size: { x: 41, y: 37, z: 13 } },
    ],
    connections: [{
        from: { x: 0, y: 305, z: 0 },
        to: { x: 0, y: 310, z: 0 },
        opening: { width: 2, height: 4 },
    }],
};
assert.deepEqual(fitPlanToHeightRange(elevatedPlan, { min: -64, max: 320 }), {
    shiftY: -27,
    fromY: 161,
    toY: 319,
});

const verticalConnectionPlan = {
    placements: [{ origin: { x: 0, y: 250, z: 0 }, size: { x: 10, y: 40, z: 10 } }],
    connections: [{
        from: { x: 0, y: 316, z: 0 },
        to: { x: 0, y: 311, z: 0 },
        fromPenetration: 3,
        toPenetration: 0,
        opening: { width: 2, height: 4 },
    }],
};
assert.deepEqual(fitPlanToHeightRange(verticalConnectionPlan, { min: -64, max: 320 }), {
    shiftY: -3,
    fromY: 247,
    toY: 319,
});
assert.equal(verticalConnectionPlan.connections[0].from.y, 313);
assert.equal(elevatedPlan.placements[1].origin.y, 283);
assert.equal(elevatedPlan.connections[0].from.y, 278);
assert.equal(elevatedPlan.connections[0].to.y, 283);
assert.deepEqual(Object.values(elevatedPlan.tierBases).map((base) => base.y), [161, 233, 305]);
assert.deepEqual(fitPlanToHeightRange(elevatedPlan, { min: -64, max: 320 }), {
    shiftY: 0,
    fromY: 161,
    toY: 319,
});

console.log(`sourcePartsVolumes: ${boundsVolume(oversized)} blocks -> ${sections.length} fills`);
