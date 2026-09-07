import { system, world } from "@minecraft/server";
import { INFINITE_CASTLE_DIMENSION_ID } from "./dimensionSetup.js";

export const INFINITE_CASTLE_FOG_ID = "infinite_castle:sunset_haze";
export const INFINITE_CASTLE_FOG_STACK_ID = "infinite_castle_sunset";

function removeInfiniteCastleFog(player) {
    try {
        player.runCommand(`fog @s remove ${INFINITE_CASTLE_FOG_STACK_ID}`);
    } catch {
        // Removing an absent stack entry is harmless. The following push must still run.
    }
}

export function syncInfiniteCastleAtmosphere(player) {
    removeInfiniteCastleFog(player);

    let isInsideInfiniteCastle = false;
    try {
        isInsideInfiniteCastle = player.dimension.id === INFINITE_CASTLE_DIMENSION_ID;
    } catch {
        // The player may have disconnected before a queued reconciliation runs.
        return;
    }

    if (!isInsideInfiniteCastle) return;

    try {
        player.runCommand(
            `fog @s push ${INFINITE_CASTLE_FOG_ID} ${INFINITE_CASTLE_FOG_STACK_ID}`
        );
    } catch (error) {
        console.warn(`[infinite_castle] failed to apply sunset fog to ${player.name}: ${error}`);
    }
}

function queueAtmosphereSync(player) {
    system.run(() => syncInfiniteCastleAtmosphere(player));
}

world.afterEvents.playerDimensionChange.subscribe((event) => {
    queueAtmosphereSync(event.player);
});

world.afterEvents.playerSpawn.subscribe((event) => {
    queueAtmosphereSync(event.player);
});

// Script reloads can occur while players are already online. Reconcile them on the next tick.
system.run(() => {
    for (const player of world.getAllPlayers()) {
        syncInfiniteCastleAtmosphere(player);
    }
});
