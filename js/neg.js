'use strict';
// ════════════════════════════════════════════════════════════════════
// LÓGICA DEL NEGOCIO — toda operación que mueve dinero o inventario.
// Cada función valida las reglas, guarda todo en una sola transacción
// y deja su registro en la bitácora. Las pantallas nunca escriben
// directamente en ventas, movimientos, cajas ni saldos.
// ════════════════════════════════════════════════════════════════════
(function (T) {
  const D = () => T.db, quien = () => ({ usuario: T.auth.usuario.nombre, usuarioId: T.auth.usuario.id, dispositivo: T.db.loc('dispositivo') });

  // Cada equipo numera por su cuenta (funciona sin internet). Para que dos equipos no repitan
  // número, cada uno recibe una letra propia (A, B, C…) anotada en la configuración compartida.
  async function letraEquipo() {
    const equipos = D().cfg('equipos', {}), yo = D().loc('dispositivo');
    if (!equipos[yo]) {
      const usadas = new Set(Object.values(equipos));
      let i = 0, l;
      do { l = (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : '') + String.fromCharCode(65 + i % 26); i++; } while (usadas.has(l));
      await D().lote([{ s: 'config', r: { id: 'equipos', valor: { ...equipos, [yo]: l } } }]);
    }
    return D().cfg('equipos')[yo];
  }
  async function consecutivo(clave, tipo) {
    const letra = await letraEquipo(), n = D().loc(clave, 0) + 1;
    await D().setLoc(clave, n);   // se guarda antes: puede quedar un salto, nunca un número repetido
    return `${tipo}${letra}-${String(n).padStart(5, '0')}`;
  }

  // Movimiento de kárdex: ÚNICA forma de cambiar existencias. Modifica p.stock.
  function movOp(p, tipo, cantidad, costo, ref, nota) {
    p.stock = T.r3((p.stock || 0) + cantidad);
    return { s: 'movimientos', r: { id: T.uid(), fecha: Date.now(), productoId: p.id, nombre: p.nombre, tipo, cantidad: T.r3(cantidad), costo: costo || 0, saldo: p.stock, ref: ref || '', nota: nota || '', ...quien() } };
  }

  function validarProducto(p, otros = []) {
    if (!p.nombre) throw new Error('El producto necesita un nombre');
    if (p.precio < 0 || p.costo < 0) throw new Error(`"${p.nombre}": precio y costo no pueden ser negativos`);
    if (T.regla('bloquearBajoCosto') && p.costo > 0 && p.precio < p.costo)
      throw new Error(`"${p.nombre}": el precio (${T.money(p.precio)}) es menor que el costo (${T.money(p.costo)})`);
    if (p.codigo && [...D().lista('productos'), ...otros].some(x => x.codigo === p.codigo && x.id !== p.id))
      throw new Error(`El código ${p.codigo} ya lo tiene otro producto`);
  }

  const cambios = (a, b, omitir = ['foto', 'actualizado', 'creado']) => {
    const d = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!omitir.includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k])) d[k] = [a[k] ?? null, b[k] ?? null];
    return d;
  };

  T.neg = {
    cajaAbierta() { const d = D().loc('dispositivo'); return D().lista('cajas').find(c => c.estado === 'abierta' && c.dispositivo === d) || null; },
    exigirCaja() {
      const c = this.cajaAbierta();
      if (!c && T.regla('cajaObligatoria')) throw new Error('Primero abra la caja');
      return c;
    },
    // De la caja no puede salir más efectivo del que el sistema sabe que hay.
    async exigirEfectivo(caja, monto) {
      const hay = (await this.resumenCaja(caja)).esperado;
      if (monto > hay) throw new Error(`En la caja solo hay ${T.money(hay)} en efectivo; no alcanza para sacar ${T.money(monto)}`);
    },
    buscarCodigo: cod => cod ? D().lista('productos').find(p => p.codigo === cod && p.activo !== false) || null : null,
    precioSugerido: costo => { const r = T.regla('redondeo') || 1; return Math.ceil(costo * (1 + T.regla('margenDefecto') / 100) / r) * r; },

    // ── Productos ──
    async guardarProducto(d, stockInicial = 0) {
      T.auth.exigir('inventario.editar');
      const ant = d.id ? D().get('productos', d.id) : null;
      const p = { ...(ant || { id: T.uid(), stock: 0, activo: true }), ...d };
      p.stock = ant ? ant.stock : 0;   // las existencias solo cambian por kárdex
      p.nombre = (p.nombre || '').trim(); p.codigo = (p.codigo || '').trim();
      validarProducto(p);
      const ops = [{ s: 'productos', r: p }];
      if (!ant && stockInicial > 0) ops.push(movOp(p, 'inicial', stockInicial, p.costo, '', 'Existencia inicial'));
      ops.push(T.aud(ant ? 'producto.editar' : 'producto.crear', p.nombre, ant ? cambios(ant, p) : { codigo: p.codigo, costo: p.costo, precio: p.precio, stock: p.stock }));
      await D().lote(ops);
      return p;
    },
    async borrarProducto(id) {
      T.auth.exigir('inventario.editar');
      const p = { ...D().get('productos', id), _borrado: true, activo: false };
      if (p.stock > 0) throw new Error('El producto aún tiene existencias. Ajústelas a cero primero.');
      await D().lote([{ s: 'productos', r: p }, T.aud('producto.borrar', p.nombre, { codigo: p.codigo })]);
    },
    // tipo: ajuste (conteo), merma (daño/vencido), entrada (ingreso sin compra)
    async ajustarStock(id, nuevaCantidad, tipo, motivo) {
      T.auth.exigir('inventario.ajustar');
      if (!motivo) throw new Error('Escriba el motivo del ajuste');
      const p = { ...D().get('productos', id) }, antes = p.stock || 0, delta = T.r3(nuevaCantidad - antes);
      if (nuevaCantidad < 0) throw new Error('Las existencias no pueden quedar negativas');
      if (!delta) return p;
      await D().lote([movOp(p, tipo, delta, p.costo, '', motivo), { s: 'productos', r: p }, T.aud('inventario.' + tipo, p.nombre, { antes, despues: p.stock, motivo })]);
      return p;
    },

    // ── Ventas ──
    // items: [{productoId, cantidad, precio, descuento}]  pagos: [{metodo, monto}] (montos aplicados; suman el total)
    calcular(items) {
      let subtotal = 0, descuento = 0;
      for (const it of items) {
        const bruto = T.red(it.precio * it.cantidad);
        subtotal += bruto; descuento += Math.min(bruto, T.red(it.descuento || 0));
      }
      const neto = subtotal - descuento, r = T.regla('redondeo');
      const total = r > 1 ? Math.round(neto / r) * r : neto;
      return { subtotal, descuento, ajuste: total - neto, total };
    },

    async venta({ items, pagos, clienteId, recibido, nota, autoriza, sinStock, sinCupo }) {
      T.auth.exigir('ventas.crear');
      const caja = this.exigirCaja();
      if (!items || !items.length) throw new Error('La venta no tiene productos');
      const prods = new Map(), lineas = [], hoy = T.dia();
      let impuesto = 0, costo = 0;
      for (const it of items) {
        let p = prods.get(it.productoId);
        if (!p) {
          const o = D().get('productos', it.productoId);
          if (!o || o._borrado) throw new Error('Un producto de la venta ya no existe');
          prods.set(o.id, p = { ...o, _vend: 0 });
        }
        const cant = T.r3(it.cantidad);
        if (!(cant > 0)) throw new Error(`Cantidad inválida en "${p.nombre}"`);
        if (!(it.precio >= 0)) throw new Error(`Precio inválido en "${p.nombre}"`);
        p._vend += cant;
        if (!T.regla('venderSinStock') && !sinStock && (p.stock || 0) < p._vend) throw new Error(`No hay suficiente "${p.nombre}" (quedan ${T.cant(p.stock)})`);
        if (T.regla('bloquearVencidos') && p.vence && p.vence < hoy) throw new Error(`"${p.nombre}" está vencido (${T.fechaCorta(p.vence)})`);
        const bruto = T.red(it.precio * cant), desc = Math.min(bruto, T.red(it.descuento || 0)), tot = bruto - desc;
        if (p.iva) impuesto += T.red(tot - tot / (1 + p.iva / 100));
        costo += T.red((p.costo || 0) * cant);
        lineas.push({ productoId: p.id, nombre: p.nombre, codigo: p.codigo || '', unidad: p.unidad || 'und', cantidad: cant, precio: it.precio, costo: p.costo || 0, iva: p.iva || 0, descuento: desc, total: tot });
      }
      const tot = this.calcular(items);
      pagos = (pagos || []).filter(x => x.monto > 0).map(x => ({ metodo: x.metodo, monto: T.red(x.monto) }));
      if (pagos.some(x => !T.METODOS[x.metodo])) throw new Error('Medio de pago desconocido');
      if (pagos.reduce((a, x) => a + x.monto, 0) !== tot.total) throw new Error('Los pagos no coinciden con el total de la venta');
      const fiado = pagos.filter(x => x.metodo === 'fiado').reduce((a, x) => a + x.monto, 0);
      const efectivo = pagos.filter(x => x.metodo === 'efectivo').reduce((a, x) => a + x.monto, 0);
      let cli = clienteId ? { ...D().get('clientes', clienteId) } : null;
      if (fiado > 0) {
        if (!cli) throw new Error('Para fiar debe elegir un cliente');
        if (T.regla('respetarCupo') && !sinCupo && (cli.saldo || 0) + fiado > (cli.cupo || 0))
          throw new Error(`${cli.nombre} supera su cupo de fiado (${T.money(cli.cupo)}). Debe ${T.money(cli.saldo)}.`);
        cli.saldo = (cli.saldo || 0) + fiado;
      }
      if (recibido != null && recibido < efectivo) throw new Error('El efectivo recibido no alcanza');

      const numero = await consecutivo('nVenta', 'V');
      const ops = [];
      lineas.forEach(l => ops.push(movOp(prods.get(l.productoId), 'venta', -l.cantidad, l.costo, numero)));
      prods.forEach(p => { delete p._vend; ops.push({ s: 'productos', r: p }); });
      const v = {
        id: T.uid(), numero, fecha: Date.now(), items: lineas, ...tot, impuesto, costo, pagos, fiado,
        recibido: recibido ?? efectivo, cambio: (recibido ?? efectivo) - efectivo,
        clienteId: cli ? cli.id : null, cliente: cli ? cli.nombre : '', cajaId: caja ? caja.id : null,
        estado: 'completada', nota: nota || '', autoriza: autoriza || '', ...quien()
      };
      ops.push({ s: 'ventas', r: v });
      if (fiado > 0) ops.push({ s: 'clientes', r: cli });
      ops.push(T.aud('venta.crear', numero, { total: v.total, productos: lineas.length, pagos, cliente: v.cliente, descuento: v.descuento, autoriza: v.autoriza }));
      await D().lote(ops);
      return v;
    },

    async anularVenta(id, motivo, autoriza) {
      if (!motivo) throw new Error('Escriba el motivo de la anulación');
      const o = await D().leer('ventas', id);
      if (!o || o.estado !== 'completada') throw new Error('La venta ya está anulada');
      const ops = [], prods = new Map(), caja = this.cajaAbierta();
      for (const l of o.items) {
        const orig = D().get('productos', l.productoId);
        if (!orig) continue;
        if (!prods.has(orig.id)) prods.set(orig.id, { ...orig });
        ops.push(movOp(prods.get(orig.id), 'anulacion', l.cantidad, l.costo, o.numero, motivo));
      }
      prods.forEach(p => ops.push({ s: 'productos', r: p }));
      const efectivo = o.pagos.filter(x => x.metodo === 'efectivo').reduce((a, x) => a + x.monto, 0);
      // Si la venta es de un turno ya cerrado, el efectivo devuelto sale de la caja actual.
      if (efectivo > 0 && (!caja || caja.id !== o.cajaId)) {
        if (!caja) throw new Error('Abra la caja para devolver el efectivo de esta venta');
        await this.exigirEfectivo(caja, efectivo);
        ops.push({ s: 'cajaMovs', r: { id: T.uid(), fecha: Date.now(), cajaId: caja.id, tipo: 'devolucion', concepto: `Anulación ${o.numero}`, monto: efectivo, ...quien() } });
      }
      if (o.fiado > 0 && o.clienteId) {
        const c = { ...D().get('clientes', o.clienteId) };
        c.saldo = (c.saldo || 0) - o.fiado; ops.push({ s: 'clientes', r: c });
      }
      const v = { ...o, estado: 'anulada', anulacion: { fecha: Date.now(), usuario: T.auth.usuario.nombre, autoriza: autoriza || '', motivo } };
      ops.push({ s: 'ventas', r: v }, T.aud('venta.anular', o.numero, { total: o.total, motivo, autoriza: autoriza || '' }));
      await D().lote(ops);
      return v;
    },

    // ── Entradas de mercancía ──
    // items: [{productoId | nuevo:{nombre,codigo,categoria,marca,unidad,foto}, cantidad, costo, precio, vence}]
    // esCompra=false → entrada sin factura (conteo inicial o foto de estante).
    // pago: 'caja' (efectivo de la caja) | 'otro' (pagada por fuera) | 'credito' (se le queda debiendo al proveedor)
    async entrada({ items, proveedorId, factura, pago = 'otro', nota, esCompra = true, origen }) {
      T.auth.exigir(esCompra ? 'compras.crear' : 'inventario.editar');
      if (!items.length) throw new Error('No hay productos para ingresar');
      const caja = pago === 'caja' ? this.cajaAbierta() : null;
      if (esCompra && pago === 'caja' && !caja) throw new Error('Para pagar con la caja primero debe abrirla');
      const prov = proveedorId ? D().get('proveedores', proveedorId) : null;
      const numero = esCompra ? await consecutivo('nCompra', 'C') : '';
      const prods = new Map(), nuevos = [], lineas = [], ops = [];
      let total = 0;
      for (const it of items) {
        const cant = T.r3(it.cantidad), costo = T.red(it.costo);
        let p;
        if (it.productoId) {
          p = prods.get(it.productoId);
          if (!p) { const o = D().get('productos', it.productoId); if (!o) throw new Error('Producto no encontrado'); prods.set(o.id, p = { ...o }); }
        } else {
          p = { id: T.uid(), stock: 0, activo: true, costo: 0, precio: 0, iva: 0, stockMin: 0, unidad: 'und', ...it.nuevo };
          p.nombre = (p.nombre || '').trim(); p.codigo = (p.codigo || '').trim();
          prods.set(p.id, p); nuevos.push(p);
        }
        if (!(cant > 0)) throw new Error(`Cantidad inválida en "${p.nombre}"`);
        if (costo < 0) throw new Error(`Costo inválido en "${p.nombre}"`);
        if (costo > 0) p.costo = T.regla('costoPromedio') && p.stock > 0 && p.costo > 0 ? T.red((p.stock * p.costo + cant * costo) / (p.stock + cant)) : costo;
        if (it.precio > 0) p.precio = T.red(it.precio);
        if (it.vence) p.vence = it.vence;
        if (prov) p.proveedorId = prov.id;
        validarProducto(p, nuevos);
        ops.push(movOp(p, esCompra ? 'compra' : nuevos.includes(p) ? 'inicial' : 'entrada', cant, costo, numero, nota));
        lineas.push({ productoId: p.id, nombre: p.nombre, cantidad: cant, costo, total: T.red(cant * costo) });
        total += T.red(cant * costo);
      }
      prods.forEach(p => ops.push({ s: 'productos', r: p }));
      let c = null;
      if (esCompra) {
        const pagado = pago === 'credito' ? 0 : total;
        c = { id: T.uid(), numero, fecha: Date.now(), proveedorId: prov ? prov.id : null, proveedor: prov ? prov.nombre : '', factura: factura || '', items: lineas, total, pagado, saldo: total - pagado, pago, nota: nota || '', estado: 'registrada', ...quien() };
        ops.push({ s: 'compras', r: c });
        if (pago === 'caja' && total > 0) await this.exigirEfectivo(caja, total);
        if (pago === 'caja' && total > 0) ops.push({ s: 'cajaMovs', r: { id: T.uid(), fecha: Date.now(), cajaId: caja.id, tipo: 'compra', concepto: `Compra ${numero}${prov ? ' · ' + prov.nombre : ''}`, monto: total, ...quien() } });
      }
      ops.push(T.aud(esCompra ? 'compra.crear' : 'inventario.entrada', numero || (origen || 'manual'), { productos: lineas.map(l => `${l.cantidad} × ${l.nombre}`), nuevos: nuevos.length, total, proveedor: prov ? prov.nombre : '', pago: esCompra ? pago : '', origen: origen || 'manual' }));
      await D().lote(ops);
      return { compra: c, productos: prods.size, nuevos: nuevos.length, total };
    },

    async pagarCompra(id, monto, deCaja) {
      T.auth.exigir('compras.crear');
      const o = await D().leer('compras', id);
      if (!(monto > 0) || monto > o.saldo) throw new Error('El pago debe ser mayor que cero y no superar lo que se debe');
      const caja = deCaja ? this.cajaAbierta() : null;
      if (deCaja && !caja) throw new Error('Para pagar con la caja primero debe abrirla');
      if (deCaja) await this.exigirEfectivo(caja, monto);
      const c = { ...o, pagado: o.pagado + monto, saldo: o.saldo - monto };
      const ops = [{ s: 'compras', r: c }];
      if (deCaja) ops.push({ s: 'cajaMovs', r: { id: T.uid(), fecha: Date.now(), cajaId: caja.id, tipo: 'compra', concepto: `Pago compra ${c.numero}${c.proveedor ? ' · ' + c.proveedor : ''}`, monto, ...quien() } });
      ops.push(T.aud('compra.pagar', c.numero, { monto, deCaja: !!deCaja, saldo: c.saldo }));
      await D().lote(ops);
    },

    async guardarProveedor(d) {
      T.auth.exigir('compras.crear');
      if (!d.nombre) throw new Error('El proveedor necesita nombre');
      const ant = d.id ? D().get('proveedores', d.id) : null, p = { ...(ant || { id: T.uid() }), ...d };
      await D().lote([{ s: 'proveedores', r: p }, T.aud(ant ? 'proveedor.editar' : 'proveedor.crear', p.nombre, ant ? cambios(ant, p) : null)]);
      return p;
    },

    // ── Clientes y fiados ──
    async guardarCliente(d) {
      T.auth.exigir('clientes.editar');
      if (!d.nombre) throw new Error('El cliente necesita nombre');
      const ant = d.id ? D().get('clientes', d.id) : null;
      const c = { ...(ant || { id: T.uid(), saldo: 0 }), ...d };
      c.saldo = ant ? ant.saldo || 0 : 0;   // el saldo solo cambia con ventas fiadas y abonos
      if (ant && (ant.cupo || 0) !== (c.cupo || 0)) T.auth.exigir('clientes.cupo');
      await D().lote([{ s: 'clientes', r: c }, T.aud(ant ? 'cliente.editar' : 'cliente.crear', c.nombre, ant ? cambios(ant, c) : { cupo: c.cupo })]);
      return c;
    },
    async abono({ clienteId, monto, metodo, nota }) {
      T.auth.exigir('abonos.crear');
      const caja = this.exigirCaja(), c = { ...D().get('clientes', clienteId) };
      monto = T.red(monto);
      if (!(monto > 0)) throw new Error('El abono debe ser mayor que cero');
      if (monto > (c.saldo || 0)) throw new Error(`${c.nombre} solo debe ${T.money(c.saldo)}`);
      if (!T.METODOS[metodo] || metodo === 'fiado') throw new Error('Medio de pago inválido');
      c.saldo -= monto;
      const a = { id: T.uid(), fecha: Date.now(), clienteId, cliente: c.nombre, monto, metodo, nota: nota || '', saldo: c.saldo, cajaId: caja ? caja.id : null, ...quien() };
      await D().lote([{ s: 'abonos', r: a }, { s: 'clientes', r: c }, T.aud('abono.crear', c.nombre, { monto, metodo, saldo: c.saldo })]);
      return a;
    },

    // ── Caja ──
    async abrirCaja(base) {
      T.auth.exigir('caja.operar');
      if (this.cajaAbierta()) throw new Error('Ya hay una caja abierta en este equipo');
      if (!(base >= 0)) throw new Error('Base inválida');
      const c = { id: T.uid(), numero: await consecutivo('nCaja', 'T'), apertura: Date.now(), base: T.red(base), estado: 'abierta', ...quien() };
      await D().lote([{ s: 'cajas', r: c }, T.aud('caja.abrir', c.numero, { base: c.base })]);
      return c;
    },
    async movCaja({ tipo, concepto, monto }) {
      T.auth.exigir('caja.movimientos');
      const caja = this.cajaAbierta();
      if (!caja) throw new Error('Primero abra la caja');
      if (!['gasto', 'ingreso', 'retiro'].includes(tipo)) throw new Error('Tipo de movimiento inválido');
      if (!(monto > 0) || !concepto) throw new Error('Escriba el concepto y un valor mayor que cero');
      if (tipo !== 'ingreso') await this.exigirEfectivo(caja, monto);
      const m = { id: T.uid(), fecha: Date.now(), cajaId: caja.id, tipo, concepto, monto: T.red(monto), ...quien() };
      await D().lote([{ s: 'cajaMovs', r: m }, T.aud('caja.' + tipo, caja.numero, { concepto, monto: m.monto })]);
      return m;
    },
    async resumenCaja(caja) {
      const [ventas, abonos, movs] = await Promise.all([D().porIndice('ventas', 'cajaId', caja.id), D().porIndice('abonos', 'cajaId', caja.id), D().porIndice('cajaMovs', 'cajaId', caja.id)]);
      const r = { ventas: 0, anuladas: 0, total: 0, costo: 0, porMetodo: {}, abonos: 0, abonosPorMetodo: {}, ingreso: 0, gasto: 0, retiro: 0, devolucion: 0, compra: 0, movs: movs.sort((a, b) => a.fecha - b.fecha) };
      for (const v of ventas) {
        if (v.estado !== 'completada') { r.anuladas++; continue; }
        r.ventas++; r.total += v.total; r.costo += v.costo || 0;
        v.pagos.forEach(p => { r.porMetodo[p.metodo] = (r.porMetodo[p.metodo] || 0) + p.monto; });
      }
      abonos.forEach(a => { r.abonos += a.monto; r.abonosPorMetodo[a.metodo] = (r.abonosPorMetodo[a.metodo] || 0) + a.monto; });
      movs.forEach(m => { r[m.tipo] = (r[m.tipo] || 0) + m.monto; });
      r.esperado = caja.base + (r.porMetodo.efectivo || 0) + (r.abonosPorMetodo.efectivo || 0) + r.ingreso - r.gasto - r.retiro - r.devolucion - r.compra;
      return r;
    },
    async cerrarCaja(contado, nota) {
      T.auth.exigir('caja.operar');
      const o = this.cajaAbierta();
      if (!o) throw new Error('No hay caja abierta');
      if (!(contado >= 0)) throw new Error('Escriba cuánto efectivo contó');
      const r = await this.resumenCaja(o); delete r.movs;
      const c = { ...o, estado: 'cerrada', cierre: Date.now(), contado: T.red(contado), diferencia: T.red(contado) - r.esperado, resumen: r, nota: nota || '', cerro: T.auth.usuario.nombre };
      await D().lote([{ s: 'cajas', r: c }, T.aud('caja.cerrar', c.numero, { esperado: r.esperado, contado: c.contado, diferencia: c.diferencia, ventas: r.total })]);
      T.emit('cajaCerrada', c);
      return c;
    },

    // ── Recalcular desde los movimientos (tras sincronizar o restaurar) ──
    // Las existencias y los saldos son derivados: así dos equipos que vendieron
    // al tiempo terminan con el mismo número, sin pisarse.
    async recalcularStock(ids) {
      const ops = [];
      for (const id of ids) {
        const p = D().get('productos', id);
        if (!p) continue;
        const movs = await D().porIndice('movimientos', 'productoId', id);
        if (!movs.length) continue;
        const stock = T.r3(movs.reduce((a, m) => a + m.cantidad, 0));
        if (stock !== p.stock) ops.push({ s: 'productos', r: { ...p, stock } });
      }
      await D().lote(ops, { remoto: true });
    },
    async recalcularSaldos(ids) {
      const ops = [];
      for (const id of ids) {
        const c = D().get('clientes', id);
        if (!c) continue;
        const [ventas, abonos] = await Promise.all([D().porIndice('ventas', 'clienteId', id), D().porIndice('abonos', 'clienteId', id)]);
        const saldo = ventas.filter(v => v.estado === 'completada').reduce((a, v) => a + (v.fiado || 0), 0) - abonos.reduce((a, x) => a + x.monto, 0);
        if (saldo !== (c.saldo || 0)) ops.push({ s: 'clientes', r: { ...c, saldo } });
      }
      await D().lote(ops, { remoto: true });
    },

    // ── Consultas para tablero, reportes e IA ──
    alertas() {
      const prods = D().lista('productos').filter(p => p.activo !== false), hoy = T.dia(), lim = T.dia(Date.now() + T.regla('diasVence') * 86400000);
      return {
        agotados: prods.filter(p => (p.stock || 0) <= 0),
        bajos: prods.filter(p => p.stock > 0 && p.stockMin > 0 && p.stock <= p.stockMin),
        vencidos: prods.filter(p => p.vence && p.vence < hoy && p.stock > 0),
        porVencer: prods.filter(p => p.vence && p.vence >= hoy && p.vence <= lim && p.stock > 0)
      };
    },
    async resumen(desde, hasta) {
      const [ventas, movs, abonos] = await Promise.all([D().rango('ventas', 'fecha', desde, hasta), D().rango('cajaMovs', 'fecha', desde, hasta), D().rango('abonos', 'fecha', desde, hasta)]);
      const r = { ventas: [], n: 0, anuladas: 0, total: 0, costo: 0, descuento: 0, impuesto: 0, fiado: 0, gastos: 0, abonos: 0, porMetodo: {}, porDia: {}, porCategoria: {}, porUsuario: {}, productos: {} };
      for (const v of ventas) {
        r.ventas.push(v);
        if (v.estado !== 'completada') { r.anuladas++; continue; }
        r.n++; r.total += v.total; r.costo += v.costo || 0; r.descuento += v.descuento || 0; r.impuesto += v.impuesto || 0; r.fiado += v.fiado || 0;
        v.pagos.forEach(p => { r.porMetodo[p.metodo] = (r.porMetodo[p.metodo] || 0) + p.monto; });
        const d = T.dia(v.fecha); r.porDia[d] = (r.porDia[d] || 0) + v.total;
        r.porUsuario[v.usuario] = (r.porUsuario[v.usuario] || 0) + v.total;
        for (const l of v.items) {
          const p = D().get('productos', l.productoId), cat = (p && p.categoria) || 'Sin categoría';
          r.porCategoria[cat] = (r.porCategoria[cat] || 0) + l.total;
          const x = r.productos[l.productoId] = r.productos[l.productoId] || { nombre: l.nombre, cantidad: 0, total: 0, utilidad: 0 };
          x.cantidad = T.r3(x.cantidad + l.cantidad); x.total += l.total; x.utilidad += l.total - T.red(l.costo * l.cantidad);
        }
      }
      movs.forEach(m => { if (m.tipo === 'gasto') r.gastos += m.monto; });
      abonos.forEach(a => { r.abonos += a.monto; });
      r.utilidad = r.total - r.costo;
      r.ventas.sort((a, b) => b.fecha - a.fecha);
      return r;
    }
  };
})(window.T);
