// プレイヤーの現在位置からグリッドセルを割り出すユーティリティ。状態は持たない。
import { worldToCell } from "./worldCoords.js";

export { worldToCell } from "./worldCoords.js";

// 指定ディメンション内にいるプレイヤーと、それぞれの現在セルの一覧を返す。
export function trackPlayersInDimension(dimension) {
    return dimension.getPlayers().map((player) => ({ player, cell: worldToCell(player.location) }));
}
