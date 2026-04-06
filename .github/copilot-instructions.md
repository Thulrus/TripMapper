# TripMapper — Copilot Instructions

## Project Overview

TripMapper is a browser-based trip route animator. It is built with **plain HTML, CSS, and JavaScript only** — no frameworks, no transpilers, no build step. All source lives in a single flat folder.

## Stack

- **Leaflet.js** (loaded via CDN) for the interactive map
- **CartoDB Positron** tile layer for clean map visuals
- **Nominatim API** (`https://nominatim.openstreetmap.org/search`) for geocoding
- **GraphHopper Directions API** (`https://graphhopper.com/api/1/route`) for driving routes (GET with `point=lat,lng` repeated query params, `profile=car`, `type=json`, `points_encoded=false`); response shape: `paths[0].points.coordinates` ([lng,lat] pairs), `paths[0].distance` (meters), `paths[0].time` (milliseconds); requires a free API key set in `const GRAPHHOPPER_KEY` at the top of `app.js`; get one at https://graphhopper.com/dashboard/ (500 req/day, no credit card required)
- No npm, no bundlers, no TypeScript

## Conventions

- Keep all logic in `app.js`; keep all styling in `style.css`
- Use `const`/`let`, async/await, and modern DOM APIs — no jQuery or polyfills
- Dark-themed UI: controls overlay the map, map tiles are light (Positron) for contrast
- `encodeURIComponent` must be used on all user-supplied search queries before URL construction
- Do not add third-party libraries without explicit user approval
