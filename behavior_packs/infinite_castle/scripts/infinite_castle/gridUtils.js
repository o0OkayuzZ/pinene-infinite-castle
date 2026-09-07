// グリッド座標まわりの純粋なユーティリティ。
import { GRID_SIZE } from "./config.js";

export function cellKey(cell) {
    return `${cell.x},${cell.y},${cell.z}`;
}

export function isWithinGrid(cell) {
    return cell.x >= 0 && cell.x < GRID_SIZE.x
        && cell.y >= 0 && cell.y < GRID_SIZE.y
        && cell.z >= 0 && cell.z < GRID_SIZE.z;
}

export function manhattanDistance(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
}

export function getAllGridCells() {
    const cells = [];
    for (let y = 0; y < GRID_SIZE.y; y += 1) {
        for (let z = 0; z < GRID_SIZE.z; z += 1) {
            for (let x = 0; x < GRID_SIZE.x; x += 1) cells.push({ x, y, z });
        }
    }
    return cells;
}
