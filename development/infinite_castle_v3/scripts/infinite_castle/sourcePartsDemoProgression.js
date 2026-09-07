export const SOURCE_PARTS_DEMO_PROGRESSION_SCHEMA_VERSION = 1;
export const SOURCE_PARTS_DEMO_ROOM_COUNT = 15;

export const SOURCE_PARTS_DEMO_ROLE_COUNTS = Object.freeze({
    entrance: 1,
    key: 3,
    reward: 7,
    miniboss: 2,
    final: 1,
    exit: 1,
});

const TIERS = Object.freeze(["lower", "middle", "upper"]);
const TIER_LEVEL = Object.freeze({ lower: 0, middle: 1, upper: 2 });
const MIN_VERTICAL_DIRECTION_CHANGES = 2;

const OBJECTIVE_SPECS = Object.freeze([
    Object.freeze({ id: "entrance", role: "entrance", roleIndex: 1 }),
    Object.freeze({ id: "key_1", role: "key", roleIndex: 1 }),
    Object.freeze({ id: "miniboss_1", role: "miniboss", roleIndex: 1 }),
    Object.freeze({ id: "key_2", role: "key", roleIndex: 2 }),
    Object.freeze({ id: "miniboss_2", role: "miniboss", roleIndex: 2 }),
    Object.freeze({ id: "key_3", role: "key", roleIndex: 3 }),
    Object.freeze({ id: "final", role: "final", roleIndex: 1 }),
    Object.freeze({ id: "exit", role: "exit", roleIndex: 1 }),
]);

const REWARD_UNLOCK_OBJECTIVES = Object.freeze([
    "entrance",
    "key_1",
    "miniboss_1",
    "key_2",
    "miniboss_2",
    "key_3",
    "final",
]);

function createRng(seed) {
    let value = seed >>> 0;
    return () => {
        value = (value + 0x6d2b79f5) | 0;
        let next = Math.imul(value ^ (value >>> 15), 1 | value);
        next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
        return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffled(values, rng) {
    const result = values.slice();
    for (let index = result.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(rng() * (index + 1));
        [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
}

function requireSeed(seed) {
    if (!Number.isFinite(seed)) throw new Error("demo progression seed must be a finite number");
    return Math.trunc(seed) >>> 0;
}

function requireId(value, label) {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`${label} must be a non-empty string`);
    }
    return value;
}

function roomTier(value, label) {
    if (!TIERS.includes(value)) {
        throw new Error(`${label} must be lower, middle, or upper; received ${String(value)}`);
    }
    return value;
}

function placementId(placement, index) {
    return requireId(placement?.placementId ?? placement?.id ?? `p${index}`, `placement[${index}] id`);
}

function planConnectionEndpoint(connection, side, placementIds) {
    const direct = connection?.[`${side}PlacementId`]
        ?? connection?.[`${side}Id`]
        ?? (typeof connection?.[side] === "string" ? connection[side] : undefined);
    if (typeof direct === "string" && direct.length > 0) return direct;

    const rawIndex = connection?.[`${side}PlacementIndex`] ?? connection?.[`${side}Index`];
    if (Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < placementIds.length) {
        return placementIds[rawIndex];
    }
    return null;
}

function directLinkEndpoint(link, side, index) {
    if (Array.isArray(link)) return requireId(link[side === "from" ? 0 : 1], `links[${index}] ${side}`);
    return requireId(
        link?.[`${side}RoomId`] ?? link?.[`${side}Id`] ?? link?.[side],
        `links[${index}] ${side}`
    );
}

function addUndirectedLink(adjacency, from, to, label) {
    if (!adjacency.has(from)) throw new Error(`${label} references unknown node ${from}`);
    if (!adjacency.has(to)) throw new Error(`${label} references unknown node ${to}`);
    if (from === to) return;
    adjacency.get(from).add(to);
    adjacency.get(to).add(from);
}

function assertUniqueIds(ids, label) {
    const seen = new Set();
    for (const id of ids) {
        if (seen.has(id)) throw new Error(`${label} contains duplicate id ${id}`);
        seen.add(id);
    }
}

function normalizeDirectTopology(topology) {
    const rawRooms = topology.rooms;
    const rooms = rawRooms.map((room, index) => ({
        roomId: requireId(room?.roomId ?? room?.placementId ?? room?.id, `rooms[${index}] id`),
        placementId: requireId(
            room?.placementId ?? room?.roomId ?? room?.id,
            `rooms[${index}] placement id`
        ),
        tier: roomTier(room?.tier ?? room?.layer, `rooms[${index}] tier`),
        sourceIndex: Number.isInteger(room?.sourceIndex) ? room.sourceIndex : index,
    }));
    assertUniqueIds(rooms.map((room) => room.roomId), "rooms");

    const nodeIds = rooms.map((room) => room.placementId);
    assertUniqueIds(nodeIds, "room placement ids");
    const adjacency = new Map(nodeIds.map((id) => [id, new Set()]));
    for (const [index, link] of (topology.links ?? []).entries()) {
        const from = directLinkEndpoint(link, "from", index);
        const to = directLinkEndpoint(link, "to", index);
        addUndirectedLink(adjacency, from, to, `links[${index}]`);
    }
    return { rooms, adjacency };
}

function normalizePlanTopology(plan) {
    const placements = plan.placements;
    const placementIds = placements.map(placementId);
    assertUniqueIds(placementIds, "placements");
    const adjacency = new Map(placementIds.map((id) => [id, new Set()]));

    for (const [index, connection] of (plan.connections ?? []).entries()) {
        const from = planConnectionEndpoint(connection, "from", placementIds);
        const to = planConnectionEndpoint(connection, "to", placementIds);
        if (!from || !to) {
            throw new Error(
                `connections[${index}] needs fromPlacementId/toPlacementId (or placement indexes)`
            );
        }
        addUndirectedLink(adjacency, from, to, `connections[${index}]`);
    }

    const rooms = [];
    for (let index = 0; index < placements.length; index += 1) {
        const placement = placements[index];
        if (placement?.category !== "room") continue;
        const id = placementIds[index];
        rooms.push({
            roomId: id,
            placementId: id,
            tier: roomTier(placement?.tier ?? placement?.layer, `placement ${id} room tier`),
            sourceIndex: index,
        });
    }
    return { rooms, adjacency };
}

function reachableNodes(adjacency, start) {
    const visited = new Set([start]);
    const queue = [start];
    for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index];
        for (const neighbor of adjacency.get(current) ?? []) {
            if (visited.has(neighbor)) continue;
            visited.add(neighbor);
            queue.push(neighbor);
        }
    }
    return visited;
}

function normalizeTopology(input) {
    if (!input || typeof input !== "object") throw new Error("demo progression topology is required");
    const normalized = Array.isArray(input.rooms)
        ? normalizeDirectTopology(input)
        : (Array.isArray(input.placements) ? normalizePlanTopology(input) : null);
    if (!normalized) throw new Error("topology needs rooms/links or placements/connections");
    if (normalized.rooms.length !== SOURCE_PARTS_DEMO_ROOM_COUNT) {
        throw new Error(
            `demo progression needs exactly ${SOURCE_PARTS_DEMO_ROOM_COUNT} rooms; `
            + `received ${normalized.rooms.length}`
        );
    }

    const tierSet = new Set(normalized.rooms.map((room) => room.tier));
    for (const tier of TIERS) {
        if (!tierSet.has(tier)) throw new Error(`demo progression needs at least one ${tier} room`);
    }

    const firstRoom = normalized.rooms[0];
    const reachable = reachableNodes(normalized.adjacency, firstRoom.placementId);
    const unreachableRooms = normalized.rooms.filter((room) => !reachable.has(room.placementId));
    if (unreachableRooms.length > 0) {
        throw new Error(`room graph is disconnected at ${unreachableRooms[0].roomId}`);
    }
    return normalized;
}

function tierDirection(fromTier, toTier) {
    const delta = TIER_LEVEL[toTier] - TIER_LEVEL[fromTier];
    if (delta > 0) return "up";
    if (delta < 0) return "down";
    return "same";
}

function routePatternStats(rooms) {
    const tiers = rooms.map((room) => room.tier);
    const legDirections = [];
    for (let index = 1; index < tiers.length; index += 1) {
        legDirections.push(tierDirection(tiers[index - 1], tiers[index]));
    }
    const verticalDirections = legDirections.filter((direction) => direction !== "same");
    let directionChanges = 0;
    for (let index = 1; index < verticalDirections.length; index += 1) {
        if (verticalDirections[index] !== verticalDirections[index - 1]) directionChanges += 1;
    }
    return {
        tiers,
        legDirections,
        verticalDirections,
        directionChanges,
        usesAllTiers: TIERS.every((tier) => tiers.includes(tier)),
        hasUp: verticalDirections.includes("up"),
        hasDown: verticalDirections.includes("down"),
    };
}

function validRoutePattern(rooms) {
    const stats = routePatternStats(rooms);
    return stats.usesAllTiers
        && stats.hasUp
        && stats.hasDown
        && stats.directionChanges >= MIN_VERTICAL_DIRECTION_CHANGES;
}

function exhaustiveValidOrder(rooms) {
    const used = new Array(rooms.length).fill(false);
    const ordered = [];
    function visit() {
        if (ordered.length === rooms.length) return validRoutePattern(ordered) ? ordered.slice() : null;
        for (let index = 0; index < rooms.length; index += 1) {
            if (used[index]) continue;
            used[index] = true;
            ordered.push(rooms[index]);
            const result = visit();
            if (result) return result;
            ordered.pop();
            used[index] = false;
        }
        return null;
    }
    return visit();
}

function chooseObjectiveRooms(rooms, rng) {
    const selected = [];
    const selectedIds = new Set();
    for (const tier of shuffled(TIERS, rng)) {
        const candidate = shuffled(rooms.filter((room) => room.tier === tier), rng)[0];
        selected.push(candidate);
        selectedIds.add(candidate.roomId);
    }
    const remaining = shuffled(rooms.filter((room) => !selectedIds.has(room.roomId)), rng);
    selected.push(...remaining.slice(0, OBJECTIVE_SPECS.length - selected.length));

    for (let attempt = 0; attempt < 256; attempt += 1) {
        const ordered = shuffled(selected, rng);
        if (validRoutePattern(ordered)) return ordered;
    }
    const fallback = exhaustiveValidOrder(shuffled(selected, rng));
    if (fallback) return fallback;
    throw new Error("could not create a non-monotonic three-tier objective route");
}

function compareIds(left, right) {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
}

function shortestPath(adjacency, from, to) {
    if (from === to) return [from];
    const previous = new Map([[from, null]]);
    const queue = [from];
    for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index];
        const neighbors = [...(adjacency.get(current) ?? [])].sort(compareIds);
        for (const neighbor of neighbors) {
            if (previous.has(neighbor)) continue;
            previous.set(neighbor, current);
            if (neighbor === to) {
                const path = [to];
                let cursor = current;
                while (cursor !== null) {
                    path.push(cursor);
                    cursor = previous.get(cursor);
                }
                return path.reverse();
            }
            queue.push(neighbor);
        }
    }
    throw new Error(`no route between ${from} and ${to}`);
}

function requiredRoute(objectives, roomById, adjacency) {
    const legs = [];
    const placementPath = [];
    for (let index = 1; index < objectives.length; index += 1) {
        const from = objectives[index - 1];
        const to = objectives[index];
        const fromRoom = roomById.get(from.roomId);
        const toRoom = roomById.get(to.roomId);
        const path = shortestPath(adjacency, fromRoom.placementId, toRoom.placementId);
        if (placementPath.length === 0) placementPath.push(...path);
        else placementPath.push(...path.slice(1));
        legs.push({
            fromObjectiveId: from.id,
            toObjectiveId: to.id,
            fromRoomId: from.roomId,
            toRoomId: to.roomId,
            fromTier: from.tier,
            toTier: to.tier,
            direction: tierDirection(from.tier, to.tier),
            placementIds: path,
        });
    }

    const stats = routePatternStats(objectives);
    return {
        objectiveRoomIds: objectives.map((objective) => objective.roomId),
        objectiveTiers: stats.tiers,
        legDirections: stats.legDirections,
        verticalDirections: stats.verticalDirections,
        verticalDirectionChanges: stats.directionChanges,
        placementIds: placementPath,
        legs,
    };
}

function roleCount(rooms) {
    const result = { entrance: 0, key: 0, reward: 0, miniboss: 0, final: 0, exit: 0 };
    for (const room of rooms) result[room.role] += 1;
    return result;
}

export function createSourcePartsDemoProgression(seed, topologyOrPlan) {
    const normalizedSeed = requireSeed(seed);
    const topology = normalizeTopology(topologyOrPlan);
    const rng = createRng(normalizedSeed);
    const objectiveRooms = chooseObjectiveRooms(topology.rooms, rng);

    const requiredObjectives = OBJECTIVE_SPECS.map((spec, index) => ({
        id: spec.id,
        order: index,
        role: spec.role,
        roleIndex: spec.roleIndex,
        roomId: objectiveRooms[index].roomId,
        tier: objectiveRooms[index].tier,
        requiresObjectiveIds: index === 0 ? [] : [OBJECTIVE_SPECS[index - 1].id],
    }));

    const assignments = new Map(requiredObjectives.map((objective) => [objective.roomId, {
        role: objective.role,
        roleIndex: objective.roleIndex,
        roleId: objective.id,
        required: true,
        objectiveId: objective.id,
        objectiveOrder: objective.order,
        requiresObjectiveIds: objective.requiresObjectiveIds,
    }]));

    const rewardRooms = shuffled(
        topology.rooms.filter((room) => !assignments.has(room.roomId)),
        rng
    );
    const rewardUnlocks = shuffled(REWARD_UNLOCK_OBJECTIVES, rng);
    rewardRooms.forEach((room, index) => assignments.set(room.roomId, {
        role: "reward",
        roleIndex: index + 1,
        roleId: `reward_${index + 1}`,
        required: false,
        objectiveId: null,
        objectiveOrder: null,
        requiresObjectiveIds: [rewardUnlocks[index]],
    }));

    const rooms = topology.rooms.map((room) => ({
        roomId: room.roomId,
        placementId: room.placementId,
        sourceIndex: room.sourceIndex,
        tier: room.tier,
        ...assignments.get(room.roomId),
    }));
    const roomById = new Map(topology.rooms.map((room) => [room.roomId, room]));
    const route = requiredRoute(requiredObjectives, roomById, topology.adjacency);

    return {
        schemaVersion: SOURCE_PARTS_DEMO_PROGRESSION_SCHEMA_VERSION,
        mode: "demo_metadata_only",
        seed: normalizedSeed,
        roomCount: rooms.length,
        roleCounts: roleCount(rooms),
        requiredKeyCount: SOURCE_PARTS_DEMO_ROLE_COUNTS.key,
        requiredMinibossCount: SOURCE_PARTS_DEMO_ROLE_COUNTS.miniboss,
        rooms,
        requiredObjectives,
        requiredRoute: route,
    };
}
