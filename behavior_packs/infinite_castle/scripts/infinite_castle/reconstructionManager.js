// 城の再構築(タイミング計算・保護部屋を残した再生成)を担当する。
// ブロックの実配置(japaneseRoomBuilder)には関与しない。
import { world } from "@minecraft/server";
import { RECONSTRUCTION_INTERVAL_MINUTES, RECONSTRUCTION_SOUND_ID } from "./config.js";
import { addCell } from "./connector.js";
import { cellKey } from "./gridUtils.js";
import {
    createDungeonGraph,
    addRoom,
    connectRooms,
    bfsShortestPath,
} from "./dungeonGraph.js";
import { generateDungeon } from "./topologyDungeonGenerator.js";
import { trackPlayersInDimension } from "./playerRoomTracker.js";

const NEXT_RECONSTRUCTION_TICK_KEY = "infinite_castle:next_reconstruction_absolute_time_v2";
const TICKS_PER_MINUTE = 20 * 60;

function randomIntervalTicks() {
    const span = RECONSTRUCTION_INTERVAL_MINUTES.max - RECONSTRUCTION_INTERVAL_MINUTES.min;
    const minutes = RECONSTRUCTION_INTERVAL_MINUTES.min + Math.random() * span;
    return Math.round(minutes * TICKS_PER_MINUTE);
}

// 次回再構築時刻(絶対tick)を新しく決めて保存する。ワールド再起動後も
// world dynamic propertyから復元できる。
export function scheduleNextReconstruction() {
    const next = world.getAbsoluteTime() + randomIntervalTicks();
    world.setDynamicProperty(NEXT_RECONSTRUCTION_TICK_KEY, next);
    return next;
}

export function getNextReconstructionTick() {
    const value = world.getDynamicProperty(NEXT_RECONSTRUCTION_TICK_KEY);
    return typeof value === "number" ? value : null;
}

export function isReconstructionDue() {
    const next = getNextReconstructionTick();
    return next !== null && world.getAbsoluteTime() >= next;
}

// デバッグ用: 次回チェックで即座に再構築が走るようにする(通常は使わない)。
export function forceReconstructionNow() {
    world.setDynamicProperty(NEXT_RECONSTRUCTION_TICK_KEY, world.getAbsoluteTime());
}

function playReconstructionSound(dimension) {
    for (const player of dimension.getPlayers()) {
        try {
            player.playSound(RECONSTRUCTION_SOUND_ID, { volume: 1, pitch: 1.0 });
        } catch {
            /* noop */
        }
    }
}

/**
 * プレイヤーが今いる部屋+隣接部屋(と入口)を保護しつつ、残りを再生成する。
 * @param {object} params
 * @param {object} params.graph 現在のDungeonGraph
 * @param {object} params.entranceCell 入口セル座標(常に保護される)
 * @param {object} params.dimension 無限城ディメンション(プレイヤー取得・SE再生に使用)
 * @param {number} [params.seed] 新しい部分の生成シード
 */
// LOCK対象は仕様どおり「各プレイヤーの現在室+直結隣室」の和集合と入口だけ。
// 島同士を結ぶ旧経路は後段で再構築対象のbridgeとして残し、LOCK扱いにはしない。
function computeProtectedCellKeys(graph, playerCells, entranceCell) {
    const protectedKeys = new Set([cellKey(entranceCell)]);
    for (const cell of playerCells) {
        const key = cellKey(cell);
        if (!graph.rooms.has(key)) continue;
        protectedKeys.add(key);
        for (const neighborKey of graph.edges.get(key) ?? []) protectedKeys.add(neighborKey);
    }
    return protectedKeys;
}

// 複数の保護島を最終グラフへ確実に接続するため、入口から各LOCK室までの旧最短経路を
// bridgeとして予約する。bridgeはクリア・再建築されるため、保護範囲を水増ししない。
function computeRetainedCellKeys(graph, protectedKeys, entranceCell) {
    const retainedKeys = new Set(protectedKeys);
    const entranceKey = cellKey(entranceCell);
    for (const protectedKey of protectedKeys) {
        const path = bfsShortestPath(graph, entranceKey, protectedKey);
        for (const key of path ?? []) retainedKeys.add(key);
    }
    return retainedKeys;
}

export function reconstructDungeon({ graph, entranceCell, dimension, seed }) {
    playReconstructionSound(dimension);

    const playerCells = trackPlayersInDimension(dimension).map((entry) => entry.cell);
    const protectedKeys = computeProtectedCellKeys(graph, playerCells, entranceCell);
    const retainedKeys = computeRetainedCellKeys(graph, protectedKeys, entranceCell);

    const prunedGraph = createDungeonGraph();
    for (const key of retainedKeys) {
        const room = graph.rooms.get(key);
        if (!room) continue;
        addRoom(prunedGraph, {
            ...room,
            cell: { ...room.cell },
            resolvedConnectors: room.resolvedConnectors.map((connector) => ({
                ...connector,
                localPosition: connector.localPosition ? { ...connector.localPosition } : undefined,
            })),
            isProtected: protectedKeys.has(key),
        });
    }

    // retained内の旧edgeを保持する。入口から全保護島へ伸びる連結部分グラフになる。
    for (const key of retainedKeys) {
        const room = graph.rooms.get(key);
        if (!room) continue;
        for (const neighborKey of graph.edges.get(key) ?? []) {
            if (!retainedKeys.has(neighborKey) || key > neighborKey) continue;
            const neighbor = graph.rooms.get(neighborKey);
            if (neighbor) connectRooms(prunedGraph, room.cell, neighbor.cell);
        }
    }

    const frontier = [];
    for (const key of protectedKeys) {
        const room = graph.rooms.get(key);
        if (!room) continue;
        for (const connector of room.resolvedConnectors) {
            const neighborCell = addCell(room.cell, connector.direction);
            const neighborKey = cellKey(neighborCell);
            if (!retainedKeys.has(neighborKey)) {
                // 保護部屋の外側に向いていたconnector = 新しい生成の起点になる。
                frontier.push({ cell: room.cell, direction: connector.direction });
            }
        }
    }

    const result = generateDungeon({
        seed: seed ?? Date.now(),
        initialGraph: prunedGraph,
        initialFrontier: frontier,
        entranceCell,
        previousGraph: graph,
    });

    scheduleNextReconstruction();
    return { ...result, protectedCellKeys: protectedKeys };
}
