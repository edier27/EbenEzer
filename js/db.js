'use strict';
// ════════════════════════════════════════════════════════════════════
// Base de datos local (IndexedDB) — la fuente de verdad en cada equipo.
//
//  • Todo cambio pasa por T.db.lote(): una sola transacción, o se guarda
//    todo o no se guarda nada.
//  • Cada registro guardado queda anotado en "outbox" para copiarse al
//    servidor de la tienda o a la nube (js/sync.js).
//  • Nada se borra físicamente: los borrados son marcas (_borrado).
//  • La bitácora (auditoria) va encadenada con hash: si alguien altera o
//    quita un registro, "Verificar integridad" lo detecta.
//
// PARA AGREGAR TABLAS O ÍNDICES: añádalos a ESQUEMA y suba VERSION_BD.
// ════════════════════════════════════════════════════════════════════
(function (T) {
  const NOMBRE = 'tienda-ebenezer', VERSION_BD = 1;
  const ESQUEMA = {
    productos: [], clientes: [], proveedores: [], usuarios: [], config: [],
    cajas: ['apertura'],
    movimientos: ['fecha', 'productoId'],
    ventas: ['fecha', 'clienteId', 'cajaId'],
    compras: ['fecha', 'proveedorId'],
    abonos: ['fecha', 'clienteId', 'cajaId'],
    cajaMovs: ['fecha', 'cajaId'],
    auditoria: ['fecha'],
    outbox: [],   // pendientes de sincronizar (solo este equipo)
    local: []     // ajustes de este equipo: no se sincronizan ni van en respaldos
  };
  const EN_MEMORIA = ['productos', 'clientes', 'proveedores', 'usuarios', 'config', 'cajas', 'local'];
  const SINC = new Set(Object.keys(ESQUEMA).filter(s => s !== 'outbox' && s !== 'local'));

  let idb, ultHash = '', nAud = 0;
  const mem = {};
  const pet = r => new Promise((ok, err) => { r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); });

  function sellar(r) {
    r.n = ++nAud; r.prev = ultHash; r.dispositivo = T.db.loc('dispositivo');
    r.hash = ultHash = T.db.hashAud(r);
  }

  T.db = {
    STORES: Object.keys(ESQUEMA), SINC,

    async abrir() {
      idb = await new Promise((ok, err) => {
        const r = indexedDB.open(NOMBRE, VERSION_BD);
        r.onupgradeneeded = () => {
          const d = r.result;
          for (const [s, indices] of Object.entries(ESQUEMA)) {
            const st = d.objectStoreNames.contains(s) ? r.transaction.objectStore(s) : d.createObjectStore(s, { keyPath: 'id' });
            indices.forEach(i => { if (!st.indexNames.contains(i)) st.createIndex(i, i); });
          }
        };
        r.onsuccess = () => ok(r.result);
        r.onerror = () => err(r.error);
        r.onblocked = () => err(new Error('Cierre las otras pestañas de la tienda para terminar la actualización.'));
      });
      idb.onversionchange = () => { idb.close(); location.reload(); };
      for (const s of EN_MEMORIA) mem[s] = new Map((await this.todos(s)).map(r => [r.id, r]));
      if (!this.loc('dispositivo')) await this.setLoc('dispositivo', T.uid().slice(0, 8));
      // Pide al navegador que no borre los datos si falta espacio.
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
      await this._ultimaAuditoria();
    },

    // Última entrada de bitácora de ESTE equipo, para continuar la cadena.
    _ultimaAuditoria() {
      const yo = this.loc('dispositivo');
      return new Promise((ok, err) => {
        const c = idb.transaction('auditoria').objectStore('auditoria').index('fecha').openCursor(null, 'prev');
        c.onsuccess = () => {
          const cur = c.result;
          if (!cur) return ok();
          if (cur.value.dispositivo === yo) { ultHash = cur.value.hash; nAud = cur.value.n; return ok(); }
          cur.continue();
        };
        c.onerror = () => err(c.error);
      });
    },

    hashAud: r => T.sha256([r.prev, r.n, r.fecha, r.usuario, r.accion, r.ref, JSON.stringify(r.detalle ?? null)].join('|')),

    // ── Lectura ──
    lista(s) { return Array.from(mem[s].values()).filter(r => !r._borrado); },
    get(s, id) { return mem[s].get(id) || null; },
    leer(s, id) { return mem[s] ? Promise.resolve(this.get(s, id)) : pet(idb.transaction(s).objectStore(s).get(id)).then(r => r || null); },
    todos(s) { return pet(idb.transaction(s).objectStore(s).getAll()); },
    rango(s, indice, desde, hasta) { return pet(idb.transaction(s).objectStore(s).index(indice).getAll(IDBKeyRange.bound(desde, hasta))); },
    porIndice(s, indice, valor) { return pet(idb.transaction(s).objectStore(s).index(indice).getAll(valor)); },
    contar(s) { return pet(idb.transaction(s).objectStore(s).count()); },

    // Destinos de copia activos en este equipo: 'h' servidor de la tienda, 'n' nube.
    destinos() { return [this.loc('hubId') && 'h', this.loc('nubeUid') && 'n'].filter(Boolean); },

    // ── Escritura atómica ──
    // ops: [{s: tabla, r: registro}]
    // opt.remoto: true  → dato derivado o local: no se reenvía ni se le cambia la fecha.
    //             'h'/'n' → llegó de ese destino: se guarda igual y se reenvía al OTRO destino.
    // opt.conservar: restauración de respaldo → conserva fechas pero sí se reenvía.
    async lote(ops, opt = {}) {
      if (!ops.length) return;
      const ahora = Date.now(), tablas = new Set(ops.map(o => o.s));
      const tx = idb.transaction([...tablas, 'outbox'], 'readwrite');
      const hashAntes = ultHash, nAntes = nAud;
      const puente = typeof opt.remoto === 'string' && this.destinos().some(d => d !== opt.remoto);
      for (const { s, r } of ops) {
        if (!opt.remoto) {
          if (!r.creado) r.creado = ahora;
          if (!opt.conservar || !r.actualizado) r.actualizado = ahora;
          if (s === 'auditoria' && !r.hash) sellar(r);
          if (SINC.has(s)) tx.objectStore('outbox').put({ id: s + '|' + r.id, s, rid: r.id, ts: ahora });
        } else if (puente && SINC.has(s)) {
          tx.objectStore('outbox').put({ id: s + '|' + r.id, s, rid: r.id, ts: ahora, [opt.remoto]: 1 });
        }
        tx.objectStore(s).put(r);
      }
      await new Promise((ok, err) => {
        tx.oncomplete = ok;
        tx.onerror = tx.onabort = () => { ultHash = hashAntes; nAud = nAntes; err(tx.error || new Error('No se pudo guardar')); };
      });
      for (const { s, r } of ops) if (mem[s]) mem[s].set(r.id, r);
      T.emit('datos', [...tablas]);
      if (!opt.remoto || puente) T.emit('pendiente');
    },

    // ── Configuración compartida (se sincroniza) y local (solo este equipo) ──
    cfg(k, def) { const r = mem.config.get(k); return r && !r._borrado ? r.valor : def; },
    setCfg(k, valor, detalle) {
      return this.lote([{ s: 'config', r: { ...(mem.config.get(k) || { id: k }), valor } }, T.aud('config.cambiar', k, detalle ?? valor)]);
    },
    loc(k, def) { const r = mem.local && mem.local.get(k); return r ? r.valor : def; },
    setLoc(k, valor) { return this.lote([{ s: 'local', r: { id: k, valor } }], { remoto: true }); },

    // ── Outbox ──
    async pendientes(destino) { return (await this.todos('outbox')).filter(e => !e[destino]); },
    async quitarPendientes(enviados, destino) {
      const req = this.destinos(), tx = idb.transaction('outbox', 'readwrite'), st = tx.objectStore('outbox');
      const fin = new Promise((ok, err) => { tx.oncomplete = ok; tx.onerror = () => err(tx.error); });
      for (const e of enviados) {
        const act = await pet(st.get(e.id));
        if (!act || act.ts !== e.ts) continue;   // cambió mientras se enviaba: se reenvía
        act[destino] = 1;
        if (req.every(d => act[d])) st.delete(e.id); else st.put(act);
      }
      return fin;
    },
    // Marca TODO para reenviar (servidor nuevo, cuenta de nube nueva).
    async encolarTodo() {
      const ahora = Date.now();
      for (const s of SINC) {
        const ids = await pet(idb.transaction(s).objectStore(s).getAllKeys());
        const tx = idb.transaction('outbox', 'readwrite');
        ids.forEach(id => tx.objectStore('outbox').put({ id: s + '|' + id, s, rid: id, ts: ahora }));
        await new Promise(ok => { tx.oncomplete = ok; });
      }
      T.emit('pendiente');
    },

    // ── Integridad de la bitácora ──
    async verificarAuditoria() {
      const porEquipo = {};
      (await this.todos('auditoria')).forEach(r => (porEquipo[r.dispositivo] = porEquipo[r.dispositivo] || []).push(r));
      const fallas = []; let total = 0;
      for (const [eq, regs] of Object.entries(porEquipo)) {
        regs.sort((a, b) => a.n - b.n);
        let prev = regs[0].n === 1 ? '' : regs[0].prev;
        if (regs[0].n !== 1) fallas.push(`Equipo ${eq}: faltan los primeros ${regs[0].n - 1} registros`);
        for (let i = 0; i < regs.length; i++) {
          const r = regs[i]; total++;
          if (i && r.n !== regs[i - 1].n + 1) fallas.push(`Equipo ${eq}: falta el registro ${regs[i - 1].n + 1}`);
          else if (r.prev !== prev) fallas.push(`Equipo ${eq}: cadena rota en el registro ${r.n}`);
          if (this.hashAud(r) !== r.hash) fallas.push(`Equipo ${eq}: el registro ${r.n} fue alterado (${r.accion})`);
          prev = r.hash;
        }
      }
      return { total, fallas };
    }
  };

  // Operación de bitácora para incluir en un lote.
  T.aud = (accion, ref, detalle) => {
    const u = T.auth && T.auth.usuario;
    return { s: 'auditoria', r: { id: T.uid(), fecha: Date.now(), usuario: u ? u.nombre : 'sistema', usuarioId: u ? u.id : null, accion, ref: ref ?? '', detalle: detalle ?? null } };
  };
  T.registrar = (accion, ref, detalle) => T.db.lote([T.aud(accion, ref, detalle)]);
})(window.T);
