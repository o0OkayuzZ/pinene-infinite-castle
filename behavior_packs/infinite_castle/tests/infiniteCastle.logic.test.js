import assert from "node:assert/strict";
import {
    TARGET_ROOM_COUNT,
    REQUIRED_ROOMS,
    MIN_ENTRANCE_EXIT_CELL_DISTANCE,
} from "../scripts/infinite_castle/config.js";
import { addCell, opposite } from "../scripts/infinite_castle/connector.js";
import { generateDungeon } from "../scripts/infinite_castle/topologyDungeonGenerator.js";
import {
    bfsShortestPath,
    createDungeonGraph,
    addRoom,
    connectRooms,
    getAllRooms,
    isFullyConnected,
    serializeGraph,
    deserializeGraph,
} from "../scripts/infinite_castle/dungeonGraph.js";
import { RoomCategory, getAllTemplates } from "../scripts/infinite_castle/roomRegistry.js";
import { cellKey, getAllGridCells } from "../scripts/infinite_castle/gridUtils.js";
import { ensureGraphRoomSeeds } from "../scripts/infinite_castle/roomSeed.js";

const RUNS = 5000;
const allGridCells = getAllGridCells();
assert.equal(allGridCells.length, 100);
assert.equal(new Set(allGridCells.map(cellKey)).size, 100);
const categoryCounts = new Map();
let minRooms = Number.POSITIVE_INFINITY;
let maxRooms = 0;
let totalLoops = 0;

function assertConnectorMatchesEdge(graph, room, connector) {
    const neighborCell = addCell(room.cell, connector.direction);
    const neighborKey = cellKey(neighborCell);
    assert.equal(
        graph.edges.get(cellKey(room.cell))?.has(neighborKey),
        true,
        `dangling connector at ${cellKey(room.cell)} direction=${connector.direction}`
    );
    const neighbor = graph.rooms.get(neighborKey);
    assert.ok(neighbor, `connector target room missing at ${neighborKey}`);
    assert.ok(
        neighbor.resolvedConnectors.some((candidate) => candidate.direction === opposite(connector.direction)),
        `opposite connector missing at ${neighborKey}`
    );
    assert.ok(connector.localPosition, "connector localPosition missing");
}

for (let seed = 1; seed <= RUNS; seed += 1) {
    const result = generateDungeon({ seed });
    const rooms = getAllRooms(result.graph);
    minRooms = Math.min(minRooms, rooms.length);
    maxRooms = Math.max(maxRooms, rooms.length);
    totalLoops += result.loopCount;

    assert.equal(rooms.length, TARGET_ROOM_COUNT, `room count mismatch at seed ${seed}`);
    assert.equal(isFullyConnected(result.graph, result.entranceCell), true, `disconnected seed ${seed}`);

    const exits = rooms.filter((room) => room.category === RoomCategory.Exit);
    assert.equal(exits.length, REQUIRED_ROOMS.exitMax, `exit count mismatch at seed ${seed}`);
    for (const exit of exits) {
        const path = bfsShortestPath(result.graph, cellKey(result.entranceCell), cellKey(exit.cell));
        assert.ok(path, `exit unreachable at seed ${seed}`);
        assert.ok(
            path.length - 1 >= MIN_ENTRANCE_EXIT_CELL_DISTANCE,
            `exit too close at seed ${seed}: distance=${path.length - 1}`
        );
    }

    const entrance = rooms.filter((room) => room.category === RoomCategory.Entrance);
    assert.equal(entrance.length, 1, `entrance count mismatch at seed ${seed}`);
    assert.equal(entrance[0].orientation, "normal");
    for (const room of rooms) {
        assert.ok(Number.isInteger(room.roomSeed), `roomSeed missing at seed ${seed}/${cellKey(room.cell)}`);
        assert.ok(room.roomSeed >= 0 && room.roomSeed <= 0xffffffff);
        assert.ok(Number.isInteger(room.revision) && room.revision >= 1);
        categoryCounts.set(room.category, (categoryCounts.get(room.category) ?? 0) + 1);
        for (const connector of room.resolvedConnectors) {
            assertConnectorMatchesEdge(result.graph, room, connector);
        }
    }
}

// 再構築相当: LOCK集合は自室+隣室だけ、接続用の旧経路は非LOCK bridgeとして保持する。
for (let seed = 1; seed <= 500; seed += 1) {
    const oldResult = generateDungeon({ seed });
    const oldGraph = oldResult.graph;
    const rooms = getAllRooms(oldGraph);
    const playerRoom = rooms[(seed * 17) % rooms.length];
    const protectedKeys = new Set([cellKey(oldResult.entranceCell), cellKey(playerRoom.cell)]);
    for (const neighborKey of oldGraph.edges.get(cellKey(playerRoom.cell)) ?? []) protectedKeys.add(neighborKey);

    const retainedKeys = new Set(protectedKeys);
    for (const protectedKey of protectedKeys) {
        const path = bfsShortestPath(oldGraph, cellKey(oldResult.entranceCell), protectedKey);
        for (const key of path ?? []) retainedKeys.add(key);
    }

    const initialGraph = createDungeonGraph();
    for (const key of retainedKeys) {
        const oldRoom = oldGraph.rooms.get(key);
        addRoom(initialGraph, {
            ...oldRoom,
            cell: { ...oldRoom.cell },
            resolvedConnectors: oldRoom.resolvedConnectors.map((connector) => ({
                ...connector,
                localPosition: { ...connector.localPosition },
            })),
            isProtected: protectedKeys.has(key),
        });
    }
    for (const key of retainedKeys) {
        const room = oldGraph.rooms.get(key);
        for (const neighborKey of oldGraph.edges.get(key) ?? []) {
            if (!retainedKeys.has(neighborKey) || key > neighborKey) continue;
            connectRooms(initialGraph, room.cell, oldGraph.rooms.get(neighborKey).cell);
        }
    }

    const initialFrontier = [];
    for (const key of protectedKeys) {
        const room = oldGraph.rooms.get(key);
        for (const connector of room.resolvedConnectors) {
            const neighborKey = cellKey(addCell(room.cell, connector.direction));
            if (!retainedKeys.has(neighborKey)) initialFrontier.push({ cell: room.cell, direction: connector.direction });
        }
    }

    const rebuilt = generateDungeon({
        seed: seed + 900000,
        initialGraph,
        initialFrontier,
        entranceCell: oldResult.entranceCell,
        previousGraph: oldGraph,
    });
    assert.equal(getAllRooms(rebuilt.graph).length, TARGET_ROOM_COUNT);
    assert.equal(isFullyConnected(rebuilt.graph, rebuilt.entranceCell), true);
    assert.equal(
        getAllRooms(rebuilt.graph).filter((room) => room.category === RoomCategory.Exit).length,
        REQUIRED_ROOMS.exitMax
    );
    for (const key of protectedKeys) {
        const before = oldGraph.rooms.get(key);
        const after = rebuilt.graph.rooms.get(key);
        assert.ok(after?.isProtected, `protected room lost at seed ${seed}: ${key}`);
        assert.equal(after.templateId, before.templateId, `protected template changed at seed ${seed}: ${key}`);
        assert.equal(after.roomSeed, before.roomSeed, `protected roomSeed changed at seed ${seed}: ${key}`);
        assert.equal(after.revision, before.revision, `protected revision changed at seed ${seed}: ${key}`);
        for (const connector of before.resolvedConnectors) {
            const neighborKey = cellKey(addCell(before.cell, connector.direction));
            assert.equal(
                rebuilt.graph.edges.get(key)?.has(neighborKey),
                true,
                `protected connector became dangling at seed ${seed}: ${key}/${connector.direction}`
            );
        }
    }
    for (const [key, after] of rebuilt.graph.rooms) {
        const before = oldGraph.rooms.get(key);
        if (!before || protectedKeys.has(key)) continue;
        assert.equal(
            after.revision,
            before.revision + 1,
            `rebuilt room revision did not advance at seed ${seed}: ${key}`
        );
    }
}

// 同じ城seedからは、各部屋の割当・roomSeed・revisionまで完全に再現できる。
const deterministicA = generateDungeon({ seed: 246813579 });
const deterministicB = generateDungeon({ seed: 246813579 });
assert.equal(serializeGraph(deterministicA.graph), serializeGraph(deterministicB.graph));

// 新形式の保存往復と、旧形式(roomSeed/revisionなし)の自動補完を検証する。
const restored = deserializeGraph(serializeGraph(deterministicA.graph));
for (const room of getAllRooms(restored)) {
    assert.ok(Number.isInteger(room.roomSeed));
    assert.ok(Number.isInteger(room.revision));
}
const legacyData = JSON.parse(serializeGraph(deterministicA.graph));
for (const room of legacyData.rooms) {
    delete room.roomSeed;
    delete room.revision;
}
const legacyGraph = deserializeGraph(JSON.stringify(legacyData));
assert.equal(ensureGraphRoomSeeds(legacyGraph, 246813579), TARGET_ROOM_COUNT);
const migratedOnce = serializeGraph(legacyGraph);
assert.equal(ensureGraphRoomSeeds(legacyGraph, 246813579), 0);
assert.equal(serializeGraph(legacyGraph), migratedOnce);

const templates = getAllTemplates();
assert.equal(templates.length, 21, "room registry must contain 21 templates");
for (const template of templates) {
    assert.equal(
        template.sockets.length,
        template.connectors.length,
        `${template.id} sockets must match its declared connector set`
    );
    assert.equal(
        new Set(template.sockets.map((socket) => socket.direction)).size,
        template.sockets.length,
        `${template.id} must not declare duplicate socket directions`
    );
    for (const socket of template.sockets) {
        assert.ok(socket.localPosition);
        assert.ok(Number.isInteger(socket.localPosition.x));
        assert.ok(Number.isInteger(socket.localPosition.y));
        assert.ok(Number.isInteger(socket.localPosition.z));
    }
}

console.log(JSON.stringify({
    runs: RUNS,
    minRooms,
    maxRooms,
    averageLoops: totalLoops / RUNS,
    categoryCounts: Object.fromEntries(categoryCounts),
}));
