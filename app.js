// ─── Map initialisation ─────────────────────────────────────────────────────

// API key is loaded from localStorage — users set it via the in-app settings UI
let graphhopperKey = localStorage.getItem('graphhopper_key') || '';

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

// Animation state
let routePoints   = [];   // [lat, lng] pairs from Mapbox geometry
let cumDist       = [];   // normalized cumulative distances (0..1)
let animLine      = null; // L.polyline drawn over route during playback
let travelerDot   = null; // L.circleMarker at the animation head
let animT         = 0;    // current progress 0..1
let animPlaying   = false;
let animRafId     = null;
let lastTimestamp = null;

const SPEED_MS     = [90000, 30000, 10000]; // Slow / Medium / Fast in ms
const SPEED_LABELS = ['Slow', 'Med', 'Fast'];

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
  clearRoute();
  refreshSidebar();

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
  clearRoute();
  refreshSidebar();
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

const waypointList      = document.getElementById('waypoint-list');
const calcRouteBtn      = document.getElementById('calc-route-btn');
const routeStats        = document.getElementById('route-stats');
const routeError        = document.getElementById('route-error');
const routeErrorText    = document.getElementById('route-error-text');
const routeLoading      = document.getElementById('route-loading');
const routeLoadingText  = document.getElementById('route-loading-text');
const clearAllBtn       = document.getElementById('clear-all-btn');

function refreshSidebar() {
  waypointList.innerHTML = '';

  calcRouteBtn.classList.toggle('hidden', waypoints.length < 2);

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
calcRouteBtn.addEventListener('click', updateRoute);
document.getElementById('route-retry-btn').addEventListener('click', updateRoute);

// ─── API key modal ───────────────────────────────────────────────────────────────

const apiKeyModal = document.getElementById('api-key-modal');
const apiKeyInput = document.getElementById('api-key-input');
const apiKeySave  = document.getElementById('api-key-save');
const apiKeyBtn   = document.getElementById('api-key-btn');
const modalClose  = document.getElementById('modal-close');

function openKeyModal() {
  apiKeyInput.value = graphhopperKey;
  apiKeyModal.classList.remove('hidden');
  requestAnimationFrame(() => apiKeyInput.focus());
}

function closeKeyModal() {
  apiKeyModal.classList.add('hidden');
}

apiKeyBtn.addEventListener('click', openKeyModal);
modalClose.addEventListener('click', closeKeyModal);
apiKeyModal.addEventListener('click', (e) => {
  if (e.target === apiKeyModal) closeKeyModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !apiKeyModal.classList.contains('hidden')) closeKeyModal();
});
apiKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') apiKeySave.click();
});
apiKeySave.addEventListener('click', () => {
  const trimmed = apiKeyInput.value.trim();
  graphhopperKey = trimmed;
  if (trimmed) {
    localStorage.setItem('graphhopper_key', trimmed);
  } else {
    localStorage.removeItem('graphhopper_key');
  }
  closeKeyModal();
});

// Show the modal automatically on first visit if no key is stored
if (!graphhopperKey) openKeyModal();

// ─── Animation helpers ───────────────────────────────────────────────────────

const playbackPanel = document.getElementById('playback-panel');
const progressTrack = document.getElementById('progress-track');
const progressFill  = document.getElementById('progress-fill');
const btnPlay       = document.getElementById('btn-play');
const btnPause      = document.getElementById('btn-pause');
const btnReset      = document.getElementById('btn-reset');
const speedSlider   = document.getElementById('speed-slider');
const speedLabel    = document.getElementById('speed-label');

// Build normalized cumulative distance array (each entry is 0..1)
function buildCumDist(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const [lat1, lng1] = points[i - 1];
    const [lat2, lng2] = points[i];
    cum.push(cum[i - 1] + Math.hypot(lat2 - lat1, lng2 - lng1));
  }
  const total = cum[cum.length - 1];
  if (total === 0) return points.map((_, i) => i / Math.max(1, points.length - 1));
  return cum.map(v => v / total);
}

// Return a latlng array from the route start up to progress fraction t
function partialLatLngs(t) {
  if (!routePoints.length) return [];
  if (t <= 0) return [routePoints[0]];
  if (t >= 1) return routePoints.slice();

  const i = cumDist.findIndex(d => d > t);
  if (i <= 0) return [routePoints[0]];

  const segFrac = (t - cumDist[i - 1]) / (cumDist[i] - cumDist[i - 1]);
  const [lat1, lng1] = routePoints[i - 1];
  const [lat2, lng2] = routePoints[i];
  const interp = [lat1 + segFrac * (lat2 - lat1), lng1 + segFrac * (lng2 - lng1)];
  return [...routePoints.slice(0, i), interp];
}

function clearAnimLayers() {
  if (animLine)    { map.removeLayer(animLine);    animLine = null; }
  if (travelerDot) { map.removeLayer(travelerDot); travelerDot = null; }
  progressFill.style.width = '0%';
}

function setPlayingState(playing) {
  btnPlay.classList.toggle('hidden', playing);
  btnPause.classList.toggle('hidden', !playing);
}

// Render animated overlay at progress fraction t (0..1)
function applyProgress(t) {
  const partial = partialLatLngs(t);
  if (!partial.length) return;
  const head = partial[partial.length - 1];

  if (!animLine) {
    animLine = L.polyline([], {
      color: '#ff6b35',
      weight: 5,
      opacity: 0.95,
      lineJoin: 'round',
      lineCap: 'round',
    }).addTo(map);
  }
  animLine.setLatLngs(partial);

  if (!travelerDot) {
    travelerDot = L.circleMarker([0, 0], {
      radius: 8,
      fillColor: '#ff6b35',
      fillOpacity: 1,
      color: '#fff',
      weight: 2.5,
    }).addTo(map);
  }
  travelerDot.setLatLng(head);

  progressFill.style.width = `${t * 100}%`;
  progressTrack.setAttribute('aria-valuenow', Math.round(t * 100));
}

function animTick(ts) {
  if (!animPlaying) return;
  if (lastTimestamp === null) lastTimestamp = ts;
  const elapsed = ts - lastTimestamp;
  lastTimestamp = ts;

  animT = Math.min(1, animT + elapsed / SPEED_MS[Number(speedSlider.value)]);
  applyProgress(animT);

  if (animT >= 1) {
    animPlaying = false;
    setPlayingState(false);
    return;
  }
  animRafId = requestAnimationFrame(animTick);
}

function playAnim() {
  if (!routePoints.length) return;
  if (animT >= 1) { clearAnimLayers(); animT = 0; } // restart from beginning
  animPlaying = true;
  lastTimestamp = null;
  setPlayingState(true);
  animRafId = requestAnimationFrame(animTick);
}

function pauseAnim() {
  if (animRafId) { cancelAnimationFrame(animRafId); animRafId = null; }
  animPlaying = false;
  lastTimestamp = null;
  setPlayingState(false);
}

function resetAnim() {
  if (animRafId) { cancelAnimationFrame(animRafId); animRafId = null; }
  animPlaying = false;
  animT = 0;
  lastTimestamp = null;
  clearAnimLayers();
  setPlayingState(false);
}

btnPlay.addEventListener('click', playAnim);
btnPause.addEventListener('click', pauseAnim);
btnReset.addEventListener('click', resetAnim);

speedSlider.addEventListener('input', () => {
  speedLabel.textContent = SPEED_LABELS[Number(speedSlider.value)];
});

// ─── GraphHopper Directions routing ─────────────────────────────────────────────────

// Throws on any failure so the retry loop in updateRoute can catch it.
async function fetchRouteData(coords) {
  if (!graphhopperKey) {
    throw new Error('No GraphHopper key — click the ⚙️ button to add your API key');
  }

  const url =
    `https://graphhopper.com/api/1/route?${coords}` +
    `&profile=car&type=json&points_encoded=false&key=${encodeURIComponent(graphhopperKey)}`;

  // Log without exposing the key in full
  console.info('[TripMapper] Routing URL:', url.replace(graphhopperKey, '…<key>…'));

  const res = await fetch(url);
  console.info(`[TripMapper] Response: HTTP ${res.status} ${res.statusText}`);

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(`HTTP ${res.status}${ body?.message ? ': ' + body.message : '' }`);
  }

  const data = await res.json();
  if (!data.paths?.length) throw new Error('No routes returned');
  return data;
}

function clearRoute() {
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  // Stop and clear animation
  if (animRafId) { cancelAnimationFrame(animRafId); animRafId = null; }
  animPlaying = false;
  animT = 0;
  lastTimestamp = null;
  routePoints = [];
  cumDist = [];
  clearAnimLayers();
  setPlayingState(false);
  // Hide panels
  routeLoading.classList.add('hidden');
  routeError.classList.add('hidden');
  playbackPanel.classList.add('hidden');
  progressTrack.classList.add('hidden');
  routeStats.classList.add('hidden');
}

async function updateRoute() {
  clearRoute();
  if (waypoints.length < 2) return;
  if (!graphhopperKey) { openKeyModal(); return; }

  // GraphHopper uses repeated point=lat,lng query params
  const coords = waypoints
    .map((wp) => `point=${wp.latlng.lat},${wp.latlng.lng}`)
    .join('&');

  routeLoading.classList.remove('hidden');
  routeLoadingText.textContent = 'Calculating route…';

  let data = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) {
      routeLoadingText.textContent = 'Calculating route… (retrying)';
      await new Promise((r) => setTimeout(r, 1500));
      if (waypoints.length < 2) return;
    }
    console.info(`[TripMapper] Route attempt ${attempt}`);
    try {
      data = await fetchRouteData(coords);
      console.info(`[TripMapper] Route OK — ${data.paths[0].distance}m, ${data.paths[0].time}ms`);
      break;
    } catch (err) {
      console.error(`[TripMapper] Attempt ${attempt} failed:`, err.message);
      if (attempt === 2) {
        routeErrorText.textContent = `Could not calculate route: ${err.message}`;
      }
    }
  }

  routeLoading.classList.add('hidden');

  if (!data) {
    routeError.classList.remove('hidden');
    return;
  }

  const route = data.paths[0];

  // GraphHopper GeoJSON uses [lng, lat] — swap to Leaflet's [lat, lng]
  const latlngs = route.points.coordinates.map(([lng, lat]) => [lat, lng]);
  routeLayer = L.polyline(latlngs, {
    color: '#5b8dee',
    weight: 4,
    opacity: 0.85,
    lineJoin: 'round',
    lineCap: 'round',
  }).addTo(map);

  routePoints = latlngs;
  cumDist = buildCumDist(routePoints);

  const km = (route.distance / 1000).toFixed(1);
  const mi = (route.distance / 1609.344).toFixed(1);
  const totalSec = Math.round(route.time / 1000); // GraphHopper time is in milliseconds
  const h   = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const durationStr = h > 0 ? `${h} hr ${min} min` : `${min} min`;

  document.getElementById('stat-distance').textContent = `${mi} mi (${km} km)`;
  document.getElementById('stat-duration').textContent = durationStr;
  routeStats.classList.remove('hidden');

  setPlayingState(false);
  progressFill.style.width = '0%';
  playbackPanel.classList.remove('hidden');
  progressTrack.classList.remove('hidden');
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
