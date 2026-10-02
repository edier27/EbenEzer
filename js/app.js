'use strict';
// ════════════════════════════════════════════════════════════════════
// ARRANQUE — instalación inicial, entrada de usuarios, menú y actualizaciones.
// ════════════════════════════════════════════════════════════════════
(function (T) {
  // [vista, título, permiso, grupo del menú]
  const MENU = [
    ['inicio', 'Inicio', null, 'Operación'],
    ['vender', 'Vender', 'ventas.crear', 'Operación'],
    ['caja', 'Caja', 'caja.operar', 'Operación'],
    ['clientes', 'Clientes y fiados', 'abonos.crear', 'Operación'],
    ['inventario', 'Inventario', 'inventario.ver', 'Mercancía'],
    ['compras', 'Compras', 'compras.crear', 'Mercancía'],
    ['reportes', 'Reportes', 'reportes.ver', 'Control'],
    ['ia', 'Asistente', 'ia.usar', 'Control'],
    ['auditoria', 'Bitácora', 'auditoria.ver', 'Control'],
    ['config', 'Configuración', null, 'Control']
  ];
  // Pantalla de entrada: panel de marca a la izquierda, formulario a la derecha.
  const portada = (titulo, sub, cuerpo) => `<div class="portada">
      <aside class="portada-marca"><div>${T.marca()}<h1>${T.esc(titulo)}</h1><p>${T.esc(sub)}</p></div>
        <ul><li>${T.ico('vender')} Ventas, caja y fiados</li><li>${T.ico('inventario')} Inventario con kárdex</li><li>${T.ico('auditoria')} Todo queda registrado</li></ul>
        <footer>Versión ${T.VERSION}</footer></aside>
      <main class="portada-form"><div class="portada-caja">${cuerpo}</div></main></div>`;

  // Cambios de datos entre versiones. Para una versión nueva que necesite
  // transformar datos, agregue aquí { n: 2, fn: async () => {...} } — se ejecuta una sola vez.
  const MIGRACIONES = [];

  const raiz = () => T.$('#raiz');
  const negocio = () => T.db.cfg('negocio', {});
  const tema = () => { document.documentElement.dataset.tema = T.db.loc('tema', matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro'); };

  T.app = {
    actual: null,

    async iniciar() {
      try {
        await T.db.abrir();
        tema();
        for (const m of MIGRACIONES) if (T.db.loc('migracion', 0) < m.n) { await m.fn(); await T.db.setLoc('migracion', m.n); }
        await T.sync.iniciar();   // si hay servidor de tienda, trae usuarios y datos antes de pedir la clave
        if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
        this.entrada();
        this.buscarActualizacion();
        setInterval(() => this.buscarActualizacion(), 30 * 60000);
      } catch (e) {
        console.error(e);
        raiz().innerHTML = `<div class="portada solo"><main class="portada-form"><div class="portada-caja"><h2>No se pudo iniciar</h2><p class="texto suave">${T.esc(e.message || e)}</p><button class="btn pri" onclick="location.reload()">Reintentar</button></div></main></div>`;
      }
    },

    entrada() {
      if (!T.db.lista('usuarios').length) return this.instalar();
      if (T.auth.reanudar()) return this.armar();
      this.login();
    },

    // ── Primera vez ──
    instalar() {
      const campos = [
        { id: 'negocio', label: 'Nombre de la tienda', req: true, valor: 'Tienda Eben-Ezer' },
        { id: 'nit', label: 'NIT o cédula', medio: true }, { id: 'telefono', label: 'Teléfono', medio: true },
        { id: 'direccion', label: 'Dirección' },
        { id: 'nombre', label: 'Su nombre (administrador)', req: true },
        { id: 'usuario', label: 'Usuario', req: true, medio: true, valor: 'admin' },
        { id: 'pin', label: 'Clave (mínimo 4)', tipo: 'password', req: true, medio: true }
      ];
      raiz().innerHTML = portada('Punto de venta', 'Configure la tienda en un minuto y empiece a vender.', `
        <h2>Crear la tienda</h2><p class="suave">Estos datos salen en los recibos y se pueden cambiar después.</p>
        ${T.form(campos)}
        <button class="btn pri grande" id="crear" style="width:100%;margin-top:18px">Crear la tienda</button>
        <div class="enlaces"><button class="btn" id="de-nube">${T.ico('nube')} Ya tengo la tienda en la nube</button><button class="btn" id="restaurar">${T.ico('subir')} Tengo un respaldo</button></div>`);
      T.$('#crear').onclick = async () => {
        try {
          const v = T.leerForm(raiz(), campos);
          await T.db.lote([{ s: 'config', r: { id: 'negocio', valor: { nombre: v.negocio, nit: v.nit, telefono: v.telefono, direccion: v.direccion, pie: '¡Gracias por su compra!', anchoRecibo: 80 } } }], { remoto: false });
          const u = await T.auth.guardarUsuario({ nombre: v.nombre, usuario: v.usuario, pin: v.pin, rol: 'admin' });
          await T.auth.iniciar(u.id, v.pin);
          await T.registrar('tienda.crear', v.negocio);
          this.armar();
        } catch (e) { T.toast(e.message, 'error'); }
      };
      // Equipo nuevo (celular, otro computador): trae usuarios, inventario y ventas de la cuenta de la nube.
      T.$('#de-nube').onclick = async () => {
        const v = await T.pedir({
          titulo: 'Traer la tienda de la nube', ok: 'Entrar', ancho: 420, nota: 'Escriba el correo y la clave con los que conectó la nube en el computador principal.',
          campos: [{ id: 'correo', label: 'Correo', req: true, attrs: 'type="email" autocomplete="username"' }, { id: 'clave', label: 'Clave', tipo: 'password', req: true }],
          validar: async x => { if (!await T.sync.traerDeNube(x.correo, x.clave)) throw new Error('Esa cuenta todavía no tiene datos. Conecte primero la nube en el computador principal.'); }
        });
        if (v) location.reload();
      };
      T.$('#restaurar').onclick = async () => {
        const [f] = await T.elegirArchivo('.json,application/json');
        if (!f) return;
        try {
          const resp = JSON.parse(await f.text());
          if (resp.app !== 'tienda-ebenezer' || !resp.datos) throw new Error('El archivo no es un respaldo de esta aplicación');
          const ops = [];
          for (const s of T.db.SINC) for (const r of resp.datos[s] || []) ops.push({ s, r });
          for (let i = 0; i < ops.length; i += 500) await T.db.lote(ops.slice(i, i + 500), { conservar: true });
          location.reload();
        } catch (e) { T.toast(e.message, 'error'); }
      };
    },

    // ── Entrada ──
    login() {
      const us = T.db.lista('usuarios').filter(u => u.activo !== false).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      let sel = us.length === 1 ? us[0].id : null;
      raiz().innerHTML = portada(negocio().nombre || 'Tienda', 'Punto de venta', `
        <h2>Iniciar turno</h2><p class="suave">Elija su usuario y escriba la clave.</p>
        <div class="usuarios-login">${us.map(u => `<button data-u="${u.id}" class="${u.id === sel ? 'activo' : ''}"><i class="avatar" style="--h:${T.tono(u.nombre)}">${T.esc(T.iniciales(u.nombre))}</i><span>${T.esc(u.nombre)}<small>${T.esc(T.roles()[u.rol].nombre)}</small></span></button>`).join('')}</div>
        <label class="campo"><span>Clave</span><input type="password" id="pin" autocomplete="off"></label>
        <button class="btn pri grande" id="entrar" style="width:100%;margin-top:16px">Entrar</button>`);
      const pin = T.$('#pin');
      T.$$('[data-u]').forEach(b => b.onclick = () => { sel = b.dataset.u; T.$$('[data-u]').forEach(x => x.classList.toggle('activo', x === b)); pin.focus(); });
      const entrar = async () => {
        if (!sel) return T.toast('Elija su usuario', 'error');
        try { await T.auth.iniciar(sel, pin.value); this.armar(); }
        catch (e) { T.toast(e.message, 'error'); pin.value = ''; pin.focus(); }
      };
      T.$('#entrar').onclick = entrar;
      pin.onkeydown = e => { if (e.key === 'Enter') entrar(); };
      if (sel) pin.focus();
    },

    // ── Pantalla principal ──
    armar() {
      const u = T.auth.usuario, menu = MENU.filter(([id, , p]) => !p || T.auth.puede(p) || (id === 'clientes' && T.auth.puede('clientes.editar')));
      raiz().innerHTML = `<div id="app">
        <aside id="lateral">
          <div class="marca">${T.marca()}<div><b>${T.esc(negocio().nombre || 'Tienda')}</b><small>Punto de venta</small></div></div>
          <nav id="nav">${menu.map(([id, t, , g], i) => `${!i || menu[i - 1][3] !== g ? `<h5>${g}</h5>` : ''}<a href="#${id}" data-v="${id}">${T.ico(id)}<span>${t}</span></a>`).join('')}</nav>
          <div class="pie-lateral">
            <button class="estado-sync" id="est-sync" title="Estado de las copias"></button>
            <div class="quien"><i class="avatar" style="--h:${T.tono(u.nombre)}">${T.esc(T.iniciales(u.nombre))}</i><div><b>${T.esc(u.nombre)}</b><span>${T.esc(T.roles()[u.rol].nombre)}</span></div>
              <button class="btn-ico" id="salir" title="Cerrar sesión" aria-label="Cerrar sesión">${T.ico('salir')}</button></div>
          </div>
        </aside>
        <div id="contenido"><header id="barra"><button class="btn-ico" id="abrir-menu" aria-label="Menú">${T.ico('menu')}</button><span class="seccion" id="titulo-movil"></span>
          <a class="chip" id="chip-caja" href="#caja"></a><span class="chip reloj" id="reloj"></span></header>
        <main id="principal"></main></div></div>`;
      T.$('#salir').onclick = async () => { await T.auth.salir(); this.login(); };
      T.$('#abrir-menu').onclick = () => T.$('#app').classList.toggle('menu-abierto');
      T.$('#app').addEventListener('click', e => { if (e.target.id === 'app' || e.target.closest('#nav a')) T.$('#app').classList.remove('menu-abierto'); });
      T.$('#est-sync').onclick = () => { location.hash = '#config'; T.vistas.config.pestana = 'copias'; this.navegar(); };
      this.pintarSync();
      this.pintarBarra();
      this.navegar();
    },

    // Barra superior: estado de la caja de este equipo y hora.
    pintarBarra() {
      const chip = T.$('#chip-caja'), reloj = T.$('#reloj');
      if (!chip) return;
      const c = T.neg.cajaAbierta();
      chip.innerHTML = `<i class="punto ${c ? 'ok' : ''}"></i>${c ? 'Caja ' + T.esc(c.numero) + ' abierta' : 'Caja cerrada'}`;
      reloj.textContent = new Date().toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + T.hora(Date.now());
    },

    async pintarSync() {
      const el = T.$('#est-sync');
      if (!el) return;
      const pend = await T.sync.pendientes(), s = T.sync;
      let cls = '', txt = 'Solo en este equipo';
      if (s.hub || s.nube) {
        cls = s.estado === 'error' ? 'error' : s.estado === 'sinred' ? 'sinred' : pend ? 'sinred' : 'ok';
        txt = s.estado === 'error' ? 'Error al copiar' : s.estado === 'sinred' ? `Sin conexión · ${pend} pendientes` : pend ? `Copiando ${pend}…` : `Copiado (${[s.hub && 'tienda', s.nube && 'nube'].filter(Boolean).join(' + ')})`;
      }
      el.innerHTML = `<i class="punto ${cls}"></i><span>${txt}</span>`;
    },

    async navegar() {
      if (!T.auth.usuario || !T.$('#principal')) return;
      let id = location.hash.slice(1) || 'inicio';
      const item = MENU.find(m => m[0] === id);
      if (!item || !T.vistas[id] || !T.$(`#nav [data-v="${id}"]`)) id = 'inicio';
      this.actual = id;
      T.$$('#nav a').forEach(a => a.classList.toggle('activo', a.dataset.v === id));
      T.$('#titulo-movil').textContent = MENU.find(m => m[0] === id)[1];
      // Cada navegación pinta en su propio contenedor: si llega otra antes de terminar, no se pisan.
      const el = document.createElement('div');
      T.$('#principal').replaceChildren(el);
      try { await T.vistas[id].render(el); }
      catch (e) { console.error(e); el.innerHTML = `<p class="vacio">No se pudo mostrar esta pantalla: ${T.esc(e.message)}</p>`; }
    },
    refrescar() { return this.navegar(); },

    // ── Actualizaciones ──
    async buscarActualizacion() {
      if (location.protocol === 'file:' || !navigator.onLine) return;
      try {
        const v = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json());
        if (!v.version || v.version === T.VERSION || T.$('#banda-version')) return;
        const b = document.createElement('div');
        b.id = 'banda-version'; b.className = 'banda';
        b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:60;margin:0;box-shadow:var(--sombra)';
        b.innerHTML = `${T.ico('bajar')}<span>Hay una versión nueva (${T.esc(v.version)}). Sus datos no se tocan.</span><button class="btn pri">Actualizar ahora</button>`;
        T.$('button', b).onclick = () => this.actualizar();
        document.body.append(b);
      } catch (e) { /* sin red: se intenta después */ }
    },
    async actualizar() {
      try {
        if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
        const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update();
      } finally { location.reload(); }
    }
  };

  window.addEventListener('hashchange', () => T.app.navegar());
  T.on('sync', () => T.app.pintarSync());
  T.on('datos', tablas => { if (tablas.includes('cajas')) T.app.pintarBarra(); });
  setInterval(() => T.app.pintarBarra(), 20000);
  T.on('pendiente', T.debounce(() => T.app.pintarSync(), 400));

  // Cierre de sesión por inactividad (regla "bloqueoMin").
  let ultimoUso = Date.now();
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { ultimoUso = Date.now(); }, true));
  setInterval(async () => {
    const min = T.auth.usuario ? T.regla('bloqueoMin') : 0;
    if (min > 0 && Date.now() - ultimoUso > min * 60000) { T.$$('.modal-fondo').forEach(m => m.remove()); await T.auth.salir(); T.app.login(); }
  }, 20000);

  // ════════════ INICIO (tablero) ════════════
  T.vistas.inicio = {
    async render(el) {
      const hoy = T.dia(), fin = T.finDia(hoy), verPlata = T.auth.puede('reportes.ver'), verUtil = T.auth.puede('utilidad.ver');
      const [d, sem] = await Promise.all([T.neg.resumen(T.iniDia(hoy), fin), T.neg.resumen(T.iniDia(hoy) - 6 * 86400000, fin)]);
      const ayer = sem.porDia[T.dia(T.iniDia(hoy) - 86400000)] || 0, cambio = ayer ? Math.round((d.total - ayer) / ayer * 100) : null;
      const al = T.neg.alertas(), caja = T.neg.cajaAbierta(), deben = T.db.lista('clientes').filter(c => c.saldo > 0);
      const dias = Array.from({ length: 7 }, (_, i) => T.dia(T.iniDia(hoy) - (6 - i) * 86400000));
      const max = Math.max(1, ...dias.map(x => sem.porDia[x] || 0)), sinResp = T.respaldo.diasSin();
      const lista = (arr, f, vacio) => arr.length ? `<ul class="lista-simple">${arr.slice(0, 6).map(f).join('')}</ul>${arr.length > 6 ? `<small class="suave">y ${arr.length - 6} más…</small>` : ''}` : `<p class="suave">${vacio}</p>`;
      el.innerHTML = `
        <div class="cabeza"><div><h2>Resumen del día</h2><span class="suave">${new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span></div>
          <div class="fila">${T.auth.puede('ventas.crear') ? `<a class="btn pri" href="#vender">${T.ico('vender')} Vender</a>` : ''}${T.auth.puede('inventario.editar') ? `<button class="btn ia" id="foto">${T.ico('camara')} Foto al inventario</button>` : ''}</div></div>
        ${!T.sync.hub && !T.sync.nube && (sinResp === null || sinResp >= 1) ? `<div class="banda aviso">${T.ico('alerta')}<span>${sinResp === null ? 'Aún no hay ninguna copia de seguridad.' : `Hace ${sinResp} día(s) no se hace copia de seguridad.`} Los datos solo están en este navegador.</span>${T.auth.puede('respaldo.gestionar') ? '<button class="btn" id="resp">Descargar copia</button>' : ''}</div>` : ''}
        ${!caja && T.auth.puede('caja.operar') ? `<div class="banda">${T.ico('caja')}<span>La caja está cerrada.</span><a class="btn" href="#caja">Abrir caja</a></div>` : ''}
        ${verPlata ? `<div class="rejilla">
          <div class="tarjeta kpi principal"><h4>Ventas de hoy</h4><b>${T.money(d.total)}</b><small>${cambio === null ? '' : `<span class="delta ${cambio < 0 ? 'baja' : ''}">${cambio > 0 ? '+' : ''}${cambio}% vs. ayer</span>`}${d.n} tiquete${d.n === 1 ? '' : 's'}${d.anuladas ? ` · ${d.anuladas} anulada(s)` : ''}</small></div>
          ${verUtil ? `<div class="tarjeta kpi"><h4>Utilidad bruta hoy</h4><b>${T.money(d.utilidad)}</b><small>${d.total ? Math.round(d.utilidad / d.total * 100) : 0}% de margen</small></div>` : ''}
          <div class="tarjeta kpi"><h4>Fiado hoy</h4><b>${T.money(d.fiado)}</b><small>Abonos recibidos: ${T.money(d.abonos)}</small></div>
          <div class="tarjeta kpi"><h4>Por cobrar</h4><b>${T.money(deben.reduce((a, c) => a + c.saldo, 0))}</b><small>${deben.length} cliente(s)</small></div>
        </div>
        <div class="tarjeta" style="margin-bottom:14px"><h4>Ventas de los últimos 7 días <span class="etq">${T.money(sem.total)}</span></h4><div class="barras">${dias.map(x => `<div class="${x === hoy ? 'hoy' : ''}" title="${T.money(sem.porDia[x] || 0)}"><em>${sem.porDia[x] ? T.corto(sem.porDia[x]) : ''}</em><i style="height:${Math.round((sem.porDia[x] || 0) / max * 82)}%"></i><span>${new Date(T.iniDia(x)).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric' })}</span></div>`).join('')}</div></div>` : ''}
        <div class="rejilla dos">
          <div class="tarjeta"><h4>Agotados y por agotarse <span class="etq ${al.agotados.length + al.bajos.length ? 'aviso' : 'ok'}">${al.agotados.length + al.bajos.length}</span></h4>
            ${lista([...al.bajos, ...al.agotados], p => `<li><span>${T.esc(p.nombre)}</span><span class="etq ${p.stock > 0 ? 'aviso' : 'mal'}">${T.cant(p.stock)}</span></li>`, 'Todo tiene existencias suficientes.')}</div>
          <div class="tarjeta"><h4>Vencimientos <span class="etq ${al.vencidos.length ? 'mal' : al.porVencer.length ? 'aviso' : 'ok'}">${al.vencidos.length + al.porVencer.length}</span></h4>
            ${lista([...al.vencidos, ...al.porVencer], p => `<li><span>${T.esc(p.nombre)}</span><span class="etq ${p.vence < hoy ? 'mal' : 'aviso'}">${T.fechaCorta(p.vence)}</span></li>`, 'Nada vencido ni por vencer.')}</div>
          ${verPlata ? `<div class="tarjeta"><h4>Más vendidos hoy</h4>${lista(Object.values(d.productos).sort((a, b) => b.total - a.total), p => `<li><span>${T.esc(p.nombre)} <small class="suave">× ${T.cant(p.cantidad)}</small></span><span class="num">${T.money(p.total)}</span></li>`, 'Todavía no hay ventas hoy.')}</div>` : ''}
          <div class="tarjeta"><h4>Clientes que más deben</h4>${lista(deben.sort((a, b) => b.saldo - a.saldo), c => `<li><span>${T.esc(c.nombre)}</span><span class="num">${T.money(c.saldo)}</span></li>`, 'Nadie debe.')}</div>
        </div>`;
      const foto = T.$('#foto', el), resp = T.$('#resp', el);
      if (foto) foto.onclick = () => T.ui.fotoIA('productos');
      if (resp) resp.onclick = async () => { await T.respaldo.descargar(); T.app.refrescar(); };
    }
  };

  T.ui = T.ui || {};
  document.addEventListener('DOMContentLoaded', () => T.app.iniciar());
})(window.T);
