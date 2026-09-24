'use strict';
(() => {
  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------
  const $ = (s, r = document) => r.querySelector(s);
  const MAP_SERVER = 'TomTom Maps';
  const MAX_CAMS = 8;

  function el(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const k of kids.flat()) {
      if (k == null || k === false) continue;
      e.append(k instanceof Node ? k : String(k));
    }
    return e;
  }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const pad = (n) => String(n).padStart(2, '0');
  function hms(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
  }
  function fmtClock(ms, withDate = true) {
    if (ms == null || !isFinite(ms)) return '—';
    const d = new Date(ms);
    const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    return withDate ? `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${time}` : time;
  }
  function isoClock(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }
  function mk(y, mo, d, h, mi, s) {
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h >= 0 && h < 24 && mi >= 0 && mi < 60 && s >= 0 && s < 61)) return null;
    return Date.UTC(y, mo - 1, d, h, mi, Math.floor(s));
  }
  function parseClock(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? (v > 1e11 ? v : v * 1000) : null;
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?/);
    if (m) return mk(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0));
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?/);
    if (m) {
      let y = +m[3];
      if (y < 100) y += 2000;
      return mk(y, +m[2], +m[1], +m[4], +m[5], +(m[6] || 0));
    }
    if (/^\d{1,2}:\d{2}/.test(s)) return null;
    const t = Date.parse(s);
    return isNaN(t) ? null : t;
  }
  function parseTimeOnly(v) {
    const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    return m ? +m[1] * 3600 + +m[2] * 60 + +(m[3] || 0) : null;
  }
  function num(v) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v;
    const s = String(v).trim().replace(/\s/g, '');
    return parseFloat(/^-?\d+,\d+$/.test(s) ? s.replace(',', '.') : s);
  }
  const numOrNull = (v) => (isFinite(num(v)) ? num(v) : null);
  const validLL = (lat, lon) =>
    isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(Math.abs(lat) < 0.01 && Math.abs(lon) < 0.01);
  function distKm(a, b) {
    const r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r;
    const dLon = (b.lon - a.lon) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function bearing(a, b) {
    const r = Math.PI / 180;
    const y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
    const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch {
        /* almacenamiento no disponible */
      }
    },
  };
  function once(target, ev, ms) {
    return new Promise((resolve, reject) => {
      let timer = null;
      const done = () => {
        clearTimeout(timer);
        target.removeEventListener(ev, done);
        resolve();
      };
      target.addEventListener(ev, done);
      if (ms) {
        timer = setTimeout(() => {
          target.removeEventListener(ev, done);
          reject(new Error('timeout ' + ev));
        }, ms);
      }
    });
  }
  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  const toJpeg = (c, q = 0.85) => new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', q));
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ---------------------------------------------------------------------------
  // Enfoques del analista (agregar uno nuevo = agregar un objeto a esta lista)
  // ---------------------------------------------------------------------------
  const ENFOQUES = [
    {
      id: 'general',
      nombre: 'General',
      instr: 'Describe con detalle lo que ocurre en cada cámara: personas y lo que hacen, objetos, entorno, estado del vehículo y cualquier situación fuera de lo normal.',
    },
    {
      id: 'pasajeros',
      nombre: 'Pasajeros',
      instr: 'Enfócate en los pasajeros: cuántos hay aproximadamente, si suben o bajan, si van de pie o sentados, nivel de ocupación, comportamientos llamativos y objetos olvidados.',
    },
    {
      id: 'seguridad',
      nombre: 'Seguridad e incidentes',
      instr: 'Enfócate en seguridad: riñas, robos, acoso, vandalismo, personas sospechosas, armas u objetos peligrosos, caídas, emergencias médicas y puertas abiertas con el bus en marcha.',
    },
    {
      id: 'conductor',
      nombre: 'Conductor',
      instr: 'Enfócate en el conductor y la conducción: uso del celular, distracciones, señales de fatiga, cinturón de seguridad, trato con pasajeros, cobro, maniobras y distancia con otros vehículos.',
    },
    {
      id: 'paradas',
      nombre: 'Puertas y paradas',
      instr: 'Enfócate en puertas y paradas: si el bus está detenido o en marcha, apertura y cierre de puertas, ascenso y descenso de pasajeros y paradas fuera de lugar.',
    },
    {
      id: 'vial',
      nombre: 'Tránsito',
      instr: 'Enfócate en la vía: tráfico, semáforos, peatones, ciclistas, otros vehículos, clima, estado del camino y posibles infracciones o incidentes viales.',
    },
    {
      id: 'vehiculo',
      nombre: 'Estado del vehículo',
      instr: 'Enfócate en el estado del vehículo y de las cámaras: limpieza, daños visibles, asientos, iluminación, objetos sueltos, y cámaras borrosas, obstruidas o sin señal.',
    },
  ];
  const TIERS = { quick: 'Ligero', default: 'Normal', complex: 'Máximo' };
  const RULES =
    'Eres un analista profesional de video de seguridad para flotas de transporte público. Analizas grabaciones de las cámaras a bordo de un autobús (MDVR). ' +
    'Escribe siempre en español claro, profesional y concreto, como en un reporte de monitoreo. Describe solo lo que realmente se ve; si algo no se distingue bien, dilo ("no se distingue", "posiblemente"). ' +
    'No inventes identidades ni datos y no identifiques personas por su nombre. Ubica cada hecho por cámara y hora.';

  // ---------------------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------------------
  const S = {
    cams: [],
    t: 0,
    duration: 0,
    playing: false,
    rate: 1,
    focusCam: null,
    track: [],
    clockPts: [],
    trackMeta: null,
    shift: 0,
    osd: { items: [], camKey: null, bands: {} },
    osdClockRef: null,
    busId: null,
    analyses: [],
    index: [],
    indexFocus: null,
    qa: [],
    qaOpen: 1,
    autoRun: store.get('cofcam:auto', true),
    autoTried: false,
    prepRun: null,
    reportMd: '',
    focusId: 'general',
    tier: 'quick',
    usage: 0,
    customFocus: store.get('cofcam:focus', []),
    sample: undefined,
    limits: null,
    aiOff: null,
    mcp: undefined,
    mapOff: false,
    downloads: undefined,
    busy: null,
    frameCache: new Map(),
    addrCache: new Map(),
    addr: null,
  };

  // ---------------------------------------------------------------------------
  // Avisos y barra de progreso
  // ---------------------------------------------------------------------------
  let toastTimer = null;
  function toast(msg, kind = 'info') {
    const t = $('#toast');
    t.textContent = msg;
    t.dataset.kind = kind;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), kind === 'err' ? 7000 : 4000);
  }
  function busyStart(label) {
    S.busy = { ctl: new AbortController(), stopped: false };
    $('#busy').hidden = false;
    busySet(label, null);
    refreshButtons();
    return S.busy;
  }
  function busySet(label, frac) {
    $('#busyLabel').textContent = label;
    const bar = $('#busyBar');
    if (frac == null) {
      bar.classList.add('indet');
      bar.firstElementChild.style.width = '';
    } else {
      bar.classList.remove('indet');
      bar.firstElementChild.style.width = `${Math.round(clamp(frac, 0, 1) * 100)}%`;
    }
  }
  function busyEnd() {
    S.busy = null;
    $('#busy').hidden = true;
    refreshButtons();
  }
  $('#busyStop').addEventListener('click', () => {
    if (!S.busy) return;
    S.busy.stopped = true;
    S.busy.ctl.abort();
    $('#busyLabel').textContent = 'Deteniendo…';
  });

  function setPill(id, state, text) {
    const p = $(id);
    p.dataset.state = state;
    p.textContent = text;
  }

  // ---------------------------------------------------------------------------
  // Capacidades de claude.ai
  // ---------------------------------------------------------------------------
  function initCaps() {
    const c = window.claude;
    if (!c || typeof c.use !== 'function') {
      S.sample = null;
      S.mcp = null;
      S.downloads = null;
      setPill('#aiPill', 'off', 'Claude: abre la página en claude.ai');
      setPill('#mapPill', 'off', 'Mapa: solo dentro de claude.ai');
      refreshButtons();
      return;
    }
    c.use('sample')
      .then(async (s) => {
        S.sample = s;
        if (!s) {
          setPill('#aiPill', 'off', 'Claude: no disponible aquí');
        } else {
          S.limits = await s.limits().catch(() => null);
          if (imagesOff()) setPill('#aiPill', 'wait', 'Claude: sin imágenes en esta vista');
          else setPill('#aiPill', 'on', 'Claude: listo');
          updateEstimates();
          ocrEstimate();
          renderPrep();
          maybeAutoRun();
        }
        refreshButtons();
      })
      .catch(() => {
        S.sample = null;
        setPill('#aiPill', 'off', 'Claude: no disponible aquí');
        refreshButtons();
      });
    c.use('mcp')
      .then((m) => {
        S.mcp = m;
        if (!m) {
          S.mapOff = true;
          setPill('#mapPill', 'off', 'Mapa: sin mapa base');
          setMapNote('El mapa base no está disponible en esta vista. La ruta se dibuja sobre una cuadrícula.');
        } else {
          setPill('#mapPill', 'wait', 'Mapa: listo');
          if (S.track.length) loadBase();
        }
      })
      .catch(() => {
        S.mcp = null;
        setPill('#mapPill', 'off', 'Mapa: sin mapa base');
      });
    c.use('downloads')
      .then((d) => {
        S.downloads = d;
        refreshButtons();
      })
      .catch(() => {
        S.downloads = null;
      });
  }

  const AI_PERMANENT = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed']);
  function aiMsg(e) {
    const c = e && e.code;
    return (
      {
        not_granted: 'No se dio permiso para usar Claude en esta página. Recarga la página y acepta el permiso para analizar.',
        sampling_disabled: 'Claude no está disponible para tu cuenta u organización.',
        not_declared: 'Esta versión de la página no tiene permiso para usar Claude.',
        capability_disabled: 'Claude no se puede usar en esta vista.',
        capability_removed: 'Claude no se puede usar en esta vista.',
        images_unavailable: 'Esta vista no permite enviar imágenes a Claude.',
        rate_limited: 'Llegaste al límite de uso por ahora. Espera unos minutos y vuelve a intentarlo.',
        session_expired: 'Tu sesión de claude.ai expiró. Vuelve a iniciar sesión.',
        image_rejected: 'Claude no aceptó una de las imágenes. Prueba con menos cámaras o menos momentos.',
        refused: 'Claude no pudo analizar este contenido.',
        invalid_json: 'La respuesta llegó incompleta. Vuelve a intentarlo o pide menos momentos a la vez.',
        prompt_too_large: 'Hay demasiada información para una sola consulta. Reduce los momentos o limpia la conversación.',
        empty_completion: 'Claude no devolvió texto. Vuelve a intentarlo con una indicación más simple.',
      }[c] || 'Hubo un problema de conexión con Claude. Vuelve a intentarlo.'
    );
  }
  function onAiError(e) {
    if (e && e.code === 'cancelled') return;
    if (e && e.code === 'local') return toast(e.message, 'err');
    if (e && e.code === 'images_unavailable') {
      S.limits = { ...(S.limits || {}), images: undefined };
      setPill('#aiPill', 'wait', 'Claude: sin imágenes en esta vista');
      renderPrep();
      return toast(NO_IMAGES, 'err');
    }
    if (e && AI_PERMANENT.has(e.code)) {
      S.aiOff = aiMsg(e);
      setPill('#aiPill', 'off', 'Claude: sin permiso');
      refreshButtons();
    }
    if (!(e && e.code) && e && e.message) console.error(e);
    toast(aiMsg(e), 'err');
  }
  function aiReady(needImages = true) {
    if (S.sample === undefined) {
      toast('Claude todavía se está conectando. Espera un momento.', 'err');
      return false;
    }
    if (!S.sample) {
      toast('El análisis con Claude solo funciona con la página abierta dentro de claude.ai.', 'err');
      return false;
    }
    if (S.aiOff) {
      toast(S.aiOff, 'err');
      return false;
    }
    if (needImages && imagesOff()) {
      toast(NO_IMAGES, 'err');
      return false;
    }
    return true;
  }
  // Estimación de tokens: una imagen cuesta aprox. ancho×alto/750 (la plataforma la reduce a ~1,15 MP).
  function imgTokens(w, h) {
    const s = Math.min(1, Math.sqrt(1150000 / Math.max(1, w * h)));
    return Math.ceil((w * s * h * s) / 750);
  }
  const textTokens = (x) => Math.ceil(String(x || '').length / 3.5);
  function spend(tokens) {
    S.usage += Math.max(0, Math.round(tokens));
    persist();
    renderSession();
  }
  const kTok = (n) => (n < 1000 ? `${Math.max(100, Math.round(n / 100) * 100)} tokens` : `${(n / 1000).toFixed(n < 10000 ? 1 : 0)} mil tokens`);
  const maxImages = () => Math.max(1, (S.limits && S.limits.images && S.limits.images.maxCount) || (S.limits ? 1 : 4));

  // ---------------------------------------------------------------------------
  // Cámaras
  // ---------------------------------------------------------------------------
  let camSeq = 0;
  const fileKey = (f) => `${f.name}|${f.size}`;

  function parseFileName(name) {
    const base = name.replace(/\.[^.]+$/, '');
    const out = { startMs: null, endMs: null, channel: null };
    const re = /(?<!\d)(\d{2})(\d{2})(\d{2})[-_ ](\d{2})(\d{2})(\d{2})(?!\d)(?:[-_ ](\d{2})(\d{2})(\d{2})(?!\d))?/g;
    for (const m of base.matchAll(re)) {
      const st = mk(2000 + +m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
      if (st == null) continue;
      out.startMs = st;
      if (m[7]) {
        let en = mk(2000 + +m[1], +m[2], +m[3], +m[7], +m[8], +m[9]);
        if (en != null && en < st) en += 86400000;
        out.endMs = en;
      }
      break;
    }
    if (out.startMs == null) {
      const m = base.match(/(?<!\d)(20\d{2})[-_]?(\d{2})[-_]?(\d{2})[-_ T]?(\d{2})[-_:]?(\d{2})[-_:]?(\d{2})(?!\d)/);
      if (m) out.startMs = mk(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
    }
    const c = base.match(/(?:^|[^a-z])(?:ch|cam|canal|chn|channel)[\s_-]?0*(\d{1,2})(?!\d)/i);
    if (c) out.channel = +c[1];
    return out;
  }

  function addFiles(list) {
    const files = Array.from(list || []).filter(
      (f) => (f.type && f.type.startsWith('video/')) || /\.(mp4|mov|m4v|avi|mkv|webm|3gp|ts)$/i.test(f.name),
    );
    if (!files.length) {
      toast('Elige archivos de video (MP4, MOV, AVI, MKV o WEBM).', 'err');
      return;
    }
    let added = 0;
    for (const f of files) {
      if (S.cams.length >= MAX_CAMS) {
        toast(`Se pueden revisar hasta ${MAX_CAMS} cámaras a la vez.`, 'err');
        break;
      }
      if (S.cams.some((c) => c.key === fileKey(f))) continue;
      S.cams.push(makeCam(f));
      added++;
    }
    if (!added) return;
    computeOffsets();
    renderWall();
    restoreSession();
    S.autoTried = false;
    renderAll();
    maybeAutoRun();
  }

  function makeCam(file) {
    const meta = parseFileName(file.name);
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    const cam = {
      id: ++camSeq,
      key: fileKey(file),
      file,
      url,
      video,
      probe: null,
      meta,
      label: meta.channel ? `CH${meta.channel}` : `CÁM ${S.cams.length + 1}`,
      offset: 0,
      duration: NaN,
      error: null,
      out: false,
    };
    video.addEventListener('loadedmetadata', () => {
      cam.duration = video.duration;
      computeOffsets();
      updateDuration();
      renderAll();
      maybeAutoRun();
    });
    video.addEventListener('error', () => {
      cam.error = 'Este navegador no puede reproducir el archivo. Si está en H.265/HEVC, conviértelo a MP4 H.264.';
      renderTileState(cam);
    });
    return cam;
  }

  function removeCam(cam) {
    cam.video.pause();
    cam.video.removeAttribute('src');
    if (cam.probe) cam.probe.removeAttribute('src');
    URL.revokeObjectURL(cam.url);
    S.cams = S.cams.filter((c) => c !== cam);
    if (S.focusCam === cam.id) S.focusCam = null;
    S.frameCache.delete(cam.key);
    computeOffsets();
    updateDuration();
    renderWall();
    renderAll();
  }

  function computeOffsets() {
    const starts = S.cams.map((c) => c.meta.startMs);
    const all = starts.length && starts.every((v) => v != null);
    const min = all ? Math.min(...starts) : 0;
    for (const c of S.cams) c.offset = all ? (c.meta.startMs - min) / 1000 : 0;
  }
  function updateDuration() {
    let d = 0;
    for (const c of S.cams) if (isFinite(c.duration)) d = Math.max(d, c.offset + c.duration);
    S.duration = d;
    const scrub = $('#scrub');
    scrub.max = String(d || 0);
    if (S.t > d) seek(d);
  }

  const ICONS = {
    expand:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l12-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  };
  function iconBtn(svg, label, onclick) {
    const b = el('button', { class: 'iconbtn', type: 'button', title: label, 'aria-label': label, onclick });
    b.innerHTML = svg;
    return b;
  }

  function tileFor(cam) {
    if (cam.tile) return cam.tile;
    const input = el('input', { type: 'text', id: `lbl-${cam.id}`, 'aria-label': 'Nombre de la cámara', maxlength: 12 });
    input.value = cam.label;
    input.addEventListener('change', () => {
      cam.label = input.value.trim().toUpperCase() || cam.label;
      input.value = cam.label;
      persist();
      renderAll();
    });
    const veil = el('div', { class: 'tile-veil' });
    veil.hidden = true;
    const tile = el(
      'div',
      { class: 'tile' },
      cam.video,
      el('div', { class: 'tile-label', title: cam.file.name }, input, el('span', { class: 'fname', text: cam.file.name })),
      el(
        'div',
        { class: 'tile-tools' },
        iconBtn(ICONS.expand, 'Ampliar esta cámara', () => {
          S.focusCam = S.focusCam === cam.id ? null : cam.id;
          renderWall();
        }),
        iconBtn(ICONS.close, 'Quitar esta cámara', () => removeCam(cam)),
      ),
      veil,
    );
    cam.tile = tile;
    cam.veil = veil;
    cam.lblInput = input;
    return tile;
  }
  function renderTileState(cam) {
    if (!cam.veil) return;
    const msg = cam.error || (cam.out ? 'Sin grabación en este tramo' : '');
    cam.veil.textContent = msg;
    cam.veil.hidden = !msg;
  }

  function renderWall() {
    const wall = $('#wall');
    const n = S.cams.length;
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 6 ? 3 : 4;
    wall.style.setProperty('--cols', String(n ? cols : 2));
    wall.classList.toggle('has-focus', !!S.focusCam && n > 1);
    wall.replaceChildren();
    const wrap = $('#wallWrap');
    const oldDrop = wrap.querySelector('.dropzone');
    if (oldDrop) oldDrop.remove();
    if (!n) {
      for (const lbl of ['CH1', 'CH2', 'CH3', 'CH4']) wall.append(el('div', { class: 'tile placeholder', text: lbl }));
      wrap.append(
        el(
          'div',
          { class: 'dropzone' },
          el(
            'div',
            { class: 'drop-card' },
            el('h2', { text: 'Carga las grabaciones del bus' }),
            el(
              'ol',
              null,
              el('li', { text: 'Arrastra aquí los videos de cada cámara (CH1, CH2…), hasta 8.' }),
              el('li', { text: 'En Recorrido, extrae las coordenadas que aparecen escritas en el video.' }),
              el('li', { text: 'En Análisis, elige un enfoque y pide a Claude que describa cada cámara.' }),
            ),
            el(
              'div',
              { class: 'btn-row' },
              el('button', { class: 'btn primary', type: 'button', onclick: () => $('#videoInput').click(), text: 'Elegir videos' }),
            ),
            el('p', {
              class: 'hint',
              style: 'color:#8fa0ad',
              text: 'Si tienes un enlace al video, descárgalo primero: esta página no puede abrir enlaces externos.',
            }),
          ),
        ),
      );
      return;
    }
    for (const cam of S.cams) {
      const t = tileFor(cam);
      t.classList.toggle('focus', S.focusCam === cam.id);
      wall.append(t);
      renderTileState(cam);
    }
    if (n < MAX_CAMS) {
      const add = el('button', {
        class: 'tile placeholder',
        type: 'button',
        style: 'cursor:pointer;font-size:14px;border-style:dashed',
        onclick: () => $('#videoInput').click(),
        text: '+ Agregar cámara',
      });
      wall.append(add);
    }
  }

  // ---------------------------------------------------------------------------
  // Reproducción sincronizada
  // ---------------------------------------------------------------------------
  let lastTs = null;
  function leadCam() {
    return S.cams.find((c) => !c.error && isFinite(c.duration) && S.t - c.offset >= 0 && S.t - c.offset < c.duration - 0.05) || null;
  }
  function syncCams(force) {
    const tol = 0.4 * Math.max(1, S.rate / 2);
    for (const cam of S.cams) {
      if (cam.error || !isFinite(cam.duration)) continue;
      const local = S.t - cam.offset;
      const out = local < 0 || local > cam.duration;
      if (out !== cam.out) {
        cam.out = out;
        renderTileState(cam);
      }
      const v = cam.video;
      if (out) {
        if (!v.paused) v.pause();
        continue;
      }
      if (v.playbackRate !== S.rate) v.playbackRate = S.rate;
      if (force || Math.abs(v.currentTime - local) > tol) v.currentTime = local;
      if (S.playing && v.paused && !v.ended) v.play().catch(() => {});
      if (!S.playing && !v.paused) v.pause();
    }
  }
  function loop(ts) {
    if (!S.playing) return;
    const lead = leadCam();
    if (lead && !lead.video.paused && lead.video.readyState >= 2) S.t = lead.video.currentTime + lead.offset;
    else if (lastTs != null) S.t += ((ts - lastTs) / 1000) * S.rate;
    lastTs = ts;
    if (S.t >= S.duration) {
      S.t = S.duration;
      pause();
    }
    syncCams(false);
    onTime();
    requestAnimationFrame(loop);
  }
  function play() {
    if (!S.cams.length || !S.duration) return;
    if (S.t >= S.duration - 0.2) S.t = 0;
    S.playing = true;
    lastTs = null;
    syncCams(true);
    updatePlayBtn();
    requestAnimationFrame(loop);
  }
  function pause() {
    S.playing = false;
    syncCams(false);
    updatePlayBtn();
    onTime(true);
  }
  function seek(t) {
    S.t = clamp(t, 0, S.duration || 0);
    syncCams(true);
    onTime(true);
  }
  function updatePlayBtn() {
    const b = $('#btnPlay');
    b.innerHTML = S.playing ? ICONS.pause : ICONS.play;
    b.setAttribute('aria-label', S.playing ? 'Pausar' : 'Reproducir');
  }

  let lastUi = 0;
  let scrubbing = false;
  function onTime(force) {
    const now = performance.now();
    if (!force && now - lastUi < 90) return;
    lastUi = now;
    $('#roTime').replaceChildren(document.createTextNode(`${hms(S.t)} `), el('small', { text: `/ ${hms(S.duration)}` }));
    const clk = clockAt(S.t);
    $('#roClock').textContent = clk != null ? fmtClock(clk) : '—';
    const p = posAt(S.t);
    const spd = p && p.speed != null ? Math.round(p.speed) : null;
    $('#roSpeed').textContent = spd != null ? `${spd} km/h` : '—';
    if (!scrubbing) $('#scrub').value = String(S.t);
    drawLane();
    updateBus(p);
  }

  // ---------------------------------------------------------------------------
  // Recorrido: interpolación y horas
  // ---------------------------------------------------------------------------
  const tOf = (p) => p.t + S.shift;
  function trackIndexAt(t) {
    const a = S.track;
    let lo = 0;
    let hi = a.length - 1;
    if (!a.length || t < tOf(a[0])) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tOf(a[mid]) <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
  function posAt(t) {
    const a = S.track;
    if (!a.length) return null;
    const i = trackIndexAt(t);
    if (i < 0) return { ...a[0], i: 0, edge: true };
    if (i >= a.length - 1) return { ...a[a.length - 1], i: a.length - 1, edge: true };
    const p = a[i];
    const q = a[i + 1];
    const f = clamp((t - tOf(p)) / Math.max(1e-6, tOf(q) - tOf(p)), 0, 1);
    let speed = null;
    if (p.speed != null && q.speed != null) speed = p.speed + (q.speed - p.speed) * f;
    else if (p.speed != null) speed = p.speed;
    else {
      const dt = tOf(q) - tOf(p);
      if (dt > 0) speed = (distKm(p, q) / dt) * 3600;
    }
    return { lat: p.lat + (q.lat - p.lat) * f, lon: p.lon + (q.lon - p.lon) * f, speed, i, f };
  }
  function headingAt(i) {
    const a = S.track;
    if (a.length < 2) return 0;
    let j = i;
    let k = i + 1;
    while (k < a.length - 1 && distKm(a[j], a[k]) < 0.015) k++;
    while (j > 0 && distKm(a[j], a[k] || a[j]) < 0.015) j--;
    const A = a[j];
    const B = a[Math.min(k, a.length - 1)];
    if (!B || distKm(A, B) < 0.005) return S.lastHeading || 0;
    S.lastHeading = bearing(A, B);
    return S.lastHeading;
  }
  function clockAt(t) {
    const cp = S.clockPts;
    if (cp.length) {
      let best = cp[0];
      for (const p of cp) {
        if (Math.abs(tOf(p) - t) < Math.abs(tOf(best) - t)) best = p;
        if (tOf(p) > t) break;
      }
      return best.clock + (t - tOf(best)) * 1000;
    }
    const start = videoStartClock();
    return start != null ? start + t * 1000 : null;
  }
  function videoStartClock() {
    const starts = S.cams.map((c) => c.meta.startMs).filter((v) => v != null);
    if (starts.length) return Math.min(...starts);
    if (S.osdClockRef) return S.osdClockRef.clock - S.osdClockRef.t * 1000;
    return null;
  }
  function routeStats() {
    const a = S.track;
    let km = 0;
    let vmax = null;
    let vsum = 0;
    let vn = 0;
    for (let i = 1; i < a.length; i++) km += distKm(a[i - 1], a[i]);
    for (const p of a) {
      if (p.speed != null) {
        vmax = Math.max(vmax ?? 0, p.speed);
        vsum += p.speed;
        vn++;
      }
    }
    const dur = a.length > 1 ? a[a.length - 1].t - a[0].t : 0;
    if (vmax == null && a.length > 1) {
      for (let i = 1; i < a.length; i++) {
        const dt = a[i].t - a[i - 1].t;
        if (dt > 0) vmax = Math.max(vmax ?? 0, (distKm(a[i - 1], a[i]) / dt) * 3600);
      }
    }
    const vavg = vn ? vsum / vn : dur > 0 ? (km / dur) * 3600 : null;
    return { km, vmax: vmax != null ? Math.round(vmax) : null, vavg: vavg != null ? Math.round(vavg) : null, dur };
  }

  function cleanTrack(input) {
    let pts = input.filter((p) => validLL(p.lat, p.lon)).sort((a, b) => a.t - b.t);
    if (pts.length < 3) return pts;
    for (const key of ['lat', 'lon']) {
      const neg = pts.filter((p) => p[key] < 0).length;
      const sign = neg >= pts.length / 2 ? -1 : 1;
      const med = median(pts.map((p) => Math.abs(p[key])));
      for (const p of pts) if (Math.sign(p[key]) !== sign && Math.abs(Math.abs(p[key]) - med) < 1) p[key] = -p[key];
    }
    const w = 2;
    const filtered = pts.map((p, i) => {
      const win = pts.slice(Math.max(0, i - w), i + w + 1);
      return { lat: median(win.map((x) => x.lat)), lon: median(win.map((x) => x.lon)) };
    });
    pts = pts.filter((p, i) => distKm(p, filtered[i]) < 0.35);
    const out = [];
    for (const p of pts) {
      const prev = out[out.length - 1];
      if (prev) {
        const dt = Math.max(1, p.t - prev.t);
        if ((distKm(prev, p) / dt) * 3600 > 200) continue;
      }
      out.push(p);
    }
    return out;
  }
  function median(arr) {
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function setTrack(pts, meta) {
    S.track = pts;
    S.trackMeta = meta;
    S.shift = 0;
    $('#shiftSec').value = '0';
    S.clockPts = pts.filter((p) => p.clock != null);
    S.addr = null;
    persist();
    renderRoute();
    renderAll();
  }

  // ---------------------------------------------------------------------------
  // Línea de tiempo
  // ---------------------------------------------------------------------------
  function eventMarks() {
    const out = [];
    for (const e of S.index) if (e.riesgo !== 'ninguno' || e.eventos.length) out.push({ t: e.t, r: e.riesgo, text: e.texto });
    for (const a of S.analyses) {
      if (a.kind === 'momento') out.push({ t: a.t, r: a.riesgo, text: a.resumen });
      else for (const m of a.momentos || []) if (m.riesgo !== 'ninguno' || m.eventos.length) out.push({ t: m.t, r: m.riesgo, text: m.descripcion });
    }
    return out;
  }
  const riskColor = (r) => (r === 'alto' ? cssVar('--crit') : r === 'medio' ? cssVar('--warn') : r === 'bajo' ? cssVar('--low') : cssVar('--faint'));
  function drawLane() {
    const c = $('#lane');
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const D = S.duration;
    g.strokeStyle = cssVar('--line');
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = Math.round((h * i) / 4) + 0.5;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    if (!D) {
      g.fillStyle = cssVar('--faint');
      g.font = '12px ' + cssVar('--f-ui');
      g.textBaseline = 'middle';
      g.fillText('La velocidad y los hallazgos aparecerán aquí a lo largo del video.', 10, h / 2);
      return;
    }
    const pts = S.track;
    const spd = [];
    for (let i = 0; i < pts.length; i++) {
      let v = pts[i].speed;
      if (v == null && i > 0) {
        const dt = pts[i].t - pts[i - 1].t;
        v = dt > 0 ? (distKm(pts[i - 1], pts[i]) / dt) * 3600 : null;
      }
      if (v != null) spd.push({ x: (tOf(pts[i]) / D) * w, v });
    }
    if (spd.length > 1) {
      const vmax = Math.max(60, ...spd.map((s) => s.v));
      const Y = (v) => h - 4 - (v / vmax) * (h - 12);
      const acc = cssVar('--accent-fill');
      g.beginPath();
      g.moveTo(spd[0].x, h);
      for (const s of spd) g.lineTo(s.x, Y(s.v));
      g.lineTo(spd[spd.length - 1].x, h);
      g.closePath();
      g.globalAlpha = 0.22;
      g.fillStyle = acc;
      g.fill();
      g.globalAlpha = 1;
      g.beginPath();
      spd.forEach((s, i) => (i ? g.lineTo(s.x, Y(s.v)) : g.moveTo(s.x, Y(s.v))));
      g.strokeStyle = acc;
      g.lineWidth = 1.6;
      g.stroke();
      g.fillStyle = cssVar('--muted');
      g.font = '10.5px ' + cssVar('--f-mono');
      g.textBaseline = 'top';
      g.fillText(`${Math.round(vmax)} km/h`, 6, 3);
    }
    for (const m of eventMarks()) {
      const x = (m.t / D) * w;
      g.fillStyle = riskColor(m.r);
      g.fillRect(x - 1.5, 0, 3, 9);
    }
    const x = (S.t / D) * w;
    g.fillStyle = cssVar('--ink');
    g.fillRect(Math.round(x) - 1, 0, 2, h);
  }

  // ---------------------------------------------------------------------------
  // Mapa (Leaflet + imágenes de TomTom calibradas en Web Mercator)
  // ---------------------------------------------------------------------------
  const Mp = { map: null, base: null, baseKey: null, baseZ: 0, route: [], done: null, bus: null, ev: null, spot: null, follow: true, details: [], detailBusy: false, detailLast: 0 };
  const P = (ll, z) => L.CRS.EPSG3857.latLngToPoint(L.latLng(ll), z);
  const U = (pt, z) => L.CRS.EPSG3857.pointToLatLng(pt, z);

  function initMap() {
    if (!window.L) {
      setMapNote('No se pudo cargar el componente del mapa.');
      return;
    }
    Mp.map = L.map('map', { zoomControl: true, attributionControl: false, zoomSnap: 0.5, minZoom: 2, maxZoom: 19 }).setView([14, -80], 3);
    Mp.ev = L.layerGroup().addTo(Mp.map);
    Mp.map.on('dragstart', () => setFollow(false));
    Mp.map.on('moveend', () => {
      if (S.track.length) maybeDetail(Mp.follow && Mp.bus ? Mp.bus.getLatLng() : Mp.map.getCenter());
    });
  }
  function setFollow(on) {
    Mp.follow = on;
    $('#btnFollow').setAttribute('aria-pressed', String(on));
    if (on) updateBus(posAt(S.t), true);
  }
  function setMapNote(text) {
    $('#mapNoteText').textContent = text;
  }

  const BUS_SVG =
    '<svg viewBox="0 0 20 34"><rect x="1.5" y="1.5" width="17" height="31" rx="4" fill="#ffb21a" stroke="#0a0e11" stroke-width="1.5"/><rect x="4" y="3.5" width="12" height="5" rx="1.2" fill="#0a0e11"/><rect x="4" y="11" width="12" height="15" rx="1" fill="#c47f00" opacity=".55"/><rect x="5" y="28" width="10" height="2.5" rx="1" fill="#0a0e11" opacity=".6"/></svg>';

  function renderRoute() {
    if (!Mp.map) return;
    for (const l of Mp.route) l.remove();
    Mp.route = [];
    if (Mp.done) Mp.done.remove();
    Mp.done = null;
    if (Mp.bus) Mp.bus.remove();
    Mp.bus = null;
    const a = S.track;
    $('#mapEmpty').hidden = a.length > 0 || !!Mp.spot;
    $('#hud').hidden = a.length === 0;
    if (!a.length) {
      renderEvents();
      return;
    }
    const lls = a.map((p) => [p.lat, p.lon]);
    const casing = L.polyline(lls, { color: '#0a0e11', weight: 9, opacity: 0.45, lineJoin: 'round' });
    const rest = L.polyline(lls, { color: '#8894a0', weight: 4, opacity: 0.9, dashArray: '2 8', lineCap: 'round' });
    for (const l of [casing, rest]) {
      l.on('click', (e) => seekToLatLng(e.latlng));
      l.addTo(Mp.map);
      Mp.route.push(l);
    }
    Mp.done = L.polyline([], { color: '#ffb21a', weight: 5, opacity: 1, lineJoin: 'round', interactive: false }).addTo(Mp.map);
    Mp.bus = L.marker(lls[0], {
      icon: L.divIcon({ className: '', html: `<div class="busmk"><div class="busmk-rot">${BUS_SVG}</div></div>`, iconSize: [34, 34], iconAnchor: [17, 17] }),
      keyboard: false,
      zIndexOffset: 1000,
    }).addTo(Mp.map);
    lastDoneIdx = -2;
    updateBus(posAt(S.t), true);
    Mp.map.fitBounds(L.latLngBounds(lls).pad(0.12), { animate: false, maxZoom: 17 });
    renderEvents();
    loadBase();
  }
  function seekToLatLng(ll) {
    let best = null;
    let bd = Infinity;
    for (const p of S.track) {
      const d = distKm(p, { lat: ll.lat, lon: ll.lng });
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) seek(tOf(best));
  }
  let lastDoneIdx = -2;
  function updateBus(p, force) {
    if (!Mp.map || !Mp.bus || !p) return;
    const ll = L.latLng(p.lat, p.lon);
    Mp.bus.setLatLng(ll);
    const rot = Mp.bus.getElement() && Mp.bus.getElement().querySelector('.busmk-rot');
    if (rot) rot.style.transform = `rotate(${headingAt(p.i || 0)}deg)`;
    if (p.i !== lastDoneIdx || force) {
      lastDoneIdx = p.i;
      Mp.done.setLatLngs(S.track.slice(0, (p.i || 0) + 1).map((q) => [q.lat, q.lon]).concat([[p.lat, p.lon]]));
    } else {
      const lls = Mp.done.getLatLngs();
      if (lls.length) {
        lls[lls.length - 1] = ll;
        Mp.done.setLatLngs(lls);
      }
    }
    if (Mp.follow) {
      const inner = Mp.map.getBounds().pad(-0.25);
      if (force || !inner.contains(ll)) Mp.map.panTo(ll, { animate: !force && !S.playing, duration: 0.4 });
    }
    $('#hudSpeed').replaceChildren(document.createTextNode(p.speed != null ? String(Math.round(p.speed)) : '—'), el('small', { text: 'km/h' }));
    const clk = clockAt(S.t);
    $('#hudClock').textContent = clk != null ? fmtClock(clk) : hms(S.t);
    $('#hudCoord').textContent = `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
    const addr = S.addr && distKm(S.addr, p) < 0.25 ? S.addr.text : null;
    $('#hudAddr').hidden = !addr;
    $('#hudAddr').textContent = addr || '';
  }
  function renderEvents() {
    if (!Mp.ev) return;
    Mp.ev.clearLayers();
    if (Mp.spot) {
      Mp.spot.remove();
      Mp.spot = null;
    }
    if (!S.track.length) {
      const spot = S.analyses.find((a) => a.kind === 'momento' && a.datos && validLL(num(a.datos.lat), num(a.datos.lon)));
      if (spot && Mp.map) {
        const ll = [num(spot.datos.lat), num(spot.datos.lon)];
        Mp.spot = L.marker(ll, {
          icon: L.divIcon({ className: '', html: `<div class="busmk"><div class="busmk-rot">${BUS_SVG}</div></div>`, iconSize: [34, 34], iconAnchor: [17, 17] }),
        })
          .bindPopup('Ubicación leída en pantalla')
          .addTo(Mp.map);
        Mp.map.setView(ll, 16);
        $('#mapEmpty').hidden = true;
        loadBase([{ lat: ll[0], lon: ll[1] }]);
      }
      return;
    }
    for (const m of eventMarks()) {
      if (m.r === 'ninguno') continue;
      const p = posAt(m.t);
      if (!p) continue;
      const icon = L.divIcon({ className: '', html: `<div class="evt-dot" style="background:${riskColor(m.r)}"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] });
      const text = m.text || '';
      L.marker([p.lat, p.lon], { icon })
        .bindPopup(`<b>${hms(m.t)}</b> · riesgo ${m.r}<br>${escapeHtml(text).slice(0, 280)}`)
        .on('click', () => seek(m.t))
        .addTo(Mp.ev);
    }
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function baseSpec(pts) {
    const b = L.latLngBounds(pts.map((p) => [p.lat, p.lon]));
    for (let z = 17; z >= 2; z--) {
      const nw = P(b.getNorthWest(), z);
      const se = P(b.getSouthEast(), z);
      const w = se.x - nw.x + 220;
      const h = se.y - nw.y + 220;
      if (w <= 1800 && h <= 1400) {
        const c = U(L.point((nw.x + se.x) / 2, (nw.y + se.y) / 2), z);
        return { z, w: Math.round(clamp(w, 900, 2048)), h: Math.round(clamp(h, 700, 2048)), center: L.latLng(+c.lat.toFixed(6), +c.lng.toFixed(6)) };
      }
    }
    return { z: 2, w: 1024, h: 768, center: b.getCenter() };
  }
  function specBounds(spec) {
    const c = P(spec.center, spec.z);
    return L.latLngBounds(U(L.point(c.x - spec.w / 2, c.y + spec.h / 2), spec.z), U(L.point(c.x + spec.w / 2, c.y - spec.h / 2), spec.z));
  }
  async function tomtomImage(spec) {
    const input = {
      center: { lat: spec.center.lat, lon: spec.center.lng },
      zoom: spec.z,
      width: spec.w,
      height: spec.h,
      detail: 'compact',
      show_ui: false,
    };
    const opts = { cache: { staleTime: 300000, gcTime: 86400000 } };
    let res;
    try {
      res = await S.mcp.callTool(MAP_SERVER, 'tomtom-dynamic-map', input, opts);
    } catch (e) {
      if (!(e && e.retryable)) throw e;
      await sleep(clamp(e.retryAfterMs || 2000, 1000, 8000));
      res = await S.mcp.callTool(MAP_SERVER, 'tomtom-dynamic-map', input, opts);
    }
    const img = ((res && res.content) || []).find((b) => b && b.type === 'image' && b.data);
    if (!img) throw { code: 'no_image', message: 'El conector no devolvió una imagen.' };
    return `data:${img.mimeType || 'image/png'};base64,${img.data}`;
  }
  const MAP_PERMANENT = new Set(['server_not_connected', 'needs_reauth', 'not_in_manifest', 'blocked_by_policy', 'not_granted', 'capability_disabled', 'capability_removed', 'approval_required', 'selection_required']);
  function onMapError(e) {
    const code = e && e.code;
    const msg =
      {
        server_not_connected: 'Para ver el mapa base, conecta “TomTom Maps” en claude.ai → Configuración → Conectores y recarga la página.',
        selection_required: 'Elige qué conector de TomTom usar en el aviso de claude.ai y recarga la página.',
        needs_reauth: 'Vuelve a conectar “TomTom Maps” en claude.ai → Configuración → Conectores.',
        not_in_manifest: 'No se dio permiso para usar TomTom Maps. Recarga la página y acéptalo para ver el mapa base.',
        blocked_by_policy: 'Tu organización no permite usar TomTom Maps aquí.',
        approval_required: 'Tu organización pide aprobar cada uso de TomTom Maps; eso aún no funciona en esta página.',
        not_granted: 'El mapa base no está disponible en esta vista.',
        capability_disabled: 'El mapa base no está disponible en esta vista.',
        tool_error: `TomTom no pudo generar el mapa: ${(e && e.message) || 'error desconocido'}.`,
        no_image: 'TomTom respondió sin imagen de mapa.',
      }[code] || 'No se pudo cargar el mapa base por ahora. La ruta se sigue mostrando sobre la cuadrícula.';
    setMapNote(msg);
    if (MAP_PERMANENT.has(code)) {
      S.mapOff = true;
      setPill('#mapPill', 'off', 'Mapa: sin mapa base');
    } else setPill('#mapPill', 'wait', 'Mapa: sin fondo por ahora');
  }
  async function loadBase(ptsOverride) {
    const pts = ptsOverride || S.track;
    if (!Mp.map || !pts.length || !S.mcp || S.mapOff) {
      if (S.mcp === null && pts.length) setMapNote('Sin mapa base en esta vista: la ruta se dibuja sobre una cuadrícula.');
      return;
    }
    const spec = baseSpec(pts);
    const key = `${spec.z}:${spec.center.lat}:${spec.center.lng}:${spec.w}x${spec.h}`;
    if (Mp.baseKey === key) return;
    Mp.baseKey = key;
    setMapNote('Cargando el mapa base de TomTom…');
    try {
      const url = await tomtomImage(spec);
      if (Mp.baseKey !== key) return;
      if (Mp.base) Mp.base.remove();
      Mp.base = L.imageOverlay(url, specBounds(spec), { interactive: false }).addTo(Mp.map);
      Mp.base.bringToBack();
      Mp.baseZ = spec.z;
      setPill('#mapPill', 'on', 'Mapa: TomTom');
      setMapNote('Mapa base de TomTom. Acércate con + para cargar más detalle alrededor del bus. © TomTom, © OpenStreetMap');
    } catch (e) {
      Mp.baseKey = null;
      onMapError(e);
    }
  }
  async function maybeDetail(ll) {
    if (!Mp.map || !Mp.base || !S.mcp || S.mapOff || !ll) return;
    const mz = Mp.map.getZoom();
    if (mz < Mp.baseZ + 1.5) return;
    const z = Math.min(18, Math.round(mz));
    const p = P(ll, z);
    const G = 512;
    const gx = Math.round(p.x / G) * G;
    const gy = Math.round(p.y / G) * G;
    const key = `${z}:${gx}:${gy}`;
    const have = Mp.details.find((d) => d.key === key);
    if (have) return;
    if (Mp.detailBusy || Date.now() - Mp.detailLast < 2500) return;
    Mp.detailBusy = true;
    Mp.detailLast = Date.now();
    const c = U(L.point(gx, gy), z);
    const spec = { z, w: 1536, h: 1536, center: L.latLng(+c.lat.toFixed(6), +c.lng.toFixed(6)) };
    try {
      const url = await tomtomImage(spec);
      const ov = L.imageOverlay(url, specBounds(spec), { interactive: false }).addTo(Mp.map);
      ov.bringToBack();
      if (Mp.base) Mp.base.bringToBack();
      Mp.details.push({ key, ov });
      while (Mp.details.length > 14) Mp.details.shift().ov.remove();
    } catch (e) {
      onMapError(e);
    } finally {
      Mp.detailBusy = false;
    }
  }
  async function whereIsBus() {
    const p = posAt(S.t);
    if (!p) return toast('Primero extrae o importa el recorrido en la pestaña Recorrido.', 'err');
    if (!S.mcp) return toast('La búsqueda de direcciones usa el conector de TomTom y solo funciona dentro de claude.ai.', 'err');
    const key = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
    let text = S.addrCache.get(key);
    if (!text) {
      const btn = $('#btnAddr');
      btn.disabled = true;
      btn.textContent = 'Buscando…';
      try {
        const res = await S.mcp.callTool(
          MAP_SERVER,
          'tomtom-reverse-geocode',
          { position: [+p.lon.toFixed(6), +p.lat.toFixed(6)], language: 'es-ES', limit: 1, response_detail: 'compact', show_ui: false },
          { cache: { staleTime: 300000, gcTime: 86400000 } },
        );
        text = addressFrom(res && res.payload);
        if (text) S.addrCache.set(key, text);
      } catch (e) {
        onMapError(e);
      } finally {
        btn.disabled = false;
        btn.textContent = '¿Dónde está?';
      }
    }
    if (!text) return toast('No encontré una dirección para este punto.', 'err');
    S.addr = { lat: p.lat, lon: p.lon, text };
    updateBus(p);
    toast(text, 'ok');
  }
  function addressFrom(pl) {
    let p = pl;
    if (typeof p === 'string') {
      try {
        p = JSON.parse(p);
      } catch {
        return null;
      }
    }
    if (!p || typeof p !== 'object') return null;
    const f = p.features ? p.features[0] : p.addresses ? p.addresses[0] : p.results ? p.results[0] : p;
    const a = (f && f.properties && f.properties.address) || (f && f.address);
    if (!a) return null;
    return a.freeformAddress || [a.streetNameAndNumber || a.streetName, a.municipalitySubdivision, a.municipality].filter(Boolean).join(', ') || null;
  }

  // ---------------------------------------------------------------------------
  // Captura de fotogramas
  // ---------------------------------------------------------------------------
  async function ensureProbe(cam) {
    if (!cam.probe) {
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      v.playsInline = true;
      v.src = cam.url;
      cam.probe = v;
    }
    if (cam.probe.readyState < 1) await once(cam.probe, 'loadedmetadata', 20000);
    return cam.probe;
  }
  async function seekVideo(v, t) {
    if (Math.abs(v.currentTime - t) < 0.02 && v.readyState >= 2) return;
    const p = once(v, 'seeked', 15000);
    v.currentTime = t;
    await p;
    if (v.readyState < 2) await once(v, 'loadeddata', 4000).catch(() => {});
  }
  function drawVideo(v, maxW) {
    const s = Math.min(1, maxW / (v.videoWidth || maxW));
    const c = canvas((v.videoWidth || 640) * s, (v.videoHeight || 360) * s);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return c;
  }
  async function grabAt(cam, local, maxW) {
    const v = await ensureProbe(cam);
    await seekVideo(v, clamp(local, 0, Math.max(0, (cam.duration || v.duration) - 0.05)));
    return drawVideo(v, maxW || v.videoWidth);
  }
  async function framesAt(t, maxW, b) {
    const frames = [];
    for (const cam of S.cams) {
      if (cam.error || !isFinite(cam.duration)) continue;
      const local = t - cam.offset;
      if (local < 0 || local > cam.duration) continue;
      const cv = await grabAt(cam, local, maxW);
      if (b && b.stopped) return null;
      frames.push({ cam, canvas: cv });
    }
    return frames;
  }
  function mosaic(items, caption, budget = 600000) {
    const n = items.length;
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
    const rows = Math.ceil(n / cols);
    const ar = items[0].canvas.width / items[0].canvas.height || 16 / 9;
    const capH = caption ? 36 : 0;
    const tw = Math.min(1280, Math.floor(Math.sqrt((budget * ar) / (cols * rows))));
    const th = Math.round(tw / ar);
    const c = canvas(cols * tw, rows * th + capH);
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    if (caption) {
      g.fillStyle = '#111820';
      g.fillRect(0, 0, c.width, capH);
      g.fillStyle = '#ffb21a';
      g.font = '600 20px "IBM Plex Mono", monospace';
      g.textBaseline = 'middle';
      g.fillText(caption, 12, capH / 2);
    }
    items.forEach((it, i) => {
      const x = (i % cols) * tw;
      const y = capH + Math.floor(i / cols) * th;
      const s = Math.min(tw / it.canvas.width, th / it.canvas.height);
      const dw = it.canvas.width * s;
      const dh = it.canvas.height * s;
      g.drawImage(it.canvas, x + (tw - dw) / 2, y + (th - dh) / 2, dw, dh);
      g.strokeStyle = '#1d262d';
      g.strokeRect(x + 0.5, y + 0.5, tw - 1, th - 1);
      g.font = '700 19px "Barlow Semi Condensed", "Arial Narrow", sans-serif';
      const tw2 = g.measureText(it.label).width;
      g.fillStyle = 'rgba(0,0,0,0.78)';
      g.fillRect(x + 8, y + 8, tw2 + 18, 30);
      g.fillStyle = '#ffffff';
      g.textBaseline = 'middle';
      g.fillText(it.label, x + 17, y + 23);
    });
    return c;
  }

  // ---------------------------------------------------------------------------
  // Contexto para Claude
  // ---------------------------------------------------------------------------
  const allFocus = () => [...ENFOQUES, ...S.customFocus];
  const currentFocus = () => allFocus().find((f) => f.id === S.focusId) || ENFOQUES[0];
  function contextText() {
    const parts = [];
    if (S.busId) parts.push(`Unidad: ${S.busId}`);
    parts.push(`Cámaras cargadas: ${S.cams.map((c) => c.label).join(', ') || 'ninguna'}`);
    const c0 = clockAt(0);
    parts.push(`Duración del video: ${hms(S.duration)}${c0 != null ? ` (de ${fmtClock(c0)} a ${fmtClock(clockAt(S.duration), false)})` : ''}`);
    if (S.track.length > 1) {
      const st = routeStats();
      parts.push(`Recorrido GPS: ${st.km.toFixed(1)} km${st.vmax != null ? `, velocidad máxima ${st.vmax} km/h` : ''}`);
    }
    return parts.join('\n');
  }
  function momentText(t) {
    const p = posAt(t);
    const clk = clockAt(t);
    const bits = [`tiempo de video ${hms(t)}`];
    if (clk != null) bits.push(`hora del equipo ${fmtClock(clk)}`);
    if (p) {
      bits.push(`posición ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`);
      if (p.speed != null) bits.push(`velocidad ${Math.round(p.speed)} km/h`);
    }
    if (S.addr && p && distKm(S.addr, p) < 0.25) bits.push(`dirección aproximada: ${S.addr.text}`);
    return bits.join(', ');
  }
  function focusText(extra) {
    const f = currentFocus();
    return `Enfoque del análisis: ${f.nombre}. ${f.instr}${extra ? `\nIndicación adicional del operador: ${extra}` : ''}`;
  }
  function digest(maxChars) {
    const lines = [];
    for (const a of [...S.analyses].reverse()) {
      if (a.kind === 'momento') {
        lines.push(`[${hms(a.t)}${a.clock != null ? ` · ${fmtClock(a.clock)}` : ''} · enfoque ${a.focus}] ${a.resumen}`);
        for (const c of a.camaras) lines.push(`  - ${c.camara}: ${c.descripcion}${c.hallazgos.length ? ` Hallazgos: ${c.hallazgos.join('; ')}.` : ''} (riesgo ${c.riesgo})`);
        if (a.alertas.length) lines.push(`  Alertas: ${a.alertas.join('; ')}`);
      } else {
        lines.push(`[Análisis general · enfoque ${a.focus}] ${a.resumen}`);
        for (const m of a.momentos) lines.push(`  - ${hms(m.t)}${m.clock != null ? ` (${fmtClock(m.clock, false)})` : ''}: ${m.descripcion}${m.eventos.length ? ` Eventos: ${m.eventos.join('; ')}.` : ''} (riesgo ${m.riesgo})`);
        if (a.conclusiones.length) lines.push(`  Conclusiones: ${a.conclusiones.join('; ')}`);
      }
    }
    let s = lines.join('\n');
    if (s.length > maxChars) s = `…${s.slice(-maxChars)}`;
    return s || '(todavía no hay análisis registrados)';
  }

  const RISKS = ['ninguno', 'bajo', 'medio', 'alto'];
  function normRisk(r) {
    const s = String(r || '').toLowerCase();
    if (RISKS.includes(s)) return s;
    if (s.includes('alt')) return 'alto';
    if (s.includes('med')) return 'medio';
    if (s.includes('baj')) return 'bajo';
    return 'ninguno';
  }
  const maxRisk = (list) => list.reduce((m, r) => (RISKS.indexOf(normRisk(r)) > RISKS.indexOf(m) ? normRisk(r) : m), 'ninguno');
  const strList = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((v) => v != null && String(v).trim()).map((v) => String(v).trim());

  // ---------------------------------------------------------------------------
  // Análisis del momento actual
  // ---------------------------------------------------------------------------
  async function analyzeMoment() {
    if (!S.cams.length) return toast('Primero carga los videos de las cámaras.', 'err');
    if (!aiReady()) return;
    pause();
    const t = S.t;
    const b = busyStart('Capturando las cámaras…');
    try {
      const frames = await framesAt(t, 768, b);
      if (!frames) return;
      if (!frames.length) throw { code: 'local', message: 'Ninguna cámara tiene grabación en este momento.' };
      let images;
      let layout;
      let imgTok = 0;
      if (frames.length <= maxImages()) {
        images = await Promise.all(frames.map((f) => toJpeg(f.canvas, 0.8)));
        imgTok = frames.reduce((a, f) => a + imgTokens(f.canvas.width, f.canvas.height), 0);
        layout = `${frames.length} imagen(es), una por cámara: ${frames.map((f, i) => `imagen ${i + 1} = ${f.cam.label}`).join(', ')}.`;
      } else {
        const mo = mosaic(frames.map((f) => ({ canvas: f.canvas, label: f.cam.label })));
        images = [await toJpeg(mo, 0.8)];
        imgTok = imgTokens(mo.width, mo.height);
        layout = `una imagen tipo mosaico con las cámaras rotuladas: ${frames.map((f) => f.cam.label).join(', ')}.`;
      }
      busySet('Claude está analizando las cámaras…', null);
      const prompt = [
        RULES,
        `Contexto:\n${contextText()}`,
        focusText($('#extraInstr').value.trim()),
        `Te envío ${layout} Todas corresponden al mismo instante: ${momentText(t)}.`,
        'Responde SOLO con JSON con esta forma:',
        '{"resumen":"2 a 4 frases con lo más importante del momento","camaras":[{"camara":"CH1","descripcion":"3 a 5 frases detalladas de lo que se ve","personas":0,"hallazgos":["hecho relevante según el enfoque"],"riesgo":"ninguno|bajo|medio|alto"}],"datos_pantalla":{"bus":null,"canal":null,"fecha_hora":null,"velocidad_kmh":null,"lat":null,"lon":null},"alertas":["situación que requiere atención"]}',
        'Incluye un objeto en "camaras" por cada cámara. "personas" es el número aproximado de personas visibles en esa cámara (null si no aplica). En "datos_pantalla" copia lo que diga el texto sobreimpreso si existe: coordenadas en grados decimales con signo (sur y oeste negativos) y fecha_hora como AAAA-MM-DD HH:MM:SS. Si no hay alertas, deja la lista vacía.',
      ].join('\n\n');
      const data = await S.sample.json(prompt, { images, modelTier: S.tier, signal: b.ctl.signal });
      spend(imgTok + textTokens(prompt) + textTokens(JSON.stringify(data)));
      const d = data && typeof data === 'object' ? data : {};
      const camaras = (Array.isArray(d.camaras) ? d.camaras : []).map((c, i) => ({
        camara: String((c && c.camara) || (frames[i] && frames[i].cam.label) || `Cámara ${i + 1}`),
        descripcion: String((c && c.descripcion) || ''),
        personas: numOrNull(c && c.personas),
        hallazgos: strList(c && c.hallazgos),
        riesgo: normRisk(c && c.riesgo),
      }));
      const alertas = strList(d.alertas);
      let riesgo = maxRisk(camaras.map((c) => c.riesgo));
      if (alertas.length && riesgo === 'ninguno') riesgo = 'bajo';
      const rec = {
        id: uid(),
        kind: 'momento',
        at: Date.now(),
        t,
        clock: clockAt(t),
        focus: currentFocus().nombre,
        resumen: String(d.resumen || ''),
        camaras,
        alertas,
        riesgo,
        datos: d.datos_pantalla && typeof d.datos_pantalla === 'object' ? d.datos_pantalla : null,
      };
      S.analyses.unshift(rec);
      applyScreenData(rec.datos, t);
      persist();
      renderAll();
      renderEvents();
      showTab('a');
      toast('Análisis del momento listo.', 'ok');
    } catch (e) {
      onAiError(e);
    } finally {
      busyEnd();
    }
  }
  function applyScreenData(d, t) {
    if (!d) return;
    if (d.bus && !S.busId) S.busId = String(d.bus).slice(0, 24);
    const clk = parseClock(d.fecha_hora);
    if (clk != null && !S.osdClockRef) S.osdClockRef = { t, clock: clk };
  }

  // ---------------------------------------------------------------------------
  // Índice del video: lo que pasa a lo largo del video, para buscar rápido
  // ---------------------------------------------------------------------------
  function indexPlan() {
    const v = $('#idxEvery').value;
    const D = S.duration || 0;
    const step = v === 'auto' ? Math.max(20, Math.ceil(D / 20)) : Number(v);
    const times = [];
    for (let t = Math.min(step / 2, D / 2); t < D - 0.5; t += step) times.push(+t.toFixed(2));
    if (!times.length && D > 0) times.push(+(D / 2).toFixed(2));
    if (times.length > 240) times.length = 240;
    return { step, times };
  }
  const perIndexCall = () => Math.max(1, Math.min(maxImages(), 8));
  function indexCost() {
    const { times } = indexPlan();
    const calls = Math.ceil(times.length / perIndexCall());
    return { n: times.length, calls, tokens: times.length * (imgTokens(1150, 610) + 110) + calls * 1300 };
  }
  function upsertIndex(entries) {
    const map = new Map(S.index.map((e) => [e.t, e]));
    for (const e of entries) map.set(e.t, e);
    S.index = [...map.values()].sort((a, b) => a.t - b.t);
  }
  async function coreIndex(b) {
    const { times } = indexPlan();
    const per = perIndexCall();
    S.index = [];
    let tok = 0;
    for (let i = 0; i < times.length; i += per) {
      const chunk = times.slice(i, i + per);
      const images = [];
      const used = [];
      for (const t of chunk) {
        busySet(`Mirando el video: momento ${Math.min(times.length, i + used.length + 1)} de ${times.length}…`, (i + used.length) / times.length);
        const frames = await framesAt(t, 640, b);
        if (!frames) return null;
        if (!frames.length) continue;
        const clk = clockAt(t);
        const mo = mosaic(frames.map((f) => ({ canvas: f.canvas, label: f.cam.label })), `Momento ${used.length + 1} · ${hms(t)}${clk != null ? ` · ${fmtClock(clk, false)}` : ''}`, 700000);
        tok += imgTokens(mo.width, mo.height);
        images.push(await toJpeg(mo, 0.8));
        used.push(t);
      }
      if (!images.length) continue;
      busySet(`Claude está describiendo los momentos ${i + 1} a ${i + used.length} de ${times.length}…`, (i + used.length) / times.length);
      const prompt = [
        RULES,
        `Contexto:\n${contextText()}`,
        focusText($('#extraInstr').value.trim()),
        `Te envío ${images.length} imágenes en orden cronológico. Cada una es un mosaico con las cámaras del bus (rotuladas) en un momento; el encabezado amarillo indica el número de momento.\n${used.map((t, k) => `Momento ${k + 1} = ${momentText(t)}`).join('\n')}`,
        'Para cada momento describe de forma breve y concreta lo que pasa: qué hacen las personas, si el bus está detenido o en marcha, puertas, y cualquier situación llamativa. Menciona la cámara cuando importe.',
        'Responde SOLO con un JSON array con un objeto por momento, en orden: [{"n":1,"descripcion":"1 a 3 frases","personas":0,"eventos":["hecho relevante"],"riesgo":"ninguno|bajo|medio|alto"}]',
        `Incluye los momentos del 1 al ${images.length}. "personas" es el total aproximado de personas visibles sumando las cámaras.`,
      ].join('\n\n');
      const data = await S.sample.json(prompt, { images, modelTier: S.tier, signal: b.ctl.signal });
      tok += textTokens(prompt) + textTokens(JSON.stringify(data));
      const list = Array.isArray(data) ? data : (data && (data.momentos || data.items)) || [];
      const entries = [];
      list.forEach((m, k) => {
        const n = Math.round(num(m && m.n)) || k + 1;
        const t = used[n - 1];
        if (t == null || !m) return;
        entries.push({ t, clock: clockAt(t), texto: String(m.descripcion || ''), personas: numOrNull(m.personas), eventos: strList(m.eventos), riesgo: normRisk(m.riesgo) });
      });
      upsertIndex(entries);
      S.indexFocus = currentFocus().nombre;
      persist();
      renderResults();
      renderEvents();
      drawLane();
      renderPrep();
    }
    spend(tok);
    return S.index.length;
  }
  function indexText(maxChars) {
    const lines = S.index.map(
      (e) =>
        `[${hms(e.t)}]${e.clock != null ? ` ${fmtClock(e.clock, false)}` : ''}${e.riesgo !== 'ninguno' ? ` · riesgo ${e.riesgo}` : ''}${e.personas != null ? ` · ${e.personas} personas` : ''} · ${e.texto}${e.eventos.length ? ` Eventos: ${e.eventos.join('; ')}.` : ''}`,
    );
    let s = lines.join('\n');
    if (s.length > maxChars) s = `${s.slice(0, maxChars)}…`;
    return s || '(todavía no hay índice)';
  }
  function gpsText(maxLines) {
    const a = S.track;
    if (!a.length) return '';
    const step = Math.max(1, Math.ceil(a.length / maxLines));
    const out = [];
    for (let i = 0; i < a.length; i += step) {
      const p = a[i];
      out.push(`[${hms(tOf(p))}]${p.clock != null ? ` ${fmtClock(p.clock, false)}` : ''} · ${p.speed != null ? `${Math.round(p.speed)} km/h` : 'velocidad sin dato'} · ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`);
    }
    return out.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Preparación: detectar datos en pantalla → recorrido → índice (un clic)
  // ---------------------------------------------------------------------------
  const imagesOff = () => !!(S.limits && !S.limits.images);
  const NO_IMAGES =
    'La vista donde abriste esta página no permite enviar imágenes a Claude, así que no puede ver el video. Prueba abrir el enlace en claude.ai desde Chrome o Edge en una computadora. Mientras tanto puedes importar un archivo de recorrido en la pestaña Recorrido para ver el mapa.';
  function prepCost() {
    const n = Math.max(1, Math.min(S.cams.filter((c) => !c.error).length, maxImages()));
    let tokens = 0;
    if (!S.osd.items.length) tokens += n * imgTokens(1024, 576) + 700 + n * 120;
    const item = osdItem(S.osd.camKey);
    const cam = camByKey(S.osd.camKey) || S.cams[0];
    if (!S.track.length && cam && isFinite(cam.duration) && (!S.osd.items.length || (item && item.has))) tokens += ocrCost(cam).tokens;
    if (!S.index.length) tokens += indexCost().tokens;
    return tokens;
  }
  function renderPrep() {
    const box = $('#prepSteps');
    if (!box) return;
    const run = S.prepRun;
    const item = osdItem(S.osd.camKey);
    const osdDone = S.osd.items.length > 0;
    const steps = [
      {
        label: 'Leer los datos en pantalla',
        s: run === 0 ? 'run' : osdDone ? 'ok' : 'pend',
        det: osdDone ? (item && item.has ? `coordenadas en ${(camByKey(item.key) || {}).label || 'una cámara'}` : 'sin coordenadas en pantalla') : '',
      },
      {
        label: 'Recorrido GPS',
        s: run === 1 ? 'run' : S.track.length ? 'ok' : osdDone && !(item && item.has) ? 'skip' : 'pend',
        det: S.track.length ? `${S.track.length} puntos` : osdDone && !(item && item.has) ? 'no disponible' : '',
      },
      {
        label: 'Índice de lo que pasa',
        s: run === 2 ? 'run' : S.index.length ? 'ok' : 'pend',
        det: S.index.length ? `${S.index.length} momento${S.index.length === 1 ? '' : 's'}` : '',
      },
    ];
    box.replaceChildren(
      ...steps.map((st, i) =>
        el('li', { 'data-s': st.s }, el('span', { class: 'ico', text: st.s === 'ok' ? '✓' : st.s === 'skip' ? '–' : String(i + 1) }), el('span', { text: st.label }), el('span', { class: 'det', text: st.det })),
      ),
    );
    const warn = $('#prepWarn');
    const msg = S.sample === null ? 'El análisis con Claude solo funciona con la página abierta dentro de claude.ai.' : S.aiOff || (imagesOff() ? NO_IMAGES : '');
    warn.hidden = !msg;
    warn.textContent = msg;
    const all = osdDone && S.index.length && (S.track.length || !(item && item.has));
    $('#btnPrep').textContent = all ? 'Volver a preparar' : 'Preparar video';
    const est = $('#prepEstimate');
    if (!S.cams.length) est.textContent = 'Carga los videos para calcular el consumo.';
    else if (!S.duration) est.textContent = '';
    else if (all) est.textContent = `Rehacer el índice: ≈ ${kTok(indexCost().tokens)}`;
    else est.textContent = `≈ ${kTok(prepCost())} con el modelo ${TIERS[S.tier].toLowerCase()}`;
  }
  async function runPipeline() {
    if (!S.cams.length || !S.duration) return toast('Primero carga los videos de las cámaras.', 'err');
    if (S.busy) return;
    if (!aiReady()) return;
    pause();
    const b = busyStart('Preparando el video…');
    const redo = S.osd.items.length && S.index.length;
    try {
      S.prepRun = 0;
      renderPrep();
      if (!S.osd.items.length) {
        busySet('Leyendo los datos en pantalla…', null);
        await coreDetect(b);
        if (b.stopped) return;
        renderAll();
      }
      S.prepRun = 1;
      renderPrep();
      const item = osdItem(S.osd.camKey);
      if (!S.track.length && item && item.has) {
        try {
          await coreExtract(b);
        } catch (e) {
          if (!(e && e.code === 'local')) throw e;
          toast(e.message, 'err');
        }
        if (b.stopped) return;
      }
      S.prepRun = 2;
      renderPrep();
      if (!S.index.length || redo) await coreIndex(b);
      if (b.stopped) return;
      toast('Video preparado. Escribe arriba lo que quieras buscar.', 'ok');
      $('#q').focus();
    } catch (e) {
      onAiError(e);
    } finally {
      S.prepRun = null;
      busyEnd();
      renderAll();
    }
  }
  function maybeAutoRun() {
    if (!S.autoRun || S.autoTried || S.busy) return;
    if (!S.cams.length || S.cams.some((c) => !c.error && !isFinite(c.duration))) return;
    if (S.sample === undefined || !S.sample || S.aiOff || imagesOff()) return;
    if (S.index.length) return;
    S.autoTried = true;
    runPipeline();
  }

  // ---------------------------------------------------------------------------
  // Búsqueda: responde al instante con el índice (solo texto, barato)
  // ---------------------------------------------------------------------------
  const QUICK = [
    'Resumen de lo que pasa en el video',
    '¿Hubo peleas, robos o situaciones de riesgo?',
    '¿Cuándo suben y bajan más pasajeros?',
    '¿Qué hizo el conductor? ¿Usó el celular?',
    '¿Cuándo estuvo detenido y cuándo fue más rápido?',
    '¿Alguna cámara se ve mal o tapada?',
  ];
  function renderQuick() {
    const box = $('#quickQs');
    box.replaceChildren(
      ...QUICK.map((q) =>
        el('button', {
          class: 'qchip',
          type: 'button',
          text: q,
          onclick: () => {
            $('#q').value = q;
            search(q);
          },
        }),
      ),
    );
  }
  async function search(q) {
    if (S.busy) return;
    if (!aiReady(false)) return;
    if (!S.index.length && !S.analyses.length && !S.track.length) {
      toast(S.cams.length ? 'Primero pulsa “Preparar video” para que Claude tenga de dónde buscar.' : 'Primero carga los videos de las cámaras.', 'err');
      return;
    }
    const item = { id: uid(), q, a: '', at: Date.now(), pending: true };
    S.qa.unshift(item);
    S.qaOpen = 1;
    renderAnswers();
    const b = busyStart('Buscando…');
    const prompt = [
      RULES,
      'Responde la búsqueda del operador usando SOLO el índice del video, los análisis y los datos GPS de abajo. Sé directo: primero la respuesta en una o dos frases y luego, en viñetas, los momentos donde ocurre, cada uno con su tiempo de video entre corchetes en formato [hh:mm:ss] y la cámara si se sabe. Si no hay información suficiente, dilo y sugiere en qué tiempo revisar con el botón "¿Qué pasa aquí?". Máximo 8 líneas.',
      `Contexto:\n${contextText()}`,
      `Índice del video (tiempo de video, hora del equipo y lo que se ve):\n${indexText(14000)}`,
      S.analyses.length ? `Análisis puntuales:\n${digest(6000)}` : '',
      S.track.length ? `Datos GPS (muestra del recorrido):\n${gpsText(60)}` : '',
      `Búsqueda: ${q}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    try {
      const { text } = await S.sample(prompt, {
        modelTier: S.tier,
        signal: b.ctl.signal,
        onText: ({ text: t }) => {
          item.a = t;
          item.pending = false;
          renderAnswers();
        },
      });
      item.a = text;
      spend(textTokens(prompt) + textTokens(text));
    } catch (e) {
      if (e && e.text) item.a = e.text;
      else S.qa = S.qa.filter((x) => x !== item);
      onAiError(e);
    } finally {
      item.pending = false;
      busyEnd();
      persist();
      renderAnswers();
    }
  }
  function richLine(text) {
    const frag = document.createDocumentFragment();
    const parts = String(text).split(/(\*\*[^*]+\*\*|\[?\b\d{1,2}:\d{2}:\d{2}\b\]?)/);
    for (const part of parts) {
      if (!part) continue;
      const tm = part.match(/^\[?(\d{1,2}):(\d{2}):(\d{2})\]?$/);
      if (tm) {
        const t = +tm[1] * 3600 + +tm[2] * 60 + +tm[3];
        if (S.duration && t <= S.duration + 1) {
          frag.append(tchip(t));
          continue;
        }
      }
      if (/^\*\*[^*]+\*\*$/.test(part)) frag.append(el('strong', { text: part.slice(2, -2) }));
      else frag.append(part);
    }
    return frag;
  }
  function renderAnswers() {
    const box = $('#answers');
    box.replaceChildren();
    const shown = S.qa.slice(0, S.qaOpen || 1);
    for (const it of shown) {
      const a = el('div', { class: 'a' });
      if (it.pending && !it.a) a.append(el('span', { class: 'thinking', text: 'Buscando en el índice del video…' }));
      else {
        for (const raw of String(it.a).split(/\r?\n/)) {
          const line = raw.trim();
          if (!line) continue;
          const m = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
          if (m) a.append(el('div', { class: 'li' }, richLine(m[1])));
          else a.append(el('div', null, richLine(line.replace(/^#+\s*/, ''))));
        }
      }
      box.append(
        el(
          'div',
          { class: 'answer' },
          el(
            'div',
            { class: 'q' },
            el('span', { text: it.q }),
            el('button', {
              class: 'btn ghost small',
              type: 'button',
              text: 'Quitar',
              onclick: () => {
                S.qa = S.qa.filter((x) => x !== it);
                persist();
                renderAnswers();
              },
            }),
          ),
          a,
        ),
      );
    }
    if (S.qa.length > shown.length) {
      box.append(
        el('button', {
          class: 'btn ghost small more-answers',
          type: 'button',
          text: `Ver búsquedas anteriores (${S.qa.length - shown.length})`,
          onclick: () => {
            S.qaOpen = S.qa.length;
            renderAnswers();
          },
        }),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Recorrido: detectar el texto en pantalla y leer las coordenadas
  // ---------------------------------------------------------------------------
  function normBands(fr) {
    let list = (Array.isArray(fr) ? fr : fr ? [fr] : [])
      .map((b) => ({
        top: num(b && (b.arriba ?? b.top)),
        bottom: num(b && (b.abajo ?? b.bottom)),
        left: num(b && (b.izquierda ?? b.left)),
        right: num(b && (b.derecha ?? b.right)),
      }))
      .filter((b) => isFinite(b.top) && isFinite(b.bottom));
    if (list.some((b) => b.top > 1.5 || b.bottom > 1.5 || b.left > 1.5 || b.right > 1.5)) {
      list = list.map((b) => ({ top: b.top / 100, bottom: b.bottom / 100, left: b.left / 100, right: b.right / 100 }));
    }
    list = list
      .map((b) => {
        let top = clamp(Math.min(b.top, b.bottom) - 0.012, 0, 1);
        let bottom = clamp(Math.max(b.top, b.bottom) + 0.012, 0, 1);
        if (bottom - top < 0.04) {
          const c = (top + bottom) / 2;
          top = clamp(c - 0.02, 0, 0.96);
          bottom = top + 0.04;
        }
        let left = isFinite(b.left) ? b.left : 0;
        let right = isFinite(b.right) ? b.right : 1;
        const l0 = Math.min(left, right);
        const r0 = Math.max(left, right);
        left = clamp(l0 - 0.05, 0, 1);
        right = clamp(r0 + 0.08, 0, 1);
        if (right - left < 0.15) {
          left = 0;
          right = 1;
        }
        return { top: +top.toFixed(3), bottom: +bottom.toFixed(3), left: +left.toFixed(3), right: +right.toFixed(3) };
      })
      .sort((a, b) => a.top - b.top);
    const merged = [];
    for (const b of list) {
      const last = merged[merged.length - 1];
      if (last && b.top <= last.bottom + 0.01) {
        last.bottom = Math.max(last.bottom, b.bottom);
        last.left = Math.min(last.left, b.left);
        last.right = Math.max(last.right, b.right);
      } else merged.push({ ...b });
    }
    return merged.slice(0, 2);
  }
  const camByKey = (k) => S.cams.find((c) => c.key === k) || null;
  const osdItem = (k) => S.osd.items.find((i) => i.key === k) || null;
  function bandsFor(key) {
    const list = S.osd.bands[key] || (osdItem(key) && osdItem(key).bands.length ? osdItem(key).bands : [{ top: 0, bottom: 0.1, left: 0, right: 1 }]);
    return list.map((b) => ({ left: 0, right: 1, ...b }));
  }

  async function coreDetect(b) {
    const cams = S.cams.filter((c) => !c.error && isFinite(c.duration)).slice(0, maxImages());
    const frames = [];
    for (const cam of cams) {
      const t = clamp(cam.duration * 0.1, 0, Math.max(0, cam.duration - 1));
      const cv = await grabAt(cam, t);
      if (b.stopped) return null;
      frames.push({ cam, canvas: cv, t });
      S.frameCache.set(cam.key, cv);
    }
    if (!frames.length) throw { code: 'local', message: 'No hay cámaras listas para revisar.' };
    let detTok = 0;
    const images = await Promise.all(
      frames.map((f) => {
        const c = f.canvas.width > 1024 ? drawCanvasScaled(f.canvas, 1024) : f.canvas;
        detTok += imgTokens(c.width, c.height);
        return toJpeg(c, 0.9);
      }),
    );
    busySet('Claude está leyendo el texto en pantalla…', null);
    const prompt = [
      `Te envío ${frames.length} imagen(es); cada una es un fotograma de una cámara distinta de un autobús: ${frames.map((f, i) => `imagen ${i + 1} = ${f.cam.label}`).join(', ')}.`,
      'Estas cámaras suelen tener texto sobreimpreso (OSD) con datos como el número de la unidad, el canal (CH), la fecha y hora, la velocidad y las coordenadas GPS.',
      'Para cada imagen:\n- copia el texto sobreimpreso tal como aparece;\n- indica si contiene coordenadas GPS (latitud y longitud);\n- da el recuadro donde están las líneas de texto con coordenadas, fecha/hora y velocidad: arriba y abajo como fracción de la altura (0 = borde superior, 1 = borde inferior) e izquierda y derecha como fracción del ancho (0 = borde izquierdo, 1 = borde derecho). Si esos datos están en dos zonas separadas, da hasta 2 recuadros. Cada recuadro debe contener las líneas de texto completas, con un poco de margen.',
      'Responde SOLO con JSON con esta forma:',
      '{"camaras":[{"imagen":1,"canal":"CH1","bus":null,"texto":"texto sobreimpreso","tiene_coordenadas":false,"franjas":[{"arriba":0.0,"abajo":0.07,"izquierda":0.0,"derecha":0.55}],"lat":null,"lon":null,"fecha_hora":null,"velocidad_kmh":null}]}',
      'Coordenadas en grados decimales con signo (sur y oeste negativos; convierte grados-minutos-segundos si hace falta). fecha_hora como AAAA-MM-DD HH:MM:SS.',
    ].join('\n\n');
    const data = await S.sample.json(prompt, { images, modelTier: S.tier, signal: b.ctl.signal });
    spend(detTok + textTokens(prompt) + textTokens(JSON.stringify(data)));
    const list = Array.isArray(data && data.camaras) ? data.camaras : Array.isArray(data) ? data : [];
    const items = [];
    list.forEach((it, i) => {
      const fr = frames[(Math.round(num(it && it.imagen)) || i + 1) - 1];
      if (!fr || !it) return;
      const lat = num(it.lat);
      const lon = num(it.lon);
      const has = !!it.tiene_coordenadas && validLL(lat, lon);
      const item = {
        key: fr.cam.key,
        canal: it.canal ? String(it.canal).toUpperCase().replace(/\s+/g, '') : null,
        bus: it.bus ? String(it.bus) : null,
        texto: String(it.texto || ''),
        has,
        bands: normBands(it.franjas),
        lat: has ? lat : null,
        lon: has ? lon : null,
        clock: parseClock(it.fecha_hora),
        speed: numOrNull(it.velocidad_kmh),
        t: fr.t + fr.cam.offset,
      };
      items.push(item);
      if (item.canal && /^CH\d{1,2}$/.test(item.canal) && /^CÁM /.test(fr.cam.label)) {
        fr.cam.label = item.canal;
        if (fr.cam.lblInput) fr.cam.lblInput.value = item.canal;
      }
      if (item.bus && !S.busId) S.busId = item.bus.slice(0, 24);
      if (item.clock != null && !S.osdClockRef) S.osdClockRef = { t: item.t, clock: item.clock };
    });
    const chosen = items.find((i) => i.has);
    S.osd = { items, camKey: chosen ? chosen.key : S.osd.camKey || (items[0] && items[0].key) || null, bands: {} };
    persist();
    return chosen || null;
  }
  async function detectOSD() {
    if (!S.cams.length) return toast('Primero carga los videos de las cámaras.', 'err');
    if (!aiReady()) return;
    pause();
    const b = busyStart('Capturando un fotograma de cada cámara…');
    try {
      const chosen = await coreDetect(b);
      if (b.stopped) return;
      renderAll();
      if (chosen) toast(`Encontré coordenadas en ${camByKey(chosen.key).label}. Revisa la franja y extrae el recorrido.`, 'ok');
      else toast('No encontré coordenadas escritas en las cámaras. Puedes ajustar la franja a mano o importar un archivo de recorrido.', 'err');
    } catch (e) {
      onAiError(e);
    } finally {
      busyEnd();
    }
  }
  function drawCanvasScaled(src, maxW) {
    const s = Math.min(1, maxW / src.width);
    const c = canvas(src.width * s, src.height * s);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  function cropBands(frame, bands) {
    const fw = frame.width;
    const fh = frame.height;
    const parts = bands.map((b) => {
      const sy = Math.max(0, Math.floor(b.top * fh));
      const ey = Math.min(fh, Math.ceil(b.bottom * fh));
      const sx = Math.max(0, Math.floor((b.left ?? 0) * fw));
      const ex = Math.min(fw, Math.ceil((b.right ?? 1) * fw));
      return { sx, sy, sw: Math.max(8, ex - sx), sh: Math.max(4, ey - sy) };
    });
    const s = Math.min(1, 1100 / Math.max(...parts.map((p) => p.sw)));
    const W = Math.round(Math.max(...parts.map((p) => p.sw)) * s);
    const H = parts.reduce((a, p) => a + Math.round(p.sh * s), 0) + (parts.length - 1) * 3;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#333';
    g.fillRect(0, 0, c.width, c.height);
    let y = 0;
    for (const p of parts) {
      const dh = Math.round(p.sh * s);
      g.drawImage(frame, p.sx, p.sy, p.sw, p.sh, 0, y, Math.round(p.sw * s), dh);
      y += dh + 3;
    }
    return c;
  }
  function buildComposites(rows) {
    const out = [];
    const gut = 72;
    const sep = 6;
    const budget = 1150000;
    let cur = [];
    const heightOf = (list) => list.reduce((a, r) => a + r.canvas.height + sep, sep);
    const flush = () => {
      if (!cur.length) return;
      const W = gut + Math.max(...cur.map((r) => r.canvas.width));
      const c = canvas(W, heightOf(cur));
      const g = c.getContext('2d');
      g.fillStyle = '#0b0f12';
      g.fillRect(0, 0, c.width, c.height);
      let y = sep;
      for (const r of cur) {
        const rh = r.canvas.height;
        g.fillStyle = '#26323b';
        g.fillRect(0, y, gut - 6, rh);
        g.fillStyle = '#ffffff';
        g.font = `700 ${Math.round(clamp(rh * 0.45, 13, 24))}px "IBM Plex Mono", monospace`;
        g.textBaseline = 'middle';
        g.fillText(`#${r.n}`, 6, y + rh / 2);
        g.drawImage(r.canvas, gut, y);
        y += rh + sep;
      }
      out.push({ canvas: c, ns: cur.map((r) => r.n) });
      cur = [];
    };
    for (const r of rows) {
      const W = gut + r.canvas.width;
      if (cur.length && (W * (heightOf(cur) + r.canvas.height + sep) > budget || cur.length >= 24)) flush();
      cur.push(r);
    }
    flush();
    return out;
  }
  function ocrPlan(cam) {
    const v = $('#ocrEvery').value;
    const dur = cam && isFinite(cam.duration) ? cam.duration : 0;
    const every = v === 'auto' ? Math.max(5, Math.ceil(dur / 150)) : Number(v);
    const times = [];
    for (let t = Math.min(1, dur / 2); t < dur - 0.3; t += every) times.push(+t.toFixed(2));
    if (times.length > 400) times.length = 400;
    return { every, times };
  }
  function ocrCost(cam) {
    const { every, times } = ocrPlan(cam);
    const vw = cam.video.videoWidth || 1280;
    const vh = cam.video.videoHeight || 720;
    const bands = bandsFor(cam.key);
    const sw = Math.max(...bands.map((b) => (b.right - b.left) * vw));
    const sc = Math.min(1, 1100 / sw);
    const rowW = 72 + sw * sc;
    const rowH = bands.reduce((a, b) => a + (b.bottom - b.top) * vh * sc + 3, 0) + 6;
    const perComp = clamp(Math.floor(1150000 / (rowW * rowH)), 1, 24);
    const comps = Math.ceil(times.length / perComp);
    const calls = Math.ceil(comps / Math.max(1, Math.min(maxImages(), 4)));
    const tokens = Math.round(times.length * rowW * rowH / 750 + calls * 350 + times.length * 40);
    return { every, n: times.length, calls, tokens };
  }
  function ocrEstimate() {
    const cam = camByKey(S.osd.camKey);
    const out = $('#ocrEstimate');
    if (!cam || !isFinite(cam.duration)) {
      out.textContent = '';
      return;
    }
    const c = ocrCost(cam);
    out.textContent = `${c.n} lecturas (cada ${c.every} s) · ${c.calls} consulta${c.calls === 1 ? '' : 's'} · ≈ ${kTok(c.tokens)}`;
  }
  function updateEstimates() {
    const box = $('#estAnalysis');
    if (!box) return;
    const n = S.cams.filter((c) => !c.error).length;
    if (!n) {
      box.textContent = '';
      renderPrep();
      return;
    }
    const cam = S.cams[0];
    const vw = cam.video.videoWidth || 1280;
    const vh = cam.video.videoHeight || 720;
    const s = Math.min(1, 768 / vw);
    const moment = (n <= maxImages() ? n * imgTokens(vw * s, vh * s) : 800) + 900 + 180 * n + 250;
    box.textContent = `“¿Qué pasa aquí?” gasta ≈ ${kTok(moment)} con el modelo ${TIERS[S.tier].toLowerCase()}. Buscar arriba gasta ≈ ${kTok(3500)} (solo texto).`;
    renderPrep();
  }


  async function coreExtract(b) {
    const cam = camByKey(S.osd.camKey);
    if (!cam) throw { code: 'local', message: 'Elige la cámara que muestra las coordenadas.' };
    const bands = bandsFor(cam.key);
    const item = osdItem(cam.key);
    const { times } = ocrPlan(cam);
    if (times.length < 2) throw { code: 'local', message: 'El video es demasiado corto para armar un recorrido.' };
    await ensureProbe(cam);
    const rows = [];
    for (let i = 0; i < times.length; i++) {
      const frame = await grabAt(cam, times[i]);
      if (b.stopped) return null;
      rows.push({ n: i + 1, t: times[i], canvas: cropBands(frame, bands) });
      if (i % 3 === 0 || i === times.length - 1) busySet(`Leyendo el video ${i + 1}/${times.length}…`, ((i + 1) / times.length) * 0.5);
    }
    const comps = buildComposites(rows);
    const perCall = Math.max(1, Math.min(maxImages(), 4));
    const groups = [];
    for (let i = 0; i < comps.length; i += perCall) groups.push(comps.slice(i, i + perCall));
    const results = new Map();
    let failed = 0;
    const ref = item && item.has ? `En una lectura previa este texto decía: "${item.texto.slice(0, 200)}", que corresponde a lat ${item.lat}, lon ${item.lon}.` : '';
    let ocrTok = 0;
    for (let gi = 0; gi < groups.length; gi++) {
      if (b.stopped) return null;
      busySet(`Claude está leyendo las coordenadas ${gi + 1}/${groups.length}…`, 0.5 + (gi / groups.length) * 0.5);
      const g = groups[gi];
      const ns = g.flatMap((c) => c.ns);
      const images = await Promise.all(g.map((c) => toJpeg(c.canvas, 0.92)));
      ocrTok += g.reduce((a, c) => a + imgTokens(c.canvas.width, c.canvas.height), 0);
      const prompt = [
        `Cada imagen contiene franjas numeradas (#${ns[0]} a #${ns[ns.length - 1]}) recortadas del texto sobreimpreso de una cámara de autobús en distintos momentos. ${ref}`,
        'Lee en cada franja la latitud, la longitud, la fecha y hora, y la velocidad. Convierte las coordenadas a grados decimales con signo (sur y oeste negativos; convierte grados-minutos o grados-minutos-segundos si hace falta). Copia los dígitos con cuidado y no adivines.',
        `Responde SOLO con un JSON array con un objeto por franja, en orden: [{"n":${ns[0]},"lat":0.0,"lon":0.0,"fecha_hora":"AAAA-MM-DD HH:MM:SS","velocidad_kmh":0}]`,
        'Si en una franja no se puede leer un dato, pon null en ese campo.',
      ].join('\n\n');
      try {
        const data = await S.sample.json(prompt, { images, modelTier: 'quick', signal: b.ctl.signal });
        ocrTok += textTokens(prompt) + textTokens(JSON.stringify(data));
        const list = Array.isArray(data) ? data : (data && (data.franjas || data.resultados || data.puntos)) || [];
        for (const r of list) {
          const n = Math.round(num(r && r.n));
          if (ns.includes(n)) results.set(n, r);
        }
      } catch (e) {
        if (e && (e.code === 'invalid_json' || e.code === 'upstream_error' || e.code === 'empty_completion')) {
          failed++;
          continue;
        }
        throw e;
      }
    }
    spend(ocrTok);
    const pts = [];
    for (const row of rows) {
      const r = results.get(row.n);
      if (!r) continue;
      const lat = num(r.lat);
      const lon = num(r.lon);
      if (!validLL(lat, lon)) continue;
      pts.push({ t: row.t + cam.offset, lat, lon, speed: numOrNull(r.velocidad_kmh ?? r.velocidad), clock: parseClock(r.fecha_hora) });
    }
    const clean = cleanTrack(pts);
    if (clean.length < 2) throw { code: 'local', message: 'No se pudieron leer suficientes coordenadas. Revisa que la franja del paso 2 contenga el texto completo y vuelve a intentarlo.' };
    setTrack(clean, { source: 'video', cam: cam.label, read: rows.length, ok: clean.length });
    return { ok: clean.length, read: rows.length, failed };
  }
  async function extractTrack() {
    if (!camByKey(S.osd.camKey)) return toast('Elige la cámara que muestra las coordenadas.', 'err');
    if (!aiReady()) return;
    pause();
    const b = busyStart('Leyendo el video…');
    try {
      const r = await coreExtract(b);
      if (r) toast(`Recorrido listo: ${r.ok} puntos válidos de ${r.read} lecturas${r.failed ? ` (${r.failed} grupo(s) no se pudieron leer)` : ''}.`, 'ok');
    } catch (e) {
      onAiError(e);
    } finally {
      busyEnd();
    }
  }

  // ---------------------------------------------------------------------------
  // Importar recorrido desde archivo
  // ---------------------------------------------------------------------------
  function parseGpx(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    return Array.from(doc.getElementsByTagName('*'))
      .filter((n) => /^(trkpt|rtept)$/.test(n.localName))
      .map((n) => {
        const child = (name) => Array.from(n.children).find((c) => c.localName === name);
        const sp = child('speed');
        return {
          lat: num(n.getAttribute('lat')),
          lon: num(n.getAttribute('lon')),
          clock: child('time') ? parseClock(child('time').textContent) : null,
          speed: sp ? num(sp.textContent) * 3.6 : null,
        };
      });
  }
  function parseKml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const all = Array.from(doc.getElementsByTagName('*'));
    const whens = all.filter((n) => n.localName === 'when').map((n) => parseClock(n.textContent));
    const gx = all.filter((n) => n.localName === 'coord');
    if (gx.length) {
      return gx.map((n, i) => {
        const [lon, lat] = n.textContent.trim().split(/\s+/).map(Number);
        return { lat, lon, clock: whens[i] ?? null, speed: null };
      });
    }
    const out = [];
    for (const n of all.filter((x) => x.localName === 'coordinates')) {
      for (const tok of n.textContent.trim().split(/\s+/)) {
        const [lon, lat] = tok.split(',').map(Number);
        out.push({ lat, lon, clock: null, speed: null });
      }
    }
    return out;
  }
  function parseNmea(text) {
    const ddm = (v, h) => {
      const x = parseFloat(v);
      if (!isFinite(x)) return NaN;
      const d = Math.floor(x / 100);
      const val = d + (x - d * 100) / 60;
      return /[SW]/i.test(h) ? -val : val;
    };
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/\$(?:GP|GN|GL)(RMC|GGA),([^*]*)/);
      if (!m) continue;
      const f = m[2].split(',');
      if (m[1] === 'RMC') {
        if (f[1] !== 'A') continue;
        const tm = f[0];
        const dt = f[8];
        let clock = null;
        if (tm && dt && dt.length === 6) clock = mk(2000 + +dt.slice(4, 6), +dt.slice(2, 4), +dt.slice(0, 2), +tm.slice(0, 2), +tm.slice(2, 4), +tm.slice(4, 6));
        out.push({ lat: ddm(f[2], f[3]), lon: ddm(f[4], f[5]), clock, speed: isFinite(parseFloat(f[6])) ? parseFloat(f[6]) * 1.852 : null });
      } else {
        const tm = f[0];
        out.push({ lat: ddm(f[1], f[2]), lon: ddm(f[3], f[4]), clock: null, timeOnly: tm ? +tm.slice(0, 2) * 3600 + +tm.slice(2, 4) * 60 + +tm.slice(4, 6) : null, speed: null });
      }
    }
    return out;
  }
  function splitCsvLine(line, d) {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = !q;
      } else if (ch === d && !q) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  }
  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    const first = lines[0];
    const delim = [',', ';', '\t', '|'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const header = splitCsvLine(first, delim).map((h) => h.toLowerCase());
    const find = (re) => header.findIndex((h) => re.test(h));
    const iLat = find(/lat/);
    const iLon = find(/lon|lng|long/);
    const iPos = find(/coord|posici|ubicaci|location|position/);
    const iDT = find(/fecha.?hora|date.?time|timestamp|gps.?time|tiempo/);
    const iDate = find(/fecha|date/);
    const iTime = find(/^hora|time|hora$/);
    const iSpd = find(/veloc|speed|km\/?h/);
    const out = [];
    for (const line of lines.slice(1)) {
      const f = splitCsvLine(line, delim);
      let lat = iLat >= 0 ? num(f[iLat]) : NaN;
      let lon = iLon >= 0 ? num(f[iLon]) : NaN;
      if ((!isFinite(lat) || !isFinite(lon)) && iPos >= 0) {
        const nums = String(f[iPos] || '').match(/-?\d+(?:\.\d+)?/g);
        if (nums && nums.length >= 2) {
          lat = +nums[0];
          lon = +nums[1];
        }
      }
      let clock = null;
      let timeOnly = null;
      if (iDT >= 0) clock = parseClock(f[iDT]);
      if (clock == null && iDate >= 0 && iTime >= 0 && iDate !== iTime) clock = parseClock(`${f[iDate]} ${f[iTime]}`);
      if (clock == null && iDate >= 0) clock = parseClock(f[iDate]);
      if (clock == null && iTime >= 0) timeOnly = parseTimeOnly(f[iTime]);
      out.push({ lat, lon, clock, timeOnly, speed: iSpd >= 0 ? numOrNull(f[iSpd]) : null });
    }
    return out;
  }
  async function importTrack(file) {
    let text;
    try {
      text = await file.text();
    } catch {
      return toast('No se pudo leer el archivo.', 'err');
    }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    let recs;
    if (ext === 'gpx' || /<gpx[\s>]/i.test(text)) recs = parseGpx(text);
    else if (ext === 'kml' || /<kml[\s>]/i.test(text)) recs = parseKml(text);
    else if (/\$G[PNL](RMC|GGA),/.test(text)) recs = parseNmea(text);
    else recs = parseCsv(text);
    recs = recs.filter((r) => validLL(r.lat, r.lon));
    if (!recs.length) return toast('No encontré coordenadas en ese archivo. Revisa que tenga columnas de latitud y longitud.', 'err');
    const base = videoStartClock();
    const D = S.duration || recs.length;
    let pts = [];
    let aligned = false;
    if (base != null && recs.some((r) => r.clock != null)) {
      pts = recs.filter((r) => r.clock != null).map((r) => ({ ...r, t: (r.clock - base) / 1000 }));
      aligned = true;
    } else if (base != null && recs.some((r) => r.timeOnly != null)) {
      const d0 = new Date(base);
      const sod = d0.getUTCHours() * 3600 + d0.getUTCMinutes() * 60 + d0.getUTCSeconds();
      pts = recs.filter((r) => r.timeOnly != null).map((r) => ({ ...r, t: ((r.timeOnly - sod + 86400 * 1.5) % 86400) - 43200, clock: base + (((r.timeOnly - sod + 86400 * 1.5) % 86400) - 43200) * 1000 }));
      aligned = true;
    }
    if (aligned && S.duration) {
      const inside = pts.filter((p) => p.t >= -60 && p.t <= S.duration + 60);
      if (inside.length >= 2) pts = inside;
      else aligned = false;
    }
    if (!aligned) {
      const withClock = recs.filter((r) => r.clock != null);
      if (withClock.length === recs.length && withClock.length > 1) {
        const c0 = withClock[0].clock;
        pts = recs.map((r) => ({ ...r, t: (r.clock - c0) / 1000 }));
      } else {
        pts = recs.map((r, i) => ({ ...r, t: recs.length > 1 ? (i / (recs.length - 1)) * D : 0 }));
      }
      if (S.cams.length) toast('La hora del archivo no coincide con la del video; los puntos se repartieron a lo largo del video. Ajusta el desfase si hace falta.');
    }
    const clean = cleanTrack(pts.map((p) => ({ t: p.t, lat: p.lat, lon: p.lon, speed: p.speed != null && isFinite(p.speed) ? p.speed : null, clock: p.clock ?? null })));
    if (clean.length < 1) return toast('Los puntos del archivo no forman un recorrido válido.', 'err');
    setTrack(clean, { source: 'archivo', name: file.name, read: recs.length, ok: clean.length });
    toast(`Recorrido importado: ${clean.length} puntos.`, 'ok');
  }

  function trackCsv() {
    const rows = [['tiempo_video', 'hora_equipo', 'latitud', 'longitud', 'velocidad_kmh']];
    for (const p of S.track) rows.push([hms(tOf(p)), p.clock != null ? isoClock(p.clock) : '', p.lat.toFixed(6), p.lon.toFixed(6), p.speed != null ? Math.round(p.speed) : '']);
    return rows.map((r) => r.join(',')).join('\n');
  }
  function trackGeoJson() {
    const coord = (p) => [+p.lon.toFixed(6), +p.lat.toFixed(6)];
    const features = [
      { type: 'Feature', properties: { nombre: S.busId || 'Recorrido', puntos: S.track.length }, geometry: { type: 'LineString', coordinates: S.track.map(coord) } },
      ...S.track.map((p) => ({
        type: 'Feature',
        properties: { tiempo_video: hms(tOf(p)), hora_equipo: p.clock != null ? isoClock(p.clock) : null, velocidad_kmh: p.speed != null ? Math.round(p.speed) : null },
        geometry: { type: 'Point', coordinates: coord(p) },
      })),
    ];
    return JSON.stringify({ type: 'FeatureCollection', features });
  }

  // ---------------------------------------------------------------------------
  // Informe
  // ---------------------------------------------------------------------------
  async function writeReport() {
    if (!aiReady(false)) return;
    if (!S.analyses.length && !S.index.length && !S.track.length) return toast('Primero prepara el video.', 'err');
    const out = $('#report');
    const b = busyStart('Claude está redactando el informe…');
    out.replaceChildren(el('p', { class: 'muted', text: 'Redactando…' }));
    const st = routeStats();
    const prompt = [
      RULES,
      'Redacta un informe profesional de revisión de video con estas secciones en Markdown: "# Informe de revisión de video", "## Datos generales" (unidad, fecha, horario, cámaras, recorrido), "## Resumen", "## Hechos relevantes" (lista cronológica con hora y cámara), "## Alertas y nivel de riesgo", "## Recomendaciones". Usa solo la información proporcionada; si falta algo, indícalo sin inventar.',
      `Contexto:\n${contextText()}`,
      S.track.length > 1
        ? `Recorrido: ${S.track.length} puntos GPS, ${st.km.toFixed(1)} km, velocidad máxima ${st.vmax ?? 'sin dato'} km/h, velocidad promedio ${st.vavg ?? 'sin dato'} km/h, de ${S.track[0].lat.toFixed(5)}, ${S.track[0].lon.toFixed(5)} a ${S.track[S.track.length - 1].lat.toFixed(5)}, ${S.track[S.track.length - 1].lon.toFixed(5)}.`
        : 'Recorrido: sin datos GPS.',
      `Índice del video:\n${indexText(9000)}`,
      `Análisis puntuales:\n${digest(5000)}`,
    ].join('\n\n');
    try {
      const { text, truncated } = await S.sample(prompt, {
        modelTier: S.tier,
        cache: false,
        signal: b.ctl.signal,
        onText: ({ text: t }) => renderMd(out, t),
      });
      S.reportMd = text;
      renderMd(out, text);
      spend(textTokens(prompt) + textTokens(text));
      if (truncated) toast('El informe quedó cortado por su longitud. Puedes pedirlo de nuevo con menos análisis.', 'err');
      persist();
    } catch (e) {
      if (e && e.text) {
        S.reportMd = e.text;
        renderMd(out, e.text);
      } else renderReportEmpty();
      onAiError(e);
    } finally {
      busyEnd();
    }
  }
  function inline(text) {
    const frag = document.createDocumentFragment();
    String(text)
      .split(/(\*\*[^*]+\*\*)/)
      .forEach((part) => {
        if (/^\*\*[^*]+\*\*$/.test(part)) frag.append(el('strong', { text: part.slice(2, -2) }));
        else if (part) frag.append(part);
      });
    return frag;
  }
  function renderMd(target, md) {
    target.replaceChildren();
    let list = null;
    let para = [];
    const flush = () => {
      if (para.length) target.append(el('p', null, inline(para.join(' '))));
      para = [];
    };
    for (const raw of String(md).split(/\r?\n/)) {
      const line = raw.trimEnd();
      let m;
      if (!line.trim()) {
        flush();
        list = null;
      } else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
        flush();
        list = null;
        target.append(el(`h${m[1].length}`, null, inline(m[2])));
      } else if ((m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/))) {
        flush();
        const ordered = /^\s*\d/.test(line);
        if (!list || list.tagName !== (ordered ? 'OL' : 'UL')) {
          list = el(ordered ? 'ol' : 'ul');
          target.append(list);
        }
        list.append(el('li', null, inline(m[1])));
      } else {
        list = null;
        para.push(line.trim());
      }
    }
    flush();
  }
  function mdToHtml(md) {
    const tmp = document.createElement('div');
    renderMd(tmp, md);
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe de revisión de video</title><style>body{font-family:Arial,Helvetica,sans-serif;max-width:760px;margin:32px auto;padding:0 16px;color:#15202a;line-height:1.5}h1{font-size:24px}h2{font-size:18px;margin-top:24px;border-bottom:1px solid #cbd3da;padding-bottom:4px}li{margin:3px 0}</style></head><body>${tmp.innerHTML}</body></html>`;
  }
  function renderReportEmpty() {
    const out = $('#report');
    if (S.reportMd) return renderMd(out, S.reportMd);
    out.replaceChildren(
      el('p', { class: 'muted', text: 'El informe junta los análisis y el recorrido en un documento listo para entregar. Primero analiza algunos momentos o el video completo.' }),
    );
  }
  async function download(filename, data) {
    if (!S.downloads) return toast('La descarga solo funciona con la página abierta en claude.ai. Usa “Copiar”.', 'err');
    try {
      await S.downloads.save({ filename, data });
    } catch (e) {
      const c = e && e.code;
      if (c === 'declined') return;
      toast(c === 'rate_limited' ? 'Ya hay una descarga esperando tu confirmación.' : 'No se pudo descargar el archivo en esta vista.', 'err');
    }
  }
  const stamp = () => {
    const c = clockAt(0);
    return c != null ? isoClock(c).slice(0, 10) : new Date().toISOString().slice(0, 10);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function renderSession() {
    const box = $('#session');
    box.replaceChildren();
    const chip = (k, v) => el('span', { class: 'chip' }, el('b', { text: k }), el('span', { class: 'mono', text: v }));
    if (S.busId) box.append(chip('Unidad', S.busId));
    const c0 = clockAt(0);
    if (c0 != null) box.append(chip('Fecha', fmtClock(c0).slice(0, 10)));
    box.append(chip('Cámaras', String(S.cams.length)));
    if (S.duration) box.append(chip('Duración', hms(S.duration)));
    if (S.track.length) box.append(chip('GPS', `${S.track.length} pts`));
    if (S.usage) box.append(chip('Uso aprox.', kTok(S.usage)));
  }
  function renderFocus() {
    const box = $('#focusChips');
    box.replaceChildren();
    for (const f of allFocus()) {
      const custom = !ENFOQUES.includes(f);
      const chip = el('button', {
        class: 'fchip',
        type: 'button',
        'aria-pressed': String(S.focusId === f.id),
        title: f.instr,
        onclick: () => {
          S.focusId = f.id;
          store.set('cofcam:focusSel', f.id);
          renderFocus();
        },
      }, f.nombre);
      if (custom) {
        const x = el('span', {
          class: 'x',
          role: 'button',
          tabindex: '0',
          'aria-label': `Borrar el enfoque ${f.nombre}`,
          title: 'Borrar enfoque',
          text: '×',
          onkeydown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.currentTarget.click();
            }
          },
          onclick: (e) => {
            e.stopPropagation();
            S.customFocus = S.customFocus.filter((c) => c.id !== f.id);
            store.set('cofcam:focus', S.customFocus);
            if (S.focusId === f.id) S.focusId = 'general';
            renderFocus();
          },
        });
        chip.append(x);
      }
      box.append(chip);
    }
    box.append(
      el('button', {
        class: 'fchip add',
        type: 'button',
        text: '+ Nuevo enfoque',
        onclick: () => {
          $('#newFocusForm').hidden = false;
          $('#nfName').focus();
        },
      }),
    );
  }
  function tchip(t) {
    return el('button', { class: 'tchip', type: 'button', title: 'Ir a este momento', onclick: () => seek(t), text: hms(t) });
  }
  function riskBadge(r) {
    return el('span', { class: 'risk', 'data-r': r, text: r === 'ninguno' ? 'Sin riesgo' : `Riesgo ${r}` });
  }
  function listBlock(title, items) {
    if (!items.length) return null;
    return el('div', null, el('span', { class: 'label', text: title }), el('ul', null, items.map((x) => el('li', { text: x }))));
  }
  function removeBtn(a) {
    return el('button', {
      class: 'btn ghost small',
      type: 'button',
      text: 'Quitar',
      onclick: () => {
        S.analyses = S.analyses.filter((x) => x !== a);
        persist();
        renderAll();
        renderEvents();
      },
    });
  }
  function momentCard(a) {
    const clk = a.clock != null ? el('span', { class: 'mono small muted', text: fmtClock(a.clock, false) }) : null;
    return el(
      'article',
      { class: 'card', 'data-risk': a.riesgo },
      el('div', { class: 'card-head' }, el('span', { class: 'kind', text: 'Momento' }), tchip(a.t), clk, el('span', { class: 'chip', text: a.focus }), el('span', { class: 'spacer' }), riskBadge(a.riesgo), removeBtn(a)),
      a.resumen ? el('p', { text: a.resumen }) : null,
      a.alertas.length ? el('div', { class: 'alerts' }, el('b', { text: 'Alertas' }), el('ul', null, a.alertas.map((x) => el('li', { text: x })))) : null,
      a.camaras.map((c) =>
        el(
          'div',
          { class: 'cam-block' },
          el('span', { class: 'cl', text: c.camara }),
          el(
            'div',
            null,
            el('p', { text: c.descripcion }),
            el('span', { class: 'meta', text: [c.personas != null ? `${c.personas} persona${c.personas === 1 ? '' : 's'} visibles` : null, c.riesgo !== 'ninguno' ? `riesgo ${c.riesgo}` : null].filter(Boolean).join(' · ') }),
            c.hallazgos.length ? el('ul', null, c.hallazgos.map((h) => el('li', { text: h }))) : null,
          ),
        ),
      ),
    );
  }
  function generalCard(a) {
    return el(
      'article',
      { class: 'card', 'data-risk': a.riesgo },
      el('div', { class: 'card-head' }, el('span', { class: 'kind', text: 'Análisis general' }), el('span', { class: 'chip', text: a.focus }), el('span', { class: 'mono small muted', text: `${a.momentos.length} momentos` }), el('span', { class: 'spacer' }), riskBadge(a.riesgo), removeBtn(a)),
      a.resumen ? el('p', { text: a.resumen }) : null,
      a.momentos.map((m) =>
        el(
          'div',
          { class: 'moment' },
          tchip(m.t),
          el(
            'div',
            null,
            el('p', { text: m.descripcion }),
            m.eventos.length ? el('ul', null, m.eventos.map((x) => el('li', { text: x }))) : null,
            m.riesgo !== 'ninguno' ? riskBadge(m.riesgo) : null,
          ),
        ),
      ),
      listBlock('Conclusiones', a.conclusiones),
      listBlock('Recomendaciones', a.recomendaciones),
    );
  }
  function exampleCard() {
    const card = el(
      'article',
      { class: 'card', 'data-risk': 'medio' },
      el('span', { class: 'example-tag', text: 'Ejemplo' }),
      el('div', { class: 'card-head' }, el('span', { class: 'kind', text: 'Momento' }), el('span', { class: 'tchip', text: '00:42:10' }), el('span', { class: 'chip', text: 'Seguridad e incidentes' })),
      el('p', { text: 'Bus en marcha con ocupación media. En la puerta trasera un pasajero discute con otro y lo empuja; el conductor no parece darse cuenta.' }),
      el('div', { class: 'alerts' }, el('b', { text: 'Alertas' }), el('ul', null, el('li', { text: 'Posible agresión física cerca de la puerta trasera (CH3).' }))),
      el(
        'div',
        { class: 'cam-block' },
        el('span', { class: 'cl', text: 'CH3' }),
        el('div', null, el('p', { text: 'Dos pasajeros de pie junto a la puerta trasera. Uno de ellos, con gorra oscura, empuja al otro contra el tubo de sujeción.' }), el('span', { class: 'meta', text: '6 personas visibles · riesgo medio' })),
      ),
    );
    return card;
  }
  function indexRow(e) {
    return el(
      'div',
      { class: 'idx-row', 'data-t': String(e.t) },
      tchip(e.t),
      el(
        'div',
        null,
        el('span', { text: e.texto }),
        e.personas != null ? el('span', { class: 'meta small muted', text: ` · ${e.personas} persona${e.personas === 1 ? '' : 's'}` }) : null,
        e.eventos.length ? el('ul', null, e.eventos.map((x) => el('li', { text: x }))) : null,
        e.riesgo !== 'ninguno' ? riskBadge(e.riesgo) : null,
      ),
    );
  }
  function renderResults() {
    const box = $('#results');
    box.replaceChildren();
    if (!S.analyses.length && !S.index.length) {
      box.append(el('p', { class: 'hint', text: 'Así se verá cada análisis. Pausa el video donde quieras y pulsa “¿Qué pasa aquí?”.' }), exampleCard());
      return;
    }
    if (S.analyses.length) {
      box.append(el('h3', { class: 'section-title', text: 'Momentos analizados' }));
      for (const a of S.analyses) box.append(a.kind === 'momento' ? momentCard(a) : generalCard(a));
    }
    if (S.index.length) {
      box.append(el('h3', { class: 'section-title' }, 'Índice del video', el('span', { class: 'mono small muted', text: `${S.index.length} momentos${S.indexFocus ? ` · enfoque ${S.indexFocus}` : ''}` })));
      box.append(el('div', { class: 'index-list' }, S.index.map(indexRow)));
    }
  }

  function statTiles(target, list) {
    target.replaceChildren(
      ...list.map(([k, v, unit]) => el('div', { class: 'stat' }, el('span', { class: 'label', text: k }), el('div', { class: 'v' }, v, unit ? el('small', { text: ` ${unit}` }) : null))),
    );
  }
  function renderStats() {
    const st = routeStats();
    const alerts = S.analyses.filter((a) => a.riesgo === 'medio' || a.riesgo === 'alto').length;
    const has = S.track.length > 1;
    statTiles($('#trackStats'), [
      ['Puntos', String(S.track.length)],
      ['Distancia', has ? st.km.toFixed(1) : '—', has ? 'km' : ''],
      ['Vel. máx.', st.vmax != null ? String(st.vmax) : '—', st.vmax != null ? 'km/h' : ''],
      ['Origen', S.trackMeta ? (S.trackMeta.source === 'video' ? `Video ${S.trackMeta.cam}` : 'Archivo') : '—'],
    ]);
    statTiles($('#repStats'), [
      ['Duración', hms(S.duration)],
      ['Cámaras', String(S.cams.length)],
      ['Distancia', has ? st.km.toFixed(1) : '—', has ? 'km' : ''],
      ['Vel. máx.', st.vmax != null ? String(st.vmax) : '—', st.vmax != null ? 'km/h' : ''],
      ['Vel. prom.', st.vavg != null && has ? String(st.vavg) : '—', st.vavg != null && has ? 'km/h' : ''],
      ['Alertas', String(alerts)],
    ]);
  }
  function renderGps() {
    const res = $('#osdResult');
    res.replaceChildren();
    for (const it of S.osd.items) {
      const cam = camByKey(it.key);
      if (!cam) continue;
      res.append(
        el(
          'div',
          { class: 'osd-item' },
          el('span', { class: 'cl', text: cam.label }),
          el(
            'div',
            null,
            el('code', { text: it.texto || '(sin texto en pantalla)' }),
            el('div', {
              class: 'small muted',
              text: it.has ? `Coordenadas: ${it.lat.toFixed(5)}, ${it.lon.toFixed(5)}${it.speed != null ? ` · ${it.speed} km/h` : ''}` : 'Sin coordenadas',
            }),
          ),
        ),
      );
    }
    const hasCams = S.cams.length > 0;
    $('#bandStep').hidden = !hasCams;
    $('#readStep').hidden = !hasCams;
    const sel = $('#osdCam');
    sel.replaceChildren(...S.cams.map((c) => el('option', { value: c.key, text: `${c.label} · ${c.file.name}` })));
    if (hasCams && !camByKey(S.osd.camKey)) S.osd.camKey = S.cams[0].key;
    if (hasCams) sel.value = S.osd.camKey;
    renderBandInputs();
    ocrEstimate();
    $('#trackStep').hidden = !S.track.length;
    renderPoints();
  }
  function renderBandInputs() {
    const box = $('#bandInputs');
    box.replaceChildren();
    const key = S.osd.camKey;
    if (!key) return;
    const bands = bandsFor(key).map((b) => ({ ...b }));
    const commit = () => {
      S.osd.bands[key] = normBandsManual(bands);
      persist();
      drawBandPreview();
      ocrEstimate();
    };
    bands.forEach((b, i) => {
      for (const [prop, name] of [
        ['top', 'arriba'],
        ['bottom', 'abajo'],
        ['left', 'izquierda'],
        ['right', 'derecha'],
      ]) {
        const id = `band-${i}-${prop}`;
        const input = el('input', { type: 'number', id, min: 0, max: 100, step: 0.5 });
        input.value = String(+(b[prop] * 100).toFixed(1));
        input.addEventListener('change', () => {
          b[prop] = clamp(num(input.value) / 100, 0, 1);
          commit();
        });
        box.append(el('label', { for: id }, `Franja ${i + 1}, ${name} (%)`, input));
      }
    });
    const tools = el('div', { class: 'btn-row' });
    if (bands.length < 2)
      tools.append(
        el('button', {
          class: 'btn small',
          type: 'button',
          text: 'Agregar franja',
          onclick: () => {
            bands.push({ top: 0.9, bottom: 1, left: 0, right: 1 });
            commit();
            renderBandInputs();
          },
        }),
      );
    if (bands.length > 1)
      tools.append(
        el('button', {
          class: 'btn small ghost',
          type: 'button',
          text: 'Quitar franja 2',
          onclick: () => {
            bands.pop();
            commit();
            renderBandInputs();
          },
        }),
      );
    box.append(tools);
    drawBandPreview();
  }
  function normBandsManual(list) {
    return list
      .map((b) => ({ top: Math.min(b.top, b.bottom), bottom: Math.max(b.top, b.bottom), left: Math.min(b.left, b.right), right: Math.max(b.left, b.right) }))
      .map((b) => (b.bottom - b.top < 0.01 ? { ...b, bottom: Math.min(1, b.top + 0.02) } : b))
      .map((b) => (b.right - b.left < 0.05 ? { ...b, left: 0, right: 1 } : b));
  }
  let previewToken = 0;
  async function drawBandPreview() {
    const key = S.osd.camKey;
    const cam = camByKey(key);
    const cv = $('#bandPreview');
    if (!cam) return;
    const token = ++previewToken;
    let frame = S.frameCache.get(key);
    if (!frame) {
      if (!isFinite(cam.duration)) return;
      try {
        frame = await grabAt(cam, clamp(cam.duration * 0.1, 0, Math.max(0, cam.duration - 1)));
        S.frameCache.set(key, frame);
      } catch {
        return;
      }
    }
    if (token !== previewToken) return;
    const crop = cropBands(frame, bandsFor(key));
    cv.width = crop.width;
    cv.height = crop.height;
    cv.getContext('2d').drawImage(crop, 0, 0);
  }
  function renderPoints() {
    const t = $('#ptsTable');
    t.replaceChildren();
    if (!S.track.length) return;
    t.append(el('thead', null, el('tr', null, ['Video', 'Hora equipo', 'Latitud', 'Longitud', 'km/h'].map((h) => el('th', { text: h })))));
    const body = el('tbody');
    for (const p of S.track.slice(0, 400)) {
      const tr = el(
        'tr',
        { title: 'Ir a este momento', onclick: () => seek(tOf(p)) },
        el('td', { text: hms(tOf(p)) }),
        el('td', { text: p.clock != null ? fmtClock(p.clock, false) : '—' }),
        el('td', { text: p.lat.toFixed(5) }),
        el('td', { text: p.lon.toFixed(5) }),
        el('td', { text: p.speed != null ? String(Math.round(p.speed)) : '—' }),
      );
      body.append(tr);
    }
    t.append(body);
  }
  function renderCounts() {
    $('#cntA').textContent = S.analyses.length + S.index.length ? String(S.analyses.length + S.index.length) : '';
    $('#cntR').textContent = S.track.length ? String(S.track.length) : '';
  }
  function refreshButtons() {
    const busy = !!S.busy;
    const noCams = !S.cams.length;
    for (const id of ['#btnMoment', '#btnHere', '#btnDetect', '#btnExtract', '#btnPrep']) $(id).disabled = busy || noCams;
    $('#btnSearch').disabled = busy;
    for (const b of document.querySelectorAll('.qchip')) b.disabled = busy;
    $('#btnReport').disabled = busy;
    $('#btnPlay').disabled = noCams;
    $('#btnBack').disabled = noCams;
    $('#btnFwd').disabled = noCams;
    const hasReport = !!S.reportMd;
    $('#btnDlMd').disabled = !hasReport;
    $('#btnDlHtml').disabled = !hasReport;
    $('#btnCopy').disabled = !hasReport;
  }

  function renderAll() {
    renderSession();
    renderResults();
    renderStats();
    renderGps();
    renderCounts();
    renderPrep();
    updateEstimates();
    refreshButtons();
    onTime(true);
  }
  function showTab(k) {
    for (const t of ['a', 'r', 'i']) {
      $(`#tab-${t}`).setAttribute('aria-selected', String(t === k));
      $(`#p-${t}`).hidden = t !== k;
    }
    try {
      localStorage.setItem('cofcam:tab', k);
    } catch {
      /* sin almacenamiento */
    }
  }

  // ---------------------------------------------------------------------------
  // Guardado local de la sesión (por conjunto de videos)
  // ---------------------------------------------------------------------------
  const sessionKey = () => (S.cams.length ? `cofcam:s:${S.cams.map((c) => c.key).sort().join('||')}` : null);
  function persist() {
    const k = sessionKey();
    if (!k) return;
    store.set(k, {
      v: 1,
      labels: Object.fromEntries(S.cams.map((c) => [c.key, c.label])),
      track: S.track,
      trackMeta: S.trackMeta,
      shift: S.shift,
      osd: S.osd,
      osdClockRef: S.osdClockRef,
      busId: S.busId,
      analyses: S.analyses.slice(0, 60),
      index: S.index,
      indexFocus: S.indexFocus,
      qa: S.qa.filter((x) => !x.pending).slice(0, 20),
      reportMd: S.reportMd,
      usage: S.usage,
    });
  }
  function restoreSession() {
    const k = sessionKey();
    const saved = k && store.get(k, null);
    if (!saved || saved.v !== 1) return;
    for (const c of S.cams) {
      if (saved.labels && saved.labels[c.key]) {
        c.label = saved.labels[c.key];
        if (c.lblInput) c.lblInput.value = c.label;
      }
    }
    S.track = Array.isArray(saved.track) ? saved.track : [];
    S.clockPts = S.track.filter((p) => p.clock != null);
    S.trackMeta = saved.trackMeta || null;
    S.shift = Number(saved.shift) || 0;
    $('#shiftSec').value = String(S.shift);
    S.osd = saved.osd && Array.isArray(saved.osd.items) ? saved.osd : { items: [], camKey: null, bands: {} };
    S.osdClockRef = saved.osdClockRef || null;
    S.busId = saved.busId || null;
    S.analyses = Array.isArray(saved.analyses) ? saved.analyses : [];
    S.index = Array.isArray(saved.index) ? saved.index : [];
    S.indexFocus = saved.indexFocus || null;
    S.qa = Array.isArray(saved.qa) ? saved.qa : [];
    S.reportMd = saved.reportMd || '';
    S.usage = Number(saved.usage) || 0;
    renderAnswers();
    renderEvents();
    renderRoute();
    renderReportEmpty();
    if (S.analyses.length || S.track.length || S.index.length) toast('Recuperé el trabajo anterior con estos mismos videos.', 'ok');
  }

  // ---------------------------------------------------------------------------
  // Eventos de la interfaz
  // ---------------------------------------------------------------------------
  function bind() {
    $('#videoInput').addEventListener('change', (e) => {
      addFiles(e.target.files);
      e.target.value = '';
    });
    const wrap = $('#wallWrap');
    wrap.addEventListener('dragover', (e) => {
      e.preventDefault();
      wrap.classList.add('dragging');
    });
    wrap.addEventListener('dragleave', () => wrap.classList.remove('dragging'));
    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      wrap.classList.remove('dragging');
      addFiles(e.dataTransfer && e.dataTransfer.files);
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());

    $('#btnPlay').addEventListener('click', () => (S.playing ? pause() : play()));
    $('#btnBack').addEventListener('click', () => seek(S.t - 10));
    $('#btnFwd').addEventListener('click', () => seek(S.t + 10));
    for (const b of document.querySelectorAll('#rateSeg button')) {
      b.addEventListener('click', () => {
        S.rate = Number(b.dataset.rate);
        for (const x of document.querySelectorAll('#rateSeg button')) x.setAttribute('aria-pressed', String(x === b));
        syncCams(false);
      });
    }
    for (const b of document.querySelectorAll('#tierSeg button')) {
      b.addEventListener('click', () => {
        S.tier = b.dataset.tier;
        store.set('cofcam:tier2', S.tier);
        updateEstimates();
        for (const x of document.querySelectorAll('#tierSeg button')) x.setAttribute('aria-pressed', String(x === b));
      });
    }
    const scrub = $('#scrub');
    scrub.addEventListener('pointerdown', () => (scrubbing = true));
    scrub.addEventListener('pointerup', () => (scrubbing = false));
    scrub.addEventListener('input', () => seek(Number(scrub.value)));
    $('#lane').addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      if (S.duration) seek(((e.clientX - r.left) / r.width) * S.duration);
    });
    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea, select, [contenteditable]')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (S.playing) pause();
        else play();
      } else if (e.key === 'ArrowLeft') seek(S.t - 5);
      else if (e.key === 'ArrowRight') seek(S.t + 5);
    });

    $('#btnMoment').addEventListener('click', analyzeMoment);
    $('#btnHere').addEventListener('click', analyzeMoment);
    $('#btnPrep').addEventListener('click', runPipeline);
    $('#autoRun').addEventListener('change', (e) => {
      S.autoRun = e.target.checked;
      store.set('cofcam:auto', S.autoRun);
      if (S.autoRun) {
        S.autoTried = false;
        maybeAutoRun();
      }
    });
    $('#idxEvery').addEventListener('change', renderPrep);
    $('#searchForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = $('#q').value.trim();
      if (q) search(q);
    });
    $('#newFocusForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const nombre = $('#nfName').value.trim();
      const instr = $('#nfInstr').value.trim();
      if (!nombre || !instr) return toast('Escribe un nombre y qué debe revisar la IA.', 'err');
      const f = { id: `c-${uid()}`, nombre: nombre.slice(0, 40), instr: instr.slice(0, 800) };
      S.customFocus.push(f);
      store.set('cofcam:focus', S.customFocus);
      S.focusId = f.id;
      $('#nfName').value = '';
      $('#nfInstr').value = '';
      $('#newFocusForm').hidden = true;
      renderFocus();
      toast(`Enfoque “${f.nombre}” guardado.`, 'ok');
    });
    $('#nfCancel').addEventListener('click', () => ($('#newFocusForm').hidden = true));

    $('#btnDetect').addEventListener('click', detectOSD);
    $('#btnExtract').addEventListener('click', extractTrack);
    $('#osdCam').addEventListener('change', (e) => {
      S.osd.camKey = e.target.value;
      persist();
      renderBandInputs();
      ocrEstimate();
    });
    $('#ocrEvery').addEventListener('change', ocrEstimate);
    $('#trackFile').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) importTrack(f);
    });
    $('#shiftSec').addEventListener('change', (e) => {
      S.shift = num(e.target.value) || 0;
      S.clockPts = S.track.filter((p) => p.clock != null);
      persist();
      renderEvents();
      renderPoints();
      onTime(true);
      updateBus(posAt(S.t), true);
    });
    $('#btnCsv').addEventListener('click', () => download(`recorrido-${S.busId || 'bus'}-${stamp()}.csv`, trackCsv()));
    $('#btnGeo').addEventListener('click', () => download(`recorrido-${S.busId || 'bus'}-${stamp()}.geojson.json`, trackGeoJson()));
    $('#btnClearTrack').addEventListener('click', () => {
      setTrack([], null);
      if (Mp.base) {
        Mp.base.remove();
        Mp.base = null;
        Mp.baseKey = null;
      }
      toast('Recorrido borrado.');
    });

    $('#btnReport').addEventListener('click', writeReport);
    $('#btnDlMd').addEventListener('click', () => download(`informe-${S.busId || 'bus'}-${stamp()}.md`, S.reportMd));
    $('#btnDlHtml').addEventListener('click', () => download(`informe-${S.busId || 'bus'}-${stamp()}.html`, mdToHtml(S.reportMd)));
    $('#btnCopy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(S.reportMd);
        toast('Informe copiado.', 'ok');
      } catch {
        const r = document.createRange();
        r.selectNodeContents($('#report'));
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        toast('Texto seleccionado: cópialo con Ctrl+C.');
      }
    });

    $('#btnFollow').addEventListener('click', () => setFollow(!Mp.follow));
    $('#btnFit').addEventListener('click', () => {
      if (!Mp.map || !S.track.length) return;
      setFollow(false);
      Mp.map.fitBounds(L.latLngBounds(S.track.map((p) => [p.lat, p.lon])).pad(0.12), { maxZoom: 17 });
    });
    $('#btnAddr').addEventListener('click', whereIsBus);

    for (const k of ['a', 'r', 'i']) $(`#tab-${k}`).addEventListener('click', () => showTab(k));
    if (window.ResizeObserver) new ResizeObserver(() => drawLane()).observe($('#lane'));
  }

  // ---------------------------------------------------------------------------
  // Inicio
  // ---------------------------------------------------------------------------
  function start() {
    const tier = store.get('cofcam:tier2', 'quick');
    if (TIERS[tier]) S.tier = tier;
    for (const x of document.querySelectorAll('#tierSeg button')) x.setAttribute('aria-pressed', String(x.dataset.tier === S.tier));
    const sel = store.get('cofcam:focusSel', 'general');
    if (allFocus().some((f) => f.id === sel)) S.focusId = sel;
    bind();
    initMap();
    renderWall();
    renderFocus();
    renderAll();
    renderReportEmpty();
    renderQuick();
    renderAnswers();
    $('#autoRun').checked = S.autoRun;
    updatePlayBtn();
    let tab = 'a';
    try {
      tab = localStorage.getItem('cofcam:tab') || 'a';
    } catch {
      /* sin almacenamiento */
    }
    showTab(['a', 'r', 'i'].includes(tab) ? tab : 'a');
    initCaps();
  }
  start();
})();
