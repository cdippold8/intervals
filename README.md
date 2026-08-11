# Intervals

A retro, dark-mode-only interval run timer for your phone, styled like an old-school clock radio. No build step, no framework — just static HTML/CSS/JS.

## Running it

Serve the folder with any static file server (the app fetches its audio cues, which most browsers block over `file://`):

```
python3 -m http.server 8000
```

Then open `http://localhost:8000` on your phone and add it to your home screen for an app-like feel.

## How it works

- **New Run (setup)** — set a warm up (min), a cool down (min), and your interval as "every X min, for X min" (the fast portion; the remainder of each lap is the slow portion). `CLEAR` wipes all four values. `START` is disabled until a valid interval is set. Your last setup is remembered between visits.
- **On Air (run)** — warm up, then fast/slow laps repeat indefinitely, each shown with its own count-up clock, color-coded (amber warm up, red fast, green slow, blue cool down), plus a running total time and fast/slow lap tally. `STOP` moves straight into the cool down; pressing it again (or once cool down finishes) ends the run.
- **Done** — total run time and the final fast/slow lap counts, with a button to start another run.

10 seconds before every phase change, a short retro tone (and a vibration, where supported) plays as a heads-up. When a phase actually starts, its matching cue plays: `assets/audio/warmup.mp3`, `fast-interval.mp3`, `slow-interval.mp3`, or `cooldown.mp3`.

All audio (cues and warning tones) plays through the Web Audio API rather than an `<audio>`/`<video>` element, so it mixes with — instead of pausing or ducking — whatever else is playing on your phone, like Spotify.

Everything runs client-side; no data leaves your browser. The screen is kept awake during a run where the Wake Lock API is supported.
