# TripMapper

A browser-based trip route animator built with plain HTML, CSS, and JavaScript — no frameworks, no build step.

## Features (Stage 1)

- Full-screen interactive map powered by [Leaflet.js](https://leafletjs.com/)
- Clean CartoDB Positron tile layer sourced from OpenStreetMap
- Place search geocoded via the [Nominatim API](https://nominatim.openstreetmap.org/)
- Smooth fly-to animation when a result is found
- Minimal dark-themed UI

## Getting Started

No installation required. Open `index.html` directly in a browser, or serve it locally for best results (avoids CORS on local assets):

```bash
# Python 3
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## Project Structure

```
TripMapper/
├── index.html      # Entry point
├── style.css       # All styling
├── app.js          # Map logic and search
└── README.md
```

## Tech Stack

| Layer       | Choice                                                                 |
|-------------|------------------------------------------------------------------------|
| Map library | [Leaflet.js 1.9.4](https://leafletjs.com/) via CDN                    |
| Map tiles   | [CartoDB Positron](https://carto.com/basemaps/) via OpenStreetMap      |
| Geocoding   | [Nominatim](https://nominatim.openstreetmap.org/) (OpenStreetMap)      |

## Roadmap

- **Stage 2** — Add waypoints and draw animated trip routes on the map
- **Stage 3** — Timeline scrubber to control animation playback
- **Stage 4** — Export route as shareable link or image

## License

MIT
