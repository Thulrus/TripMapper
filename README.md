# TripMapper

A browser-based trip route animator built with plain HTML, CSS, and JavaScript — no frameworks, no build step.

Live at: https://thulrus.github.io/TripMapper/

## Features

- Full-screen interactive map powered by [Leaflet.js](https://leafletjs.com/)
- Place search geocoded via [Nominatim](https://nominatim.openstreetmap.org/)
- Add, label, reorder, and remove waypoints
- Driving route calculation via [GraphHopper](https://graphhopper.com/) with distance and drive-time stats
- Animated route playback with speed control
- Customizable route color and line width with a CSS glow effect
- Multiple map themes: Positron, Dark Matter, Voyager, OpenStreetMap
- Export route as a glTF (.glb) file for use in Blender
- API key stored in localStorage and configurable via in-app settings

## Usage

Open https://thulrus.github.io/TripMapper/ in a browser. No installation required.

To run locally:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

A free [GraphHopper API key](https://graphhopper.com/dashboard/) is required for route calculation (500 req/day, no credit card). Enter it via the settings button in the app.

## Project Structure

```
TripMapper/
├── index.html      # Entry point
├── style.css       # All styling
├── app.js          # All application logic
└── README.md
```

## Tech Stack

| Layer      | Choice                                                            |
|------------|-------------------------------------------------------------------|
| Map        | [Leaflet.js 1.9.4](https://leafletjs.com/) via CDN               |
| Map tiles  | [CartoDB](https://carto.com/basemaps/) / OpenStreetMap            |
| Geocoding  | [Nominatim](https://nominatim.openstreetmap.org/)                 |
| Routing    | [GraphHopper Directions API](https://graphhopper.com/)            |
| 3D export  | [Three.js](https://threejs.org/) via CDN (glTF export)            |

## License

MIT
