// ─── Map initialisation ─────────────────────────────────────────────────────

const map = L.map('map', { zoomControl: false }).setView([39.5, -98.35], 4);

// Zoom control at bottom-left — avoids both the search bar (top-left) and sidebar (right)
L.control.zoom({ position: 'bottomleft' }).addTo(map);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
    '&copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 20,
}).addTo(map);

// ─── Waypoint state ──────────────────────────────────────────────────────────

const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Each entry: { id, latlng, marker, placeName }
const waypoints = [];
let nextId = 0;
let routeLayer = null;

// ─── Marker icon factory ─────────────────────────────────────────────────────

function makeIcon(index) {
  return L.divIcon({
    className: '',
    html: `<div class="wp-marker">${LABELS[index] ?? index + 1}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

// ─── Waypoint operations ─────────────────────────────────────────────────────

function addWaypoint(latlng) {
  if (waypoints.length >= LABELS.length) return; // cap at 26
  const index = waypoints.length;
  const id = nextId++;
  const marker = L.marker(latlng, { icon: makeIcon(index) }).addTo(map);
  waypoints.push({ id, latlng, marker, placeName: null });
  refreshSidebar();
  updateRoute();

  // Fetch a human-readable place name asynchronously
  fetchPlaceName(latlng).then((name) => {
    const wp = waypoints.find((w) => w.id === id);
    if (!wp || !name) return;
    wp.placeName = name;
    // Update the already-rendered list item if it is still in the DOM
    const el = waypointList.querySelector(`[data-wp-id="${id}"]`);
    if (el) el.textContent = name;
  });
}

function removeWaypoint(index) {
  const [removed] = waypoints.splice(index, 1);
  map.removeLayer(removed.marker);
  // Re-label surviving markers to keep A, B, C… contiguous
  waypoints.forEach((wp, i) => wp.marker.setIcon(makeIcon(i)));
  refreshSidebar();
  updateRoute();
}

function clearWaypoints() {
  waypoints.forEach((wp) => map.removeLayer(wp.marker));
  waypoints.length = 0;
  clearRoute();
  refreshSidebar();
}

// ─── Reverse geocoding (Nominatim) ───────────────────────────────────────────

async function fetchPlaceName(latlng) {
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=json` +
      `&lat=${latlng.lat}&lon=${latlng.lng}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!res.ok) return null;
    const data = await res.json();
    const a = data.address ?? {};
    return (
      a.city || a.town || a.village || a.hamlet ||
      a.county || a.state || data.display_name || null
    );
  } catch {
    return null;
  }
}

// ─── Sidebar rendering ───────────────────────────────────────────────────────

const waypointList = document.getElementById('waypoint-list');
const routeStats   = document.getElementById('route-stats');
const clearAllBtn  = document.getElementById('clear-all-btn');

function refreshSidebar() {
  waypointList.innerHTML = '';

  if (waypoints.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'sidebar-empty';
    empty.textContent = 'Click the map to add waypoints.';
    waypointList.appendChild(empty);
    return;
  }

  waypoints.forEach((wp, i) => {
    const item = document.createElement('div');
    item.className = 'wp-item';
    item.setAttribute('role', 'listitem');

    const badge = document.createElement('span');
    badge.className = 'wp-badge';
    badge.textContent = LABELS[i] ?? i + 1;

    const name = document.createElement('span');
    name.className = 'wp-name';
    name.dataset.wpId = wp.id;
    // Show cached name immediately; coordinates as fallback while fetch is in-flight
    name.textContent = wp.placeName
      ?? `${wp.latlng.lat.toFixed(4)}, ${wp.latlng.lng.toFixed(4)}`;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'wp-remove';
    removeBtn.setAttribute('aria-label', `Remove waypoint ${LABELS[i] ?? i + 1}`);
    removeBtn.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="2.5"
           stroke-linecap="round" stroke-linejoin="round">
         <line x1="18" y1="6" x2="6" y2="18"></line>
         <line x1="6" y1="6" x2="18" y2="18"></line>
       </svg>`;
    removeBtn.addEventListener('click', () => removeWaypoint(i));

    item.append(badge, name, removeBtn);
    waypointList.appendChild(item);
  });
}

clearAllBtn.addEventListener('click', clearWaypoints);

// ─── OSRM routing ────────────────────────────────────────────────────────────

function clearRoute() {
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  routeStats.classList.add('hidden');
}

async function updateRoute() {
  clearRoute();
  if (waypoints.length < 2) return;

  // Build coordinate string: lng,lat pairs joined by semicolons
  const coords = waypoints
    .map((wp) => `${wp.latlng.lng},${wp.latlng.lat}`)
    .join(';');

  const url =
    `https://router.project-osrm.org/route/v1/driving/${coords}` +
    `?overview=full&geometries=geojson`;

  let data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch {
    return; // Route fetch failed — leave map clean, no crash
  }

  if (!data.routes?.length) return;

  const route = data.routes[0];

  // OSRM GeoJSON geometry uses [lng, lat] — swap to Leaflet's [lat, lng]
  const latlngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  routeLayer = L.polyline(latlngs, {
    color: '#5b8dee',
    weight: 4,
    opacity: 0.85,
    lineJoin: 'round',
    lineCap: 'round',
  }).addTo(map);

  // Distance
  const km = (route.distance / 1000).toFixed(1);
  const mi = (route.distance / 1609.344).toFixed(1);

  // Duration
  const totalSec = Math.round(route.duration);
  const h   = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const durationStr = h > 0 ? `${h} hr ${min} min` : `${min} min`;

  document.getElementById('stat-distance').textContent = `${mi} mi (${km} km)`;
  document.getElementById('stat-duration').textContent = durationStr;
  routeStats.classList.remove('hidden');
}

// ─── Map click → place waypoint ──────────────────────────────────────────────

map.on('click', (e) => {
  addWaypoint(e.latlng);
});

// ─── Search ─────────────────────────────────────────────────────────────────

const searchInput = document.getElementById('search-input');
const searchBtn   = document.getElementById('search-btn');
const searchError = document.getElementById('search-error');

async function geocodeAndFly(rawQuery) {
  const query = rawQuery.trim();
  if (!query) return;

  searchError.classList.add('hidden');
  searchError.textContent = 'Place not found.';

  let data;
  try {
    const url =
      'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
      encodeURIComponent(query);

    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch {
    searchError.textContent = 'Search failed. Check your connection and try again.';
    searchError.classList.remove('hidden');
    return;
  }

  if (!data.length) {
    searchError.classList.remove('hidden');
    return;
  }

  const { lat, lon, boundingbox } = data[0];

  if (boundingbox) {
    // boundingbox: [south_lat, north_lat, west_lon, east_lon]
    const bounds = [
      [parseFloat(boundingbox[0]), parseFloat(boundingbox[2])], // SW
      [parseFloat(boundingbox[1]), parseFloat(boundingbox[3])], // NE
    ];
    map.flyToBounds(bounds, { padding: [60, 60], duration: 1.5 });
  } else {
    map.flyTo([parseFloat(lat), parseFloat(lon)], 12, { duration: 1.5 });
  }
}

searchBtn.addEventListener('click', () => geocodeAndFly(searchInput.value));

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') geocodeAndFly(searchInput.value);
});
