// Wraps OpenSheetMusicDisplay so the trainer can render a song's
// MusicXML notation full-bleed and drive its cursor from the
// playback clock. The MusicXML is fetched once per song id and
// cached in-memory; the render itself is fairly heavy (~50ms+
// for a typical piece), so we only render when the SHEET view is
// active.

let OSMD = null;

async function loadOSMD() {
  if (OSMD) return OSMD;
  const mod = await import('opensheetmusicdisplay');
  OSMD = mod.OpenSheetMusicDisplay;
  return OSMD;
}

const xmlCache = new Map();

async function fetchNotation(id) {
  if (xmlCache.has(id)) return { state: 'ready', xml: xmlCache.get(id) };
  const res = await fetch(`/api/songs/${encodeURIComponent(id)}/notation`);
  if (res.status === 202) {
    let body = null;
    try { body = await res.json(); } catch { /* tolerate empty bodies */ }
    const status = body?.status || 'pending';
    return {
      state: status === 'failed' ? 'failed' : 'pending',
      error: body?.error || null,
    };
  }
  if (res.status === 404) return { state: 'no-song' };
  if (!res.ok) return { state: 'error', error: `notation fetch ${res.status}` };
  const xml = await res.text();
  xmlCache.set(id, xml);
  return { state: 'ready', xml };
}

export async function retryNotation(id) {
  const res = await fetch(`/api/songs/${encodeURIComponent(id)}/notation/retry`, { method: 'POST' });
  // Forget any cached entry so the next load re-fetches.
  xmlCache.delete(id);
  return res.ok;
}

export function createSheet(container) {
  let osmd = null;
  let currentId = null;          // song id we last loaded
  let timeMap = null;            // [{ time, x, y, page, measure }]
  let songDuration = 0;
  let cursorEl = null;

  function ensureCursor() {
    if (cursorEl && container.contains(cursorEl)) return cursorEl;
    cursorEl = document.createElement('div');
    cursorEl.className = 'sheet-cursor';
    container.appendChild(cursorEl);
    return cursorEl;
  }

  async function load(songId, { force = false } = {}) {
    if (!songId) {
      reset();
      return { state: 'no-song' };
    }
    if (!force && currentId === songId && osmd) return { state: 'ready' };
    const result = await fetchNotation(songId);
    if (result.state !== 'ready') return result;
    const xml = result.xml;
    const Ctor = await loadOSMD();
    if (!osmd) {
      osmd = new Ctor(container, {
        autoResize: true,
        backend: 'svg',
        drawTitle: true,
        drawComposer: true,
        drawSubtitle: false,
        drawPartNames: false,
        drawingParameters: 'compact',
        followCursor: true,
      });
    }
    await osmd.load(xml);
    osmd.render();
    currentId = songId;
    buildTimeMap();
    ensureCursor();
    return { state: 'ready' };
  }

  function buildTimeMap() {
    // OSMD's iterator gives us measure-level objects with absolute
    // beat timestamps. Convert beats → seconds using whatever tempo
    // the score declares (fall back to 120 BPM); store an x/y
    // pixel anchor so the cursor can interpolate without re-walking
    // OSMD's structures every frame.
    timeMap = [];
    songDuration = 0;
    if (!osmd?.Sheet) return;
    const sheet = osmd.Sheet;
    const tempoBpm = (sheet.HasBPMInfo && sheet.DefaultStartTempoInBpm)
      || sheet.DefaultStartTempoInBpm
      || 120;
    let secondsPerBeat = 60 / tempoBpm;
    let timeSec = 0;
    for (const measure of sheet.SourceMeasures || []) {
      const ms = osmd.GraphicSheet?.findGraphicalMeasure(0, measure.MeasureNumber - 1)
        || osmd.GraphicSheet?.MeasureList?.[measure.MeasureNumber - 1]?.[0];
      const x = ms?.PositionAndShape?.AbsolutePosition?.x ?? 0;
      const y = ms?.PositionAndShape?.AbsolutePosition?.y ?? 0;
      const w = ms?.PositionAndShape?.Size?.width ?? 0;
      const beats = (measure.Duration?.RealValue ?? 0) * 4; // RealValue is in whole notes
      const dur = beats * secondsPerBeat;
      timeMap.push({ time: timeSec, dur, x, y, w, measureNumber: measure.MeasureNumber });
      timeSec += dur;
    }
    songDuration = timeSec;
  }

  function moveCursor(currentTime) {
    if (!osmd || !timeMap || timeMap.length === 0) return;
    const cur = ensureCursor();
    let entry = timeMap[0];
    for (let i = 0; i < timeMap.length; i++) {
      if (timeMap[i].time + timeMap[i].dur >= currentTime) { entry = timeMap[i]; break; }
      entry = timeMap[i];
    }
    const localT = entry.dur > 0 ? Math.max(0, Math.min(1, (currentTime - entry.time) / entry.dur)) : 0;
    // OSMD positions are in "OSMD units" (10 = 1cm at default zoom)
    // convert via the SVG's known unit-to-pixel ratio.
    const unit = osmd.unit || 10;
    const pxX = (entry.x + entry.w * localT) * unit;
    const pxY = entry.y * unit;
    cur.style.transform = `translate(${pxX}px, ${pxY}px)`;
    cur.style.height = `${(osmd.GraphicSheet?.MusicSystems?.[0]?.PositionAndShape?.Size?.height || 5) * unit * 2}px`;

    // Auto-scroll the container so the cursor stays in view.
    const cRect = container.getBoundingClientRect();
    const cursorTop = pxY - container.scrollTop;
    if (cursorTop > cRect.height * 0.7) {
      container.scrollTop = pxY - cRect.height * 0.4;
    } else if (cursorTop < cRect.height * 0.1 && container.scrollTop > 0) {
      container.scrollTop = Math.max(0, pxY - cRect.height * 0.2);
    }
  }

  function reset() {
    if (osmd) {
      try { osmd.clear(); } catch { /* ignore */ }
    }
    currentId = null;
    timeMap = null;
    if (cursorEl) cursorEl.style.transform = 'translate(-9999px,-9999px)';
  }

  return {
    load,
    moveCursor,
    reset,
    isReady: () => !!osmd && !!timeMap,
    getDuration: () => songDuration,
  };
}
