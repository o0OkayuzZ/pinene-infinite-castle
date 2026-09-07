import { world } from "@minecraft/server";
import { cellWorldMax, cellWorldMin } from "./worldCoords.js";

function chunkCoordinate(value) {
    return Math.floor(value / 16);
}

export function roomChunkProbeLocations(room) {
    const min = cellWorldMin(room.cell);
    const max = cellWorldMax(room.cell);
    const probes = [];
    const minChunkX = chunkCoordinate(min.x);
    const maxChunkX = chunkCoordinate(max.x);
    const minChunkZ = chunkCoordinate(min.z);
    const maxChunkZ = chunkCoordinate(max.z);
    const probeY = Math.min(max.y, min.y + 1);

    for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
        for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ += 1) {
            probes.push({ x: chunkX * 16 + 8, y: probeY, z: chunkZ * 16 + 8 });
        }
    }
    return probes;
}

export function areRoomChunksLoaded(dimension, room) {
    try {
        return roomChunkProbeLocations(room).every((location) => dimension.getBlock(location) !== undefined);
    } catch {
        return false;
    }
}

export function releaseRoomTickingArea(areaName, tickingAreaManager = world.tickingAreaManager) {
    try {
        if (tickingAreaManager?.hasTickingArea(areaName)) {
            tickingAreaManager.removeTickingArea(areaName);
        }
    } catch {
        // The area may not exist. Removal is deliberately idempotent.
    }
}

export async function acquireLoadedRoomChunks(
    dimension,
    room,
    areaName,
    tickingAreaManager = world.tickingAreaManager
) {
    const min = cellWorldMin(room.cell);
    const max = cellWorldMax(room.cell);
    const options = { dimension, from: min, to: max };

    // A previous interrupted job may have left this name registered.
    releaseRoomTickingArea(areaName, tickingAreaManager);

    if (!tickingAreaManager) {
        return { ok: false, waitedTicks: 0, error: "world.tickingAreaManager is unavailable" };
    }

    try {
        if (!tickingAreaManager.hasCapacity(options)) {
            return { ok: false, waitedTicks: 0, error: "ticking area manager has insufficient chunk capacity" };
        }
    } catch (error) {
        return { ok: false, waitedTicks: 0, error: `ticking area capacity check failed: ${error}` };
    }

    try {
        // The API contract resolves only after every chunk is loaded and ticking.
        await tickingAreaManager.createTickingArea(areaName, options);
        return { ok: true };
    } catch (error) {
        releaseRoomTickingArea(areaName, tickingAreaManager);
        return { ok: false, error: `createTickingArea failed: ${error}` };
    }
}
