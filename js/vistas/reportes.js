'use strict';
// ════════════ REPORTES · ASISTENTE IA · BITÁCORA ════════════
(function (T) {
  T.ui = T.ui || {};

  // Devolución de algunos productos de una venta.
  T.ui.devolver = async v => {
    const filas = v.items.map((l, i) => ({ l, i, queda: T.r3(l.cantidad - (l.devuelto || 0)) })).filter(x => x.queda > 0);
    if (!filas.length) { T.toast('De esta venta ya se devolvió todo'); return false; }
    const quien = await T.auth.autorizar('ventas.anular', 'Devolución · recibo ' + v.numero);
    if (!quien) return false;
    return new Promise(res => {
      const leer = cu => filas.map((x, n) => ({ i: x.i, cantidad: Math.min(x.queda, Math.max(0, T.aNum(T.$$('[data-dev]', cu)[n].value))) })).filter(x => x.cantidad > 0);
      const m = T.modal({
        titulo: `Devolución · recibo ${v.numero}`, ancho: 580, alCerrar: r => res(!!r),
        cuerpo: `<p class="suave" style="margin-bottom:10px">Escriba cuántas unidades devuelve el cliente de cada producto. Vuelven al inventario.</p>
          ${T.tabla([{ t: 'Producto', v: x => T.esc(x.l.nombre) }, { t: 'Compró', cls: 'der num', v: x => T.cant(x.queda) }, { t: 'Precio', cls: 'der num', v: x => T.money(x.l.total / x.l.cantidad) },
          { t: 'Devuelve', cls: 'der', v: x => `<input data-dev type="number" step="any" min="0" max="${x.queda}" value="" placeholder="0" style="width:80px;text-align:right" aria-label="Cantidad que devuelve de ${T.esc(x.l.nombre)}">` }], filas)}
          <label class="campo" style="margin-top:12px"><span>Motivo *</span><input id="motivo" placeholder="Ej: producto dañado, se equivocó de producto"></label>
          <div class="cambio" id="res">Valor a devolver: ${T.money(0)}</div>`,
        botones: [{ txt: 'Cancelar', cls: 'sec' }, {
          txt: 'Registrar devolución', cls: 'pri', fn: async cu => {
            const r = await T.neg.devolver(v.id, { items: leer(cu), motivo: T.$('#motivo', cu).value.trim(), autoriza: quien });
            T.toast(r.devolucion.enEfectivo ? `Devuelva ${T.money(r.devolucion.enEfectivo)} en efectivo` : 'Devolución registrada', 'ok');
            return r;
          }
        }]
      });
      m.cuerpo.oninput = () => {
        const total = Math.min(v.total - (v.devuelto || 0), leer(m.cuerpo).reduce((a, x) => { const l = v.items[x.i]; return a + T.red(l.total / l.cantidad * x.cantidad); }, 0));
        const aFiado = v.clienteId ? Math.min(total, (v.fiado || 0) - (v.fiadoDevuelto || 0)) : 0;
        T.$('#res', m.cuerpo).textContent = aFiado ? `Se descuenta de la deuda: ${T.money(aFiado)}${total - aFiado ? ` · En efectivo: ${T.money(total - aFiado)}` : ''}` : `Devolver en efectivo: ${T.money(total)}`;
      };
    });
  };

  // Lista de ventas con sus acciones; la usan Reportes y Caja.
  T.ui.tablaVentas = (ventas, vacio = 'No hay ventas.') => T.tabla([
    { t: 'Recibo', v: v => `<b>${T.esc(v.numero)}</b><br><small class="suave">${T.fechaHora(v.fecha)}</small>` }, { t: 'Vendedor', v: v => T.esc(v.usuario) }, { t: 'Cliente', v: v => T.esc(v.cliente || '—') },
    { t: 'Pago', v: v => v.pagos.map(p => T.METODOS[p.metodo]).join(' + ') },
    { t: 'Total', cls: 'der num', v: v => `${T.money(v.total - (v.devuelto || 0))}${v.devuelto ? `<br><small class="suave">devuelto ${T.money(v.devuelto)}</small>` : ''}` },
    { t: 'Estado', v: v => v.estado === 'anulada' ? `<span class="etq mal" title="${T.esc(v.anulacion.motivo)}">Anulada</span>` : v.devuelto ? '<span class="etq aviso">Con devolución</span>' : '<span class="etq ok">OK</span>' },
    { t: '', cls: 'acc', v: v => `<button class="btn-ico" data-a="ver" data-v="${v.id}" title="Ver recibo">${T.ico('lista')}</button>${v.estado === 'completada' ? `<button class="btn mini" data-a="devolver" data-v="${v.id}">Devolución</button>${v.devuelto ? '' : `<button class="btn mini" data-a="anular" data-v="${v.id}">Anular</button>`}` : ''}` }
  ], ventas, vacio);
  T.ui.accionVenta = async (e, ventas, alCambiar) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const v = ventas.find(x => x.id === b.dataset.v); if (!v) return;
    if (b.dataset.a === 'ver') return T.ui.verRecibo(v);
    if (await (b.dataset.a === 'devolver' ? T.ui.devolver(v) : T.ui.anular(v))) alCambiar();
  };

  T.ui.anular = async v => {
    const quien = await T.auth.autorizar('ventas.anular', 'Recibo ' + v.numero);
    if (!quien) return false;
    const r = await T.pedir({
      titulo: `Anular recibo ${v.numero}`, ok: 'Anular venta', ancho: 420, nota: `Total ${T.money(v.total)}. Los productos vuelven al inventario y la venta queda marcada como anulada (no se borra).`,
      campos: [{ id: 'motivo', label: 'Motivo', req: true, ph: 'Ej: el cliente devolvió, error al cobrar' }], validar: x => T.neg.anularVenta(v.id, x.motivo, quien)
    });
    if (r) T.toast('Venta anulada', 'ok');
    return !!r;
  };

  T.vistas.reportes = {
    desde: T.dia(), hasta: T.dia(), pestana: 'resumen',
    async render(el) {
      const hoy = T.dia(), util = T.auth.puede('utilidad.ver');
      const r = await T.neg.resumen(T.iniDia(this.desde), T.finDia(this.hasta));
      const rapidos = [['Hoy', hoy, hoy], ['Ayer', T.dia(Date.now() - 86400000), T.dia(Date.now() - 86400000)], ['7 días', T.dia(Date.now() - 6 * 86400000), hoy], ['Este mes', hoy.slice(0, 8) + '01', hoy], ['30 días', T.dia(Date.now() - 29 * 86400000), hoy]];
      el.innerHTML = `<div class="cabeza"><h2>Reportes</h2><div class="fila"><button class="btn" id="csv">${T.ico('bajar')} Exportar ventas</button><button class="btn" id="imp">${T.ico('imprimir')} Imprimir</button></div></div>
        <div class="fila" style="margin-bottom:12px"><div class="chips" style="padding:0">${rapidos.map(([t, d, h], i) => `<button data-r="${i}" class="${d === this.desde && h === this.hasta ? 'activo' : ''}">${t}</button>`).join('')}</div>
          <input type="date" id="desde" value="${this.desde}" style="width:auto" aria-label="Desde"><input type="date" id="hasta" value="${this.hasta}" style="width:auto" aria-label="Hasta"></div>
        <div class="pestanas" id="pes">${[['resumen', 'Resumen'], ['ventas', `Ventas (${r.ventas.length})`], ['productos', 'Productos']].map(([id, t]) => `<button data-t="${id}" class="${id === this.pestana ? 'activo' : ''}">${t}</button>`).join('')}</div><div id="cont"></div>`;
      const cont = T.$('#cont', el), barras = (obj, fmt = T.money) => {
        const e = Object.entries(obj).sort((a, b) => b[1] - a[1]), max = Math.max(1, ...e.map(x => x[1]));
        return e.length ? `<ul class="lista-simple">${e.map(([k, v]) => `<li style="display:block"><div class="fila" style="justify-content:space-between"><span>${T.esc(T.METODOS[k] || k)}</span><b class="num">${fmt(v)}</b></div><div style="height:6px;border-radius:3px;background:var(--panel2);margin-top:4px"><div style="height:100%;width:${Math.round(v / max * 100)}%;background:var(--pri);border-radius:3px"></div></div></li>`).join('')}</ul>` : '<p class="suave">Sin datos en este rango.</p>';
      };
      if (this.pestana === 'resumen') {
        const dias = Object.keys(r.porDia).sort(), max = Math.max(1, ...Object.values(r.porDia));
        cont.innerHTML = `<div class="rejilla">
            <div class="tarjeta kpi"><h4>Ventas</h4><b>${T.money(r.total)}</b><small>${r.n} tiquetes · promedio ${T.money(r.n ? r.total / r.n : 0)}</small></div>
            ${util ? `<div class="tarjeta kpi"><h4>Utilidad bruta</h4><b>${T.money(r.utilidad)}</b><small>${r.total ? Math.round(r.utilidad / r.total * 100) : 0}% de margen</small></div>
            <div class="tarjeta kpi"><h4>Gastos de caja</h4><b>${T.money(r.gastos)}</b><small>Queda ${T.money(r.utilidad - r.gastos)} después de gastos</small></div>` : ''}
            <div class="tarjeta kpi"><h4>Fiado / abonos</h4><b>${T.money(r.fiado)}</b><small>Abonos recibidos ${T.money(r.abonos)}</small></div>
            <div class="tarjeta kpi"><h4>Devoluciones</h4><b>${T.money(r.devuelto)}</b><small>${r.anuladas} venta(s) anulada(s) · descuentos ${T.money(r.descuento)}${r.impuesto ? ` · IVA ${T.money(r.impuesto)}` : ''}</small></div></div>
          ${dias.length > 1 ? `<div class="tarjeta" style="margin-bottom:14px"><h4>Ventas por día</h4><div class="barras">${dias.slice(-31).map(d => `<div title="${T.fechaCorta(d)}: ${T.money(r.porDia[d])}"><i style="height:${Math.round(r.porDia[d] / max * 100)}%"></i>${dias.length <= 14 ? `<span>${d.slice(8)}/${d.slice(5, 7)}</span>` : ''}</div>`).join('')}</div></div>` : ''}
          <div class="rejilla dos"><div class="tarjeta"><h4>Por medio de pago</h4>${barras(r.porMetodo)}</div><div class="tarjeta"><h4>Por categoría</h4>${barras(r.porCategoria)}</div><div class="tarjeta"><h4>Por vendedor</h4>${barras(r.porUsuario)}</div></div>`;
      } else if (this.pestana === 'ventas') {
        cont.innerHTML = T.ui.tablaVentas(r.ventas.slice(0, 400), 'No hay ventas en este rango.');
        cont.onclick = e => T.ui.accionVenta(e, r.ventas, () => this.render(el));
      } else {
        cont.innerHTML = T.tabla([
          { t: 'Producto', v: p => T.esc(p.nombre) }, { t: 'Vendidos', cls: 'der num', v: p => T.cant(p.cantidad) }, { t: 'Ventas', cls: 'der num', v: p => T.money(p.total) },
          ...(util ? [{ t: 'Utilidad', cls: 'der num', v: p => T.money(p.utilidad) }, { t: 'Margen', cls: 'der num', v: p => (p.total ? Math.round(p.utilidad / p.total * 100) : 0) + '%' }] : [])
        ], Object.values(r.productos).sort((a, b) => b.total - a.total), 'No hay ventas en este rango.');
      }
      T.$('#pes', el).onclick = e => { const b = e.target.closest('[data-t]'); if (b) { this.pestana = b.dataset.t; this.render(el); } };
      T.$$('[data-r]', el).forEach(b => b.onclick = () => { [, this.desde, this.hasta] = rapidos[+b.dataset.r]; this.render(el); });
      T.$('#desde', el).onchange = e => { if (e.target.value) { this.desde = e.target.value; if (this.hasta < this.desde) this.hasta = this.desde; this.render(el); } };
      T.$('#hasta', el).onchange = e => { if (e.target.value) { this.hasta = e.target.value; if (this.hasta < this.desde) this.desde = this.hasta; this.render(el); } };
      T.$('#csv', el).onclick = () => T.descargar(`ventas-${this.desde}_${this.hasta}.csv`, T.csv([['recibo', 'fecha', 'vendedor', 'cliente', 'producto', 'cantidad', 'precio', 'descuento', 'total', 'pago', 'estado'],
      ...r.ventas.flatMap(v => v.items.map(l => [v.numero, T.fechaHora(v.fecha), v.usuario, v.cliente, l.nombre, l.cantidad, l.precio, l.descuento, l.total, v.pagos.map(p => p.metodo).join('+'), v.estado]))]), 'text/csv');
      T.$('#imp', el).onclick = () => T.imprimir(`<h2>${T.esc(T.db.cfg('negocio', {}).nombre || '')} — Reporte ${T.fechaCorta(this.desde)} a ${T.fechaCorta(this.hasta)}</h2>${cont.innerHTML}`);
    }
  };

  // ════════════ ASISTENTE IA ════════════
  const charla = [];
  T.vistas.ia = {
    render(el) {
      const ideas = ['¿Cómo me fue esta semana comparado con el mes?', '¿Qué debo pedirle a los proveedores?', '¿Qué productos no se están vendiendo?', '¿Qué hago con lo que está por vencer?', '¿A quién debo cobrarle primero?'];
      el.innerHTML = `<div class="cabeza"><div><h2>Asistente IA</h2><span class="suave">Pregunte por sus ventas, inventario y fiados. Responde con los datos reales de la tienda.</span></div>
          ${T.auth.puede('inventario.editar') ? `<div class="fila"><button class="btn ia" id="foto">${T.ico('camara')} Foto al inventario</button></div>` : ''}</div>
        ${T.ia.lista() ? '' : `<div class="banda aviso">${T.ico('alerta')}<span>Falta la clave de la IA (es gratis).</span><a class="btn" href="#config" id="cfg">Configurar</a></div>`}
        <div class="tarjeta"><div class="chat" id="chat"></div><div class="chips" id="ideas">${ideas.map(i => `<button>${T.esc(i)}</button>`).join('')}</div>
          <div class="fila"><input class="crece" id="p" placeholder="Escriba su pregunta…" autocomplete="off"><button class="btn pri" id="env" aria-label="Enviar">${T.ico('enviar')}</button></div></div>`;
      const chat = T.$('#chat', el), p = T.$('#p', el);
      const pintar = pensando => { chat.innerHTML = (charla.length ? charla.map(c => `<div class="burbuja ${c.rol}">${T.esc(c.texto)}</div>`).join('') : '<p class="vacio">Haga una pregunta o toque una de las sugerencias.</p>') + (pensando ? '<div class="pensando">Pensando…</div>' : ''); chat.scrollTop = chat.scrollHeight; };
      const enviar = async texto => {
        texto = (texto || '').trim(); if (!texto) return;
        const previo = charla.slice(-8);
        charla.push({ rol: 'yo', texto }); p.value = ''; pintar(true);
        try { charla.push({ rol: 'ia', texto: (await T.ia.asistente(texto, previo)).replace(/\*\*/g, '') }); }
        catch (e) { charla.pop(); T.toast(e.message, 'error'); }
        pintar();
      };
      T.$('#env', el).onclick = () => enviar(p.value);
      p.onkeydown = e => { if (e.key === 'Enter') enviar(p.value); };
      T.$('#ideas', el).onclick = e => { if (e.target.tagName === 'BUTTON') enviar(e.target.textContent); };
      const foto = T.$('#foto', el), cfg = T.$('#cfg', el);
      if (foto) foto.onclick = () => T.ui.fotoIA('productos');
      if (cfg) cfg.onclick = () => { T.vistas.config.pestana = 'ia'; };
      pintar();
    }
  };

  // ════════════ BITÁCORA ════════════
  const ACCIONES = { 'venta.crear': 'Venta', 'venta.anular': 'Venta anulada', 'venta.devolver': 'Devolución', 'producto.crear': 'Producto creado', 'producto.editar': 'Producto editado', 'producto.borrar': 'Producto eliminado', 'inventario.ajuste': 'Ajuste de existencias', 'inventario.merma': 'Merma', 'inventario.entrada': 'Entrada de mercancía', 'compra.crear': 'Compra', 'compra.pagar': 'Pago a proveedor', 'proveedor.crear': 'Proveedor creado', 'proveedor.editar': 'Proveedor editado', 'cliente.crear': 'Cliente creado', 'cliente.editar': 'Cliente editado', 'abono.crear': 'Abono', 'caja.abrir': 'Caja abierta', 'caja.cerrar': 'Caja cerrada', 'caja.gasto': 'Gasto', 'caja.ingreso': 'Ingreso', 'caja.retiro': 'Retiro', 'sesion.iniciar': 'Entró', 'sesion.cerrar': 'Salió', 'sesion.fallida': 'Clave incorrecta', autorizacion: 'Autorización', 'usuario.crear': 'Usuario creado', 'usuario.editar': 'Usuario editado', 'config.cambiar': 'Configuración', 'respaldo.descargar': 'Respaldo descargado', 'respaldo.restaurar': 'Respaldo restaurado', 'ia.foto': 'Foto con IA', 'tienda.crear': 'Tienda creada', 'nube.configurar': 'Nube configurada', 'nube.entrar': 'Nube conectada', 'nube.salir': 'Nube desconectada' };
  // Las ediciones guardan {campo: [antes, después]}; se muestran como "antes → después".
  const esCambio = (k, v) => Array.isArray(v) && v.length === 2 && k !== 'productos' && k !== 'pagos' && v.every(x => x === null || typeof x !== 'object');
  const detalle = d => d == null ? '' : typeof d !== 'object' ? String(d) : Object.entries(d).map(([k, v]) => `${k}: ${esCambio(k, v) ? `${v[0] ?? '—'} → ${v[1] ?? '—'}` : v !== null && typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');

  T.vistas.auditoria = {
    desde: T.dia(), hasta: T.dia(), q: '',
    async render(el) {
      const regs = (await T.db.rango('auditoria', 'fecha', T.iniDia(this.desde), T.finDia(this.hasta))).sort((a, b) => b.fecha - a.fecha);
      el.innerHTML = `<div class="cabeza"><div><h2>Bitácora</h2><span class="suave">Todo lo que se hace queda aquí. No se puede editar ni borrar.</span></div>
          <div class="fila"><button class="btn" id="ver">${T.ico('auditoria')} Verificar integridad</button><button class="btn" id="csv">${T.ico('bajar')} Exportar</button></div></div>
        <div class="fila" style="margin-bottom:12px"><input type="date" id="desde" value="${this.desde}" style="width:auto" aria-label="Desde"><input type="date" id="hasta" value="${this.hasta}" style="width:auto" aria-label="Hasta">
          <div class="buscador crece">${T.ico('buscar')}<input id="q" value="${T.esc(this.q)}" placeholder="Buscar por usuario, acción o detalle"></div></div><div id="tabla"></div>`;
      const filtrar = () => { const t = T.norm(this.q); return regs.filter(r => !t || T.norm(`${r.usuario} ${ACCIONES[r.accion] || r.accion} ${r.ref} ${detalle(r.detalle)}`).includes(t)); };
      const pintar = () => {
        const lista = filtrar();
        T.$('#tabla', el).innerHTML = T.tabla([
          { t: 'Fecha', v: r => `<span class="num">${T.fechaHora(r.fecha)}</span>` }, { t: 'Usuario', v: r => T.esc(r.usuario) },
          { t: 'Acción', v: r => `<span class="etq ${/anular|borrar|fallida|merma|retiro/.test(r.accion) ? 'mal' : /editar|ajuste|autorizacion|config|restaurar/.test(r.accion) ? 'aviso' : 'info'}">${T.esc(ACCIONES[r.accion] || r.accion)}</span>` },
          { t: 'Referencia', v: r => T.esc(r.ref) }, { t: 'Detalle', v: r => `<small>${T.esc(detalle(r.detalle))}</small>` }
        ], lista.slice(0, 500), 'No hay registros en este rango.') + (lista.length > 500 ? `<p class="suave centro" style="margin-top:8px">Se muestran 500 de ${lista.length}. Acorte el rango o use el buscador.</p>` : '');
      };
      T.$('#q', el).oninput = e => { this.q = e.target.value; pintar(); };
      T.$('#desde', el).onchange = e => { if (e.target.value) { this.desde = e.target.value; if (this.hasta < this.desde) this.hasta = this.desde; this.render(el); } };
      T.$('#hasta', el).onchange = e => { if (e.target.value) { this.hasta = e.target.value; if (this.hasta < this.desde) this.desde = this.hasta; this.render(el); } };
      T.$('#csv', el).onclick = () => T.descargar(`bitacora-${this.desde}_${this.hasta}.csv`, T.csv([['fecha', 'usuario', 'accion', 'referencia', 'detalle', 'equipo', 'n', 'hash'], ...filtrar().map(r => [T.fechaHora(r.fecha), r.usuario, ACCIONES[r.accion] || r.accion, r.ref, detalle(r.detalle), r.dispositivo, r.n, r.hash])]), 'text/csv');
      T.$('#ver', el).onclick = async () => {
        const v = await T.db.verificarAuditoria();
        T.modal({ titulo: 'Integridad de la bitácora', ancho: 480, cuerpo: v.fallas.length ? `<div class="banda aviso">${T.ico('alerta')}<span>Se encontraron ${v.fallas.length} problema(s) en ${v.total} registros.</span></div><ul>${v.fallas.slice(0, 30).map(f => `<li>${T.esc(f)}</li>`).join('')}</ul>` : `<div class="banda" style="background:var(--pri-suave);color:var(--pri)">${T.ico('ok')}<span>Los ${v.total} registros están completos y sin alteraciones.</span></div>`, botones: [{ txt: 'Cerrar', cls: 'pri' }] });
      };
      pintar();
    }
  };
})(window.T);
