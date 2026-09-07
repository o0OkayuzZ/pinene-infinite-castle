// 無限城 v0.1 のトポロジー先行生成器。
// 先に「30セル・全接続・出口距離」を確定し、部屋カテゴリと建築テンプレートは後から割り当てる。
// これにより見た目用テンプレートのconnector数に、ダンジョン成立条件を依存させない。
import {
    GRID_SIZE,
    TARGET_ROOM_COUNT,
    ROOM_WEIGHTS,
    REQUIRED_ROOMS,
    MIN_ENTRANCE_EXIT_CELL_DISTANCE,
    LOOP_EDGE_COUNT_RANGE,
    BRANCH_POSE_CHANCES,
    resolveDeepEntranceChance,
} from "./config.js";
import { Direction, opposite, addCell, localFaceCenter } from "./connector.js";
import { getTemplatesByCategory, getTemplate, RoomCategory } from "./roomRegistry.js";
import {
    createDungeonGraph,
    addRoom,
    connectRooms,
    bfsShortestPath,
    isFullyConnected,
} from "./dungeonGraph.js";
import { createRoomInstance } from "./roomInstance.js";
import { deriveRoomSeed, ensureRoomSeed, INITIAL_ROOM_REVISION } from "./roomSeed.js";
import { cellKey, isWithinGrid } from "./gridUtils.js";

const DIRECTIONS = Object.freeze(Object.values(Direction));
const HORIZONTAL_ROTATIONS = Object.freeze([0, 90, 180, 270]);
const MAX_GENERATION_ATTEMPTS = 96;

function createRng(seed) {
    let a = seed >>> 0;
    return function rng() {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffle(array, rng) {
    const result = array.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

function cloneRoom(room) {
    return {
        ...room,
        cell: { ...room.cell },
        resolvedConnectors: (room.resolvedConnectors ?? []).map((connector) => ({
            ...connector,
            localPosition: connector.localPosition ? { ...connector.localPosition } : undefined,
        })),
    };
}

function cloneGraph(source) {
    const graph = createDungeonGraph();
    if (!source) return graph;
    for (const room of source.rooms.values()) addRoom(graph, cloneRoom(room));
    for (const [key, neighbors] of source.edges) {
        graph.edges.set(key, new Set(neighbors));
    }
    return graph;
}

function createUnassignedRoom(cell, isProtected = false) {
    const room = createRoomInstance({
        cell: { ...cell },
        templateId: "",
        category: "",
        orientation: "normal",
        rotation: 0,
        resolvedConnectors: [],
        roomSeed: null,
        revision: 0,
    });
    room.isProtected = isProtected;
    return room;
}

function directionBetween(from, to) {
    for (const direction of DIRECTIONS) {
        const expected = addCell(from, direction);
        if (expected.x === to.x && expected.y === to.y && expected.z === to.z) return direction;
    }
    return null;
}

function hasEdge(graph, keyA, keyB) {
    return graph.edges.get(keyA)?.has(keyB) === true;
}

function graphDistances(graph, startCell) {
    const startKey = cellKey(startCell);
    const distances = new Map([[startKey, 0]]);
    const queue = [startKey];
    for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index];
        const nextDistance = distances.get(current) + 1;
        for (const neighbor of graph.edges.get(current) ?? []) {
            if (distances.has(neighbor)) continue;
            distances.set(neighbor, nextDistance);
            queue.push(neighbor);
        }
    }
    return distances;
}

function connectorDirections(graph, room) {
    const directions = [];
    for (const neighborKey of graph.edges.get(cellKey(room.cell)) ?? []) {
        const neighbor = graph.rooms.get(neighborKey);
        if (!neighbor) continue;
        const direction = directionBetween(room.cell, neighbor.cell);
        if (direction) directions.push(direction);
    }
    return directions;
}

function resolvedConnectors(graph, room) {
    return connectorDirections(graph, room).map((direction) => ({
        direction,
        localPosition: localFaceCenter(direction),
    }));
}

function protectedRoomAllowsEdge(room, direction) {
    if (!room?.isProtected) return true;
    return (room.resolvedConnectors ?? []).some((connector) => connector.direction === direction);
}

function collectGrowthCandidates(graph, expandableKeys) {
    const candidates = [];
    for (const key of expandableKeys) {
        const room = graph.rooms.get(key);
        if (!room) continue;
        for (const direction of DIRECTIONS) {
            const target = addCell(room.cell, direction);
            if (!isWithinGrid(target) || graph.rooms.has(cellKey(target))) continue;
            candidates.push({ parent: room.cell, parentKey: key, direction, target });
        }
    }
    return candidates;
}

function placeMandatoryProtectedFrontiers(graph, initialFrontier, expandableKeys) {
    for (const item of initialFrontier ?? []) {
        const parent = graph.rooms.get(cellKey(item.cell));
        if (!parent || !protectedRoomAllowsEdge(parent, item.direction)) continue;
        const target = addCell(item.cell, item.direction);
        if (!isWithinGrid(target)) continue;
        const targetKey = cellKey(target);
        if (!graph.rooms.has(targetKey)) {
            addRoom(graph, createUnassignedRoom(target));
        }
        connectRooms(graph, item.cell, target);
        expandableKeys.add(targetKey);
    }
}

function addLoops(graph, entranceCell, rng) {
    const entranceKey = cellKey(entranceCell);
    const candidates = [];
    const seen = new Set();
    for (const room of graph.rooms.values()) {
        const roomKey = cellKey(room.cell);
        for (const direction of DIRECTIONS) {
            const neighborCell = addCell(room.cell, direction);
            const neighborKey = cellKey(neighborCell);
            const neighbor = graph.rooms.get(neighborKey);
            if (!neighbor || hasEdge(graph, roomKey, neighborKey)) continue;
            const pairKey = [roomKey, neighborKey].sort().join("|");
            if (seen.has(pairKey)) continue;
            seen.add(pairKey);
            if (roomKey === entranceKey || neighborKey === entranceKey) continue;
            if (!protectedRoomAllowsEdge(room, direction)) continue;
            if (!protectedRoomAllowsEdge(neighbor, opposite(direction))) continue;
            candidates.push([room.cell, neighbor.cell]);
        }
    }

    const span = LOOP_EDGE_COUNT_RANGE.max - LOOP_EDGE_COUNT_RANGE.min + 1;
    const wanted = LOOP_EDGE_COUNT_RANGE.min + Math.floor(rng() * span);
    const selected = shuffle(candidates, rng).slice(0, wanted);
    for (const [cellA, cellB] of selected) connectRooms(graph, cellA, cellB);
    return selected.length;
}

function buildTopology({ rng, initialGraph, initialFrontier, entranceCell }) {
    const graph = cloneGraph(initialGraph);
    const resolvedEntranceCell = entranceCell ?? {
        x: Math.floor(GRID_SIZE.x / 2),
        y: 0,
        z: 0,
    };
    const entranceKey = cellKey(resolvedEntranceCell);
    const expandableKeys = new Set();

    if (!graph.rooms.has(entranceKey)) {
        addRoom(graph, createUnassignedRoom(resolvedEntranceCell));
    }

    if (initialGraph) {
        for (const [key, room] of graph.rooms) {
            if (!room.isProtected) expandableKeys.add(key);
        }
        // 保護部屋に既に開いている外向きsocketは必ず再利用し、物理的な穴を残さない。
        placeMandatoryProtectedFrontiers(graph, initialFrontier, expandableKeys);
    } else {
        // 入口は一本道で始め、最初の通常部屋から分岐させる。
        const firstCell = addCell(resolvedEntranceCell, Direction.South);
        if (!isWithinGrid(firstCell)) return null;
        addRoom(graph, createUnassignedRoom(firstCell));
        connectRooms(graph, resolvedEntranceCell, firstCell);
        expandableKeys.add(cellKey(firstCell));
    }

    const roomGoal = Math.max(TARGET_ROOM_COUNT, graph.rooms.size);
    let lastAddedKey = expandableKeys.values().next().value;
    while (graph.rooms.size < roomGoal) {
        let candidates = collectGrowthCandidates(graph, expandableKeys);
        if (candidates.length === 0) return null;

        // 約55%は直前の先端を伸ばし、残りは既存枝から選ぶ。長い経路と分岐を両立する。
        if (lastAddedKey && rng() < 0.55) {
            const tipCandidates = candidates.filter((candidate) => candidate.parentKey === lastAddedKey);
            if (tipCandidates.length > 0) candidates = tipCandidates;
        }
        const selected = candidates[Math.floor(rng() * candidates.length)];
        const room = createUnassignedRoom(selected.target);
        addRoom(graph, room);
        connectRooms(graph, selected.parent, selected.target);
        lastAddedKey = cellKey(selected.target);
        expandableKeys.add(lastAddedKey);
    }

    const loopCount = addLoops(graph, resolvedEntranceCell, rng);
    if (!isFullyConnected(graph, resolvedEntranceCell)) return null;
    return { graph, entranceCell: resolvedEntranceCell, loopCount };
}

function chooseWeightedCategory(rng) {
    const entries = Object.entries(ROOM_WEIGHTS);
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = rng() * total;
    for (const [category, weight] of entries) {
        roll -= weight;
        if (roll <= 0) return category;
    }
    return entries[entries.length - 1][0];
}

function chooseTemplate(category, rng) {
    const templates = getTemplatesByCategory(category);
    if (templates.length === 0) throw new Error(`no templates registered for category: ${category}`);
    return templates[Math.floor(rng() * templates.length)];
}

function chooseOrientation(template, isCriticalPath, hasVerticalConnector, rng) {
    if (isCriticalPath || hasVerticalConnector || template.allowedOrientations.length === 1) return "normal";
    const roll = rng();
    if (roll < BRANCH_POSE_CHANCES.sideways && template.allowedOrientations.includes("sideways")) {
        return "sideways";
    }
    if (
        roll < BRANCH_POSE_CHANCES.sideways + BRANCH_POSE_CHANCES.upsideDown
        && template.allowedOrientations.includes("upsidedown")
    ) {
        return "upsidedown";
    }
    return "normal";
}

function selectExitKeys(graph, entranceCell, rng) {
    const distances = graphDistances(graph, entranceCell);
    const protectedExits = Array.from(graph.rooms.entries())
        .filter(([, room]) => room.isProtected && room.category === RoomCategory.Exit)
        .map(([key]) => key);
    if (protectedExits.length > REQUIRED_ROOMS.exitMax) return null;

    const needed = REQUIRED_ROOMS.exitMax - protectedExits.length;
    const candidates = Array.from(graph.rooms.entries())
        .filter(([key, room]) =>
            key !== cellKey(entranceCell)
            && !room.isProtected
            && (distances.get(key) ?? -1) >= MIN_ENTRANCE_EXIT_CELL_DISTANCE
        )
        .map(([key]) => ({
            key,
            distance: distances.get(key),
            degree: graph.edges.get(key)?.size ?? 0,
            tieBreaker: rng(),
        }))
        .sort((a, b) =>
            Number(a.degree !== 1) - Number(b.degree !== 1)
            || b.distance - a.distance
            || a.tieBreaker - b.tieBreaker
        );
    if (candidates.length < needed) return null;
    return new Set([...protectedExits, ...candidates.slice(0, needed).map((candidate) => candidate.key)]);
}

function assignRoomData(graph, entranceCell, exitKeys, rng, generationSeed, previousGraph) {
    const entranceKey = cellKey(entranceCell);
    const criticalKeys = new Set([entranceKey]);
    for (const exitKey of exitKeys) {
        const path = bfsShortestPath(graph, entranceKey, exitKey);
        for (const key of path ?? []) criticalKeys.add(key);
    }

    for (const [key, oldRoom] of Array.from(graph.rooms.entries())) {
        const connectors = resolvedConnectors(graph, oldRoom);
        if (oldRoom.isProtected) {
            // 保護部屋はブロックを触らない。edgeは既存socketだけを使うため方向も一致する。
            oldRoom.resolvedConnectors = connectors;
            ensureRoomSeed(oldRoom, generationSeed);
            continue;
        }

        let template;
        let category;
        if (key === entranceKey) {
            template = getTemplate("entrance_main");
            category = RoomCategory.Entrance;
        } else if (exitKeys.has(key)) {
            template = getTemplate("exit_main");
            category = RoomCategory.Exit;
        } else {
            category = chooseWeightedCategory(rng);
            template = chooseTemplate(category, rng);
        }

        const hasVerticalConnector = connectors.some((connector) =>
            connector.direction === Direction.Up || connector.direction === Direction.Down
        );
        const orientation = (category === RoomCategory.Entrance || category === RoomCategory.Exit)
            ? "normal"
            : chooseOrientation(template, criticalKeys.has(key), hasVerticalConnector, rng);
        const previousRoom = previousGraph?.rooms?.get(key) ?? oldRoom;
        const previousRevision = Number.isInteger(previousRoom.revision) && previousRoom.revision > 0
            ? previousRoom.revision
            : 0;
        const revision = previousRevision + 1;
        const replacement = createRoomInstance({
            cell: { ...oldRoom.cell },
            templateId: template.id,
            category,
            orientation,
            rotation: HORIZONTAL_ROTATIONS[Math.floor(rng() * HORIZONTAL_ROTATIONS.length)],
            resolvedConnectors: connectors,
            revision,
        });
        replacement.roomSeed = deriveRoomSeed(generationSeed, replacement, revision);
        graph.rooms.set(key, replacement);
    }

    if (Array.from(graph.rooms.values()).some((room) => room.isProtected && room.isDeepEntrance)) return;
    if (rng() >= resolveDeepEntranceChance()) return;
    const candidates = Array.from(graph.rooms.entries()).filter(([key, room]) =>
        key !== entranceKey
        && !exitKeys.has(key)
        && !room.isProtected
        && room.orientation === "normal"
    );
    if (candidates.length === 0) return;
    const [, chosen] = candidates[Math.floor(rng() * candidates.length)];
    chosen.templateId = "deep_entrance_marker";
    chosen.category = RoomCategory.DeepEntrance;
    chosen.isDeepEntrance = true;
    chosen.roomSeed = deriveRoomSeed(generationSeed, chosen, chosen.revision ?? INITIAL_ROOM_REVISION);
}

/**
 * @param {object} [options]
 * @param {number} [options.seed]
 * @param {object} [options.initialGraph] 再構築で保持する部屋と橋渡し経路
 * @param {object} [options.previousGraph] 同じセルのrevision履歴を引き継ぐ再構築前グラフ
 * @param {Array<{cell: object, direction: string}>} [options.initialFrontier] 保護部屋の既存外向きsocket
 * @param {object} [options.entranceCell]
 */
export function generateDungeon({ seed, initialGraph, initialFrontier, entranceCell, previousGraph } = {}) {
    const baseSeed = Number.isFinite(seed) ? seed : Date.now();
    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
        const generationSeed = (baseSeed + Math.imul(attempt, 0x9e3779b1)) >>> 0;
        const rng = createRng(generationSeed);
        const result = buildTopology({ rng, initialGraph, initialFrontier, entranceCell });
        if (!result) continue;
        const exitKeys = selectExitKeys(result.graph, result.entranceCell, rng);
        if (!exitKeys || exitKeys.size !== REQUIRED_ROOMS.exitMax) continue;
        assignRoomData(result.graph, result.entranceCell, exitKeys, rng, generationSeed, previousGraph);
        return { ...result, seed: generationSeed };
    }
    throw new Error(
        `failed to generate a connected dungeon with ${REQUIRED_ROOMS.exitMax} exits after ${MAX_GENERATION_ATTEMPTS} attempts`
    );
}
