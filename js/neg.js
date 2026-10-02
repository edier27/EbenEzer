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
    // Códigos únicos entre productos y presentaciones (paca, six-pack…).
    const ajenos = new Set();
    for (const x of [...D().lista('productos'), ...otros]) {
      if (x.id === p.id) continue;
      if (x.codigo) ajenos.add(x.codigo);
      (x.presentaciones || []).forEach(pr => { if (pr.codigo) ajenos.add(pr.codigo); });
    }
    if (p.codigo && ajenos.has(p.codigo)) throw new Error(`El código ${p.codigo} ya lo tiene otro producto`);
    const propios = new Set(p.codigo ? [p.codigo] : []);
    for (const pr of p.presentaciones || []) {
      if (!pr.nombre) throw new Error(`"${p.nombre}": cada presentación necesita nombre (ej. Paca x 24)`);
      if (!(pr.factor > 1)) throw new Error(`"${p.nombre}": la presentación "${pr.nombre}" debe traer más de 1 unidad`);
      if (!(pr.precio > 0)) throw new Error(`"${p.nombre}": falta el precio de "${pr.nombre}"`);
      if (T.regla('bloquearBajoCosto') && p.costo > 0 && pr.precio < p.costo * pr.factor)
        throw new Error(`"${p.nombre}": el precio de "${pr.nombre}" (${T.money(pr.precio)}) es menor que su costo (${T.money(p.costo * pr.factor)})`);
      if (pr.codigo && (ajenos.has(pr.codigo) || propios.has(pr.codigo))) throw new Error(`El código ${pr.codigo} está repetido`);
      if (pr.codigo) propios.add(pr.codigo);
    }
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
    // Igual, pero también reconoce el código de una presentación. Devuelve {p, pres} o null.
    porCodigo(cod) {
      if (!cod) return null;
      for (const p of D().lista('productos')) {
        if (p.activo === false) continue;
        if (p.codigo === cod) return { p, pres: null };
        const pres = (p.presentaciones || []).find(x => x.codigo === cod);
        if (pres) return { p, pres };
      }
      return null;
    },
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
    // items: [{productoId, presId?, cantidad, precio, descuento}]  pagos: [{metodo, monto}] (montos aplicados; suman el total)
    // Con presId la cantidad va en presentaciones (2 pacas) y el inventario baja cantidad × factor unidades.
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
        const pres = it.presId ? (p.presentaciones || []).find(x => x.id === it.presId) : null;
        if (it.presId && !pres) throw new Error(`La presentación de "${p.nombre}" ya no existe; quítela de la venta y agréguela de nuevo`);
        const factor = pres ? pres.factor : 1;
        if (!(cant > 0)) throw new Error(`Cantidad inválida en "${p.nombre}"`);
        if (!(it.precio >= 0)) throw new Error(`Precio inválido en "${p.nombre}"`);
        p._vend = T.r3(p._vend + cant * factor);
        if (!T.regla('venderSinStock') && !sinStock && (p.stock || 0) < p._vend) throw new Error(`No hay suficiente "${p.nombre}" (quedan ${T.cant(p.stock)})`);
        if (T.regla('bloquearVencidos') && p.vence && p.vence < hoy) throw new Error(`"${p.nombre}" está vencido (${T.fechaCorta(p.vence)})`);
        const bruto = T.red(it.precio * cant), desc = Math.min(bruto, T.red(it.descuento || 0)), tot = bruto - desc;
        if (p.iva) impuesto += T.red(tot - tot / (1 + p.iva / 100));
        costo += T.red((p.costo || 0) * factor * cant);
        lineas.push({
          productoId: p.id, nombre: pres ? `${p.nombre} · ${pres.nombre}` : p.nombre, codigo: (pres ? pres.codigo : p.codigo) || '', unidad: pres ? 'und' : p.unidad || 'und',
          cantidad: cant, precio: it.precio, costo: T.red((p.costo || 0) * factor), iva: p.iva || 0, descuento: desc, total: tot, ...(pres ? { presId: pres.id, factor } : {})
        });
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
      lineas.forEach(l => ops.push(movOp(prods.get(l.productoId), 'venta', -l.cantidad * (l.factor || 1), l.costo / (l.factor || 1), numero)));
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
      if (o.devuelto > 0) throw new Error('Esta venta ya tiene devoluciones. Devuelva los productos que faltan en lugar de anularla.');
      const ops = [], prods = new Map(), caja = this.cajaAbierta();
      for (const l of o.items) {
        const orig = D().get('productos', l.productoId);
        if (!orig) continue;
        if (!prods.has(orig.id)) prods.set(orig.id, { ...orig });
        ops.push(movOp(prods.get(orig.id), 'anulacion', l.cantidad * (l.factor || 1), l.costo / (l.factor || 1), o.numero, motivo));
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

    // Devolución de algunos productos de una venta. items: [{i: posición de la línea, cantidad}]
    // El valor se descuenta primero de lo que quedó fiado en esa venta; el resto sale en efectivo de la caja.
    async devolver(id, { items, motivo, autoriza }) {
      if (!motivo) throw new Error('Escriba el motivo de la devolución');
      const o = await D().leer('ventas', id);
      if (!o || o.estado !== 'completada') throw new Error('Esa venta está anulada');
      const caja = this.cajaAbierta(), ops = [], prods = new Map(), lineas = o.items.map(l => ({ ...l })), dev = [];
      let total = 0, costo = 0;
      for (const { i, cantidad } of items) {
        const l = lineas[i], cant = T.r3(cantidad);
        if (!l || !(cant > 0)) continue;
        const queda = T.r3(l.cantidad - (l.devuelto || 0));
        if (cant > queda) throw new Error(`De "${l.nombre}" solo se pueden devolver ${T.cant(queda)}`);
        const f = l.factor || 1, valor = T.red(l.total / l.cantidad * cant);
        l.devuelto = T.r3((l.devuelto || 0) + cant);
        total += valor; costo += T.red(l.costo * cant);
        dev.push({ productoId: l.productoId, nombre: l.nombre, cantidad: cant, total: valor });
        const orig = D().get('productos', l.productoId);
        if (orig) {
          if (!prods.has(orig.id)) prods.set(orig.id, { ...orig });
          ops.push(movOp(prods.get(orig.id), 'devolucion', cant * f, l.costo / f, o.numero, motivo));
        }
      }
      if (!dev.length) throw new Error('Indique qué productos se devuelven');
      total = Math.min(total, o.total - (o.devuelto || 0));
      const aFiado = o.clienteId ? Math.min(total, (o.fiado || 0) - (o.fiadoDevuelto || 0)) : 0, enEfectivo = total - aFiado;
      if (enEfectivo > 0) {
        if (!caja) throw new Error('Abra la caja para devolver el dinero');
        await this.exigirEfectivo(caja, enEfectivo);
        ops.push({ s: 'cajaMovs', r: { id: T.uid(), fecha: Date.now(), cajaId: caja.id, tipo: 'devolucion', concepto: `Devolución ${o.numero}`, monto: enEfectivo, ...quien() } });
      }
      prods.forEach(p => ops.push({ s: 'productos', r: p }));
      if (aFiado > 0) {
        const c = { ...D().get('clientes', o.clienteId) };
        c.saldo = (c.saldo || 0) - aFiado; ops.push({ s: 'clientes', r: c });
      }
      const d = { fecha: Date.now(), items: dev, total, aFiado, enEfectivo, motivo, usuario: T.auth.usuario.nombre, autoriza: autoriza || '', cajaId: caja ? caja.id : null };
      const v = { ...o, items: lineas, devuelto: (o.devuelto || 0) + total, costoDevuelto: (o.costoDevuelto || 0) + costo, fiadoDevuelto: (o.fiadoDevuelto || 0) + aFiado, devoluciones: [...(o.devoluciones || []), d] };
      ops.push({ s: 'ventas', r: v }, T.aud('venta.devolver', o.numero, { productos: dev.map(x => `${x.cantidad} × ${x.nombre}`), total, enEfectivo, aFiado, motivo, autoriza: autoriza || '' }));
      await D().lote(ops);
      return { venta: v, devolucion: d };
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
        const saldo = ventas.filter(v => v.estado === 'completada').reduce((a, v) => a + (v.fiado || 0) - (v.fiadoDevuelto || 0), 0) - abonos.reduce((a, x) => a + x.monto, 0);
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
    // Qué pedir a los proveedores: lo necesario para cubrir "dias" de venta (según las últimas 4 semanas)
    // más el mínimo de cada producto, menos lo que hay. Devuelve una fila por producto que haga falta.
    async sugerirPedido(dias = 15) {
      const VENTANA = 28, fin = Date.now(), r = await this.resumen(fin - VENTANA * 86400000, fin), out = [];
      for (const p of D().lista('productos')) {
        if (p.activo === false) continue;
        const vendidos = (r.productos[p.id] || {}).cantidad || 0, diario = vendidos / VENTANA, stock = Math.max(0, p.stock || 0);
        if (!vendidos && !(p.stockMin > 0)) continue;
        const falta = diario * dias + (p.stockMin || 0) - stock;
        if (!(falta > 0)) continue;
        const pres = (p.presentaciones || []).slice().sort((a, b) => b.factor - a.factor)[0] || null;
        const paquetes = pres ? Math.ceil(falta / pres.factor) : 0, sugerido = pres ? paquetes * pres.factor : Math.ceil(falta);
        out.push({ p, vendidos: T.r3(vendidos), stock, diasQuedan: diario > 0 ? Math.floor(stock / diario) : null, sugerido, pres, paquetes, costo: T.red(sugerido * (p.costo || 0)) });
      }
      return out.sort((a, b) => (a.diasQuedan ?? 999) - (b.diasQuedan ?? 999));
    },

    async resumen(desde, hasta) {
      const [ventas, movs, abonos] = await Promise.all([D().rango('ventas', 'fecha', desde, hasta), D().rango('cajaMovs', 'fecha', desde, hasta), D().rango('abonos', 'fecha', desde, hasta)]);
      // Todas las cifras van netas de devoluciones. Las cantidades por producto van en unidades sueltas.
      const r = { ventas: [], n: 0, anuladas: 0, total: 0, costo: 0, descuento: 0, impuesto: 0, fiado: 0, devuelto: 0, gastos: 0, abonos: 0, porMetodo: {}, porDia: {}, porCategoria: {}, porUsuario: {}, productos: {} };
      for (const v of ventas) {
        r.ventas.push(v);
        if (v.estado !== 'completada') { r.anuladas++; continue; }
        const dv = v.devuelto || 0, fd = v.fiadoDevuelto || 0, neto = v.total - dv;
        r.n++; r.total += neto; r.costo += (v.costo || 0) - (v.costoDevuelto || 0); r.descuento += v.descuento || 0; r.impuesto += v.impuesto || 0; r.fiado += (v.fiado || 0) - fd; r.devuelto += dv;
        v.pagos.forEach(p => { r.porMetodo[p.metodo] = (r.porMetodo[p.metodo] || 0) + p.monto; });
        if (fd) r.porMetodo.fiado -= fd;
        if (dv - fd) r.porMetodo.efectivo = (r.porMetodo.efectivo || 0) - (dv - fd);   // lo devuelto en plata sale del efectivo
        const d = T.dia(v.fecha); r.porDia[d] = (r.porDia[d] || 0) + neto;
        r.porUsuario[v.usuario] = (r.porUsuario[v.usuario] || 0) + neto;
        for (const l of v.items) {
          const queda = T.r3(l.cantidad - (l.devuelto || 0));
          if (!(queda > 0)) continue;
          const p = D().get('productos', l.productoId), cat = (p && p.categoria) || 'Sin categoría', tl = T.red(l.total / l.cantidad * queda);
          r.porCategoria[cat] = (r.porCategoria[cat] || 0) + tl;
          const x = r.productos[l.productoId] = r.productos[l.productoId] || { nombre: p ? p.nombre : l.nombre, cantidad: 0, total: 0, utilidad: 0 };
          x.cantidad = T.r3(x.cantidad + queda * (l.factor || 1)); x.total += tl; x.utilidad += tl - T.red(l.costo * queda);
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
