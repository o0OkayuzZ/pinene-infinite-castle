// 無限城アドオン全体のエントリポイント。各モジュールを束ねるだけで、
// グラフ生成/接続判定/建築などの実処理は既存モジュールに委譲する。
import { world, system } from "@minecraft/server";
import { INFINITE_CASTLE_DIMENSION_ID } from "./dimensionSetup.js";
import "./infiniteCastleAtmosphere.js";
import { generateDungeon } from "./topologyDungeonGenerator.js";
import {
    getAllRooms,
    getRoom,
    serializeGraph,
    deserializeGraph,
} from "./dungeonGraph.js";
import { cellKey, getAllGridCells } from "./gridUtils.js";
import { cellWorldMin, cellWorldMax, cellWorldCenter, worldToCell } from "./worldCoords.js";
import { CELL_SIZE, SOURCE_DIMENSION_IDS, TRANSFER_CONFIG, DYNAMIC_RECONSTRUCTION } from "./config.js";
import { RoomCategory } from "./roomRegistry.js";
import { ensureGraphRoomSeeds, hashString32, normalizeSeed } from "./roomSeed.js";
import {
    reconstructDungeon,
    isReconstructionDue,
    scheduleNextReconstruction,
    getNextReconstructionTick,
    forceReconstructionNow,
} from "./reconstructionManager.js";
import {
    buildJapaneseRoomPhased,
    clearJapaneseRoom,
    clearJapaneseRoomPhased,
    repairJapaneseRoomConnectors,
} from "./japaneseRoomBuilder.js";
import { acquireLoadedRoomChunks, releaseRoomTickingArea } from "./chunkLoading.js";
import { inspectRoomConnectors } from "./connectionIntegrity.js";
import { startEntranceTransition } from "./entranceTransition.js";
import { previewSourceParts } from "./sourcePartsPreview.js";
import {
    clearSourcePartsV2,
    clearSourcePartsSceneryForPlayer,
    isSourcePartsReconstructionInProgress,
    reconstructSourcePartsAroundPlayers,
    rebuildSourcePartsSceneryForPlayer,
    repairSourcePartsOpenings,
    rebuildSourcePartsAt,
    rebuildSourcePartsV2,
} from "./sourcePartsReconstructionV2.js";
import { getSourcePartsSceneryStatus } from "./sourcePartsScenery.js";
import {
    getSourcePartsDemoEntranceTarget,
    setSourcePartsDemoExitTransferHandler,
} from "./sourcePartsDemoRuntime.js";

const ENTRANCE_CHECK_INTERVAL_TICKS = 5;
const EXIT_CHECK_INTERVAL_TICKS = 5;
const RECONSTRUCTION_CHECK_INTERVAL_TICKS = 20;
const ARRIVAL_COOLDOWN_TICKS = 40;
const PACK_BUILD_ID = "0.1.36-anywhere-safe-reconstruct";
const CURRENT_RENDERER_VERSION = 9;
const RENDERER_VERSION_KEY = "infinite_castle:renderer_version";
const USE_SOURCE_PARTS_MAIN_CASTLE = true;
const SOURCE_MAIN_MIGRATION_KEY = "infinite_castle:source_parts_main_v1";
const SOURCE_MAIN_START_LOCATION = Object.freeze({ x: 1000, y: 80, z: 1000 });
const SOURCE_MAIN_BUILD_OPTIONS = "castle seed=420320 smooth";
const SOURCE_DYNAMIC_INTERVAL_TICKS = 15 * 60 * 20;
const SOURCE_DYNAMIC_NEXT_TICK_KEY = "infinite_castle:source_dynamic_next_tick_v1";

const returnPoints = new Map(); // playerId -> { dimensionId, location }
const entranceBlockedPlayerIds = new Set();

const RETURN_POINT_PROPERTY_KEY = "infinite_castle:return_point";
const ENTRANCE_BLOCKED_PROPERTY_KEY = "infinite_castle:entrance_blocked";

const SEED_KEY = "infinite_castle:seed";
const GRAPH_KEY = "infinite_castle:graph_state";
const ENTRANCE_CELL_KEY = "infinite_castle:entrance_cell";
const NEXT_RECONSTRUCTION_TICK_KEY = "infinite_castle:next_reconstruction_absolute_time_v2";

let currentGraph = null;
let currentEntranceCell = null;
const arrivingPlayerIds = new Set();
let entranceCheckTickCount = 0; // DEBUG: checkEntranceMarkersが実際に呼ばれている回数
let exitCheckTickCount = 0;
let lastExitPlayerCount = 0;
let lastExitCheckError = "none";
let reconstructionInProgress = false;
let dungeonResetInProgress = false;
let pendingVisualUpgrade = false;
let lastBuildReport = Object.freeze({ requested: 0, succeeded: 0, failures: [] });
let lastConnectionAudit = Object.freeze({ roomsChecked: 0, issueRooms: 0, repairedRooms: 0, unresolved: [] });
let lastVisualUpgradeAttemptTime = Number.NEGATIVE_INFINITY;
let autoVisualUpgradeAttemptedThisSession = false;
let sourceDynamicReconstructionInProgress = false;

function isValidReturnPoint(value) {
    return value
        && typeof value.dimensionId === "string"
        && Number.isFinite(value.location?.x)
        && Number.isFinite(value.location?.y)
        && Number.isFinite(value.location?.z);
}

function saveReturnPoint(player) {
    const value = {
        dimensionId: player.dimension.id,
        location: {
            x: player.location.x,
            y: player.location.y,
            z: player.location.z,
        },
    };
    returnPoints.set(player.id, value);
    try {
        player.setDynamicProperty(RETURN_POINT_PROPERTY_KEY, JSON.stringify(value));
    } catch (error) {
        console.warn(`[infinite_castle] failed to persist return point for ${player.name}: ${error}`);
    }
    return value;
}

function loadReturnPoint(player) {
    const cached = returnPoints.get(player.id);
    if (isValidReturnPoint(cached)) return cached;
    try {
        const raw = player.getDynamicProperty(RETURN_POINT_PROPERTY_KEY);
        if (typeof raw !== "string") return null;
        const value = JSON.parse(raw);
        if (!isValidReturnPoint(value)) return null;
        returnPoints.set(player.id, value);
        return value;
    } catch (error) {
        console.warn(`[infinite_castle] failed to restore return point for ${player.name}: ${error}`);
        return null;
    }
}

function clearReturnPoint(player) {
    returnPoints.delete(player.id);
    try {
        player.setDynamicProperty(RETURN_POINT_PROPERTY_KEY, undefined);
    } catch {
        // メモリ側は消えているため、次回は永続値が妥当か再検証される。
    }
}

function setEntranceBlocked(player, blocked) {
    if (blocked) entranceBlockedPlayerIds.add(player.id);
    else entranceBlockedPlayerIds.delete(player.id);
    try {
        player.setDynamicProperty(ENTRANCE_BLOCKED_PROPERTY_KEY, blocked ? true : undefined);
    } catch {
        // Dynamic Propertyが使えない場合も同一セッション中はSetで保護する。
    }
}

function isEntranceBlocked(player) {
    if (entranceBlockedPlayerIds.has(player.id)) return true;
    try {
        if (player.getDynamicProperty(ENTRANCE_BLOCKED_PROPERTY_KEY) === true) {
            entranceBlockedPlayerIds.add(player.id);
            return true;
        }
    } catch {
        // noop
    }
    return false;
}

function loadSavedState() {
    const savedGraphJson = world.getDynamicProperty(GRAPH_KEY);
    const savedEntranceJson = world.getDynamicProperty(ENTRANCE_CELL_KEY);
    if (typeof savedGraphJson !== "string" || typeof savedEntranceJson !== "string") return null;
    try {
        const graph = deserializeGraph(savedGraphJson);
        const savedSeed = world.getDynamicProperty(SEED_KEY);
        const fallbackSeed = normalizeSeed(savedSeed, hashString32(savedGraphJson));
        const migratedRooms = ensureGraphRoomSeeds(graph, fallbackSeed);
        pendingVisualUpgrade = world.getDynamicProperty(RENDERER_VERSION_KEY) !== CURRENT_RENDERER_VERSION;
        // v0.1初期版のセーブにはroomSeed/revisionがない。読込時に同じ旧グラフから
        // 決定的に補完し、その場で新形式へ保存して以降の修復結果を固定する。
        if (!Number.isFinite(savedSeed)) world.setDynamicProperty(SEED_KEY, fallbackSeed);
        if (migratedRooms > 0) world.setDynamicProperty(GRAPH_KEY, serializeGraph(graph));
        return { graph, entranceCell: JSON.parse(savedEntranceJson) };
    } catch (error) {
        console.warn(`[infinite_castle] failed to restore saved dungeon state: ${error}`);
        return null;
    }
}

function saveState() {
    if (!currentGraph || !currentEntranceCell) return;
    try {
        world.setDynamicProperty(GRAPH_KEY, serializeGraph(currentGraph));
        world.setDynamicProperty(ENTRANCE_CELL_KEY, JSON.stringify(currentEntranceCell));
    } catch (error) {
        console.warn(`[infinite_castle] failed to save dungeon state: ${error}`);
    }
}

function waitOneTick() {
    return new Promise((resolve) => system.runTimeout(resolve, 1));
}

function runPhasedGenerator(generator) {
    return new Promise((resolve, reject) => {
        const advance = () => {
            try {
                const step = generator.next();
                if (step.done) {
                    resolve(step.value);
                    return;
                }
                system.runTimeout(advance, 1);
            } catch (error) {
                reject(error);
            }
        };
        advance();
    });
}

async function auditAndRepairConnections(dimension, rooms) {
    let roomsChecked = 0;
    let issueRooms = 0;
    let repairedRooms = 0;
    const unresolved = [];
    for (const room of rooms) {
        const areaName = `ic_audit_${room.cell.x}_${room.cell.y}_${room.cell.z}`;
        const loadResult = await acquireLoadedRoomChunks(dimension, room, areaName);
        if (!loadResult.ok) {
            unresolved.push({ cell: cellKey(room.cell), error: loadResult.error });
            releaseRoomTickingArea(areaName);
            continue;
        }
        try {
            roomsChecked += 1;
            const before = inspectRoomConnectors(dimension, room);
            if (before.length === 0) continue;
            issueRooms += 1;
            repairJapaneseRoomConnectors(dimension, room);
            const after = inspectRoomConnectors(dimension, room);
            if (after.length === 0) repairedRooms += 1;
            else unresolved.push({
                cell: cellKey(room.cell),
                error: after.map((issue) => `${issue.direction}:${issue.kind}`).join(","),
            });
        } catch (error) {
            unresolved.push({ cell: cellKey(room.cell), error: String(error) });
        } finally {
            releaseRoomTickingArea(areaName);
        }
        await waitOneTick();
    }
    lastConnectionAudit = Object.freeze({
        roomsChecked,
        issueRooms,
        repairedRooms,
        unresolved: Object.freeze(unresolved),
    });
    return lastConnectionAudit;
}

async function buildRoomsJob(dimension, rooms, { markRendererCurrent = false } = {}) {
    // 縦socketの足場が下から支持されるよう、低層から順に建てる。
    const orderedRooms = rooms.slice().sort((a, b) => a.cell.y - b.cell.y);
    const failures = [];
    let succeeded = 0;
    for (const room of orderedRooms) {
        const areaName = `ic_r_${room.cell.x}_${room.cell.y}_${room.cell.z}`;
        const loadResult = await acquireLoadedRoomChunks(dimension, room, areaName);
        if (!loadResult.ok) {
            console.warn(`[infinite_castle] room chunks unavailable at ${JSON.stringify(room.cell)}: ${loadResult.error}`);
            failures.push({ cell: cellKey(room.cell), error: loadResult.error });
            releaseRoomTickingArea(areaName);
            await waitOneTick();
            continue;
        }
        try {
            await runPhasedGenerator(buildJapaneseRoomPhased(dimension, room));
            succeeded += 1;
        } catch (error) {
            console.warn(`[infinite_castle] buildJapaneseRoom failed at ${JSON.stringify(room.cell)}: ${error}`);
            failures.push({ cell: cellKey(room.cell), error: String(error) });
        }
        releaseRoomTickingArea(areaName);
        await waitOneTick();
    }
    lastBuildReport = Object.freeze({
        requested: orderedRooms.length,
        succeeded,
        failures: Object.freeze(failures),
    });
    saveState();
    if (markRendererCurrent && failures.length === 0 && succeeded === orderedRooms.length) {
        world.setDynamicProperty(RENDERER_VERSION_KEY, CURRENT_RENDERER_VERSION);
        pendingVisualUpgrade = false;
    } else if (markRendererCurrent) {
        pendingVisualUpgrade = true;
    }
    return lastBuildReport;
}

// ダンジョンが未生成なら、保存済み状態の復元またはseedからの新規生成を行う。
function ensureDungeon() {
    if (currentGraph) return;

    const restored = loadSavedState();
    if (restored) {
        currentGraph = restored.graph;
        currentEntranceCell = restored.entranceCell;
        if (getNextReconstructionTick() === null) scheduleNextReconstruction();
        return;
    }

    const seed = Date.now();
    const result = generateDungeon({ seed });
    world.setDynamicProperty(SEED_KEY, result.seed);
    currentGraph = result.graph;
    currentEntranceCell = result.entranceCell;
    scheduleNextReconstruction();

    const dimension = world.getDimension(INFINITE_CASTLE_DIMENSION_ID);
    void buildRoomsJob(dimension, getAllRooms(currentGraph), { markRendererCurrent: true }).catch((error) => {
        console.warn(`[infinite_castle] initial room build failed: ${error?.stack ?? error}`);
    });
}

// 入口マーカーを踏まないと復元されない設計だと、ワールド再読み込み時に
// プレイヤーが既に無限城内にいた場合、checkEntranceMarkersが一度も発火せず
// currentGraphが永久にnullのまま(=再構築も出口帰還も無効)になってしまう。
// そのためスクリプト起動時点で保存状態があれば無条件で先に復元しておく。
system.run(() => {
    if (USE_SOURCE_PARTS_MAIN_CASTLE) return;
    if (currentGraph) return;
    const restored = loadSavedState();
    if (!restored) return;
    currentGraph = restored.graph;
    currentEntranceCell = restored.entranceCell;
    if (getNextReconstructionTick() === null) scheduleNextReconstruction();
});

function teleportPlayerToDungeon(player) {
    arrivingPlayerIds.add(player.id);
    saveReturnPoint(player);
    ensureDungeon();

    const dungeonDimension = world.getDimension(INFINITE_CASTLE_DIMENSION_ID);
    const center = cellWorldCenter(currentEntranceCell);
    const landingLocation = {
        x: center.x,
        y: center.y - CELL_SIZE.y / 2 + 1,
        z: center.z,
    };
    startEntranceTransition({
        player,
        dungeonDimension,
        landingLocation,
        soundId: TRANSFER_CONFIG.entranceSoundId,
        onFinished: ({ teleported, error }) => {
            if (!teleported) {
                console.warn(`[infinite_castle] entrance teleport failed: ${error}`);
            }
            system.runTimeout(() => arrivingPlayerIds.delete(player.id), ARRIVAL_COOLDOWN_TICKS);
        },
    });
}

function checkEntranceMarkers() {
    entranceCheckTickCount += 1;
    if (dungeonResetInProgress) return;
    for (const dimensionId of SOURCE_DIMENSION_IDS) {
        let dimension;
        try {
            dimension = world.getDimension(dimensionId);
        } catch {
            continue;
        }
        for (const player of dimension.getPlayers()) {
            if (arrivingPlayerIds.has(player.id)) continue;
            let block;
            try {
                block = dimension.getBlock({
                    x: Math.floor(player.location.x),
                    y: Math.floor(player.location.y) - 1,
                    z: Math.floor(player.location.z),
                });
            } catch {
                continue;
            }
            const isOnMarker = block?.typeId === TRANSFER_CONFIG.entranceMarkerBlockId;
            if (isEntranceBlocked(player)) {
                // 出口から入口マーカー直上へ帰っても、いったん自力で離れるまで再入場させない。
                if (isOnMarker) continue;
                setEntranceBlocked(player, false);
            }
            if (isOnMarker) {
                try {
                    if (USE_SOURCE_PARTS_MAIN_CASTLE) {
                        startSourceCastleEntrance(player);
                        continue;
                    }
                    ensureDungeon();
                    if (pendingVisualUpgrade) {
                        player.sendMessage(
                            `[infinite_castle] 建築rendererをv${CURRENT_RENDERER_VERSION}へ自動更新しています。完了後にもう一度入口へ入ってください`
                        );
                        startVisualRefresh(player);
                        continue;
                    }
                    teleportPlayerToDungeon(player);
                } catch (error) {
                    arrivingPlayerIds.delete(player.id);
                    console.warn(`[infinite_castle] teleportPlayerToDungeon failed: ${error}`);
                    try {
                        player.sendMessage(`[infinite_castle] 入口処理失敗: ${error}`);
                    } catch {
                        /* noop */
                    }
                }
            }
        }
    }
}

function isCellLiveProtected(dimension, cell) {
    const targetKey = cellKey(cell);
    for (const player of dimension.getPlayers()) {
        const playerCell = worldToCell(player.location);
        const playerKey = cellKey(playerCell);
        if (playerKey === targetKey) return true;
        if (currentGraph?.edges.get(playerKey)?.has(targetKey)) return true;
        const gridDistance = Math.abs(playerCell.x - cell.x)
            + Math.abs(playerCell.y - cell.y)
            + Math.abs(playerCell.z - cell.z);
        if (gridDistance <= 1) return true;
    }
    return false;
}

function distanceFromNearestPlayer(dimension, cell) {
    const players = dimension.getPlayers();
    if (players.length === 0) return Number.POSITIVE_INFINITY;
    let nearest = Number.POSITIVE_INFINITY;
    for (const player of players) {
        const playerCell = worldToCell(player.location);
        const distance = Math.abs(playerCell.x - cell.x)
            + Math.abs(playerCell.y - cell.y)
            + Math.abs(playerCell.z - cell.z);
        nearest = Math.min(nearest, distance);
    }
    return nearest;
}

function createReconstructionOperations(dimension, roomsToClear, roomsToBuild) {
    const byCell = new Map();
    for (const room of roomsToClear) {
        byCell.set(cellKey(room.cell), { cell: room.cell, clearRoom: room, buildRoom: null });
    }
    for (const room of roomsToBuild) {
        const key = cellKey(room.cell);
        const operation = byCell.get(key) ?? { cell: room.cell, clearRoom: null, buildRoom: null };
        operation.buildRoom = room;
        byCell.set(key, operation);
    }
    const operations = Array.from(byCell.values());
    if (DYNAMIC_RECONSTRUCTION.nearestRoomsFirst) {
        operations.sort((a, b) =>
            distanceFromNearestPlayer(dimension, a.cell) - distanceFromNearestPlayer(dimension, b.cell)
            || a.cell.y - b.cell.y
        );
    }
    return operations;
}

async function reconstructionJob(dimension, roomsToClear, roomsToBuild) {
    const operations = createReconstructionOperations(dimension, roomsToClear, roomsToBuild);
    let completed = 0;
    let liveProtected = 0;
    for (const operation of operations) {
        if (isCellLiveProtected(dimension, operation.cell)) {
            liveProtected += 1;
            continue;
        }

        const room = operation.clearRoom ?? operation.buildRoom;
        const areaName = `ic_dyn_${room.cell.x}_${room.cell.y}_${room.cell.z}`;
        const loadResult = await acquireLoadedRoomChunks(dimension, room, areaName);
        if (!loadResult.ok) {
            console.warn(`[infinite_castle] dynamic rebuild skipped at ${JSON.stringify(room.cell)}: ${loadResult.error}`);
            releaseRoomTickingArea(areaName);
            await waitOneTick();
            continue;
        }

        let canBuild = true;
        try {
            if (operation.clearRoom) {
                if (DYNAMIC_RECONSTRUCTION.enabled) {
                    const clearResult = await runPhasedGenerator(clearJapaneseRoomPhased(
                        dimension,
                        operation.clearRoom,
                        {
                            layersPerStep: DYNAMIC_RECONSTRUCTION.clearLayersPerStep,
                            shouldContinue: () => !isCellLiveProtected(dimension, operation.cell),
                        }
                    ));
                    canBuild = clearResult?.completed !== false;
                } else {
                    clearJapaneseRoom(dimension, operation.clearRoom);
                }
            }
            if (canBuild && operation.buildRoom) {
                await runPhasedGenerator(buildJapaneseRoomPhased(dimension, operation.buildRoom));
            }
            if (canBuild) completed += 1;
            else liveProtected += 1;
        } catch (error) {
            console.warn(`[infinite_castle] dynamic room transform failed at ${JSON.stringify(room.cell)}: ${error}`);
        } finally {
            releaseRoomTickingArea(areaName);
        }

        for (let tick = 0; tick < DYNAMIC_RECONSTRUCTION.ticksBetweenRooms; tick += 1) {
            await waitOneTick();
        }
    }
    saveState();
    reconstructionInProgress = false;
    broadcastToDungeon(
        dimension,
        `[infinite_castle] 再構築完了: transformed=${completed}/${operations.length} liveProtected=${liveProtected}`
    );
}

function broadcastToDungeon(dimension, message) {
    for (const player of dimension.getPlayers()) {
        try {
            player.sendMessage(message);
        } catch {
            /* noop */
        }
    }
}

function checkReconstruction() {
    if (USE_SOURCE_PARTS_MAIN_CASTLE) return;
    if (reconstructionInProgress) return;
    if (!currentGraph || !currentEntranceCell) return;
    if (!isReconstructionDue()) return;
    reconstructionInProgress = true;

    const dimension = world.getDimension(INFINITE_CASTLE_DIMENSION_ID);

    // reconstructDungeon等が例外を投げた場合でもreconstructionInProgressを
    // falseに戻す(さもないと以降ずっと再構築が無反応になり原因も見えなくなる)。
    try {
        const oldRooms = getAllRooms(currentGraph);

        const result = reconstructDungeon({
            graph: currentGraph,
            entranceCell: currentEntranceCell,
            dimension,
            seed: Date.now(),
        });
        currentGraph = result.graph;
        world.setDynamicProperty(SEED_KEY, result.seed);

        // 保護セル以外の旧部屋はすべてクリア対象(たとえ同じセルに別の新部屋が割り当てられていても、旧ブロックは一度必ず消す)。
        const protectedKeys = result.protectedCellKeys;
        const roomsToClear = oldRooms.filter((room) => !protectedKeys.has(cellKey(room.cell)));
        const roomsToBuild = getAllRooms(currentGraph).filter((room) => !room.isProtected);

        broadcastToDungeon(
            dimension,
            `[infinite_castle] 再構築開始: seed=${result.seed} clear=${roomsToClear.length} build=${roomsToBuild.length}`
        );
        void reconstructionJob(dimension, roomsToClear, roomsToBuild).catch((error) => {
            reconstructionInProgress = false;
            console.warn(`[infinite_castle] reconstruction job failed: ${error?.stack ?? error}`);
            broadcastToDungeon(dimension, `[infinite_castle] 再構築失敗: ${error}`);
        });
    } catch (error) {
        reconstructionInProgress = false;
        console.warn(`[infinite_castle] checkReconstruction failed: ${error?.stack ?? error}`);
        broadcastToDungeon(dimension, `[infinite_castle] 再構築失敗: ${error}`);
    }
}

function getSourceDynamicNextTick() {
    const value = world.getDynamicProperty(SOURCE_DYNAMIC_NEXT_TICK_KEY);
    return Number.isFinite(value) ? value : null;
}

function setSourceDynamicNextTick(value) {
    world.setDynamicProperty(
        SOURCE_DYNAMIC_NEXT_TICK_KEY,
        Number.isFinite(value) ? Math.trunc(value) : undefined
    );
}

async function runSourceDynamicReconstruction(dimension, requestedSeed) {
    if (sourceDynamicReconstructionInProgress || isSourcePartsReconstructionInProgress()) return;
    sourceDynamicReconstructionInProgress = true;
    try {
        const result = await reconstructSourcePartsAroundPlayers(
            dimension,
            Number.isFinite(requestedSeed) ? requestedSeed >>> 0 : Date.now() >>> 0
        );
        if (!result?.ok && ![
            "no_players",
            "scenery_guard",
            "player_location_conflict",
            "invalid_player_location",
        ].includes(result?.reason)) {
            console.warn(`[infinite_castle] live-anchor rebuild did not complete: ${result?.reason}`);
        }
    } catch (error) {
        console.warn(`[infinite_castle] live-anchor rebuild failed: ${error?.stack ?? error}`);
        broadcastToDungeon(dimension, `[infinite_castle] 部分再構築失敗: ${error}`);
    } finally {
        sourceDynamicReconstructionInProgress = false;
        setSourceDynamicNextTick(world.getAbsoluteTime() + SOURCE_DYNAMIC_INTERVAL_TICKS);
    }
}

function checkSourceDynamicReconstruction() {
    if (!USE_SOURCE_PARTS_MAIN_CASTLE) return;
    let dimension;
    let players;
    try {
        dimension = world.getDimension(INFINITE_CASTLE_DIMENSION_ID);
        players = dimension.getPlayers();
    } catch {
        return;
    }
    if (players.length === 0) {
        if (getSourceDynamicNextTick() !== null) setSourceDynamicNextTick(null);
        return;
    }
    if (!getSourcePartsDemoEntranceTarget()
        || dungeonResetInProgress
        || reconstructionInProgress
        || sourceDynamicReconstructionInProgress
        || isSourcePartsReconstructionInProgress()) return;

    const now = world.getAbsoluteTime();
    const next = getSourceDynamicNextTick();
    if (next === null) {
        setSourceDynamicNextTick(now + SOURCE_DYNAMIC_INTERVAL_TICKS);
        broadcastToDungeon(
            dimension,
            "[infinite_castle] 在室パーツ保護型の再構築タイマーを開始しました（15分）"
        );
        return;
    }
    if (now < next) return;
    void runSourceDynamicReconstruction(dimension);
}

system.runInterval(checkEntranceMarkers, ENTRANCE_CHECK_INTERVAL_TICKS);
system.runInterval(checkReconstruction, RECONSTRUCTION_CHECK_INTERVAL_TICKS);
system.runInterval(checkSourceDynamicReconstruction, RECONSTRUCTION_CHECK_INTERVAL_TICKS);

function resolveReturnDestination(player) {
    const saved = loadReturnPoint(player);
    if (saved && saved.dimensionId !== INFINITE_CASTLE_DIMENSION_ID) {
        try {
            return {
                dimension: world.getDimension(saved.dimensionId),
                location: saved.location,
                usedSavedPoint: true,
            };
        } catch (error) {
            console.warn(`[infinite_castle] saved return dimension unavailable: ${saved.dimensionId}: ${error}`);
        }
    }

    try {
        return {
            dimension: world.getDimension(TRANSFER_CONFIG.fallbackReturnDimensionId),
            location: TRANSFER_CONFIG.fallbackReturnLocation,
            usedSavedPoint: false,
        };
    } catch (error) {
        console.warn(`[infinite_castle] Pinene fallback dimension unavailable: ${error}`);
        return {
            dimension: world.getDimension("minecraft:overworld"),
            location: world.getDefaultSpawnLocation(),
            usedSavedPoint: false,
        };
    }
}

function queueExitTransfer(player) {
    arrivingPlayerIds.add(player.id);
    // 保存地点が入口マーカー直上でも、プレイヤーがそこから離れるまでは再入場を抑止する。
    setEntranceBlocked(player, true);
    const destination = resolveReturnDestination(player);

    try {
        player.playSound(TRANSFER_CONFIG.exitSoundId, { volume: 1, pitch: 1.0 });
    } catch {
        // noop
    }

    system.runTimeout(() => {
        let teleported = false;
        try {
            player.teleport(destination.location, { dimension: destination.dimension });
            teleported = true;
            clearReturnPoint(player);
            player.sendMessage("§6琵琶の音とともに、無限城から帰還した。");
        } catch (error) {
            lastExitCheckError = `teleport: ${error}`;
            console.warn(`[infinite_castle] exit teleport failed: ${error?.stack ?? error}`);
            try {
                player.sendMessage(`[infinite_castle] 帰還処理失敗: ${error}`);
            } catch {
                // noop
            }
        } finally {
            if (!teleported) setEntranceBlocked(player, false);
            system.runTimeout(() => arrivingPlayerIds.delete(player.id), ARRIVAL_COOLDOWN_TICKS);
        }
    }, TRANSFER_CONFIG.exitTeleportDelayTicks);
}

setSourcePartsDemoExitTransferHandler((player) => queueExitTransfer(player));

function transitionPlayerToSourceCastle(player, target) {
    const dungeonDimension = world.getDimension(target.dimensionId);
    startEntranceTransition({
        player,
        dungeonDimension,
        landingLocation: target.location,
        soundId: TRANSFER_CONFIG.entranceSoundId,
        onFinished: ({ teleported, error }) => {
            if (!teleported) {
                console.warn(`[infinite_castle] source castle entrance teleport failed: ${error}`);
            }
            system.runTimeout(() => arrivingPlayerIds.delete(player.id), ARRIVAL_COOLDOWN_TICKS);
        },
    });
}

async function migrateAndEnterSourceCastle(player) {
    let transitionStarted = false;
    try {
        const dimension = world.getDimension(INFINITE_CASTLE_DIMENSION_ID);
        if (world.getDynamicProperty(SOURCE_MAIN_MIGRATION_KEY) !== true) {
            player.sendMessage("[infinite_castle] 旧30室版を消去して新しい三層城へ移行します");
            const cleared = await clearDungeonGridJob(
                dimension,
                player,
                { releaseLocks: false }
            );
            if (!cleared) return;
        }

        let target = getSourcePartsDemoEntranceTarget();
        if (!target || target.dimensionId !== INFINITE_CASTLE_DIMENSION_ID) {
            player.sendMessage("[infinite_castle] 新しい三層・15室版の建築を開始します");
            const result = await rebuildSourcePartsAt(
                player,
                dimension,
                SOURCE_MAIN_START_LOCATION,
                SOURCE_MAIN_BUILD_OPTIONS
            );
            if (!result?.ok) return;
            target = getSourcePartsDemoEntranceTarget();
        }
        if (!target || target.dimensionId !== INFINITE_CASTLE_DIMENSION_ID) {
            throw new Error("new source castle entrance target is unavailable");
        }

        player.sendMessage("[infinite_castle] 新しい無限城の入口部屋へ移動します");
        transitionPlayerToSourceCastle(player, target);
        transitionStarted = true;
    } catch (error) {
        console.warn(`[infinite_castle] source castle migration failed: ${error?.stack ?? error}`);
        try {
            player.sendMessage(`[infinite_castle] 新しい無限城への移行失敗: ${error}`);
        } catch {
            // noop
        }
    } finally {
        dungeonResetInProgress = false;
        reconstructionInProgress = false;
        if (!transitionStarted) {
            arrivingPlayerIds.delete(player.id);
            clearReturnPoint(player);
        }
    }
}

function startSourceCastleEntrance(player) {
    if (!player || arrivingPlayerIds.has(player.id)) return;
    if (dungeonResetInProgress || reconstructionInProgress) {
        player.sendMessage("[infinite_castle] 新しい無限城を準備中です。完了後にもう一度入口へ入ってください");
        return;
    }

    const target = getSourcePartsDemoEntranceTarget();
    const migrated = world.getDynamicProperty(SOURCE_MAIN_MIGRATION_KEY) === true;
    if (target && migrated && target.dimensionId === INFINITE_CASTLE_DIMENSION_ID) {
        arrivingPlayerIds.add(player.id);
        saveReturnPoint(player);
        transitionPlayerToSourceCastle(player, target);
        return;
    }

    const dimension = world.getDimension(INFINITE_CASTLE_DIMENSION_ID);
    if (dimension.getPlayers().length > 0) {
        player.sendMessage("[infinite_castle] 初回移行のため、無限城dimensionを一度無人にしてください");
        return;
    }

    arrivingPlayerIds.add(player.id);
    saveReturnPoint(player);
    dungeonResetInProgress = true;
    reconstructionInProgress = true;
    void migrateAndEnterSourceCastle(player);
}

// 出口部屋に到達したプレイヤーを、入場前の場所へ帰す。
// 監視自体の例外をすべて隔離し、1人の無効Entityでinterval全体が止まらないようにする。
function checkExitRooms() {
    exitCheckTickCount += 1;
    lastExitCheckError = "none";
    if (!currentGraph) {
        lastExitPlayerCount = 0;
        return;
    }

    let dimension;
    let players;
    try {
        dimension = world.getDimension(INFINITE_CASTLE_DIMENSION_ID);
        players = dimension.getPlayers();
        lastExitPlayerCount = players.length;
    } catch (error) {
        lastExitPlayerCount = -1;
        lastExitCheckError = `dimension: ${error}`;
        console.warn(`[infinite_castle] exit monitor could not read dungeon players: ${error?.stack ?? error}`);
        return;
    }

    for (const player of players) {
        if (arrivingPlayerIds.has(player.id)) continue;
        try {
            const cell = worldToCell(player.location);
            const room = getRoom(currentGraph, cell);
            if (!room || room.category !== RoomCategory.Exit) continue;
            queueExitTransfer(player);
        } catch (error) {
            lastExitCheckError = `player ${player.name}: ${error}`;
            console.warn(`[infinite_castle] exit monitor failed for a player: ${error?.stack ?? error}`);
            try {
                player.sendMessage(`[infinite_castle] 出口判定失敗: ${error}`);
            } catch {
                // noop
            }
        }
    }
}
system.runInterval(checkExitRooms, EXIT_CHECK_INTERVAL_TICKS);

async function refreshVisualsJob(dimension, rooms, requestedBy) {
    try {
        const report = await buildRoomsJob(dimension, rooms, { markRendererCurrent: true });
        if (report.failures.length === 0) {
            const audit = await auditAndRepairConnections(dimension, rooms);
            requestedBy?.sendMessage(
                `[infinite_castle] 建築更新完了 ${report.succeeded}/${report.requested} connectionAudit=${audit.unresolved.length === 0 ? "ok" : `unresolved:${audit.unresolved.length}`} repaired=${audit.repairedRooms} (${PACK_BUILD_ID})`
            );
        } else {
            requestedBy?.sendMessage(
                `[infinite_castle] 建築更新失敗 success=${report.succeeded}/${report.requested} failures=${report.failures.length}; debug_build_reportで確認してください`
            );
        }
    } catch (error) {
        console.warn(`[infinite_castle] visual refresh failed: ${error?.stack ?? error}`);
        try {
            requestedBy?.sendMessage(`[infinite_castle] 建築更新失敗: ${error}`);
        } catch {
            // noop
        }
    } finally {
        dungeonResetInProgress = false;
        reconstructionInProgress = false;
    }
}

function startVisualRefresh(player) {
    if (USE_SOURCE_PARTS_MAIN_CASTLE) {
        player?.sendMessage("[infinite_castle] 旧30室版は無効です。新しい三層城を使用します");
        return;
    }
    if (!currentGraph) {
        player?.sendMessage("[infinite_castle] 復元済みグラフがありません");
        return;
    }
    if (dungeonResetInProgress || reconstructionInProgress) {
        player?.sendMessage("[infinite_castle] 別の建築処理が進行中です");
        return;
    }
    const dimension = world.getDimension(INFINITE_CASTLE_DIMENSION_ID);
    if (dimension.getPlayers().length > 0) {
        player?.sendMessage(
            "[infinite_castle] 安全のため城内にプレイヤーがいる間は外観更新できません。先に退出してください"
        );
        return;
    }
    dungeonResetInProgress = true;
    reconstructionInProgress = true;
    player?.sendMessage("[infinite_castle] 和風建築への更新を開始します");
    void refreshVisualsJob(dimension, getAllRooms(currentGraph), player);
}

// 保存グラフが旧renderer版なら、城が無人になった瞬間に一度だけ全室を更新する。
// プレイヤーがいる場合は何も壊さず、退出まで待つ。
function checkPendingVisualUpgrade() {
    if (USE_SOURCE_PARTS_MAIN_CASTLE) return;
    if (!pendingVisualUpgrade || !currentGraph) return;
    if (dungeonResetInProgress || reconstructionInProgress) return;
    if (autoVisualUpgradeAttemptedThisSession) return;
    const now = world.getAbsoluteTime();
    if (now - lastVisualUpgradeAttemptTime < 20 * 60) return;
    try {
        const dimension = world.getDimension(INFINITE_CASTLE_DIMENSION_ID);
        if (dimension.getPlayers().length > 0) return;
    } catch (error) {
        console.warn(`[infinite_castle] renderer upgrade check failed: ${error}`);
        return;
    }
    lastVisualUpgradeAttemptTime = now;
    autoVisualUpgradeAttemptedThisSession = true;
    console.warn(`[infinite_castle] upgrading saved castle renderer to v${CURRENT_RENDERER_VERSION}`);
    startVisualRefresh(undefined);
}
system.runInterval(checkPendingVisualUpgrade, 20);

function parseRoomCell(message) {
    const parts = String(message ?? "").trim().split(/[\s,]+/).filter(Boolean);
    if (parts.length !== 3) return null;
    const values = parts.map(Number);
    if (!values.every(Number.isInteger)) return null;
    return { x: values[0], y: values[1], z: values[2] };
}

async function repairSingleRoomJob(dimension, room, requestedBy) {
    try {
        await buildRoomsJob(dimension, [room]);
        requestedBy?.sendMessage(
            `[infinite_castle] 部屋 ${cellKey(room.cell)} を修復しました (roomSeed=${room.roomSeed}, revision=${room.revision})`
        );
    } catch (error) {
        console.warn(`[infinite_castle] room repair failed: ${error?.stack ?? error}`);
        try {
            requestedBy?.sendMessage(`[infinite_castle] 部屋修復失敗: ${error}`);
        } catch {
            // noop
        }
    } finally {
        dungeonResetInProgress = false;
        reconstructionInProgress = false;
    }
}

function startSingleRoomRepair(event) {
    const player = event.sourceEntity;
    if (USE_SOURCE_PARTS_MAIN_CASTLE) {
        player?.sendMessage("[infinite_castle] 旧30室版の部屋修復は無効です");
        return;
    }
    if (!currentGraph) {
        player?.sendMessage("[infinite_castle] 復元済みグラフがありません");
        return;
    }
    if (dungeonResetInProgress || reconstructionInProgress) {
        player?.sendMessage("[infinite_castle] 別の建築処理が進行中です");
        return;
    }
    const cell = parseRoomCell(event.message);
    if (!cell) {
        player?.sendMessage("[infinite_castle] 使用法: /scriptevent infinite_castle:repair_room <cellX> <cellY> <cellZ>");
        return;
    }
    const room = getRoom(currentGraph, cell);
    if (!room) {
        player?.sendMessage(`[infinite_castle] 指定セル ${cellKey(cell)} に管理対象の部屋はありません`);
        return;
    }
    const dimension = world.getDimension(INFINITE_CASTLE_DIMENSION_ID);
    if (dimension.getPlayers().length > 0) {
        player?.sendMessage("[infinite_castle] 安全のため城内にプレイヤーがいる間は部屋を修復できません");
        return;
    }
    dungeonResetInProgress = true;
    reconstructionInProgress = true;
    player?.sendMessage(
        `[infinite_castle] 部屋 ${cellKey(cell)} を同じroomSeed=${room.roomSeed}で修復します`
    );
    void repairSingleRoomJob(dimension, room, player);
}

async function regenerateDungeonJob(dimension, oldRooms, newResult, requestedBy) {
    try {
        const orderedOldRooms = oldRooms.slice().sort((a, b) => b.cell.y - a.cell.y);
        for (const room of orderedOldRooms) {
            const areaName = `ic_m_${room.cell.x}_${room.cell.y}_${room.cell.z}`;
            const loadResult = await acquireLoadedRoomChunks(dimension, room, areaName);
            if (!loadResult.ok) {
                console.warn(`[infinite_castle] migration clear skipped at ${JSON.stringify(room.cell)}: ${loadResult.error}`);
                releaseRoomTickingArea(areaName);
                await waitOneTick();
                continue;
            }
            try {
                clearJapaneseRoom(dimension, room);
            } catch (error) {
                console.warn(`[infinite_castle] migration clear failed at ${JSON.stringify(room.cell)}: ${error}`);
            }
            releaseRoomTickingArea(areaName);
            await waitOneTick();
        }

        currentGraph = newResult.graph;
        currentEntranceCell = newResult.entranceCell;
        world.setDynamicProperty(SEED_KEY, newResult.seed);
        scheduleNextReconstruction();
        const rooms = getAllRooms(currentGraph);
        const report = await buildRoomsJob(dimension, rooms, { markRendererCurrent: true });
        const audit = report.failures.length === 0
            ? await auditAndRepairConnections(dimension, rooms)
            : null;
        requestedBy?.sendMessage(
            `[infinite_castle] 新設計の30室へ完全更新しました connectionAudit=${audit ? (audit.unresolved.length === 0 ? "ok" : `unresolved:${audit.unresolved.length}`) : "not-run"}`
        );
    } catch (error) {
        console.warn(`[infinite_castle] v0.1 migration failed: ${error?.stack ?? error}`);
        try {
            requestedBy?.sendMessage(`[infinite_castle] 新設計への更新失敗: ${error}`);
        } catch {
            // noop
        }
    } finally {
        dungeonResetInProgress = false;
        reconstructionInProgress = false;
    }
}

function startV01Regeneration(player) {
    if (USE_SOURCE_PARTS_MAIN_CASTLE) {
        player?.sendMessage("[infinite_castle] 旧30室版の再生成は無効です");
        return;
    }
    if (!currentGraph) {
        player?.sendMessage("[infinite_castle] 復元済みグラフがありません。一度入口から生成してください");
        return;
    }
    if (dungeonResetInProgress || reconstructionInProgress) {
        player?.sendMessage("[infinite_castle] 別の建築処理が進行中です");
        return;
    }
    const dimension = world.getDimension(INFINITE_CASTLE_DIMENSION_ID);
    if (dimension.getPlayers().length > 0) {
        player?.sendMessage(
            "[infinite_castle] 安全のため城内にプレイヤーがいる間は完全更新できません。先に退出してください"
        );
        return;
    }

    // 消去前に新グラフを完成・検証する。生成失敗時は旧城へ一切触れない。
    const newResult = generateDungeon({ seed: Date.now() });
    const oldRooms = getAllRooms(currentGraph);
    dungeonResetInProgress = true;
    reconstructionInProgress = true;
    player?.sendMessage("[infinite_castle] 旧セルを安全に片付け、新設計の30室へ更新します");
    void regenerateDungeonJob(dimension, oldRooms, newResult, player);
}

async function rebuildFromScratchJob(dimension, newResult, requestedBy) {
    const failures = [];
    try {
        const cells = getAllGridCells().sort((a, b) => b.y - a.y || a.z - b.z || a.x - b.x);
        for (let index = 0; index < cells.length; index += 1) {
            const cell = cells[index];
            const room = { cell };
            const areaName = `ic_zero_${cell.x}_${cell.y}_${cell.z}`;
            const loadResult = await acquireLoadedRoomChunks(dimension, room, areaName);
            if (!loadResult.ok) {
                failures.push({ cell: cellKey(cell), error: loadResult.error });
                releaseRoomTickingArea(areaName);
                continue;
            }
            try {
                clearJapaneseRoom(dimension, room);
            } catch (error) {
                failures.push({ cell: cellKey(cell), error: String(error) });
            } finally {
                releaseRoomTickingArea(areaName);
            }
            await waitOneTick();
            if ((index + 1) % 25 === 0) {
                requestedBy?.sendMessage(`[infinite_castle] 全消去 ${index + 1}/${cells.length}`);
            }
        }

        if (failures.length > 0) {
            requestedBy?.sendMessage(
                `[infinite_castle] 全消去失敗: ${failures.length}/100セル。再実行してください`
            );
            for (const failure of failures.slice(0, 3)) {
                requestedBy?.sendMessage(`[infinite_castle] failed cell=${failure.cell} ${failure.error}`);
            }
            return;
        }

        currentGraph = newResult.graph;
        currentEntranceCell = newResult.entranceCell;
        world.setDynamicProperty(SEED_KEY, newResult.seed);
        world.setDynamicProperty(RENDERER_VERSION_KEY, undefined);
        pendingVisualUpgrade = true;
        scheduleNextReconstruction();
        saveState();

        const report = await buildRoomsJob(
            dimension,
            getAllRooms(currentGraph),
            { markRendererCurrent: true }
        );
        if (report.failures.length === 0) {
            const audit = await auditAndRepairConnections(dimension, getAllRooms(currentGraph));
            if (requestedBy) {
                clearReturnPoint(requestedBy);
                setEntranceBlocked(requestedBy, false);
            }
            requestedBy?.sendMessage(
                `[infinite_castle] 完全新規生成完了: castleSeed=${newResult.seed} rooms=${report.succeeded}/30 connectionAudit=${audit.unresolved.length === 0 ? "ok" : `unresolved:${audit.unresolved.length}`} repaired=${audit.repairedRooms}`
            );
            requestedBy?.sendMessage(
                "[infinite_castle] /scriptevent infinite_castle:room_seeds 1 で部屋seedを確認できます"
            );
        } else {
            requestedBy?.sendMessage(
                `[infinite_castle] 新規生成の建築失敗: ${report.succeeded}/${report.requested}`
            );
        }
    } catch (error) {
        console.warn(`[infinite_castle] rebuild from scratch failed: ${error?.stack ?? error}`);
        try {
            requestedBy?.sendMessage(`[infinite_castle] 完全新規生成失敗: ${error}`);
        } catch {
            // noop
        }
    } finally {
        dungeonResetInProgress = false;
        reconstructionInProgress = false;
    }
}

function startRebuildFromScratch(player) {
    if (USE_SOURCE_PARTS_MAIN_CASTLE) {
        player?.sendMessage("[infinite_castle] 旧30室版の新規生成は無効です");
        return;
    }
    if (dungeonResetInProgress || reconstructionInProgress) {
        player?.sendMessage("[infinite_castle] 別の建築処理が進行中です");
        return;
    }
    const dimension = world.getDimension(INFINITE_CASTLE_DIMENSION_ID);
    if (dimension.getPlayers().length > 0) {
        player?.sendMessage(
            "[infinite_castle] 全100セルを消去するため、城内を無人にしてから実行してください"
        );
        return;
    }

    // 消去前に新グラフを完成させる。生成失敗時は既存ブロックへ触れない。
    const newResult = generateDungeon({ seed: Date.now() });
    dungeonResetInProgress = true;
    reconstructionInProgress = true;
    player?.sendMessage(
        `[infinite_castle] 完全初期化開始: castleSeed=${newResult.seed} gridCells=100 newRooms=30`
    );
    void rebuildFromScratchJob(dimension, newResult, player);
}

function clearSavedDungeonState() {
    currentGraph = null;
    currentEntranceCell = null;
    pendingVisualUpgrade = false;
    world.setDynamicProperty(GRAPH_KEY, undefined);
    world.setDynamicProperty(ENTRANCE_CELL_KEY, undefined);
    world.setDynamicProperty(SEED_KEY, undefined);
    world.setDynamicProperty(RENDERER_VERSION_KEY, undefined);
    world.setDynamicProperty(NEXT_RECONSTRUCTION_TICK_KEY, undefined);
    world.setDynamicProperty(SOURCE_DYNAMIC_NEXT_TICK_KEY, undefined);
    world.setDynamicProperty(SOURCE_MAIN_MIGRATION_KEY, true);
}

async function clearDungeonGridJob(dimension, requestedBy, { releaseLocks = true } = {}) {
    const failures = [];
    try {
        const cells = getAllGridCells().sort((a, b) => b.y - a.y || a.z - b.z || a.x - b.x);
        for (let index = 0; index < cells.length; index += 1) {
            const cell = cells[index];
            const room = { cell };
            const areaName = `ic_clear_grid_${cell.x}_${cell.y}_${cell.z}`;
            const loadResult = await acquireLoadedRoomChunks(dimension, room, areaName);
            if (!loadResult.ok) {
                failures.push({ cell: cellKey(cell), error: loadResult.error });
                releaseRoomTickingArea(areaName);
                await waitOneTick();
                continue;
            }
            try {
                clearJapaneseRoom(dimension, room);
            } catch (error) {
                failures.push({ cell: cellKey(cell), error: String(error) });
            } finally {
                releaseRoomTickingArea(areaName);
            }
            await waitOneTick();
            if ((index + 1) % 25 === 0) {
                requestedBy?.sendMessage(`[infinite_castle] 旧30室版の消去 ${index + 1}/${cells.length}`);
            }
        }

        if (failures.length > 0) {
            requestedBy?.sendMessage(
                `[infinite_castle] 旧30室版の消去失敗: ${failures.length}/${cells.length}セル。もう一度同じコマンドを実行してください`
            );
            for (const failure of failures.slice(0, 3)) {
                requestedBy?.sendMessage(`[infinite_castle] failed cell=${failure.cell} ${failure.error}`);
            }
            return false;
        }

        // 全セルの消去が完了してから保存グラフを外す。途中失敗時は状態を残し、
        // 同じ100セルを安全に再試行できるようにする。
        clearSavedDungeonState();
        requestedBy?.sendMessage(
            `[infinite_castle] 旧30室版の消去完了: cells=${cells.length} bounds=0,0,0..119,63,119`
        );
        return true;
    } catch (error) {
        console.warn(`[infinite_castle] dungeon grid clear failed: ${error?.stack ?? error}`);
        try {
            requestedBy?.sendMessage(`[infinite_castle] 旧30室版の消去失敗: ${error}`);
        } catch {
            // noop
        }
        return false;
    } finally {
        if (releaseLocks) {
            dungeonResetInProgress = false;
            reconstructionInProgress = false;
        }
    }
}

function startClearDungeonGrid(player, rawOptions = "") {
    if (!player) return;
    if (String(rawOptions ?? "").trim().toLowerCase() !== "confirm") {
        player.sendMessage(
            "[infinite_castle] 消去するには /scriptevent infinite_castle:clear_dungeon_grid confirm"
        );
        player.sendMessage(
            "[infinite_castle] 注意: 無限城dimensionの全100セル (0,0,0..119,63,119) をair化します"
        );
        return;
    }
    if (dungeonResetInProgress || reconstructionInProgress) {
        player.sendMessage("[infinite_castle] 別の建築処理が進行中です");
        return;
    }

    const dimension = world.getDimension(INFINITE_CASTLE_DIMENSION_ID);
    if (dimension.getPlayers().length > 0) {
        player.sendMessage(
            "[infinite_castle] 安全のため無限城dimensionを無人にしてから実行してください"
        );
        return;
    }

    dungeonResetInProgress = true;
    reconstructionInProgress = true;
    player.sendMessage(
        "[infinite_castle] 旧30室版の全100セルを消去します。完了表示までワールドを閉じないでください"
    );
    void clearDungeonGridJob(dimension, player);
}

function startSourceCastleActivation(player, rawOptions = "") {
    if (!player) return;
    if (String(rawOptions ?? "").trim().toLowerCase() !== "confirm") {
        player.sendMessage(
            "[infinite_castle] 移行するには /scriptevent infinite_castle:activate_source_castle confirm"
        );
        player.sendMessage(
            "[infinite_castle] 旧30室版を消去し、新しい三層・15室版をメイン無限城として建築します"
        );
        return;
    }
    if (player.dimension.id === INFINITE_CASTLE_DIMENSION_ID) {
        player.sendMessage(
            "[infinite_castle] 安全のため先に無限城dimensionから退出して、オーバーワールドで実行してください"
        );
        return;
    }
    startSourceCastleEntrance(player);
}

async function connectionAuditJob(dimension, rooms, requestedBy) {
    try {
        const report = await auditAndRepairConnections(dimension, rooms);
        requestedBy?.sendMessage(
            `[infinite_castle] 接続監査完了: checked=${report.roomsChecked} issueRooms=${report.issueRooms} repaired=${report.repairedRooms} unresolved=${report.unresolved.length}`
        );
        for (const failure of report.unresolved.slice(0, 5)) {
            requestedBy?.sendMessage(`[infinite_castle] unresolved cell=${failure.cell} ${failure.error}`);
        }
    } catch (error) {
        console.warn(`[infinite_castle] connection audit failed: ${error?.stack ?? error}`);
        requestedBy?.sendMessage(`[infinite_castle] 接続監査失敗: ${error}`);
    } finally {
        dungeonResetInProgress = false;
        reconstructionInProgress = false;
    }
}

function startConnectionAudit(player) {
    if (USE_SOURCE_PARTS_MAIN_CASTLE) {
        player?.sendMessage("[infinite_castle] 旧30室版の接続監査は無効です");
        return;
    }
    if (!currentGraph) {
        player?.sendMessage("[infinite_castle] 復元済みグラフがありません");
        return;
    }
    if (dungeonResetInProgress || reconstructionInProgress) {
        player?.sendMessage("[infinite_castle] 別の建築処理が進行中です");
        return;
    }
    const dimension = world.getDimension(INFINITE_CASTLE_DIMENSION_ID);
    if (dimension.getPlayers().length > 0) {
        player?.sendMessage(
            "[infinite_castle] 上下開口も修復するため、城内を無人にしてから接続監査を実行してください"
        );
        return;
    }
    dungeonResetInProgress = true;
    reconstructionInProgress = true;
    player?.sendMessage("[infinite_castle] 全30部屋の物理connector監査を開始します");
    void connectionAuditJob(dimension, getAllRooms(currentGraph), player);
}

// デバッグ用: /scriptevent infinite_castle:force_reconstruct で即座に再構築を試せる。
system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:force_reconstruct") return;
    const player = event.sourceEntity;
    if (USE_SOURCE_PARTS_MAIN_CASTLE) {
        if (!player || player.dimension.id !== INFINITE_CASTLE_DIMENSION_ID) {
            player?.sendMessage("[infinite_castle] 新しい部分再構築は無限城内で実行してください");
            return;
        }
        if (sourceDynamicReconstructionInProgress || isSourcePartsReconstructionInProgress()) {
            player.sendMessage("[infinite_castle] 部分再構築はすでに進行中です");
            return;
        }
        player.sendMessage("[infinite_castle] 在室パーツを固定して周囲を即時再構築します");
        const requestedSeed = Number.parseInt(String(event.message ?? "").trim(), 10);
        void runSourceDynamicReconstruction(
            player.dimension,
            Number.isFinite(requestedSeed) ? requestedSeed >>> 0 : undefined
        );
        return;
    }
    forceReconstructionNow();
    player?.sendMessage("[infinite_castle] 次回チェックで再構築します");

    // DEBUG: 同じコマンドに相乗りして、足元ブロック・在室セル情報・tickカウントを一緒に報告する。
    if (player) {
        try {
            const dimension = player.dimension;
            const pos = {
                x: Math.floor(player.location.x),
                y: Math.floor(player.location.y) - 1,
                z: Math.floor(player.location.z),
            };
            const block = dimension.getBlock(pos);
            player.sendMessage(
                `[ic-debug] dim=${dimension.id} pos=${pos.x},${pos.y},${pos.z} block=${block?.typeId ?? "undefined"} tickCount=${entranceCheckTickCount}`
            );
            const cell = worldToCell(player.location);
            const room = currentGraph ? getRoom(currentGraph, cell) : null;
            player.sendMessage(
                `[ic-debug] cell=${cell.x},${cell.y},${cell.z} room=${room ? `${room.category}/${room.templateId}/protected=${room.isProtected}` : "none"} arriving=${arrivingPlayerIds.has(player.id)}`
            );
        } catch (error) {
            player.sendMessage(`[ic-debug] error: ${error}`);
        }
    }
});

// デバッグ用: runIntervalを介さず即座に足元ブロックを調べる(検出ロジック単体の切り分け用)。
system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:debug_foot_block") return;
    const player = event.sourceEntity;
    if (!player) return;
    try {
        const dimension = player.dimension;
        const pos = {
            x: Math.floor(player.location.x),
            y: Math.floor(player.location.y) - 1,
            z: Math.floor(player.location.z),
        };
        const block = dimension.getBlock(pos);
        player.sendMessage(
            `[ic-debug] dim=${dimension.id} pos=${pos.x},${pos.y},${pos.z} block=${block?.typeId ?? "undefined"}`
        );
    } catch (error) {
        player.sendMessage(`[ic-debug] error: ${error}`);
    }
});
system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:debug_tick_count") return;
    const player = event.sourceEntity;
    player?.sendMessage(
        `[ic-debug] entranceChecks=${entranceCheckTickCount} exitChecks=${exitCheckTickCount} dungeonPlayers=${lastExitPlayerCount} lastExitError=${lastExitCheckError}`
    );
});

system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:debug_build_version") return;
    const storedRendererVersion = world.getDynamicProperty(RENDERER_VERSION_KEY);
    event.sourceEntity?.sendMessage(
        `[ic-debug] build=${PACK_BUILD_ID} renderer=${CURRENT_RENDERER_VERSION} storedRenderer=${storedRendererVersion ?? "none"} pendingUpgrade=${pendingVisualUpgrade} lastBuild=${lastBuildReport.succeeded}/${lastBuildReport.requested} failures=${lastBuildReport.failures.length}`
    );
    event.sourceEntity?.sendMessage(
        `[ic-debug] main=source-parts migrated=${world.getDynamicProperty(SOURCE_MAIN_MIGRATION_KEY) === true} sourceEntrance=${getSourcePartsDemoEntranceTarget() ? "ready" : "missing"}`
    );
    const sourceNext = getSourceDynamicNextTick();
    event.sourceEntity?.sendMessage(
        `[ic-debug] sourceDynamic=15m nextInSeconds=${sourceNext === null ? "idle" : Math.max(0, Math.ceil((sourceNext - world.getAbsoluteTime()) / 20))} inProgress=${sourceDynamicReconstructionInProgress || isSourcePartsReconstructionInProgress()} progression=off`
    );
    const scenery = getSourcePartsSceneryStatus();
    event.sourceEntity?.sendMessage(
        `[ic-debug] scenery=${scenery.status} known=${scenery.known} `
        + `density=${scenery.density} buildings=${scenery.placements} `
        + `inProgress=${scenery.inProgress}`
    );
});

system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:debug_build_report") return;
    const player = event.sourceEntity;
    player?.sendMessage(
        `[ic-debug] buildReport requested=${lastBuildReport.requested} succeeded=${lastBuildReport.succeeded} failures=${lastBuildReport.failures.length}`
    );
    for (const failure of lastBuildReport.failures.slice(0, 5)) {
        player?.sendMessage(`[ic-debug] failed cell=${failure.cell} error=${failure.error}`);
    }
});

system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:preview_source_parts") return;
    void previewSourceParts(event.sourceEntity);
});

system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:rebuild_source_parts") return;
    void rebuildSourcePartsV2(event.sourceEntity, event.message);
});

system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:rebuild_scenery") return;
    const player = event.sourceEntity;
    if (!player || player.dimension.id !== INFINITE_CASTLE_DIMENSION_ID) {
        player?.sendMessage("[infinite_castle] 装飾城郭は無限城ディメンション内で再構築してください");
        return;
    }
    void rebuildSourcePartsSceneryForPlayer(player, event.message);
});

system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:clear_scenery") return;
    const player = event.sourceEntity;
    if (!player || player.dimension.id !== INFINITE_CASTLE_DIMENSION_ID) {
        player?.sendMessage("[infinite_castle] 装飾城郭は無限城ディメンション内で消去してください");
        return;
    }
    void clearSourcePartsSceneryForPlayer(player, event.message);
});

system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:repair_openings") return;
    const player = event.sourceEntity;
    if (!player || player.dimension.id !== INFINITE_CASTLE_DIMENSION_ID) {
        player?.sendMessage("[infinite_castle] 出入口修復は無限城ディメンション内で実行してください");
        return;
    }
    void repairSourcePartsOpenings(player);
});

system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:clear_source_parts") return;
    void clearSourcePartsV2(event.sourceEntity, event.message);
});

system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:debug_connection_report") return;
    const player = event.sourceEntity;
    player?.sendMessage(
        `[ic-debug] connectionAudit checked=${lastConnectionAudit.roomsChecked} issueRooms=${lastConnectionAudit.issueRooms} repaired=${lastConnectionAudit.repairedRooms} unresolved=${lastConnectionAudit.unresolved.length}`
    );
    for (const failure of lastConnectionAudit.unresolved.slice(0, 5)) {
        player?.sendMessage(`[ic-debug] unresolved cell=${failure.cell} ${failure.error}`);
    }
});

// 既存グラフを変えず、現在の30セルだけを新しい和風レンダラーで建て直す。
system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:debug_refresh_visuals") return;
    startVisualRefresh(event.sourceEntity);
});

// 運用向け修復コマンド。roomSeed/revisionは変えず、壊されたブロックだけを再描画する。
system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:repair_all") return;
    startVisualRefresh(event.sourceEntity);
});
system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:repair_room") return;
    startSingleRoomRepair(event);
});

// 旧トポロジーの追跡済みセルだけを片付け、新しい30室グラフへ移行する。
// 実行時に城内が無人であることを必須条件にしている。
system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:debug_regenerate_v01") return;
    startV01Regeneration(event.sourceEntity);
});

// 旧版の未追跡ブロックも含め、5x5x4全セルを消去して新しいcastleSeedから作り直す。
system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:rebuild_from_scratch") return;
    startRebuildFromScratch(event.sourceEntity);
});

// 旧30室版を物理ブロック・保存グラフともに消去する。新しい城は生成しない。
system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:clear_dungeon_grid") return;
    startClearDungeonGrid(event.sourceEntity, event.message);
});

system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:activate_source_castle") return;
    startSourceCastleActivation(event.sourceEntity, event.message);
});

system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:audit_connections") return;
    startConnectionAudit(event.sourceEntity);
});

// 旧デバッグコマンドも、ブロック残骸を残さない完全初期化へ統一する。
system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:debug_reset_dungeon") return;
    startRebuildFromScratch(event.sourceEntity);
});

// デバッグ用: 再構築を実際に走らせずに、今いる部屋の情報だけを確認する(出口検出の切り分け用)。
system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:debug_room_info") return;
    const player = event.sourceEntity;
    if (!player) return;
    try {
        const cell = worldToCell(player.location);
        const room = currentGraph ? getRoom(currentGraph, cell) : null;
        player.sendMessage(
            `[ic-debug] dim=${player.dimension.id} cell=${cell.x},${cell.y},${cell.z} room=${room ? `${room.category}/${room.templateId}/seed=${room.roomSeed}/revision=${room.revision}/protected=${!!room.isProtected}` : "none"} arriving=${arrivingPlayerIds.has(player.id)} entryBlocked=${isEntranceBlocked(player)} hasReturn=${!!loadReturnPoint(player)} isExitCategory=${room?.category === RoomCategory.Exit}`
        );
    } catch (error) {
        player.sendMessage(`[ic-debug] error: ${error}`);
    }
});

// デバッグ用: 再構築スケジュールの内部状態(due判定・進行中フラグ・tick差分)を確認する。
system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:debug_reconstruction_status") return;
    const player = event.sourceEntity;
    if (!player) return;
    if (USE_SOURCE_PARTS_MAIN_CASTLE) {
        const sourceNext = getSourceDynamicNextTick();
        let dungeonPlayers = -1;
        try {
            dungeonPlayers = world.getDimension(INFINITE_CASTLE_DIMENSION_ID).getPlayers().length;
        } catch {
            // Keep -1 as the diagnostic value.
        }
        player.sendMessage(
            `[ic-debug] sourceDynamic=15m nextInSeconds=${sourceNext === null ? "idle" : Math.max(0, Math.ceil((sourceNext - world.getAbsoluteTime()) / 20))} `
            + `inProgress=${sourceDynamicReconstructionInProgress || isSourcePartsReconstructionInProgress()} `
            + `dungeonPlayers=${dungeonPlayers} progression=off`
        );
        return;
    }
    const next = getNextReconstructionTick();
    player.sendMessage(
        `[ic-debug] castleSeed=${world.getDynamicProperty(SEED_KEY) ?? "none"} currentTick=${system.currentTick} absoluteTime=${world.getAbsoluteTime()} next=${next} due=${isReconstructionDue()} inProgress=${reconstructionInProgress} hasGraph=${!!currentGraph} exitChecks=${exitCheckTickCount} dungeonPlayers=${lastExitPlayerCount} lastExitError=${lastExitCheckError}`
    );
});

// 現在のcastleSeedと全RoomInstanceのroomSeed/revisionを6件ずつ表示する。
system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:room_seeds") return;
    const player = event.sourceEntity;
    if (!player) return;
    if (!currentGraph) {
        player.sendMessage("[ic-seed] currentGraph=null");
        return;
    }
    const rooms = getAllRooms(currentGraph).sort((a, b) =>
        a.cell.y - b.cell.y || a.cell.z - b.cell.z || a.cell.x - b.cell.x
    );
    const perPage = 6;
    const pageCount = Math.max(1, Math.ceil(rooms.length / perPage));
    const requestedPage = Number.parseInt(String(event.message ?? "1").trim(), 10);
    const page = Math.min(pageCount, Math.max(1, Number.isInteger(requestedPage) ? requestedPage : 1));
    const castleSeed = world.getDynamicProperty(SEED_KEY);
    player.sendMessage(`[ic-seed] castleSeed=${castleSeed ?? "none"} page=${page}/${pageCount}`);
    for (const room of rooms.slice((page - 1) * perPage, page * perPage)) {
        player.sendMessage(
            `[ic-seed] cell=${cellKey(room.cell)} seed=${room.roomSeed >>> 0} rev=${room.revision} ${room.category}/${room.templateId}${room.isProtected ? " LOCK" : ""}`
        );
    }
});

// 出口探索を待たず帰還経路だけを検証する。
system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:debug_force_exit") return;
    const player = event.sourceEntity;
    if (!player || player.dimension.id !== INFINITE_CASTLE_DIMENSION_ID) return;
    if (arrivingPlayerIds.has(player.id)) {
        player.sendMessage("[ic-debug] transfer already pending");
        return;
    }
    queueExitTransfer(player);
    player.sendMessage("[ic-debug] forced exit transfer queued");
});

// デバッグ用: 現在のグラフに登録されている出口部屋のセル座標を全て一覧表示する(出口検出の切り分け用)。
system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "infinite_castle:debug_list_exits") return;
    const player = event.sourceEntity;
    if (!player) return;
    if (!currentGraph) {
        player.sendMessage("[ic-debug] currentGraph=null");
        return;
    }
    const exits = getAllRooms(currentGraph).filter((room) => room.category === RoomCategory.Exit);
    if (exits.length === 0) {
        player.sendMessage("[ic-debug] exit rooms: 0件");
        return;
    }
    for (const room of exits) {
        const min = cellWorldMin(room.cell);
        const max = cellWorldMax(room.cell);
        player.sendMessage(
            `[ic-debug] exit cell=${room.cell.x},${room.cell.y},${room.cell.z} worldXZ=${min.x}..${max.x},${min.z}..${max.z} y=${min.y}..${max.y} protected=${!!room.isProtected} connectors=${room.resolvedConnectors.map((c) => c.direction).join(",")}`
        );
    }
});
