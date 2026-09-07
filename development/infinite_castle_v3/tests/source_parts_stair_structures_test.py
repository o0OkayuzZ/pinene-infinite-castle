from __future__ import annotations

import json
from pathlib import Path

import amulet_nbt
import numpy


ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "scripts" / "infinite_castle" / "sourcePartsGeneratedCatalog.json"
STRUCTURES = ROOT / "structures" / "infinite_castle" / "generated_variants"
DIRECTION_STATE = {"east": 0, "west": 1, "south": 2, "north": 3}


def load_blocks(path: Path):
    root = amulet_nbt.load(str(path), compressed=False, little_endian=True).tag
    size = tuple(value.py_int for value in root["size"])
    structure = root["structure"]
    indices = numpy.asarray(
        [value.py_int for value in structure["block_indices"][0]], dtype=numpy.int32
    ).reshape(size)
    palette_root = structure["palette"]
    palette_name = next(iter(palette_root))
    palette = palette_root[palette_name]["block_palette"]
    return size, indices, palette


def horizontal_direction(low, high):
    dx = high["x"] - low["x"]
    dz = high["z"] - low["z"]
    assert dx == 0 or dz == 0
    if dx > 0:
        return "east"
    if dx < 0:
        return "west"
    if dz > 0:
        return "south"
    return "north"


catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
variants = [item for item in catalog["variants"] if item["category"] == "stairs"]
assert len(variants) == 8
checked = 0
would_change = 0
already_correct = 0

for variant in variants:
    size, indices, palette = load_blocks(STRUCTURES / f"{variant['id']}.mcstructure")
    assert size == tuple(variant["size"][axis] for axis in ("x", "y", "z"))
    endpoints = sorted(
        (socket.get("walkPosition", socket["localPosition"]) for socket in variant["sockets"]),
        key=lambda point: point["y"],
    )
    low, high = endpoints
    direction = horizontal_direction(low, high)
    dx = 0 if high["x"] == low["x"] else (1 if high["x"] > low["x"] else -1)
    dz = 0 if high["z"] == low["z"] else (1 if high["z"] > low["z"] else -1)
    length = abs(high["x"] - low["x"]) + abs(high["z"] - low["z"])
    assert high["y"] - low["y"] == length == variant["verticalSpan"]
    lateral = (1, 0) if dx == 0 else (0, 1)
    half_width = variant["routeWidth"] // 2

    for step in range(length + 1):
        center = (
            low["x"] + dx * step,
            low["y"] + step - 1,
            low["z"] + dz * step,
        )
        for offset in range(-half_width, half_width + 1):
            position = (
                center[0] + lateral[0] * offset,
                center[1],
                center[2] + lateral[1] * offset,
            )
            palette_index = int(indices[position])
            assert palette_index >= 0, (variant["id"], position, "structure void")
            block = palette[palette_index]
            name = block["name"].py_str
            expected = "minecraft:oak_stairs" if variant["source"] == "castle_part_004" else "minecraft:oak_planks"
            assert name == expected, (variant["id"], position, name, expected)
            checked += 1

            if step == 0 and name == "minecraft:oak_planks":
                continue
            states = {
                key: value.py_data
                for key, value in block.get("states", {}).items()
            }
            correct = (
                name == "minecraft:oak_stairs"
                and states.get("upside_down_bit") == 0
                and states.get("weirdo_direction") == DIRECTION_STATE[direction]
            )
            if correct:
                already_correct += 1
            else:
                would_change += 1

assert checked == 3608
assert would_change > 0
print(json.dumps({
    "ok": True,
    "variants": len(variants),
    "checkedOakSupports": checked,
    "wouldChange": would_change,
    "alreadyCorrect": already_correct,
}))
