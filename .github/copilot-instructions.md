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

## Current Stage: 2

Stage 2 is complete (builds on Stage 1):
- Click the map to place up to 26 lettered waypoints (A–Z)
- Right sidebar lists waypoints with reverse-geocoded names; individual remove + clear-all
- 2+ waypoints fetch a driving route via OSRM (`router.project-osrm.org`) and draw a blue polyline
- Route stats (distance in mi/km and estimated drive time) shown at the bottom of the sidebar

## Upcoming Stages

- Stage 3: Playback timeline scrubber
- Stage 4: Export / share functionality
