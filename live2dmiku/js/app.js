/* =====================================================================
 *  Pipsqueak Miku — Live2D Viewer
 *  PIXI 7 + pixi-live2d-display (cubism4)
 *  Оптимизированная версия: pointer/touch, pinch-zoom, zoom-to-cursor,
 *  плавная слежка через focusController, авто-энергосбережение.
 * ===================================================================== */
(() => {
  "use strict";

  /* ------------------------------- Конфиг ------------------------------ */
  const CFG = {
    modelPath: "model/MikuPipsqueak.model3.json", // относительный путь безопаснее "/model/..."
    storeKey: "pipsqueakMiku.view.v1",
    saveDelay: 400,

    scale: { def: 0.32, min: 0.08, max: 2.0, wheel: 0.0015 },
    // позиция хранится в долях вьюпорта -> устойчива к ресайзу
    pos: { def: { x: 0.5, y: 0.78 }, minX: -0.5, maxX: 1.5, minY: -0.5, maxY: 1.5 },

    dprMax: 2,                              // ограничение retina-рендера
    fps: { active: 60, blurred: 30 },       // вне фокуса — вдвое реже
    focusStrength: 1,                       // сила слежки за курсором (0..1.5)
    volume: 0.4,                            // громкость звуков моушенов
    dragThreshold: 5                        // px, чтобы отличить тап от драга
  };

  /* ------------------------------ Утилиты ----------------------------- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const byId = (id) => document.getElementById(id);
  const randInt = (n) => (Math.random() * n) | 0;
  const noop = () => {};

  const els = {
    canvas: byId("viewer"),
    status: byId("status"),
    fps: byId("fps"),
    panel: document.querySelector(".panel")
  };

  let app = null;
  let model = null;
  let motionDefs = {};
  let motionGroups = [];
  let expressionDefs = [];

  let rect = { left: 0, top: 0, width: 1, height: 1 }; // кэш геометрии канваса
  const view = { scale: CFG.scale.def, x: CFG.pos.def.x, y: CFG.pos.def.y };

  const setStatus = (t) => { if (els.status) els.status.textContent = t; };

  /* --------------------------- Сохранение вида -------------------------- */
  let saveTimer = 0;
  const flushSave = () => {
    saveTimer = 0;
    try { localStorage.setItem(CFG.storeKey, JSON.stringify(view)); } catch { /* private mode */ }
  };
  const save = () => { if (!saveTimer) saveTimer = setTimeout(flushSave, CFG.saveDelay); };

  function restore() {
    try {
      const d = JSON.parse(localStorage.getItem(CFG.storeKey) || "null");
      if (!d) return;
      if (Number.isFinite(d.scale)) view.scale = clamp(d.scale, CFG.scale.min, CFG.scale.max);
      if (Number.isFinite(d.x)) view.x = clamp(d.x, CFG.pos.minX, CFG.pos.maxX);
      if (Number.isFinite(d.y)) view.y = clamp(d.y, CFG.pos.minY, CFG.pos.maxY);
    } catch { /* битые данные — игнор */ }
  }

  /* ------------------------------ Трансформ ---------------------------- */
  function applyTransform() {
    if (!model || !app) return;
    model.x = view.x * app.screen.width;
    model.y = view.y * app.screen.height;
    model.scale.set(view.scale);
  }

  function measure() {
    const r = els.canvas.getBoundingClientRect();
    rect = { left: r.left, top: r.top, width: r.width || 1, height: r.height || 1 };
  }

  function resetCamera() {
    view.scale = CFG.scale.def;
    view.x = CFG.pos.def.x;
    view.y = CFG.pos.def.y;
    applyTransform();
    save();
  }

  /** Масштабирование с сохранением точки под курсором. */
  function zoomAt(factor, cx, cy) {
    const s0 = view.scale;
    const s1 = clamp(s0 * factor, CFG.scale.min, CFG.scale.max);
    if (s1 === s0) return;
    const w = app.screen.width, h = app.screen.height;
    const k = s1 / s0;
    view.scale = s1;
    view.x = clamp((cx + (view.x * w - cx) * k) / w, CFG.pos.minX, CFG.pos.maxX);
    view.y = clamp((cy + (view.y * h - cy) * k) / h, CFG.pos.minY, CFG.pos.maxY);
    applyTransform();
    save();
  }

  /* ------------------------- Моушены / выражения ------------------------ */
  const PRIO = (window.PIXI?.live2d?.MotionPriority) || { NONE: 0, IDLE: 1, NORMAL: 2, FORCE: 3 };
  let lastMotion = "";

  function cacheDefinitions() {
    const mm = model.internalModel.motionManager;
    motionDefs = mm.definitions || {};
    motionGroups = Object.keys(motionDefs).filter(
      (g) => Array.isArray(motionDefs[g]) && motionDefs[g].length
    );
    expressionDefs = mm.expressionManager?.definitions || [];
  }

  function playMotion(group, index, priority = PRIO.FORCE) {
    if (!model || !motionDefs[group]) return;
    lastMotion = group + ":" + index;
    // motion() возвращает Promise -> глушим возможный reject
    Promise.resolve(model.motion(group, index, priority)).catch(noop);
  }

  function randomMotion() {
    if (!motionGroups.length) return;
    for (let attempt = 0; attempt < 6; attempt++) {
      const g = motionGroups[randInt(motionGroups.length)];
      const i = randInt(motionDefs[g].length);
      if (motionGroups.length * motionDefs[g].length === 1 || g + ":" + i !== lastMotion) {
        return playMotion(g, i);
      }
    }
  }

  function findGroup(...names) {
    const lower = motionGroups.map((g) => g.toLowerCase());
    for (const n of names) {
      const i = lower.findIndex((g) => g.includes(n));
      if (i >= 0) return motionGroups[i];
    }
    return null;
  }

  function playIdle() {
    const g = findGroup("idle");
    g ? playMotion(g, randInt(motionDefs[g].length), PRIO.IDLE) : randomMotion();
  }

  function setExpression(i) {
    if (expressionDefs.length) Promise.resolve(model.expression(i)).catch(noop);
  }

  function randomExpression() {
    if (expressionDefs.length) setExpression(randInt(expressionDefs.length));
  }

  function resetExpression() {
    const em = model?.internalModel?.motionManager?.expressionManager;
    if (typeof em?.resetExpression === "function") em.resetExpression();
  }

  /** Тап по модели: подбираем моушен по имени hit-area. */
  function handleTap(clientX, clientY) {
    const x = clientX - rect.left, y = clientY - rect.top;
    let areas = [];
    try { areas = model.hitTest?.(x, y) || []; } catch { /* нет hit-areas */ }
    if (!areas.length) return;
    const a = String(areas[0]).toLowerCase();
    const g = a.includes("head") || a.includes("face")
      ? findGroup("taphead", "tap", "head")
      : findGroup("tapbody", "tap", "body");
    g ? playMotion(g, randInt(motionDefs[g].length)) : randomMotion();
  }

  /* ------------------------------- Слежка ------------------------------ */
  // Не пишем параметры напрямую (их перезаписывает Cubism каждый кадр),
  // а задаём цель focusController — он сам плавно интерполирует.
  function focusTo(clientX, clientY) {
    const fc = model?.internalModel?.focusController;
    if (!fc) return;
    const nx = clamp(((clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
    const ny = clamp(((clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
    fc.focus(nx * CFG.focusStrength, -ny * CFG.focusStrength);
  }
  const focusCenter = () => model?.internalModel?.focusController?.focus(0, 0);

  /* ----------------------------- Ввод (мышь/тач) ----------------------- */
  const pointers = new Map();
  let drag = null;   // { id, sx, sy, mx, my }
  let pinch = null;  // { dist, scale }

  const pinchDist = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  function installPointer() {
    const c = els.canvas;

    c.addEventListener("pointerdown", (e) => {
      if (!model || (e.pointerType === "mouse" && e.button !== 0)) return;
      c.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, dx: e.clientX, dy: e.clientY, moved: false });

      if (pointers.size === 1) {
        drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, mx: model.x, my: model.y };
      } else if (pointers.size === 2) {
        drag = null;
        pinch = { dist: pinchDist() || 1, scale: view.scale };
      }
    });

    // pointermove на window: во время pointer capture события всё равно доходят сюда
    window.addEventListener("pointermove", (e) => {
      if (!model) return;

      const p = pointers.get(e.pointerId);
      if (p) {
        p.x = e.clientX; p.y = e.clientY;
        if (!p.moved && Math.hypot(e.clientX - p.dx, e.clientY - p.dy) > CFG.dragThreshold) p.moved = true;
      }

      if (pinch && pointers.size >= 2) {
        const d = pinchDist();
        const c2 = [...pointers.values()];
        const cx = (c2[0].x + c2[1].x) / 2 - rect.left;
        const cy = (c2[0].y + c2[1].y) / 2 - rect.top;
        const target = clamp((pinch.scale * d) / pinch.dist, CFG.scale.min, CFG.scale.max);
        zoomAt(target / view.scale, cx, cy);
      } else if (drag && drag.id === e.pointerId) {
        const w = app.screen.width, h = app.screen.height;
        view.x = clamp((drag.mx + (e.clientX - drag.sx)) / w, CFG.pos.minX, CFG.pos.maxX);
        view.y = clamp((drag.my + (e.clientY - drag.sy)) / h, CFG.pos.minY, CFG.pos.maxY);
        applyTransform();
        save();
      } else if (e.pointerType === "mouse") {
        focusTo(e.clientX, e.clientY);
      }
    }, { passive: true });

    const end = (e) => {
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      c.releasePointerCapture?.(e.pointerId);

      if (drag && drag.id === e.pointerId) {
        drag = null;
        if (p && !p.moved && e.type === "pointerup") handleTap(e.clientX, e.clientY);
        flushSave();
      }
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1 && model) {
        const [id, only] = [...pointers.entries()][0];
        drag = { id, sx: only.x, sy: only.y, mx: model.x, my: model.y };
      }
      if (e.pointerType !== "mouse") focusCenter();
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);

    // курсор ушёл со страницы — возвращаем голову в центр
    if (CFG.focusStrength) {
      document.addEventListener("pointerleave", focusCenter);
      window.addEventListener("blur", focusCenter);
    }

    c.addEventListener("wheel", (e) => {
      if (!model) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
      const factor = clamp(Math.exp(-e.deltaY * unit * CFG.scale.wheel), 0.75, 1.33);
      zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    c.addEventListener("dblclick", () => randomMotion());
  }

  /* ------------------------------ Клавиатура --------------------------- */
  function installKeyboard() {
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;

      const cx = app.screen.width / 2, cy = app.screen.height / 2;
      switch (e.code) {
        case "Space":      e.preventDefault(); randomMotion(); break;
        case "KeyR":       resetCamera(); break;
        case "KeyE":       randomExpression(); break;
        case "KeyQ":       resetExpression(); break;
        case "KeyI":       playIdle(); break;
        case "KeyF":       toggleFullscreen(); break;
        case "KeyH":       togglePanel(); break;
        case "Equal": case "NumpadAdd":       zoomAt(1.1, cx, cy); break;
        case "Minus": case "NumpadSubtract":  zoomAt(1 / 1.1, cx, cy); break;
      }
    });
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(noop);
    else document.documentElement.requestFullscreen?.().catch(noop);
  }

  function togglePanel() {
    if (els.panel) els.panel.style.display = els.panel.style.display === "none" ? "" : "none";
  }

  /* -------------------------------- UI --------------------------------- */
  function installButtons() {
    const map = {
      resetCamera,
      fullscreen: toggleFullscreen,
      randomExpression,
      resetExpression,
      randomMotion,
      idleMotion: playIdle
    };
    for (const id in map) byId(id)?.addEventListener("click", map[id]);
  }

  function makeGroup(title, content) {
    const d = document.createElement("details");
    d.className = "group l2d-list";
    const s = document.createElement("summary");
    s.textContent = title;
    d.append(s, content);
    return d;
  }

  /** Меню моушенов/выражений: один DocumentFragment + делегирование клика. */
  function buildMenus() {
    if (!els.panel) return;

    if (motionGroups.length) {
      const frag = document.createDocumentFragment();
      let total = 0;
      for (const g of motionGroups) {
        motionDefs[g].forEach((_, i) => {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = `🎬 ${g} ${i + 1}`;
          b.dataset.group = g;
          b.dataset.index = i;
          frag.appendChild(b);
          total++;
        });
      }
      els.panel.appendChild(makeGroup(`All motions (${total})`, frag));
    }

    if (expressionDefs.length) {
      const frag = document.createDocumentFragment();
      expressionDefs.forEach((exp, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = "😊 " + (exp?.Name || exp?.name || exp?.File || `Expression ${i + 1}`);
        b.dataset.expression = i;
        frag.appendChild(b);
      });
      els.panel.appendChild(makeGroup(`All expressions (${expressionDefs.length})`, frag));
    }

    els.panel.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.group !== undefined) playMotion(b.dataset.group, +b.dataset.index);
      else if (b.dataset.expression !== undefined) setExpression(+b.dataset.expression);
    });
  }

  /** Минимальные стили, чтобы не править index.html. */
  function injectStyles() {
    const css = `
      #viewer{touch-action:none}
      .panel{max-height:calc(100dvh - 50px);overflow-y:auto;scrollbar-width:thin}
      .l2d-list>summary{font-size:13px;opacity:.7;margin-bottom:8px;cursor:pointer;list-style:none}
      .l2d-list>summary::-webkit-details-marker{display:none}
      .l2d-list>summary::before{content:"▸ "}
      .l2d-list[open]>summary::before{content:"▾ "}
      #fps{font-variant-numeric:tabular-nums}`;
    const s = document.createElement("style");
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ---------------------------- FPS + питание -------------------------- */
  function startFPS() {
    if (!els.fps) return;
    let frames = 0, last = performance.now(), shown = -1;
    app.ticker.add(() => {
      frames++;
      const now = performance.now();
      if (now - last >= 500) {
        const fps = Math.round((frames * 1000) / (now - last));
        if (fps !== shown) { els.fps.textContent = "FPS " + fps; shown = fps; }
        frames = 0; last = now;
      }
    }, null, PIXI.UPDATE_PRIORITY?.LOW ?? -25);
  }

  let visible = !document.hidden, focused = document.hasFocus(), onScreen = true;

  function updatePower() {
    if (!app) return;
    const t = app.ticker;
    if (!visible || !onScreen) {                 // вкладка скрыта / канвас вне экрана
      if (t.started) t.stop();
      if (els.fps) els.fps.textContent = "PAUSED";
      return;
    }
    if (!t.started) t.start();
    t.maxFPS = focused ? CFG.fps.active : CFG.fps.blurred;
  }

  function installPower() {
    document.addEventListener("visibilitychange", () => { visible = !document.hidden; updatePower(); });
    window.addEventListener("focus", () => { focused = true; updatePower(); });
    window.addEventListener("blur", () => { focused = false; updatePower(); });

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; updatePower(); })
        .observe(els.canvas);
    }
    updatePower();
  }

  /* ------------------------------- Ресайз ------------------------------ */
  function installResize() {
    let raf = 0;
    const onResize = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
        // актуализируем resolution, если экран/зум поменялся
        const dpr = Math.min(window.devicePixelRatio || 1, CFG.dprMax);
        if (app.renderer.resolution !== dpr) {
          app.renderer.resolution = dpr;
          app.renderer.resize(app.screen.width, app.screen.height);
        }
        applyTransform();
      });
    };
    addEventListener("resize", onResize, { passive: true });
    addEventListener("orientationchange", onResize, { passive: true });
    addEventListener("scroll", measure, { passive: true });
    document.addEventListener("fullscreenchange", onResize);
    addEventListener("pagehide", flushSave);
  }

  /* --------------------------- Потеря контекста ------------------------ */
  function installContextGuard() {
    els.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      setStatus("⚠️ WebGL context lost — restoring…");
    });
    els.canvas.addEventListener("webglcontextrestored", () => location.reload());
  }

  /* --------------------------------- Init ------------------------------ */
  async function init() {
    if (!els.canvas) return console.error("[L2D] #viewer canvas not found");
    if (!window.PIXI?.live2d) return setStatus("❌ pixi-live2d-display not loaded");
    if (!window.Live2DCubismCore) return setStatus("❌ Live2D Cubism Core not loaded");

    injectStyles();
    restore();

    app = new PIXI.Application({
      view: els.canvas,
      resizeTo: window,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, CFG.dprMax),
      backgroundAlpha: 0,
      powerPreference: "high-performance"
    });

    // весь ввод обрабатываем сами -> отключаем hit-testing PIXI (экономит кадр)
    app.stage.eventMode = "none";
    app.stage.interactiveChildren = false;

    PIXI.live2d.Live2DModel.registerTicker?.(PIXI.Ticker);
    if (PIXI.live2d.SoundManager) PIXI.live2d.SoundManager.volume = CFG.volume;

    measure();
    setStatus("Loading model…");

    try {
      model = await PIXI.live2d.Live2DModel.from(CFG.modelPath, {
        autoInteract: false, // своя обработка курсора/тапов
        autoUpdate: true
      });
    } catch (err) {
      console.error("[L2D]", err);
      setStatus("❌ Failed to load model. Проверь путь: " + CFG.modelPath);
      return;
    }

    model.anchor.set(0.5, 0.5);
    app.stage.addChild(model);
    applyTransform();

    cacheDefinitions();
    buildMenus();
    installButtons();
    installPointer();
    installKeyboard();
    installResize();
    installContextGuard();
    installPower();
    startFPS();
    playIdle();

    setStatus(
      `✅ Model loaded — ${motionGroups.length} motion group(s), ${expressionDefs.length} expression(s)`
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();