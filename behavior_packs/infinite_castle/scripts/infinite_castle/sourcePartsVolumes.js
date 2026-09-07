export const MAX_FILL_BLOCKS = 32768;

function axisLength(bounds, axis) {
    return bounds.to[axis] - bounds.from[axis] + 1;
}

export function boundsVolume(bounds) {
    return axisLength(bounds, "x")
        * axisLength(bounds, "y")
        * axisLength(bounds, "z");
}

export function clipBoundsToHeight(bounds, heightRange) {
    if (!Number.isFinite(heightRange?.min) || !Number.isFinite(heightRange?.max)) {
        throw new Error(`invalid dimension height range: ${JSON.stringify(heightRange)}`);
    }
    const minimumY = Math.trunc(heightRange.min);
    const maximumY = Math.trunc(heightRange.max) - 1;
    const fromY = Math.max(bounds.from.y, minimumY);
    const toY = Math.min(bounds.to.y, maximumY);
    if (fromY > toY) return null;
    return {
        from: { ...bounds.from, y: fromY },
        to: { ...bounds.to, y: toY },
    };
}

function validPoint(point) {
    return point
        && Number.isFinite(point.x)
        && Number.isFinite(point.y)
        && Number.isFinite(point.z);
}

function authoredConnectionPoints(connection) {
    return [
        connection?.from,
        connection?.to,
        ...(connection?.fromLanes ?? []),
        ...(connection?.toLanes ?? []),
        ...(connection?.fromCarve ?? []),
        ...(connection?.toCarve ?? []),
    ].filter(validPoint);
}

function shiftConnectionY(connection, shiftY) {
    const singular = [connection?.from, connection?.to].filter(validPoint);
    const arrays = [
        ...(connection?.fromLanes ?? []),
        ...(connection?.toLanes ?? []),
        ...(connection?.fromCarve ?? []),
        ...(connection?.toCarve ?? []),
    ].filter(validPoint);
    for (const point of [...singular, ...arrays]) point.y += shiftY;
}

export function fitPlanToHeightRange(plan, heightRange) {
    if (!Number.isFinite(heightRange?.min) || !Number.isFinite(heightRange?.max)) {
        throw new Error(`invalid dimension height range: ${JSON.stringify(heightRange)}`);
    }
    const minimumWorldY = Math.trunc(heightRange.min);
    const maximumWorldY = Math.trunc(heightRange.max) - 1;
    let minimumPlanY = Number.POSITIVE_INFINITY;
    let maximumPlanY = Number.NEGATIVE_INFINITY;

    for (const placement of plan?.placements ?? []) {
        const originY = placement?.origin?.y;
        const sizeY = placement?.size?.y;
        if (!Number.isFinite(originY) || !Number.isFinite(sizeY) || sizeY < 1) {
            throw new Error(`invalid placement height: ${JSON.stringify(placement)}`);
        }
        minimumPlanY = Math.min(minimumPlanY, originY);
        maximumPlanY = Math.max(maximumPlanY, originY + sizeY - 1);
    }
    for (const connection of plan?.connections ?? []) {
        if (connection?.mode === "authored_seam") {
            const points = authoredConnectionPoints(connection);
            if (points.length < 2) {
                throw new Error(`invalid authored seam: ${JSON.stringify(connection)}`);
            }
            minimumPlanY = Math.min(minimumPlanY, ...points.map((point) => point.y));
            maximumPlanY = Math.max(maximumPlanY, ...points.map((point) => point.y));
            continue;
        }
        const fromY = connection?.from?.y;
        const toY = connection?.to?.y;
        const width = connection?.opening?.width;
        if (!Number.isFinite(fromY) || !Number.isFinite(toY) || !Number.isFinite(width)) {
            throw new Error(`invalid connection height: ${JSON.stringify(connection)}`);
        }
        const directionY = Math.sign(toY - fromY);
        const fromPenetration = Number.isFinite(connection.fromPenetration)
            ? Math.max(0, Math.trunc(connection.fromPenetration)) : 0;
        const toPenetration = Number.isFinite(connection.toPenetration)
            ? Math.max(0, Math.trunc(connection.toPenetration)) : 0;
        const extendedFromY = fromY - directionY * fromPenetration;
        const extendedToY = toY + directionY * toPenetration;
        const padding = Math.max(3, Math.ceil(width / 2) + 1);
        minimumPlanY = Math.min(minimumPlanY, extendedFromY - padding, extendedToY - padding);
        maximumPlanY = Math.max(maximumPlanY, extendedFromY + padding, extendedToY + padding);
    }
    if (!Number.isFinite(minimumPlanY) || !Number.isFinite(maximumPlanY)) {
        throw new Error("cannot fit an empty source-parts plan");
    }
    if (maximumPlanY - minimumPlanY > maximumWorldY - minimumWorldY) {
        throw new Error(
            `source-parts plan height ${minimumPlanY}..${maximumPlanY} exceeds world height ${minimumWorldY}..${maximumWorldY}`
        );
    }

    const minimumShift = minimumWorldY - minimumPlanY;
    const maximumShift = maximumWorldY - maximumPlanY;
    const shiftY = Math.max(minimumShift, Math.min(0, maximumShift));
    if (shiftY !== 0) {
        for (const placement of plan.placements ?? []) placement.origin.y += shiftY;
        for (const connection of plan.connections ?? []) shiftConnectionY(connection, shiftY);
        for (const tierBase of Object.values(plan?.tierBases ?? {})) {
            if (validPoint(tierBase)) tierBase.y += shiftY;
        }
    }
    return {
        shiftY,
        fromY: minimumPlanY + shiftY,
        toY: maximumPlanY + shiftY,
    };
}

export function splitBoundsForFill(bounds, maxBlocks = MAX_FILL_BLOCKS) {
    if (!Number.isInteger(maxBlocks) || maxBlocks < 1) {
        throw new Error(`invalid fill block limit: ${maxBlocks}`);
    }
    const pending = [{ from: { ...bounds.from }, to: { ...bounds.to } }];
    const result = [];
    while (pending.length > 0) {
        const current = pending.pop();
        const lengths = {
            x: axisLength(current, "x"),
            y: axisLength(current, "y"),
            z: axisLength(current, "z"),
        };
        if (lengths.x < 1 || lengths.y < 1 || lengths.z < 1) {
            throw new Error(`invalid fill bounds: ${JSON.stringify(current)}`);
        }
        if (boundsVolume(current) <= maxBlocks) {
            result.push(current);
            continue;
        }

        const axis = ["x", "y", "z"].sort((left, right) => lengths[right] - lengths[left])[0];
        if (lengths[axis] < 2) {
            throw new Error(`cannot split fill bounds below ${boundsVolume(current)} blocks`);
        }
        const midpoint = Math.floor((current.from[axis] + current.to[axis]) / 2);
        const lower = { from: { ...current.from }, to: { ...current.to, [axis]: midpoint } };
        const upper = { from: { ...current.from, [axis]: midpoint + 1 }, to: { ...current.to } };
        pending.push(upper, lower);
    }
    return result;
}
