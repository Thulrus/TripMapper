// ─── Map initialisation ─────────────────────────────────────────────────────

// API key is loaded from localStorage — users set it via the in-app settings UI
let graphhopperKey = localStorage.getItem('graphhopper_key') || '';

const map = L.map('map', { zoomControl: false }).setView([39.5, -98.35], 4);

// Zoom control at bottom-left — avoids both the search bar (top-left) and sidebar (right)
L.control.zoom({ position: 'bottomleft' }).addTo(map);

const MAP_THEMES = {
  positron: {
    label: 'Positron (Light)',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd', maxZoom: 20, bgColor: '#f8f4ed',
  },
  'dark-matter': {
    label: 'Dark Matter',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd', maxZoom: 20, bgColor: '#121212',
  },
  voyager: {
    label: 'Voyager',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd', maxZoom: 20, bgColor: '#fafaf8',
  },
  osm: {
    label: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    subdomains: 'abc', maxZoom: 19, bgColor: '#f2efe9',
  },
};

let activeThemeKey   = localStorage.getItem('map_theme') || 'positron';
let currentTileLayer = null;

function setMapTheme(key) {
  const theme = MAP_THEMES[key] ?? MAP_THEMES.positron;
  activeThemeKey = key;
  localStorage.setItem('map_theme', key);
  if (currentTileLayer) map.removeLayer(currentTileLayer);
  currentTileLayer = L.tileLayer(theme.url, {
    attribution: theme.attribution,
    subdomains:  theme.subdomains,
    maxZoom:     theme.maxZoom,
    crossOrigin: 'anonymous', // required for canvas capture during glTF export
  }).addTo(map);
}

setMapTheme(activeThemeKey);
// ─── Customisation state ─────────────────────────────────────────────────────

let animColor  = localStorage.getItem('anim_color')  || '#ff6b35';
let animWeight = Number(localStorage.getItem('anim_weight')) || 5;

// Dedicated pane so we can apply a CSS glow filter to the whole animation layer.
map.createPane('animPane');
map.getPane('animPane').style.zIndex = 450;
// Separate SVG renderer inside that pane (needed for vector layers in custom panes)
const animRenderer = L.svg({ pane: 'animPane' });

function updateGlowFilter() {
  map.getPane('animPane').style.filter =
    `drop-shadow(0 0 6px ${animColor}bb) drop-shadow(0 0 3px ${animColor}77)`;
}
updateGlowFilter();
// ─── Waypoint state ──────────────────────────────────────────────────────────

const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Each entry: { id, latlng, marker, placeName, label }
const waypoints = [];
let nextId = 0;
let routeLayer = null;
let promptLabelId = null; // id of the most recently placed waypoint (auto-prompts label edit)

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
  waypoints.push({ id, latlng, marker, placeName: null, label: '' });
  promptLabelId = id;
  clearRoute();
  refreshSidebar();

  // Fetch a human-readable place name asynchronously
  fetchPlaceName(latlng).then((name) => {
    const wp = waypoints.find((w) => w.id === id);
    if (!wp || !name) return;
    wp.placeName = name;
    updateMarkerTooltip(wp);
    // Update the sidebar span only if the user hasn't set a custom label
    // and the element is a span (not currently being edited as an input)
    if (!wp.label) {
      const el = waypointList.querySelector(`span[data-wp-id="${id}"]`);
      if (el) el.textContent = name;
    }
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
const exportBtn         = document.getElementById('export-btn');

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
    name.title = 'Click to rename';
    name.textContent = wp.label
      || wp.placeName
      || `${wp.latlng.lat.toFixed(4)}, ${wp.latlng.lng.toFixed(4)}`;
    name.addEventListener('click', () => startLabelEdit(wp, name));
    // Auto-prompt label on the most recently placed waypoint
    if (wp.id === promptLabelId) {
      promptLabelId = null;
      requestAnimationFrame(() => startLabelEdit(wp, name));
    }

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

function updateMarkerTooltip(wp) {
  const text = wp.label || wp.placeName;
  if (text) {
    wp.marker.bindTooltip(text, {
      direction: 'top',
      offset: [0, -18],
      className: 'wp-tooltip',
    });
  } else {
    wp.marker.unbindTooltip();
  }
}

function startLabelEdit(wp, spanEl) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'wp-label-input';
  input.value = wp.label || '';
  input.placeholder = 'Label (optional)…';
  input.setAttribute('aria-label', 'Waypoint label');
  spanEl.replaceWith(input);
  input.focus();

  const finish = () => {
    wp.label = input.value.trim();
    updateMarkerTooltip(wp);
    const span = document.createElement('span');
    span.className = 'wp-name';
    span.dataset.wpId = wp.id;
    span.title = 'Click to rename';
    span.textContent = wp.label
      || wp.placeName
      || `${wp.latlng.lat.toFixed(4)}, ${wp.latlng.lng.toFixed(4)}`;
    span.addEventListener('click', () => startLabelEdit(wp, span));
    input.replaceWith(span);
  };

  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = wp.label || ''; input.blur(); }
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
      color: animColor,
      weight: animWeight,
      opacity: 0.95,
      lineJoin: 'round',
      lineCap: 'round',
      pane: 'animPane',
      renderer: animRenderer,
    }).addTo(map);
  }
  animLine.setLatLngs(partial);

  if (!travelerDot) {
    travelerDot = L.circleMarker([0, 0], {
      radius: Math.max(6, animWeight + 2),
      fillColor: animColor,
      fillOpacity: 1,
      color: '#fff',
      weight: 2.5,
      pane: 'animPane',
      renderer: animRenderer,
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

// ─── Animation style controls ────────────────────────────────────────────────────

function setAnimStyle() {
  if (animLine) {
    animLine.setStyle({ color: animColor, weight: animWeight });
  }
  if (travelerDot) {
    travelerDot.setStyle({
      fillColor: animColor,
      radius: Math.max(6, animWeight + 2),
    });
  }
  updateGlowFilter();
}

const colorPicker  = document.getElementById('anim-color');
const weightSlider = document.getElementById('anim-weight');
const weightLabel  = document.getElementById('anim-weight-label');

colorPicker.value  = animColor;
weightSlider.value = animWeight;
weightLabel.textContent = animWeight;

colorPicker.addEventListener('input', () => {
  animColor = colorPicker.value;
  localStorage.setItem('anim_color', animColor);
  setAnimStyle();
});

weightSlider.addEventListener('input', () => {
  animWeight = Number(weightSlider.value);
  weightLabel.textContent = animWeight;
  localStorage.setItem('anim_weight', animWeight);
  setAnimStyle();
});

const mapThemeSelect = document.getElementById('map-theme');
mapThemeSelect.value = activeThemeKey;
mapThemeSelect.addEventListener('change', () => setMapTheme(mapThemeSelect.value));

// ─── Progress bar scrubbing ────────────────────────────────────────────────────

function scrubTo(clientX) {
  const rect = progressTrack.getBoundingClientRect();
  const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  animT = t;
  if (animPlaying) pauseAnim();
  if (routePoints.length) applyProgress(t);
}

progressTrack.addEventListener('pointerdown', (e) => {
  if (!routePoints.length) return;
  e.preventDefault();
  progressTrack.setPointerCapture(e.pointerId);
  scrubTo(e.clientX);
});

progressTrack.addEventListener('pointermove', (e) => {
  if (e.buttons === 0 || !routePoints.length) return;
  scrubTo(e.clientX);
});

// ─── GraphHopper Directions routing ────────────────────────────────────────────────────

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

// ─── glTF export ──────────────────────────────────────────────────────────────────

// Composite all visible Leaflet tiles onto an offscreen canvas.
// Requires the tile layer to have crossOrigin: 'anonymous' (set at init).
function captureMapCanvas() {
  const mapEl = document.getElementById('map');
  const w = mapEl.offsetWidth;
  const h = mapEl.offsetHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = MAP_THEMES[activeThemeKey]?.bgColor ?? '#f8f4ed';
  ctx.fillRect(0, 0, w, h);

  const mapRect = mapEl.getBoundingClientRect();
  mapEl.querySelectorAll('.leaflet-tile-loaded').forEach((img) => {
    if (!(img instanceof HTMLImageElement)) return;
    try {
      const r = img.getBoundingClientRect();
      ctx.drawImage(img, r.left - mapRect.left, r.top - mapRect.top, r.width, r.height);
    } catch {
      // Image tainted (tile loaded without crossOrigin) — skip it
    }
  });
  return canvas;
}

async function exportForBlender() {
  if (!routePoints.length) return;

  exportBtn.disabled = true;
  exportBtn.textContent = 'Exporting…';
  let exported = false;

  try {
    // Lazy-load Three.js (heavy — only loaded on first export)
    const THREE = await import('three');
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');

    // Scale plane so its longest side = 10 Blender units
    const mapEl  = document.getElementById('map');
    const w      = mapEl.offsetWidth;
    const h      = mapEl.offsetHeight;
    const aspect = w / h;
    const planeW = aspect >= 1 ? 10 : 10 * aspect;
    const planeH = aspect >= 1 ? 10 / aspect : 10;

    // ── Map plane ──────────────────────────────────────────────────
    const mapCanvas = captureMapCanvas();
    const texture   = new THREE.CanvasTexture(mapCanvas);
    // Use the default flipY=true — GLTFExporter compensates by flipping UV V coords,
    // so the exported file has correct north-south orientation in Blender.

    const planeGeo = new THREE.PlaneGeometry(planeW, planeH);
    // Rotate so the plane lies flat (XZ plane) in Y-up glTF space
    planeGeo.rotateX(-Math.PI / 2);
    const planeMat  = new THREE.MeshStandardMaterial({ map: texture });
    const planeMesh = new THREE.Mesh(planeGeo, planeMat);
    planeMesh.name  = 'MapPlane';

    // ── Route tube ────────────────────────────────────────────────
    // Project all route points using Leaflet's Mercator for pixel-perfect
    // alignment with the captured map texture.
    const rawPts = routePoints.map(([lat, lng]) => {
      const px = map.latLngToContainerPoint([lat, lng]);
      return new THREE.Vector3(
        (px.x / w - 0.5) * planeW,
        0.02,
        (px.y / h - 0.5) * planeH,
      );
    });

    // Pass 1 — moving-average smooth.
    // Dense GPS points cause high-frequency direction changes that make
    // CatmullRom oscillate ("lumpy mess"). Smoothing removes the jitter
    // so the spline has no reason to overshoot after we decimate in pass 2.
    const SMOOTH_R = 5;
    const smoothed = rawPts.map((_, i) => {
      const j0 = Math.max(0, i - SMOOTH_R);
      const j1 = Math.min(rawPts.length - 1, i + SMOOTH_R);
      let x = 0, z = 0, n = 0;
      for (let j = j0; j <= j1; j++) { x += rawPts[j].x; z += rawPts[j].z; n++; }
      return new THREE.Vector3(x / n, 0.02, z / n);
    });

    // Pass 2 — decimate smoothed points to ≤200 control points.
    // With smooth input, CatmullRom between widely-spaced control points won't
    // overshoot, so the tube stays within the plane bounds.
    const MAX_CTRL = 200;
    const step = Math.max(1, Math.ceil(smoothed.length / MAX_CTRL));
    const ctrlPts = smoothed.filter((_, i) => i % step === 0 || i === smoothed.length - 1);

    const curve   = new THREE.CatmullRomCurve3(ctrlPts, false, 'centripetal');
    const tubeGeo = new THREE.TubeGeometry(
      curve,
      1200,          // tube segments — high resolution, independent of control count
      planeW * 0.004,
      8,
      false
    );

    const tubeColor = new THREE.Color(animColor);
    const tubeMat   = new THREE.MeshStandardMaterial({
      color:             tubeColor,
      emissive:          tubeColor,
      emissiveIntensity: 3,
      roughness:         0.1,
      metalness:         0.1,
    });
    const routeMesh = new THREE.Mesh(tubeGeo, tubeMat);
    routeMesh.name  = 'Route';

    // ── Center-line (raw sampled curve, no tube) ───────────────────
    const centerPts    = curve.getPoints(500);
    const centerGeo    = new THREE.BufferGeometry().setFromPoints(centerPts);
    const centerMat    = new THREE.LineBasicMaterial({ color: tubeColor });
    const centerLine   = new THREE.Line(centerGeo, centerMat);
    centerLine.name    = 'RouteCenterLine';

    // ── Scene & export ──────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.add(planeMesh, routeMesh, centerLine);

    const exporter = new GLTFExporter();
    // parseAsync returns a clean Promise — avoids the callback-timing issues
    // that previously prevented openBlenderModal from firing reliably.
    const glb = await exporter.parseAsync(scene, { binary: true });

    const blob = new Blob([glb], { type: 'application/octet-stream' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'tripmapper-route.glb';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    exported = true;

  } catch (err) {
    console.error('[TripMapper] Export failed:', err);
    alert('Export failed: ' + (err?.message ?? err));
  } finally {
    exportBtn.disabled = false;
    exportBtn.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="2.2"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      Export for Blender`;
  }

  if (exported) openBlenderModal();
}

exportBtn.addEventListener('click', exportForBlender);

// ─── Blender instructions modal ────────────────────────────────────────────────────

const blenderModal      = document.getElementById('blender-modal');
const blenderModalClose = document.getElementById('blender-modal-close');

function openBlenderModal() {
  // Look up the element fresh rather than relying on a captured reference,
  // and force display with an inline style as a belt-and-suspenders measure.
  const el = document.getElementById('blender-modal');
  if (!el) { console.error('[TripMapper] blender-modal element not found'); return; }
  el.classList.remove('hidden');
  el.style.display = 'flex';
}
function closeBlenderModal() {
  const el = document.getElementById('blender-modal');
  if (!el) return;
  el.style.display = '';
  el.classList.add('hidden');
}

blenderModalClose.addEventListener('click', closeBlenderModal);
blenderModal.addEventListener('click', (e) => { if (e.target === blenderModal) closeBlenderModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const el = document.getElementById('blender-modal');
    if (el && el.style.display !== 'none' && !el.classList.contains('hidden')) closeBlenderModal();
  }
});

// ─── Mobile sidebar toggle ────────────────────────────────────────────────────

const sidebar       = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');

sidebarToggle.addEventListener('click', () => {
  const isOpen = sidebar.classList.toggle('sidebar-open');
  sidebarToggle.setAttribute('aria-label', isOpen ? 'Close sidebar' : 'Open sidebar');
  sidebarToggle.querySelector('.toggle-icon').textContent = isOpen ? '\u2715' : '\u2630';
});
