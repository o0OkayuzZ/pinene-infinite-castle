import {
    DEFAULT_STAIR_SMOOTHING_STYLE,
    STAIR_SMOOTHING_STYLE,
    normalizeStairSmoothingStyle,
} from "./sourcePartsStairSmoothing.js";

export const SOURCE_PARTS_LAYOUT_STYLE = Object.freeze({
    CASTLE: "castle",
    FLOATING: "floating",
});

export const DEFAULT_SOURCE_PARTS_LAYOUT_STYLE = SOURCE_PARTS_LAYOUT_STYLE.CASTLE;

function parseLayoutStyle(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (Object.values(SOURCE_PARTS_LAYOUT_STYLE).includes(normalized)) return normalized;
    throw new Error(`unsupported source-parts layout style: ${value}`);
}

function parseSeed(value) {
    const normalized = String(value ?? "").trim();
    if (!/^\d+$/.test(normalized)) throw new Error(`invalid source-parts seed: ${value}`);
    const seed = Number(normalized);
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
        throw new Error(`source-parts seed is outside uint32: ${value}`);
    }
    return seed >>> 0;
}

function parseStairStyle(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "smooth") return STAIR_SMOOTHING_STYLE.OAK_STAIRS;
    return normalizeStairSmoothingStyle(normalized);
}

function fromObject(value) {
    return {
        style: value.style === undefined
            ? DEFAULT_SOURCE_PARTS_LAYOUT_STYLE
            : parseLayoutStyle(value.style),
        seed: value.seed === undefined || value.seed === null || value.seed === ""
            ? undefined
            : parseSeed(value.seed),
        stairSmoothingStyle: value.stairSmoothingStyle === undefined
            ? DEFAULT_STAIR_SMOOTHING_STYLE
            : parseStairStyle(value.stairSmoothingStyle),
    };
}

/**
 * Parses a script-event message.  Both compact and labelled forms are accepted:
 *
 *   castle 123 smooth
 *   style floating seed 123 stair authored
 *   style=floating seed=123 stair=smooth
 */
export function parseSourcePartsRebuildOptions(raw) {
    if (raw && typeof raw === "object") return fromObject(raw);
    const tokens = String(raw ?? "")
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean);
    const result = {
        style: DEFAULT_SOURCE_PARTS_LAYOUT_STYLE,
        seed: undefined,
        stairSmoothingStyle: DEFAULT_STAIR_SMOOTHING_STYLE,
    };

    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index].toLowerCase();
        const equalsIndex = token.indexOf("=");
        if (equalsIndex > 0) {
            const key = token.slice(0, equalsIndex);
            const value = token.slice(equalsIndex + 1);
            if (key === "style" || key === "layout") result.style = parseLayoutStyle(value);
            else if (key === "seed") result.seed = parseSeed(value);
            else if (key === "stair" || key === "stairs") {
                result.stairSmoothingStyle = parseStairStyle(value);
            } else throw new Error(`unknown source-parts option: ${tokens[index]}`);
            continue;
        }

        if (token === "style" || token === "layout") {
            result.style = parseLayoutStyle(tokens[++index]);
        } else if (token === "seed") {
            result.seed = parseSeed(tokens[++index]);
        } else if (token === "stair" || token === "stairs") {
            result.stairSmoothingStyle = parseStairStyle(tokens[++index]);
        } else if (Object.values(SOURCE_PARTS_LAYOUT_STYLE).includes(token)) {
            result.style = token;
        } else if (token === "smooth" || token === "authored" || token === "oak_stairs") {
            result.stairSmoothingStyle = parseStairStyle(token);
        } else if (/^\d+$/.test(token)) {
            result.seed = parseSeed(token);
        } else {
            throw new Error(`unknown source-parts option: ${tokens[index]}`);
        }
    }
    return result;
}
