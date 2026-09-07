import {
    SOURCE_PARTS_DEMO_ROLE_COUNTS,
    SOURCE_PARTS_DEMO_ROOM_COUNT,
    createSourcePartsDemoProgression,
} from "./sourcePartsDemoProgression.js";
import {
    SOURCE_PARTS_DEMO_STATE_SCHEMA_VERSION,
    parseSourcePartsDemoProgressionState,
    serializeSourcePartsDemoProgressionState,
} from "./sourcePartsDemoProgressionState.js";

export const SOURCE_PARTS_DEMO_RUNTIME_RECORD_VERSION = 1;
export const SOURCE_PARTS_DEMO_DYNAMIC_PROPERTY_LIMIT = 32767;

export const SOURCE_PARTS_DEMO_AUTO_COMPLETE_ROLES = Object.freeze([
    "entrance",
    "key",
    "reward",
    "exit",
]);

const TIER_CODES = Object.freeze(["lower", "middle", "upper"]);
const VALID_STATUSES = new Set(["locked", "available", "complete"]);

function requireString(value, label) {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`${label} must be a non-empty string`);
    }
    return value;
}

function requireInteger(value, label) {
    if (!Number.isFinite(value) || Math.trunc(value) !== value) {
        throw new Error(`${label} must be an integer`);
    }
    return value;
}

function requirePositiveInteger(value, label) {
    const result = requireInteger(value, label);
    if (result < 1) throw new Error(`${label} must be positive`);
    return result;
}

function compactBounds(placement, roomId) {
    const minX = requireInteger(placement?.origin?.x, `${roomId} origin.x`);
    const minY = requireInteger(placement?.origin?.y, `${roomId} origin.y`);
    const minZ = requireInteger(placement?.origin?.z, `${roomId} origin.z`);
    const sizeX = requirePositiveInteger(placement?.size?.x, `${roomId} size.x`);
    const sizeY = requirePositiveInteger(placement?.size?.y, `${roomId} size.y`);
    const sizeZ = requirePositiveInteger(placement?.size?.z, `${roomId} size.z`);
    return [minX, minY, minZ, minX + sizeX, minY + sizeY, minZ + sizeZ];
}

function planPlacementId(placement, index) {
    return requireString(placement?.placementId ?? placement?.id ?? `p${index}`, `placement[${index}] id`);
}

function connectionEndpointIndex(connection, side, placementIds, placementIndexById, index) {
    const directId = connection?.[`${side}PlacementId`]
        ?? connection?.[`${side}Id`]
        ?? (typeof connection?.[side] === "string" ? connection[side] : undefined);
    if (typeof directId === "string") {
        const resolved = placementIndexById.get(directId);
        if (resolved === undefined) {
            throw new Error(`connections[${index}] references unknown ${side} placement ${directId}`);
        }
        return resolved;
    }
    const directIndex = connection?.[`${side}PlacementIndex`] ?? connection?.[`${side}Index`];
    if (Number.isInteger(directIndex) && directIndex >= 0 && directIndex < placementIds.length) {
        return directIndex;
    }
    throw new Error(`connections[${index}] has no ${side} placement endpoint`);
}

function canonicalState(progression, state) {
    return JSON.parse(serializeSourcePartsDemoProgressionState(progression, state));
}

function compactState(progression, state) {
    const normalized = canonicalState(progression, state);
    return [
        normalized.currentRoomId ?? "",
        normalized.visitedRoomIds,
        normalized.completedRoomIds,
    ];
}

function sameProgression(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function nodesFromRecord(compactNodes) {
    if (!Array.isArray(compactNodes) || compactNodes.length < SOURCE_PARTS_DEMO_ROOM_COUNT) {
        throw new Error("runtime record has too few topology nodes");
    }
    const ids = [];
    const placements = compactNodes.map((node, index) => {
        if (!Array.isArray(node) || node.length !== 2) {
            throw new Error(`runtime topology node[${index}] is malformed`);
        }
        const placementId = requireString(node[0], `runtime topology node[${index}] id`);
        const tierCode = requireInteger(node[1], `${placementId} room tier code`);
        if (tierCode < -1 || tierCode >= TIER_CODES.length) {
            throw new Error(`${placementId} has an unknown room tier code`);
        }
        ids.push(placementId);
        return tierCode === -1
            ? { placementId, category: "path", tier: "path" }
            : { placementId, category: "room", tier: TIER_CODES[tierCode] };
    });
    if (new Set(ids).size !== ids.length) throw new Error("runtime topology has duplicate placement ids");
    return { ids, placements };
}

function connectionsFromRecord(compactEdges, ids) {
    if (!Array.isArray(compactEdges)) throw new Error("runtime topology edges must be an array");
    return compactEdges.map((edge, index) => {
        if (!Array.isArray(edge) || edge.length !== 2) {
            throw new Error(`runtime topology edge[${index}] is malformed`);
        }
        const fromIndex = requireInteger(edge[0], `runtime topology edge[${index}] from`);
        const toIndex = requireInteger(edge[1], `runtime topology edge[${index}] to`);
        if (fromIndex < 0 || fromIndex >= ids.length || toIndex < 0 || toIndex >= ids.length) {
            throw new Error(`runtime topology edge[${index}] is outside the node array`);
        }
        return { fromPlacementId: ids[fromIndex], toPlacementId: ids[toIndex] };
    });
}

function boundsFromRecord(compactBoundsList, placements) {
    if (!Array.isArray(compactBoundsList)
        || compactBoundsList.length !== SOURCE_PARTS_DEMO_ROOM_COUNT) {
        throw new Error(`runtime record needs ${SOURCE_PARTS_DEMO_ROOM_COUNT} room AABBs`);
    }
    const result = new Map();
    for (let index = 0; index < compactBoundsList.length; index += 1) {
        const bounds = compactBoundsList[index];
        if (!Array.isArray(bounds) || bounds.length !== 7) {
            throw new Error(`runtime room AABB[${index}] is malformed`);
        }
        const placementIndex = requireInteger(bounds[0], `runtime room AABB[${index}] placement`);
        if (placementIndex < 0 || placementIndex >= placements.length
            || placements[placementIndex].category !== "room") {
            throw new Error(`runtime room AABB[${index}] does not reference a room`);
        }
        if (result.has(placementIndex)) throw new Error("runtime record has duplicate room AABBs");
        const values = bounds.slice(1).map((value, axisIndex) =>
            requireInteger(value, `runtime room AABB[${index}][${axisIndex}]`)
        );
        const [minX, minY, minZ, maxX, maxY, maxZ] = values;
        if (maxX <= minX || maxY <= minY || maxZ <= minZ) {
            throw new Error(`runtime room AABB[${index}] is empty`);
        }
        result.set(placementIndex, { minX, minY, minZ, maxX, maxY, maxZ });
    }
    return result;
}

function hydrateRecord(record) {
    if (!record || typeof record !== "object" || record.v !== SOURCE_PARTS_DEMO_RUNTIME_RECORD_VERSION) {
        throw new Error("unsupported source-parts demo runtime record");
    }
    const dimensionId = requireString(record.d, "runtime dimension id");
    const seed = requireInteger(record.p, "runtime progression seed") >>> 0;
    const topology = nodesFromRecord(record.n);
    const connections = connectionsFromRecord(record.e, topology.ids);
    const progression = createSourcePartsDemoProgression(seed, {
        placements: topology.placements,
        connections,
    });
    const aabbs = boundsFromRecord(record.b, topology.placements);
    const placementIndexById = new Map(topology.ids.map((id, index) => [id, index]));
    const rooms = progression.rooms.map((room) => {
        const placementIndex = placementIndexById.get(room.placementId);
        const bounds = aabbs.get(placementIndex);
        if (!bounds) throw new Error(`runtime record is missing AABB for ${room.roomId}`);
        return { ...room, bounds };
    });

    if (!Array.isArray(record.s) || record.s.length !== 3) {
        throw new Error("runtime record has malformed progression state");
    }
    const rawState = JSON.stringify({
        schemaVersion: SOURCE_PARTS_DEMO_STATE_SCHEMA_VERSION,
        progressionSchemaVersion: progression.schemaVersion,
        progressionSeed: progression.seed,
        currentRoomId: record.s[0] === "" ? null : record.s[0],
        visitedRoomIds: record.s[1],
        completedRoomIds: record.s[2],
        exited: false,
    });
    const state = parseSourcePartsDemoProgressionState(rawState, progression);
    if (!state) throw new Error("runtime record has invalid progression state");
    return { dimensionId, progression, state, rooms, record };
}

export function createSourcePartsDemoRuntimeRecord(plan, progression, state) {
    if (!Array.isArray(plan?.placements)) throw new Error("runtime activation needs plan placements");
    if (!Array.isArray(plan?.connections)) throw new Error("runtime activation needs plan connections");
    const dimensionId = requireString(plan?.dimensionId, "plan dimension id");
    const planSeed = requireInteger(plan?.seed, "plan seed") >>> 0;
    if (progression?.seed !== planSeed) {
        throw new Error("progression seed does not match source-parts plan seed");
    }
    const placementIds = plan.placements.map(planPlacementId);
    if (new Set(placementIds).size !== placementIds.length) {
        throw new Error("source-parts plan contains duplicate placement ids");
    }
    const placementIndexById = new Map(placementIds.map((id, index) => [id, index]));
    const compactNodes = plan.placements.map((placement, index) => {
        if (placement?.category !== "room") return [placementIds[index], -1];
        const tierCode = TIER_CODES.indexOf(placement?.tier ?? placement?.layer);
        if (tierCode < 0) throw new Error(`${placementIds[index]} has invalid room tier`);
        return [placementIds[index], tierCode];
    });
    const compactEdges = plan.connections.map((connection, index) => [
        connectionEndpointIndex(connection, "from", placementIds, placementIndexById, index),
        connectionEndpointIndex(connection, "to", placementIds, placementIndexById, index),
    ]);
    const compactRoomBounds = progression.rooms.map((room) => {
        const placementIndex = placementIndexById.get(room.placementId);
        if (placementIndex === undefined) {
            throw new Error(`missing placement for demo room ${room.roomId}`);
        }
        return [placementIndex, ...compactBounds(plan.placements[placementIndex], room.roomId)];
    });
    const record = {
        v: SOURCE_PARTS_DEMO_RUNTIME_RECORD_VERSION,
        d: dimensionId,
        p: planSeed,
        n: compactNodes,
        e: compactEdges,
        b: compactRoomBounds,
        s: compactState(progression, state),
    };
    const hydrated = hydrateRecord(record);
    if (!sameProgression(hydrated.progression, progression)) {
        throw new Error("compact topology does not reproduce the source-parts demo progression");
    }
    if (!Object.keys(SOURCE_PARTS_DEMO_ROLE_COUNTS).every(
        (role) => hydrated.progression.roleCounts[role] === SOURCE_PARTS_DEMO_ROLE_COUNTS[role]
    )) {
        throw new Error("compact topology reproduced invalid demo role counts");
    }
    return record;
}

export function updateSourcePartsDemoRuntimeRecordState(record, progression, state) {
    const hydrated = hydrateRecord(record);
    if (!sameProgression(hydrated.progression, progression)) {
        throw new Error("runtime state update progression does not match compact topology");
    }
    const next = { ...record, s: compactState(progression, state) };
    hydrateRecord(next);
    return next;
}

export function serializeSourcePartsDemoRuntimeRecord(record) {
    hydrateRecord(record);
    const serialized = JSON.stringify(record);
    if (serialized.length > SOURCE_PARTS_DEMO_DYNAMIC_PROPERTY_LIMIT) {
        throw new Error(
            `source-parts demo runtime state is too large: `
            + `${serialized.length}/${SOURCE_PARTS_DEMO_DYNAMIC_PROPERTY_LIMIT}`
        );
    }
    return serialized;
}

export function parseSourcePartsDemoRuntimeRecord(raw) {
    if (typeof raw !== "string" || raw.length > SOURCE_PARTS_DEMO_DYNAMIC_PROPERTY_LIMIT) return null;
    try {
        return hydrateRecord(JSON.parse(raw));
    } catch {
        return null;
    }
}

export function findSourcePartsDemoRoomAtLocation(rooms, location) {
    if (!location || !Number.isFinite(location.x)
        || !Number.isFinite(location.y) || !Number.isFinite(location.z)) return null;
    return rooms.find((room) => {
        const bounds = room.bounds;
        return location.x >= bounds.minX && location.x < bounds.maxX
            && location.y >= bounds.minY && location.y < bounds.maxY
            && location.z >= bounds.minZ && location.z < bounds.maxZ;
    }) ?? null;
}

export function shouldAutoCompleteSourcePartsDemoRoom(room, status) {
    return status === "available" && SOURCE_PARTS_DEMO_AUTO_COMPLETE_ROLES.includes(room?.role);
}

export function sourcePartsDemoTierLabel(tier) {
    return { lower: "下層", middle: "中層", upper: "上層" }[tier] ?? String(tier);
}

export function sourcePartsDemoRoleLabel(room) {
    const indexed = (label) => `${label}${room.roleIndex}`;
    return {
        entrance: "入口",
        key: indexed("鍵"),
        reward: indexed("報酬"),
        miniboss: indexed("中ボス"),
        final: "最終地点",
        exit: "出口",
    }[room?.role] ?? String(room?.role);
}

export function formatSourcePartsDemoRoomNotice(room, status) {
    if (!VALID_STATUSES.has(status)) throw new Error(`unknown demo room status ${String(status)}`);
    const suffix = status === "locked" ? " §7（通行可能・未解放）§r" : "";
    return `[ic-demo] ${sourcePartsDemoTierLabel(room.tier)} / `
        + `${sourcePartsDemoRoleLabel(room)} [${status}]${suffix}`;
}
