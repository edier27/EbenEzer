'use strict';
// ════════════════════════════════════════════════════════════════════
// TIENDA EBEN-EZER — Núcleo: utilidades, formato, ventanas y formularios
// Todo el sistema cuelga del objeto global T (sin dependencias externas).
// ════════════════════════════════════════════════════════════════════
window.T = window.T || {};
(function (T) {
  // Debe coincidir con version.json (ver README → "Cómo actualizar").
  T.VERSION = '1.3.0';
  T.vistas = {};

  T.$ = (s, el) => (el || document).querySelector(s);
  T.$$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  const MAPA = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  T.esc = v => String(v ?? '').replace(/[&<>"']/g, c => MAPA[c]);

  T.uid = () => {
    if (crypto.randomUUID) return crypto.randomUUID();
    // Contextos sin HTTPS (celular por WiFi) no tienen randomUUID.
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };

  // ── Números y dinero (pesos colombianos, sin decimales) ──
  const fCOP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  T.money = n => fCOP.format(Math.round(n || 0));
  T.num = (n, d = 0) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: d }).format(n || 0);
  T.cant = n => T.num(n, 3);
  T.aNum = v => {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const n = parseFloat(String(v ?? '').trim().replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : 0;
  };
  T.red = n => Math.round(n || 0);
  T.r3 = n => Math.round((n || 0) * 1000) / 1000;
  T.norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

  // ── Fechas (siempre hora local del equipo) ──
  const p2 = n => String(n).padStart(2, '0');
  T.dia = (ts = Date.now()) => { const d = new Date(ts); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
  T.iniDia = s => { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d).getTime(); };
  T.finDia = s => T.iniDia(s) + 86400000 - 1;
  T.fecha = ts => ts ? new Date(ts).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  T.hora = ts => ts ? new Date(ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '—';
  T.fechaHora = ts => ts ? `${T.fecha(ts)} ${T.hora(ts)}` : '—';
  T.fechaCorta = s => s ? T.fecha(T.iniDia(s)) : '—';

  // ── Eventos internos ──
  const oyentes = {};
  T.on = (ev, fn) => { (oyentes[ev] = oyentes[ev] || []).push(fn); };
  T.emit = (ev, dato) => { (oyentes[ev] || []).forEach(fn => { try { fn(dato); } catch (e) { console.error(e); } }); };
  T.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // ── SHA-256 propio (crypto.subtle no existe sin HTTPS) ──
  T.sha256 = function (texto) {
    const bytes = new TextEncoder().encode(texto);
    const K = [], H = [];
    for (let n = 2, i = 0; i < 64; n++) {
      let primo = true;
      for (let d = 2; d * d <= n; d++) if (n % d === 0) { primo = false; break; }
      if (!primo) continue;
      if (i < 8) H[i] = (Math.pow(n, 0.5) * 4294967296) | 0;
      K[i++] = (Math.pow(n, 1 / 3) * 4294967296) | 0;
    }
    const l = bytes.length, total = ((l + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(total); m.set(bytes); m[l] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(total - 8, Math.floor(l / 536870912)); dv.setUint32(total - 4, (l << 3) >>> 0);
    const w = new Int32Array(64), rot = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < total; o += 64) {
      for (let t = 0; t < 16; t++) w[t] = dv.getInt32(o + t * 4);
      for (let t = 16; t < 64; t++) {
        const a = w[t - 15], b = w[t - 2];
        w[t] = (w[t - 16] + (rot(a, 7) ^ rot(a, 18) ^ (a >>> 3)) + w[t - 7] + (rot(b, 17) ^ rot(b, 19) ^ (b >>> 10))) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let t = 0; t < 64; t++) {
        const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) | 0;
        const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
    }
    return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  };

  // ── Iconos (trazo, 24×24) ──
  const ICO = {
    inicio: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    vender: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a1 1 0 0 0 1 .8h9.4a1 1 0 0 0 1-.8L21 7H6"/>',
    inventario: '<path d="M3 7.5l9-4.5 9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5l9 4.5 9-4.5M12 12v9"/>',
    compras: '<path d="M2 6h11v10H2zM13 9h4l4 4v3h-8z"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    clientes: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
    caja: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/>',
    reportes: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    ia: '<path d="M11 3l1.9 5.6L18.5 10.5l-5.6 1.9L11 18l-1.9-5.6L3.5 10.5l5.6-1.9z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
    auditoria: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    config: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    camara: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
    buscar: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5"/>',
    mas: '<path d="M12 5v14M5 12h14"/>',
    menos: '<path d="M5 12h14"/>',
    borrar: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>',
    imprimir: '<path d="M7 8V3h10v5M7 17H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-3"/><rect x="7" y="14" width="10" height="7"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    editar: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
    salir: '<path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M15 8l4 4-4 4M19 12H9"/>',
    nube: '<path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 10a4 4 0 0 1 0 8z"/>',
    ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    alerta: '<path d="M12 3l10 18H2zM12 10v5M12 18v.5"/>',
    lista: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.5M3.5 12h.5M3.5 18h.5"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    bajar: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
    subir: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
    reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    enviar: '<path d="M4 12l16-8-6 16-3-7z"/>',
    codigo: '<path d="M4 5v14M8 5v14M11 5v14M15 5v14M18 5v14M20.5 5v14"/>'
  };
  T.ico = n => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[n] || ''}</svg>`;

  // ── Identidad visual ──
  // Logo: monograma "E" sobre el color de marca.
  T.marca = () => '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#e31b23"/><path d="M11 9.5v13M11 9.5h10.5M11 16h7.5M11 22.5h10.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  T.iniciales = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  // Tono (0–359) estable para un texto: da color propio a cada categoría, producto sin foto o usuario.
  T.tono = t => { let h = 0; for (const c of String(t || '')) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  T.corto = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + ' M' : n >= 1000 ? Math.round(n / 1000) + ' mil' : String(Math.round(n || 0));

  // ── Avisos ──
  T.toast = (msg, tipo = 'info') => {
    let caja = T.$('#avisos');
    if (!caja) { caja = document.createElement('div'); caja.id = 'avisos'; document.body.append(caja); }
    const el = document.createElement('div');
    el.className = 'aviso ' + tipo; el.textContent = msg;
    caja.append(el);
    setTimeout(() => el.remove(), tipo === 'error' ? 6000 : 3200);
  };

  // ── Ventanas modales ──
  // botones: [{txt, cls, fn(cuerpo, cerrar)}]. Si fn devuelve false la ventana sigue abierta;
  // si lanza un error se muestra y la ventana sigue abierta.
  T.modal = function ({ titulo, cuerpo, botones = [], ancho, alCerrar }) {
    const fondo = document.createElement('div');
    fondo.className = 'modal-fondo';
    fondo.innerHTML = `<div class="modal" role="dialog" aria-modal="true" ${ancho ? `style="max-width:${ancho}px"` : ''}>
      <header><h3>${T.esc(titulo)}</h3><button class="btn-ico" data-cerrar aria-label="Cerrar">${T.ico('x')}</button></header>
      <div class="modal-cuerpo"></div><footer></footer></div>`;
    const cu = T.$('.modal-cuerpo', fondo), pie = T.$('footer', fondo);
    if (typeof cuerpo === 'string') cu.innerHTML = cuerpo; else if (cuerpo) cu.append(cuerpo);
    let cerrado = false;
    const tecla = e => {
      if (e.key === 'Escape' && document.body.lastElementChild === fondo) { e.stopPropagation(); cerrar(null); }
    };
    function cerrar(valor) {
      if (cerrado) return;
      cerrado = true; fondo.remove(); document.removeEventListener('keydown', tecla, true);
      if (alCerrar) alCerrar(valor);
    }
    botones.forEach(b => {
      const el = document.createElement('button');
      el.className = 'btn ' + (b.cls || ''); el.innerHTML = b.txt;
      if (b.id) el.dataset.id = b.id;
      el.onclick = async () => {
        if (!b.fn) return cerrar(null);
        el.disabled = true;
        try { const r = await b.fn(cu, cerrar); if (r !== false) cerrar(r); }
        catch (e) { console.error(e); T.toast(e.message || String(e), 'error'); }
        finally { el.disabled = false; }
      };
      pie.append(el);
    });
    if (!botones.length) pie.remove();
    T.$('[data-cerrar]', fondo).onclick = () => cerrar(null);
    document.addEventListener('keydown', tecla, true);
    document.body.append(fondo);
    const foco = T.$('[autofocus], input:not([type=hidden]):not([disabled]), select, textarea', cu);
    if (foco) setTimeout(() => { foco.focus(); if (foco.select && foco.type !== 'file') foco.select(); }, 30);
    return { el: fondo, cuerpo: cu, cerrar };
  };

  T.confirmar = (msg, { titulo = 'Confirmar', ok = 'Sí, continuar', peligro = false } = {}) => new Promise(res => {
    T.modal({
      titulo, cuerpo: `<p class="texto">${T.esc(msg)}</p>`, ancho: 420, alCerrar: v => res(v === true),
      botones: [{ txt: 'Cancelar', cls: 'sec' }, { txt: ok, cls: peligro ? 'peligro' : 'pri', fn: () => true }]
    });
  });

  // ── Formularios declarativos ──
  // campo: {id, label, tipo: text|number|select|textarea|date|password|check, valor, req, opciones:[[v,t]], ph, ayuda, medio, attrs}
  T.form = campos => `<div class="form">${campos.map(c => {
    const id = 'f_' + c.id, v = c.valor ?? '', at = `id="${id}" name="${c.id}" ${c.req ? 'required' : ''} ${c.attrs || ''}`;
    let ctrl;
    if (c.tipo === 'select') ctrl = `<select ${at}>${c.opciones.map(([ov, ot]) => `<option value="${T.esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${T.esc(ot)}</option>`).join('')}</select>`;
    else if (c.tipo === 'textarea') ctrl = `<textarea ${at} rows="3" placeholder="${T.esc(c.ph || '')}">${T.esc(v)}</textarea>`;
    else if (c.tipo === 'check') return `<label class="campo check ${c.medio ? 'medio' : ''}"><input type="checkbox" ${at} ${v ? 'checked' : ''}><span>${T.esc(c.label)}${c.ayuda ? `<small>${T.esc(c.ayuda)}</small>` : ''}</span></label>`;
    else ctrl = `<input type="${c.tipo === 'number' ? 'number' : c.tipo || 'text'}" ${c.tipo === 'number' ? `step="${c.step || 'any'}" inputmode="decimal"` : ''} ${at} value="${T.esc(v)}" placeholder="${T.esc(c.ph || '')}" autocomplete="off">`;
    return `<label class="campo ${c.medio ? 'medio' : ''}"><span>${T.esc(c.label)}${c.req ? ' *' : ''}</span>${ctrl}${c.ayuda ? `<small>${T.esc(c.ayuda)}</small>` : ''}</label>`;
  }).join('')}</div>`;

  T.leerForm = (el, campos) => {
    const out = {};
    for (const c of campos) {
      const i = T.$('#f_' + c.id, el);
      if (!i) continue;
      let v = c.tipo === 'check' ? i.checked : c.tipo === 'number' ? (i.value === '' ? null : T.aNum(i.value)) : i.value.trim();
      if (c.req && (v === '' || v === null)) { i.focus(); throw new Error(`Falta: ${c.label}`); }
      if (c.tipo === 'number' && v === null) v = 0;
      out[c.id] = v;
    }
    return out;
  };

  T.pedir = ({ titulo, campos, ok = 'Guardar', ancho = 480, nota, validar }) => new Promise(res => {
    const m = T.modal({
      titulo, ancho, alCerrar: v => res(v || null),
      cuerpo: (nota ? `<p class="texto">${T.esc(nota)}</p>` : '') + T.form(campos),
      botones: [{ txt: 'Cancelar', cls: 'sec' }, {
        txt: ok, cls: 'pri', id: 'ok', fn: async cu => { const v = T.leerForm(cu, campos); if (validar) await validar(v); return v; }
      }]
    });
    m.cuerpo.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); T.$('[data-id=ok]', m.el).click(); }
    });
  });

  // ── Tablas ──
  // cols: [{t: título, v: fila => html, cls}]
  T.tabla = (cols, filas, vacio = 'Sin registros') => filas.length
    ? `<div class="tabla-caja"><table class="tabla"><thead><tr>${cols.map(c => `<th class="${c.cls || ''}">${c.t}</th>`).join('')}</tr></thead>
       <tbody>${filas.map(f => `<tr>${cols.map(c => `<td class="${c.cls || ''}" data-t="${T.esc(c.t)}">${c.v(f)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : `<p class="vacio">${T.esc(vacio)}</p>`;

  // ── Archivos ──
  T.descargar = (nombre, contenido, mime = 'application/json') => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([contenido], { type: mime }));
    a.download = nombre; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  T.csv = filas => '﻿' + filas.map(f => f.map(v => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\r\n');
  T.leerCSV = texto => {
    const sep = (texto.split('\n')[0].match(/;/g) || []).length >= (texto.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    const filas = []; let f = [], c = '', q = false;
    for (let i = 0; i < texto.length; i++) {
      const ch = texto[i];
      if (q) { if (ch === '"') { if (texto[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { f.push(c); c = ''; }
      else if (ch === '\n') { f.push(c); filas.push(f); f = []; c = ''; }
      else if (ch !== '\r' && ch !== '﻿') c += ch;
    }
    if (c || f.length) { f.push(c); filas.push(f); }
    return filas.filter(x => x.some(y => y.trim()));
  };
  T.elegirArchivo = (accept, { multiple = false, camara = false } = {}) => new Promise(res => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept; i.multiple = multiple;
    if (camara) i.setAttribute('capture', 'environment');
    i.onchange = () => res(Array.from(i.files));
    i.click();
  });

  // ── Imágenes: se reducen antes de guardar o enviar a la IA ──
  T.img = {
    cargar: src => new Promise((ok, err) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => err(new Error('No se pudo leer la imagen')); im.src = src; }),
    async leer(archivo, max = 1280, calidad = 0.82) {
      const url = URL.createObjectURL(archivo);
      try {
        const im = await this.cargar(url), e = Math.min(1, max / Math.max(im.width, im.height));
        const c = document.createElement('canvas');
        c.width = Math.round(im.width * e); c.height = Math.round(im.height * e);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', calidad);
      } finally { URL.revokeObjectURL(url); }
    },
    // caja = [ymin, xmin, ymax, xmax] en escala 0–1000 (formato de Gemini); sin caja usa toda la imagen.
    async miniatura(dataURL, caja, tam = 220) {
      const im = await this.cargar(dataURL);
      let x = 0, y = 0, w = im.width, h = im.height;
      if (Array.isArray(caja) && caja.length === 4 && caja[2] > caja[0] && caja[3] > caja[1]) {
        y = im.height * caja[0] / 1000; x = im.width * caja[1] / 1000;
        h = im.height * (caja[2] - caja[0]) / 1000; w = im.width * (caja[3] - caja[1]) / 1000;
      }
      const lado = Math.min(Math.max(w, h), Math.max(im.width, im.height));
      const cx = x + w / 2, cy = y + h / 2, c = document.createElement('canvas');
      c.width = c.height = tam;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, tam, tam);
      g.drawImage(im, cx - lado / 2, cy - lado / 2, lado, lado, 0, 0, tam, tam);
      return c.toDataURL('image/jpeg', 0.72);
    }
  };

  // ── Impresión (recibos térmicos y reportes) ──
  T.imprimir = html => {
    let z = T.$('#impresion');
    if (!z) { z = document.createElement('div'); z.id = 'impresion'; document.body.append(z); }
    z.innerHTML = html;
    setTimeout(() => window.print(), 60);
  };
})(window.T);
