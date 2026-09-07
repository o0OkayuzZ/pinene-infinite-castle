import assert from "node:assert/strict";
import { createSourcePartsPlan } from "../scripts/infinite_castle/sourcePartsPlanner.js";
import { GENERATED_SOURCE_VARIANTS } from "../scripts/infinite_castle/sourcePartsGeneratedCatalog.js";

const SIDEWAYS_STAIRS = new Set(["castle_part_005", "castle_part_006"]);
const HORIZONTAL_FLOORS = new Set(["north", "south", "west", "east"]);

let maxAttempt = 0;
let sidewaysStairEdges = 0;
let penetratedRoomEdges = 0;

function pointInRuns(point, runs) {
    return runs.some(([y, z, startX, endX]) =>
        point.y === y && point.z === z && point.x >= startX && point.x <= endX
    );
}

for (const variant of GENERATED_SOURCE_VARIANTS) {
    if (!["crossroads", "bridge"].includes(variant.category)) continue;
    for (const socket of variant.sockets) {
        assert.ok(
            pointInRuns(socket.localPosition, variant.walkRuns),
            `${variant.id}/${socket.direction}: rotated socket is not centered on walk space`
        );
    }
}

for (let seed = 0; seed < 5000; seed += 1) {
    const plan = createSourcePartsPlan(seed, { x: 1000, y: 96, z: 1000 });
    assert.equal(plan.placements.length, 12, `seed=${seed}: placement count`);
    assert.equal(plan.connections.length, 9, `seed=${seed}: connection count`);
    assert.equal(
        plan.placements.filter((placement) => placement.layer === "traversal").length,
        8,
        `seed=${seed}: traversal count`
    );
    assert.equal(
        plan.placements.filter((placement) => placement.layer === "scenic").length,
        4,
        `seed=${seed}: scenic count`
    );
    for (const placement of plan.placements) {
        if (!SIDEWAYS_STAIRS.has(placement.source)) continue;
        assert.equal(placement.layer, "scenic", `seed=${seed}: sideways stair entered traversal graph`);
        assert.ok(HORIZONTAL_FLOORS.has(placement.floorNormal), `seed=${seed}: sideways stair floor normal`);
    }
    for (const connection of plan.connections) {
        assert.ok([0, 3].includes(connection.fromPenetration), `seed=${seed}: from penetration`);
        assert.ok([0, 3].includes(connection.toPenetration), `seed=${seed}: to penetration`);
        if (connection.fromPenetration === 3 || connection.toPenetration === 3) penetratedRoomEdges += 1;
        if (connection.layer !== "scenic") continue;
        sidewaysStairEdges += 1;
        assert.ok(HORIZONTAL_FLOORS.has(connection.floorNormal), `seed=${seed}: scenic edge floor normal`);
        assert.equal(connection.fromPenetration, 3, `seed=${seed}: scenic room penetration`);
        assert.equal(connection.toPenetration, 0, `seed=${seed}: scenic stair penetration`);
    }
    maxAttempt = Math.max(maxAttempt, plan.attempt);
}

assert.ok(penetratedRoomEdges > 0);
console.log(`sourcePartsPlanner: 5000 seeds passed, maxAttempt=${maxAttempt}, scenicEdges=${sidewaysStairEdges}, penetratedRoomEdges=${penetratedRoomEdges}`);
