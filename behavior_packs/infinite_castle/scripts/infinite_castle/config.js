// 無限城 v0.1 設定値。ここを変えるだけで生成挙動を調整できるようにする。

export const CELL_SIZE = Object.freeze({ x: 24, y: 16, z: 24 });
export const GRID_SIZE = Object.freeze({ x: 5, y: 4, z: 5 }); // 最大 5*5*4 = 100セル

// グリッド座標(0,0,0)が対応するワールド座標(無限城ディメンション内)。
// 負の座標を避けるため原点寄せにしている。
export const GRID_WORLD_ORIGIN = Object.freeze({ x: 0, y: 0, z: 0 });

// 入口建築を置けるディメンション。既存ピネディメンションを先頭にしつつ、
// 開発時はバニラ3ディメンションでも入口マーカーを試せる。
export const SOURCE_DIMENSION_IDS = Object.freeze([
    "pinene_pvp:pvp_island",
    "minecraft:overworld",
    "minecraft:nether",
    "minecraft:the_end",
]);

// 入場・帰還・城再構築で共通利用する。RP側のsound_definitionsでA/Bを等確率抽選する。
export const CASTLE_KOTO_SOUND_ID = "infinite_castle.koto";

export const TRANSFER_CONFIG = Object.freeze({
    entranceMarkerBlockId: "infinite_castle:entrance_marker",
    entranceSoundId: CASTLE_KOTO_SOUND_ID,
    exitSoundId: CASTLE_KOTO_SOUND_ID,
    exitTeleportDelayTicks: 10,
    fallbackReturnDimensionId: "pinene_pvp:pvp_island",
    fallbackReturnLocation: Object.freeze({ x: 0.5, y: 65, z: 0.5 }),
});

// 参考映像の「撥を入れる→足元の障子が素早く開く→落とされる」を約0.8秒へ圧縮。
// 暗転はディメンション切替を隠す短いブリッジだけに使う。時間はtick、fadeTimeのみ秒単位。
export const ENTRANCE_TRANSITION = Object.freeze({
    enabled: true,
    groundParticleId: "infinite_castle:shoji_floor_open",
    fadeColor: Object.freeze({ red: 0, green: 0, blue: 0 }),
    fadeTime: Object.freeze({ fadeInTime: 0.08, holdTime: 0.06, fadeOutTime: 0.18 }),
    primarySound: Object.freeze({ volume: 1.0, pitch: 1.0 }),
    fadeDelayTicks: 9,
    cameraClearDelayTicks: 11,
    teleportDelayTicks: 12,
    finishDelayTicks: 16,
    cameraOffset: Object.freeze({ x: 4.2, y: 8.5, z: 4.2 }),
});

export const TARGET_ROOM_COUNT = 30;

export const REQUIRED_ROOMS = Object.freeze({
    entranceCount: 1,
    exitMin: 2,
    exitMax: 2,
});

// 入口・出口のグリッド上の最低距離(マンハッタン距離、セル単位)
// 5x5x4グリッドで入口を底層端に置いた場合の実用上限は概ね9。検証(300シード)で
// 6だと出口2箇所とも確保できる割合が約76%、5だと約89%だったため5を既定値とする。
export const MIN_ENTRANCE_EXIT_CELL_DISTANCE = 5;

// 通常部屋(入口・出口・深層入口を除く)の重み付き抽選テーブル
export const ROOM_WEIGHTS = Object.freeze({
    corridor: 50,
    stairs: 17,
    hall: 17,
    battle: 11,
    treasure: 4,
    atrium: 1,
});

// 城の再構築ごとに1回だけ判定する深層入口の出現確率
export const DEEP_ENTRANCE_CHANCE = 0.005; // 0.5%

// 生成される少量のループ経路(接続過多)の本数レンジ

// 再構築開始時も入退場と同じA/Bランダム琴イベントを鳴らす。
export const RECONSTRUCTION_SOUND_ID = CASTLE_KOTO_SOUND_ID;
export const LOOP_EDGE_COUNT_RANGE = Object.freeze({ min: 1, max: 3 });

// 主攻略経路以外にだけ使う異常姿勢の割合。合計は1以下にする。
export const BRANCH_POSE_CHANCES = Object.freeze({ sideways: 0.16, upsideDown: 0.10 });

// 再構築の間隔(分)。実際の待機時間はこの範囲でランダム。
export const RECONSTRUCTION_INTERVAL_MINUTES = Object.freeze({ min: 30, max: 60 });

// 目に見える再構築演出。旧部屋を上から指定層ずつ分解し、同じセルへ新部屋を段階構築する。
// 負荷が気になる場合はclearLayersPerStepを大きくすると分解tick数を短縮できる。
export const DYNAMIC_RECONSTRUCTION = Object.freeze({
    enabled: true,
    clearLayersPerStep: 2,
    ticksBetweenRooms: 1,
    nearestRoomsFirst: true,
});

// デバッグ用オーバーライド。開発中は forceDeepEntranceChance を 1 にすると必ず深層入口が出る。
export const DEBUG = Object.freeze({
    forceDeepEntranceChance: null, // 0.0〜1.0 を指定すると DEEP_ENTRANCE_CHANCE を上書き
});

export function resolveDeepEntranceChance() {
    return DEBUG.forceDeepEntranceChance ?? DEEP_ENTRANCE_CHANCE;
}
