import {
    SOURCE_PARTS_DEMO_ROLE_COUNTS,
    createSourcePartsDemoProgression,
} from "../scripts/infinite_castle/sourcePartsDemoProgression.js";
import {
    completeSourcePartsDemoRoom,
    createSourcePartsDemoProgressionState,
    enterSourcePartsDemoRoom,
    getSourcePartsDemoRoomStatus,
    parseSourcePartsDemoProgressionState,
    serializeSourcePartsDemoProgressionState,
    summarizeSourcePartsDemoProgressionState,
} from "../scripts/infinite_castle/sourcePartsDemoProgressionState.js";

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) throw new Error(`${message}: expected ${expected}, received ${actual}`);
}

function assertDeepEqual(actual, expected, message) {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    if (actualJson !== expectedJson) {
        throw new Error(`${message}: expected ${expectedJson}, received ${actualJson}`);
    }
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

function connection(fromPlacementId, toPlacementId) {
    return { fromPlacementId, toPlacementId };
}

function createDemoPlan() {
    const placements = [];
    const connections = [];
    const tierRooms = {
        lower: ["l0", "l1", "l2", "l3", "l4", "l5"],
        middle: ["m0", "m1", "m2", "m3", "m4"],
        upper: ["u0", "u1", "u2", "u3"],
    };

    for (const [tier, roomIds] of Object.entries(tierRooms)) {
        for (const roomId of roomIds) placements.push({ placementId: roomId, category: "room", tier });
        for (let index = 1; index < roomIds.length; index += 1) {
            const corridorId = `${tier}_corridor_${index}`;
            placements.push({ placementId: corridorId, category: "bridge", tier });
            connections.push(connection(roomIds[index - 1], corridorId));
            connections.push(connection(corridorId, roomIds[index]));
        }
        const loopId = `${tier}_loop`;
        placements.push({ placementId: loopId, category: "crossroads", tier });
        connections.push(connection(roomIds[0], loopId));
        connections.push(connection(loopId, roomIds[roomIds.length - 1]));
    }

    const transitions = [
        ["l5", "lm_a", "m0", "transition_lower_middle"],
        ["l2", "lm_b", "m3", "transition_lower_middle"],
        ["m4", "mu_a", "u0", "transition_middle_upper"],
        ["m1", "mu_b", "u3", "transition_middle_upper"],
    ];
    for (const [from, stairId, to, tier] of transitions) {
        placements.push({ placementId: stairId, category: "stairs", tier });
        connections.push(connection(from, stairId));
        connections.push(connection(stairId, to));
    }
    return { placements, connections };
}

function edgeSet(plan) {
    const edges = new Set();
    for (const edge of plan.connections) {
        edges.add(`${edge.fromPlacementId}|${edge.toPlacementId}`);
        edges.add(`${edge.toPlacementId}|${edge.fromPlacementId}`);
    }
    return edges;
}

function countRoles(progression) {
    const counts = { entrance: 0, key: 0, reward: 0, miniboss: 0, final: 0, exit: 0 };
    for (const room of progression.rooms) counts[room.role] += 1;
    return counts;
}

export function runSourcePartsDemoProgressionTests() {
    const plan = createDemoPlan();
    const edges = edgeSet(plan);
    const tierPatterns = new Set();
    const objectiveAssignments = new Set();

    for (let seed = 0; seed < 1000; seed += 1) {
        const progression = createSourcePartsDemoProgression(seed, plan);
        const repeated = createSourcePartsDemoProgression(seed, plan);
        assertDeepEqual(repeated, progression, `seed=${seed}: deterministic output`);
        assertEqual(progression.mode, "demo_metadata_only", `seed=${seed}: demo mode`);
        assertEqual(progression.rooms.length, 15, `seed=${seed}: room count`);
        assertDeepEqual(countRoles(progression), SOURCE_PARTS_DEMO_ROLE_COUNTS, `seed=${seed}: roles`);
        assertEqual(new Set(progression.rooms.map((room) => room.roomId)).size, 15, `seed=${seed}: ids`);
        assertEqual(progression.requiredObjectives.length, 8, `seed=${seed}: objectives`);
        assert(progression.requiredRoute.verticalDirections.includes("up"), `seed=${seed}: missing up`);
        assert(progression.requiredRoute.verticalDirections.includes("down"), `seed=${seed}: missing down`);
        assert(
            progression.requiredRoute.verticalDirectionChanges >= 2,
            `seed=${seed}: route does not move back and forth`
        );
        assertEqual(
            new Set(progression.requiredRoute.objectiveTiers).size,
            3,
            `seed=${seed}: route must visit all tiers`
        );
        for (let index = 1; index < progression.requiredRoute.placementIds.length; index += 1) {
            const from = progression.requiredRoute.placementIds[index - 1];
            const to = progression.requiredRoute.placementIds[index];
            assert(edges.has(`${from}|${to}`), `seed=${seed}: disconnected route step ${from}->${to}`);
        }
        tierPatterns.add(progression.requiredRoute.objectiveTiers.join(","));
        objectiveAssignments.add(progression.requiredRoute.objectiveRoomIds.join(","));
    }

    assert(tierPatterns.size >= 20, `tier order did not vary enough: ${tierPatterns.size}`);
    assert(objectiveAssignments.size >= 900, `room order did not vary enough: ${objectiveAssignments.size}`);

    const progression = createSourcePartsDemoProgression(0x12345678, plan);
    let state = createSourcePartsDemoProgressionState(progression);
    let summary = summarizeSourcePartsDemoProgressionState(progression, state);
    assertEqual(summary.nextObjectiveId, "entrance", "initial objective");
    assertEqual(summary.keyCount, 0, "initial keys");
    const entrance = progression.requiredObjectives[0];
    const final = progression.requiredObjectives.find((objective) => objective.role === "final");
    assertEqual(
        getSourcePartsDemoRoomStatus(progression, state, entrance.roomId),
        "available",
        "entrance available"
    );
    assertEqual(
        getSourcePartsDemoRoomStatus(progression, state, final.roomId),
        "locked",
        "final initially locked"
    );
    assertThrows(
        () => completeSourcePartsDemoRoom(progression, state, final.roomId),
        /locked/,
        "cannot complete final early"
    );

    state = enterSourcePartsDemoRoom(progression, state, final.roomId);
    assertEqual(state.currentRoomId, final.roomId, "locked rooms remain physically visitable in demo");
    assertEqual(state.completedRoomIds.length, 0, "enter does not complete a locked room");

    for (const objective of progression.requiredObjectives.slice(0, -1)) {
        assertEqual(
            getSourcePartsDemoRoomStatus(progression, state, objective.roomId),
            "available",
            `${objective.id} becomes available in sequence`
        );
        state = completeSourcePartsDemoRoom(progression, state, objective.roomId);
    }
    summary = summarizeSourcePartsDemoProgressionState(progression, state);
    assertEqual(summary.keyCount, 3, "all demo keys collected");
    assertEqual(summary.minibossCount, 2, "both minibosses complete");
    assertEqual(summary.finalCleared, true, "final complete");
    assertEqual(summary.nextObjectiveId, "exit", "exit is last objective");

    for (const room of progression.rooms.filter((candidate) => candidate.role === "reward")) {
        assertEqual(getSourcePartsDemoRoomStatus(progression, state, room.roomId), "available", "reward unlock");
        state = completeSourcePartsDemoRoom(progression, state, room.roomId);
    }
    const exit = progression.requiredObjectives.at(-1);
    state = completeSourcePartsDemoRoom(progression, state, exit.roomId);
    summary = summarizeSourcePartsDemoProgressionState(progression, state);
    assertEqual(summary.rewardCount, 7, "all rewards complete");
    assertEqual(summary.exitReached, true, "exit complete");
    assertEqual(summary.nextObjectiveId, null, "required route complete");
    assertEqual(summary.completedRoomCount, 15, "all rooms complete");

    const serialized = serializeSourcePartsDemoProgressionState(progression, state);
    assertDeepEqual(
        parseSourcePartsDemoProgressionState(serialized, progression),
        state,
        "state round trip"
    );
    assertEqual(parseSourcePartsDemoProgressionState("not json", progression), null, "invalid json");
    const otherProgression = createSourcePartsDemoProgression(0x12345679, plan);
    assertEqual(
        parseSourcePartsDemoProgressionState(serialized, otherProgression),
        null,
        "state is bound to generation seed"
    );

    const directTopology = {
        rooms: plan.placements
            .filter((placement) => placement.category === "room")
            .map((placement) => ({ id: placement.placementId, tier: placement.tier })),
        links: [
            ...["l0", "l1", "l2", "l3", "l4", "l5"].slice(1).map((id, index) => [
                ["l0", "l1", "l2", "l3", "l4", "l5"][index], id,
            ]),
            ["l5", "m0"], ["m0", "m1"], ["m1", "m2"], ["m2", "m3"], ["m3", "m4"],
            ["m4", "u0"], ["u0", "u1"], ["u1", "u2"], ["u2", "u3"],
        ],
    };
    assertEqual(createSourcePartsDemoProgression(7, directTopology).rooms.length, 15, "direct topology");

    const fourteenRooms = directTopology.rooms.slice(0, 14);
    const fourteenRoomIds = new Set(fourteenRooms.map((room) => room.id));
    assertThrows(
        () => createSourcePartsDemoProgression(1, {
            rooms: fourteenRooms,
            links: directTopology.links.filter(
                ([from, to]) => fourteenRoomIds.has(from) && fourteenRoomIds.has(to)
            ),
        }),
        /exactly 15 rooms/,
        "reject wrong room count"
    );

    return {
        ok: true,
        seeds: 1000,
        tierPatterns: tierPatterns.size,
        objectiveAssignments: objectiveAssignments.size,
        roleCounts: SOURCE_PARTS_DEMO_ROLE_COUNTS,
        completedRooms: summary.completedRoomCount,
    };
}
