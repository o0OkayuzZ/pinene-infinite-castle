import {
    SOURCE_PARTS_DEMO_PROGRESSION_SCHEMA_VERSION,
} from "./sourcePartsDemoProgression.js";

export const SOURCE_PARTS_DEMO_STATE_SCHEMA_VERSION = 1;

function requireProgression(progression) {
    if (progression?.schemaVersion !== SOURCE_PARTS_DEMO_PROGRESSION_SCHEMA_VERSION
        || !Array.isArray(progression?.rooms)
        || !Array.isArray(progression?.requiredObjectives)) {
        throw new Error("invalid source-parts demo progression metadata");
    }
    return progression;
}

function uniqueKnownIds(values, knownIds) {
    const result = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
        if (typeof value !== "string" || !knownIds.has(value) || seen.has(value)) continue;
        seen.add(value);
        result.push(value);
    }
    return result;
}

function normalizeState(progression, state) {
    const validProgression = requireProgression(progression);
    const roomIds = new Set(validProgression.rooms.map((room) => room.roomId));
    const completedRoomIds = uniqueKnownIds(state?.completedRoomIds, roomIds);
    const completedSet = new Set(completedRoomIds);
    const visitedRoomIds = uniqueKnownIds(state?.visitedRoomIds, roomIds);
    for (const roomId of completedRoomIds) {
        if (!visitedRoomIds.includes(roomId)) visitedRoomIds.push(roomId);
    }
    const currentRoomId = roomIds.has(state?.currentRoomId) ? state.currentRoomId : null;
    const exitRoom = validProgression.rooms.find((room) => room.role === "exit");
    return {
        schemaVersion: SOURCE_PARTS_DEMO_STATE_SCHEMA_VERSION,
        progressionSchemaVersion: validProgression.schemaVersion,
        progressionSeed: validProgression.seed,
        currentRoomId,
        visitedRoomIds,
        completedRoomIds,
        exited: Boolean(exitRoom && completedSet.has(exitRoom.roomId)),
    };
}

function assertMatchingState(progression, state) {
    if (state?.progressionSeed !== progression.seed
        || state?.progressionSchemaVersion !== progression.schemaVersion) {
        throw new Error("demo progression state belongs to a different generated castle");
    }
    return normalizeState(progression, state);
}

function roomById(progression, roomId) {
    const room = progression.rooms.find((candidate) => candidate.roomId === roomId);
    if (!room) throw new Error(`unknown demo room ${String(roomId)}`);
    return room;
}

function completedObjectiveIds(progression, state) {
    const completedRooms = new Set(state.completedRoomIds);
    return new Set(progression.requiredObjectives
        .filter((objective) => completedRooms.has(objective.roomId))
        .map((objective) => objective.id));
}

function statusForRoom(progression, state, room) {
    if (state.completedRoomIds.includes(room.roomId)) return "complete";
    const completedObjectives = completedObjectiveIds(progression, state);
    const unlocked = room.requiresObjectiveIds.every((objectiveId) => completedObjectives.has(objectiveId));
    return unlocked ? "available" : "locked";
}

export function createSourcePartsDemoProgressionState(progression) {
    const validProgression = requireProgression(progression);
    return normalizeState(validProgression, {
        currentRoomId: null,
        visitedRoomIds: [],
        completedRoomIds: [],
    });
}

export function getSourcePartsDemoRoomStatus(progression, state, roomId) {
    const validProgression = requireProgression(progression);
    const normalized = assertMatchingState(validProgression, state);
    return statusForRoom(validProgression, normalized, roomById(validProgression, roomId));
}

export function enterSourcePartsDemoRoom(progression, state, roomId) {
    const validProgression = requireProgression(progression);
    const normalized = assertMatchingState(validProgression, state);
    roomById(validProgression, roomId);
    const visitedRoomIds = normalized.visitedRoomIds.includes(roomId)
        ? normalized.visitedRoomIds
        : [...normalized.visitedRoomIds, roomId];
    return normalizeState(validProgression, {
        ...normalized,
        currentRoomId: roomId,
        visitedRoomIds,
    });
}

export function completeSourcePartsDemoRoom(progression, state, roomId) {
    const validProgression = requireProgression(progression);
    let normalized = assertMatchingState(validProgression, state);
    const room = roomById(validProgression, roomId);
    const status = statusForRoom(validProgression, normalized, room);
    if (status === "locked") {
        throw new Error(`demo room ${roomId} is locked by an earlier objective`);
    }
    if (status === "complete") return normalized;
    normalized = enterSourcePartsDemoRoom(validProgression, normalized, roomId);
    return normalizeState(validProgression, {
        ...normalized,
        completedRoomIds: [...normalized.completedRoomIds, roomId],
    });
}

export function summarizeSourcePartsDemoProgressionState(progression, state) {
    const validProgression = requireProgression(progression);
    const normalized = assertMatchingState(validProgression, state);
    const completedRooms = new Set(normalized.completedRoomIds);
    const countRole = (role) => validProgression.rooms.filter(
        (room) => room.role === role && completedRooms.has(room.roomId)
    ).length;
    const nextObjective = validProgression.requiredObjectives.find(
        (objective) => !completedRooms.has(objective.roomId)
    ) ?? null;
    const availableRoomIds = [];
    const lockedRoomIds = [];
    for (const room of validProgression.rooms) {
        const status = statusForRoom(validProgression, normalized, room);
        if (status === "available") availableRoomIds.push(room.roomId);
        else if (status === "locked") lockedRoomIds.push(room.roomId);
    }
    return {
        currentRoomId: normalized.currentRoomId,
        visitedRoomCount: normalized.visitedRoomIds.length,
        completedRoomCount: normalized.completedRoomIds.length,
        keyCount: countRole("key"),
        rewardCount: countRole("reward"),
        minibossCount: countRole("miniboss"),
        finalCleared: countRole("final") === 1,
        exitReached: normalized.exited,
        nextObjectiveId: nextObjective?.id ?? null,
        nextObjectiveRoomId: nextObjective?.roomId ?? null,
        availableRoomIds,
        lockedRoomIds,
    };
}

export function serializeSourcePartsDemoProgressionState(progression, state) {
    return JSON.stringify(assertMatchingState(requireProgression(progression), state));
}

export function parseSourcePartsDemoProgressionState(raw, progression) {
    const validProgression = requireProgression(progression);
    if (typeof raw !== "string") return null;
    try {
        const parsed = JSON.parse(raw);
        if (parsed?.schemaVersion !== SOURCE_PARTS_DEMO_STATE_SCHEMA_VERSION
            || parsed?.progressionSchemaVersion !== validProgression.schemaVersion
            || parsed?.progressionSeed !== validProgression.seed) return null;
        return normalizeState(validProgression, parsed);
    } catch {
        return null;
    }
}
