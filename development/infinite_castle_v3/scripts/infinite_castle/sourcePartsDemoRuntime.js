import { system, world } from "@minecraft/server";
import { createSourcePartsDemoProgression } from "./sourcePartsDemoProgression.js";
import {
    completeSourcePartsDemoRoom,
    createSourcePartsDemoProgressionState,
    enterSourcePartsDemoRoom,
    getSourcePartsDemoRoomStatus,
    summarizeSourcePartsDemoProgressionState,
} from "./sourcePartsDemoProgressionState.js";
import {
    createSourcePartsDemoRuntimeRecord,
    findSourcePartsDemoRoomAtLocation,
    formatSourcePartsDemoRoomNotice,
    parseSourcePartsDemoRuntimeRecord,
    serializeSourcePartsDemoRuntimeRecord,
    shouldAutoCompleteSourcePartsDemoRoom,
    sourcePartsDemoRoleLabel,
    sourcePartsDemoTierLabel,
    updateSourcePartsDemoRuntimeRecordState,
} from "./sourcePartsDemoRuntimePure.js";

export const SOURCE_PARTS_DEMO_RUNTIME_PROPERTY_KEY = "infinite_castle:source_parts_demo_v1";

const ROOM_CHECK_INTERVAL_TICKS = 5;
const MANUAL_COMPLETE_ROLES = new Set(["miniboss", "final"]);
// Progression roles are retained only as compact entrance/exit metadata.  The
// key/reward/boss game loop is intentionally dormant until its proper design.
const PROGRESSION_ENABLED = false;

let activeRuntime = null;
let detectionRunId = null;
let lastDetectionError = null;
const enteredRoomByPlayerId = new Map();
let exitTransferHandler = null;

function warnOnce(message) {
    if (lastDetectionError === message) return;
    lastDetectionError = message;
    console.warn(`[infinite_castle] source-parts demo detector: ${message}`);
}

function playerFromEvent(event) {
    const entity = event?.sourceEntity;
    return entity?.typeId === "minecraft:player" && typeof entity.sendMessage === "function"
        ? entity
        : null;
}

function currentRoomForPlayer(player) {
    if (!activeRuntime || player.dimension.id !== activeRuntime.dimensionId) return null;
    return findSourcePartsDemoRoomAtLocation(activeRuntime.rooms, player.location);
}

function replaceState(nextState) {
    if (!activeRuntime) return;
    const nextRecord = updateSourcePartsDemoRuntimeRecordState(
        activeRuntime.record,
        activeRuntime.progression,
        nextState
    );
    const serialized = serializeSourcePartsDemoRuntimeRecord(nextRecord);
    activeRuntime = { ...activeRuntime, state: nextState, record: nextRecord };
    try {
        world.setDynamicProperty(SOURCE_PARTS_DEMO_RUNTIME_PROPERTY_KEY, serialized);
    } catch (error) {
        console.warn(`[infinite_castle] failed to persist source-parts demo state: ${error}`);
    }
}

function completionNotice(room, summary) {
    const prefix = formatSourcePartsDemoRoomNotice(room, "complete");
    if (room.role === "key") return `${prefix} §e鍵 ${summary.keyCount}/3§r`;
    if (room.role === "reward") return `${prefix} §b報酬 ${summary.rewardCount}/7§r`;
    if (room.role === "miniboss") return `${prefix} §c中ボス ${summary.minibossCount}/2§r`;
    if (room.role === "exit") {
        return exitTransferHandler
            ? `${prefix} §7（帰還処理を開始）§r`
            : `${prefix} §7（デモでは転送なし）§r`;
    }
    return prefix;
}

function nextObjectiveNotice(summary) {
    if (!summary.nextObjectiveId) return "[ic-demo] 必須目標をすべて完了しました";
    return `[ic-demo] 次の目標: ${summary.nextObjectiveId}`;
}

function handleRoomEntry(player, room) {
    if (!activeRuntime) return;
    try {
        if (!PROGRESSION_ENABLED) {
            if (room.role === "exit" && exitTransferHandler) {
                player.sendMessage("[infinite_castle] 出口に到達しました。帰還処理を開始します");
                try {
                    exitTransferHandler(player, room);
                } catch (error) {
                    console.warn(`[infinite_castle] source-parts exit transfer failed: ${error?.stack ?? error}`);
                    player.sendMessage(`[infinite_castle] 帰還処理失敗: ${error}`);
                }
            }
            return;
        }
        let nextState = enterSourcePartsDemoRoom(
            activeRuntime.progression,
            activeRuntime.state,
            room.roomId
        );
        const status = getSourcePartsDemoRoomStatus(
            activeRuntime.progression,
            nextState,
            room.roomId
        );
        player.sendMessage(formatSourcePartsDemoRoomNotice(room, status));

        if (status === "available" && MANUAL_COMPLETE_ROLES.has(room.role)) {
            player.sendMessage("[ic-demo] このデモ目標は /scriptevent infinite_castle:demo_complete で完了できます");
        }
        if (shouldAutoCompleteSourcePartsDemoRoom(room, status)) {
            nextState = completeSourcePartsDemoRoom(
                activeRuntime.progression,
                nextState,
                room.roomId
            );
            const summary = summarizeSourcePartsDemoProgressionState(
                activeRuntime.progression,
                nextState
            );
            player.sendMessage(completionNotice(room, summary));
            player.sendMessage(nextObjectiveNotice(summary));
        }
        replaceState(nextState);
        if (room.role === "exit" && status === "available" && exitTransferHandler) {
            try {
                exitTransferHandler(player, room);
            } catch (error) {
                console.warn(`[infinite_castle] source-parts exit transfer failed: ${error?.stack ?? error}`);
                player.sendMessage(`[infinite_castle] 帰還処理失敗: ${error}`);
            }
        }
    } catch (error) {
        player.sendMessage(`[ic-demo] 部屋判定エラー: ${error}`);
        console.warn(`[infinite_castle] source-parts demo room entry failed: ${error?.stack ?? error}`);
    }
}

function checkRoomEntries() {
    if (!activeRuntime) return;
    let dimension;
    let players;
    try {
        dimension = world.getDimension(activeRuntime.dimensionId);
        players = dimension.getPlayers();
        lastDetectionError = null;
    } catch (error) {
        warnOnce(String(error?.stack ?? error));
        return;
    }

    const currentPlayerIds = new Set();
    for (const player of players) {
        try {
            currentPlayerIds.add(player.id);
            const room = findSourcePartsDemoRoomAtLocation(activeRuntime.rooms, player.location);
            const previousRoomId = enteredRoomByPlayerId.get(player.id);
            if (!room) {
                enteredRoomByPlayerId.delete(player.id);
                continue;
            }
            if (previousRoomId === room.roomId) continue;
            enteredRoomByPlayerId.set(player.id, room.roomId);
            handleRoomEntry(player, room);
        } catch (error) {
            warnOnce(`player check failed: ${String(error?.stack ?? error)}`);
        }
    }
    for (const playerId of enteredRoomByPlayerId.keys()) {
        if (!currentPlayerIds.has(playerId)) enteredRoomByPlayerId.delete(playerId);
    }
}

function startDetection() {
    if (!activeRuntime || detectionRunId !== null) return;
    detectionRunId = system.runInterval(checkRoomEntries, ROOM_CHECK_INTERVAL_TICKS);
}

function stopDetection() {
    if (detectionRunId === null) return;
    try {
        system.clearRun(detectionRunId);
    } catch {
        // The run can already be gone during a script reload.
    }
    detectionRunId = null;
}

function restoreSourcePartsDemo() {
    if (activeRuntime) return;
    try {
        const raw = world.getDynamicProperty(SOURCE_PARTS_DEMO_RUNTIME_PROPERTY_KEY);
        if (typeof raw !== "string") return;
        const restored = parseSourcePartsDemoRuntimeRecord(raw);
        if (!restored) {
            console.warn("[infinite_castle] ignored invalid saved source-parts demo runtime state");
            return;
        }
        activeRuntime = restored;
        enteredRoomByPlayerId.clear();
        startDetection();
        seedCurrentEntryCache();
        console.warn(
            `[infinite_castle] restored source-parts demo seed=${restored.progression.seed} `
            + `rooms=${restored.rooms.length}`
        );
    } catch (error) {
        console.warn(`[infinite_castle] failed to restore source-parts demo: ${error?.stack ?? error}`);
    }
}

function sendInactive(player) {
    player?.sendMessage("[ic-demo] 有効な素材建築デモはありません。先に再構築してください");
}

function handleDemoComplete(player) {
    if (!PROGRESSION_ENABLED) {
        player?.sendMessage("[ic-demo] 鍵・報酬・ボス進行は現在無効です");
        return;
    }
    if (!activeRuntime) {
        sendInactive(player);
        return;
    }
    const room = currentRoomForPlayer(player);
    if (!room) {
        player.sendMessage("[ic-demo] 完了対象の部屋AABB内にいません");
        return;
    }
    if (!MANUAL_COMPLETE_ROLES.has(room.role)) {
        player.sendMessage(
            `[ic-demo] ${sourcePartsDemoRoleLabel(room)}は侵入時に自動処理される役割です`
        );
        return;
    }
    const status = getSourcePartsDemoRoomStatus(
        activeRuntime.progression,
        activeRuntime.state,
        room.roomId
    );
    if (status === "locked") {
        player.sendMessage(formatSourcePartsDemoRoomNotice(room, status));
        player.sendMessage("[ic-demo] 先に現在の必須目標を完了してください。通行自体は可能です");
        return;
    }
    if (status === "complete") {
        player.sendMessage(formatSourcePartsDemoRoomNotice(room, status));
        return;
    }
    let nextState = enterSourcePartsDemoRoom(
        activeRuntime.progression,
        activeRuntime.state,
        room.roomId
    );
    nextState = completeSourcePartsDemoRoom(
        activeRuntime.progression,
        nextState,
        room.roomId
    );
    replaceState(nextState);
    enteredRoomByPlayerId.set(player.id, room.roomId);
    const summary = summarizeSourcePartsDemoProgressionState(activeRuntime.progression, nextState);
    player.sendMessage(completionNotice(room, summary));
    player.sendMessage(nextObjectiveNotice(summary));
}

function handleDemoStatus(player) {
    if (!PROGRESSION_ENABLED) {
        player?.sendMessage("[ic-demo] 鍵・報酬・ボス進行は現在無効です。自由探索モードです");
        return;
    }
    if (!activeRuntime) {
        sendInactive(player);
        return;
    }
    const summary = summarizeSourcePartsDemoProgressionState(
        activeRuntime.progression,
        activeRuntime.state
    );
    player.sendMessage(
        `[ic-demo] shared seed=${activeRuntime.progression.seed} `
        + `鍵=${summary.keyCount}/3 中ボス=${summary.minibossCount}/2 `
        + `報酬=${summary.rewardCount}/7 final=${summary.finalCleared} exit=${summary.exitReached}`
    );
    player.sendMessage(nextObjectiveNotice(summary));
    const room = currentRoomForPlayer(player);
    if (room) {
        const status = getSourcePartsDemoRoomStatus(
            activeRuntime.progression,
            activeRuntime.state,
            room.roomId
        );
        player.sendMessage(formatSourcePartsDemoRoomNotice(room, status));
    }
}

function handleDemoRoute(player) {
    if (!PROGRESSION_ENABLED) {
        player?.sendMessage("[ic-demo] 固定攻略ルートは現在ありません。全室を自由に探索できます");
        return;
    }
    if (!activeRuntime) {
        sendInactive(player);
        return;
    }
    const route = activeRuntime.progression.requiredRoute;
    player.sendMessage(
        `[ic-demo] route seed=${activeRuntime.progression.seed} `
        + `上下反転=${route.verticalDirectionChanges}`
    );
    const entries = activeRuntime.progression.requiredObjectives.map((objective, index) => {
        const room = activeRuntime.rooms.find((candidate) => candidate.roomId === objective.roomId);
        const center = {
            x: Math.floor((room.bounds.minX + room.bounds.maxX) / 2),
            y: Math.floor((room.bounds.minY + room.bounds.maxY) / 2),
            z: Math.floor((room.bounds.minZ + room.bounds.maxZ) / 2),
        };
        return `${index + 1}:${sourcePartsDemoRoleLabel(room)}(${sourcePartsDemoTierLabel(room.tier)}) `
            + `(${center.x},${center.y},${center.z})`;
    });
    for (let index = 0; index < entries.length; index += 2) {
        player.sendMessage(`[ic-demo] ${entries.slice(index, index + 2).join(" → ")}`);
    }
}

function seedCurrentEntryCache() {
    enteredRoomByPlayerId.clear();
    if (!activeRuntime) return;
    try {
        const dimension = world.getDimension(activeRuntime.dimensionId);
        for (const player of dimension.getPlayers()) {
            const room = findSourcePartsDemoRoomAtLocation(activeRuntime.rooms, player.location);
            if (room) enteredRoomByPlayerId.set(player.id, room.roomId);
        }
    } catch {
        // Detection will retry when the dimension is available.
    }
}

function handleDemoReset(player) {
    if (!PROGRESSION_ENABLED) {
        player?.sendMessage("[ic-demo] リセット対象の攻略進行は現在ありません");
        return;
    }
    if (!activeRuntime) {
        sendInactive(player);
        return;
    }
    const state = createSourcePartsDemoProgressionState(activeRuntime.progression);
    replaceState(state);
    seedCurrentEntryCache();
    player.sendMessage("[ic-demo] 共有デモ進行をリセットしました。現在室を退出すると再検知されます");
}

export function activateSourcePartsDemo(plan) {
    const progression = createSourcePartsDemoProgression(plan?.seed, plan);
    const state = createSourcePartsDemoProgressionState(progression);
    const record = createSourcePartsDemoRuntimeRecord(plan, progression, state);
    const serialized = serializeSourcePartsDemoRuntimeRecord(record);
    world.setDynamicProperty(SOURCE_PARTS_DEMO_RUNTIME_PROPERTY_KEY, serialized);

    stopDetection();
    activeRuntime = {
        dimensionId: plan.dimensionId,
        progression,
        state,
        rooms: parseSourcePartsDemoRuntimeRecord(serialized).rooms,
        record,
    };
    enteredRoomByPlayerId.clear();
    lastDetectionError = null;
    startDetection();
    // During live-anchor reconstruction players remain inside their preserved
    // room.  Seed the cache so a newly assigned exit never ejects them merely
    // because the runtime record was refreshed around their feet.
    seedCurrentEntryCache();
    return {
        seed: progression.seed,
        rooms: progression.rooms.length,
        serializedLength: serialized.length,
        verticalDirectionChanges: progression.requiredRoute.verticalDirectionChanges,
    };
}

export function deactivateSourcePartsDemo() {
    stopDetection();
    activeRuntime = null;
    enteredRoomByPlayerId.clear();
    lastDetectionError = null;
    try {
        world.setDynamicProperty(SOURCE_PARTS_DEMO_RUNTIME_PROPERTY_KEY, undefined);
    } catch (error) {
        console.warn(`[infinite_castle] failed to clear source-parts demo state: ${error}`);
    }
}

export function getSourcePartsDemoEntranceTarget() {
    if (!activeRuntime) restoreSourcePartsDemo();
    if (!activeRuntime) return null;
    const entrance = activeRuntime.rooms.find((room) => room.role === "entrance");
    if (!entrance) return null;
    const { minX, minY, minZ, maxX, maxZ } = entrance.bounds;
    return {
        dimensionId: activeRuntime.dimensionId,
        roomId: entrance.roomId,
        location: {
            x: Math.floor((minX + maxX) / 2) + 0.5,
            // The authored room floor/socket walk level is minY + 1.  Player
            // feet therefore land one block above it.
            y: minY + 2,
            z: Math.floor((minZ + maxZ) / 2) + 0.5,
        },
    };
}

export function getSourcePartsDemoLayoutSnapshot() {
    if (!activeRuntime) restoreSourcePartsDemo();
    if (!activeRuntime) return null;
    return {
        dimensionId: activeRuntime.dimensionId,
        seed: activeRuntime.progression.seed,
        rooms: activeRuntime.rooms.map((room) => ({
            placementId: room.placementId,
            bounds: { ...room.bounds },
        })),
    };
}

export function setSourcePartsDemoExitTransferHandler(handler) {
    exitTransferHandler = typeof handler === "function" ? handler : null;
}

system.afterEvents.scriptEventReceive.subscribe((event) => {
    const player = playerFromEvent(event);
    if (!player) return;
    if (event.id === "infinite_castle:demo_complete") handleDemoComplete(player);
    else if (event.id === "infinite_castle:demo_status") handleDemoStatus(player);
    else if (event.id === "infinite_castle:demo_route") handleDemoRoute(player);
    else if (event.id === "infinite_castle:demo_reset") handleDemoReset(player);
});

system.run(restoreSourcePartsDemo);
