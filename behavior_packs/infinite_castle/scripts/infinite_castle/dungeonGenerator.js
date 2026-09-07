// ダンジョン手続き生成の中核ロジック。建築(ブロック配置)には一切関与しない。
import {
    GRID_SIZE,
    TARGET_ROOM_COUNT,
    ROOM_WEIGHTS,
    REQUIRED_ROOMS,
    MIN_ENTRANCE_EXIT_CELL_DISTANCE,
    LOOP_EDGE_COUNT_RANGE,
    resolveDeepEntranceChance,
} from "./config.js";
import { Direction, opposite, addCell, applyOrientation, rotateDirectionHorizontal } from "./connector.js";
import { getTemplatesByCategory, getTemplate, RoomCategory } from "./roomRegistry.js";
import { createDungeonGraph, addRoom, connectRooms, getRoom } from "./dungeonGraph.js";
import { createRoomInstance } from "./roomInstance.js";
import { cellKey, isWithinGrid, manhattanDistance } from "./gridUtils.js";

const HORIZONTAL_ROTATIONS = [0, 90, 180, 270];
const SAFETY_LIMIT = 2000;

// シード付き簡易疑似乱数(Mulberry32)。同じseedなら同じダンジョンを再現できる。
function createRng(seed) {
    let a = seed >>> 0;
    return function rng() {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffle(array, rng) {
    const copy = array.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function weightedCategoryOrder(rng) {
    // 宝箱(行き止まり専用カテゴリ)は自然抽選には含めず、frontierを閉じたい場面でのみ使う。
    // そうしないと序盤にたまたま宝箱が引かれただけでダンジョン全体の成長が止まってしまう。
    const remaining = Object.entries(ROOM_WEIGHTS).filter(([category]) => category !== RoomCategory.Treasure);
    const order = [];
    while (remaining.length > 0) {
        const total = remaining.reduce((sum, [, weight]) => sum + weight, 0);
        let roll = rng() * total;
        let pickIndex = remaining.length - 1;
        for (let i = 0; i < remaining.length; i += 1) {
            roll -= remaining[i][1];
            if (roll <= 0) { pickIndex = i; break; }
        }
        order.push(remaining[pickIndex][0]);
        remaining.splice(pickIndex, 1);
    }
    return order;
}

function resolveConnectorDirection(rawDirection, orientation, rotation) {
    const afterOrientation = applyOrientation(rawDirection, orientation);
    if (afterOrientation === Direction.Up || afterOrientation === Direction.Down) return afterOrientation;
    return rotateDirectionHorizontal(afterOrientation, rotation);
}

function resolveTemplateConnectors(template, orientation, rotation) {
    return template.connectors.map((connector) => ({
        direction: resolveConnectorDirection(connector.direction, orientation, rotation),
    }));
}

function isStraightThrough(resolvedConnectors) {
    if (resolvedConnectors.length !== 2) return false;
    const [a, b] = resolvedConnectors;
    return opposite(a.direction) === b.direction;
}

// テンプレートを cell に置いたとき、incomingDirection(親から見てこの部屋へ向かう方向)に
// 合う orientation/rotation を探す。他の全connectorが範囲内かつ(未使用 or ループ接続可)であることも確認する。
function tryResolvePlacement(template, cell, incomingDirection, graph, pendingFrontierKeys) {
    const requiredSelfDirection = opposite(incomingDirection);

    for (const orientation of template.allowedOrientations) {
        const rotations = (requiredSelfDirection === Direction.Up || requiredSelfDirection === Direction.Down)
            ? [0]
            : HORIZONTAL_ROTATIONS;

        for (const rotation of rotations) {
            const resolved = resolveTemplateConnectors(template, orientation, rotation);
            if (!resolved.some((c) => c.direction === requiredSelfDirection)) continue;

            let valid = true;
            for (const connector of resolved) {
                if (connector.direction === requiredSelfDirection) continue; // 親への接続口。既存で当然なので検証不要
                const targetCell = addCell(cell, connector.direction);
                if (!isWithinGrid(targetCell)) { valid = false; break; }
                const existing = getRoom(graph, targetCell);
                if (existing) {
                    const canLoop = pendingFrontierKeys.has(`${cellKey(targetCell)}|${opposite(connector.direction)}`);
                    if (!canLoop) { valid = false; break; }
                }
            }
            if (valid) return { orientation, rotation, resolvedConnectors: resolved };
        }
    }
    return null;
}

function placeEntrance(graph, cell) {
    const template = getTemplate("entrance_main");
    const resolvedConnectors = resolveTemplateConnectors(template, "normal", 0);
    const room = createRoomInstance({
        cell,
        templateId: template.id,
        category: template.category,
        orientation: "normal",
        rotation: 0,
        resolvedConnectors,
    });
    addRoom(graph, room);
    return resolvedConnectors;
}

/**
 * ダンジョンを生成する。
 * initialGraph/initialFrontierを渡すと、既存(保護済み)部屋を残したまま
 * その外側のconnectorを起点として続きを生成できる(再構築用)。
 */
export function generateDungeon({ seed, initialGraph, initialFrontier, entranceCell } = {}) {
    const rng = createRng(seed ?? Date.now());
    const graph = initialGraph ?? createDungeonGraph();
    const frontier = initialFrontier ? initialFrontier.slice() : [];
    const pendingFrontierKeys = new Set(frontier.map((item) => `${cellKey(item.cell)}|${item.direction}`));

    let resolvedEntranceCell = entranceCell;
    if (!initialGraph) {
        // 中心配置だと出口までの最大到達距離が伸びず最低距離条件を満たしにくいため、
        // 底層の端(x中央, y=0, z=0)を既定の入口位置とする。
        resolvedEntranceCell = entranceCell ?? {
            x: Math.floor(GRID_SIZE.x / 2),
            y: 0,
            z: 0,
        };
        const entranceConnectors = placeEntrance(graph, resolvedEntranceCell);
        for (const connector of entranceConnectors) {
            frontier.push({ cell: resolvedEntranceCell, direction: connector.direction });
            pendingFrontierKeys.add(`${cellKey(resolvedEntranceCell)}|${connector.direction}`);
        }
    }

    let loopCount = 0;
    let placedExits = 0;
    let safety = 0;

    while (frontier.length > 0 && safety < SAFETY_LIMIT) {
        safety += 1;
        const index = Math.floor(rng() * frontier.length);
        const item = frontier.splice(index, 1)[0];
        pendingFrontierKeys.delete(`${cellKey(item.cell)}|${item.direction}`);

        const targetCell = addCell(item.cell, item.direction);
        const requiredDirectionAtTarget = opposite(item.direction);

        const existingAtTarget = getRoom(graph, targetCell);
        if (existingAtTarget) {
            // 既存部屋の空きconnectorへ接続 = ループ経路の形成。
            connectRooms(graph, item.cell, targetCell);
            loopCount += 1;
            continue;
        }

        const nearBudget = graph.rooms.size >= TARGET_ROOM_COUNT;
        // frontierが他に残っていない状態で早期クローズすると、そこでダンジョン全体の成長が
        // 止まってしまう(部屋数が極端に少なくなる)ため、他に開いている経路がある場合のみ許可する。
        const wantsClosure = nearBudget || (frontier.length > 0 && rng() < 0.05);

        let placement = null;
        let chosenTemplate = null;

        if (!wantsClosure) {
            for (const category of weightedCategoryOrder(rng)) {
                for (const template of shuffle(getTemplatesByCategory(category), rng)) {
                    const result = tryResolvePlacement(template, targetCell, item.direction, graph, pendingFrontierKeys);
                    if (result) { placement = result; chosenTemplate = template; break; }
                }
                if (placement) break;
            }
        }

        if (!placement) {
            // 遠くの閉じ目なら先に出口を優先配置(宝箱が0個の城でも必ず2箇所確保するため)。
            const targetDistance = manhattanDistance(targetCell, resolvedEntranceCell);
            if (placedExits < REQUIRED_ROOMS.exitMax && targetDistance >= MIN_ENTRANCE_EXIT_CELL_DISTANCE) {
                const exitTemplate = getTemplate("exit_main");
                const result = tryResolvePlacement(exitTemplate, targetCell, item.direction, graph, pendingFrontierKeys);
                if (result) { placement = result; chosenTemplate = exitTemplate; }
            }
        }

        if (!placement) {
            // 通常抽選で置けない、または閉じたい場合は宝箱(行き止まり)で確実に閉じる。
            for (const template of shuffle(getTemplatesByCategory(RoomCategory.Treasure), rng)) {
                const result = tryResolvePlacement(template, targetCell, item.direction, graph, pendingFrontierKeys);
                if (result) { placement = result; chosenTemplate = template; break; }
            }
        }

        if (!placement) {
            // 最終フォールバック(距離条件を無視してでも必ず閉じる、1connectorなので理論上は必ず置ける)。
            const exitTemplate = getTemplate("exit_main");
            const result = tryResolvePlacement(exitTemplate, targetCell, item.direction, graph, pendingFrontierKeys);
            if (result) { placement = result; chosenTemplate = exitTemplate; }
        }

        if (!placement) {
            console.warn(`[infinite_castle] failed to close frontier at ${JSON.stringify(targetCell)} dir=${requiredDirectionAtTarget}`);
            continue;
        }

        const room = createRoomInstance({
            cell: targetCell,
            templateId: chosenTemplate.id,
            category: chosenTemplate.category,
            orientation: placement.orientation,
            rotation: placement.rotation,
            resolvedConnectors: placement.resolvedConnectors,
        });
        addRoom(graph, room);
        connectRooms(graph, item.cell, targetCell);

        if (chosenTemplate.category === RoomCategory.Exit) placedExits += 1;

        for (const connector of placement.resolvedConnectors) {
            if (connector.direction === requiredDirectionAtTarget) continue; // 親との接続口は除く
            frontier.push({ cell: targetCell, direction: connector.direction });
            pendingFrontierKeys.add(`${cellKey(targetCell)}|${connector.direction}`);
        }
    }

    if (safety >= SAFETY_LIMIT) {
        console.warn("[infinite_castle] generateDungeon hit safety limit; frontier may be incomplete");
    }

    // frontierを閉じられず未接続のまま残ったconnector(=先に何も無いのに開いたドア)を、
    // 部屋のresolvedConnectorsから除去する。除去すればplaceholderStructures側でその面は
    // 開口せず壁のままになり、プレイヤーが「行き止まりの外の虚空」へ歩いて出てしまう事故を防げる。
    for (const room of graph.rooms.values()) {
        const roomKey = cellKey(room.cell);
        const connectedKeys = graph.edges.get(roomKey) ?? new Set();
        room.resolvedConnectors = room.resolvedConnectors.filter((connector) => {
            const neighborKey = cellKey(addCell(room.cell, connector.direction));
            return connectedKeys.has(neighborKey);
        });
    }

    assignExits(graph, resolvedEntranceCell, rng);
    maybeAssignDeepEntrance(graph, rng);

    return { graph, entranceCell: resolvedEntranceCell, loopCount };
}

function assignExits(graph, entranceCell, rng) {
    // 生成中にすでに必要数の出口が確保できていれば何もしない。
    // 不足分だけ、宝箱部屋を距離が遠い順に事後変換するフォールバック。
    const currentExits = Array.from(graph.rooms.values()).filter((room) => room.category === RoomCategory.Exit);
    const needed = REQUIRED_ROOMS.exitMin - currentExits.length;
    if (needed <= 0) return;

    const treasureRooms = Array.from(graph.rooms.values()).filter((room) => room.category === RoomCategory.Treasure);
    const sortedByDistanceDesc = treasureRooms
        .slice()
        .sort((a, b) => manhattanDistance(b.cell, entranceCell) - manhattanDistance(a.cell, entranceCell));
    const chosen = sortedByDistanceDesc.slice(0, needed);

    for (const room of chosen) {
        const exitTemplate = getTemplate("exit_main");
        room.templateId = exitTemplate.id;
        room.category = exitTemplate.category;
        room.orientation = "normal"; // 出口は常に通常姿勢固定
    }
    if (chosen.length < needed) {
        console.warn(`[infinite_castle] only ${currentExits.length + chosen.length} exit candidates found (needed ${REQUIRED_ROOMS.exitMin})`);
    }
}

function maybeAssignDeepEntrance(graph, rng) {
    if (rng() >= resolveDeepEntranceChance()) return;
    const eligibleCategories = new Set([RoomCategory.Corridor, RoomCategory.Hall, RoomCategory.Battle]);
    const candidates = Array.from(graph.rooms.values()).filter((room) =>
        eligibleCategories.has(room.category)
        && room.orientation === "normal"
        && isStraightThrough(room.resolvedConnectors)
    );
    if (candidates.length === 0) return;
    const chosen = candidates[Math.floor(rng() * candidates.length)];
    const deepTemplate = getTemplate("deep_entrance_marker");
    chosen.templateId = deepTemplate.id;
    chosen.category = deepTemplate.category;
    chosen.isDeepEntrance = true;
}
