// APC Seq для Max for Live: логика секвенсора и связь с APC mini mk2.
//
// Max 8 — старый JavaScript (ES5): только var и function, без let/const/=>.
//
// Нажатия и фейдеры приходят со входа дорожки через [midiin] → [midiparse]
// (сообщения note и cc). Подсветка уходит через Control Surface «MaxForLive»
// в настройках Live: у него есть send_midi в выход контроллера.
//
// Ноты по шагам этот скрипт НЕ играет: js в Max работает в медленном потоке.
// Он только пишет строки паттерна в [coll], а играет патч по такту Live.

autowatch = 1;
inlets = 1;
outlets = 2; // 0 — в [coll] с паттерном, 1 — в окно (jsui)

var TRACKS = 8;
var STEPS = 16;
var COLS = 8;
var TOP_ROW = 7;
var TRACK_BUTTON_FIRST = 100;
var FADER_CC_FIRST = 48;
var FADERS = 9;
var MASTER = 8;
var DRUM_NOTE_FIRST = 36; // C1 — левый нижний пад Drum Rack
var VOLUME_0DB = 0.85;    // значение параметра громкости Live, соответствующее 0 дБ

var COLOR_OFF = 0;
var COLOR_GRAY = 2;
var COLOR_YELLOW = 13;
var COLOR_GREEN = 21;

var NOTE_ON_FULL_BRIGHTNESS = 150; // 0x96
var NOTE_ON = 144;                 // 0x90

var pattern = emptyPattern();
var selected = 0;
var current = -1;

var surface = null;
var observers = [];
var shown = {};         // что сейчас горит на контроллере: ключ "статус:нота" → значение
var queue = [];         // события от наблюдателей; разбираются вне уведомления Live
var queueTask = new Task(drainQueue);

// Фейдеры шлют десятки сообщений в секунду. Запоминаем только последнее положение
// и применяем не чаще FADER_INTERVAL_MS — иначе Live API забивает главный поток Live.
var FADER_INTERVAL_MS = 33;
var pendingFaders = [];       // фейдер → последнее значение 0..127, ещё не применённое
var faderTask = new Task(applyFaders);
var faderTaskScheduled = false;
var volumeApis = [];          // фейдер → LiveAPI параметра громкости, найденный один раз
var trackPath = null;

function emptyPattern() {
    var p = [];
    for (var t = 0; t < TRACKS; t++) {
        p[t] = [];
        for (var s = 0; s < STEPS; s++) p[t][s] = 0;
    }
    return p;
}

// ---------- запуск ----------

// Приходит от [live.thisdevice], когда Live API готов.
function init() {
    observers = [];
    shown = {};

    surface = findSurface();
    if (surface) {
        status("");
    } else {
        status("Выберите Control Surface «MaxForLive» для APC mini mk2 в настройках Live");
    }

    // Устройства на дорожке поменялись (добавили или переставили Drum Rack) —
    // забываем найденные параметры громкости, найдём заново при следующем движении.
    trackPath = thisTrackPath();
    if (trackPath) {
        var devices = new LiveAPI(function () { volumeApis = []; }, trackPath);
        devices.property = "devices";
        observers.push(devices);
    }

    var song = new LiveAPI(function (args) {
        if (args[0] === "is_playing" && args[1] == 0) enqueue(["stopped"]);
    }, "live_set");
    song.property = "is_playing";
    observers.push(song);

    pushAllSteps();
    sendUi();
    render();
}

function findSurface() {
    for (var i = 0; i < 8; i++) {
        var api = new LiveAPI(null, "control_surfaces " + i);
        if (Number(api.id) === 0) continue;
        var kind = String(api.type) + " " + String(api.info);
        if (kind.indexOf("MaxForLive") >= 0) return api;
    }
    return null;
}

// ---------- вход с контроллера (со входа дорожки) ----------

// Note On/Off: отпускание приходит с velocity 0 — его пропускаем.
function note(pitch, velocity) {
    if (velocity <= 0) return;
    if (pitch < TRACKS * COLS) enqueue(["pad", pitch]);
    else if (pitch >= TRACK_BUTTON_FIRST && pitch < TRACK_BUTTON_FIRST + TRACKS) enqueue(["track", pitch - TRACK_BUTTON_FIRST]);
}

function cc(number, value) {
    if (number < FADER_CC_FIRST || number >= FADER_CC_FIRST + FADERS) return;
    pendingFaders[number - FADER_CC_FIRST] = value;
    if (!faderTaskScheduled) {
        faderTaskScheduled = true;
        faderTask.schedule(FADER_INTERVAL_MS);
    }
}

// Изнутри уведомления Live нельзя менять сет (громкости) — разбираем позже.
function enqueue(event) {
    queue.push(event);
    queueTask.schedule(0);
}

function drainQueue() {
    var events = queue;
    queue = [];
    var changed = false;
    for (var i = 0; i < events.length; i++) {
        var e = events[i];
        if (e[0] === "pad") changed = onPad(e[1]) || changed;
        else if (e[0] === "track") { selected = e[1]; changed = true; sendUi(); }
        else if (e[0] === "stopped") { current = -1; changed = true; outlet(1, "step", -1); }
    }
    if (changed) render();
}

// ---------- раскладка ----------

// Шаг → пад: шаги 1–8 — верхний ряд, 9–16 — второй сверху.
function stepToPad(step) {
    var row = TOP_ROW - Math.floor(step / COLS);
    return row * COLS + (step % COLS);
}

function padToStep(pad) {
    var row = Math.floor(pad / COLS);
    var step = (TOP_ROW - row) * COLS + (pad % COLS);
    return row <= TOP_ROW && step >= 0 && step < STEPS ? step : -1;
}

// ---------- секвенсор ----------

function onPad(pad) {
    var step = padToStep(pad);
    if (step < 0) return false;
    toggle(selected, step);
    return true;
}

function toggle(track, step) {
    pattern[track][step] = pattern[track][step] ? 0 : 1;
    pushStep(step);
    outlet(1, "cell", track, step, pattern[track][step]);
    notifyclients(); // сообщаем [pattr], что паттерн изменился
}

// Строка шага для [coll]: «индекс v0 v1 … v7» — какие дорожки звучат на шаге.
function pushStep(step) {
    var row = ["store", step];
    for (var t = 0; t < TRACKS; t++) row.push(pattern[t][step]);
    outlet(0, row);
}

function pushAllSteps() {
    for (var s = 0; s < STEPS; s++) pushStep(s);
}

// Приходит из патча на каждой 1/16 (уже после того, как ноты сыграны).
function step(s) {
    current = s;
    outlet(1, "step", s);
    render();
}

// ---------- подсветка ----------

function render() {
    if (!surface) return;
    var s, pad;
    for (s = 0; s < STEPS; s++) {
        var color = s === current ? COLOR_GREEN : pattern[selected][s] ? COLOR_YELLOW : COLOR_GRAY;
        sendLed(NOTE_ON_FULL_BRIGHTNESS, stepToPad(s), color);
    }
    for (pad = 0; pad < TRACKS * COLS; pad++) {
        if (padToStep(pad) < 0) sendLed(NOTE_ON_FULL_BRIGHTNESS, pad, COLOR_OFF);
    }
    for (var t = 0; t < TRACKS; t++) {
        sendLed(NOTE_ON, TRACK_BUTTON_FIRST + t, t === selected ? 1 : 0);
    }
}

// Шлём только то, что изменилось.
function sendLed(statusByte, note, value) {
    var key = note; // у каждой ноты свой статус, так что ключа по ноте хватает
    if (shown[key] === value) return;
    shown[key] = value;
    surface.call("send_midi", statusByte, note, value);
}

// ---------- громкость ----------

function applyFaders() {
    faderTaskScheduled = false;
    for (var f = 0; f < FADERS; f++) {
        if (pendingFaders[f] === undefined) continue;
        var api = volumeApi(f);
        if (api) api.set("value", (pendingFaders[f] / 127) * VOLUME_0DB);
        pendingFaders[f] = undefined;
    }
}

// Параметр громкости для фейдера: мастер — громкость дорожки, остальные —
// громкость пэда Drum Rack. Пустой пэд не запоминаем: в него могут положить сэмпл.
function volumeApi(fader) {
    var api = volumeApis[fader];
    if (api && Number(api.id)) return api;
    if (!trackPath) return null;

    var path;
    if (fader === MASTER) {
        path = trackPath + " mixer_device volume";
    } else {
        var drums = drumRackPath(trackPath);
        if (!drums) return null;
        path = drums + " drum_pads " + (DRUM_NOTE_FIRST + fader) + " chains 0 mixer_device volume";
    }
    api = new LiveAPI(null, path);
    if (!Number(api.id)) return null;
    volumeApis[fader] = api;
    return api;
}

function thisTrackPath() {
    var api = new LiveAPI(null, "this_device");
    api.goto("canonical_parent");
    return Number(api.id) ? cleanPath(api.path) : null;
}

// Первый Drum Rack на дорожке.
function drumRackPath(track) {
    var api = new LiveAPI(null, track);
    var count = api.getcount("devices");
    for (var d = 0; d < count; d++) {
        var path = track + " devices " + d;
        var dev = new LiveAPI(null, path);
        if (String(dev.get("class_name")) === "DrumGroupDevice") return path;
    }
    return null;
}

function cleanPath(path) {
    return String(path).replace(/"/g, "");
}

// ---------- окно ----------

function sendUi() {
    var flat = ["cells"];
    for (var t = 0; t < TRACKS; t++)
        for (var s = 0; s < STEPS; s++) flat.push(pattern[t][s]);
    outlet(1, flat);
    outlet(1, "selected", selected);
}

// Из окна: щелчок по клетке и по номеру дорожки.
function ui_toggle(track, s) {
    toggle(track, s);
    render();
}

function ui_select(track) {
    selected = track;
    sendUi();
    render();
}

function status(text) {
    outlet(1, "status", text);
    if (text) post("APC Seq: " + text + "\n");
}

// ---------- сохранение в проекте Live (через [pattr @bindto]) ----------

function getvalueof() {
    var flat = [];
    for (var t = 0; t < TRACKS; t++)
        for (var s = 0; s < STEPS; s++) flat.push(pattern[t][s]);
    return flat;
}

function setvalueof() {
    var flat = arrayfromargs(arguments);
    if (flat.length !== TRACKS * STEPS) return;
    for (var t = 0; t < TRACKS; t++)
        for (var s = 0; s < STEPS; s++) pattern[t][s] = flat[t * STEPS + s] ? 1 : 0;
    pushAllSteps();
    sendUi();
    render();
}
