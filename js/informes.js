'use strict';
// ════════════════════════════════════════════════════════════════════
// INFORMES PARA IMPRIMIR O GUARDAR EN PDF
// Documentos tamaño carta con el encabezado de la tienda. Se abren con la
// ventana de impresión del navegador: ahí se elige la impresora o
// "Guardar como PDF" (el nombre del archivo ya viene puesto).
// ════════════════════════════════════════════════════════════════════
(function (T) {
  const esc = T.esc, pct = (v, total) => total ? T.num(v / total * 100, 1) + '%' : '—';

  // cols: [{t: título, v: fila => html, cls: 'der' | 'centro'}]
  // Una fila con _grupo es un título de grupo; con _sub, una fila de subtotal ya armada (celdas).
  T.tablaInf = (cols, filas, { vacio = 'Sin registros.', totales } = {}) => filas.length
    ? `<table class="inf-tabla"><thead><tr>${cols.map(c => `<th class="${c.cls || ''}">${c.t}</th>`).join('')}</tr></thead><tbody>
      ${filas.map(f => f._grupo ? `<tr class="grupo"><td colspan="${cols.length}">${esc(f._grupo)}</td></tr>`
        : f._sub ? `<tr class="sub">${f._sub.map((x, i) => `<td class="${cols[i].cls || ''}">${x ?? ''}</td>`).join('')}</tr>`
          : `<tr>${cols.map(c => `<td class="${c.cls || ''}">${c.v(f)}</td>`).join('')}</tr>`).join('')}</tbody>
      ${totales ? `<tfoot><tr>${totales.map((x, i) => `<td class="${cols[i].cls || ''}">${x ?? ''}</td>`).join('')}</tr></tfoot>` : ''}</table>`
    : `<p class="inf-vacio">${esc(vacio)}</p>`;

  // Tabla de reparto (medios de pago, categorías, vendedores) con su porcentaje.
  const reparto = (titulo, obj, nombre = k => k) => {
    const filas = Object.entries(obj).filter(([, v]) => v).sort((a, b) => b[1] - a[1]), total = filas.reduce((a, [, v]) => a + v, 0);
    return T.tablaInf([{ t: titulo, v: ([k]) => esc(nombre(k)) }, { t: 'Valor', cls: 'der', v: ([, v]) => T.money(v) }, { t: '%', cls: 'der', v: ([, v]) => pct(v, total) }],
      filas, { vacio: 'Sin datos en este periodo.', totales: ['Total', T.money(total), filas.length ? '100%' : ''] });
  };

  // ── Documento base ──
  // datos: [[etiqueta, valor html]]  kpis: [[etiqueta, valor html, nota html]]  secciones: [{titulo, html, cls}]
  T.informe = ({ titulo, sub = '', datos = [], kpis = [], secciones = [], nombre }) => {
    const n = T.db.cfg('negocio', {}), u = T.auth.usuario;
    T.imprimir(`<article class="informe">
      <header class="inf-cab">
        <div class="inf-negocio">${T.marca()}<div><b>${esc(n.nombre || 'Tienda')}</b><span>${[n.nit && 'NIT ' + n.nit, n.direccion, n.telefono && 'Tel. ' + n.telefono].filter(Boolean).map(esc).join(' · ')}</span></div></div>
        <div class="inf-titulo"><h1>${esc(titulo)}</h1>${sub ? `<span>${esc(sub)}</span>` : ''}</div>
      </header>
      ${datos.length ? `<dl class="inf-datos">${datos.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}
      ${kpis.length ? `<div class="inf-kpis">${kpis.map(([k, v, nota]) => `<div><span>${esc(k)}</span><b>${v}</b>${nota ? `<small>${nota}</small>` : ''}</div>`).join('')}</div>` : ''}
      ${secciones.filter(Boolean).map(s => `<section class="inf-sec ${s.cls || ''}">${s.titulo ? `<h2>${esc(s.titulo)}</h2>` : ''}${s.html}</section>`).join('')}
      <footer class="inf-pie"><span>Generado el ${T.fechaHora(Date.now())}${u ? ' por ' + esc(u.nombre) : ''}</span><span>${esc(n.nombre || 'Tienda')} · Tienda Eben-Ezer ${T.VERSION}</span></footer>
    </article>`, nombre || titulo);
  };

  const rango = (desde, hasta) => desde === hasta ? T.fechaCorta(desde) : `${T.fechaCorta(desde)} al ${T.fechaCorta(hasta)}`;

  T.informes = {
    // ── Ventas de un periodo ──
    async ventas(desde, hasta, { recibos = false } = {}) {
      const r = await T.neg.resumen(T.iniDia(desde), T.finDia(hasta)), util = T.auth.puede('utilidad.ver');
      const dias = Object.keys(r.porDia).sort(), productos = Object.values(r.productos).sort((a, b) => b.total - a.total);
      const ventasOk = r.ventas.filter(v => v.estado === 'completada');
      T.informe({
        titulo: 'Informe de ventas', sub: rango(desde, hasta), nombre: `Ventas ${desde}${desde === hasta ? '' : ' a ' + hasta}`,
        kpis: [
          ['Ventas netas', T.money(r.total), `${r.n} tiquete${r.n === 1 ? '' : 's'}`],
          ['Tiquete promedio', T.money(r.n ? r.total / r.n : 0), dias.length > 1 ? `${T.money(r.total / dias.length)} por día` : ''],
          ...(util ? [['Utilidad bruta', T.money(r.utilidad), `${pct(r.utilidad, r.total)} de margen`], ['Gastos de caja', T.money(r.gastos), `Queda ${T.money(r.utilidad - r.gastos)}`]] : []),
          ['Fiado', T.money(r.fiado), `Abonos recibidos ${T.money(r.abonos)}`]
        ],
        secciones: [
          dias.length > 1 && {
            titulo: 'Ventas por día', html: T.tablaInf([{ t: 'Día', v: d => esc(new Date(T.iniDia(d)).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })) }, { t: 'Tiquetes', cls: 'der', v: d => r.porDiaN[d] || 0 }, { t: 'Ventas', cls: 'der', v: d => T.money(r.porDia[d]) }, { t: '%', cls: 'der', v: d => pct(r.porDia[d], r.total) }],
              dias, { totales: [`${dias.length} días`, r.n, T.money(r.total), '100%'] })
          },
          { cls: 'col', titulo: 'Por medio de pago', html: reparto('Medio', r.porMetodo, k => T.METODOS[k] || k) },
          { cls: 'col', titulo: 'Por vendedor', html: reparto('Vendedor', r.porUsuario) },
          { titulo: 'Por categoría', html: reparto('Categoría', r.porCategoria) },
          {
            titulo: `Productos vendidos (${productos.length})`, html: T.tablaInf([
              { t: '#', cls: 'centro', v: p => productos.indexOf(p) + 1 }, { t: 'Producto', v: p => esc(p.nombre) }, { t: 'Cantidad', cls: 'der', v: p => T.cant(p.cantidad) }, { t: 'Ventas', cls: 'der', v: p => T.money(p.total) },
              ...(util ? [{ t: 'Utilidad', cls: 'der', v: p => T.money(p.utilidad) }, { t: 'Margen', cls: 'der', v: p => pct(p.utilidad, p.total) }] : [])
            ], productos, { vacio: 'No hubo ventas en este periodo.', totales: ['', 'Total', '', T.money(r.total), ...(util ? [T.money(r.utilidad), pct(r.utilidad, r.total)] : [])] })
          },
          {
            titulo: 'Otros datos', html: T.tablaInf([{ t: 'Concepto', v: x => x[0] }, { t: 'Valor', cls: 'der', v: x => x[1] }], [
              ['Descuentos dados', T.money(r.descuento)], ['Devoluciones', T.money(r.devuelto)], ['Ventas anuladas', `${r.anuladas}`], ['IVA incluido en las ventas', T.money(r.impuesto)]])
          },
          recibos && {
            titulo: `Recibos (${r.ventas.length})`, html: T.tablaInf([
              { t: 'Recibo', v: v => esc(v.numero) }, { t: 'Fecha', v: v => T.fechaHora(v.fecha) }, { t: 'Vendedor', v: v => esc(v.usuario) }, { t: 'Cliente', v: v => esc(v.cliente || '—') },
              { t: 'Pago', v: v => v.pagos.map(p => T.METODOS[p.metodo]).join(' + ') }, { t: 'Total', cls: 'der', v: v => v.estado === 'anulada' ? `<s>${T.money(v.total)}</s> anulada` : T.money(v.total - (v.devuelto || 0)) }
            ], r.ventas.slice().sort((a, b) => a.fecha - b.fecha), { totales: ['', '', '', '', `${ventasOk.length} válidas`, T.money(r.total)] })
          }
        ]
      });
    },

    // ── Inventario valorizado (la lista que se ve en pantalla, agrupada por categoría) ──
    inventario(lista, filtro) {
      const util = T.auth.puede('utilidad.ver'), grupos = new Map();
      lista.slice().sort((a, b) => (a.categoria || 'zzz').localeCompare(b.categoria || 'zzz', 'es') || a.nombre.localeCompare(b.nombre, 'es'))
        .forEach(p => { const k = p.categoria || 'Sin categoría'; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(p); });
      const vc = p => Math.max(0, p.stock || 0) * (p.costo || 0), vv = p => Math.max(0, p.stock || 0) * (p.precio || 0);
      const suma = (arr, f) => arr.reduce((a, p) => a + f(p), 0), filas = [];
      grupos.forEach((ps, k) => {
        filas.push({ _grupo: `${k} (${ps.length})` }, ...ps);
        if (grupos.size > 1) filas.push({ _sub: ['', 'Subtotal ' + k, T.cant(suma(ps, p => Math.max(0, p.stock || 0))), ...(util ? ['', T.money(suma(ps, vc))] : []), '', T.money(suma(ps, vv))] });
      });
      const totC = suma(lista, vc), totV = suma(lista, vv);
      T.informe({
        titulo: 'Inventario valorizado', sub: `Corte al ${T.fechaHora(Date.now())}${filtro ? ' · ' + filtro : ''}`, nombre: `Inventario ${T.dia()}`,
        kpis: [['Productos', T.num(lista.length), `${lista.filter(p => p.stock <= 0).length} agotado(s)`], ['Unidades', T.cant(suma(lista, p => Math.max(0, p.stock || 0))), ''],
          ...(util ? [['Valor a costo', T.money(totC), ''], ['Ganancia esperada', T.money(totV - totC), pct(totV - totC, totV) + ' de margen']] : []), ['Valor a precio de venta', T.money(totV), '']],
        secciones: [{
          html: T.tablaInf([
            { t: 'Código', v: p => esc(p.codigo || '') }, { t: 'Producto', v: p => esc(p.nombre) + (p.vence ? ` <small>· vence ${T.fechaCorta(p.vence)}</small>` : '') }, { t: 'Existencias', cls: 'der', v: p => T.cant(p.stock) + (p.unidad && p.unidad !== 'und' ? ' ' + p.unidad : '') },
            ...(util ? [{ t: 'Costo', cls: 'der', v: p => T.money(p.costo) }, { t: 'Valor a costo', cls: 'der', v: p => T.money(vc(p)) }] : []),
            { t: 'Precio', cls: 'der', v: p => T.money(p.precio) }, { t: 'Valor a venta', cls: 'der', v: p => T.money(vv(p)) }
          ], filas, { vacio: 'No hay productos.', totales: ['', 'Total', T.cant(suma(lista, p => Math.max(0, p.stock || 0))), ...(util ? ['', T.money(totC)] : []), '', T.money(totV)] })
        }, { cls: 'firmas', html: '<div>Contó</div><div>Revisó</div>' }]
      });
    },

    // ── Estado de cuenta de un cliente (fiados y abonos, con el saldo después de cada uno) ──
    cuenta(c, ventas, abonos) {
      const movs = [
        ...ventas.filter(v => v.estado === 'completada' && (v.fiado || 0) - (v.fiadoDevuelto || 0) > 0).map(v => ({ fecha: v.fecha, txt: `Compra fiada · recibo ${esc(v.numero)}${v.fiadoDevuelto ? ' (con devolución)' : ''}<small>${v.items.map(l => `${T.cant(l.cantidad - (l.devuelto || 0))} × ${esc(l.nombre)}`).join(' · ')}</small>`, cargo: v.fiado - (v.fiadoDevuelto || 0), abono: 0 })),
        ...abonos.map(a => ({ fecha: a.fecha, txt: `Abono · ${T.METODOS[a.metodo]}${a.nota ? ' · ' + esc(a.nota) : ''}`, cargo: 0, abono: a.monto }))
      ].sort((a, b) => a.fecha - b.fecha);
      let saldo = 0;
      movs.forEach(m => { saldo += m.cargo - m.abono; m.saldo = saldo; });
      const cargos = movs.reduce((a, m) => a + m.cargo, 0), abonado = movs.reduce((a, m) => a + m.abono, 0);
      T.informe({
        titulo: 'Estado de cuenta', sub: c.nombre, nombre: `Estado de cuenta ${c.nombre} ${T.dia()}`,
        datos: [['Cliente', esc(c.nombre)], ['Cédula', esc(c.documento || '—')], ['Celular', esc(c.telefono || '—')], ['Dirección', esc(c.direccion || '—')], ['Cupo de fiado', T.money(c.cupo)], ['Fecha de corte', T.fechaHora(Date.now())]],
        kpis: [['Total fiado', T.money(cargos), `${movs.filter(m => m.cargo).length} compra(s)`], ['Total abonado', T.money(abonado), `${movs.filter(m => m.abono).length} abono(s)`], ['Saldo a la fecha', `<span class="${c.saldo > 0 ? 'inf-debe' : ''}">${T.money(c.saldo)}</span>`, c.saldo > 0 ? 'Valor pendiente por pagar' : 'Al día']],
        secciones: [{
          titulo: 'Movimientos', html: T.tablaInf([{ t: 'Fecha', v: m => T.fechaHora(m.fecha) }, { t: 'Detalle', v: m => m.txt }, { t: 'Cargo', cls: 'der', v: m => m.cargo ? T.money(m.cargo) : '' }, { t: 'Abono', cls: 'der', v: m => m.abono ? T.money(m.abono) : '' }, { t: 'Saldo', cls: 'der', v: m => T.money(m.saldo) }],
            movs, { vacio: 'Este cliente no tiene fiados ni abonos.', totales: ['', 'Totales', T.money(cargos), T.money(abonado), T.money(c.saldo)] })
        }, { cls: 'firmas', html: '<div>Firma del cliente</div><div>Firma de la tienda</div>' }]
      });
    },

    // ── Cartera: clientes que deben ──
    cartera() {
      const deben = T.db.lista('clientes').filter(c => c.saldo > 0).sort((a, b) => b.saldo - a.saldo), total = deben.reduce((a, c) => a + c.saldo, 0);
      T.informe({
        titulo: 'Cartera de clientes', sub: `Clientes con saldo pendiente al ${T.fechaHora(Date.now())}`, nombre: `Cartera ${T.dia()}`,
        kpis: [['Total por cobrar', T.money(total), ''], ['Clientes que deben', String(deben.length), ''], ['Sobre el cupo', String(deben.filter(c => c.saldo > (c.cupo || 0)).length), 'Deben más de lo permitido']],
        secciones: [{
          html: T.tablaInf([{ t: 'Cliente', v: c => esc(c.nombre) }, { t: 'Cédula', v: c => esc(c.documento || '') }, { t: 'Celular', v: c => esc(c.telefono || '') }, { t: 'Cupo', cls: 'der', v: c => T.money(c.cupo) }, { t: 'Debe', cls: 'der', v: c => `<b>${T.money(c.saldo)}</b>${c.saldo > (c.cupo || 0) ? ' <small>sobre el cupo</small>' : ''}` }, { t: '%', cls: 'der', v: c => pct(c.saldo, total) }],
            deben, { vacio: 'Nadie debe.', totales: ['Total', '', '', '', T.money(total), deben.length ? '100%' : ''] })
        }]
      });
    },

    // ── Una compra a proveedor ──
    compra(c) {
      const prov = c.proveedorId && T.db.get('proveedores', c.proveedorId);
      T.informe({
        titulo: `Compra ${c.numero}`, sub: c.proveedor || 'Sin proveedor', nombre: `Compra ${c.numero}${c.factura ? ' factura ' + c.factura : ''}`,
        datos: [['Proveedor', esc(c.proveedor || '—')], ['NIT', esc((prov && prov.nit) || '—')], ['Factura', esc(c.factura || '—')], ['Fecha de registro', T.fechaHora(c.fecha)], ['Registró', esc(c.usuario)],
          ['Pago', { otro: 'Pagada por fuera de la caja', caja: 'Pagada con la caja', credito: 'A crédito' }[c.pago] || '—']],
        kpis: [['Total', T.money(c.total), `${c.items.length} producto(s)`], ['Pagado', T.money(c.pagado), ''], ['Saldo', T.money(c.saldo), c.saldo > 0 ? 'Pendiente con el proveedor' : 'Pagada']],
        secciones: [{ titulo: 'Productos', html: T.tablaInf([{ t: 'Producto', v: l => esc(l.nombre) }, { t: 'Cantidad', cls: 'der', v: l => T.cant(l.cantidad) }, { t: 'Costo c/u', cls: 'der', v: l => T.money(l.costo) }, { t: 'Total', cls: 'der', v: l => T.money(l.total) }], c.items, { totales: ['Total', '', '', T.money(c.total)] }) },
          c.nota && { titulo: 'Nota', html: `<p>${esc(c.nota)}</p>` }]
      });
    }
  };
})(window.T);
