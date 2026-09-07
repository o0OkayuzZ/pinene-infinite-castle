export const SourcePartCategory = Object.freeze({
    Room: "room",
    Stairs: "stairs",
    Bridge: "bridge",
    Crossroads: "crossroads",
});

export const SourceSocketDirection = Object.freeze({
    North: "north",
    South: "south",
    East: "east",
    West: "west",
});

function socket(direction, x, y, z, width, confidence) {
    return Object.freeze({
        direction,
        localPosition: Object.freeze({ x, y, z }),
        floorNormal: "up",
        opening: Object.freeze({ width, height: 4 }),
        confidence,
    });
}

const D = SourceSocketDirection;

const DIRECTION_ORDER = Object.freeze([D.North, D.East, D.South, D.West]);

export const SOURCE_PARTS = Object.freeze([
    Object.freeze({
        name: "castle_part_001",
        displayName: "交差廊下",
        category: SourcePartCategory.Crossroads,
        allowedFloorNormals: Object.freeze(["up"]),
        size: Object.freeze({ x: 48, y: 31, z: 48 }),
        sockets: Object.freeze([
            socket(D.North, 16, 23, 0, 4, 1.0),
            socket(D.South, 28, 18, 47, 5, 0.9781),
            socket(D.West, 0, 23, 16, 4, 1.0),
            socket(D.East, 47, 18, 28, 5, 0.9781),
        ]),
    }),
    Object.freeze({
        name: "castle_part_002",
        displayName: "部屋１",
        category: SourcePartCategory.Room,
        allowedFloorNormals: Object.freeze(["up", "down", "north", "south", "west", "east"]),
        size: Object.freeze({ x: 43, y: 31, z: 43 }),
        sockets: Object.freeze([
            socket(D.North, 20, 1, 5, 5, 0.9523),
            socket(D.South, 20, 1, 37, 5, 0.9523),
            socket(D.West, 5, 1, 20, 5, 0.9523),
            socket(D.East, 37, 1, 20, 5, 0.9523),
        ]),
    }),
    Object.freeze({
        name: "castle_part_003",
        displayName: "渡り廊下",
        category: SourcePartCategory.Bridge,
        allowedFloorNormals: Object.freeze(["up"]),
        size: Object.freeze({ x: 48, y: 31, z: 19 }),
        sockets: Object.freeze([
            socket(D.West, 0, 23, 2, 4, 1.0),
            socket(D.East, 47, 18, 5, 2, 0.9342),
        ]),
    }),
    Object.freeze({
        name: "castle_part_004",
        displayName: "階段１",
        category: SourcePartCategory.Stairs,
        allowedFloorNormals: Object.freeze(["up", "down", "north", "south", "west", "east"]),
        size: Object.freeze({ x: 13, y: 48, z: 45 }),
        sockets: Object.freeze([
            socket(D.North, 6, 44, 2, 5, 0.9154),
            socket(D.South, 6, 3, 44, 5, 1.0),
        ]),
    }),
    Object.freeze({
        name: "castle_part_005",
        displayName: "階段２",
        category: SourcePartCategory.Stairs,
        allowedFloorNormals: Object.freeze(["up", "down", "north", "south", "west", "east"]),
        size: Object.freeze({ x: 37, y: 13, z: 41 }),
        sockets: Object.freeze([
            socket(D.West, 0, 1, 1, 2, 1.0),
            socket(D.East, 36, 1, 37, 3, 1.0),
        ]),
    }),
    Object.freeze({
        name: "castle_part_006",
        displayName: "階段３",
        category: SourcePartCategory.Stairs,
        allowedFloorNormals: Object.freeze(["up", "down", "north", "south", "west", "east"]),
        size: Object.freeze({ x: 37, y: 13, z: 41 }),
        sockets: Object.freeze([
            socket(D.West, 0, 1, 39, 2, 1.0),
            socket(D.East, 36, 1, 4, 3, 1.0),
        ]),
    }),
]);

export function getSourcePart(name) {
    const part = SOURCE_PARTS.find((candidate) => candidate.name === name);
    if (!part) throw new Error(`unknown source part: ${name}`);
    return part;
}

export function resolveSourcePartStructureId(name, packIds) {
    const expected = `infinite_castle:source_parts/${name}`;
    if (packIds.includes(expected)) return expected;
    const path = `source_parts/${name}`;
    return packIds.find((id) =>
        id.endsWith(`:${path}`)
        || id.endsWith(`/${path}`)
        || id.endsWith(`:${name}`)
        || id.endsWith(`/${name}`)
    ) ?? null;
}

export function oppositeSourceSocketDirection(direction) {
    return DIRECTION_ORDER[(DIRECTION_ORDER.indexOf(direction) + 2) % 4];
}

export function sourceDirectionVector(direction) {
    return {
        [D.North]: Object.freeze({ x: 0, y: 0, z: -1 }),
        [D.South]: Object.freeze({ x: 0, y: 0, z: 1 }),
        [D.West]: Object.freeze({ x: -1, y: 0, z: 0 }),
        [D.East]: Object.freeze({ x: 1, y: 0, z: 0 }),
    }[direction];
}

export function rotateSourceDirection(direction, quarterTurns) {
    const index = DIRECTION_ORDER.indexOf(direction);
    return DIRECTION_ORDER[(index + quarterTurns) % 4];
}

export function rotatedSourcePartSize(part, quarterTurns) {
    return quarterTurns % 2 === 0
        ? { ...part.size }
        : { x: part.size.z, y: part.size.y, z: part.size.x };
}

export function rotateSourceLocalPosition(position, size, quarterTurns) {
    switch (quarterTurns % 4) {
        case 1:
            return { x: size.z - 1 - position.z, y: position.y, z: position.x };
        case 2:
            return { x: size.x - 1 - position.x, y: position.y, z: size.z - 1 - position.z };
        case 3:
            return { x: position.z, y: position.y, z: size.x - 1 - position.x };
        default:
            return { ...position };
    }
}

export function rotateSourceSocket(part, socketDefinition, quarterTurns) {
    return Object.freeze({
        ...socketDefinition,
        direction: rotateSourceDirection(socketDefinition.direction, quarterTurns),
        localPosition: Object.freeze(
            rotateSourceLocalPosition(socketDefinition.localPosition, part.size, quarterTurns)
        ),
    });
}

export function socketOutsideLocation(origin, socketDefinition) {
    const offset = sourceDirectionVector(socketDefinition.direction);
    return {
        x: origin.x + socketDefinition.localPosition.x + offset.x,
        y: origin.y + socketDefinition.localPosition.y + offset.y,
        z: origin.z + socketDefinition.localPosition.z + offset.z,
    };
}