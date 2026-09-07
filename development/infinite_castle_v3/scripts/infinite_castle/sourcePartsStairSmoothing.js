import { GENERATED_SOURCE_VARIANTS } from "./sourcePartsGeneratedCatalog.js";

export const STAIR_SMOOTHING_STYLE = Object.freeze({
    AUTHORED: "authored",
    OAK_STAIRS: "oak_stairs",
});

export const DEFAULT_STAIR_SMOOTHING_STYLE = STAIR_SMOOTHING_STYLE.OAK_STAIRS;

const STAIR_DIRECTION_STATE = Object.freeze({
    east: 0,
    west: 1,
    south: 2,
    north: 3,
});

const VARIANT_BY_ID = new Map(
    GENERATED_SOURCE_VARIANTS.map((variant) => [variant.id, variant])
);

function integerPoint(value) {
    if (!value
        || !Number.isFinite(value.x)
        || !Number.isFinite(value.y)
        || !Number.isFinite(value.z)) return null;
    return { x: Math.trunc(value.x), y: Math.trunc(value.y), z: Math.trunc(value.z) };
}

function add(left, right) {
    return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function pointKey(point) {
    return `${point.x},${point.y},${point.z}`;
}

function horizontalDirection(from, to) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    if (dx !== 0 && dz !== 0) return null;
    if (dx > 0) return "east";
    if (dx < 0) return "west";
    if (dz > 0) return "south";
    if (dz < 0) return "north";
    return null;
}

function withinSize(point, size) {
    return point.x >= 0 && point.x < size.x
        && point.y >= 0 && point.y < size.y
        && point.z >= 0 && point.z < size.z;
}

export function normalizeStairSmoothingStyle(style) {
    if (style === undefined || style === null || style === "") {
        return DEFAULT_STAIR_SMOOTHING_STYLE;
    }
    if (Object.values(STAIR_SMOOTHING_STYLE).includes(style)) return style;
    throw new Error(`unsupported stair smoothing style: ${style}`);
}

/**
 * Creates conservative replacement instructions for a generated stair variant.
 *
 * Every currently accepted stair asset has a straight, one-block-rise-per-cell,
 * eleven-block-wide oak route.  Replacing its support row with bottom oak stairs
 * halves each required step.  The lowest row of plank-built stairs is deliberately
 * retained as a full-block landing; an authored oak stair on that row is only
 * reoriented.  This keeps the connection sill level and avoids modifying trim,
 * railings, or any non-oak support.
 */
export function createStairSmoothingProfile(variantId, style) {
    const selectedStyle = normalizeStairSmoothingStyle(style);
    if (selectedStyle === STAIR_SMOOTHING_STYLE.AUTHORED) return null;

    const variant = VARIANT_BY_ID.get(variantId);
    if (!variant
        || variant.category !== "stairs"
        || variant.navigationValidated !== true
        || variant.navigationKind !== "oak_ascending_route") return null;

    const sockets = Array.isArray(variant.sockets) ? variant.sockets : [];
    if (sockets.length !== 2) return null;
    const endpoints = sockets
        .map((socket) => integerPoint(socket.walkPosition ?? socket.localPosition))
        .filter(Boolean)
        .sort((left, right) => left.y - right.y);
    if (endpoints.length !== 2 || endpoints[0].y === endpoints[1].y) return null;

    const low = endpoints[0];
    const high = endpoints[1];
    const uphillDirection = horizontalDirection(low, high);
    if (!uphillDirection) return null;
    const horizontalLength = Math.abs(high.x - low.x) + Math.abs(high.z - low.z);
    const verticalLength = high.y - low.y;
    if (horizontalLength !== verticalLength || horizontalLength < 1) return null;

    const step = {
        x: Math.sign(high.x - low.x),
        y: 1,
        z: Math.sign(high.z - low.z),
    };
    const lateral = step.x === 0 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
    const width = Math.max(1, Math.trunc(variant.routeWidth ?? 5));
    if (width % 2 === 0) return null;
    const halfWidth = Math.floor(width / 2);
    const operations = [];

    for (let stairIndex = 0; stairIndex <= horizontalLength; stairIndex += 1) {
        const footCenter = {
            x: low.x + step.x * stairIndex,
            y: low.y + stairIndex,
            z: low.z + step.z * stairIndex,
        };
        for (let laneOffset = -halfWidth; laneOffset <= halfWidth; laneOffset += 1) {
            const localPosition = {
                x: footCenter.x + lateral.x * laneOffset,
                y: footCenter.y - 1,
                z: footCenter.z + lateral.z * laneOffset,
            };
            if (!withinSize(localPosition, variant.size)) continue;
            operations.push({
                localPosition,
                blockType: "minecraft:oak_stairs",
                states: {
                    upside_down_bit: false,
                    weirdo_direction: STAIR_DIRECTION_STATE[uphillDirection],
                },
                // Keep the lowest full-plank landing, but repair an authored stair
                // there when a reoriented structure made it upside-down.
                replaceTypes: stairIndex === 0
                    ? ["minecraft:oak_stairs"]
                    : ["minecraft:oak_planks", "minecraft:oak_stairs"],
            });
        }
    }

    return {
        style: selectedStyle,
        variantId: variant.id,
        source: variant.source,
        width,
        low,
        high,
        uphillDirection,
        operations,
    };
}

export function createPlanStairSmoothingOperations(plan, style) {
    const selectedStyle = normalizeStairSmoothingStyle(style);
    if (selectedStyle === STAIR_SMOOTHING_STYLE.AUTHORED) return [];
    const result = [];
    for (let placementIndex = 0; placementIndex < (plan?.placements?.length ?? 0); placementIndex += 1) {
        const placement = plan.placements[placementIndex];
        const origin = integerPoint(placement?.origin);
        if (!origin) continue;
        const profile = createStairSmoothingProfile(placement.variantId, selectedStyle);
        if (!profile) continue;
        result.push({
            placementIndex,
            placement,
            profile,
            operations: profile.operations.map((operation) => ({
                ...operation,
                worldPosition: add(origin, operation.localPosition),
            })),
        });
    }
    return result;
}

export function validateStairSmoothingProfile(profile) {
    if (!profile) return false;
    const unique = new Set(profile.operations.map((operation) => pointKey(operation.localPosition)));
    return profile.width >= 5
        && profile.operations.length > 0
        && unique.size === profile.operations.length
        && profile.operations.every((operation) =>
            operation.blockType === "minecraft:oak_stairs"
            && operation.states?.upside_down_bit === false
            && Number.isInteger(operation.states?.weirdo_direction)
        );
}
