'use strict';
// ════════════ COMPRAS · CLIENTES Y FIADOS · CAJA ════════════
(function (T) {
  T.ui = T.ui || {};
  const pestanas = (el, lista, actual, alElegir) => {
    el.innerHTML = lista.map(([id, t]) => `<button data-t="${id}" class="${id === actual ? 'activo' : ''}">${t}</button>`).join('');
    el.onclick = e => { const b = e.target.closest('[data-t]'); if (b) alElegir(b.dataset.t); };
  };

  // ════════════ COMPRAS ════════════
  T.ui.editarProveedor = async p => {
    const campos = [{ id: 'nombre', label: 'Nombre', req: true, valor: p && p.nombre }, { id: 'nit', label: 'NIT', medio: true, valor: p && p.nit }, { id: 'telefono', label: 'Teléfono', medio: true, valor: p && p.telefono },
    { id: 'contacto', label: 'Vendedor / contacto', valor: p && p.contacto }, { id: 'nota', label: 'Notas (días de visita, plazo…)', tipo: 'textarea', valor: p && p.nota }];
    const v = await T.pedir({ titulo: p ? 'Editar proveedor' : 'Proveedor nuevo', campos, validar: async v => { await T.neg.guardarProveedor({ ...(p ? { id: p.id } : {}), ...v }); } });
    return !!v;
  };

  T.vistas.compras = {
    pestana: 'compras',
    async render(el) {
      el.innerHTML = `<div class="cabeza"><h2>Compras</h2><div class="fila">
          ${T.auth.puede('ia.usar') ? `<button class="btn ia" id="foto">${T.ico('camara')} Foto de la factura</button>` : ''}
          <button class="btn pri" id="nueva">${T.ico('mas')} Compra</button><button class="btn" id="prov">${T.ico('mas')} Proveedor</button></div></div>
        <div class="pestanas" id="pes"></div><div id="cont"></div>`;
      pestanas(T.$('#pes', el), [['compras', 'Compras'], ['deudas', 'Por pagar'], ['proveedores', 'Proveedores']], this.pestana, t => { this.pestana = t; this.render(el); });
      const foto = T.$('#foto', el); if (foto) foto.onclick = () => T.ui.fotoIA('factura');
      T.$('#nueva', el).onclick = () => T.ui.entrada({ esCompra: true });
      T.$('#prov', el).onclick = async () => { if (await T.ui.editarProveedor()) { this.pestana = 'proveedores'; this.render(el); } };
      const cont = T.$('#cont', el);
      if (this.pestana === 'proveedores') {
        cont.innerHTML = T.tabla([
          { t: 'Proveedor', v: p => `<b>${T.esc(p.nombre)}</b>${p.nit ? `<br><small class="suave">NIT ${T.esc(p.nit)}</small>` : ''}` },
          { t: 'Contacto', v: p => T.esc([p.contacto, p.telefono].filter(Boolean).join(' · ')) }, { t: 'Notas', v: p => T.esc(p.nota || '') },
          { t: '', cls: 'acc', v: p => `<button class="btn-ico" data-p="${p.id}" title="Editar">${T.ico('editar')}</button>` }
        ], T.db.lista('proveedores').sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')), 'Aún no hay proveedores.');
        cont.onclick = async e => { const b = e.target.closest('[data-p]'); if (b && await T.ui.editarProveedor(T.db.get('proveedores', b.dataset.p))) this.render(el); };
        return;
      }
      let compras = (await T.db.todos('compras')).sort((a, b) => b.fecha - a.fecha);
      if (this.pestana === 'deudas') compras = compras.filter(c => c.saldo > 0);
      cont.innerHTML = (this.pestana === 'deudas' ? `<p style="margin-bottom:10px">Se debe a proveedores: <b>${T.money(compras.reduce((a, c) => a + c.saldo, 0))}</b></p>` : '') + T.tabla([
        { t: 'Compra', v: c => `<b>${T.esc(c.numero)}</b><br><small class="suave">${T.fechaHora(c.fecha)}</small>` },
        { t: 'Proveedor', v: c => `${T.esc(c.proveedor || '—')}${c.factura ? `<br><small class="suave">Fact. ${T.esc(c.factura)}</small>` : ''}` },
        { t: 'Productos', cls: 'der', v: c => c.items.length }, { t: 'Total', cls: 'der num', v: c => T.money(c.total) },
        { t: 'Estado', v: c => c.saldo > 0 ? `<span class="etq aviso">Debe ${T.money(c.saldo)}</span>` : '<span class="etq ok">Pagada</span>' },
        { t: '', cls: 'acc', v: c => `${c.saldo > 0 ? `<button class="btn mini pri" data-a="pagar" data-c="${c.id}">Pagar</button>` : ''}<button class="btn-ico" data-a="ver" data-c="${c.id}" title="Ver detalle">${T.ico('lista')}</button>` }
      ], compras.slice(0, 200), this.pestana === 'deudas' ? 'No se le debe a ningún proveedor.' : 'Aún no hay compras registradas.');
      cont.onclick = async e => {
        const b = e.target.closest('[data-a]'); if (!b) return;
        const c = compras.find(x => x.id === b.dataset.c);
        if (b.dataset.a === 'ver') return T.modal({
          titulo: `Compra ${c.numero}`, ancho: 620, cuerpo: `<p class="suave" style="margin-bottom:10px">${T.fechaHora(c.fecha)} · ${T.esc(c.proveedor || 'Sin proveedor')} · registró ${T.esc(c.usuario)}</p>` +
            T.tabla([{ t: 'Producto', v: l => T.esc(l.nombre) }, { t: 'Cant.', cls: 'der num', v: l => T.cant(l.cantidad) }, { t: 'Costo', cls: 'der num', v: l => T.money(l.costo) }, { t: 'Total', cls: 'der num', v: l => T.money(l.total) }], c.items) + `<p class="der" style="margin-top:10px"><b>Total ${T.money(c.total)}</b></p>`
        });
        const r = await T.pedir({
          titulo: `Pagar compra ${c.numero}`, nota: `Se debe ${T.money(c.saldo)} a ${c.proveedor || 'el proveedor'}.`, ok: 'Registrar pago', campos: [
            { id: 'monto', label: 'Valor que paga', tipo: 'number', valor: c.saldo, req: true }, { id: 'caja', label: 'Sale de la plata de la caja', tipo: 'check', valor: !!T.neg.cajaAbierta() }],
          validar: v => T.neg.pagarCompra(c.id, T.red(v.monto), v.caja)
        });
        if (r) { T.toast('Pago registrado', 'ok'); this.render(el); }
      };
    }
  };

  // ════════════ CLIENTES Y FIADOS ════════════
  T.ui.editarCliente = c => new Promise(async res => {
    const campos = [{ id: 'nombre', label: 'Nombre', req: true, valor: c && c.nombre }, { id: 'documento', label: 'Cédula', medio: true, valor: c && c.documento }, { id: 'telefono', label: 'Celular', medio: true, valor: c && c.telefono },
    { id: 'direccion', label: 'Dirección', valor: c && c.direccion }, { id: 'cupo', label: 'Cupo máximo de fiado ($)', tipo: 'number', valor: c ? c.cupo : T.regla('cupoDefecto') }];
    let guardado = null;
    const v = await T.pedir({ titulo: c ? 'Editar cliente' : 'Cliente nuevo', campos, validar: async v => { guardado = await T.neg.guardarCliente({ ...(c ? { id: c.id } : {}), ...v, cupo: T.red(v.cupo) }); } });
    res(v ? guardado : null);
  });

  T.ui.abonar = async c => {
    const r = await T.pedir({
      titulo: 'Abono de ' + c.nombre, nota: `Debe ${T.money(c.saldo)}.`, ok: 'Recibir abono', ancho: 400, campos: [
        { id: 'monto', label: 'Valor del abono', tipo: 'number', valor: c.saldo, req: true },
        { id: 'metodo', label: 'Cómo paga', tipo: 'select', opciones: Object.entries(T.METODOS).filter(([k]) => k !== 'fiado') }],
      validar: v => T.neg.abono({ clienteId: c.id, monto: v.monto, metodo: v.metodo })
    });
    if (r) T.toast('Abono registrado', 'ok');
    return !!r;
  };

  T.ui.cuenta = async (c, alCambiar) => {
    const [ventas, abonos] = await Promise.all([T.db.porIndice('ventas', 'clienteId', c.id), T.db.porIndice('abonos', 'clienteId', c.id)]);
    const movs = [...ventas.filter(v => v.fiado > 0 && v.estado === 'completada').map(v => ({ fecha: v.fecha, txt: `Fiado · recibo ${v.numero}`, valor: v.fiado, v })), ...abonos.map(a => ({ fecha: a.fecha, txt: `Abono (${T.METODOS[a.metodo]})`, valor: -a.monto }))].sort((a, b) => b.fecha - a.fecha);
    const tel = String(c.telefono || '').replace(/\D/g, '');
    const m = T.modal({
      titulo: 'Cuenta de ' + c.nombre, ancho: 600,
      cuerpo: `<div class="rejilla"><div class="tarjeta kpi"><h4>Debe</h4><b>${T.money(c.saldo)}</b><small>Cupo ${T.money(c.cupo)}</small></div></div>` +
        T.tabla([{ t: 'Fecha', v: x => T.fechaHora(x.fecha) }, { t: 'Concepto', v: x => x.v ? `<a href="#" data-v="${x.v.id}">${T.esc(x.txt)}</a>` : T.esc(x.txt) }, { t: 'Valor', cls: 'der num', v: x => `<span class="etq ${x.valor > 0 ? 'aviso' : 'ok'}">${x.valor > 0 ? '+' : '−'}${T.money(Math.abs(x.valor))}</span>` }], movs, 'Este cliente no tiene fiados ni abonos.'),
      botones: [
        ...(c.saldo > 0 && tel ? [{ txt: 'Cobrar por WhatsApp', cls: 'sec', fn: () => { window.open(`https://wa.me/${tel.length === 10 ? '57' + tel : tel}?text=${encodeURIComponent(`Hola ${c.nombre}, le saluda ${T.db.cfg('negocio', {}).nombre || 'la tienda'}. Le recordamos que tiene un saldo pendiente de ${T.money(c.saldo)}. ¡Gracias!`)}`, '_blank', 'noopener'); return false; } }] : []),
        ...(c.saldo > 0 && T.auth.puede('abonos.crear') ? [{ txt: 'Recibir abono', cls: 'pri', fn: async () => { if (!await T.ui.abonar(c)) return false; alCambiar && alCambiar(); } }] : []),
        { txt: 'Cerrar', cls: 'sec' }]
    });
    m.cuerpo.onclick = e => { const a = e.target.closest('[data-v]'); if (a) { e.preventDefault(); T.ui.verRecibo(ventas.find(v => v.id === a.dataset.v)); } };
  };

  T.vistas.clientes = {
    q: '', soloDeben: false,
    render(el) {
      const todos = T.db.lista('clientes'), editar = T.auth.puede('clientes.editar');
      el.innerHTML = `<div class="cabeza"><h2>Clientes y fiados</h2>${editar ? `<button class="btn pri" id="nuevo">${T.ico('mas')} Cliente</button>` : ''}</div>
        <div class="rejilla"><div class="tarjeta kpi"><h4>Total por cobrar</h4><b>${T.money(todos.reduce((a, c) => a + Math.max(0, c.saldo || 0), 0))}</b><small>${todos.filter(c => c.saldo > 0).length} cliente(s) deben</small></div></div>
        <div class="fila" style="margin-bottom:12px"><div class="buscador crece">${T.ico('buscar')}<input id="q" value="${T.esc(this.q)}" placeholder="Buscar cliente"></div>
          <label class="campo check" style="grid-column:auto"><input type="checkbox" id="deben" ${this.soloDeben ? 'checked' : ''}><span>Solo los que deben</span></label></div><div id="tabla"></div>`;
      const pintar = () => {
        const t = T.norm(this.q), lista = todos.filter(c => (!this.soloDeben || c.saldo > 0) && (!t || T.norm(`${c.nombre} ${c.documento || ''} ${c.telefono || ''}`).includes(t))).sort((a, b) => (b.saldo || 0) - (a.saldo || 0) || a.nombre.localeCompare(b.nombre, 'es'));
        T.$('#tabla', el).innerHTML = T.tabla([
          { t: 'Cliente', v: c => `<b>${T.esc(c.nombre)}</b><br><small class="suave">${T.esc([c.telefono, c.direccion].filter(Boolean).join(' · '))}</small>` },
          { t: 'Debe', cls: 'der num', v: c => c.saldo > 0 ? `<span class="etq ${c.saldo > c.cupo ? 'mal' : 'aviso'}">${T.money(c.saldo)}</span>` : '<span class="etq ok">Al día</span>' },
          { t: 'Cupo', cls: 'der num', v: c => T.money(c.cupo) },
          { t: '', cls: 'acc', v: c => `${c.saldo > 0 && T.auth.puede('abonos.crear') ? `<button class="btn mini pri" data-a="abonar" data-c="${c.id}">Abonar</button>` : ''}<button class="btn mini" data-a="cuenta" data-c="${c.id}">Cuenta</button>${editar ? `<button class="btn-ico" data-a="editar" data-c="${c.id}" title="Editar">${T.ico('editar')}</button>` : ''}` }
        ], lista, todos.length ? 'Ningún cliente coincide.' : 'Aún no hay clientes.');
      };
      T.$('#q', el).oninput = e => { this.q = e.target.value; pintar(); };
      T.$('#deben', el).onchange = e => { this.soloDeben = e.target.checked; pintar(); };
      const nuevo = T.$('#nuevo', el); if (nuevo) nuevo.onclick = async () => { if (await T.ui.editarCliente()) this.render(el); };
      T.$('#tabla', el).onclick = async e => {
        const b = e.target.closest('[data-a]'); if (!b) return;
        const c = T.db.get('clientes', b.dataset.c);
        if (b.dataset.a === 'cuenta') return T.ui.cuenta(c, () => this.render(el));
        if (await (b.dataset.a === 'abonar' ? T.ui.abonar(c) : T.ui.editarCliente(c))) this.render(el);
      };
      pintar();
    }
  };

  // ════════════ CAJA ════════════
  const TIPOS_CAJA = { gasto: 'Gasto', ingreso: 'Ingreso', retiro: 'Retiro', devolucion: 'Devolución', compra: 'Pago a proveedor' };
  const cuadro = (caja, r) => `<ul class="lista-simple">
      <li><span>Base con la que abrió</span><span class="num">${T.money(caja.base)}</span></li>
      <li><span>Ventas en efectivo</span><span class="num">+${T.money(r.porMetodo.efectivo || 0)}</span></li>
      <li><span>Abonos en efectivo</span><span class="num">+${T.money(r.abonosPorMetodo.efectivo || 0)}</span></li>
      <li><span>Otros ingresos</span><span class="num">+${T.money(r.ingreso)}</span></li>
      <li><span>Gastos</span><span class="num">−${T.money(r.gasto)}</span></li>
      <li><span>Pagos a proveedores</span><span class="num">−${T.money(r.compra)}</span></li>
      <li><span>Retiros</span><span class="num">−${T.money(r.retiro)}</span></li>
      <li><span>Devoluciones</span><span class="num">−${T.money(r.devolucion)}</span></li>
      <li><b>Efectivo que debe haber</b><b class="num">${T.money(r.esperado)}</b></li></ul>`;
  const medios = r => `<ul class="lista-simple">${Object.entries(T.METODOS).map(([k, v]) => `<li><span>${v}</span><span class="num">${T.money(r.porMetodo[k] || 0)}</span></li>`).join('')}<li><b>Total vendido (${r.ventas} tiquetes)</b><b class="num">${T.money(r.total)}</b></li></ul>`;

  T.ui.verCierre = c => {
    const r = c.resumen, n = T.db.cfg('negocio', {});
    const html = `<div class="recibo" style="max-width:300px"><h5>${T.esc(n.nombre || 'Tienda')}</h5><div class="c">CIERRE DE CAJA ${T.esc(c.numero)}</div><hr>
      <div>Abrió: ${T.esc(c.usuario)} · ${T.fechaHora(c.apertura)}<br>Cerró: ${T.esc(c.cerro || '')} · ${T.fechaHora(c.cierre)}</div><hr>
      <table>${Object.entries(T.METODOS).map(([k, v]) => `<tr><td>Ventas ${v}</td><td>${T.num(r.porMetodo[k] || 0)}</td></tr>`).join('')}<tr class="t"><td>TOTAL VENTAS</td><td>${T.num(r.total)}</td></tr><tr><td>Tiquetes / anuladas</td><td>${r.ventas} / ${r.anuladas}</td></tr></table><hr>
      <table><tr><td>Base</td><td>${T.num(c.base)}</td></tr><tr><td>Abonos efectivo</td><td>${T.num(r.abonosPorMetodo.efectivo || 0)}</td></tr><tr><td>Ingresos</td><td>${T.num(r.ingreso)}</td></tr><tr><td>Gastos</td><td>−${T.num(r.gasto)}</td></tr><tr><td>Pagos proveedores</td><td>−${T.num(r.compra)}</td></tr><tr><td>Retiros</td><td>−${T.num(r.retiro)}</td></tr><tr><td>Devoluciones</td><td>−${T.num(r.devolucion)}</td></tr>
      <tr class="t"><td>DEBE HABER</td><td>${T.num(r.esperado)}</td></tr><tr class="t"><td>CONTADO</td><td>${T.num(c.contado)}</td></tr><tr class="t"><td>${c.diferencia < 0 ? 'FALTANTE' : c.diferencia > 0 ? 'SOBRANTE' : 'CUADRADA'}</td><td>${T.num(c.diferencia)}</td></tr></table>
      ${c.nota ? `<hr><div>Nota: ${T.esc(c.nota)}</div>` : ''}<hr><div class="c">Firma: ____________________</div></div>`;
    T.modal({ titulo: 'Cierre ' + c.numero, ancho: 400, cuerpo: html, botones: [{ txt: T.ico('imprimir') + ' Imprimir', cls: 'sec', fn: () => { T.imprimir(html); return false; } }, { txt: 'Cerrar', cls: 'pri' }] });
  };

  T.vistas.caja = {
    async render(el) {
      const caja = T.neg.cajaAbierta(), verTodas = T.auth.puede('reportes.ver');
      const historial = T.db.lista('cajas').filter(c => c.estado === 'cerrada' && (verTodas || c.usuarioId === T.auth.usuario.id)).sort((a, b) => b.cierre - a.cierre).slice(0, 60);
      const tablaHist = `<h3 style="margin:22px 0 10px">Cierres anteriores</h3>` + T.tabla([
        { t: 'Turno', v: c => `<b>${T.esc(c.numero)}</b><br><small class="suave">${T.fechaHora(c.cierre)}</small>` }, { t: 'Cajero', v: c => T.esc(c.usuario) },
        { t: 'Ventas', cls: 'der num', v: c => T.money(c.resumen.total) },
        { t: 'Cuadre', cls: 'der', v: c => `<span class="etq ${c.diferencia === 0 ? 'ok' : c.diferencia < 0 ? 'mal' : 'aviso'}">${c.diferencia === 0 ? 'Cuadrada' : (c.diferencia < 0 ? 'Faltó ' : 'Sobró ') + T.money(Math.abs(c.diferencia))}</span>` },
        { t: '', cls: 'acc', v: c => `<button class="btn-ico" data-c="${c.id}" title="Ver cierre">${T.ico('lista')}</button>` }
      ], historial, 'Aún no hay cierres.');
      if (!caja) {
        el.innerHTML = `<div class="cabeza"><h2>Caja</h2></div><div class="tarjeta" style="max-width:420px"><h3 style="margin-bottom:6px">La caja está cerrada</h3><p class="suave texto">Cuente el efectivo con el que empieza el turno (la base).</p>
          <label class="campo"><span>Base en efectivo</span><input type="number" id="base" inputmode="numeric" placeholder="0"></label>
          <button class="btn pri grande" id="abrir" style="width:100%;margin-top:14px">Abrir caja</button></div><div id="hist">${tablaHist}</div>`;
        T.$('#abrir', el).onclick = async () => { try { await T.neg.abrirCaja(T.aNum(T.$('#base', el).value)); T.toast('Caja abierta', 'ok'); this.render(el); } catch (e) { T.toast(e.message, 'error'); } };
      } else {
        const r = await T.neg.resumenCaja(caja);
        el.innerHTML = `<div class="cabeza"><div><h2>Caja ${T.esc(caja.numero)} <span class="etq ok">Abierta</span></h2><span class="suave">Abrió ${T.esc(caja.usuario)} · ${T.fechaHora(caja.apertura)}</span></div>
          <div class="fila">${T.auth.puede('caja.movimientos') ? `<button class="btn" data-m="gasto">Gasto</button><button class="btn" data-m="ingreso">Ingreso</button><button class="btn" data-m="retiro">Retiro</button>` : ''}<button class="btn pri" id="cerrar">Cerrar caja</button></div></div>
          <div class="rejilla dos"><div class="tarjeta"><h4>Efectivo</h4>${cuadro(caja, r)}</div><div class="tarjeta"><h4>Ventas por medio de pago</h4>${medios(r)}${r.abonos ? `<p class="suave" style="margin-top:8px">Abonos de fiados recibidos: ${T.money(r.abonos)}</p>` : ''}</div></div>
          <h3 style="margin:8px 0 10px">Movimientos del turno</h3>${T.tabla([{ t: 'Hora', v: m => T.hora(m.fecha) }, { t: 'Tipo', v: m => `<span class="etq ${m.tipo === 'ingreso' ? 'ok' : 'aviso'}">${TIPOS_CAJA[m.tipo]}</span>` }, { t: 'Concepto', v: m => T.esc(m.concepto) }, { t: 'Valor', cls: 'der num', v: m => T.money(m.monto) }, { t: 'Usuario', v: m => T.esc(m.usuario) }], r.movs, 'Sin gastos, ingresos ni retiros en este turno.')}
          <div id="hist">${tablaHist}</div>`;
        T.$$('[data-m]', el).forEach(b => b.onclick = async () => {
          const tipo = b.dataset.m, v = await T.pedir({
            titulo: { gasto: 'Registrar gasto', ingreso: 'Registrar ingreso', retiro: 'Retiro de efectivo' }[tipo], ancho: 400, campos: [
              { id: 'concepto', label: 'Concepto', req: true, ph: { gasto: 'Ej: bolsas, domicilio, almuerzo', ingreso: 'Ej: cambio que trajo el dueño', retiro: 'Ej: consignación al banco' }[tipo] }, { id: 'monto', label: 'Valor', tipo: 'number', req: true }],
            validar: v => T.neg.movCaja({ tipo, ...v })
          });
          if (v) this.render(el);
        });
        T.$('#cerrar', el).onclick = async () => {
          const act = await T.neg.resumenCaja(caja);
          const v = await T.pedir({
            titulo: 'Cerrar caja', ok: 'Cerrar caja', ancho: 420, nota: 'Cuente todo el efectivo que hay en el cajón (incluida la base) y escríbalo. El sistema le dice si cuadra.', campos: [
              { id: 'contado', label: 'Efectivo contado', tipo: 'number', req: true }, { id: 'nota', label: 'Nota (opcional)', tipo: 'textarea' }],
            validar: async v => {
              const dif = T.red(v.contado) - act.esperado;
              if (dif !== 0 && !await T.confirmar(`${dif < 0 ? 'FALTAN' : 'SOBRAN'} ${T.money(Math.abs(dif))}.\nDebe haber ${T.money(act.esperado)} y contó ${T.money(v.contado)}.\n\n¿Cerrar así? Quedará registrado.`, { ok: 'Cerrar con diferencia', peligro: true })) throw new Error('Vuelva a contar el efectivo');
            }
          });
          if (!v) return;
          try { const c = await T.neg.cerrarCaja(v.contado, v.nota); await this.render(el); T.ui.verCierre(c); } catch (e) { T.toast(e.message, 'error'); }
        };
      }
      T.$('#hist', el).onclick = e => { const b = e.target.closest('[data-c]'); if (b) T.ui.verCierre(T.db.get('cajas', b.dataset.c)); };
    }
  };
})(window.T);
