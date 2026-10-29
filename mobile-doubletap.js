// Android / iOS: send double-taps on game cells through the original dblclick handler.
// The desktop game listens for dblclick to enter rooms and boss cells, but some
// touch browsers do not emit that event on SVG cells (especially with touch-action:none).
(function () {
  'use strict';
  if (!document.documentElement.classList.contains('dsh-mobile')) return;

  var MAX_INTERVAL = 450;
  var MAX_MOVE = 5; // Match the mansion's 5px pan threshold.
  var MAX_SPACING = 28;
  var MAX_CLICK_DELAY = 650;
  var touching = new Set();
  var pressed = null;
  var released = null;
  var lastTap = null;
  var lastSynthesized = null;

  function findCell(target) {
    if (!target || typeof target.closest !== 'function') return null;
    return target.closest(
      'app-mansion .mansion-svg g.room rect.cell, ' +
      'app-sudoku-grid rect[aria-label^="Row "]'
    );
  }

  function distanceSq(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  document.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    touching.add(e.pointerId);
    released = null;
    if (touching.size !== 1 || e.isPrimary === false) {
      pressed = null;
      lastTap = null;
      return;
    }
    var cell = findCell(e.target);
    pressed = cell ? { id: e.pointerId, cell: cell, x: e.clientX, y: e.clientY, moved: false } : null;
    if (!cell) lastTap = null;
  }, true);

  document.addEventListener('pointermove', function (e) {
    if (!pressed || e.pointerId !== pressed.id) return;
    if (distanceSq(pressed, { x: e.clientX, y: e.clientY }) > MAX_MOVE * MAX_MOVE) {
      pressed.moved = true;
    }
  }, true);

  document.addEventListener('pointerup', function (e) {
    if (!touching.has(e.pointerId)) return;
    touching.delete(e.pointerId);
    if (pressed && pressed.id === e.pointerId && !pressed.moved && touching.size === 0 &&
        distanceSq(pressed, { x: e.clientX, y: e.clientY }) <= MAX_MOVE * MAX_MOVE) {
      released = { cell: pressed.cell, x: e.clientX, y: e.clientY, time: Date.now() };
    }
    pressed = null;
  }, true);

  document.addEventListener('pointercancel', function (e) {
    touching.delete(e.pointerId);
    pressed = null;
    released = null;
    lastTap = null;
  }, true);

  document.addEventListener('click', function (e) {
    var cell = findCell(e.target);
    if (!cell || !released || cell !== released.cell ||
        Date.now() - released.time > MAX_CLICK_DELAY) return;

    var tap = released;
    released = null;
    if (lastTap && lastTap.cell === cell && tap.time - lastTap.time <= MAX_INTERVAL &&
        distanceSq(lastTap, tap) <= MAX_SPACING * MAX_SPACING) {
      lastTap = null;
      lastSynthesized = { cell: cell, time: Date.now() };
      // Do not let the second click toggle selection before the double-click action.
      e.preventDefault();
      e.stopImmediatePropagation();
      cell.dispatchEvent(new MouseEvent('dblclick', {
        bubbles: true, cancelable: true, view: window, detail: 2,
        clientX: tap.x, clientY: tap.y
      }));
    } else {
      lastTap = tap;
    }
  }, true);

  // Some browsers also emit a native dblclick; prevent duplicate navigation.
  document.addEventListener('dblclick', function (e) {
    if (e.isTrusted && lastSynthesized && findCell(e.target) === lastSynthesized.cell &&
        Date.now() - lastSynthesized.time < 700) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
})();
