import { system } from "@minecraft/server";

// 無限城ディメンション本体。DimensionRegistry#registerCustomDimension は起動時のみ呼び出し可能。
export const INFINITE_CASTLE_DIMENSION_ID = "infinite_castle:dungeon";

system.beforeEvents.startup.subscribe(({ dimensionRegistry }) => {
    try {
        dimensionRegistry.registerCustomDimension(INFINITE_CASTLE_DIMENSION_ID);
    } catch (error) {
        console.warn(`[infinite_castle] registerCustomDimension failed: ${error}`);
    }
});
