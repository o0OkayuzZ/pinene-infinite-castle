import assert from "node:assert/strict";
import { createSourcePartsPlan } from "../scripts/infinite_castle/sourcePartsPlanner.js";
import { GENERATED_SOURCE_VARIANTS } from "../scripts/infinite_castle/sourcePartsGeneratedCatalog.js";
import { fitPlanToHeightRange } from "../scripts/infinite_castle/sourcePartsVolumes.js";

const HORIZONTAL = new Set(["north", "south", "west", "east"]);
const VARIANTS = new Map(GENERATED_SOURCE_VARIANTS.map((variant) => [variant.id, variant]));
const EXPECTED_TOTALS = { room: 15, crossroads: 6, bridge: 5, stairs: 8 };
const EXPECTED_TIERS = {
    lower: { room: 6, crossroads: 2, bridge: 2, nodes: 10, edges: 10 },
    middle: { room: 5, crossroads: 2, bridge: 2, nodes: 9, edges: 9 },
    upper: { room: 4, crossroads: 2, bridge: 1, nodes: 7, edges: 7 },
};

function pointInRuns(point, runs) {
    return runs.some(([y, z, startX, endX]) =>
        point.y === y && point.z === z && point.x >= startX && point.x <= endX
    );
}

function countedByCategory(placements) {
    const counts = { room: 0, crossroads: 0, bridge: 0, stairs: 0 };
    for (const placement of placements) counts[placement.category] += 1;
    return counts;
}

function assertConnected(plan, label) {
    const neighbors = new Map(plan.placements.map((placement) => [placement.placementId, []]));
    for (const connection of plan.connections) {
        neighbors.get(connection.fromPlacementId).push(connection.toPlacementId);
        neighbors.get(connection.toPlacementId).push(connection.fromPlacementId);
    }
    const visited = new Set();
    const queue = [plan.placements[0].placementId];
    while (queue.length > 0) {
        const current = queue.shift();
        if (visited.has(current)) continue;
        visited.add(current);
        queue.push(...neighbors.get(current));
    }
    assert.equal(visited.size, plan.placements.length, `${label}: disconnected graph`);
}

function assertTierConnected(plan, tier, label) {
    const ids = new Set(
        plan.placements.filter((placement) => placement.tier === tier)
            .map((placement) => placement.placementId)
    );
    const neighbors = new Map([...ids].map((id) => [id, []]));
    for (const connection of plan.connections.filter((edge) =>
        edge.transition === "horizontal" && edge.tier === tier
    )) {
        neighbors.get(connection.fromPlacementId).push(connection.toPlacementId);
        neighbors.get(connection.toPlacementId).push(connection.fromPlacementId);
    }
    const visited = new Set();
    const queue = [[...ids][0]];
    while (queue.length > 0) {
        const current = queue.shift();
        if (visited.has(current)) continue;
        visited.add(current);
        queue.push(...neighbors.get(current));
    }
    assert.equal(visited.size, ids.size, `${label}: ${tier} subgraph disconnected`);
}

assert.equal(GENERATED_SOURCE_VARIANTS.length, 15);
for (const variant of GENERATED_SOURCE_VARIANTS) {
    assert.equal(variant.navigationValidated, true, `${variant.id}: navigation flag`);
    assert.equal(variant.floorNormal, "up", `${variant.id}: runtime gravity`);
    assert.ok(variant.routeWidth >= 5, `${variant.id}: route width`);
    for (const socket of variant.sockets) {
        assert.ok(HORIZONTAL.has(socket.direction), `${variant.id}: vertical socket`);
        assert.equal(socket.walkLanes.length, 5, `${variant.id}: socket width`);
        for (const lane of socket.walkLanes) {
            assert.ok(pointInRuns(lane, variant.walkRuns), `${variant.id}: lane outside route`);
        }
    }
}

for (const style of ["castle", "floating"]) {
    let deterministic = null;
    for (let seed = 0; seed < 100; seed += 1) {
        const label = `${style} seed=${seed}`;
        const plan = createSourcePartsPlan(seed, { x: 1000, y: 96, z: 1000 }, { style });
        assert.equal(plan.schemaVersion, 5, `${label}: schema`);
        assert.equal(plan.style, style, `${label}: style`);
        assert.equal(plan.placements.length, 34, `${label}: placement count`);
        assert.equal(plan.connections.length, 38, `${label}: connection count`);
        assert.deepEqual(countedByCategory(plan.placements), EXPECTED_TOTALS, `${label}: totals`);
        assert.equal(new Set(plan.placements.map((item) => item.placementId)).size, 34,
            `${label}: duplicate placement id`);
        assertConnected(plan, label);

        for (const [tier, expected] of Object.entries(EXPECTED_TIERS)) {
            const placements = plan.placements.filter((item) => item.tier === tier);
            const connections = plan.connections.filter((item) =>
                item.transition === "horizontal" && item.tier === tier
            );
            assert.equal(placements.length, expected.nodes, `${label}: ${tier} nodes`);
            assert.equal(connections.length, expected.edges, `${label}: ${tier} loop edges`);
            assert.ok(connections.length >= placements.length, `${label}: ${tier} has no cycle`);
            assertTierConnected(plan, tier, label);
            const counts = countedByCategory(placements);
            for (const category of ["room", "crossroads", "bridge"]) {
                assert.equal(counts[category], expected[category], `${label}: ${tier}.${category}`);
            }
        }

        assert.equal(plan.tierBases.middle.y - plan.tierBases.lower.y, 72,
            `${label}: lower-middle elevation`);
        assert.equal(plan.tierBases.upper.y - plan.tierBases.middle.y, 72,
            `${label}: middle-upper elevation`);
        const vertical = plan.connections.filter((item) => item.transition === "vertical");
        assert.equal(vertical.length, 12, `${label}: vertical seams`);
        const routes = new Map();
        for (const connection of vertical) {
            const group = routes.get(connection.routeId) ?? [];
            group.push(connection);
            routes.set(connection.routeId, group);
        }
        assert.equal(routes.size, 4, `${label}: vertical route count`);
        for (const [routeId, edges] of routes) {
            assert.equal(edges.length, 3, `${label}: ${routeId} seam count`);
            const ids = new Set(edges.flatMap((edge) => [edge.fromPlacementId, edge.toPlacementId]));
            const stairs = plan.placements.filter((item) =>
                ids.has(item.placementId) && item.category === "stairs"
            );
            assert.equal(stairs.length, 2, `${label}: ${routeId} stair count`);
            assert.ok(stairs.every((item) => item.verticalSpan === 36),
                `${label}: ${routeId} must use 36-span stairs`);
        }

        const degree = new Map(plan.placements.map((placement) => [placement.placementId, 0]));
        for (const connection of plan.connections) {
            degree.set(connection.fromPlacementId, degree.get(connection.fromPlacementId) + 1);
            degree.set(connection.toPlacementId, degree.get(connection.toPlacementId) + 1);
            assert.equal(connection.mode, "authored_seam", `${label}: seam mode`);
            assert.equal(connection.opening.width, 5, `${label}: seam width`);
            assert.equal(connection.fromLanes.length, 5, `${label}: source lanes`);
            assert.equal(connection.toLanes.length, 5, `${label}: target lanes`);
        }
        const sealedByPlacement = new Map();
        const accountedSocketKeys = new Set();
        for (const connection of plan.connections) {
            for (const key of [
                `${connection.fromPlacementId}:${connection.fromDirection}`,
                `${connection.toPlacementId}:${connection.toDirection}`,
            ]) {
                assert.equal(accountedSocketKeys.has(key), false, `${label}: reused socket ${key}`);
                accountedSocketKeys.add(key);
            }
        }
        assert.equal(plan.sealedSockets.length, 4, `${label}: sealed socket count`);
        for (const sealed of plan.sealedSockets) {
            const placement = plan.placements.find((item) => item.placementId === sealed.placementId);
            assert.equal(placement.category, "crossroads", `${label}: non-crossroad seal`);
            assert.ok(sealed.localPosition, `${label}: sealed local position`);
            assert.equal(sealed.localWalkLanes.length, 5, `${label}: sealed lane width`);
            assert.equal("worldPosition" in sealed, false, `${label}: height-unsafe sealed world point`);
            const key = `${sealed.placementId}:${sealed.direction}`;
            assert.equal(accountedSocketKeys.has(key), false, `${label}: connected seal ${key}`);
            accountedSocketKeys.add(key);
            sealedByPlacement.set(
                sealed.placementId, (sealedByPlacement.get(sealed.placementId) ?? 0) + 1
            );
        }
        const expectedAccounted = plan.placements
            .filter((placement) => placement.category !== "room")
            .reduce((sum, placement) => sum + VARIANTS.get(placement.variantId).sockets.length, 0);
        const nonRoomAccounted = [...accountedSocketKeys].filter((key) => {
            const id = key.split(":")[0];
            return plan.placements.find((placement) => placement.placementId === id).category !== "room";
        });
        assert.equal(nonRoomAccounted.length, expectedAccounted,
            `${label}: non-room socket accounting`);
        for (const placement of plan.placements.filter((item) => item.category !== "room")) {
            const socketCount = VARIANTS.get(placement.variantId).sockets.length;
            assert.equal(
                degree.get(placement.placementId) + (sealedByPlacement.get(placement.placementId) ?? 0),
                socketCount,
                `${label}: unaccounted non-room socket ${placement.placementId}`
            );
        }
        const highPlan = JSON.parse(JSON.stringify(
            createSourcePartsPlan(seed, { x: 1000, y: 260, z: 1000 }, { style })
        ));
        const heightFit = fitPlanToHeightRange(highPlan, { min: -64, max: 320 });
        assert.ok(heightFit.fromY >= -64, `${label}: fit below world`);
        assert.ok(heightFit.toY <= 319, `${label}: fit above world`);
        if (seed === 0) deterministic = JSON.stringify(plan);
    }
    assert.equal(
        JSON.stringify(createSourcePartsPlan(0, { x: 1000, y: 96, z: 1000 }, { style })),
        deterministic,
        `${style}: nondeterministic plan`
    );
}

assert.throws(
    () => createSourcePartsPlan(0, { x: 0, y: 96, z: 0 }, { style: "unknown" }),
    /unknown source-parts layout style/
);
console.log("sourcePartsPlanner: 2 styles x 100 seeds passed");
