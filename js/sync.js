'use strict';
// ════════════════════════════════════════════════════════════════════
// SINCRONIZACIÓN Y RESPALDOS — para que nada se pierda.
//
// Los datos viven en este equipo (IndexedDB) y además se copian a:
//  1) SERVIDOR DE LA TIENDA (servidor.js en el computador principal):
//     se detecta solo. Une la caja, el celular y otros equipos por WiFi
//     y guarda todo en la carpeta "datos" + respaldos en "respaldos".
//  2) NUBE (Firebase, opcional): copia fuera del local y acceso remoto.
//     Se configura en Configuración → Nube.
//
// Cada equipo envía lo pendiente (outbox) y recibe lo nuevo. Los
// conflictos se resuelven por "el último cambio gana", y las existencias
// y saldos se recalculan desde los movimientos (ver neg.js).
// ════════════════════════════════════════════════════════════════════
(function (T) {
  const D = () => T.db;
  let ocupado = false, hub = false, fb = null, fbUsuario = null, fbEscucha = null;

  function estado(e, detalle) { T.sync.estado = e; T.sync.detalle = detalle || ''; T.emit('sync', e); }

  // Aplica cambios llegados de otro equipo.
  async function aplicar(cambios, origen) {
    const ops = [], prods = new Set(), clis = new Set();
    await Promise.all(cambios.map(async ({ s, r }) => {
      if (!D().SINC.has(s) || !r || !r.id) return;
      const loc = await D().leer(s, r.id);
      if (loc && (loc.actualizado || 0) >= (r.actualizado || 0)) return;
      if (s === 'productos') { if (loc) r.stock = loc.stock; prods.add(r.id); }
      if (s === 'movimientos') prods.add(r.productoId);
      if (s === 'clientes') { if (loc) r.saldo = loc.saldo; clis.add(r.id); }
      if ((s === 'ventas' || s === 'abonos') && r.clienteId) clis.add(r.clienteId);
      ops.push({ s, r });
    }));
    if (!ops.length) return 0;
    await D().lote(ops, { remoto: origen });
    await T.neg.recalcularStock([...prods]);
    await T.neg.recalcularSaldos([...clis]);
    return ops.length;
  }

  async function leerPendientes(destino, max) {
    const pend = (await D().pendientes(destino)).sort((a, b) => a.ts - b.ts).slice(0, max), cambios = [];
    for (const e of pend) { const r = await D().leer(e.s, e.rid); if (r) cambios.push({ s: e.s, r }); }
    return { pend, cambios };
  }

  // ── Transporte 1: servidor de la tienda ──
  const api = (ruta, cuerpo) => fetch(ruta, { cache: 'no-store', headers: { 'x-clave': D().loc('hubClave', ''), ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) }, ...(cuerpo ? { method: 'POST', body: JSON.stringify(cuerpo) } : {}) })
    .then(r => { if (!r.ok) { const e = new Error(r.status === 401 ? 'El servidor de la tienda pide la clave' : 'Servidor ' + r.status); e.estado = r.status; throw e; } return r.json(); });

  // Los equipos que no son el computador principal deben dar la clave del servidor una vez.
  async function hubAcceso() {
    for (; ;) {
      try { await api('api/acceso'); return true; }
      catch (e) { if (e.estado !== 401) throw e; }
      const v = await T.pedir({ titulo: 'Conectar con la tienda', ok: 'Conectar', ancho: 420, nota: 'Escriba la clave del servidor. Aparece en la ventana negra del computador principal y en Configuración → Copias y nube.', campos: [{ id: 'clave', label: 'Clave del servidor', req: true, attrs: 'autocapitalize="characters"' }] });
      if (!v) return false;
      await D().setLoc('hubClave', v.clave.toUpperCase().replace(/\s/g, ''));
    }
  }

  async function hubDetectar() {
    if (!/^https?:$/.test(location.protocol)) return false;
    try {
      const j = await api('api/ping');
      if (!j || j.app !== 'tienda-ebenezer') return false;
      T.sync.claveHub = j.clave || '';
      if (!await hubAcceso()) return false;
      if (D().loc('hubId') !== j.id) {   // servidor nuevo o reinstalado: se reenvía todo
        await D().setLoc('hubId', j.id); await D().setLoc('hubSeq', 0); await D().encolarTodo();
      }
      return true;
    } catch (e) { return false; }
  }
  async function hubCiclo() {
    for (; ;) {
      const { pend, cambios } = await leerPendientes('h', 150);
      if (!pend.length) break;
      await api('api/sync', { equipo: D().loc('dispositivo'), cambios });
      await D().quitarPendientes(pend, 'h');
    }
    for (; ;) {
      const j = await api(`api/sync?desde=${D().loc('hubSeq', 0)}&equipo=${D().loc('dispositivo')}`);
      if (j.cambios.length) await aplicar(j.cambios, 'h');
      await D().setLoc('hubSeq', j.seq);
      if (!j.mas) break;
    }
  }

  // ── Transporte 2: Firebase (Firestore + Auth) ──
  const FB_VER = '10.12.0';
  const cargar = src => new Promise((ok, err) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => err(new Error('No se pudo cargar Firebase (¿sin internet?)')); document.head.append(s); });
  const col = () => fb.firestore().collection('tiendas').doc(fbUsuario.uid).collection('datos');

  // Proyecto de Firebase de la tienda: ya viene conectado, solo hay que entrar con correo y clave.
  // (Estos datos identifican el proyecto; no son secretos. Quien protege la información son
  // la cuenta y firestore.rules.) Para usar otro proyecto: Configuración → Copias y nube → Cambiar proyecto.
  const NUBE_DEF = {
    apiKey: 'AIzaSyCx25uLH63O5gLLEVsuiPABeZqA2929xfg',
    authDomain: 'ebenezer-fiados.firebaseapp.com',
    projectId: 'ebenezer-fiados',
    storageBucket: 'ebenezer-fiados.firebasestorage.app',
    messagingSenderId: '1024846521688',
    appId: '1:1024846521688:web:1fc3a20f2a3e4ed0ebf12d'
  };
  const cfgNube = () => (D().loc('nube') || {}).config || NUBE_DEF;
  let fbCargando = null;

  function fbIniciar() {
    if (fb) return Promise.resolve();
    return fbCargando = fbCargando || fbArrancar().finally(() => { fbCargando = null; });
  }
  async function fbArrancar() {
    if (!window.firebase) for (const m of ['app', 'auth', 'firestore']) await cargar(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-${m}-compat.js`);
    fb = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfgNube());
    fb.auth().onAuthStateChanged(async u => {
      fbUsuario = u;
      if (fbEscucha) { fbEscucha(); fbEscucha = null; }
      if (!u) return T.emit('sync');
      if (D().loc('nubeUid') !== u.uid) { await D().setLoc('nubeUid', u.uid); await D().setLoc('nubeCursor', null); await D().encolarTodo(); }
      fbEscuchar();
      T.sync.ahora();
    });
  }
  function fbEscuchar() {
    const cur = D().loc('nubeCursor'), TS = firebase.firestore.Timestamp;
    let q = col().orderBy('_s');
    if (cur) q = q.where('_s', '>', new TS(cur.s, cur.n));
    fbEscucha = q.onSnapshot(async snap => {
      const cambios = []; let ult = null;
      snap.docChanges().forEach(ch => {
        const d = ch.doc.data();
        if (ch.type === 'removed' || ch.doc.metadata.hasPendingWrites || !d._s) return;
        ult = d._s;
        if (d.e !== D().loc('dispositivo')) { try { cambios.push({ s: d.s, r: JSON.parse(d.j) }); } catch (e) { /* documento dañado: se ignora */ } }
      });
      try {
        if (cambios.length) await aplicar(cambios, 'n');
        if (ult) await D().setLoc('nubeCursor', { s: ult.seconds, n: ult.nanoseconds });
      } catch (e) { console.error(e); estado('error', e.message); }
    }, e => estado('error', e.message));
  }
  async function fbCiclo() {
    for (; ;) {
      const { pend, cambios } = await leerPendientes('n', 100);
      if (!pend.length) break;
      const lote = fb.firestore().batch();
      cambios.forEach(({ s, r }) => lote.set(col().doc(s + '__' + r.id), { s, a: r.actualizado || 0, e: D().loc('dispositivo'), j: JSON.stringify(r), _s: firebase.firestore.FieldValue.serverTimestamp() }));
      await lote.commit();
      await D().quitarPendientes(pend, 'n');
    }
  }

  T.sync = {
    estado: 'local', detalle: '',
    get hub() { return hub; },
    get nube() { return fbUsuario ? fbUsuario.email : null; },
    get proyectoNube() { return cfgNube().projectId; },

    async iniciar() {
      hub = await hubDetectar();
      if (hub) { try { await hubCiclo(); estado('ok'); } catch (e) { estado('error', e.message); } }
      // Sin internet Firebase no carga: no es un error si este equipo aún no usa la nube; se reintenta al volver la red.
      const nube = () => fbIniciar().catch(e => { if (D().loc('nubeUid')) estado('sinred', e.message); });
      nube();
      const lanzar = T.debounce(() => this.ahora(), 1500);
      T.on('pendiente', lanzar);
      setInterval(() => { if (!document.hidden) this.ahora(); }, 6000);
      window.addEventListener('online', () => { nube(); lanzar(); });
    },

    // Equipo nuevo: entra con la cuenta de la nube y espera a que lleguen los usuarios y datos.
    async traerDeNube(correo, clave) {
      await this.entrarNube(correo, clave, false);
      for (let i = 0; i < 40 && !D().lista('usuarios').length; i++) await new Promise(r => setTimeout(r, 500));
      return D().lista('usuarios').length > 0;
    },

    async ahora() {
      if (ocupado || (!hub && !fbUsuario)) return;
      ocupado = true;
      try {
        if (hub) await hubCiclo();
        if (fbUsuario) await fbCiclo();
        estado('ok');
      } catch (e) { estado(navigator.onLine ? 'error' : 'sinred', e.message); }
      finally { ocupado = false; }
    },

    async pendientes() { const req = D().destinos(); return (await D().todos('outbox')).filter(e => req.some(d => !e[d])).length; },

    // ── Nube ──
    async configurarNube(texto) {
      // Solo el bloque { ... } que contiene apiKey: así sirve pegar todo el código de la consola (con sus import).
      const m = texto.match(/\{[^{}]*apiKey[^{}]*\}/);
      if (!m) throw new Error('Pegue la configuración de Firebase (el bloque que empieza con { apiKey: ... })');
      // Acepta el objeto tal como lo muestra la consola de Firebase (claves sin comillas).
      const json = m[0].replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/'/g, '"').replace(/,\s*}/g, '}');
      let config;
      try { config = JSON.parse(json); } catch (e) { throw new Error('No se pudo leer la configuración. Cópiela completa desde la consola de Firebase.'); }
      if (!config.apiKey || !config.projectId) throw new Error('A la configuración le falta apiKey o projectId');
      await D().setLoc('nube', { config });
      await D().setLoc('nubeUid', null);
      await T.registrar('nube.configurar', config.projectId);   // quien llama recarga la página para usar el proyecto nuevo
    },
    async entrarNube(correo, clave, crear) {
      if (!correo || !clave) throw new Error('Escriba el correo y la clave');
      await fbIniciar();
      try { await (crear ? fb.auth().createUserWithEmailAndPassword(correo, clave) : fb.auth().signInWithEmailAndPassword(correo, clave)); }
      catch (e) { throw new Error({ 'auth/wrong-password': 'Clave incorrecta', 'auth/invalid-credential': 'Correo o clave incorrectos', 'auth/user-not-found': 'No existe esa cuenta', 'auth/email-already-in-use': 'Ese correo ya tiene cuenta: use "Entrar"', 'auth/weak-password': 'La clave debe tener mínimo 6 caracteres' }[e.code] || e.message); }
      for (let i = 0; i < 30 && !fbUsuario; i++) await new Promise(r => setTimeout(r, 100));   // espera a que la sesión quede activa
      await T.registrar('nube.entrar', correo);
    },
    async salirNube() { if (fb) await fb.auth().signOut(); await T.registrar('nube.salir', ''); }
  };

  // ── Respaldos ──
  T.respaldo = {
    async generar() {
      const datos = {};
      for (const s of D().SINC) datos[s] = await D().todos(s);
      return { app: 'tienda-ebenezer', version: T.VERSION, fecha: Date.now(), dispositivo: D().loc('dispositivo'), negocio: (D().cfg('negocio', {})).nombre || '', datos };
    },
    async descargar(motivo = 'manual') {
      const r = await this.generar(), d = new Date();
      T.descargar(`respaldo-tienda-${T.dia()}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.json`, JSON.stringify(r));
      await D().setLoc('ultRespaldo', Date.now());
      await T.registrar('respaldo.descargar', motivo);
    },
    // Copia automática en la carpeta "respaldos" del computador principal.
    async aServidor(motivo) {
      if (!hub) return false;
      try {
        await api('api/respaldo', { motivo, respaldo: await this.generar() });
        await D().setLoc('ultRespaldo', Date.now());
        return true;
      } catch (e) { console.warn('Respaldo en servidor falló', e); return false; }
    },
    // Une el respaldo con lo que hay: gana el registro más reciente. No borra nada.
    async restaurar(resp) {
      T.auth.exigir('respaldo.gestionar');
      if (!resp || resp.app !== 'tienda-ebenezer' || !resp.datos) throw new Error('El archivo no es un respaldo de esta aplicación');
      const ops = []; let n = 0;
      for (const s of D().SINC) {
        for (const r of resp.datos[s] || []) {
          const loc = await D().leer(s, r.id);
          if (loc && (loc.actualizado || 0) >= (r.actualizado || 0)) continue;
          ops.push({ s, r }); n++;
        }
      }
      for (let i = 0; i < ops.length; i += 500) await D().lote(ops.slice(i, i + 500), { conservar: true });
      await T.neg.recalcularStock(D().lista('productos').map(p => p.id));
      await T.neg.recalcularSaldos(D().lista('clientes').map(c => c.id));
      await T.registrar('respaldo.restaurar', resp.negocio || '', { fechaRespaldo: resp.fecha, registros: n });
      return n;
    },
    diasSin() { const u = D().loc('ultRespaldo', 0); return u ? Math.floor((Date.now() - u) / 86400000) : null; }
  };

  // Copia en el servidor al cerrar caja y, como mucho, cada 30 minutos si hubo cambios.
  let sucio = false;
  T.on('pendiente', () => { sucio = true; });
  T.on('cajaCerrada', () => T.respaldo.aServidor('cierre-caja'));
  setInterval(() => { if (sucio && hub) { sucio = false; T.respaldo.aServidor('automatico'); } }, 30 * 60000);
})(window.T);
