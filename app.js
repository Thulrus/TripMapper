// ─── Map initialisation ─────────────────────────────────────────────────────

const map = L.map('map', { zoomControl: false }).setView([39.5, -98.35], 4);

// Zoom control on the right so it doesn't clash with the search bar
L.control.zoom({ position: 'topright' }).addTo(map);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
    '&copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 20,
}).addTo(map);

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
