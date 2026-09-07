// グリッドセル座標 <-> 無限城ディメンションのワールド座標の変換。状態は持たない。
import { CELL_SIZE, GRID_WORLD_ORIGIN } from "./config.js";

export function worldToCell(location) {
    return {
        x: Math.floor((location.x - GRID_WORLD_ORIGIN.x) / CELL_SIZE.x),
        y: Math.floor((location.y - GRID_WORLD_ORIGIN.y) / CELL_SIZE.y),
        z: Math.floor((location.z - GRID_WORLD_ORIGIN.z) / CELL_SIZE.z),
    };
}

export function cellWorldMin(cell) {
    return {
        x: GRID_WORLD_ORIGIN.x + cell.x * CELL_SIZE.x,
        y: GRID_WORLD_ORIGIN.y + cell.y * CELL_SIZE.y,
        z: GRID_WORLD_ORIGIN.z + cell.z * CELL_SIZE.z,
    };
}

export function cellWorldMax(cell) {
    const min = cellWorldMin(cell);
    return { x: min.x + CELL_SIZE.x - 1, y: min.y + CELL_SIZE.y - 1, z: min.z + CELL_SIZE.z - 1 };
}

export function cellWorldCenter(cell) {
    const min = cellWorldMin(cell);
    return {
        x: min.x + CELL_SIZE.x / 2,
        y: min.y + CELL_SIZE.y / 2,
        z: min.z + CELL_SIZE.z / 2,
    };
}
