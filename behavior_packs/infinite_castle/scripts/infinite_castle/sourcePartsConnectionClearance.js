const DIRECTION_VECTOR = Object.freeze({
    north: Object.freeze({ x: 0, y: 0, z: -1 }),
    south: Object.freeze({ x: 0, y: 0, z: 1 }),
    west: Object.freeze({ x: -1, y: 0, z: 0 }),
    east: Object.freeze({ x: 1, y: 0, z: 0 }),
    up: Object.freeze({ x: 0, y: 1, z: 0 }),
    down: Object.freeze({ x: 0, y: -1, z: 0 }),
});

function addScaled(origin, vector, scale) {
    return {
        x: origin.x + vector.x * scale,
        y: origin.y + vector.y * scale,
        z: origin.z + vector.z * scale,
    };
}

function pointKey(point) {
    return `${point.x},${point.y},${point.z}`;
}

function positiveInteger(value, fallback) {
    return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : fallback;
}

/**
 * Returns a deterministic walk envelope for both authored socket interiors.
 * Socket detection proves the boundary lane, but thick walls, fence rails, and
 * late socket caps can still obstruct the first few blocks inside a structure.
 */
export function createConnectionClearance(connection, options = {}) {
    const depth = positiveInteger(options.depth, 3);
    const requestedHeight = positiveInteger(options.height, 3);
    const openingHeight = positiveInteger(connection?.opening?.height, requestedHeight);
    const height = Math.min(requestedHeight, openingHeight);
    const floorNormal = DIRECTION_VECTOR[connection?.floorNormal];
    if (!floorNormal) throw new Error(`invalid connection floor normal: ${connection?.floorNormal}`);

    const airByKey = new Map();
    const supportByKey = new Map();
    const sides = [
        { lanes: connection?.fromLanes ?? [], direction: connection?.fromDirection },
        { lanes: connection?.toLanes ?? [], direction: connection?.toDirection },
    ];
    for (const side of sides) {
        const outward = DIRECTION_VECTOR[side.direction];
        if (!outward) throw new Error(`invalid connection direction: ${side.direction}`);
        for (const lane of side.lanes) {
            for (let penetration = 0; penetration <= depth; penetration += 1) {
                const foot = addScaled(lane, outward, -penetration);
                supportByKey.set(
                    pointKey(addScaled(foot, floorNormal, -1)),
                    addScaled(foot, floorNormal, -1)
                );
                for (let vertical = 0; vertical < height; vertical += 1) {
                    const point = addScaled(foot, floorNormal, vertical);
                    airByKey.set(pointKey(point), point);
                }
            }
        }
    }
    return {
        depth,
        height,
        air: [...airByKey.values()],
        supports: [...supportByKey.values()],
    };
}
