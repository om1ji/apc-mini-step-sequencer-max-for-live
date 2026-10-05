#!/usr/bin/env python3
"""Собирает Max MIDI Effect «APC Seq.amxd» и кладёт его вместе со скриптами
в User Library, чтобы устройство появилось в браузере Live.

Патч описан здесь кодом, а не в редакторе Max, — так его видно в git.

Поток данных:
    [metro 16n] → [transport] → номер 1/16 → [coll] со строкой шага → ноты в Drum Rack
                                            ↘ apcseq.js (курсор на контроллере и в окне)
    контроллер → вход дорожки → [midiin] → apcseq.js ⇄ окно (jsui)
    apcseq.js → подсветка через Control Surface MaxForLive (send_midi)
"""

import argparse
import json
import shutil
import struct
from pathlib import Path

HERE = Path(__file__).parent
TEMPLATE = Path(
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Misc/Max Devices/Max MIDI Effect.amxd"
)
OUT_DIR = (
    Path.home()
    / "Music/Ableton/User Library/Presets/MIDI Effects/Max MIDI Effect/APC Seq"
)
SCRIPTS = ["apcseq.js", "apcseq_ui.js"]

UI_W, UI_H = 330, 150

boxes = []
lines = []


def obj(id, text, ins, outs, x, y, **extra):
    box = {
        "id": id,
        "maxclass": "newobj",
        "text": text,
        "numinlets": ins,
        "numoutlets": outs,
        "outlettype": [""] * outs,
        "patching_rect": [x, y, max(60.0, 7.0 * len(text)), 22.0],
    }
    box.update(extra)
    boxes.append({"box": box})


def msg(id, text, x, y):
    boxes.append(
        {
            "box": {
                "id": id,
                "maxclass": "message",
                "text": text,
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [x, y, 50.0, 22.0],
            }
        }
    )


def wire(src, out, dst, inl):
    lines.append({"patchline": {"source": [src, out], "destination": [dst, inl]}})


# --- запуск и логика ---
obj("thisdevice", "live.thisdevice", 1, 3, 30, 30, outlettype=["bang", "int", "int"])
msg("init", "init", 30, 70)
obj("js", "js apcseq.js", 1, 2, 30, 110, varname="apcjs")
# Паттерн хранится в проекте Live как скрытый параметр-блоб.
obj(
    "pattr",
    "pattr pattern @bindto apcjs",
    1,
    3,
    250,
    110,
    parameter_enable=1,
    saved_attribute_attributes={
        "valueof": {
            "parameter_longname": "pattern",
            "parameter_shortname": "pattern",
            "parameter_type": 3,
            "parameter_invisible": 1,
            "parameter_initial_enable": 0,
        }
    },
)

# --- такт: номер текущей 1/16 ---
# Метро в долях такта идёт только при запущенном транспорте Live.
obj("metro", "metro 16n @quantize 16n @active 1", 2, 1, 30, 200)
obj("transport", "transport", 2, 9, 30, 240)
# 7-й выход transport — тики (480 на долю), 1/16 = 120 тиков.
obj("tostep", "expr int($f1 / 120. + 0.5) % 16", 1, 1, 30, 280)
obj("fanout", "t i i", 1, 2, 30, 320)
obj("prepstep", "prepend step", 1, 1, 30, 360)

# --- ноты ---
obj("coll", "coll ---apcseq_pattern", 1, 4, 200, 360)
obj("funnel", "listfunnel", 1, 1, 200, 400)
# Пары «дорожка значение»: включённой дорожке — нота Drum Rack (C1 и выше).
# В expr у Max нет if, поэтому арифметикой: включена → 36 + дорожка, выключена → -1.
obj("tonote", "expr ($i2 == 1) * ($i1 + 37) - 1", 2, 1, 200, 440)
obj("skip", "sel -1", 2, 2, 200, 480)
obj("makenote", "makenote 100 100", 3, 2, 200, 520)
obj("noteout", "noteout", 3, 0, 200, 560)

# --- вход с контроллера: дорожка получает MIDI от APC, дальше он не идёт ---
obj("midiin", "midiin", 1, 1, 450, 220)
obj("midiparse", "midiparse", 1, 8, 450, 260)
obj("prepnote", "prepend note", 1, 1, 450, 300)
obj("prepcc", "prepend cc", 1, 1, 560, 300)

# --- окно в панели устройства ---
boxes.append(
    {
        "box": {
            "id": "ui",
            "maxclass": "jsui",
            "filename": "apcseq_ui.js",
            "numinlets": 1,
            "numoutlets": 1,
            "outlettype": [""],
            "patching_rect": [450, 30, UI_W, UI_H],
            "presentation": 1,
            "presentation_rect": [0, 0, UI_W, UI_H],
        }
    }
)

wire("thisdevice", 0, "init", 0)
wire("init", 0, "js", 0)
wire("js", 0, "coll", 0)
wire("js", 1, "ui", 0)
wire("ui", 0, "js", 0)

wire("midiin", 0, "midiparse", 0)
wire("midiparse", 0, "prepnote", 0)
wire("midiparse", 2, "prepcc", 0)
wire("prepnote", 0, "js", 0)
wire("prepcc", 0, "js", 0)

wire("metro", 0, "transport", 0)
wire("transport", 7, "tostep", 0)
wire("tostep", 0, "fanout", 0)
# [t i i] срабатывает справа налево: сначала ноты, потом курсор.
wire("fanout", 1, "coll", 0)
wire("fanout", 0, "prepstep", 0)
wire("prepstep", 0, "js", 0)

wire("coll", 0, "funnel", 0)
wire("funnel", 0, "tonote", 0)
wire("tonote", 0, "skip", 0)
wire("skip", 1, "makenote", 0)
wire("makenote", 0, "noteout", 0)
wire("makenote", 1, "noteout", 1)


def read_template_patcher():
    raw = TEMPLATE.read_bytes()
    start = raw.index(b"{")
    text = raw[start:].rstrip(b"\x00").decode("utf-8")
    return json.loads(text)


def build(out_dir):
    doc = read_template_patcher()
    patcher = doc["patcher"]
    patcher["boxes"] = boxes
    patcher["lines"] = lines
    patcher["openinpresentation"] = 1
    patcher["devicewidth"] = float(UI_W)
    patcher["parameters"] = {
        "pattr": ["pattern", "pattern", 0],
        "parameterbanks": {},
        "inherited_shortname": 1,
    }
    # Скрипты Max находит в папке устройства; абсолютные пути в файл не пишем,
    # чтобы собранное устройство можно было раздавать.
    patcher["dependency_cache"] = []

    ptch = json.dumps(doc, indent="\t", ensure_ascii=False).encode("utf-8") + b"\n\x00"
    # Контейнер .amxd: 'ampf' + тип устройства ('mmmm' — MIDI-эффект) + 'meta' + 'ptch' с JSON.
    data = (
        b"ampf"
        + struct.pack("<I", 4)
        + b"mmmm"
        + b"meta"
        + struct.pack("<I", 4)
        + b"\x00\x00\x00\x00"
        + b"ptch"
        + struct.pack("<I", len(ptch))
        + ptch
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "APC Seq.amxd").write_bytes(data)
    for name in SCRIPTS:
        shutil.copy(HERE / name, out_dir / name)
    print(f"Собрано: {out_dir / 'APC Seq.amxd'}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Собрать APC Seq.amxd")
    parser.add_argument(
        "--out",
        type=Path,
        default=OUT_DIR,
        help="папка для устройства (по умолчанию — User Library Live)",
    )
    build(parser.parse_args().out)
