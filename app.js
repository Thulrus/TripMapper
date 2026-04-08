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
    label: 'Street Map',
    // ESRI World Street Map — free, no API key, no Referer requirement.
    // Built on OSM data; tile path is z/row/col (= z/y/x in Leaflet notation).
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Source: Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    subdomains: '', maxZoom: 17, bgColor: '#e5e3df',
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
    subdomains:  theme.subdomains || '',
    maxZoom:     theme.maxZoom,
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

// ─── State persistence ───────────────────────────────────────────────────────

const STORAGE_KEY = 'tripmapper_state';

function saveState() {
  const state = {
    waypoints: waypoints.map((wp) => ({
      lat: wp.latlng.lat,
      lng: wp.latlng.lng,
      label:     wp.label,
      placeName: wp.placeName,
    })),
    routePoints,
    statDistance: document.getElementById('stat-distance').textContent,
    statDuration: document.getElementById('stat-duration').textContent,
    travelMode,
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

// Restores waypoints and route from localStorage on page load.
// Runs after all DOM refs and helper functions are defined (called at bottom of file).
function restoreState() {
  let state;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    state = JSON.parse(raw);
  } catch { return; }

  const { waypoints: saved = [], routePoints: savedRoute = [],
          statDistance = '', statDuration = '', travelMode: savedMode = 'car' } = state;
  if (!saved.length) return;

  for (const { lat, lng, label, placeName } of saved) {
    const index = waypoints.length;
    const id    = nextId++;
    const latlng = L.latLng(lat, lng);
    const marker = L.marker(latlng, { icon: makeIcon(index), draggable: true }).addTo(map);
    const wp = { id, latlng, marker, placeName: placeName ?? null, label: label || '' };
    waypoints.push(wp);
    wireMarkerDrag(wp);
    updateMarkerTooltip(wp);
  }
  refreshSidebar();

  travelMode = savedMode;
  travelModeSelect.value = savedMode;

  if (savedRoute.length > 1) {
    routePoints = savedRoute;
    cumDist     = buildCumDist(routePoints);
    routeLayer  = L.polyline(routePoints, {
      color: '#5b8dee', weight: 4, opacity: 0.85,
      lineJoin: 'round', lineCap: 'round',
    }).addTo(map);
    if (statDistance) document.getElementById('stat-distance').textContent = statDistance;
    if (statDuration) document.getElementById('stat-duration').textContent = statDuration;
    routeStats.classList.remove('hidden');
    setPlayingState(false);
    progressFill.style.width = '0%';
    playbackPanel.classList.remove('hidden');
    progressTrack.classList.remove('hidden');
  }

  const bounds = L.latLngBounds(waypoints.map((wp) => wp.latlng));
  map.fitBounds(bounds, { padding: [60, 60] });
}
let routeLayer = null;
let promptLabelId = null; // id of the most recently placed waypoint (auto-prompts label edit)

// Route mode
let travelMode = 'car';   // 'car' | 'flight'

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

// Attach a dragend listener so the user can reposition any waypoint on the map.
function wireMarkerDrag(wp) {
  wp.marker.on('dragend', () => {
    wp.latlng    = wp.marker.getLatLng();
    wp.placeName = null;
    updateMarkerTooltip(wp);
    clearRoute();
    refreshSidebar();
    saveState();
    fetchPlaceName(wp.latlng).then((name) => {
      if (!name) return;
      wp.placeName = name;
      updateMarkerTooltip(wp);
      if (!wp.label) {
        const el = waypointList.querySelector(`span[data-wp-id="${wp.id}"]`);
        if (el) el.textContent = name;
      }
      saveState();
    });
  });
}

function addWaypoint(latlng) {
  if (waypoints.length >= LABELS.length) return; // cap at 26
  const index = waypoints.length;
  const id = nextId++;
  const marker = L.marker(latlng, { icon: makeIcon(index), draggable: true }).addTo(map);
  const wp = { id, latlng, marker, placeName: null, label: '' };
  waypoints.push(wp);
  wireMarkerDrag(wp);
  promptLabelId = id;
  clearRoute();
  refreshSidebar();
  saveState();

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
    saveState();
  });
}

function removeWaypoint(index) {
  const [removed] = waypoints.splice(index, 1);
  map.removeLayer(removed.marker);
  // Re-label surviving markers to keep A, B, C… contiguous
  waypoints.forEach((wp, i) => wp.marker.setIcon(makeIcon(i)));
  clearRoute();
  refreshSidebar();
  saveState();
}

function clearWaypoints() {
  waypoints.forEach((wp) => map.removeLayer(wp.marker));
  waypoints.length = 0;
  clearRoute();
  refreshSidebar();
  saveState();
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
const travelModeSelect   = document.getElementById('travel-mode');
const exportLabelsCheck  = document.getElementById('export-labels');
const smoothSlider       = document.getElementById('smooth-slider');
const smoothLabel        = document.getElementById('smooth-label');
const terrainCheck       = document.getElementById('terrain-check');
const terrainReliefRow   = document.getElementById('terrain-relief-row');
const reliefSlider       = document.getElementById('relief-slider');
const reliefLabel        = document.getElementById('relief-label');

const RELIEF_MULTS  = [0.25, 0.5, 1, 2, 4];
const RELIEF_LABELS = ['0.25×', '0.5×', '1×', '2×', '4×'];

terrainCheck.addEventListener('change', () => {
  terrainReliefRow.classList.toggle('hidden', !terrainCheck.checked);
});
reliefSlider.addEventListener('input', () => {
  reliefLabel.textContent = RELIEF_LABELS[Number(reliefSlider.value)];
});
travelModeSelect.addEventListener('change', () => {
  travelMode = travelModeSelect.value;
  saveState();
  if (waypoints.length >= 2) updateRoute();
});

// Paired [SMOOTH_R, MAX_CTRL] per smoothing level.
// Higher SMOOTH_R widens the moving-average window; lower MAX_CTRL keeps
// fewer CatmullRom control points → progressively less route detail.
const SMOOTH_PARAMS = [
  { r: 0,  ctrl: 400 }, // None  — raw GPS points, full detail
  { r: 3,  ctrl: 250 }, // Light
  { r: 8,  ctrl: 150 }, // Med
  { r: 20, ctrl: 80  }, // Heavy
  { r: 50, ctrl: 30  }, // Max   — major turns only
];
const SMOOTH_LABELS = ['None', 'Light', 'Med', 'Heavy', 'Max'];

smoothSlider.addEventListener('input', () => {
  smoothLabel.textContent = SMOOTH_LABELS[Number(smoothSlider.value)];
});

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
      permanent: !!wp.label,
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
    saveState();
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

function buildFlightRoute() {
  // Straight-line legs between consecutive waypoints, interpolated to 60
  // points each for smooth animation. Straight lines on Mercator are correct
  // for air travel; no API key or network request needed.
  const STEPS = 60;
  const pts = [];
  let totalDist = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i].latlng;
    const b = waypoints[i + 1].latlng;
    totalDist += a.distanceTo(b);
    for (let s = (i === 0 ? 0 : 1); s <= STEPS; s++) {
      const t = s / STEPS;
      pts.push([a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t]);
    }
  }

  routePoints = pts;
  cumDist     = buildCumDist(routePoints);

  routeLayer = L.polyline(routePoints, {
    color: '#5b8dee', weight: 4, opacity: 0.85,
    lineJoin: 'round', lineCap: 'round',
  }).addTo(map);

  const mi = (totalDist / 1609.344).toFixed(1);
  const km = (totalDist / 1000).toFixed(1);
  // Assume 800 km/h cruising speed
  const totalSec = totalDist / 222.2;
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
  saveState();
}

async function updateRoute() {
  clearRoute();
  if (waypoints.length < 2) return;
  if (travelMode === 'flight') { buildFlightRoute(); return; }
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
  saveState();
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

// Fetch map tiles that cover the full route bounding box at the best available
// zoom level. Completely independent of the user's current viewport — the export
// always covers the entire route at consistent, route-centred resolution.
async function captureRouteTiles() {
  // ── 1. Padded bounding box ─────────────────────────────────────────────────
  const lats = routePoints.map(([lat]) => lat);
  const lngs = routePoints.map(([, lng]) => lng);
  waypoints.forEach((wp) => { lats.push(wp.latlng.lat); lngs.push(wp.latlng.lng); });

  let south = Math.min(...lats), north = Math.max(...lats);
  let west  = Math.min(...lngs), east  = Math.max(...lngs);

  const latSpan = Math.max(north - south, 0.001);
  const lngSpan = Math.max(east  - west,  0.001);
  const PAD = 0.12; // 12 % breathing room on each side
  south = Math.max(south - latSpan * PAD, -85.05113);
  north = Math.min(north + latSpan * PAD,  85.05113);
  west  = Math.max(west  - lngSpan * PAD, -180);
  east  = Math.min(east  + lngSpan * PAD,  180);

  // ── 2. Web Mercator tile coordinate helpers ────────────────────────────────
  const toTileF = (lat, lng, z) => {
    const n   = 1 << z;
    const tx  = (lng + 180) / 360 * n;
    const rad = lat * Math.PI / 180;
    const ty  = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n;
    return { tx, ty };
  };

  // ── 3. Choose highest zoom where the tile grid fits within MAX_TILES×MAX_TILES ──
  const MAX_TILES = 8; // → max canvas ~2048 × 2048 px
  let z = 16;
  while (z > 1) {
    const { tx: x0, ty: y0 } = toTileF(north, west, z);
    const { tx: x1, ty: y1 } = toTileF(south, east, z);
    if ((x1 - x0) <= MAX_TILES && (y1 - y0) <= MAX_TILES) break;
    z--;
  }

  const { tx: fx0, ty: fy0 } = toTileF(north, west, z);
  const { tx: fx1, ty: fy1 } = toTileF(south, east, z);
  const tMinX = Math.floor(fx0), tMaxX = Math.floor(fx1);
  const tMinY = Math.floor(fy0), tMaxY = Math.floor(fy1);

  const canvasW = (tMaxX - tMinX + 1) * 256;
  const canvasH = (tMaxY - tMinY + 1) * 256;

  // ── 4. Offscreen canvas ────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.width  = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = MAP_THEMES[activeThemeKey]?.bgColor ?? '#f8f4ed';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // ── 5. Fetch tiles ─────────────────────────────────────────────────────────
  const theme  = MAP_THEMES[activeThemeKey] ?? MAP_THEMES.positron;
  const subs   = theme.subdomains ?? 'abcd';
  let   subIdx = 0;
  const nextSub = () => { const s = subs[subIdx % subs.length]; subIdx++; return s; };

  const tilePromises = [];
  for (let ty = tMinY; ty <= tMaxY; ty++) {
    for (let tx = tMinX; tx <= tMaxX; tx++) {
      const url = theme.url
        .replace('{z}', z)
        .replace('{x}', tx)
        .replace('{y}', ty)
        .replace('{r}', '')       // standard 256 px tiles (no @2x suffix)
        .replace('{s}', nextSub());
      const dx = (tx - tMinX) * 256;
      const dy = (ty - tMinY) * 256;
      tilePromises.push(
        new Promise((resolve) => {
          const img = new Image();
          img.referrerPolicy = 'no-referrer-when-downgrade';
          img.crossOrigin = 'anonymous';
          img.onload  = () => { try { ctx.drawImage(img, dx, dy, 256, 256); } catch {} resolve(); };
          img.onerror = resolve;
          img.src = url;
        }),
      );
    }
  }
  await Promise.all(tilePromises);

  // ── 6. Projection helper ───────────────────────────────────────────────────
  // Maps (lat, lng) → pixel coordinates on the captured canvas.
  const projectLatLng = (lat, lng) => {
    const { tx, ty } = toTileF(lat, lng, z);
    return { px: (tx - tMinX) * 256, py: (ty - tMinY) * 256 };
  };

  return { canvas, projectLatLng, canvasW, canvasH, tMinX, tMaxX, tMinY, tMaxY, z, toTileF };
}

// Fetch AWS Terrain Tiles (Terrarium format) for the same tile bounds returned
// by captureRouteTiles(). Decodes each pixel to metres of elevation, then
// provides a bilinear-interpolated getElevation(u, v) sampler (u/v in 0..1
// matching the map texture UV space).
async function buildTerrainHeightmap(tMinX, tMaxX, tMinY, tMaxY, z, toTileF) {
  const cols = tMaxX - tMinX + 1;
  const rows = tMaxY - tMinY + 1;
  const W    = cols * 256;
  const H    = rows * 256;

  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const promises = [];
  for (let ty = tMinY; ty <= tMaxY; ty++) {
    for (let tx = tMinX; tx <= tMaxX; tx++) {
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`;
      const dx  = (tx - tMinX) * 256;
      const dy  = (ty - tMinY) * 256;
      promises.push(new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin    = 'anonymous';
        img.referrerPolicy = 'no-referrer-when-downgrade';
        img.onload  = () => { try { ctx.drawImage(img, dx, dy, 256, 256); } catch {} resolve(); };
        img.onerror = resolve; // silently skip failed tiles (ocean areas etc.)
        img.src = url;
      }));
    }
  }
  await Promise.all(promises);

  const imgData = ctx.getImageData(0, 0, W, H).data; // Uint8ClampedArray, RGBA

  // Terrarium decode: elev (m) = R*256 + G + B/256 - 32768
  const elevAt = (px, py) => {
    const ix = Math.max(0, Math.min(W - 1, Math.round(px)));
    const iy = Math.max(0, Math.min(H - 1, Math.round(py)));
    const i  = (iy * W + ix) * 4;
    return imgData[i] * 256 + imgData[i + 1] + imgData[i + 2] / 256 - 32768;
  };

  // Compute range over the full canvas for auto-scale normalization
  let minElev =  Infinity;
  let maxElev = -Infinity;
  // Sample on a coarse grid rather than every pixel — fast enough, accurate enough
  const STEP = 8;
  for (let y = 0; y < H; y += STEP) {
    for (let x = 0; x < W; x += STEP) {
      const e = elevAt(x, y);
      if (e < minElev) minElev = e;
      if (e > maxElev) maxElev = e;
    }
  }
  // Guard against flat/ocean scenes
  if (maxElev - minElev < 1) { minElev = 0; maxElev = 1; }

  // Bilinear-interpolated sampler in UV space (0..1 → canvas pixels)
  const getElevation = (u, v) => {
    const px = u * (W - 1);
    const py = v * (H - 1);
    const x0 = Math.floor(px), x1 = Math.min(x0 + 1, W - 1);
    const y0 = Math.floor(py), y1 = Math.min(y0 + 1, H - 1);
    const fx = px - x0, fy = py - y0;
    return (
      elevAt(x0, y0) * (1 - fx) * (1 - fy) +
      elevAt(x1, y0) *      fx  * (1 - fy) +
      elevAt(x0, y1) * (1 - fx) *      fy  +
      elevAt(x1, y1) *      fx  *      fy
    );
  };

  console.info(`[TripMapper] Elevation range: ${minElev.toFixed(0)}m – ${maxElev.toFixed(0)}m`);
  return { getElevation, minElev, maxElev };
}

// Cached Three.js addon modules and font — lazily loaded on first label export
let _FontLoader   = null;
let _TextGeometry = null;
let _labelFont    = null;

async function exportForBlender() {
  if (!routePoints.length) return;

  exportBtn.disabled = true;
  exportBtn.textContent = 'Exporting…';
  let exported = false;

  try {
    // Lazy-load Three.js (heavy — only loaded on first export)
    const THREE = await import('three');
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');

    // Fetch tiles covering the full route at the best zoom — fully viewport-independent
    exportBtn.textContent = 'Fetching map…';
    const { canvas: mapCanvas, projectLatLng, canvasW, canvasH,
            tMinX, tMaxX, tMinY, tMaxY, z: tileZ, toTileF } = await captureRouteTiles();

    // Scale plane so its longest side = 10 Blender units
    const aspect = canvasW / canvasH;
    const planeW = aspect >= 1 ? 10 : 10 * aspect;
    const planeH = aspect >= 1 ? 10 / aspect : 10;

    // ── Terrain heightmap (optional) ───────────────────────────────
    const usesTerrain = terrainCheck.checked;
    let hmap = null; // { getElevation, minElev, maxElev }
    if (usesTerrain) {
      exportBtn.textContent = 'Fetching terrain…';
      hmap = await buildTerrainHeightmap(tMinX, tMaxX, tMinY, tMaxY, tileZ, toTileF);
    }

    // elevScale maps metres → Blender units.
    // Auto-normalize so the full elevation range of the scene occupies 15% of
    // planeW at 1× relief, then apply the user's multiplier on top.
    const elevRange = hmap ? (hmap.maxElev - hmap.minElev) : 1;
    const baseScale = (planeW * 0.05) / elevRange;
    const elevScale = baseScale * RELIEF_MULTS[Number(reliefSlider.value)];
    // Small constant clearance keeps tube above the terrain surface
    const CLEARANCE = planeW * 0.003;

    // Helper: Y position for a canvas UV coordinate
    const terrainY = (u, v) =>
      hmap ? (hmap.getElevation(u, v) - hmap.minElev) * elevScale : 0;

    // ── Map plane ──────────────────────────────────────────────────
    const texture = new THREE.CanvasTexture(mapCanvas);
    // Use the default flipY=true — GLTFExporter compensates by flipping UV V coords,
    // so the exported file has correct north-south orientation in Blender.

    // With terrain: subdivide into 150×150 quads so each vertex can be
    // displaced. Without terrain: a single quad is sufficient.
    const SEGS = usesTerrain ? 499 : 1;
    const planeGeo = new THREE.PlaneGeometry(planeW, planeH, SEGS, SEGS);
    // Rotate so the plane lies flat (XZ plane) in Y-up glTF space
    planeGeo.rotateX(-Math.PI / 2);

    if (usesTerrain) {
      // Displace each vertex in Y according to the decoded elevation.
      // After rotateX, layout in the position buffer is [x, y, z] where
      // y is the up axis. U = (x/planeW + 0.5), V = (z/planeH + 0.5).
      const pos = planeGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i);
        const vz = pos.getZ(i);
        const u  = vx / planeW + 0.5;
        const v  = vz / planeH + 0.5;
        pos.setY(i, terrainY(u, v));
      }
      pos.needsUpdate = true;
      planeGeo.computeVertexNormals();
    }

    const planeMat  = new THREE.MeshStandardMaterial({ map: texture });
    const planeMesh = new THREE.Mesh(planeGeo, planeMat);
    planeMesh.name  = 'MapPlane';

    // ── Route tube ────────────────────────────────────────────────
    let curve;
    let tubeGeo;

    if (travelMode === 'flight') {
      // Per-leg independent curves with a fixed cruise altitude profile:
      //   takeoff → climb → flat cruise → descent → landing.
      // Each leg is its own CatmullRomCurve3 so waypoints are hard stops.
      // Cruise altitude sits above the highest terrain point in the scene,
      // guaranteeing it never clips through the map at any relief setting.
      const maxTerrainY  = hmap ? (hmap.maxElev - hmap.minElev) * elevScale : 0;
      const CRUISE_ALT = maxTerrainY + planeW * 0.04;

      // Quintic Bézier (degree 5, 6 control points) subclass.
      // With the last THREE control points all at CRUISE_ALT, both the first AND
      // second derivatives in Y are exactly zero at t=1 — C2 continuity with the
      // LineCurve3, which means zero curvature at the transition. No sharp bend.
      //   1st deriv  ∝ P5−P4       → CRUISE_ALT−CRUISE_ALT = 0  ✓ (C1, horizontal)
      //   2nd deriv  ∝ P5−2P4+P3   → 0−0+0               = 0  ✓ (C2, zero curvature)
      class QuinticBezierCurve3 extends THREE.Curve {
        constructor(p0,p1,p2,p3,p4,p5){ super(); this.pts=[p0,p1,p2,p3,p4,p5]; }
        getPoint(t, out = new THREE.Vector3()) {
          const [p0,p1,p2,p3,p4,p5] = this.pts;
          const u = 1-t;
          const b = [u**5, 5*u**4*t, 10*u**3*t**2, 10*u**2*t**3, 5*u*t**4, t**5];
          return out.set(
            b[0]*p0.x+b[1]*p1.x+b[2]*p2.x+b[3]*p3.x+b[4]*p4.x+b[5]*p5.x,
            b[0]*p0.y+b[1]*p1.y+b[2]*p2.y+b[3]*p3.y+b[4]*p4.y+b[5]*p5.y,
            b[0]*p0.z+b[1]*p1.z+b[2]*p2.z+b[3]*p3.z+b[4]*p4.z+b[5]*p5.z,
          );
        }
      }

      // Smooth slider: controls CLIMB_FRAC (how much of each leg is climb/descent)
      // AND p2Y (how early the curve starts flattening into cruise altitude).
      // Higher levels = longer S-curves + earlier flattening = gentler transition.
      const FLIGHT_CLIMB_FRACS = [0.10, 0.18, 0.25, 0.35, 0.48];
      const FLIGHT_P2Y_FRAC    = [0.55, 0.65, 0.75, 0.85, 0.93]; // fraction toward CRUISE_ALT
      const CLIMB_FRAC = FLIGHT_CLIMB_FRACS[Number(smoothSlider.value)];
      const p2YFrac    = FLIGHT_P2Y_FRAC[Number(smoothSlider.value)];
      const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');

      // Build all leg CurvePaths first so we can measure their actual 3D arc
      // lengths before allocating tube segments proportionally (keeps Build
      // modifier in sync with Follow Curve in Blender).
      const legPaths = [];
      for (let i = 0; i < waypoints.length - 1; i++) {
        const pA = projectLatLng(waypoints[i].latlng.lat,     waypoints[i].latlng.lng);
        const pB = projectLatLng(waypoints[i + 1].latlng.lat, waypoints[i + 1].latlng.lng);
        const ax = (pA.px / canvasW - 0.5) * planeW,  az = (pA.py / canvasH - 0.5) * planeH;
        const bx = (pB.px / canvasW - 0.5) * planeW,  bz = (pB.py / canvasH - 0.5) * planeH;
        const aU = pA.px / canvasW, aV = pA.py / canvasH;
        const bU = pB.px / canvasW, bV = pB.py / canvasH;
        const aY = terrainY(aU, aV) + CLEARANCE;
        const bY = terrainY(bU, bV) + CLEARANCE;
        const dx = bx - ax, dz = bz - az;
        const cf = CLIMB_FRAC;

        // Climb — 6 control points.
        // P0: takeoff (ground).  P1,P2: shape the S-curve body.
        // P3,P4,P5: all at CRUISE_ALT → C2 at t=1, zero curvature joining LineCurve3.
        const climbEnd = new THREE.Vector3(ax + dx*cf, CRUISE_ALT, az + dz*cf);
        const climb = new QuinticBezierCurve3(
          new THREE.Vector3(ax,              aY,                              az),
          new THREE.Vector3(ax + dx*cf*0.25, aY + (CRUISE_ALT-aY)*0.3,       az + dz*cf*0.25),
          new THREE.Vector3(ax + dx*cf*0.55, aY + (CRUISE_ALT-aY)*p2YFrac,   az + dz*cf*0.55),
          new THREE.Vector3(ax + dx*cf*0.75, CRUISE_ALT,                      az + dz*cf*0.75),
          new THREE.Vector3(ax + dx*cf*0.90, CRUISE_ALT,                      az + dz*cf*0.90),
          climbEnd,
        );

        // Descent — mirror of climb.
        // P0,P1,P2: all at CRUISE_ALT → C2 at t=0, zero curvature departing LineCurve3.
        const descentStart = new THREE.Vector3(ax + dx*(1-cf), CRUISE_ALT, az + dz*(1-cf));
        const descent = new QuinticBezierCurve3(
          descentStart,
          new THREE.Vector3(ax + dx*(1-cf*0.90), CRUISE_ALT,                      az + dz*(1-cf*0.90)),
          new THREE.Vector3(ax + dx*(1-cf*0.75), CRUISE_ALT,                      az + dz*(1-cf*0.75)),
          new THREE.Vector3(ax + dx*(1-cf*0.55), bY + (CRUISE_ALT-bY)*p2YFrac,   az + dz*(1-cf*0.55)),
          new THREE.Vector3(ax + dx*(1-cf*0.25), bY + (CRUISE_ALT-bY)*0.3,       az + dz*(1-cf*0.25)),
          new THREE.Vector3(bx,                  bY,                              bz),
        );

        const legPath = new THREE.CurvePath();
        legPath.add(climb);
        if (climbEnd.distanceTo(descentStart) > planeW * 1e-3) {
          legPath.add(new THREE.LineCurve3(climbEnd, descentStart));
        }
        legPath.add(descent);
        legPaths.push(legPath);
      }

      // Measure true 3D arc length of each leg, then distribute 1200 total tube
      // segments proportionally so segment density is uniform across all legs.
      const legLengths  = legPaths.map((p) => p.getLength());
      const totalLength = legLengths.reduce((a, b) => a + b, 0);
      const TOTAL_SEGS  = 1200;

      const legTubeGeos  = [];
      const legCenterPts = [];
      for (let i = 0; i < legPaths.length; i++) {
        const segs = Math.max(4, Math.round(TOTAL_SEGS * legLengths[i] / totalLength));
        legTubeGeos.push(new THREE.TubeGeometry(legPaths[i], segs, planeW * 0.004, 8, false));
        legCenterPts.push(...legPaths[i].getPoints(Math.max(4, Math.round(150 * legLengths[i] / totalLength))));
      }

      tubeGeo = mergeGeometries(legTubeGeos);
      // Surrogate with getPoints() so the shared center-line code below works unchanged.
      curve   = { getPoints: () => legCenterPts };

    } else {
      // Project all route points using the tile-math projection for pixel-perfect
      // alignment with the captured map texture.
      const rawPts = routePoints.map(([lat, lng]) => {
        const { px, py } = projectLatLng(lat, lng);
        const u = px / canvasW;
        const v = py / canvasH;
        return new THREE.Vector3(
          (u - 0.5) * planeW,
          terrainY(u, v) + CLEARANCE,
          (v - 0.5) * planeH,
        );
      });

      // Pass 1 — moving-average smooth.
      // When terrain is enabled, include Y in the average so elevation spikes
      // are smoothed along with the XZ path — prevents the tube clipping into
      // terrain between GPS points.
      const { r: SMOOTH_R, ctrl: MAX_CTRL } = SMOOTH_PARAMS[Number(smoothSlider.value)];
      const smoothed = rawPts.map((_, i) => {
        const j0 = Math.max(0, i - SMOOTH_R);
        const j1 = Math.min(rawPts.length - 1, i + SMOOTH_R);
        let x = 0, y = 0, z = 0, n = 0;
        for (let j = j0; j <= j1; j++) { x += rawPts[j].x; y += rawPts[j].y; z += rawPts[j].z; n++; }
        return new THREE.Vector3(x / n, y / n, z / n);
      });

      // Pass 2 — decimate smoothed points to ≤MAX_CTRL control points.
      // With smooth input, CatmullRom between widely-spaced control points won't
      // overshoot, so the tube stays within the plane bounds.
      const step    = Math.max(1, Math.ceil(smoothed.length / MAX_CTRL));
      const ctrlPts = smoothed.filter((_, i) => i % step === 0 || i === smoothed.length - 1);

      curve   = new THREE.CatmullRomCurve3(ctrlPts, false, 'centripetal');
      tubeGeo = new THREE.TubeGeometry(
        curve,
        1200,          // tube segments — high resolution, independent of control count
        planeW * 0.004,
        8,
        false
      );
    }

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

    // ── Waypoint label meshes ───────────────────────────────────────
    const labelMeshes = [];
    if (exportLabelsCheck.checked) {
      const labelsToExport = waypoints
        .map((wp) => ({ text: wp.label || wp.placeName, latlng: wp.latlng }))
        .filter((l) => l.text);

      if (labelsToExport.length > 0) {
        try {
          if (!_FontLoader || !_TextGeometry) {
            try {
              if (!_FontLoader) {
                ({ FontLoader: _FontLoader } = await import('three/addons/loaders/FontLoader.js'));
              }
              if (!_TextGeometry) {
                ({ TextGeometry: _TextGeometry } = await import('three/addons/geometries/TextGeometry.js'));
              }
            } catch (err) {
              _FontLoader = null;
              _TextGeometry = null;
              throw err;
            }
          }
          if (!_labelFont) {
            const fontLoader = new _FontLoader();
            _labelFont = await new Promise((resolve, reject) => {
              fontLoader.load(
                'https://cdn.jsdelivr.net/npm/three@0.163.0/examples/fonts/helvetiker_regular.typeface.json',
                resolve,
                undefined,
                reject,
              );
            });
          }

          const labelColor = new THREE.Color('#ffffff');
          const labelMat = new THREE.MeshStandardMaterial({
            color:             labelColor,
            emissive:          labelColor,
            emissiveIntensity: 1.5,
          });

          for (const { text, latlng } of labelsToExport) {
            const textGeo = new _TextGeometry(text, {
              font:  _labelFont,
              size:  planeW * 0.018,
              depth: planeW * 0.003,
            });
            textGeo.computeBoundingBox();
            const bb = textGeo.boundingBox;
            // Center horizontally before rotating to lie flat
            textGeo.translate(-(bb.max.x + bb.min.x) / 2, 0, 0);
            textGeo.rotateX(-Math.PI / 2);

            const { px: lpx, py: lpy } = projectLatLng(latlng.lat, latlng.lng);
            const lu = lpx / canvasW;
            const lv = lpy / canvasH;
            const lx = (lu - 0.5) * planeW;
            const lz = (lv - 0.5) * planeH;
            // Elevate labels above terrain surface (or the flat plane)
            const ly = terrainY(lu, lv) + CLEARANCE * 3 + (usesTerrain ? 0 : 0.06);

            const textMesh = new THREE.Mesh(textGeo, labelMat);
            // Offset northward so the label sits above its waypoint marker
            textMesh.position.set(lx, ly, lz - planeH * 0.025);
            textMesh.name = `Label_${text}`;
            labelMeshes.push(textMesh);
          }
        } catch (err) {
          console.warn('[TripMapper] Failed to export labels; continuing with route export only:', err.message ?? err);
        }
      }
    }

    // ── Scene & export ──────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.add(planeMesh, routeMesh, centerLine, ...labelMeshes);

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

// ─── Restore persisted state on load ─────────────────────────────────────────
restoreState();
// Sync terrain relief row to whatever the browser restored the checkbox to.
terrainReliefRow.classList.toggle('hidden', !terrainCheck.checked);
