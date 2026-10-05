// Окно APC Seq в панели устройства: 8 дорожек × 16 шагов.
// Щелчок по клетке — переключить шаг, по номеру дорожки — выбрать её
// (выбранная дорожка показывается на контроллере).

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

var TRACKS = 8;
var STEPS = 16;
var LABEL_W = 18;
var STATUS_H = 14;
var GAP = 1;

// Палитра в духе тёмной темы Live.
var BG = [0.16, 0.16, 0.16, 1];
var CELL = [0.27, 0.27, 0.27, 1];
var CELL_BEAT = [0.33, 0.33, 0.33, 1]; // первая шестнадцатая каждой доли
var CELL_ON = [1.0, 0.71, 0.2, 1];     // оранжевый Live
var ROW_SELECTED = [0.24, 0.24, 0.24, 1];
var CURSOR = [0.45, 0.85, 0.35, 0.45];
var TEXT = [0.75, 0.75, 0.75, 1];
var TEXT_SELECTED = [1.0, 0.71, 0.2, 1];
var TEXT_STATUS = [1.0, 0.55, 0.45, 1];

var cells = [];
for (var i = 0; i < TRACKS * STEPS; i++) cells[i] = 0;
var selected = 0;
var current = -1;
var statusText = "";

function size() {
    return [box.rect[2] - box.rect[0], box.rect[3] - box.rect[1]];
}

function gridGeometry() {
    var sz = size();
    var bottom = statusText ? STATUS_H : 0;
    return {
        x: LABEL_W,
        cw: (sz[0] - LABEL_W) / STEPS,
        ch: (sz[1] - bottom) / TRACKS
    };
}

function paint() {
    var sz = size();
    var g = gridGeometry();

    mgraphics.set_source_rgba(BG);
    mgraphics.rectangle(0, 0, sz[0], sz[1]);
    mgraphics.fill();

    mgraphics.select_font_face("Arial");
    mgraphics.set_font_size(9);

    for (var t = 0; t < TRACKS; t++) {
        var y = t * g.ch;
        if (t === selected) {
            mgraphics.set_source_rgba(ROW_SELECTED);
            mgraphics.rectangle(0, y, sz[0], g.ch);
            mgraphics.fill();
        }
        mgraphics.set_source_rgba(t === selected ? TEXT_SELECTED : TEXT);
        mgraphics.move_to(5, y + g.ch / 2 + 3);
        mgraphics.show_text(String(t + 1));

        for (var s = 0; s < STEPS; s++) {
            var on = cells[t * STEPS + s];
            mgraphics.set_source_rgba(on ? CELL_ON : s % 4 === 0 ? CELL_BEAT : CELL);
            mgraphics.rectangle(g.x + s * g.cw + GAP, y + GAP, g.cw - 2 * GAP, g.ch - 2 * GAP);
            mgraphics.fill();
        }
    }

    if (current >= 0) {
        mgraphics.set_source_rgba(CURSOR);
        mgraphics.rectangle(g.x + current * g.cw, 0, g.cw, g.ch * TRACKS);
        mgraphics.fill();
    }

    if (statusText) {
        mgraphics.set_source_rgba(TEXT_STATUS);
        mgraphics.move_to(4, sz[1] - 4);
        mgraphics.show_text(statusText);
    }
}

function onclick(x, y) {
    var g = gridGeometry();
    var t = Math.floor(y / g.ch);
    if (t < 0 || t >= TRACKS) return;
    if (x < LABEL_W) {
        outlet(0, "ui_select", t);
        return;
    }
    var s = Math.floor((x - g.x) / g.cw);
    if (s >= 0 && s < STEPS) outlet(0, "ui_toggle", t, s);
}
onclick.local = 1;

// ---------- сообщения от apcseq.js ----------

function anything() {
    var args = arrayfromargs(arguments);
    switch (messagename) {
        case "cells":
            for (var i = 0; i < args.length && i < cells.length; i++) cells[i] = args[i];
            break;
        case "cell":
            cells[args[0] * STEPS + args[1]] = args[2];
            break;
        case "selected":
            selected = args[0];
            break;
        case "step":
            current = args[0];
            break;
        case "status":
            statusText = args.join(" ");
            break;
        default:
            return;
    }
    mgraphics.redraw();
}

function onresize() {
    mgraphics.redraw();
}
onresize.local = 1;
