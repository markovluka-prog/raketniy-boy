/* touch.js — сенсорное управление для iPad/планшетов (общий для всех страниц).
 * Включается ТОЛЬКО при matchMedia('(pointer: coarse)'); на десктопе ничего не делает.
 * Игры не меняются: касания превращаются в обычные KeyboardEvent (e.code),
 * поэтому вся логика клавиатуры (в т.ч. «по ребру» нажатия) работает как есть.
 * Глобальные let/const игр (gameState, twoPlayerMode, player, startGame...) видны
 * из этого скрипта по имени, т.к. классические скрипты делят одно глобальное окружение.
 */
(function () {
  'use strict';
  if (!window.matchMedia || !window.matchMedia('(pointer: coarse)').matches) return;

  var doc = document;
  var canvas = doc.getElementById('game');
  var isRocket = !!doc.getElementById('play2pBtn');       // raketniy-boy.html
  var isTanks = !!doc.getElementById('controlHint');      // tanks.html
  var isGame = !!canvas && (isRocket || isTanks);

  // ---------- Общие настройки: без зума, выделения, bounce, long-press ----------
  var css = [
    'html,body{touch-action:none;overscroll-behavior:none;-webkit-user-select:none;user-select:none;',
    '-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;}',
    'html{position:fixed;inset:0;width:100%;height:100%;}',
    'body{position:fixed;inset:0;width:100%;height:100%;overflow:hidden;}',
    'img,a,canvas{-webkit-user-drag:none;-webkit-touch-callout:none;}',
    'button,a{touch-action:manipulation;}'
  ];
  if (isGame) {
    // Масштаб холста под экран с сохранением пропорций (tanks имеет мин. ширину 1000px).
    css.push('#game{position:fixed;left:0;top:0;width:100%;height:100%;object-fit:contain;}');
    // HUD и подсказки — с учётом safe-area
    css.push('#hud{top:calc(14px + env(safe-area-inset-top)) !important;left:calc(14px + env(safe-area-inset-left)) !important;}');
    css.push('#menu,#winScreen,#loseScreen,#endScreen{padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);overflow-y:auto;}');
    css.push('#controlHint{display:none !important;}');
    css.push([
      '.tc-btn{position:fixed;z-index:8;display:flex;align-items:center;justify-content:center;',
      'font:700 15px "Courier New",monospace;letter-spacing:1px;color:#e8fbff;text-align:center;',
      'background:rgba(20,40,60,.45);border:2px solid rgba(155,231,255,.6);border-radius:50%;',
      'box-shadow:0 0 16px rgba(42,212,255,.3);-webkit-user-select:none;user-select:none;touch-action:none;}',
      '.tc-btn.on{background:rgba(42,212,255,.45);box-shadow:0 0 28px rgba(42,212,255,.8);}',
      '.tc-btn.red{border-color:rgba(255,130,110,.7);box-shadow:0 0 16px rgba(255,94,94,.3);}',
      '.tc-btn.red.on{background:rgba(255,94,94,.45);box-shadow:0 0 28px rgba(255,94,94,.8);}',
      '.tc-btn.dim{opacity:.35;}',
      '#tcLayer{position:fixed;inset:0;z-index:4;touch-action:none;}',
      '#tcPause{width:54px;height:54px;font-size:22px;border-radius:14px;',
      'top:calc(10px + env(safe-area-inset-top));right:calc(10px + env(safe-area-inset-right));}',
      '#tcPanel{position:fixed;inset:0;z-index:30;display:none;flex-direction:column;align-items:center;',
      'justify-content:center;gap:14px;background:rgba(5,1,10,.82);font-family:"Courier New",monospace;}',
      '#tcPanel.show{display:flex;}',
      '#tcPanel h2{color:#9be7ff;letter-spacing:6px;margin:0 0 8px;text-shadow:0 0 14px #2ad4ff;}',
      '#tcPanel button,#tcPanel a{min-width:240px;padding:14px 20px;font:16px "Courier New",monospace;',
      'letter-spacing:2px;text-align:center;text-decoration:none;color:#9be7ff;background:transparent;',
      'border:1px solid rgba(107,214,255,.6);border-radius:10px;}',
      '#tcPanel button.main{color:#05010a;background:linear-gradient(180deg,#9be7ff,#2ad4ff);border:none;}'
    ].join(''));
  }
  var style = doc.createElement('style');
  style.textContent = css.join('');
  doc.head.appendChild(style);

  // Запрет pinch/double-tap зума и прокрутки (iOS Safari игнорирует часть viewport-ограничений)
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (n) {
    doc.addEventListener(n, function (e) { e.preventDefault(); }, { passive: false });
  });
  doc.addEventListener('touchmove', function (e) {
    if (e.touches && e.touches.length > 1) { e.preventDefault(); return; }
    var t = e.target;
    if (!(t && t.closest && t.closest('#menu,#winScreen,#loseScreen,#endScreen'))) e.preventDefault();
  }, { passive: false });
  doc.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  var lastEnd = 0;
  doc.addEventListener('touchend', function (e) {
    var n = Date.now();
    if (n - lastEnd < 350 && !(e.target.closest && e.target.closest('button,a'))) e.preventDefault();
    lastEnd = n;
  }, { passive: false });

  // ---------- Звук: iOS требует разблокировки по первому касанию ----------
  var audioCtxs = [];
  var NativeAC = window.AudioContext || window.webkitAudioContext;
  if (NativeAC) {
    var Patched = function () {
      var c = new (Function.prototype.bind.apply(NativeAC, [null].concat([].slice.call(arguments))))();
      audioCtxs.push(c);
      return c;
    };
    Patched.prototype = NativeAC.prototype;
    try { window.AudioContext = Patched; window.webkitAudioContext = Patched; } catch (e) {}
  }
  var audioUnlocked = false;
  function unlockAudio() {
    audioCtxs.forEach(function (c) {
      if (c.state === 'suspended') { try { c.resume(); } catch (e) {} }
    });
    if (!audioUnlocked && NativeAC) {
      try {
        var c = new NativeAC();
        var b = c.createBuffer(1, 1, 22050), s = c.createBufferSource();
        s.buffer = b; s.connect(c.destination); s.start(0);
        if (c.resume) c.resume();
        audioCtxs.push(c);
        audioUnlocked = true;
      } catch (e) {}
    }
    doc.querySelectorAll('audio,video').forEach(function (m) {
      if (m.paused && m.dataset.tcWanted) { try { m.play(); } catch (e) {} }
    });
  }
  ['touchstart', 'touchend', 'pointerdown', 'click'].forEach(function (n) {
    doc.addEventListener(n, unlockAudio, { passive: true });
  });
  window.__unlockAudio = unlockAudio;

  if (!isGame) return;

  // ---------- Виртуальные клавиши ----------
  var held = {}; // code -> количество удерживающих касаний
  function keyDown(code) {
    held[code] = (held[code] || 0) + 1;
    if (held[code] === 1) window.dispatchEvent(new KeyboardEvent('keydown', { code: code, key: code, bubbles: true, cancelable: true }));
  }
  function keyUp(code) {
    if (!held[code]) return;
    held[code]--;
    if (held[code] === 0) window.dispatchEvent(new KeyboardEvent('keyup', { code: code, key: code, bubbles: true, cancelable: true }));
  }
  function releaseAll() {
    Object.keys(held).forEach(function (code) {
      if (held[code] > 0) {
        held[code] = 0;
        window.dispatchEvent(new KeyboardEvent('keyup', { code: code, key: code, bubbles: true, cancelable: true }));
      }
    });
  }

  function state() { return typeof gameState !== 'undefined' ? gameState : 'menu'; }
  function twoP() { return isRocket && typeof twoPlayerMode !== 'undefined' && twoPlayerMode; }

  function mk(tag, cls, text, parent) {
    var el = doc.createElement(tag);
    if (cls) el.className = cls;
    if (text) el.textContent = text;
    (parent || doc.body).appendChild(el);
    return el;
  }

  // Привязка элемента к клавише: мультитач, удержание
  function bindHold(el, codeFn, zoneFn) {
    var active = {}; // pointerId -> code
    function down(e) {
      e.preventDefault();
      if (state() !== 'playing') return;
      var code = zoneFn ? zoneFn(e) : codeFn();
      if (!code) return;
      active[e.pointerId] = code;
      try { el.setPointerCapture(e.pointerId); } catch (x) {}
      keyDown(code);
      refresh();
    }
    function up(e) {
      var code = active[e.pointerId];
      if (!code) return;
      delete active[e.pointerId];
      keyUp(code);
      refresh();
    }
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    return active;
  }
  function bindTap(el, code) {
    el.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (state() !== 'playing') return;
      el.classList.add('on');
      window.dispatchEvent(new KeyboardEvent('keydown', { code: code, key: code, bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: code, key: code, bubbles: true, cancelable: true }));
    });
    function off() { el.classList.remove('on'); }
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
  }

  var pauseBtn = mk('div', 'tc-btn', '❚❚');
  pauseBtn.id = 'tcPause';
  var panel = mk('div');
  panel.id = 'tcPanel';
  var layer, b1, b2, bMine;
  var layerHold;

  if (isRocket) {
    layer = mk('div'); layer.id = 'tcLayer';
    b1 = mk('div', 'tc-btn', 'ТЯГА');
    b2 = mk('div', 'tc-btn red', 'ТЯГА');
    [b1, b2].forEach(function (b) { b.style.pointerEvents = 'none'; b.style.width = b.style.height = '110px'; b.style.bottom = 'calc(24px + env(safe-area-inset-bottom))'; });
    // Одиночный режим — тянет любое касание; 2 игрока — левая половина (синий), правая (красный)
    layerHold = bindHold(layer, null, function (e) {
      if (!twoP()) return 'Space';
      return e.clientX < window.innerWidth / 2 ? 'Space' : 'ArrowUp';
    });
    // Меню: подсказка управления
    var hint = doc.getElementById('menuHint');
    if (hint) hint.textContent = 'iPad: удерживай экран — тяга. 2 игрока: левая половина — синий, правая — красный';
  } else {
    // Танки: танк крутится сам, управление — «Вперёд + ракета» и «Мина»
    layer = null;
    b1 = mk('div', 'tc-btn', 'ОГОНЬ');
    b1.style.width = b1.style.height = '150px';
    b1.style.right = 'calc(30px + env(safe-area-inset-right))';
    b1.style.bottom = 'calc(30px + env(safe-area-inset-bottom))';
    b1.style.fontSize = '20px';
    bindHold(b1, function () { return 'Space'; });
    bMine = mk('div', 'tc-btn', 'МИНА');
    bMine.style.width = bMine.style.height = '100px';
    bMine.style.left = 'calc(30px + env(safe-area-inset-left))';
    bMine.style.bottom = 'calc(30px + env(safe-area-inset-bottom))';
    bindTap(bMine, 'KeyM');
    var hint2 = doc.getElementById('menuHint');
    if (hint2) hint2.textContent = 'iPad: танк крутится сам. ОГОНЬ (удерживай) — вперёд и ракета, МИНА — поставить мину';
  }

  function placeRocketButtons() {
    if (twoP()) {
      b1.style.left = 'calc(24px + env(safe-area-inset-left))'; b1.style.right = '';
      b2.style.right = 'calc(24px + env(safe-area-inset-right))'; b2.style.left = '';
      b1.textContent = 'СИНИЙ'; b2.textContent = 'КРАСНЫЙ';
      b2.style.display = '';
    } else {
      b1.style.left = '50%'; b1.style.right = ''; b1.style.marginLeft = '-55px';
      b1.textContent = 'ТЯГА';
      b2.style.display = 'none';
    }
  }

  function refresh() {
    var playing = state() === 'playing';
    pauseBtn.style.display = (playing || state() === 'paused') ? 'flex' : 'none';
    if (isRocket) {
      layer.style.display = playing ? 'block' : 'none';
      var show = playing || state() === 'paused';
      b1.style.display = show ? 'flex' : 'none';
      placeRocketButtons();
      if (!show) b2.style.display = 'none';
      b1.classList.toggle('on', !!held['Space']);
      b2.classList.toggle('on', !!held['ArrowUp']);
    } else {
      var shown = playing || state() === 'paused';
      b1.style.display = bMine.style.display = shown ? 'flex' : 'none';
      b1.classList.toggle('on', !!held['Space']);
      var hasMines = typeof player !== 'undefined' && player.mines > 0;
      bMine.classList.toggle('dim', !hasMines);
    }
  }
  setInterval(refresh, 120);
  refresh();

  // ---------- Пауза ----------
  var prevState = 'playing';
  function pauseGame() {
    if (state() !== 'playing') return;
    releaseAll();
    prevState = 'playing';
    gameState = 'paused';
    showPanel();
    refresh();
  }
  function resumeGame() {
    if (state() === 'paused') gameState = prevState;
    panel.classList.remove('show');
    refresh();
  }
  function restartGame() {
    releaseAll();
    panel.classList.remove('show');
    if (state() === 'paused') gameState = 'playing';
    if (isRocket) startGame(twoPlayerMode); else startGame();
    refresh();
  }
  function toMenu() {
    releaseAll();
    panel.classList.remove('show');
    gameState = 'playing'; // чтобы backToGameMenu отработал штатно
    backToGameMenu();
    refresh();
  }
  function showPanel() {
    panel.innerHTML = '';
    mk('h2', '', 'ПАУЗА', panel);
    var r = mk('button', 'main', 'ПРОДОЛЖИТЬ', panel);
    var n = mk('button', '', 'ЗАНОВО', panel);
    var m = mk('button', '', 'В МЕНЮ ИГРЫ', panel);
    var a = mk('a', '', '← МЕНЮ АРКАД', panel);
    a.href = 'index.html';
    r.addEventListener('click', resumeGame);
    n.addEventListener('click', restartGame);
    m.addEventListener('click', toMenu);
    panel.classList.add('show');
  }
  pauseBtn.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (state() === 'playing') pauseGame();
  });

  // Автопауза при сворачивании / переключении вкладки / блокировке экрана
  doc.addEventListener('visibilitychange', function () { if (doc.hidden) pauseGame(); });
  window.addEventListener('pagehide', pauseGame);
  window.addEventListener('blur', pauseGame);
  window.addEventListener('orientationchange', function () { setTimeout(refresh, 300); });
})();
