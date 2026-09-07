import { GENERATED_SOURCE_VARIANTS } from "./sourcePartsGeneratedCatalog.js";

const HORIZONTAL_DIRECTIONS = new Set(["north", "south", "west", "east"]);
const DIRECTION_VECTOR = Object.freeze({
    north: Object.freeze({ x: 0, y: 0, z: -1 }),
    south: Object.freeze({ x: 0, y: 0, z: 1 }),
    west: Object.freeze({ x: -1, y: 0, z: 0 }),
    east: Object.freeze({ x: 1, y: 0, z: 0 }),
    up: Object.freeze({ x: 0, y: 1, z: 0 }),
    down: Object.freeze({ x: 0, y: -1, z: 0 }),
});
const OPPOSITE = Object.freeze({
    north: "south", south: "north", west: "east", east: "west", up: "down", down: "up",
});
const MIN_CONNECTION_WIDTH = 2;
const RUN_INDEX_CACHE = new WeakMap();
const DEFAULT_LAYOUT_STYLE = "castle";
const VALID_LAYOUT_STYLES = new Set(["castle", "floating"]);
const ROOM_ID = "castle_part_002_up_r3";
const CROSS_R0_ID = "castle_part_001_up_r0";
const BRIDGE_NS_ID = "castle_part_003_up_r2";
const BRIDGE_EW_ID = "castle_part_003_up_r3";
const STAIR_ASCEND_NORTH_ID = "castle_part_006_east_r2";
const STAIR_ASCEND_SOUTH_ID = "castle_part_005_east_r2";

const TIER_COUNTS = Object.freeze({
    lower: Object.freeze({ room: 6, crossroads: 2, bridge: 2 }),
    middle: Object.freeze({ room: 5, crossroads: 2, bridge: 2 }),
    upper: Object.freeze({ room: 4, crossroads: 2, bridge: 1 }),
});

const STYLE_CONFIG = Object.freeze({
    // The tier offsets turn at right angles so the three masses overlap in plan view.
    castle: Object.freeze({
        middleOffset: Object.freeze({ x: 39, y: 72, z: 145 }),
        upperOffset: Object.freeze({ x: 39, y: 72, z: -113 }),
        lowerMiddleRoutes: Object.freeze([
            Object.freeze({ from: "R3", fromDirection: "south", to: "R1", toDirection: "north" }),
            Object.freeze({ from: "Least", fromDirection: "south", to: "R2", toDirection: "north" }),
        ]),
        lowerMiddleStairId: STAIR_ASCEND_SOUTH_ID,
        middleUpperRoutes: Object.freeze([
            Object.freeze({ from: "R3", fromDirection: "north", to: "A", toDirection: "south" }),
            Object.freeze({ from: "Least", fromDirection: "north", to: "B", toDirection: "south" }),
        ]),
    }),
    // The tiers deliberately drift in one direction to expose the floating silhouette.
    floating: Object.freeze({
        middleOffset: Object.freeze({ x: 0, y: 72, z: -105 }),
        upperOffset: Object.freeze({ x: 0, y: 72, z: -153 }),
        lowerMiddleRoutes: Object.freeze([
            Object.freeze({ from: "R3", fromDirection: "north", to: "R3", toDirection: "south" }),
            Object.freeze({ from: "Least", fromDirection: "north", to: "Least", toDirection: "south" }),
        ]),
        lowerMiddleStairId: STAIR_ASCEND_NORTH_ID,
        middleUpperRoutes: Object.freeze([
            Object.freeze({ from: "R1", fromDirection: "north", to: "A", toDirection: "south" }),
            Object.freeze({ from: "R2", fromDirection: "north", to: "B", toDirection: "south" }),
        ]),
    }),
});

function add(left, right) {
    return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function subtract(left, right) {
    return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function cross(left, right) {
    return {
        x: left.y * right.z - left.z * right.y,
        y: left.z * right.x - left.x * right.z,
        z: left.x * right.y - left.y * right.x,
    };
}

function dot(left, right) {
    return left.x * right.x + left.y * right.y + left.z * right.z;
}

function pointKey(point) {
    return `${point.x},${point.y},${point.z}`;
}

function translatedPoint(origin, localPoint) {
    return add(origin, localPoint);
}

function usableLaneEntries(placement, socket) {
    return (socket.walkLanes ?? [socket.walkPosition ?? socket.localPosition])
        .map((localPoint, index) => ({
            index,
            localPoint,
            worldPoint: translatedPoint(placement.origin, localPoint),
            structural: socket.structuralByLane?.[index]?.length ?? 0,
        }))
        .filter((entry) => entry.structural === 0);
}

function longestContiguousMatches(matches, widthAxis) {
    const ordered = matches.slice().sort((left, right) =>
        dot(left.from, widthAxis) - dot(right.from, widthAxis)
    );
    let best = [];
    let current = [];
    let previousProjection = null;
    for (const match of ordered) {
        const projection = dot(match.from, widthAxis);
        if (previousProjection === null || projection === previousProjection + 1) {
            current.push(match);
        } else {
            if (current.length > best.length) best = current;
            current = [match];
        }
        previousProjection = projection;
    }
    if (current.length > best.length) best = current;
    return best;
}

function selectedCarveCount(socket, laneIndexes) {
    const points = new Set();
    for (const laneIndex of laneIndexes) {
        for (const point of socket.carveByLane?.[laneIndex] ?? socket.carveMask ?? []) {
            points.add(pointKey(point));
        }
    }
    return points.size;
}

function placementOptionsForSocket(variant, socket, targetPlacement, targetSocket) {
    const outward = DIRECTION_VECTOR[targetSocket.direction];
    const floorNormal = DIRECTION_VECTOR[targetSocket.floorNormal];
    const widthAxis = cross(floorNormal, outward);
    const targetEntries = usableLaneEntries(targetPlacement, targetSocket);
    const localCandidate = { origin: { x: 0, y: 0, z: 0 } };
    const sourceEntries = usableLaneEntries(localCandidate, socket);
    const requiredWidth = Math.min(targetEntries.length, sourceEntries.length);
    if (requiredWidth < MIN_CONNECTION_WIDTH) return [];

    const optionsByOrigin = new Map();
    for (const targetEntry of targetEntries) {
        const wanted = add(targetEntry.worldPoint, outward);
        for (const sourceEntry of sourceEntries) {
            const origin = subtract(wanted, sourceEntry.localPoint);
            const originKey = pointKey(origin);
            if (optionsByOrigin.has(originKey)) continue;

            const sourceByWorld = new Map(sourceEntries.map((entry) => {
                const worldPoint = translatedPoint(origin, entry.localPoint);
                return [pointKey(worldPoint), { ...entry, worldPoint }];
            }));
            const matches = longestContiguousMatches(targetEntries.flatMap((entry) => {
                const from = entry.worldPoint;
                const to = add(from, outward);
                const matchedSource = sourceByWorld.get(pointKey(to));
                if (!matchedSource) return [];
                return [{
                    from,
                    to,
                    fromLaneIndex: entry.index,
                    toLaneIndex: matchedSource.index,
                }];
            }), widthAxis);
            if (matches.length < requiredWidth) continue;

            const fromIndexes = matches.map((match) => match.fromLaneIndex);
            const toIndexes = matches.map((match) => match.toLaneIndex);
            const targetCenter = targetEntries.reduce(
                (sum, entry) => sum + dot(entry.worldPoint, widthAxis), 0
            ) / targetEntries.length;
            const sourceCenter = sourceEntries.reduce(
                (sum, entry) => sum + dot(translatedPoint(origin, entry.localPoint), widthAxis), 0
            ) / sourceEntries.length;
            const seamCenter = matches.reduce(
                (sum, match) => sum + dot(match.from, widthAxis), 0
            ) / matches.length;
            optionsByOrigin.set(originKey, {
                placement: {
                    variant,
                    usedSockets: new Set([socket]),
                    origin,
                },
                matches,
                centerBias: Math.abs(targetCenter - seamCenter) + Math.abs(sourceCenter - seamCenter),
                carveCount: selectedCarveCount(targetSocket, fromIndexes)
                    + selectedCarveCount(socket, toIndexes),
            });
        }
    }
    return [...optionsByOrigin.values()].sort((left, right) =>
        right.matches.length - left.matches.length
        || left.centerBias - right.centerBias
        || left.carveCount - right.carveCount
        || left.placement.origin.x - right.placement.origin.x
        || left.placement.origin.y - right.placement.origin.y
        || left.placement.origin.z - right.placement.origin.z
    );
}

function boundsForPlacement(placement) {
    return {
        minX: placement.origin.x,
        minY: placement.origin.y,
        minZ: placement.origin.z,
        maxX: placement.origin.x + placement.variant.size.x - 1,
        maxY: placement.origin.y + placement.variant.size.y - 1,
        maxZ: placement.origin.z + placement.variant.size.z - 1,
    };
}

function boundsIntersect(left, right) {
    return left.minX <= right.maxX && right.minX <= left.maxX
        && left.minY <= right.maxY && right.minY <= left.maxY
        && left.minZ <= right.maxZ && right.minZ <= left.maxZ;
}

function indexedRuns(variant, runKind) {
    let indexes = RUN_INDEX_CACHE.get(variant);
    if (!indexes) {
        indexes = {};
        RUN_INDEX_CACHE.set(variant, indexes);
    }
    if (indexes[runKind]) return indexes[runKind];
    const rows = new Map();
    for (const [y, z, startX, endX] of variant[runKind]) {
        const rowKey = `${y},${z}`;
        const intervals = rows.get(rowKey) ?? [];
        intervals.push([startX, endX]);
        rows.set(rowKey, intervals);
    }
    indexes[runKind] = rows;
    return rows;
}

function runsIntersect(leftVariant, leftKind, leftOrigin, rightVariant, rightKind, rightOrigin) {
    const rightRows = indexedRuns(rightVariant, rightKind);
    for (const [y, z, startX, endX] of leftVariant[leftKind]) {
        const rightY = leftOrigin.y + y - rightOrigin.y;
        const rightZ = leftOrigin.z + z - rightOrigin.z;
        const intervals = rightRows.get(`${rightY},${rightZ}`);
        if (!intervals) continue;
        const relativeStart = leftOrigin.x + startX - rightOrigin.x;
        const relativeEnd = leftOrigin.x + endX - rightOrigin.x;
        if (intervals.some(([otherStart, otherEnd]) =>
            relativeStart <= otherEnd && otherStart <= relativeEnd
        )) return true;
    }
    return false;
}

function runIntersectionCellCount(
    leftVariant, leftKind, leftOrigin, rightVariant, rightKind, rightOrigin, stopAfter
) {
    const rightRows = indexedRuns(rightVariant, rightKind);
    let count = 0;
    for (const [y, z, startX, endX] of leftVariant[leftKind]) {
        const rightY = leftOrigin.y + y - rightOrigin.y;
        const rightZ = leftOrigin.z + z - rightOrigin.z;
        const intervals = rightRows.get(`${rightY},${rightZ}`);
        if (!intervals) continue;
        const relativeStart = leftOrigin.x + startX - rightOrigin.x;
        const relativeEnd = leftOrigin.x + endX - rightOrigin.x;
        for (const [otherStart, otherEnd] of intervals) {
            const overlapStart = Math.max(relativeStart, otherStart);
            const overlapEnd = Math.min(relativeEnd, otherEnd);
            if (overlapStart > overlapEnd) continue;
            count += overlapEnd - overlapStart + 1;
            if (count > stopAfter) return count;
        }
    }
    return count;
}

function placementsConflict(candidate, existing) {
    if (!boundsIntersect(boundsForPlacement(candidate), boundsForPlacement(existing))) return false;
    const solidWalkConflict = runsIntersect(
        candidate.variant, "solidRuns", candidate.origin,
        existing.variant, "walkRuns", existing.origin
    ) || runsIntersect(
        candidate.variant, "walkRuns", candidate.origin,
        existing.variant, "solidRuns", existing.origin
    );
    if (solidWalkConflict) return true;
    const solidConflict = runsIntersect(
        candidate.variant, "solidRuns", candidate.origin,
        existing.variant, "solidRuns", existing.origin
    );
    if (!solidConflict) return false;

    // Adjacent authored rooms have tiny roof-eave ornaments at their diagonal corners.
    // Allow only that decorative contact; full room overlap and every walk-route overlap stay invalid.
    if (candidate.variant.category === "room" && existing.variant.category === "room") {
        return runIntersectionCellCount(
            candidate.variant, "solidRuns", candidate.origin,
            existing.variant, "solidRuns", existing.origin,
            24
        ) > 24;
    }
    return true;
}

function canOccupy(placement, existingPlacements) {
    return existingPlacements.every((existing) => !placementsConflict(placement, existing));
}

function selectedWorldCarve(placement, socket, laneIndexes) {
    const unique = new Map();
    for (const laneIndex of laneIndexes) {
        for (const localPoint of socket.carveByLane?.[laneIndex] ?? socket.carveMask ?? []) {
            const worldPoint = translatedPoint(placement.origin, localPoint);
            unique.set(pointKey(worldPoint), worldPoint);
        }
    }
    return [...unique.values()];
}

function connectionBetween(fromPlacement, fromSocket, toPlacement, toSocket, option, layer) {
    const matches = option.matches;
    const middle = matches[Math.floor(matches.length / 2)];
    const fromLaneIndexes = [...new Set(matches.map((match) => match.fromLaneIndex))];
    const toLaneIndexes = [...new Set(matches.map((match) => match.toLaneIndex))];
    return {
        mode: "authored_seam",
        from: { ...middle.from },
        to: { ...middle.to },
        fromLanes: matches.map((match) => ({ ...match.from })),
        toLanes: matches.map((match) => ({ ...match.to })),
        fromCarve: selectedWorldCarve(fromPlacement, fromSocket, fromLaneIndexes),
        toCarve: selectedWorldCarve(toPlacement, toSocket, toLaneIndexes),
        fromVariantId: fromPlacement.variant.id,
        toVariantId: toPlacement.variant.id,
        floorNormal: fromSocket.floorNormal,
        opening: {
            width: matches.length,
            height: Math.min(3, fromSocket.opening.height, toSocket.opening.height),
        },
        layer,
    };
}

function samePoint(left, right) {
    return left.x === right.x && left.y === right.y && left.z === right.z;
}

function variantIndex(candidates) {
    return new Map(candidates.map((variant) => [variant.id, variant]));
}

function socketFacing(placement, direction) {
    const socket = placement.variant.sockets.find((candidate) => candidate.direction === direction);
    if (!socket) throw new Error(`${placement.variant.id} has no ${direction} socket`);
    return socket;
}

function newPlanState(candidates) {
    return {
        variants: variantIndex(candidates),
        placements: [],
        connections: [],
        byKey: new Map(),
        nextPlacementId: 0,
    };
}

function registerPlacement(state, key, variant, origin, tier, layer = tier) {
    if (state.byKey.has(key)) throw new Error(`duplicate placement key ${key}`);
    const placement = {
        placementId: `p${String(state.nextPlacementId).padStart(2, "0")}`,
        key,
        variant,
        origin: { ...origin },
        tier,
        layer,
        usedSockets: new Set(),
    };
    state.nextPlacementId += 1;
    if (!canOccupy(placement, state.placements)) {
        throw new Error(`${key} conflicts at ${pointKey(origin)}`);
    }
    state.placements.push(placement);
    state.byKey.set(key, placement);
    return placement;
}

function registerFixedPlacement(state, key, variantId, base, relative, tier) {
    const variant = state.variants.get(variantId);
    if (!variant) throw new Error(`missing generated variant ${variantId}`);
    return registerPlacement(state, key, variant, add(base, relative), tier);
}

function matchingExistingOption(fromPlacement, fromSocket, toPlacement, toSocket) {
    return placementOptionsForSocket(
        toPlacement.variant, toSocket, fromPlacement, fromSocket
    ).find((option) => samePoint(option.placement.origin, toPlacement.origin));
}

function registerConnection(
    state, fromPlacement, fromDirection, toPlacement, toDirection,
    { tier, transition = "horizontal", routeId = null } = {}
) {
    const fromSocket = socketFacing(fromPlacement, fromDirection);
    const toSocket = socketFacing(toPlacement, toDirection);
    if (fromPlacement.usedSockets.has(fromSocket)) {
        throw new Error(`${fromPlacement.key}.${fromDirection} is already connected`);
    }
    if (toPlacement.usedSockets.has(toSocket)) {
        throw new Error(`${toPlacement.key}.${toDirection} is already connected`);
    }
    const option = matchingExistingOption(fromPlacement, fromSocket, toPlacement, toSocket);
    if (!option) {
        throw new Error(
            `authored seam does not match ${fromPlacement.key}.${fromDirection}`
            + ` -> ${toPlacement.key}.${toDirection}`
        );
    }
    fromPlacement.usedSockets.add(fromSocket);
    toPlacement.usedSockets.add(toSocket);
    state.connections.push({
        ...connectionBetween(fromPlacement, fromSocket, toPlacement, toSocket, option, tier),
        fromPlacementId: fromPlacement.placementId,
        toPlacementId: toPlacement.placementId,
        fromDirection,
        toDirection,
        tier,
        transition,
        routeId,
    });
}

function attachPlacement(
    state, key, variantId, targetPlacement, targetDirection, sourceDirection,
    tier, layer = tier
) {
    const variant = state.variants.get(variantId);
    if (!variant) throw new Error(`missing generated variant ${variantId}`);
    const targetSocket = socketFacing(targetPlacement, targetDirection);
    const sourceSocket = variant.sockets.find((socket) => socket.direction === sourceDirection);
    if (!sourceSocket) throw new Error(`${variantId} has no ${sourceDirection} socket`);
    if (targetPlacement.usedSockets.has(targetSocket)) {
        throw new Error(`${targetPlacement.key}.${targetDirection} is already connected`);
    }
    const option = placementOptionsForSocket(variant, sourceSocket, targetPlacement, targetSocket)
        .find((candidate) => canOccupy(candidate.placement, state.placements));
    if (!option) {
        const geometric = placementOptionsForSocket(
            variant, sourceSocket, targetPlacement, targetSocket
        )[0]?.placement;
        const conflicts = geometric
            ? state.placements.filter((existing) => placementsConflict(geometric, existing))
                .map((existing) => existing.key).join(",")
            : "no authored alignment";
        throw new Error(
            `cannot attach ${key} to ${targetPlacement.key}.${targetDirection}; conflicts=${conflicts}`
        );
    }
    const placement = registerPlacement(
        state, key, variant, option.placement.origin, tier, layer
    );
    targetPlacement.usedSockets.add(targetSocket);
    placement.usedSockets.add(sourceSocket);
    state.connections.push({
        ...connectionBetween(
            targetPlacement, targetSocket, placement, sourceSocket, option, tier
        ),
        fromPlacementId: targetPlacement.placementId,
        toPlacementId: placement.placementId,
        fromDirection: targetDirection,
        toDirection: sourceDirection,
        tier,
        transition: "horizontal",
        routeId: null,
    });
    return placement;
}

function buildCompactTierLoop(state, tier, base) {
    const prefix = `${tier}.`;
    const A = registerFixedPlacement(state, `${prefix}A`, CROSS_R0_ID, base, { x: 0, y: 0, z: 0 }, tier);
    const R1 = registerFixedPlacement(state, `${prefix}R1`, ROOM_ID, base, { x: 3, y: 27, z: -37 }, tier);
    const bridge = registerFixedPlacement(
        state, `${prefix}BE`, BRIDGE_EW_ID, base, { x: 40, y: 0, z: -25 }, tier
    );
    const R2 = registerFixedPlacement(state, `${prefix}R2`, ROOM_ID, base, { x: 82, y: 27, z: -37 }, tier);
    const B = registerFixedPlacement(state, `${prefix}B`, CROSS_R0_ID, base, { x: 79, y: 0, z: 0 }, tier);
    const R3 = registerFixedPlacement(state, `${prefix}R3`, ROOM_ID, base, { x: 42, y: 27, z: 3 }, tier);

    registerConnection(state, A, "north", R1, "south", { tier });
    registerConnection(state, R1, "east", bridge, "west", { tier });
    registerConnection(state, bridge, "east", R2, "west", { tier });
    registerConnection(state, R2, "south", B, "north", { tier });
    registerConnection(state, B, "west", R3, "east", { tier });
    registerConnection(state, R3, "west", A, "east", { tier });
    return { A, B, R1, R2, R3 };
}

function addRoomBranch(state, tierNodes, tier, placementName, direction) {
    const target = tierNodes[placementName];
    const room = attachPlacement(
        state, `${tier}.L${direction}`, ROOM_ID,
        target, direction, OPPOSITE[direction], tier
    );
    tierNodes[`L${direction}`] = room;
    return room;
}

function addBridgeRoomBranch(state, tierNodes, tier, placementName, direction) {
    const target = tierNodes[placementName];
    const bridgeId = direction === "north" || direction === "south"
        ? BRIDGE_NS_ID
        : BRIDGE_EW_ID;
    const bridge = attachPlacement(
        state, `${tier}.L${direction}.bridge`, bridgeId,
        target, direction, OPPOSITE[direction], tier
    );
    const room = attachPlacement(
        state, `${tier}.L${direction}`, ROOM_ID,
        bridge, direction, OPPOSITE[direction], tier
    );
    tierNodes[`L${direction}Bridge`] = bridge;
    tierNodes[`L${direction}`] = room;
    return room;
}

function buildHorizontalTiers(state, anchor, styleConfig) {
    const lowerBase = { ...anchor };
    const middleBase = add(lowerBase, styleConfig.middleOffset);
    const upperBase = add(middleBase, styleConfig.upperOffset);
    const lower = buildCompactTierLoop(state, "lower", lowerBase);
    addBridgeRoomBranch(state, lower, "lower", "A", "south");
    addRoomBranch(state, lower, "lower", "A", "west");
    addRoomBranch(state, lower, "lower", "B", "east");

    const middle = buildCompactTierLoop(state, "middle", middleBase);
    addBridgeRoomBranch(state, middle, "middle", "A", "south");
    addRoomBranch(state, middle, "middle", "B", "east");

    const upper = buildCompactTierLoop(state, "upper", upperBase);
    addRoomBranch(state, upper, "upper", "A", "west");
    return { lower, middle, upper, bases: { lower: lowerBase, middle: middleBase, upper: upperBase } };
}

function connectStairRoute(
    state, routeId, fromPlacement, fromDirection, toPlacement, toDirection,
    stairVariantId, tier
) {
    const first = attachPlacement(
        state, `${routeId}.stair1`, stairVariantId,
        fromPlacement, fromDirection, OPPOSITE[fromDirection], tier, "vertical"
    );
    const highDirection = fromDirection;
    const second = attachPlacement(
        state, `${routeId}.stair2`, stairVariantId,
        first, highDirection, OPPOSITE[highDirection], tier, "vertical"
    );
    const firstConnection = state.connections[state.connections.length - 2];
    const secondConnection = state.connections[state.connections.length - 1];
    for (const connection of [firstConnection, secondConnection]) {
        connection.transition = "vertical";
        connection.routeId = routeId;
    }
    registerConnection(state, second, highDirection, toPlacement, toDirection, {
        tier,
        transition: "vertical",
        routeId,
    });
}

function connectTierRoutes(state, tiers, styleConfig) {
    styleConfig.lowerMiddleRoutes.forEach((route, index) => connectStairRoute(
        state,
        `lower_middle_${index + 1}`,
        tiers.lower[route.from], route.fromDirection,
        tiers.middle[route.to], route.toDirection,
        styleConfig.lowerMiddleStairId,
        "transition_lower_middle"
    ));
    styleConfig.middleUpperRoutes.forEach((route, index) => connectStairRoute(
        state,
        `middle_upper_${index + 1}`,
        tiers.middle[route.from], route.fromDirection,
        tiers.upper[route.to], route.toDirection,
        STAIR_ASCEND_NORTH_ID,
        "transition_middle_upper"
    ));
}

function sealedSocketsForPlan(placements) {
    const sealed = [];
    for (const placement of placements) {
        if (placement.variant.category === "room") continue;
        for (const socket of placement.variant.sockets) {
            if (placement.usedSockets.has(socket)) continue;
            sealed.push({
                placementId: placement.placementId,
                variantId: placement.variant.id,
                tier: placement.tier,
                direction: socket.direction,
                floorNormal: socket.floorNormal,
                localPosition: { ...socket.localPosition },
                localWalkLanes: (socket.walkLanes
                    ?? [socket.walkPosition ?? socket.localPosition]
                ).map((point) => ({ ...point })),
                opening: { ...socket.opening },
                reason: "unused_authored_socket",
            });
        }
    }
    return sealed;
}

function categoryCounts(placements, tier) {
    const result = { room: 0, crossroads: 0, bridge: 0, stairs: 0 };
    for (const placement of placements) {
        if (placement.tier !== tier) continue;
        result[placement.variant.category] += 1;
    }
    return result;
}

function validateLayeredState(state) {
    if (state.placements.length !== 34) throw new Error("layered plan must contain 34 placements");
    const expected = { room: 15, crossroads: 6, bridge: 5, stairs: 8 };
    const actual = { room: 0, crossroads: 0, bridge: 0, stairs: 0 };
    for (const placement of state.placements) actual[placement.variant.category] += 1;
    for (const category of Object.keys(expected)) {
        if (actual[category] !== expected[category]) {
            throw new Error(`${category} count ${actual[category]} != ${expected[category]}`);
        }
    }
    for (const [tier, counts] of Object.entries(TIER_COUNTS)) {
        const observed = categoryCounts(state.placements, tier);
        for (const category of ["room", "crossroads", "bridge"]) {
            if (observed[category] !== counts[category]) {
                throw new Error(`${tier}.${category} count ${observed[category]} != ${counts[category]}`);
            }
        }
    }
    if (state.connections.length !== 38) {
        throw new Error(`layered plan must contain 38 connections, got ${state.connections.length}`);
    }
}

function serializePlacement(placement) {
    return {
        placementId: placement.placementId,
        variantId: placement.variant.id,
        structureId: placement.variant.structureId,
        source: placement.variant.source,
        displayName: placement.variant.displayName,
        category: placement.variant.category,
        floorNormal: placement.variant.floorNormal,
        authoredFloorNormal: placement.variant.authoredFloorNormal,
        navigationValidated: placement.variant.navigationValidated,
        routeWidth: placement.variant.routeWidth,
        verticalSpan: placement.variant.verticalSpan,
        size: placement.variant.size,
        origin: placement.origin,
        layer: placement.layer,
        tier: placement.tier,
    };
}

export function createSourcePartsPlan(seed, anchor, options = {}) {
    const style = options.style ?? DEFAULT_LAYOUT_STYLE;
    if (!VALID_LAYOUT_STYLES.has(style)) {
        throw new Error(`unknown source-parts layout style ${style}`);
    }
    const traversalCandidates = GENERATED_SOURCE_VARIANTS.filter((variant) =>
        variant.navigationValidated === true
        && variant.floorNormal === "up"
        && variant.sockets.every((socket) => HORIZONTAL_DIRECTIONS.has(socket.direction))
    );
    const state = newPlanState(traversalCandidates);
    const tiers = buildHorizontalTiers(state, anchor, STYLE_CONFIG[style]);
    connectTierRoutes(state, tiers, STYLE_CONFIG[style]);
    validateLayeredState(state);
    const sealedSockets = sealedSocketsForPlan(state.placements);
    return {
        schemaVersion: 5,
        seed,
        style,
        attempt: 0,
        attemptLimit: 1,
        tierBases: tiers.bases,
        tierCounts: TIER_COUNTS,
        placements: state.placements.map(serializePlacement),
        connections: state.connections,
        sealedSockets,
    };
}
