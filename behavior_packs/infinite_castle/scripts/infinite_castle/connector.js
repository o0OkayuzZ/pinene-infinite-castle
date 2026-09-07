// 部屋の接続口(connector/socket)まわりの純粋なユーティリティ。状態は持たない。
import { CELL_SIZE } from "./config.js";

export const Direction = Object.freeze({
    North: "north",
    South: "south",
    East: "east",
    West: "west",
    Up: "up",
    Down: "down",
});

const OPPOSITE = Object.freeze({
    [Direction.North]: Direction.South,
    [Direction.South]: Direction.North,
    [Direction.East]: Direction.West,
    [Direction.West]: Direction.East,
    [Direction.Up]: Direction.Down,
    [Direction.Down]: Direction.Up,
});

export function opposite(direction) {
    return OPPOSITE[direction];
}

// グリッド上で隣接セルへ移動するための単位ベクトル(セル単位、ワールド座標ではない)
const CELL_STEP = Object.freeze({
    [Direction.North]: { x: 0, y: 0, z: -1 },
    [Direction.South]: { x: 0, y: 0, z: 1 },
    [Direction.East]: { x: 1, y: 0, z: 0 },
    [Direction.West]: { x: -1, y: 0, z: 0 },
    [Direction.Up]: { x: 0, y: 1, z: 0 },
    [Direction.Down]: { x: 0, y: -1, z: 0 },
});

export function cellStep(direction) {
    return CELL_STEP[direction];
}

export function addCell(cell, direction) {
    const step = CELL_STEP[direction];
    return { x: cell.x + step.x, y: cell.y + step.y, z: cell.z + step.z };
}

// 水平方向のみ回転させる(縦方向Up/Downは水平回転の影響を受けない)。degreesは0/90/180/270想定。
const HORIZONTAL_ORDER = [Direction.North, Direction.East, Direction.South, Direction.West];

export function rotateDirectionHorizontal(direction, degrees) {
    if (direction === Direction.Up || direction === Direction.Down) return direction;
    const steps = (((Math.round(degrees / 90) % 4) + 4) % 4);
    const index = HORIZONTAL_ORDER.indexOf(direction);
    return HORIZONTAL_ORDER[(index + steps) % 4];
}

// 横倒し(sideways)・逆さ(upsidedown)姿勢による方向の変換。
// v0.1では「逆さ」は上下反転(Up<->Down入れ替え、水平はそのまま)、
// 「横倒し」は北方向を軸に上下と南北を入れ替える単純化モデルを採用する。
export function applyOrientation(direction, orientation) {
    if (orientation === "upsidedown") {
        if (direction === Direction.Up) return Direction.Down;
        if (direction === Direction.Down) return Direction.Up;
        return direction;
    }
    if (orientation === "sideways") {
        if (direction === Direction.Up) return Direction.North;
        if (direction === Direction.North) return Direction.Up;
        if (direction === Direction.Down) return Direction.South;
        if (direction === Direction.South) return Direction.Down;
        return direction;
    }
    return direction; // "normal"
}

// セルの壁面中央のローカル座標(セル内0originオフセット)を返す。
export function localFaceCenter(direction) {
    const halfX = Math.floor(CELL_SIZE.x / 2);
    const halfZ = Math.floor(CELL_SIZE.z / 2);
    switch (direction) {
        case Direction.North: return { x: halfX, y: 1, z: 0 };
        case Direction.South: return { x: halfX, y: 1, z: CELL_SIZE.z - 1 };
        case Direction.East: return { x: CELL_SIZE.x - 1, y: 1, z: halfZ };
        case Direction.West: return { x: 0, y: 1, z: halfZ };
        case Direction.Up: return { x: halfX, y: CELL_SIZE.y - 1, z: halfZ };
        case Direction.Down: return { x: halfX, y: 0, z: halfZ };
        default: throw new Error(`unknown direction: ${direction}`);
    }
}

// 2つの部屋のconnectorが接続可能かどうか(セル座標が隣接し、方向が正反対)を判定する。
export function canConnect(cellA, directionA, cellB, directionB) {
    const expectedB = addCell(cellA, directionA);
    return expectedB.x === cellB.x && expectedB.y === cellB.y && expectedB.z === cellB.z
        && directionB === opposite(directionA);
}
