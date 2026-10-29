/*
 * Android-only touch bridge. Loaded by MainActivity, NOT by GitHub Pages.
 * The original game already supports mouse drag selection in a room and
 * Shift-click additive selection in the mansion. Reuse those handlers.
 */
(function () {
  'use strict';
  if (window.__smAndroidTouchInstalled) return;
  window.__smAndroidTouchInstalled = true;

  var style = document.createElement('style');
  style.textContent =
    '.canvas-wrap, .canvas-wrap svg, app-sudoku-grid, app-sudoku-grid svg {' +
    'touch-action: none !important; }';
  document.head.appendChild(style);

  var overviewFingers = new Map();
  var overviewGesture = null;
  var overviewPan = null;
  var blockOverviewClicksUntil = 0;
  var lastTap = null;
  var gridFingers = new Map();
  var gridDrag = null;
  var DRAG_SLOP = 8;

  function elementForPoint(x, y) {
    return document.elementFromPoint(x, y);
  }

  function overviewCellAt(x, y, canvas) {
    var hit = elementForPoint(x, y);
    var cell = hit && hit.closest ? hit.closest('rect.cell') : null;
    return cell && canvas.contains(cell) ? cell : null;
  }

  function emitClick(cell, x, y, additive, doubleClick) {
    cell.dispatchEvent(new MouseEvent(doubleClick ? 'dblclick' : 'click', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      shiftKey: !!additive,
      detail: doubleClick ? 2 : 1
    }));
  }

  function selectAlongPath(startX, startY, endX, endY) {
    if (!overviewGesture || overviewGesture.cancelled || !overviewGesture.startCell) return;
    var g = overviewGesture;
    if (!g.dragging) {
      g.dragging = true;
      emitClick(g.startCell, g.startX, g.startY, false, false);
      g.lastCell = g.startCell;
    }
    // Sample between move events so fast swipes don't skip narrow cells.
    var distance = Math.hypot(endX - startX, endY - startY);
    var steps = Math.min(160, Math.max(1, Math.ceil(distance / 5)));
    for (var i = 1; i <= steps; i++) {
      var x = startX + (endX - startX) * i / steps;
      var y = startY + (endY - startY) * i / steps;
      var cell = overviewCellAt(x, y, g.canvas);
      if (cell && cell !== g.lastCell) {
        emitClick(cell, x, y, true, false);
        g.lastCell = cell;
      }
    }
  }

  function midpoint(points) {
    var a = points[0], b = points[1];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function dispatchPanMove() {
    if (!overviewPan || overviewFingers.size < 2) return;
    var p = overviewPan;
    var center = midpoint(Array.from(overviewFingers.values()));
    // The real SECOND finger started the original game's pointer pan.
    // Feed it the midpoint's delta, avoiding a jump when finger 2 lands.
    p.canvas.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      pointerId: p.pointerId,
      pointerType: 'touch',
      clientX: p.baseX + center.x - p.centerX,
      clientY: p.baseY + center.y - p.centerY
    }));
  }

  function stopPan() {
    if (!overviewPan) return;
    // Call the game's normal pointer-up handler to release pan state.
    overviewPan.canvas.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: overviewPan.pointerId,
      pointerType: 'touch'
    }));
    overviewPan = null;
  }

  function mouse(type, target, e) {
    if (!target) return;
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: e.clientX,
      clientY: e.clientY,
      button: 0,
      buttons: type === 'mouseup' ? 0 : 1
    }));
  }

  function isTouch(e) {
    // Real physical touches only. Ignore our synthetic mouse/pointer events.
    return e.isTrusted && e.pointerType === 'touch';
  }

  document.addEventListener('pointerdown', function (e) {
    if (!isTouch(e)) return;
    var el = e.target;
    if (!el || !el.closest) return;

    var grid = el.closest('app-sudoku-grid');
    var gridCell = el.closest('rect.cell-bg');
    if (grid && gridCell) {
      gridFingers.set(e.pointerId, { host: grid });
      // Prevent compatibility mouse events; synthesize exactly one mouse
      // sequence for the original room grid's mouse-drag handler instead.
      e.preventDefault();
      if (gridFingers.size === 1) {
        gridDrag = { pointerId: e.pointerId, host: grid };
        mouse('mousedown', gridCell, e);
      } else if (gridDrag) {
        mouse('mouseup', gridDrag.host, e);
        gridDrag = null;
      }
      // Let the original pointer event through, preserving line-tool input.
      return;
    }

    var canvas = el.closest('.canvas-wrap');
    if (!canvas || el.closest('button, a, input, textarea, select, .tutorial-bubble')) return;

    overviewFingers.set(e.pointerId, {
      x: e.clientX, y: e.clientY, canvas: canvas
    });
    e.preventDefault();

    if (overviewFingers.size === 1) {
      overviewGesture = {
        canvas: canvas,
        startX: e.clientX,
        startY: e.clientY,
        prevX: e.clientX,
        prevY: e.clientY,
        startCell: overviewCellAt(e.clientX, e.clientY, canvas),
        lastCell: null,
        dragging: false,
        cancelled: false
      };
      // Let the original handler reset its 'didDrag' flag. A bubbling
      // listener below immediately stops that initial single-finger pan.
      // Without the reset, clicks after a previous two-finger pan are ignored.
    } else if (overviewFingers.size === 2) {
      if (overviewGesture) overviewGesture.cancelled = true;
      var center = midpoint(Array.from(overviewFingers.values()));
      overviewPan = {
        canvas: canvas,
        pointerId: e.pointerId,
        baseX: e.clientX,
        baseY: e.clientY,
        centerX: center.x,
        centerY: center.y
      };
      // Finger 2 reaches the original pointerdown handler, which starts
      // a real captured pan. Its subsequent moves are midpoint-driven.
    } else {
      if (overviewGesture) overviewGesture.cancelled = true;
      stopPan();
      e.stopImmediatePropagation();
    }
  }, { capture: true, passive: false });

  document.addEventListener('pointerdown', function (e) {
    if (!isTouch(e) || !overviewGesture ||
        overviewFingers.size !== 1 ||
        !overviewFingers.has(e.pointerId)) return;
    // The original canvas handler has now run: reset didDrag, but immediately
    // terminate the single-finger pan before any movement reaches it.
    overviewGesture.canvas.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: e.pointerId,
      pointerType: 'touch'
    }));
  }, false);

  document.addEventListener('pointermove', function (e) {
    if (!isTouch(e)) return;
    if (gridFingers.has(e.pointerId)) {
      // The room grid uses mousemove for continuous cell selection; its
      // original pointermove still handles the separate line drawing tool.
      if (gridDrag && gridDrag.pointerId === e.pointerId) {
        mouse('mousemove', gridDrag.host, e);
      }
      return;
    }

    var finger = overviewFingers.get(e.pointerId);
    if (!finger) return;
    e.preventDefault();
    e.stopImmediatePropagation();

    var prevX = finger.x, prevY = finger.y;
    finger.x = e.clientX;
    finger.y = e.clientY;
    if (overviewPan && overviewFingers.size === 2) {
      dispatchPanMove();
    } else if (overviewFingers.size === 1 && overviewGesture &&
               !overviewGesture.cancelled) {
      var g = overviewGesture;
      if (g.dragging || Math.hypot(e.clientX - g.startX,
                                     e.clientY - g.startY) >= DRAG_SLOP) {
        selectAlongPath(prevX, prevY, e.clientX, e.clientY);
      }
    }
  }, { capture: true, passive: false });

  function endTouch(e) {
    if (!isTouch(e)) return;
    if (gridFingers.has(e.pointerId)) {
      gridFingers.delete(e.pointerId);
      if (gridDrag && gridDrag.pointerId === e.pointerId) {
        mouse('mouseup', gridDrag.host, e);
        gridDrag = null;
      }
      return;
    }

    if (!overviewFingers.has(e.pointerId)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    overviewFingers.delete(e.pointerId);
    blockOverviewClicksUntil = Date.now() + 650;

    if (overviewPan) stopPan();
    if (overviewGesture && overviewFingers.size === 0) {
      var g = overviewGesture;
      if (!g.cancelled && !g.dragging && g.startCell &&
          e.type === 'pointerup') {
        emitClick(g.startCell, e.clientX, e.clientY, false, false);
        var now = Date.now();
        if (lastTap && lastTap.cell === g.startCell &&
            now - lastTap.time < 350) {
          emitClick(g.startCell, e.clientX, e.clientY, false, true);
          lastTap = null;
        } else {
          lastTap = { cell: g.startCell, time: now };
        }
      } else {
        lastTap = null;
      }
      overviewGesture = null;
    }
  }

  document.addEventListener('pointerup', endTouch, {
    capture: true, passive: false
  });
  document.addEventListener('pointercancel', endTouch, {
    capture: true, passive: false
  });
  window.addEventListener('blur', function () {
    if (gridDrag) mouse('mouseup', gridDrag.host, {
      clientX: 0, clientY: 0
    });
    gridDrag = null;
    gridFingers.clear();
    stopPan();
    overviewFingers.clear();
    overviewGesture = null;
  });

  document.addEventListener('click', function (e) {
    // Suppress WebView's compatibility click after our synthetic clicks.
    // Our own MouseEvents are untrusted and must be allowed through.
    if (!e.isTrusted || Date.now() > blockOverviewClicksUntil) return;
    if (e.target && e.target.closest &&
        e.target.closest('.canvas-wrap')) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
})();
