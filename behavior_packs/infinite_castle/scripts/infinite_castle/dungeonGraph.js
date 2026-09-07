// ダンジョン全体をノード(RoomInstance)とエッジ(接続)で管理するグラフ構造。
import { cellKey } from "./gridUtils.js";

export function createDungeonGraph() {
    return {
        rooms: new Map(), // cellKey -> RoomInstance
        edges: new Map(), // cellKey -> Set<cellKey>
    };
}

export function addRoom(graph, room) {
    const key = cellKey(room.cell);
    graph.rooms.set(key, room);
    if (!graph.edges.has(key)) graph.edges.set(key, new Set());
}

export function removeRoom(graph, cell) {
    const key = cellKey(cell);
    graph.rooms.delete(key);
    const neighbors = graph.edges.get(key) ?? new Set();
    for (const neighborKey of neighbors) {
        graph.edges.get(neighborKey)?.delete(key);
    }
    graph.edges.delete(key);
}

export function connectRooms(graph, cellA, cellB) {
    const keyA = cellKey(cellA);
    const keyB = cellKey(cellB);
    if (!graph.edges.has(keyA)) graph.edges.set(keyA, new Set());
    if (!graph.edges.has(keyB)) graph.edges.set(keyB, new Set());
    graph.edges.get(keyA).add(keyB);
    graph.edges.get(keyB).add(keyA);
}

export function getRoom(graph, cell) {
    return graph.rooms.get(cellKey(cell));
}

export function getRoomByKey(graph, key) {
    return graph.rooms.get(key);
}

export function getNeighborKeys(graph, cell) {
    return Array.from(graph.edges.get(cellKey(cell)) ?? []);
}

export function getAllRooms(graph) {
    return Array.from(graph.rooms.values());
}

// startCellから到達可能な全cellKeyの集合をBFSで求める。
export function bfsReachable(graph, startCell) {
    const startKey = cellKey(startCell);
    const visited = new Set([startKey]);
    const queue = [startKey];
    while (queue.length > 0) {
        const current = queue.shift();
        for (const neighborKey of graph.edges.get(current) ?? []) {
            if (!visited.has(neighborKey)) {
                visited.add(neighborKey);
                queue.push(neighborKey);
            }
        }
    }
    return visited;
}

export function isFullyConnected(graph, startCell) {
    const reachable = bfsReachable(graph, startCell);
    return reachable.size === graph.rooms.size;
}

// startKeyからendKeyへの最短経路(cellKeyの配列)を返す。到達不可ならnull。
export function bfsShortestPath(graph, startKey, endKey) {
    if (startKey === endKey) return [startKey];
    const visited = new Set([startKey]);
    const parent = new Map();
    const queue = [startKey];
    while (queue.length > 0) {
        const current = queue.shift();
        if (current === endKey) break;
        for (const neighborKey of graph.edges.get(current) ?? []) {
            if (!visited.has(neighborKey)) {
                visited.add(neighborKey);
                parent.set(neighborKey, current);
                queue.push(neighborKey);
            }
        }
    }
    if (!visited.has(endKey)) return null;
    const path = [endKey];
    let cursor = endKey;
    while (cursor !== startKey) {
        cursor = parent.get(cursor);
        path.push(cursor);
    }
    path.reverse();
    return path;
}

// 保護対象(プレイヤーが今いる部屋 + その隣接部屋)の集合をcellKeyのSetで返す。
// playerCells: プレイヤーが現在いるセル座標の配列
export function getProtectedCellKeys(graph, playerCells) {
    const protectedKeys = new Set();
    for (const cell of playerCells) {
        const key = cellKey(cell);
        if (!graph.rooms.has(key)) continue;
        protectedKeys.add(key);
        for (const neighborKey of graph.edges.get(key) ?? []) {
            protectedKeys.add(neighborKey);
        }
    }
    return protectedKeys;
}

export function countEdges(graph) {
    let total = 0;
    for (const neighbors of graph.edges.values()) total += neighbors.size;
    return total / 2;
}

// world dynamic property等へ保存するためのプレーンなJSON文字列に変換する。
export function serializeGraph(graph) {
    const rooms = getAllRooms(graph).map((room) => ({
        cell: room.cell,
        templateId: room.templateId,
        category: room.category,
        orientation: room.orientation,
        rotation: room.rotation,
        resolvedConnectors: room.resolvedConnectors,
        roomSeed: room.roomSeed,
        revision: room.revision,
        isProtected: room.isProtected,
        isDeepEntrance: room.isDeepEntrance,
    }));
    const edges = [];
    const seen = new Set();
    for (const [key, neighbors] of graph.edges) {
        for (const neighborKey of neighbors) {
            const edgeKey = [key, neighborKey].sort().join("|");
            if (seen.has(edgeKey)) continue;
            seen.add(edgeKey);
            edges.push([key, neighborKey]);
        }
    }
    return JSON.stringify({ rooms, edges });
}

export function deserializeGraph(json) {
    const data = JSON.parse(json);
    const graph = createDungeonGraph();
    for (const room of data.rooms) addRoom(graph, room);
    for (const [keyA, keyB] of data.edges) {
        graph.edges.get(keyA)?.add(keyB);
        graph.edges.get(keyB)?.add(keyA);
    }
    return graph;
}
