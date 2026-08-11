(function () {
  "use strict";

  var STORAGE_KEY = "intervalRun.setup.v2";

  var PHASE_LABEL = {
    warmup: "WARM UP",
    fast: "FAST INTERVAL",
    slow: "SLOW INTERVAL",
    cooldown: "COOL DOWN",
  };

  var PHASE_CLASS = {
    warmup: "phase-warmup",
    fast: "phase-fast",
    slow: "phase-slow",
    cooldown: "phase-cooldown",
  };

  // Each phase has a pool of clips — one is picked at random every time
  // that phase starts, so a run doesn't sound identical lap to lap.
  var PHASE_AUDIO = {
    warmup: ["assets/audio/warmup.mp3", "assets/audio/warmup-2.mp3", "assets/audio/warmup-3.mp3"],
    fast: ["assets/audio/fast-interval.mp3", "assets/audio/fast-interval-2.mp3", "assets/audio/fast-interval-3.mp3"],
    slow: ["assets/audio/slow-interval.mp3", "assets/audio/slow-interval-2.mp3", "assets/audio/slow-interval-3.mp3"],
    cooldown: ["assets/audio/cooldown.mp3", "assets/audio/cooldown-2.mp3", "assets/audio/cooldown-3.mp3"],
  };

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  var WARNING_LEAD_SEC = 10;

  var screens = {
    setup: document.getElementById("screen-setup"),
    run: document.getElementById("screen-run"),
    done: document.getElementById("screen-done"),
  };

  function showScreen(name) {
    Object.keys(screens).forEach(function (key) {
      screens[key].classList.toggle("active", key === name);
    });
  }

  // ---------- Setup screen ----------

  var warmupInput = document.getElementById("warmupMin");
  var everyInput = document.getElementById("everyMin");
  var forInput = document.getElementById("forMin");
  var cooldownInput = document.getElementById("cooldownMin");
  var intervalHint = document.getElementById("intervalHint");
  var startBtn = document.getElementById("startBtn");
  var clearBtn = document.getElementById("clearBtn");

  function formatMin(m) {
    var rounded = Math.round(m * 100) / 100;
    return rounded + " min";
  }

  function computeConfig() {
    var warmupMin = parseFloat(warmupInput.value);
    if (isNaN(warmupMin) || warmupMin < 0) warmupMin = 0;

    var cooldownMin = parseFloat(cooldownInput.value);
    if (isNaN(cooldownMin) || cooldownMin < 0) cooldownMin = 0;

    // "Every X min" = the length of each fast segment AND each slow segment.
    // "For X min" = the total time to keep alternating fast/slow before cool down.
    var everyMin = parseFloat(everyInput.value);
    var forMin = parseFloat(forInput.value);
    var valid = !isNaN(everyMin) && everyMin > 0 && !isNaN(forMin) && forMin > 0;

    return {
      valid: valid,
      warmupMin: warmupMin,
      warmupSec: Math.round(warmupMin * 60),
      everyMin: valid ? everyMin : 0,
      everySec: valid ? Math.round(everyMin * 60) : 0,
      forMin: valid ? forMin : 0,
      forSec: valid ? Math.round(forMin * 60) : 0,
      cooldownMin: cooldownMin,
      cooldownSec: Math.round(cooldownMin * 60),
    };
  }

  // Simulates the fast/slow alternation (starting with fast) to report how
  // many laps of each a given setup will produce — mirrors the run loop's
  // own stopping rule so the setup screen's preview always matches the run.
  function estimateLaps(cfg) {
    var cumulative = 0;
    var fastLaps = 0;
    var slowLaps = 0;
    var isFast = true;
    while (cumulative < cfg.forSec) {
      cumulative += cfg.everySec;
      if (isFast) fastLaps++;
      else slowLaps++;
      isFast = !isFast;
    }
    return { fastLaps: fastLaps, slowLaps: slowLaps, totalSec: cumulative };
  }

  function refreshSetupUI() {
    var cfg = computeConfig();
    startBtn.disabled = !cfg.valid;

    if (!cfg.valid) {
      intervalHint.textContent = "Set your interval length & total time";
    } else {
      var laps = estimateLaps(cfg);
      intervalHint.textContent =
        "Fast " + formatMin(cfg.everyMin) + " / Slow " + formatMin(cfg.everyMin) +
        " — " + laps.fastLaps + " fast + " + laps.slowLaps + " slow (" + formatClock(laps.totalSec) + " total)";
    }

    saveSetup();
  }

  function saveSetup() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          warmupMin: warmupInput.value,
          everyMin: everyInput.value,
          forMin: forInput.value,
          cooldownMin: cooldownInput.value,
        })
      );
    } catch (e) {
      /* ignore */
    }
  }

  function loadSetup() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (!parsed) return;
      warmupInput.value = parsed.warmupMin || "";
      everyInput.value = parsed.everyMin || "";
      forInput.value = parsed.forMin || "";
      cooldownInput.value = parsed.cooldownMin || "";
    } catch (e) {
      /* ignore */
    }
  }

  [warmupInput, everyInput, forInput, cooldownInput].forEach(function (input) {
    input.addEventListener("input", refreshSetupUI);
  });

  clearBtn.addEventListener("click", function () {
    warmupInput.value = "";
    everyInput.value = "";
    forInput.value = "";
    cooldownInput.value = "";
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* ignore */
    }
    refreshSetupUI();
  });

  // ---------- Time formatting ----------

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function formatClock(totalSeconds) {
    totalSeconds = Math.max(0, Math.floor(totalSeconds));
    var h = Math.floor(totalSeconds / 3600);
    var m = Math.floor((totalSeconds % 3600) / 60);
    var s = totalSeconds % 60;
    if (h > 0) return h + ":" + pad(m) + ":" + pad(s);
    return pad(m) + ":" + pad(s);
  }

  // ---------- Run state machine ----------

  var totalClock = document.getElementById("totalClock");
  var phaseLabel = document.getElementById("phaseLabel");
  var phaseClock = document.getElementById("phaseClock");
  var getReady = document.getElementById("getReady");
  var runDisplay = document.getElementById("runDisplay");
  var fastTallyRun = document.getElementById("fastTallyRun");
  var slowTallyRun = document.getElementById("slowTallyRun");
  var stopBtn = document.getElementById("stopBtn");

  var runState = null;
  var tickHandle = null;
  var wakeLock = null;

  function durationFor(type, cfg) {
    if (type === "warmup") return cfg.warmupSec;
    if (type === "fast" || type === "slow") return cfg.everySec;
    if (type === "cooldown") return cfg.cooldownSec;
    return 0;
  }

  function startRun() {
    var cfg = computeConfig();
    if (!cfg.valid) return;

    preloadAudio();

    var initialPhase = cfg.warmupSec > 0 ? "warmup" : "fast";
    runState = {
      cfg: cfg,
      phase: initialPhase,
      phaseElapsed: 0,
      phaseDuration: durationFor(initialPhase, cfg),
      totalElapsed: 0,
      intervalElapsed: 0, // time spent in fast/slow laps so far, vs. cfg.forSec target
      fastCount: 0,
      slowCount: 0,
      warned: false,
    };

    requestWakeLock();
    showScreen("run");
    updatePhaseUI();
    updateTallyUI();
    playPhaseAudio(initialPhase);
    startTicking();
  }

  function startTicking() {
    stopTicking();
    var last = Date.now();
    tickHandle = setInterval(function () {
      var now = Date.now();
      var delta = (now - last) / 1000;
      last = now;
      tick(delta);
    }, 200);
  }

  function stopTicking() {
    if (tickHandle) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
  }

  function tick(delta) {
    if (!runState) return;

    runState.phaseElapsed += delta;
    runState.totalElapsed += delta;

    var remaining = runState.phaseDuration - runState.phaseElapsed;

    if (
      runState.phaseDuration > 0 &&
      !runState.warned &&
      remaining <= WARNING_LEAD_SEC
    ) {
      runState.warned = true;
      playWarningTone();
      getReady.classList.add("show");
    }

    if (runState.phaseDuration > 0 && runState.phaseElapsed >= runState.phaseDuration) {
      completePhase();
      return;
    }

    updateClocks();
  }

  function completePhase() {
    var finished = runState.phase;

    if (finished === "cooldown") {
      finishRun();
      return;
    }

    if (finished === "warmup") {
      transitionTo("fast");
      return;
    }

    // finished a fast or slow lap
    if (finished === "fast") runState.fastCount++;
    if (finished === "slow") runState.slowCount++;
    runState.intervalElapsed += runState.phaseDuration;

    if (runState.intervalElapsed >= runState.cfg.forSec) {
      // hit the configured total interval time — move on to cool down
      if (runState.cfg.cooldownSec > 0) {
        transitionTo("cooldown");
      } else {
        finishRun();
      }
      return;
    }

    transitionTo(finished === "fast" ? "slow" : "fast");
  }

  function transitionTo(type) {
    runState.phase = type;
    runState.phaseElapsed = 0;
    runState.phaseDuration = durationFor(type, runState.cfg);
    runState.warned = false;
    getReady.classList.remove("show");

    updatePhaseUI();
    updateTallyUI();
    playPhaseAudio(type);

    if (runState.phaseDuration <= 0) {
      // zero-length phase (e.g. no cool down) — resolve immediately
      completePhase();
    }
  }

  function updatePhaseUI() {
    phaseLabel.textContent = PHASE_LABEL[runState.phase];
    runDisplay.className = "run-display " + PHASE_CLASS[runState.phase];
    updateClocks();
  }

  function updateClocks() {
    phaseClock.textContent = formatClock(runState.phaseElapsed);
    totalClock.textContent = formatClock(runState.totalElapsed);
  }

  function updateTallyUI() {
    fastTallyRun.textContent = String(runState.fastCount);
    slowTallyRun.textContent = String(runState.slowCount);
  }

  function handleStop() {
    if (!runState) return;

    if (runState.phase === "cooldown") {
      finishRun();
      return;
    }

    if (runState.cfg.cooldownSec > 0) {
      transitionTo("cooldown");
    } else {
      finishRun();
    }
  }

  function finishRun() {
    stopTicking();
    releaseWakeLock();

    var summary = {
      total: runState.totalElapsed,
      fast: runState.fastCount,
      slow: runState.slowCount,
    };
    runState = null;

    playDoneFanfare();
    renderDone(summary);
    showScreen("done");
  }

  stopBtn.addEventListener("click", handleStop);
  startBtn.addEventListener("click", startRun);

  // ---------- Done screen ----------

  var doneTotalClock = document.getElementById("doneTotalClock");
  var doneFastCount = document.getElementById("doneFastCount");
  var doneSlowCount = document.getElementById("doneSlowCount");
  var newRunBtn = document.getElementById("newRunBtn");
  var newBtnTop = document.getElementById("newBtnTop");

  function renderDone(summary) {
    doneTotalClock.textContent = formatClock(summary.total);
    doneFastCount.textContent = String(summary.fast);
    doneSlowCount.textContent = String(summary.slow);
  }

  function goToNewRun() {
    showScreen("setup");
    refreshSetupUI();
  }

  newRunBtn.addEventListener("click", goToNewRun);
  newBtnTop.addEventListener("click", goToNewRun);

  // ---------- Audio ----------
  // All cues play through the Web Audio API (never an <audio>/<video> element)
  // so they mix with — rather than pause or duck — any other app's audio
  // (e.g. Spotify) on iOS and Android.

  var audioCtx = null;
  var audioBufferCache = {};

  function getAudioContext() {
    if (!audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    return audioCtx;
  }

  function loadBuffer(url) {
    var ctx = getAudioContext();
    if (!ctx) return Promise.resolve(null);
    if (audioBufferCache[url]) return audioBufferCache[url];

    var promise = fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error("fetch failed: " + url);
        return res.arrayBuffer();
      })
      .then(function (arrayBuffer) {
        return ctx.decodeAudioData(arrayBuffer);
      })
      .catch(function (err) {
        console.warn("Could not load audio cue", url, err);
        return null;
      });

    audioBufferCache[url] = promise;
    return promise;
  }

  function preloadAudio() {
    Object.keys(PHASE_AUDIO).forEach(function (key) {
      PHASE_AUDIO[key].forEach(function (url) {
        loadBuffer(url);
      });
    });
  }

  function playBuffer(buffer, volume) {
    var ctx = getAudioContext();
    if (!ctx || !buffer) return;
    var source = ctx.createBufferSource();
    source.buffer = buffer;
    var gain = ctx.createGain();
    gain.gain.value = volume != null ? volume : 0.9;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(0);
  }

  function playPhaseAudio(type) {
    var ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    var pool = PHASE_AUDIO[type];
    if (!pool || !pool.length) return;
    var url = pickRandom(pool);
    loadBuffer(url).then(function (buffer) {
      playBuffer(buffer, 0.9);
    });
    if (navigator.vibrate) navigator.vibrate([100, 60, 100]);
  }

  function beep(freq, durationMs, delayMs, type) {
    var ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    var startTime = ctx.currentTime + (delayMs || 0) / 1000;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || "square";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.25, startTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationMs / 1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + durationMs / 1000 + 0.05);
  }

  function playWarningTone() {
    try {
      beep(1046, 90, 0);
      beep(1046, 90, 160);
      beep(1046, 90, 320);
      if (navigator.vibrate) navigator.vibrate([60, 40, 60, 40, 60]);
    } catch (e) {
      /* ignore */
    }
  }

  function playDoneFanfare() {
    try {
      beep(784, 130, 0);
      beep(988, 130, 150);
      beep(1175, 130, 300);
      beep(1568, 260, 460);
      if (navigator.vibrate) navigator.vibrate([120, 80, 120, 80, 220]);
    } catch (e) {
      /* ignore */
    }
  }

  // ---------- Wake Lock ----------

  function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    navigator.wakeLock
      .request("screen")
      .then(function (lock) {
        wakeLock = lock;
      })
      .catch(function () {
        /* ignore — not critical */
      });
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(function () {});
      wakeLock = null;
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && runState) {
      requestWakeLock();
    }
  });

  // ---------- Init ----------

  loadSetup();
  refreshSetupUI();
  preloadAudio();
  showScreen("setup");
})();
