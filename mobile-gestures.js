// Mobile pointer gesture coordinator for Sudoku Mansion's pre-built web client.
// One tap -> select; one-finger drag -> multi-select; two fingers -> pan mansion;
// double tap -> original dblclick action. No desktop-mouse changes.
(function () {
  'use strict';
  if (!document.documentElement.classList.contains('dsh-mobile')) return;

  var DRAG_DISTANCE = 7;
  var MAX_TAP_MOVE = 9;
  var DOUBLE_TAP_MS = 430;
  var DOUBLE_TAP_DISTANCE = 28;
  var SAMPLE_DISTANCE = 8;
  var pointers = new Map();
  var gesture = null;
  var multiTouch = false;
  var lastTap = null;
  var lastTouch = null;
  var replayingPan = false;

  function isTouch(e) { return e.pointerType === 'touch' || e.pointerType === 'pen'; }
  function d2(a, b) {
    var x = a.x - b.x, y = a.y - b.y;
    return x * x + y * y;
  }
  function hostFor(target) {
    if (!target || !target.closest) return null;
    var canvas = target.closest('app-mansion .canvas-wrap');
    if (canvas) return { kind: 'mansion', element: canvas };
    var grid = target.closest('app-sudoku-grid');
    return grid ? { kind: 'grid', element: grid } : null;
  }
  function selector(kind) {
    return kind === 'mansion' ? 'g.room rect.cell' : 'rect[aria-label^="Row "]';
  }
  function cellAt(host, x, y, room) {
    var scope = room || (host.kind === 'mansion'
      ? host.element.querySelector('.mansion-svg') : host.element);
    if (!scope) return null;
    var top = document.elementFromPoint(x, y);
    var cell = top && top.closest ? top.closest(selector(host.kind)) : null;
    if (cell && scope.contains(cell)) return cell;
    var cells = scope.querySelectorAll(selector(host.kind));
    for (var i = 0; i < cells.length; i++) {
      var rect = cells[i].getBoundingClientRect();
      if (x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) return cells[i];
    }
    return null;
  }
  function cellKey(cell, kind) {
    if (kind === 'grid') return cell.getAttribute('aria-label') || '';
    var room = cell.closest('g.room');
    return (room ? room.getAttribute('aria-label') : '') + '/' +
      cell.getAttribute('x') + ',' + cell.getAttribute('y');
  }
  function emitMouse(target, type, x, y, shift) {
    if (!target || !target.isConnected) return;
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window, detail: type === 'dblclick' ? 2 : (type === 'click' ? 1 : 0),
      clientX: x, clientY: y, button: 0,
      buttons: type === 'mouseup' ? 0 : 1, shiftKey: !!shift
    }));
  }
  function blockNativeMouse(e) {
    if (!e.isTrusted || !lastTouch || Date.now() - lastTouch.at > 850) return;
    var host = hostFor(e.target);
    if (!host || (host.kind === 'mansion' && !e.target.closest('.mansion-svg'))) return;
    // Don't interfere with a physical mouse used immediately after touch.
    if (d2({ x: e.clientX, y: e.clientY }, lastTouch) > 65 * 65) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  ['mousedown', 'mouseup', 'click', 'dblclick'].forEach(function (type) {
    window.addEventListener(type, blockNativeMouse, true);
  });
  function noteTouch(e) {
    lastTouch = { at: Date.now(), x: e.clientX, y: e.clientY };
  }
  function selectedAtStart(g) {
    var path = g.host.element.querySelector('path.cell-selection');
    if (!path || !path.isPointInFill || !path.getScreenCTM) return false;
    try {
      var matrix = path.getScreenCTM();
      if (!matrix) return false;
      var point = g.startCell.ownerSVGElement.createSVGPoint();
      var rect = g.startCell.getBoundingClientRect();
      point.x = (rect.left + rect.right) / 2;
      point.y = (rect.top + rect.bottom) / 2;
      return path.isPointInFill(point.matrixTransform(matrix.inverse()));
    } catch (_) { return false; }
  }
  function selectMansionCell(g, cell, x, y) {
    if (!cell || g.seen.has(cell)) return;
    g.seen.add(cell);
    // The bundled game's click handler supports Shift-click to extend a selection.
    emitMouse(cell, 'click', x, y, g.seen.size > 1);
  }
  function beginDrag(g) {
    g.dragging = true;
    lastTap = null;
    if (g.host.kind === 'mansion') {
      if (selectedAtStart(g)) g.seen.add(g.startCell);
      else selectMansionCell(g, g.startCell, g.start.x, g.start.y);
    }
  }
  function strokeSegment(g, to) {
    var dx = to.x - g.previous.x, dy = to.y - g.previous.y;
    var count = Math.min(256, Math.max(1,
      Math.ceil(Math.sqrt(dx * dx + dy * dy) / SAMPLE_DISTANCE)));
    for (var i = 1; i <= count; i++) {
      var x = g.previous.x + dx * i / count;
      var y = g.previous.y + dy * i / count;
      if (g.host.kind === 'mansion') {
        selectMansionCell(g, cellAt(g.host, x, y, g.room), x, y);
      } else {
        emitMouse(g.host.element, 'mousemove', x, y);
      }
    }
    g.previous = to;
  }
  function endGridDrag(g) {
    if (g && g.gridDown && g.host.kind === 'grid') {
      g.gridDown = false;
      emitMouse(g.host.element, 'mouseup', g.previous.x, g.previous.y);
    }
  }
  function center() {
    var x = 0, y = 0;
    pointers.forEach(function (p) { x += p.x; y += p.y; });
    return { x: x / pointers.size, y: y / pointers.size };
  }
  function finish() {
    if (pointers.size) return;
    gesture = null;
    multiTouch = false;
  }
  document.addEventListener('pointerdown', function (e) {
    if (!isTouch(e)) return;
    var host = hostFor(e.target);
    if (!host) return;
    if (gesture && (host.kind !== gesture.host.kind ||
        host.element !== gesture.host.element)) return;
    noteTouch(e);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      var cell = cellAt(host, e.clientX, e.clientY);
      var room = cell && host.kind === 'mansion' ? cell.closest('g.room') : null;
      gesture = {
        host: host, fingerId: e.pointerId, startCell: cell, room: room,
        start: { x: e.clientX, y: e.clientY },
        previous: { x: e.clientX, y: e.clientY },
        dragging: false, seen: new Set(), panAnchor: null, gridDown: false
      };
      if (host.kind === 'grid' && cell) {
        // Mirror desktop order: selection belongs to mouse DOWN, not touch release.
        gesture.gridDown = true;
        emitMouse(cell, 'mousedown', e.clientX, e.clientY);
      }
      // Let the original mansion pointerdown reset didDrag and its pan state.
      // Intercept subsequent one-finger moves instead.
    } else {
      multiTouch = true;
      lastTap = null;
      if (gesture) {
        endGridDrag(gesture);
        gesture.startCell = null;
        if (pointers.size === 2 && host.kind === 'mansion') {
          gesture.panAnchor = { center: center(), finger: { x: e.clientX, y: e.clientY } };
        }
      }
    }
  }, true);

  document.addEventListener('pointermove', function (e) {
    if (!isTouch(e) || replayingPan || !pointers.has(e.pointerId)) return;
    var p = pointers.get(e.pointerId);
    p.x = e.clientX; p.y = e.clientY;
    noteTouch(e);
    if (!gesture) return;
    if (gesture.host.kind === 'mansion') {
      // The built-in handler otherwise pans on the very first finger's move.
      e.stopPropagation();
    }
    if (multiTouch) {
      if (pointers.size === 2 && gesture.panAnchor &&
          gesture.host.kind === 'mansion' && typeof PointerEvent !== 'undefined') {
        var c = center(), anchor = gesture.panAnchor;
        replayingPan = true;
        try {
          gesture.host.element.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, pointerId: e.pointerId, pointerType: 'touch',
            clientX: anchor.finger.x + c.x - anchor.center.x,
            clientY: anchor.finger.y + c.y - anchor.center.y
          }));
        } finally { replayingPan = false; }
      }
      return;
    }
    if (e.pointerId !== gesture.fingerId || !gesture.startCell) return;
    var point = { x: e.clientX, y: e.clientY };
    if (!gesture.dragging && d2(point, gesture.start) >= DRAG_DISTANCE * DRAG_DISTANCE) {
      beginDrag(gesture);
    }
    if (gesture.dragging) strokeSegment(gesture, point);
    else gesture.previous = point;
  }, true);

  function release(e, canceled) {
    if (!isTouch(e) || !pointers.has(e.pointerId)) return;
    noteTouch(e);
    var g = gesture;
    // Finish panning as soon as either finger lifts; do not turn the surviving
    // single finger into a drawing gesture.
    if (multiTouch) lastTap = null;
    if (g && e.pointerId === g.fingerId && !multiTouch && g.startCell) {
      var end = { x: e.clientX, y: e.clientY };
      if (g.dragging) {
        if (!canceled) strokeSegment(g, end);
        endGridDrag(g);
      } else if (!canceled && d2(end, g.start) <= MAX_TAP_MOVE * MAX_TAP_MOVE) {
        endGridDrag(g);
        var now = Date.now(), key = cellKey(g.startCell, g.host.kind);
        var doubleTap = lastTap && lastTap.kind === g.host.kind &&
          lastTap.key === key && now - lastTap.at <= DOUBLE_TAP_MS &&
          d2(lastTap, end) <= DOUBLE_TAP_DISTANCE * DOUBLE_TAP_DISTANCE;
        if (doubleTap) {
          lastTap = null;
          emitMouse(g.startCell, 'dblclick', end.x, end.y);
        } else {
          lastTap = { at: now, kind: g.host.kind, key: key, x: end.x, y: end.y };
          if (g.host.kind === 'mansion') emitMouse(g.startCell, 'click', end.x, end.y);
        }
      } else {
        lastTap = null;
        endGridDrag(g);
      }
    }
    pointers.delete(e.pointerId);
    if (g && g.host.kind === 'mansion' && multiTouch && pointers.size === 1) {
      // Original onPointerUp ends native pan. Do not move on surviving finger.
      g.panAnchor = null;
    }
    if (canceled && g && g.host.kind === 'mansion' && pointers.size === 0 &&
        typeof PointerEvent !== 'undefined') {
      g.host.element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    }
    finish();
  }
  document.addEventListener('pointerup', function (e) { release(e, false); }, true);
  document.addEventListener('pointercancel', function (e) { release(e, true); }, true);
  window.addEventListener('blur', function () {
    endGridDrag(gesture);
    pointers.clear();
    finish();
    lastTap = null;
  });
})();
