import { GENERATED_SOURCE_VARIANTS } from "./sourcePartsGeneratedCatalog.js";
import {
    STAIR_SMOOTHING_STYLE,
    createPlanStairSmoothingOperations,
} from "./sourcePartsStairSmoothing.js";

const VARIANT_BY_ID = new Map(
    GENERATED_SOURCE_VARIANTS.map((variant) => [variant.id, variant])
);

const DIRECTION_VECTOR = Object.freeze({
    north: Object.freeze({ x: 0, y: 0, z: -1 }),
    south: Object.freeze({ x: 0, y: 0, z: 1 }),
    west: Object.freeze({ x: -1, y: 0, z: 0 }),
    east: Object.freeze({ x: 1, y: 0, z: 0 }),
    up: Object.freeze({ x: 0, y: 1, z: 0 }),
    down: Object.freeze({ x: 0, y: -1, z: 0 }),
});

const STAIR_AUTHORED_TYPES = Object.freeze([
    "minecraft:oak_planks",
    "minecraft:oak_stairs",
]);
const STAIR_SMOOTHED_TYPES = Object.freeze(["minecraft:oak_stairs"]);

function pointKey(point) {
    return `${point.x},${point.y},${point.z}`;
}

function add(left, right) {
    return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function offset(point, vector, scale) {
    return {
        x: point.x + vector.x * scale,
        y: point.y + vector.y * scale,
        z: point.z + vector.z * scale,
    };
}

function subchunkKey(point) {
    return `${Math.floor(point.x / 16)},${Math.floor(point.y / 16)},${Math.floor(point.z / 16)}`;
}

function probeScore(point) {
    return (
        Math.imul(point.x, 73856093)
        ^ Math.imul(point.y, 19349663)
        ^ Math.imul(point.z, 83492791)
    ) >>> 0;
}

function addSolidCandidate(buckets, point) {
    const key = subchunkKey(point);
    let bucket = buckets.get(key);
    if (!bucket) {
        bucket = {
            first: point,
            last: point,
            low: { point, score: probeScore(point) },
            high: { point, score: probeScore(point) },
        };
        buckets.set(key, bucket);
        return;
    }
    bucket.last = point;
    const score = probeScore(point);
    if (score < bucket.low.score) bucket.low = { point, score };
    if (score > bucket.high.score) bucket.high = { point, score };
}

function representativeSolidPoints(placement, variant) {
    const buckets = new Map();
    for (const run of variant.solidRuns ?? []) {
        const [localY, localZ, localFromX, localToX] = run;
        let localX = localFromX;
        while (localX <= localToX) {
            const worldX = placement.origin.x + localX;
            const worldChunkEndX = Math.floor(worldX / 16) * 16 + 15;
            const segmentEndX = Math.min(
                localToX,
                worldChunkEndX - placement.origin.x
            );
            const candidates = new Set([
                localX,
                Math.floor((localX + segmentEndX) / 2),
                segmentEndX,
            ]);
            for (const candidateX of candidates) {
                addSolidCandidate(buckets, {
                    x: placement.origin.x + candidateX,
                    y: placement.origin.y + localY,
                    z: placement.origin.z + localZ,
                });
            }
            localX = segmentEndX + 1;
        }
    }
    return [...buckets.values()].flatMap((bucket) => {
        const unique = new Map();
        for (const point of [bucket.first, bucket.low.point, bucket.high.point, bucket.last]) {
            unique.set(pointKey(point), point);
        }
        return [...unique.values()];
    });
}

function mergeExpectedTypes(existing, incoming) {
    if (!incoming) return existing;
    if (!existing) return [...incoming];
    const intersection = existing.filter((typeId) => incoming.includes(typeId));
    if (intersection.length === 0) {
        throw new Error(`incompatible integrity probe types: ${existing} vs ${incoming}`);
    }
    return intersection;
}

function mergeExpectedStates(existing, incoming) {
    if (!incoming) return existing;
    if (!existing) return { ...incoming };
    for (const [name, value] of Object.entries(incoming)) {
        if (Object.prototype.hasOwnProperty.call(existing, name) && existing[name] !== value) {
            throw new Error(`incompatible integrity probe state ${name}`);
        }
        existing[name] = value;
    }
    return existing;
}

function addProbe(
    group,
    position,
    reason,
    expectedTypes = null,
    smoothedExpectedTypes = null,
    smoothedExpectedStates = null
) {
    const key = pointKey(position);
    let probe = group.byPoint.get(key);
    if (!probe) {
        probe = {
            position: { ...position },
            expectedTypes: null,
            smoothedExpectedTypes: null,
            smoothedExpectedStates: null,
            reasons: new Set(),
        };
        group.byPoint.set(key, probe);
    }
    probe.expectedTypes = mergeExpectedTypes(probe.expectedTypes, expectedTypes);
    probe.smoothedExpectedTypes = mergeExpectedTypes(
        probe.smoothedExpectedTypes, smoothedExpectedTypes
    );
    probe.smoothedExpectedStates = mergeExpectedStates(
        probe.smoothedExpectedStates, smoothedExpectedStates
    );
    probe.reasons.add(reason);
}

function requireGroup(groups, placementId) {
    const group = groups.get(placementId);
    if (!group) throw new Error(`integrity probe references missing placement ${placementId}`);
    return group;
}

function addConnectionSupportProbes(groups, connection, index) {
    const floorNormal = DIRECTION_VECTOR[connection.floorNormal];
    if (!floorNormal) throw new Error(`connection ${index} has invalid floor normal`);
    const endpoints = [
        [connection.fromPlacementId, connection.fromLanes, "from"],
        [connection.toPlacementId, connection.toLanes, "to"],
    ];
    for (const [placementId, lanes, side] of endpoints) {
        const group = requireGroup(groups, placementId);
        for (const lane of lanes ?? []) {
            addProbe(group, offset(lane, floorNormal, -1), `seam:${index}:${side}`);
        }
    }
}

function addSealedSocketSupportProbes(groups, sealed, index) {
    const floorNormal = DIRECTION_VECTOR[sealed.floorNormal];
    if (!floorNormal) throw new Error(`sealed socket ${index} has invalid floor normal`);
    const group = requireGroup(groups, sealed.placementId);
    for (const localLane of sealed.localWalkLanes ?? []) {
        const lane = add(group.placement.origin, localLane);
        addProbe(group, offset(lane, floorNormal, -1), `sealed:${index}`);
    }
}

/**
 * Produces a compact, navigation-focused proof set for every placed structure.
 *
 * Four authored solid representatives per touched world subchunk catch a stale
 * subchunk commit without scanning every decorative block.  Exact support cells
 * for every connected/sealed socket and every cell that stair smoothing will
 * touch are always included, so route integrity is exhaustive.
 */
export function createPlanPlacementIntegrityGroups(plan) {
    const placements = Array.isArray(plan?.placements) ? plan.placements : [];
    const groups = new Map(placements.map((placement) => [placement.placementId, {
        placement,
        byPoint: new Map(),
    }]));
    if (groups.size !== placements.length) {
        throw new Error("placement integrity requires unique placement ids");
    }

    for (const placement of placements) {
        const variant = VARIANT_BY_ID.get(placement.variantId);
        if (!variant) throw new Error(`integrity catalog is missing ${placement.variantId}`);
        const group = requireGroup(groups, placement.placementId);
        for (const point of representativeSolidPoints(placement, variant)) {
            addProbe(group, point, "solid-subchunk");
        }
    }

    for (let index = 0; index < (plan?.connections?.length ?? 0); index += 1) {
        addConnectionSupportProbes(groups, plan.connections[index], index);
    }
    for (let index = 0; index < (plan?.sealedSockets?.length ?? 0); index += 1) {
        addSealedSocketSupportProbes(groups, plan.sealedSockets[index], index);
    }
    for (const item of createPlanStairSmoothingOperations(
        plan, STAIR_SMOOTHING_STYLE.OAK_STAIRS
    )) {
        const group = requireGroup(groups, item.placement.placementId);
        for (const operation of item.operations) {
            const isRetainedLanding = operation.replaceTypes.length === 1;
            addProbe(
                group,
                operation.worldPosition,
                "stair-route",
                STAIR_AUTHORED_TYPES,
                isRetainedLanding ? STAIR_AUTHORED_TYPES : STAIR_SMOOTHED_TYPES,
                operation.states
            );
        }
    }

    return [...groups.values()].map((group) => ({
        placement: group.placement,
        probes: [...group.byPoint.values()].map((probe) => ({
            position: probe.position,
            expectedTypes: probe.expectedTypes,
            smoothedExpectedTypes: probe.smoothedExpectedTypes,
            smoothedExpectedStates: probe.smoothedExpectedStates,
            reasons: [...probe.reasons],
        })),
    }));
}

export function countPlanPlacementIntegrityProbes(groups) {
    return (groups ?? []).reduce((sum, group) => sum + (group.probes?.length ?? 0), 0);
}
