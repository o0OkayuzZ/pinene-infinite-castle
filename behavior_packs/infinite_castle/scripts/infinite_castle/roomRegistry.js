// 部屋テンプレートの登録データ。建築(Structure)は未整備なので、
// ここではカテゴリ・socket配置・許容姿勢のみを定義し、実際のブロック生成は
// japaneseRoomBuilder.js(将来は.mcstructure)に完全に分離する。
import { Direction, localFaceCenter } from "./connector.js";

export const RoomCategory = Object.freeze({
    Corridor: "corridor",
    Stairs: "stairs",
    Hall: "hall",
    Battle: "battle",
    Treasure: "treasure",
    Atrium: "atrium",
    Entrance: "entrance",
    Exit: "exit",
    DeepEntrance: "deep_entrance",
});

// v0.1では全テンプレートが1グリッドセル(24x24x16)を占有する前提。
function conn(direction) {
    return { direction, localPosition: localFaceCenter(direction) };
}

const TEMPLATES = [
    // 廊下 x6(分岐(T字・十字)を含めないと一本道にしかならないため、2種類は分岐用)
    { id: "corridor_straight_ns", category: RoomCategory.Corridor, connectors: [conn(Direction.North), conn(Direction.South)], allowedOrientations: ["normal", "sideways", "upsidedown"] },
    { id: "corridor_straight_ew", category: RoomCategory.Corridor, connectors: [conn(Direction.East), conn(Direction.West)], allowedOrientations: ["normal", "sideways", "upsidedown"] },
    { id: "corridor_turn_ne", category: RoomCategory.Corridor, connectors: [conn(Direction.North), conn(Direction.East)], allowedOrientations: ["normal", "sideways", "upsidedown"] },
    { id: "corridor_turn_sw", category: RoomCategory.Corridor, connectors: [conn(Direction.South), conn(Direction.West)], allowedOrientations: ["normal", "sideways", "upsidedown"] },
    { id: "corridor_t_junction", category: RoomCategory.Corridor, connectors: [conn(Direction.North), conn(Direction.South), conn(Direction.East)], allowedOrientations: ["normal", "sideways", "upsidedown"] },
    { id: "corridor_crossroads", category: RoomCategory.Corridor, connectors: [conn(Direction.North), conn(Direction.South), conn(Direction.East), conn(Direction.West)], allowedOrientations: ["normal", "sideways", "upsidedown"] },

    // 階段 x3(いずれもNorth+Upの接続。見た目違いのみ差別化)
    { id: "stairs_straight", category: RoomCategory.Stairs, connectors: [conn(Direction.North), conn(Direction.Up)], allowedOrientations: ["normal"] },
    { id: "stairs_spiral", category: RoomCategory.Stairs, connectors: [conn(Direction.North), conn(Direction.Up)], allowedOrientations: ["normal"] },
    { id: "stairs_switchback", category: RoomCategory.Stairs, connectors: [conn(Direction.North), conn(Direction.Up)], allowedOrientations: ["normal"] },

    // 客間 x3(1つは分岐用に3方向)
    { id: "hall_a", category: RoomCategory.Hall, connectors: [conn(Direction.North), conn(Direction.South)], allowedOrientations: ["normal", "sideways", "upsidedown"] },
    { id: "hall_b", category: RoomCategory.Hall, connectors: [conn(Direction.East), conn(Direction.West)], allowedOrientations: ["normal", "sideways", "upsidedown"] },
    { id: "hall_c", category: RoomCategory.Hall, connectors: [conn(Direction.North), conn(Direction.East), conn(Direction.South)], allowedOrientations: ["normal", "sideways", "upsidedown"] },

    // 戦闘部屋 x2(貫通型)
    { id: "battle_a", category: RoomCategory.Battle, connectors: [conn(Direction.North), conn(Direction.South)], allowedOrientations: ["normal", "sideways", "upsidedown"] },
    { id: "battle_b", category: RoomCategory.Battle, connectors: [conn(Direction.East), conn(Direction.West)], allowedOrientations: ["normal", "sideways", "upsidedown"] },

    // 宝箱部屋 x2(行き止まり)
    { id: "treasure_a", category: RoomCategory.Treasure, connectors: [conn(Direction.North)], allowedOrientations: ["normal", "sideways", "upsidedown"] },
    { id: "treasure_b", category: RoomCategory.Treasure, connectors: [conn(Direction.South)], allowedOrientations: ["normal", "sideways", "upsidedown"] },

    // 吹き抜け x2(縦方向のシャフト)
    { id: "atrium_a", category: RoomCategory.Atrium, connectors: [conn(Direction.Up), conn(Direction.Down)], allowedOrientations: ["normal"] },
    { id: "atrium_b", category: RoomCategory.Atrium, connectors: [conn(Direction.North), conn(Direction.Up)], allowedOrientations: ["normal"] },

    // 入口(常に通常姿勢固定)
    { id: "entrance_main", category: RoomCategory.Entrance, connectors: [conn(Direction.South)], allowedOrientations: ["normal"] },

    // 出口(常に通常姿勢固定)
    { id: "exit_main", category: RoomCategory.Exit, connectors: [conn(Direction.North)], allowedOrientations: ["normal"] },

    // 深層入口(確認用の仮Structure。廊下直線と同じ接続口形状を流用し、通常部屋の代替として置換できるようにする)
    { id: "deep_entrance_marker", category: RoomCategory.DeepEntrance, connectors: [conn(Direction.North), conn(Direction.South)], allowedOrientations: ["normal"] },
].map((template) => {
    const sockets = Object.freeze(template.connectors.map((connector) => Object.freeze({
        direction: connector.direction,
        localPosition: Object.freeze({ ...connector.localPosition }),
    })));
    return Object.freeze({ ...template, connectors: sockets, sockets });
});

const TEMPLATES_BY_ID = new Map(TEMPLATES.map((template) => [template.id, template]));

export function getTemplate(id) {
    const template = TEMPLATES_BY_ID.get(id);
    if (!template) throw new Error(`unknown room template: ${id}`);
    return template;
}

export function getAllTemplates() {
    return TEMPLATES;
}

export function getTemplatesByCategory(category) {
    return TEMPLATES.filter((template) => template.category === category);
}

export function getSocket(template, direction) {
    return template.sockets.find((socket) => socket.direction === direction);
}
