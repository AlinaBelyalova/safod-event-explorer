(() => {
  "use strict";

  const BUILD = window.SAFOD_BUILD_ID || String(Date.now());

  const els = {
    search: document.getElementById("searchInput"),
    depthMin: document.getElementById("depthMin"),
    depthMax: document.getElementById("depthMax"),
    depthMinLabel: document.getElementById("depthMinLabel"),
    depthMaxLabel: document.getElementById("depthMaxLabel"),
    magMin: document.getElementById("magMin"),
    magMax: document.getElementById("magMax"),
    magMinLabel: document.getElementById("magMinLabel"),
    magMaxLabel: document.getElementById("magMaxLabel"),
    dateFrom: document.getElementById("dateFrom"),
    dateTo: document.getElementById("dateTo"),
    geometry: document.getElementById("geometryFilter"),
    recording: document.getElementById("recordingFilter"),
    onlyWithPlots: document.getElementById("onlyWithPlots"),
    reset: document.getElementById("resetFilters"),
    visibleCount: document.getElementById("visibleCount"),
    filterSummary: document.getElementById("filterSummary"),
    statusSummary: document.getElementById("statusSummary"),
    coverageText: document.getElementById("coverageText"),
    updatedText: document.getElementById("updatedText"),
    plotCountText: document.getElementById("plotCountText"),
    mapNotice: document.getElementById("mapNotice"),
    dialog: document.getElementById("eventDialog"),
    closeDialog: document.getElementById("closeDialog"),
    dialogTitle: document.getElementById("dialogTitle"),
    dialogSubtitle: document.getElementById("dialogSubtitle"),
    dialogMetadata: document.getElementById("dialogMetadata"),
    plotSelectorWrap: document.getElementById("plotSelectorWrap"),
    plotSelector: document.getElementById("plotSelector"),
    plotUnavailable: document.getElementById("plotUnavailable"),
    plotLink: document.getElementById("plotLink"),
    dialogPlot: document.getElementById("dialogPlot"),
    officialEventLink: document.getElementById("officialEventLink"),
    fullImageLink: document.getElementById("fullImageLink"),
  };

  const state = {
    events: [],
    byId: new Map(),
    markers: new Map(),
    map: null,
    eventLayer: null,
    config: null,
    status: null,
    currentEvent: null,
  };

  function fetchJson(url) {
    const joiner = url.includes("?") ? "&" : "?";
    return fetch(`${url}${joiner}v=${encodeURIComponent(BUILD)}`, {
      cache: "no-cache",
    }).then((response) => {
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}: ${url}`);
      }
      return response.json();
    });
  }

  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmtNumber(value, digits = 2, suffix = "") {
    return finite(value) ? `${value.toFixed(digits)}${suffix}` : "—";
  }

  function fmtMagnitude(event) {
    if (!finite(event.magnitude)) return "M —";
    const type = event.magnitude_type ? ` ${event.magnitude_type}` : "";
    return `M ${event.magnitude.toFixed(2)}${type}`;
  }

  function fmtTime(iso) {
    if (!iso) return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(date);
  }

  function dateToken(iso) {
    return iso ? String(iso).slice(0, 10) : "";
  }

  function depthColor(depth, maxDepth) {
    if (!finite(depth)) return "#777";
    const t = Math.max(0, Math.min(1, depth / Math.max(maxDepth, 1)));
    const stops = [
      [247, 217, 76],
      [242, 158, 46],
      [223, 78, 53],
      [139, 63, 143],
      [50, 36, 110],
    ];
    const x = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(x));
    const f = x - i;
    const rgb = stops[i].map((v, k) =>
      Math.round(v + f * (stops[i + 1][k] - v))
    );
    return `rgb(${rgb.join(",")})`;
  }

  function markerRadius(mag) {
    if (!finite(mag)) return 5;
    return Math.max(4, Math.min(16, 5 + 2.4 * (mag + 0.2)));
  }

  function addSelectOptions(select, values) {
    values
      .filter((x) => x !== null && x !== undefined && String(x).trim() !== "")
      .map((x) => String(x))
      .filter((x, i, a) => a.indexOf(x) === i)
      .sort()
      .forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      });
  }

  function initControls() {
    const depths = state.events.map((e) => e.depth_km).filter(finite);
    const mags = state.events.map((e) => e.magnitude).filter(finite);
    const dates = state.events.map((e) => dateToken(e.origin_time_utc)).filter(Boolean);

    const depthMin = Math.floor(Math.min(...depths, 0) * 10) / 10;
    const depthMax = Math.ceil(Math.max(...depths, 1) * 10) / 10;
    const magMin = mags.length ? Math.floor(Math.min(...mags) * 10) / 10 : -1;
    const magMax = mags.length ? Math.ceil(Math.max(...mags) * 10) / 10 : 4;

    [
      [els.depthMin, depthMin, depthMax, depthMin],
      [els.depthMax, depthMin, depthMax, depthMax],
      [els.magMin, magMin, magMax, magMin],
      [els.magMax, magMin, magMax, magMax],
    ].forEach(([input, min, max, value]) => {
      input.min = String(min);
      input.max = String(max);
      input.value = String(value);
    });

    if (dates.length) {
      const first = dates.reduce((a, b) => (a < b ? a : b));
      const last = dates.reduce((a, b) => (a > b ? a : b));
      els.dateFrom.min = first;
      els.dateFrom.max = last;
      els.dateTo.min = first;
      els.dateTo.max = last;
    }

    addSelectOptions(
      els.geometry,
      state.events.map((e) => e.geometry_2d_class)
    );
    addSelectOptions(
      els.recording,
      state.events.map((e) => e.recording_label)
    );

    updateRangeLabels();
  }

  function updateRangeLabels() {
    if (Number(els.depthMin.value) > Number(els.depthMax.value)) {
      els.depthMax.value = els.depthMin.value;
    }
    if (Number(els.magMin.value) > Number(els.magMax.value)) {
      els.magMax.value = els.magMin.value;
    }

    els.depthMinLabel.textContent = `${Number(els.depthMin.value).toFixed(1)} km`;
    els.depthMaxLabel.textContent = `${Number(els.depthMax.value).toFixed(1)} km`;
    els.magMinLabel.textContent = `M ${Number(els.magMin.value).toFixed(1)}`;
    els.magMaxLabel.textContent = `M ${Number(els.magMax.value).toFixed(1)}`;
  }

  function eventMatches(event) {
    const query = els.search.value.trim().toLowerCase();
    const searchable = [
      event.event_id,
      event.location_name,
      event.recording_label,
      event.geometry_2d_class,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (query && !searchable.includes(query)) return false;

    if (
      finite(event.depth_km) &&
      (
        event.depth_km < Number(els.depthMin.value) ||
        event.depth_km > Number(els.depthMax.value)
      )
    ) return false;

    if (
      finite(event.magnitude) &&
      (
        event.magnitude < Number(els.magMin.value) ||
        event.magnitude > Number(els.magMax.value)
      )
    ) return false;

    const date = dateToken(event.origin_time_utc);
    if (els.dateFrom.value && date < els.dateFrom.value) return false;
    if (els.dateTo.value && date > els.dateTo.value) return false;

    if (
      els.geometry.value &&
      event.geometry_2d_class !== els.geometry.value
    ) return false;

    if (
      els.recording.value &&
      event.recording_label !== els.recording.value
    ) return false;

    if (els.onlyWithPlots.checked && !event.plot_available) return false;

    return true;
  }

  function popupHtml(event) {
    const viewButton = event.plot_available
      ? `<button class="primary js-view-das" data-event-id="${escapeHtml(event.event_id)}">View DAS</button>`
      : `<button disabled>DAS plot unavailable</button>`;

    return `
      <div class="popup-title">${escapeHtml(fmtMagnitude(event))} · ${escapeHtml(event.event_id)}</div>
      <div class="popup-location">${escapeHtml(event.location_name || "SAFOD / Parkfield region")}</div>
      <div class="popup-grid">
        <span class="key">Time</span><span>${escapeHtml(fmtTime(event.origin_time_utc))}</span>
        <span class="key">Location</span><span>${event.latitude.toFixed(5)}°, ${event.longitude.toFixed(5)}°</span>
        <span class="key">Depth</span><span>${fmtNumber(event.depth_km, 2, " km")}</span>
        <span class="key">Cable distance</span><span>${fmtNumber(event.min_3d_distance_to_cable_km, 2, " km")}</span>
        <span class="key">Crossline</span><span>${finite(event.source_crossline_m) ? (event.source_crossline_m / 1000).toFixed(2) + " km" : "—"}</span>
        <span class="key">2-D class</span><span>${escapeHtml(event.geometry_2d_class || "unknown")}</span>
      </div>
      <div class="popup-actions">
        ${viewButton}
        <a href="${escapeHtml(event.event_url)}" target="_blank" rel="noopener">Event page</a>
      </div>
    `;
  }

  function initMap() {
    state.map = L.map("map", {
      preferCanvas: true,
      zoomControl: true,
    }).setView(
      state.config.map_center,
      state.config.map_default_zoom
    );

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(state.map);

    state.eventLayer = L.layerGroup().addTo(state.map);

    state.map.on("popupopen", (popupEvent) => {
      const root = popupEvent.popup.getElement();
      if (!root) return;
      root.querySelectorAll(".js-view-das").forEach((button) => {
        button.addEventListener("click", () => {
          openEventDialog(button.dataset.eventId);
        });
      });
    });
  }

  function drawEvents() {
    const maxDepth = Math.max(
      1,
      ...state.events.map((e) => e.depth_km).filter(finite)
    );

    for (const event of state.events) {
      const marker = L.circleMarker([event.latitude, event.longitude], {
        radius: markerRadius(event.magnitude),
        color: "#ffffff",
        weight: 1.2,
        fillColor: depthColor(event.depth_km, maxDepth),
        fillOpacity: 0.88,
      });

      marker.bindTooltip(
        `${escapeHtml(event.event_id)} · ${escapeHtml(fmtMagnitude(event))} · ${fmtNumber(event.depth_km, 1, " km")}`,
        { direction: "top", opacity: 0.92 }
      );
      marker.bindPopup(popupHtml(event));
      state.markers.set(event.event_id, marker);
    }

    applyFilters();
  }

  async function drawSafodGeometry() {
    try {
      const geojson = await fetchJson("data/safod_geometry.geojson");
      L.geoJSON(geojson, {
        style: (feature) => {
          const section = feature?.properties?.section || "";
          if (section === "Surface Spool") {
            return { color: "#6b7280", weight: 2, opacity: 0.65, dashArray: "5 4" };
          }
          if (section === "Up-leg") {
            return { color: "#111827", weight: 3, opacity: 0.9 };
          }
          return { color: "#334155", weight: 3, opacity: 0.95 };
        },
        pointToLayer: (feature, latlng) => {
          const kind = feature?.properties?.kind;
          const radius = kind === "wellhead" ? 8 : 5;
          return L.circleMarker(latlng, {
            radius,
            color: "#111827",
            weight: 2,
            fillColor: kind === "wellhead" ? "#ffffff" : "#111827",
            fillOpacity: 1,
          });
        },
        onEachFeature: (feature, layer) => {
          const name = feature?.properties?.name;
          if (name) layer.bindTooltip(escapeHtml(name));
        },
      }).addTo(state.map);
    } catch (error) {
      showNotice(`SAFOD geometry could not be loaded: ${error.message}`);
    }
  }

  function filterSanAndreas(geojson) {
    return {
      type: "FeatureCollection",
      features: (geojson.features || []).filter((feature) => {
        const name = String(feature?.properties?.fault_name || "");
        return name.toLowerCase().includes("san andreas");
      }),
    };
  }

  function addFaultLayer(geojson) {
    const filtered = filterSanAndreas(geojson);
    if (!filtered.features.length) {
      throw new Error("No San Andreas Fault features found.");
    }

    L.geoJSON(filtered, {
      style: {
        color: "#c62828",
        weight: 3,
        opacity: 0.9,
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties || {};
        const label = [p.fault_name, p.section_name].filter(Boolean).join(" — ");
        if (label) layer.bindTooltip(escapeHtml(label), { sticky: true });
      },
    }).addTo(state.map);
  }

  async function drawFault() {
    try {
      const local = await fetchJson("data/san_andreas_fault.geojson");
      addFaultLayer(local);
      return;
    } catch (_) {
      // Expected for a fresh checkout before prepare_fault_geometry has run.
    }

    try {
      const response = await fetch(state.config.fault_remote_query_url);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      const remote = await response.json();
      addFaultLayer(remote);
      showNotice(
        "San Andreas Fault is being loaded live from the USGS. " +
        "Run prepare_fault_geometry.py to cache it locally."
      );
    } catch (error) {
      showNotice(`San Andreas Fault layer unavailable: ${error.message}`);
    }
  }

  function showNotice(message) {
    els.mapNotice.textContent = message;
    els.mapNotice.classList.remove("hidden");
  }

  function applyFilters() {
    updateRangeLabels();

    let visible = 0;
    for (const event of state.events) {
      const marker = state.markers.get(event.event_id);
      if (!marker) continue;
      const show = eventMatches(event);
      const has = state.eventLayer.hasLayer(marker);
      if (show && !has) state.eventLayer.addLayer(marker);
      if (!show && has) state.eventLayer.removeLayer(marker);
      if (show) visible += 1;
    }

    els.visibleCount.textContent = `${visible} / ${state.events.length}`;
    els.filterSummary.textContent = `${visible} recorded earthquake${visible === 1 ? "" : "s"} shown`;
  }

  function resetFilters() {
    els.search.value = "";
    els.depthMin.value = els.depthMin.min;
    els.depthMax.value = els.depthMax.max;
    els.magMin.value = els.magMin.min;
    els.magMax.value = els.magMax.max;
    els.dateFrom.value = "";
    els.dateTo.value = "";
    els.geometry.value = "";
    els.recording.value = "";
    els.onlyWithPlots.checked = false;
    applyFilters();
  }

  function metadataItem(label, value) {
    return `
      <div class="metadata-item">
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${escapeHtml(value ?? "—")}</div>
      </div>
    `;
  }

  function selectPlot(index) {
    const event = state.currentEvent;
    if (!event || !event.plots?.length) return;
    const plot = event.plots[index] || event.plots[0];
    els.dialogPlot.src = plot.url;
    els.plotLink.href = plot.url;
    els.fullImageLink.href = plot.url;
    els.plotLink.classList.remove("hidden");
    els.fullImageLink.classList.remove("hidden");
    els.plotUnavailable.classList.add("hidden");
  }

  function openEventDialog(eventId) {
    const event = state.byId.get(eventId);
    if (!event) return;

    state.currentEvent = event;
    els.dialogTitle.textContent = `${fmtMagnitude(event)} · ${event.event_id}`;
    els.dialogSubtitle.textContent = event.location_name || "SAFOD / Parkfield region";

    els.dialogMetadata.innerHTML = [
      metadataItem("Origin (UTC)", fmtTime(event.origin_time_utc)),
      metadataItem("Latitude", `${event.latitude.toFixed(5)}°`),
      metadataItem("Longitude", `${event.longitude.toFixed(5)}°`),
      metadataItem("Depth", fmtNumber(event.depth_km, 2, " km")),
      metadataItem("Cable distance", fmtNumber(event.min_3d_distance_to_cable_km, 2, " km")),
      metadataItem(
        "Crossline",
        finite(event.source_crossline_m)
          ? `${(event.source_crossline_m / 1000).toFixed(2)} km`
          : "—"
      ),
      metadataItem("2-D geometry", event.geometry_2d_class || "unknown"),
      metadataItem("Recording", event.recording_label || "—"),
    ].join("");

    els.officialEventLink.href = event.event_url;

    els.plotSelector.innerHTML = "";
    if (event.plots?.length) {
      event.plots.forEach((plot, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = plot.label || `DAS plot ${index + 1}`;
        els.plotSelector.appendChild(option);
      });
      els.plotSelectorWrap.classList.toggle("hidden", event.plots.length < 2);
      selectPlot(0);
    } else {
      els.plotSelectorWrap.classList.add("hidden");
      els.plotUnavailable.classList.remove("hidden");
      els.plotLink.classList.add("hidden");
      els.fullImageLink.classList.add("hidden");
      els.dialogPlot.removeAttribute("src");
    }

    if (!els.dialog.open) els.dialog.showModal();
    history.replaceState(null, "", `#event=${encodeURIComponent(event.event_id)}`);
  }

  function closeEventDialog() {
    if (els.dialog.open) els.dialog.close();
    state.currentEvent = null;
    els.dialogPlot.removeAttribute("src");
    if (location.hash.startsWith("#event=")) {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }

  function bindControls() {
    [
      els.search,
      els.depthMin,
      els.depthMax,
      els.magMin,
      els.magMax,
      els.dateFrom,
      els.dateTo,
      els.geometry,
      els.recording,
      els.onlyWithPlots,
    ].forEach((element) => {
      element.addEventListener("input", applyFilters);
      element.addEventListener("change", applyFilters);
    });

    els.reset.addEventListener("click", resetFilters);
    els.closeDialog.addEventListener("click", closeEventDialog);
    els.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeEventDialog();
    });
    els.plotSelector.addEventListener("change", () => {
      selectPlot(Number(els.plotSelector.value));
    });
    window.addEventListener("hashchange", openHashEvent);
  }

  function updateStatus() {
    const status = state.status;
    els.statusSummary.textContent =
      `${status.recorded_events} events · ${status.plots_available} DAS plots`;

    const first = status.event_time_start_utc
      ? dateToken(status.event_time_start_utc)
      : "—";
    const last = status.event_time_end_utc
      ? dateToken(status.event_time_end_utc)
      : "—";
    els.coverageText.textContent = `Event coverage: ${first} — ${last}`;
    els.updatedText.textContent = `Last built: ${fmtTime(status.generated_utc)}`;
    els.plotCountText.textContent =
      `DAS plots: ${status.plots_available} / ${status.recorded_events}`;
  }

function resolveEventId(value) {
  const raw = String(value || "").trim().toLowerCase();

  const candidates = [raw];

  if (/^nc\d+$/.test(raw)) {
    candidates.push(raw.slice(2));
  } else if (/^\d+$/.test(raw)) {
    candidates.push(`nc${raw}`);
  }

  for (const candidate of candidates) {
    if (state.byId.has(candidate)) {
      return candidate;
    }
  }

  return null;
}


  function openHashEvent() {
    const requestedId = new URLSearchParams(location.hash.slice(1)).get("event");
    if (!requestedId) {
      closeEventDialog();
      return;
    }

    const eventId = resolveEventId(requestedId);
    if (!eventId) return;

    const event = state.byId.get(eventId);
    const marker = state.markers.get(eventId);
    if (event && marker) {
      // A direct link must reveal the marker even if current filters hide it.
      if (!state.eventLayer.hasLayer(marker)) resetFilters();
      state.map.setView(
        [event.latitude, event.longitude],
        Math.max(state.map.getZoom(), 13),
        { animate: false }
      );
      marker.openPopup();
    }

    openEventDialog(eventId);
  }

  async function boot() {
    if (!window.L) {
      throw new Error("Leaflet did not load.");
    }

    const [events, status, config] = await Promise.all([
      fetchJson("data/events.json"),
      fetchJson("data/site_status.json"),
      fetchJson("data/site_config.json"),
    ]);

    state.events = events;
    state.status = status;
    state.config = config;
    state.byId = new Map(events.map((event) => [event.event_id, event]));

    initControls();
    bindControls();
    initMap();
    updateStatus();

    // Create markers before resolving links, without waiting for optional layers.
    drawEvents();
    openHashEvent();

    await Promise.allSettled([
      drawSafodGeometry(),
      drawFault(),
    ]);

    // Keep event markers above the geometry loaded in the background.
    state.eventLayer.eachLayer((marker) => marker.bringToFront());
  }

  boot().catch((error) => {
    console.error(error);
    showNotice(`Explorer failed to start: ${error.message}`);
    els.statusSummary.textContent = "Load error";
  });
})();
