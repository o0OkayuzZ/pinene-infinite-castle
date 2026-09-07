// 実在の城郭・書院造から抽出した「建築部品」。
// 部屋カテゴリやDungeonGraphを知らず、指定範囲へ意匠を描くだけに限定する。
import { BlockVolume } from "@minecraft/server";

function orderedBox(from, to) {
    return {
        from: {
            x: Math.min(from.x, to.x),
            y: Math.min(from.y, to.y),
            z: Math.min(from.z, to.z),
        },
        to: {
            x: Math.max(from.x, to.x),
            y: Math.max(from.y, to.y),
            z: Math.max(from.z, to.z),
        },
    };
}

function fill(dimension, from, to, blockTypeId) {
    const box = orderedBox(from, to);
    dimension.fillBlocks(new BlockVolume(box.from, box.to), blockTypeId);
}

function setBlock(dimension, location, blockTypeId) {
    try {
        dimension.setBlockType(location, blockTypeId);
    } catch {
        // 小装飾の欠落だけなら、部屋全体の建築は続行する。
    }
}

// 二条城二の丸御殿などの格式ある室内を参考にした折上格天井。
export function buildOrikamiCofferedCeiling(dimension, min, max, palette, gilded = false) {
    const y = max.y - 2;
    for (let x = min.x + 3; x <= max.x - 3; x += 4) {
        fill(dimension, { x, y, z: min.z + 1 }, { x, y, z: max.z - 1 }, palette.beam);
    }
    for (let z = min.z + 3; z <= max.z - 3; z += 4) {
        fill(dimension, { x: min.x + 1, y, z }, { x: max.x - 1, y, z }, palette.beam);
    }

    // 格間の四隅へ釘隠し風の飾金具を置く。金色は格式の高い部屋だけ。
    const boss = gilded ? palette.brass : palette.pillar;
    for (let x = min.x + 3; x <= max.x - 3; x += 8) {
        for (let z = min.z + 3; z <= max.z - 3; z += 8) {
            setBlock(dimension, { x, y: y - 1, z }, boss);
        }
    }

    // 外周を一段下げて、平坦な天井より奥行きを出す。
    fill(dimension, { x: min.x + 1, y: y - 1, z: min.z + 1 }, { x: max.x - 1, y: y - 1, z: min.z + 1 }, palette.beam);
    fill(dimension, { x: min.x + 1, y: y - 1, z: max.z - 1 }, { x: max.x - 1, y: y - 1, z: max.z - 1 }, palette.beam);
    fill(dimension, { x: min.x + 1, y: y - 1, z: min.z + 1 }, { x: min.x + 1, y: y - 1, z: max.z - 1 }, palette.beam);
    fill(dimension, { x: max.x - 1, y: y - 1, z: min.z + 1 }, { x: max.x - 1, y: y - 1, z: max.z - 1 }, palette.beam);
}

// 長押の上へ欄間を組む。中央の出入口はy+1〜4なので、その上だけを装飾する。
export function buildRanmaBand(dimension, min, max, palette, side, ornate = false) {
    const bottom = min.y + 6;
    const top = min.y + 9;
    const horizontal = side === "north" || side === "south";
    const fixed = side === "north" || side === "west"
        ? (horizontal ? min.z : min.x)
        : (horizontal ? max.z : max.x);

    if (horizontal) {
        fill(dimension, { x: min.x + 2, y: bottom, z: fixed }, { x: max.x - 2, y: top, z: fixed }, palette.shoji);
        for (let x = min.x + 2; x <= max.x - 2; x += 4) {
            fill(dimension, { x, y: bottom, z: fixed }, { x, y: top, z: fixed }, palette.pillar);
            if (ornate) setBlock(dimension, { x, y: bottom + 1, z: fixed }, palette.brass);
        }
        fill(dimension, { x: min.x + 2, y: bottom, z: fixed }, { x: max.x - 2, y: bottom, z: fixed }, palette.beam);
        fill(dimension, { x: min.x + 2, y: top, z: fixed }, { x: max.x - 2, y: top, z: fixed }, palette.beam);
    } else {
        fill(dimension, { x: fixed, y: bottom, z: min.z + 2 }, { x: fixed, y: top, z: max.z - 2 }, palette.shoji);
        for (let z = min.z + 2; z <= max.z - 2; z += 4) {
            fill(dimension, { x: fixed, y: bottom, z }, { x: fixed, y: top, z }, palette.pillar);
            if (ornate) setBlock(dimension, { x: fixed, y: bottom + 1, z }, palette.brass);
        }
        fill(dimension, { x: fixed, y: bottom, z: min.z + 2 }, { x: fixed, y: bottom, z: max.z - 2 }, palette.beam);
        fill(dimension, { x: fixed, y: top, z: min.z + 2 }, { x: fixed, y: top, z: max.z - 2 }, palette.beam);
    }
}

// 上段の間・床の間・違い棚・付書院を一つの壁際ユニットにまとめる。
// 中央十字の移動線を避け、四隅のどれかへ寄せる。
export function buildShoinSuite(dimension, min, max, palette, corner, lavish = false) {
    const east = corner % 2 === 1;
    const south = corner >= 2;
    const x0 = east ? max.x - 9 : min.x + 2;
    const x1 = east ? max.x - 2 : min.x + 9;
    const z0 = south ? max.z - 5 : min.z + 2;
    const z1 = south ? max.z - 2 : min.z + 5;

    // 一段高い上段床と、床柱・落掛。
    fill(dimension, { x: x0, y: min.y + 1, z: z0 }, { x: x1, y: min.y + 1, z: z1 }, palette.beam);
    fill(dimension, { x: x0 + 1, y: min.y + 2, z: south ? z1 : z0 }, { x: x1 - 1, y: min.y + 8, z: south ? z1 : z0 }, palette.wall);
    fill(dimension, { x: x0, y: min.y + 2, z: south ? z1 : z0 }, { x: x0, y: min.y + 9, z: south ? z1 : z0 }, palette.pillar);
    fill(dimension, { x: x1, y: min.y + 2, z: south ? z1 : z0 }, { x: x1, y: min.y + 9, z: south ? z1 : z0 }, palette.pillar);
    fill(dimension, { x: x0, y: min.y + 8, z: south ? z1 : z0 }, { x: x1, y: min.y + 8, z: south ? z1 : z0 }, palette.beam);

    // 違い棚。左右をずらした二段と飾金具で、単なる壁面から書院造らしさを出す。
    const shelfZ = south ? z0 : z1;
    fill(dimension, { x: x0 + 1, y: min.y + 4, z: shelfZ }, { x: x0 + 4, y: min.y + 4, z: shelfZ }, palette.beam);
    fill(dimension, { x: x0 + 4, y: min.y + 6, z: shelfZ }, { x: x1 - 1, y: min.y + 6, z: shelfZ }, palette.beam);
    fill(dimension, { x: x0 + 4, y: min.y + 4, z: shelfZ }, { x: x0 + 4, y: min.y + 6, z: shelfZ }, palette.pillar);
    if (lavish) {
        setBlock(dimension, { x: x0 + 2, y: min.y + 5, z: shelfZ }, palette.brass);
        setBlock(dimension, { x: x1 - 2, y: min.y + 7, z: shelfZ }, palette.brass);
    }

    // 付書院風の低い採光面。
    const windowX0 = east ? x0 : x1 - 2;
    const windowX1 = east ? x0 + 2 : x1;
    fill(dimension, { x: windowX0, y: min.y + 2, z: shelfZ }, { x: windowX1, y: min.y + 3, z: shelfZ }, palette.shoji);
}

// 天守内部の側廻り・武者走りを、壁際2ブロックの板敷きと武具掛で表現する。
export function buildMushaBashiri(dimension, min, max, palette, variant = 0) {
    fill(dimension, { x: min.x + 1, y: min.y, z: min.z + 1 }, { x: max.x - 1, y: min.y, z: min.z + 2 }, palette.beam);
    fill(dimension, { x: min.x + 1, y: min.y, z: max.z - 2 }, { x: max.x - 1, y: min.y, z: max.z - 1 }, palette.beam);
    fill(dimension, { x: min.x + 1, y: min.y, z: min.z + 1 }, { x: min.x + 2, y: min.y, z: max.z - 1 }, palette.beam);
    fill(dimension, { x: max.x - 2, y: min.y, z: min.z + 1 }, { x: max.x - 1, y: min.y, z: max.z - 1 }, palette.beam);

    const z = variant % 2 === 0 ? min.z + 1 : max.z - 1;
    for (const x of [min.x + 4, min.x + 8, max.x - 8, max.x - 4]) {
        fill(dimension, { x, y: min.y + 2, z }, { x, y: min.y + 5, z }, palette.chain);
        setBlock(dimension, { x, y: min.y + 5, z }, palette.brass);
    }
    fill(dimension, { x: min.x + 3, y: min.y + 5, z }, { x: max.x - 3, y: min.y + 5, z }, palette.beam);
}

// 吹き抜けの上層回廊。中央9×9は必ず空け、縦socketを妨げない。
export function buildAtriumGallery(dimension, min, max, palette, lampHeight) {
    const cx = min.x + 12;
    const cz = min.z + 12;
    const galleryY = min.y + 8;
    fill(dimension, { x: min.x + 2, y: galleryY, z: min.z + 2 }, { x: max.x - 2, y: galleryY, z: min.z + 4 }, palette.beam);
    fill(dimension, { x: min.x + 2, y: galleryY, z: max.z - 4 }, { x: max.x - 2, y: galleryY, z: max.z - 2 }, palette.beam);
    fill(dimension, { x: min.x + 2, y: galleryY, z: min.z + 5 }, { x: min.x + 4, y: galleryY, z: max.z - 5 }, palette.beam);
    fill(dimension, { x: max.x - 4, y: galleryY, z: min.z + 5 }, { x: max.x - 2, y: galleryY, z: max.z - 5 }, palette.beam);

    for (const [x, z] of [
        [min.x + 4, min.z + 4], [max.x - 4, min.z + 4],
        [min.x + 4, max.z - 4], [max.x - 4, max.z - 4],
    ]) {
        fill(dimension, { x, y: min.y + 1, z }, { x, y: max.y - 1, z }, palette.pillar);
        setBlock(dimension, { x, y: min.y + lampHeight, z }, palette.lamp);
    }
    // 吹き抜け中央へ四方から張り出す短い梁。中心3×3は空ける。
    fill(dimension, { x: cx - 1, y: galleryY + 1, z: min.z + 2 }, { x: cx + 1, y: galleryY + 1, z: cz - 3 }, palette.pillar);
    fill(dimension, { x: cx - 1, y: galleryY + 1, z: cz + 3 }, { x: cx + 1, y: galleryY + 1, z: max.z - 2 }, palette.pillar);
}

// 天守の急階段を囲む通し柱・踊り場。中央の足場塔はbuilder側で最後に開通させる。
export function buildCastleStairCore(dimension, min, max, palette) {
    const cx = min.x + 12;
    const cz = min.z + 12;
    for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
        fill(dimension, { x: cx + dx, y: min.y + 1, z: cz + dz }, { x: cx + dx, y: max.y - 1, z: cz + dz }, palette.pillar);
    }
    for (const y of [min.y + 5, min.y + 10]) {
        fill(dimension, { x: cx - 4, y, z: cz - 4 }, { x: cx + 4, y, z: cz - 3 }, palette.beam);
        fill(dimension, { x: cx - 4, y, z: cz + 3 }, { x: cx + 4, y, z: cz + 4 }, palette.beam);
        fill(dimension, { x: cx - 4, y, z: cz - 2 }, { x: cx - 3, y, z: cz + 2 }, palette.beam);
        fill(dimension, { x: cx + 3, y, z: cz - 2 }, { x: cx + 4, y, z: cz + 2 }, palette.beam);
    }
}

// 唐門・櫓門の重なった梁を抽象化した、通常の鳥居より量感のある城門。
export function buildLayeredCastleGate(dimension, min, max, palette, rotation, gilded = false) {
    const cx = min.x + 12;
    const cz = min.z + 12;
    const y = min.y + 1;
    const alongX = rotation % 180 === 0;
    const accent = gilded ? palette.brass : palette.vermilion;
    if (alongX) {
        for (const x of [cx - 5, cx + 5]) {
            fill(dimension, { x, y, z: cz - 1 }, { x, y: y + 9, z: cz + 1 }, palette.vermilion);
        }
        fill(dimension, { x: cx - 7, y: y + 8, z: cz - 1 }, { x: cx + 7, y: y + 9, z: cz + 1 }, palette.beam);
        fill(dimension, { x: cx - 6, y: y + 6, z: cz }, { x: cx + 6, y: y + 6, z: cz }, accent);
        fill(dimension, { x: cx - 3, y: y + 7, z: cz - 1 }, { x: cx + 3, y: y + 8, z: cz + 1 }, palette.wall);
    } else {
        for (const z of [cz - 5, cz + 5]) {
            fill(dimension, { x: cx - 1, y, z }, { x: cx + 1, y: y + 9, z }, palette.vermilion);
        }
        fill(dimension, { x: cx - 1, y: y + 8, z: cz - 7 }, { x: cx + 1, y: y + 9, z: cz + 7 }, palette.beam);
        fill(dimension, { x: cx, y: y + 6, z: cz - 6 }, { x: cx, y: y + 6, z: cz + 6 }, accent);
        fill(dimension, { x: cx - 1, y: y + 7, z: cz - 3 }, { x: cx + 1, y: y + 8, z: cz + 3 }, palette.wall);
    }
}
