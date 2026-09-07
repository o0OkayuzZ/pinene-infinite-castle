import { world } from "@minecraft/server";
import {
    SOURCE_PARTS,
    resolveSourcePartStructureId,
    socketOutsideLocation,
} from "./sourcePartsRegistry.js";

const PREVIEW_COLUMNS = 3;
const PREVIEW_SPACING = 64;
const SOCKET_MARKER_HEIGHT = 3;
const PREVIEW_LOAD_MARGIN = 2;
let previewInProgress = false;

function previewOrigin(player) {
    return {
        x: Math.floor(player.location.x / 16) * 16 + 32,
        y: Math.floor(player.location.y),
        z: Math.floor(player.location.z / 16) * 16 + 32,
    };
}

function releaseArea(areaName, manager) {
    try {
        if (manager?.hasTickingArea(areaName)) manager.removeTickingArea(areaName);
    } catch {
        // Cleanup is deliberately idempotent.
    }
}

async function placePreviewPart(part, structureId, dimension, location, index) {
    const manager = world.tickingAreaManager;
    if (!manager) throw new Error("world.tickingAreaManager is unavailable");
    const areaName = `ic_preview_${index + 1}`;
    const options = {
        dimension,
        from: {
            x: location.x - PREVIEW_LOAD_MARGIN,
            y: location.y,
            z: location.z - PREVIEW_LOAD_MARGIN,
        },
        to: {
            x: location.x + part.size.x - 1 + PREVIEW_LOAD_MARGIN,
            y: location.y + part.size.y - 1 + SOCKET_MARKER_HEIGHT,
            z: location.z + part.size.z - 1 + PREVIEW_LOAD_MARGIN,
        },
    };
    releaseArea(areaName, manager);
    if (!manager.hasCapacity(options)) {
        throw new Error(`insufficient ticking area capacity for ${part.name}`);
    }
    try {
        await manager.createTickingArea(areaName, options);
        world.structureManager.place(structureId, dimension, location);
        for (const socketDefinition of part.sockets) {
            const markerBase = socketOutsideLocation(location, socketDefinition);
            for (let offsetY = 0; offsetY < SOCKET_MARKER_HEIGHT; offsetY += 1) {
                dimension.setBlockType(
                    { ...markerBase, y: markerBase.y + offsetY },
                    "minecraft:glowstone"
                );
            }
        }
    } finally {
        releaseArea(areaName, manager);
    }
}

export async function previewSourceParts(player) {
    if (!player) return;
    if (previewInProgress) {
        player.sendMessage("[infinite_castle] 素材建築プレビューは既に実行中です");
        return;
    }

    previewInProgress = true;
    try {
        const packIds = world.structureManager.getPackStructureIds();
        const resolvedParts = SOURCE_PARTS.map((part) => ({
            ...part,
            structureId: resolveSourcePartStructureId(part.name, packIds),
        }));
        const missing = resolvedParts.filter((part) => !part.structureId);
        if (missing.length > 0) {
            player.sendMessage(
                `[infinite_castle] 素材ストラクチャー未登録: ${missing.map((part) => part.name).join(", ")}`
            );
            player.sendMessage(`[ic-debug] packStructures=${packIds.length}`);
            for (const id of packIds.slice(0, 10)) {
                player.sendMessage(`[ic-debug] structureId=${id}`);
            }
            return;
        }

        const origin = previewOrigin(player);
        player.sendMessage(
            `[infinite_castle] 素材建築6件を配置開始 origin=${origin.x},${origin.y},${origin.z}`
        );
        let placed = 0;
        const failures = [];
        for (let index = 0; index < resolvedParts.length; index += 1) {
            const part = resolvedParts[index];
            const location = {
                x: origin.x + (index % PREVIEW_COLUMNS) * PREVIEW_SPACING,
                y: origin.y,
                z: origin.z + Math.floor(index / PREVIEW_COLUMNS) * PREVIEW_SPACING,
            };
            try {
                await placePreviewPart(part, part.structureId, player.dimension, location, index);
                placed += 1;
                player.sendMessage(
                    `[ic-preview] ${part.name} ${part.category} ${part.size.x}x${part.size.y}x${part.size.z} sockets=${part.sockets.length} at ${location.x},${location.y},${location.z}`
                );
            } catch (error) {
                failures.push(`${part.name}: ${error}`);
                console.warn(`[infinite_castle] source preview failed for ${part.name}: ${error?.stack ?? error}`);
            }
        }
        player.sendMessage(
            `[infinite_castle] 素材建築プレビュー完了: ${placed}/${resolvedParts.length} failures=${failures.length}`
        );
        for (const failure of failures.slice(0, 3)) {
            player.sendMessage(`[ic-preview] failed ${failure}`);
        }
    } catch (error) {
        console.warn(`[infinite_castle] source preview failed: ${error?.stack ?? error}`);
        player.sendMessage(`[infinite_castle] 素材建築プレビュー失敗: ${error}`);
    } finally {
        previewInProgress = false;
    }
}