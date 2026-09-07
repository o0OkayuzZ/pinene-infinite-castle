import { createSourcePartsDemoProgression } from "../scripts/infinite_castle/sourcePartsDemoProgression.js";
import {
    completeSourcePartsDemoRoom,
    createSourcePartsDemoProgressionState,
    summarizeSourcePartsDemoProgressionState,
} from "../scripts/infinite_castle/sourcePartsDemoProgressionState.js";
import {
    SOURCE_PARTS_DEMO_DYNAMIC_PROPERTY_LIMIT,
    createSourcePartsDemoRuntimeRecord,
    findSourcePartsDemoRoomAtLocation,
    formatSourcePartsDemoRoomNotice,
    parseSourcePartsDemoRuntimeRecord,
    serializeSourcePartsDemoRuntimeRecord,
    shouldAutoCompleteSourcePartsDemoRoom,
    updateSourcePartsDemoRuntimeRecordState,
} from "../scripts/infinite_castle/sourcePartsDemoRuntimePure.js";

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) throw new Error(`${message}: expected ${expected}, received ${actual}`);
}

function assertThrows(callback, pattern, message) {
    let error = null;
    try {
        callback();
    } catch (caught) {
        error = caught;
    }
    assert(error, `${message}: did not throw`);
    assert(pattern.test(String(error)), `${message}: wrong error ${String(error)}`);
}

function edge(fromPlacementId, toPlacementId) {
    return { fromPlacementId, toPlacementId };
}

export function createRuntimePlan(seed = 0x89abcdef) {
    const placements = [];
    const connections = [];
    let nextX = 0;
    const addPlacement = (placement) => {
        placements.push({
            origin: { x: nextX, y: 80, z: 200 },
            size: { x: 20, y: 12, z: 20 },
            ...placement,
        });
        nextX += 32;
    };
    const tierRooms = {
        lower: ["l0", "l1", "l2", "l3", "l4", "l5"],
        middle: ["m0", "m1", "m2", "m3", "m4"],
        upper: ["u0", "u1", "u2", "u3"],
    };
    const tierY = { lower: 80, middle: 152, upper: 224 };

    for (const [tier, roomIds] of Object.entries(tierRooms)) {
        for (const roomId of roomIds) {
            addPlacement({
                placementId: roomId,
                category: "room",
                tier,
                layer: tier,
                origin: { x: nextX, y: tierY[tier], z: 200 },
            });
        }
        for (let index = 1; index < roomIds.length; index += 1) {
            const corridorId = `${tier}_corridor_${index}`;
            addPlacement({ placementId: corridorId, category: "bridge", tier, layer: tier });
            connections.push(edge(roomIds[index - 1], corridorId));
            connections.push(edge(corridorId, roomIds[index]));
        }
        const loopId = `${tier}_loop`;
        addPlacement({ placementId: loopId, category: "crossroads", tier, layer: tier });
        connections.push(edge(roomIds[0], loopId));
        connections.push(edge(loopId, roomIds.at(-1)));
    }

    const transitions = [
        ["l5", "lm_a", "m0", "transition_lower_middle"],
        ["l2", "lm_b", "m3", "transition_lower_middle"],
        ["m4", "mu_a", "u0", "transition_middle_upper"],
        ["m1", "mu_b", "u3", "transition_middle_upper"],
    ];
    for (const [from, stairId, to, tier] of transitions) {
        addPlacement({ placementId: stairId, category: "stairs", tier, layer: tier });
        connections.push(edge(from, stairId));
        connections.push(edge(stairId, to));
    }
    assertEqual(placements.length, 34, "fixture placement count");
    return {
        schemaVersion: 5,
        seed,
        dimensionId: "infinite_castle:dungeon",
        placements,
        connections,
    };
}

export function runSourcePartsDemoRuntimeTests() {
    const plan = createRuntimePlan();
    const progression = createSourcePartsDemoProgression(plan.seed, plan);
    let state = createSourcePartsDemoProgressionState(progression);
    let record = createSourcePartsDemoRuntimeRecord(plan, progression, state);
    let serialized = serializeSourcePartsDemoRuntimeRecord(record);
    assert(serialized.length < 6000, `initial compact record unexpectedly large: ${serialized.length}`);
    assert(serialized.length < SOURCE_PARTS_DEMO_DYNAMIC_PROPERTY_LIMIT, "record exceeds property limit");

    let restored = parseSourcePartsDemoRuntimeRecord(serialized);
    assert(restored, "compact record should restore");
    assertEqual(restored.dimensionId, plan.dimensionId, "dimension round trip");
    assertEqual(restored.progression.seed, progression.seed, "seed round trip");
    assertEqual(restored.rooms.length, 15, "room count round trip");
    assertEqual(
        JSON.stringify(restored.progression),
        JSON.stringify(progression),
        "seed plus compact topology reproduces the full progression"
    );
    assert(restored.progression.requiredRoute.verticalDirectionChanges >= 2, "route reversal round trip");

    const firstRoom = restored.rooms[0];
    const bounds = firstRoom.bounds;
    assertEqual(
        findSourcePartsDemoRoomAtLocation(restored.rooms, {
            x: bounds.minX,
            y: bounds.minY,
            z: bounds.minZ,
        })?.roomId,
        firstRoom.roomId,
        "AABB includes minimum corner"
    );
    assertEqual(
        findSourcePartsDemoRoomAtLocation(restored.rooms, {
            x: bounds.maxX - 0.001,
            y: bounds.maxY - 0.001,
            z: bounds.maxZ - 0.001,
        })?.roomId,
        firstRoom.roomId,
        "AABB includes values below maximum corner"
    );
    assertEqual(
        findSourcePartsDemoRoomAtLocation(restored.rooms, {
            x: bounds.maxX,
            y: bounds.maxY,
            z: bounds.maxZ,
        }),
        null,
        "AABB excludes maximum corner"
    );

    const entrance = progression.rooms.find((room) => room.role === "entrance");
    const key = progression.rooms.find((room) => room.role === "key");
    const miniboss = progression.rooms.find((room) => room.role === "miniboss");
    const final = progression.rooms.find((room) => room.role === "final");
    assertEqual(shouldAutoCompleteSourcePartsDemoRoom(entrance, "available"), true, "entrance auto");
    assertEqual(shouldAutoCompleteSourcePartsDemoRoom(key, "available"), true, "key auto");
    assertEqual(shouldAutoCompleteSourcePartsDemoRoom(miniboss, "available"), false, "miniboss manual");
    assertEqual(shouldAutoCompleteSourcePartsDemoRoom(final, "available"), false, "final manual");
    assertEqual(shouldAutoCompleteSourcePartsDemoRoom(entrance, "locked"), false, "locked never auto");
    assert(formatSourcePartsDemoRoomNotice(key, "locked").includes("通行可能"), "locked notice");

    for (const objective of progression.requiredObjectives.slice(0, 3)) {
        state = completeSourcePartsDemoRoom(progression, state, objective.roomId);
    }
    record = updateSourcePartsDemoRuntimeRecordState(record, progression, state);
    serialized = serializeSourcePartsDemoRuntimeRecord(record);
    restored = parseSourcePartsDemoRuntimeRecord(serialized);
    const summary = summarizeSourcePartsDemoProgressionState(restored.progression, restored.state);
    assertEqual(summary.completedRoomCount, 3, "completed state round trip");
    assertEqual(summary.minibossCount, 1, "manual objective state round trip");

    assertEqual(parseSourcePartsDemoRuntimeRecord("not json"), null, "invalid JSON rejected");
    const wrongVersion = JSON.parse(serialized);
    wrongVersion.v = 999;
    assertEqual(parseSourcePartsDemoRuntimeRecord(JSON.stringify(wrongVersion)), null, "version rejected");

    const oversized = JSON.parse(serialized);
    oversized.n[0][0] = "x".repeat(SOURCE_PARTS_DEMO_DYNAMIC_PROPERTY_LIMIT);
    assertThrows(
        () => serializeSourcePartsDemoRuntimeRecord(oversized),
        /too large/,
        "dynamic property limit enforced"
    );

    return {
        ok: true,
        planPlacements: plan.placements.length,
        rooms: restored.rooms.length,
        serializedLength: serialized.length,
        limit: SOURCE_PARTS_DEMO_DYNAMIC_PROPERTY_LIMIT,
        routeReversals: restored.progression.requiredRoute.verticalDirectionChanges,
        completedRooms: summary.completedRoomCount,
    };
}
