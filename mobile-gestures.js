// Mobile touch bridge for the pre-built Sudoku Mansion web app.
// Single finger: drag-select cells; two fingers: pan the mansion map.
// Preserve the game's original click / dblclick and grid selection handlers.
(function () {
  'use strict';
  if (!document.documentElement.classList.contains('dsh-mobile')) return;

  var DRAG_PX = 7;
  var SAMPLE_PX = 12;
  var pointers = new Map();
  var board = null;
  var stroke = null;
  var pan = null;
  var hadMultipleFingers = false;
  var blockCompatibilityUntil = 0;
  var lastTouchX = 0;
  var lastTouchY = 0;

  function touch(e) { return e.pointerType === 'touch' || e.pointerType === 'pen'; }
  function isRealMouse(e) { return e.isTrusted && Date.now() < blockCompatibilityUntil; }
  function squared(x, y) { return x * x + y * y; }
  function hostOf(target) {
    if (!target || !target.closest) return null;
    var mansion = target.closest('app-mansion .canvas-wrap');
    if (mansion) return { kind: 'mansion', element: mansion };
    var grid = target.closest('app-sudoku-grid');
    return grid ? { kind: 'grid', element: grid } : null;
  }
  function cellOf(target, kind) {
    if (!target || !target.closest) return null;
    return target.closest(kind === 'mansion'
      ? 'app-mansion .mansion-svg g.room rect.cell'
      : 'app-sudoku-grid rect[aria-label^="Row "]');
  }
  function sameBoard(a, b) { return a && b && a.element === b.element && a.kind === b.kind; }
  function markCompat(e) {
    blockCompatibilityUntil = Date.now() + 750;
    lastTouchX = e.clientX;
    lastTouchY = e.clientY;
  }
  function suppressCompatibilityMouse(e) {
    // Do not block actual mouse use on touchscreen laptops or our synthetic events.
    if (!isRealMouse(e)) return;
    if (squared(e.clientX - lastTouchX, e.clientY - lastTouchY) > 60 * 60) return;
    var host = hostOf(e.target);
    if (!host) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  // Capture BEFORE the bundled game's document-level synthetic mouse listeners.
  // Only block delayed real compatibility mouse events after an actual drag/pan.
  ['mousedown', 'mouseup', 'click'].forEach(function (name) {
    window.addEventListener(name, suppressCompatibilityMouse, true);
  });

  function sendMouse(target, type, x, y, shift) {
    if (!target || !target.isConnected) return;
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1,
      shiftKey: !!shift, detail: type === 'click' ? 1 : 0
    }));
  }
  function cellAt(x, y, s) {
    if (!s || !s.cell || !s.cell.isConnected) return null;
    // Limit selection to the room where the gesture began. A single selection
    // in the game is always associated with one room, even on the mansion map.
    var hovered = document.elementFromPoint(x, y);
    var hit = cellOf(hovered, s.kind);
    if (hit && (s.kind === 'grid' || hit.closest('g.room') === s.room)) return hit;
    // Visual overlays may cover SVG rects even though they are not selectable.
    // Fall back to geometrical hit testing in the starting room only.
    var scope = s.kind === 'mansion' ? s.room : s.host;
    var selector = s.kind === 'mansion' ? 'rect.cell' : 'rect[aria-label^="Row "]';
    var cells = scope ? scope.querySelectorAll(selector) : [];
    for (var i = 0; i < cells.length; i++) {
      var r = cells[i].getBoundingClientRect();
      if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return cells[i];
    }
    return null;
  }
  function isStartingCellSelected(s) {
    // The game renders its selection as a non-interactive SVG path. Use that
    // path rather than guessing the game's internal Angular state.
    var path = s.host && s.host.querySelector('path.cell-selection');
    if (!path || !path.isPointInFill || !path.getScreenCTM) return false;
    try {
      var matrix = path.getScreenCTM();
      if (!matrix) return false;
      var rect = s.cell.getBoundingClientRect();
      var svg = s.cell.ownerSVGElement;
      var point = svg.createSVGPoint();
      point.x = (rect.left + rect.right) / 2;
      point.y = (rect.top + rect.bottom) / 2;
      return path.isPointInFill(point.matrixTransform(matrix.inverse()));
    } catch (e) { return false; }
  }
  function startMansionSelection(s) {
    if (isStartingCellSelected(s)) {
      // The original single click toggles off the only selected cell. Select
      // another cell temporarily to clear that state before selecting start.
      var cells = s.room.querySelectorAll('rect.cell');
      for (var i = 0; i < cells.length; i++) {
        if (cells[i] !== s.cell) {
          var r = cells[i].getBoundingClientRect();
          sendMouse(cells[i], 'click', (r.left + r.right) / 2, (r.top + r.bottom) / 2);
          break;
        }
      }
    }
    selectMansionCell(s.cell, s, s.startX, s.startY);
  }
  function selectMansionCell(cell, s, x, y) {
    if (!cell || s.seen.has(cell)) return;
    s.seen.add(cell);
    // The existing handler uses Shift+click to toggle an additional cell.
    sendMouse(cell, 'click', x, y, s.seen.size > 1);
  }
  function sampleLine(s, fromX, fromY, x, y, callback) {
    var dx = x - fromX, dy = y - fromY;
    var steps = Math.min(120, Math.max(1, Math.ceil(Math.sqrt(squared(dx, dy)) / SAMPLE_PX)));
    for (var j = 1; j <= steps; j++) {
      var px = fromX + dx * j / steps;
      var py = fromY + dy * j / steps;
      callback(px, py);
    }
  }
  function finishGridDrag(s) {
    if (s && s.dragging && s.kind === 'grid') sendMouse(s.host, 'mouseup', s.x, s.y);
  }
  function resetAfterLastPointer() {
    if (pointers.size) return;
    board = null;
    stroke = null;
    pan = null;
    hadMultipleFingers = false;
  }
  function centroid() {
    var x = 0, y = 0;
    pointers.forEach(function (p) { x += p.x; y += p.y; });
    return { x: x / pointers.size, y: y / pointers.size };
  }
  function stopPan() {
    if (pan && pan.active) {
      // The original mansion component has no pointercancel handler.
      pan.board.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, pointerId: pan.id, pointerType: 'touch'
      }));
    }
    pan = null;
  }

  document.addEventListener('pointerdown', function (e) {
    if (!touch(e)) return;
    var hit = hostOf(e.target);
    if (!hit || (board && !sameBoard(board, hit))) return;
    if (!board) board = hit;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      var cell = cellOf(e.target, hit.kind);
      stroke = cell ? {
        kind: hit.kind, id: e.pointerId, host: hit.element, cell: cell,
        room: hit.kind === 'mansion' ? cell.closest('g.room') : null,
        startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY,
        dragging: false, seen: new Set()
      } : null;
      if (hit.kind === 'mansion') {
        // Otherwise the bundled game pans the map on EVERY single-finger move.
        e.stopPropagation();
      }
    } else {
      hadMultipleFingers = true;
      if (stroke) finishGridDrag(stroke);
      stroke = null;
      if (pointers.size === 2 && hit.kind === 'mansion') {
        // Let only the second real pointerdown reach the existing pan handler.
        // It initializes panX/panY and calls setPointerCapture on a valid ID.
        var center = centroid();
        pan = { active: true, board: hit.element, id: e.pointerId,
          originX: e.clientX, originY: e.clientY,
          centerX: center.x, centerY: center.y };
      } else {
        // No pan exists on the in-room Sudoku SVG; avoid accidental draws.
        if (pan) stopPan();
        if (hit.kind === 'mansion') e.stopPropagation();
      }
    }
  }, true);

  document.addEventListener('pointermove', function (e) {
    if (!e.isTrusted || !touch(e) || !pointers.has(e.pointerId)) return;
    var p = pointers.get(e.pointerId);
    p.x = e.clientX; p.y = e.clientY;

    if (board && board.kind === 'mansion') e.stopPropagation();
    if (pan) {
      if (pointers.size === 2) {
        // Feed centroid motion into the game's real pointer-pan implementation;
        // pan/zoom/save/recentering all continue to work as before.
        var center = centroid();
        pan.board.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, pointerType: 'touch', pointerId: pan.id,
          clientX: pan.originX + center.x - pan.centerX,
          clientY: pan.originY + center.y - pan.centerY
        }));
      }
      return;
    }
    var s = stroke;
    if (!s || s.id !== e.pointerId || hadMultipleFingers) return;
    var dx = e.clientX - s.startX, dy = e.clientY - s.startY;
    if (!s.dragging && squared(dx, dy) >= DRAG_PX * DRAG_PX) {
      s.dragging = true;
      if (s.kind === 'mansion') startMansionSelection(s);
      else sendMouse(s.cell, 'mousedown', s.startX, s.startY);
    }
    if (s.dragging) {
      sampleLine(s, s.x, s.y, e.clientX, e.clientY, function (x, y) {
        if (s.kind === 'mansion') selectMansionCell(cellAt(x, y, s), s, x, y);
        else sendMouse(s.host, 'mousemove', x, y);
      });
    }
    s.x = e.clientX; s.y = e.clientY;
  }, true);

  function release(e, canceled) {
    if (!touch(e) || !pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    var s = stroke;
    if (s && s.id === e.pointerId) {
      if (s.dragging) {
        if (!canceled) {
          sampleLine(s, s.x, s.y, e.clientX, e.clientY, function (x, y) {
            if (s.kind === 'mansion') selectMansionCell(cellAt(x, y, s), s, x, y);
            else sendMouse(s.host, 'mousemove', x, y);
          });
        }
        s.x = e.clientX; s.y = e.clientY;
        finishGridDrag(s);
        markCompat(e);
      }
      stroke = null;
    }
    if (hadMultipleFingers) markCompat(e);
    if (pan && pan.id === e.pointerId) {
      // Allow the original pointerup to end panning, unless this was cancel.
      if (canceled) stopPan();
      else pan = null;
    } else if (board && board.kind === 'mansion') {
      // First pointer was never sent to the game; do not terminate an active
      // second-finger pan when first finger is lifted.
      e.stopPropagation();
    }
    resetAfterLastPointer();
  }
  document.addEventListener('pointerup', function (e) { release(e, false); }, true);
  document.addEventListener('pointercancel', function (e) { release(e, true); }, true);

  window.addEventListener('blur', function () {
    finishGridDrag(stroke);
    stopPan();
    pointers.clear();
    resetAfterLastPointer();
  });
})();
