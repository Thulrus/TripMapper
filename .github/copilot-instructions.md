# TripMapper — Copilot Instructions

## Project Overview

TripMapper is a browser-based trip route animator. It is built with **plain HTML, CSS, and JavaScript only** — no frameworks, no transpilers, no build step. All source lives in a single flat folder.

## Stack

- **Leaflet.js** (loaded via CDN) for the interactive map
- **CartoDB Positron** tile layer for clean map visuals
- **Nominatim API** (`https://nominatim.openstreetmap.org/search`) for geocoding
- No npm, no bundlers, no TypeScript

## Conventions

- Keep all logic in `app.js`; keep all styling in `style.css`
- Use `const`/`let`, async/await, and modern DOM APIs — no jQuery or polyfills
- Dark-themed UI: controls overlay the map, map tiles are light (Positron) for contrast
- `encodeURIComponent` must be used on all user-supplied search queries before URL construction
- Do not add third-party libraries without explicit user approval

## Current Stage: 1

Stage 1 is complete:
- Full-screen Leaflet map defaulting to the continental US
- Search bar (top-left) geocoding via Nominatim, flies map to the result

## Upcoming Stages

- Stage 2: Waypoint management and animated route drawing
- Stage 3: Playback timeline scrubber
- Stage 4: Export / share functionality
