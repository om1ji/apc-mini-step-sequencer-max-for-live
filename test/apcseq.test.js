// Проверка логики apcseq.js вне Max: глобальные объекты Max и Live API
// заменены заглушками. Запуск: node test/apcseq.test.js
var assert = require("assert");
var fs = require("fs");
var path = require("path");

var out = [];
var sets = [];
global.Task = function (f) { this.schedule = function () { f(); }; };
global.LiveAPI = function (cb, p) {
    this.id = 1;
    this.path = p;
    this.set = function (k, v) { sets.push([p, v]); };
    this.getcount = function () { return 1; };
    this.get = function () { return "DrumGroupDevice"; };
    this.goto = function () { this.path = "live_set tracks 0"; };
    this.call = function () {};
};
global.outlet = function () { out.push(Array.prototype.slice.call(arguments)); };
global.notifyclients = function () {};
global.post = function () {};
global.arrayfromargs = function (a) { return Array.prototype.slice.call(a); };

eval(fs.readFileSync(path.join(__dirname, "..", "apcseq.js"), "utf8"));

// Раскладка: шаг 1 — левый верхний пад, шаг 9 — первая колонка второго ряда.
assert.equal(stepToPad(0), 56);
assert.equal(stepToPad(8), 48);
assert.equal(stepToPad(15), 55);
for (var s = 0; s < STEPS; s++) assert.equal(padToStep(stepToPad(s)), s);
assert.equal(padToStep(47), -1);

// Нажатия: кнопка 2 выбирает дорожку, пад переключает шаг, отпускание игнорируется.
note(101, 127);
assert.equal(selected, 1);
out = [];
note(56, 127);
note(56, 0);
assert.equal(pattern[1][0], 1);
var stores = out.filter(function (o) { return o[0] === 0; }).map(function (o) { return o[1]; });
assert.deepEqual(stores, [["store", 0, 0, 1, 0, 0, 0, 0, 0, 0]]);

// Сохранение и восстановление паттерна через pattr.
var saved = getvalueof();
pattern = emptyPattern();
setvalueof.apply(null, saved);
assert.equal(pattern[1][0], 1);

// Фейдеры: 1-й — громкость пэда C1 в Drum Rack, 9-й — громкость дорожки.
trackPath = "live_set tracks 0";
cc(48, 127);
cc(56, 64);
assert.deepEqual(sets, [
    ["live_set tracks 0 devices 0 drum_pads 36 chains 0 mixer_device volume", 0.85],
    ["live_set tracks 0 mixer_device volume", (64 / 127) * 0.85],
]);

console.log("ok");
