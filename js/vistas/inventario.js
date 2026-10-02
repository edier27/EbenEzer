'use strict';
// ════════════ INVENTARIO · FOTO CON IA · ENTRADA DE MERCANCÍA ════════════
(function (T) {
  T.ui = T.ui || {};
  let filtro = 'todos', cat = '', texto = '';

  const TIPOS_MOV = { inicial: 'Existencia inicial', compra: 'Compra', entrada: 'Entrada', venta: 'Venta', anulacion: 'Anulación de venta', ajuste: 'Ajuste por conteo', merma: 'Merma / daño' };
  const opcCats = () => T.categorias().map(c => [c, c]);

  // Productos del inventario parecidos a un nombre (para no crear duplicados).
  function parecidos(nombre, codigo) {
    const exacto = T.neg.buscarCodigo(codigo);
    if (exacto) return [{ p: exacto, pts: 1 }];
    // Palabras de 2+ letras y números por separado: "500G" y "500 g" cuentan igual.
    const partes = t => new Set(T.norm(t).match(/[a-z]{2,}|\d+/g) || []);
    const a = partes(nombre);
    if (!a.size) return [];
    return T.db.lista('productos').map(p => {
      const b = partes(p.nombre + ' ' + (p.marca || ''));
      let n = 0; a.forEach(w => { if (b.has(w)) n++; });
      return { p, pts: n / (a.size + b.size - n) };
    }).filter(x => x.pts >= 0.34).sort((x, y) => y.pts - x.pts).slice(0, 5);
  }

  // ── Editar / crear producto ──
  T.ui.editarProducto = (p, previo = {}) => new Promise(res => {
    const d = { unidad: 'und', iva: 0, activo: true, ...previo, ...(p || {}) };
    let foto = d.foto || '';
    const verCosto = T.auth.puede('utilidad.ver');
    const campos = [
      { id: 'nombre', label: 'Nombre', req: true, valor: d.nombre, ph: 'Ej: Arroz Diana 500 g' },
      { id: 'codigo', label: 'Código de barras', medio: true, valor: d.codigo }, { id: 'marca', label: 'Marca', medio: true, valor: d.marca },
      { id: 'categoria', label: 'Categoría', medio: true, valor: d.categoria, attrs: 'list="dl-cat"' },
      { id: 'unidad', label: 'Se vende por', tipo: 'select', medio: true, valor: d.unidad, opciones: Object.entries(T.UNIDADES) },
      ...(verCosto ? [{ id: 'costo', label: 'Costo', tipo: 'number', medio: true, valor: d.costo ?? '' }] : []),
      { id: 'precio', label: 'Precio de venta', tipo: 'number', medio: true, req: true, valor: d.precio ?? '' },
      { id: 'iva', label: 'IVA (incluido en el precio)', tipo: 'select', medio: true, valor: d.iva, opciones: [[0, 'Sin IVA / excluido'], [5, '5%'], [19, '19%']] },
      { id: 'stockMin', label: 'Avisar cuando queden', tipo: 'number', medio: true, valor: d.stockMin ?? '' },
      { id: 'vence', label: 'Fecha de vencimiento', tipo: 'date', medio: true, valor: d.vence },
      { id: 'proveedorId', label: 'Proveedor', tipo: 'select', medio: true, valor: d.proveedorId || '', opciones: [['', '—'], ...T.db.lista('proveedores').map(x => [x.id, x.nombre])] },
      ...(p ? [{ id: 'activo', label: 'Producto activo (se puede vender)', tipo: 'check', valor: d.activo !== false }] : [{ id: 'stock', label: 'Existencias que hay ahora', tipo: 'number', valor: previo.cantidad ?? '' }])
    ];
    const m = T.modal({
      titulo: p ? 'Editar producto' : 'Producto nuevo', ancho: 600, alCerrar: v => res(v || null),
      cuerpo: `<div class="fila" style="margin-bottom:12px"><img class="mini-foto" id="foto" style="width:72px;height:72px" src="${foto}" alt="">
          <button class="btn mini" id="cambiar-foto">${T.ico('camara')} Foto</button>
          ${T.auth.puede('ia.usar') ? `<button class="btn mini ia" id="ia-foto">${T.ico('ia')} Llenar con foto (IA)</button>` : ''}</div>
        ${T.form(campos)}<datalist id="dl-cat">${T.categorias().map(c => `<option value="${T.esc(c)}">`).join('')}</datalist>
        ${p ? `<p class="suave" style="margin-top:10px">Existencias: <b>${T.cant(p.stock)}</b>. Para cambiarlas use “Ajustar” o registre una compra: así queda el rastro.</p>` : ''}`,
      botones: [...(p && T.auth.puede('inventario.editar') ? [{ txt: 'Eliminar', cls: 'sec', fn: async () => { if (!await T.confirmar(`¿Eliminar "${p.nombre}"? Queda guardado en el historial pero ya no aparece.`, { peligro: true, ok: 'Eliminar' })) return false; await T.neg.borrarProducto(p.id); return { borrado: true }; } }] : []),
      { txt: 'Cancelar', cls: 'sec' }, {
        txt: 'Guardar', cls: 'pri', fn: async cu => {
          const v = T.leerForm(cu, campos), stock = v.stock || 0;
          delete v.stock; v.iva = Number(v.iva);
          return T.neg.guardarProducto({ ...(p ? { id: p.id } : {}), ...v, foto }, stock);
        }
      }]
    });
    const cu = m.cuerpo, ponerFoto = f => { foto = f; T.$('#foto', cu).src = f; };
    T.$('#cambiar-foto', cu).onclick = async () => { const [f] = await T.elegirArchivo('image/*'); if (f) ponerFoto(await T.img.miniatura(await T.img.leer(f, 640))); };
    const ia = T.$('#ia-foto', cu);
    if (ia) ia.onclick = async () => {
      const [f] = await T.elegirArchivo('image/*'); if (!f) return;
      ia.disabled = true; ia.textContent = 'Analizando…';
      try {
        const img = await T.img.leer(f), [x] = await T.ia.productosDeFotos([img]);
        if (!x) throw new Error('La IA no reconoció ningún producto en la foto');
        const pon = (id, val) => { const i = T.$('#f_' + id, cu); if (i && val && !i.value) i.value = val; };
        pon('nombre', x.nombre); pon('marca', x.marca); pon('categoria', x.categoria); pon('codigo', x.codigo); pon('precio', x.precioSugerido); pon('unidad', x.unidad);
        ponerFoto(await T.img.miniatura(img, x.caja));
        T.toast('Revise los datos antes de guardar', 'ok');
      } catch (e) { T.toast(e.message, 'error'); }
      finally { ia.disabled = false; ia.innerHTML = `${T.ico('ia')} Llenar con foto (IA)`; }
    };
  });

  T.ui.ajustar = async p => {
    const r = await T.pedir({
      titulo: 'Ajustar existencias — ' + p.nombre, nota: `Ahora hay ${T.cant(p.stock)}.`, campos: [
        { id: 'tipo', label: 'Qué pasó', tipo: 'select', opciones: [['ajuste', 'Conté y hay otra cantidad'], ['merma', 'Se dañó, venció o se perdió'], ['entrada', 'Llegó mercancía (sin factura)']] },
        { id: 'cant', label: 'Cantidad (si contó: la que hay; si no: cuánto entra o sale)', tipo: 'number', req: true },
        { id: 'motivo', label: 'Motivo', req: true, ph: 'Ej: conteo de fin de mes' }]
    });
    if (!r) return null;
    const nueva = r.tipo === 'ajuste' ? r.cant : r.tipo === 'merma' ? p.stock - r.cant : p.stock + r.cant;
    try { await T.neg.ajustarStock(p.id, nueva, r.tipo, r.motivo); T.toast('Existencias actualizadas', 'ok'); return true; }
    catch (e) { T.toast(e.message, 'error'); return null; }
  };

  T.ui.kardex = async p => {
    const movs = (await T.db.porIndice('movimientos', 'productoId', p.id)).sort((a, b) => b.fecha - a.fecha);
    T.modal({
      titulo: 'Kárdex — ' + p.nombre, ancho: 760, cuerpo: T.tabla([
        { t: 'Fecha', v: m => T.fechaHora(m.fecha) }, { t: 'Movimiento', v: m => `${TIPOS_MOV[m.tipo] || m.tipo}${m.ref ? ` <small class="suave">${T.esc(m.ref)}</small>` : ''}${m.nota ? `<br><small class="suave">${T.esc(m.nota)}</small>` : ''}` },
        { t: 'Cantidad', cls: 'der num', v: m => `<span class="etq ${m.cantidad > 0 ? 'ok' : 'mal'}">${m.cantidad > 0 ? '+' : ''}${T.cant(m.cantidad)}</span>` },
        { t: 'Quedó', cls: 'der num', v: m => T.cant(m.saldo) }, { t: 'Usuario', v: m => T.esc(m.usuario) }
      ], movs, 'Este producto no tiene movimientos.')
    });
  };

  // ── Foto con IA: productos o factura ──
  T.ui.fotoIA = (modo = 'productos') => {
    const fotos = [];
    const m = T.modal({
      titulo: 'Agregar con foto', ancho: 560,
      cuerpo: `<div class="metodos" style="grid-template-columns:1fr 1fr"><button data-modo="productos">${T.ico('inventario')} Productos o estante</button><button data-modo="factura">${T.ico('lista')} Factura del proveedor</button></div>
        <p class="suave" id="ayuda"></p>
        <div class="fila" style="margin-top:12px"><button class="btn pri crece" id="tomar">${T.ico('camara')} Tomar foto</button><button class="btn crece" id="elegir">Elegir del equipo</button></div>
        <div class="fotos-ia" id="fotos"></div><div id="estado"></div>`,
      botones: [{ txt: 'Cancelar', cls: 'sec' }, { txt: T.ico('ia') + ' Analizar con IA', cls: 'ia', id: 'ok', fn: () => analizar() }]
    });
    const cu = m.cuerpo, pintar = () => {
      T.$$('[data-modo]', cu).forEach(b => b.classList.toggle('activo', b.dataset.modo === modo));
      T.$('#ayuda', cu).textContent = modo === 'productos' ? 'Tome una foto clara de los productos (de frente, con buena luz). La IA los reconoce y usted solo revisa cantidades y precios.' : 'Tome la foto de la factura completa y derecha. La IA lee los productos, cantidades y costos, y usted revisa antes de guardar.';
      T.$('#fotos', cu).innerHTML = fotos.map(f => `<img src="${f}" alt="">`).join('');
      if (!T.ia.lista()) T.$('#estado', cu).innerHTML = `<div class="banda aviso">${T.ico('alerta')}<span>Falta la clave de la IA.</span><a class="btn" href="#config" id="ir-cfg">Configurar</a></div>`;
    };
    const sumar = async archivos => { for (const f of archivos) fotos.push(await T.img.leer(f)); pintar(); };
    cu.onclick = e => {
      const b = e.target.closest('[data-modo]'); if (b) { modo = b.dataset.modo; pintar(); }
      if (e.target.closest('#ir-cfg')) { T.vistas.config.pestana = 'ia'; m.cerrar(); }
    };
    T.$('#tomar', cu).onclick = async () => sumar(await T.elegirArchivo('image/*', { camara: true }));
    T.$('#elegir', cu).onclick = async () => sumar(await T.elegirArchivo('image/*', { multiple: true }));
    pintar();

    async function analizar() {
      if (!fotos.length) throw new Error('Primero tome o elija una foto');
      T.$('#estado', cu).innerHTML = '<div class="pensando">La IA está mirando la foto…</div>';
      try {
        const filas = [];
        let extra = {};
        if (modo === 'productos') {
          for (const x of await T.ia.productosDeFotos(fotos)) {
            const src = fotos[x.imagen] || fotos[0];
            filas.push({ nombre: x.nombre, marca: x.marca, categoria: x.categoria, unidad: T.UNIDADES[x.unidad] ? x.unidad : 'und', codigo: String(x.codigo || '').replace(/\D/g, ''), cantidad: T.aNum(x.cantidad) || 1, costo: 0, precio: T.red(T.aNum(x.precioSugerido)), foto: await T.img.miniatura(src, x.caja).catch(() => '') });
          }
        } else {
          const f = await T.ia.facturaDeFotos(fotos);
          extra = { proveedor: f.proveedor || '', factura: f.numero || '', totalFactura: T.red(T.aNum(f.total)) };
          f.items.forEach(x => filas.push({ nombre: x.nombre, categoria: x.categoria, unidad: 'und', codigo: String(x.codigo || '').trim(), cantidad: T.aNum(x.cantidad) || 1, costo: T.red(T.aNum(x.costoUnitario)), precio: 0 }));
        }
        if (!filas.length) throw new Error(modo === 'productos' ? 'La IA no reconoció productos. Pruebe con otra foto más cercana y con luz.' : 'La IA no pudo leer la factura. Pruebe con una foto más nítida.');
        await T.registrar('ia.foto', modo, { fotos: fotos.length, detectados: filas.length });
        setTimeout(() => T.ui.entrada({ filas, esCompra: modo === 'factura', origen: 'foto-ia', ...extra }), 0);
      } catch (e) { T.$('#estado', cu).innerHTML = ''; throw e; }
    }
  };

  // ── Entrada de mercancía (manual, por foto o por factura) ──
  T.ui.entrada = ({ filas = [], esCompra = true, proveedor = '', factura = '', totalFactura = 0, origen = 'manual' } = {}) => new Promise(res => {
    filas = filas.map(f => {
      const c = parecidos(f.nombre, f.codigo), mejor = c[0] && (c[0].pts >= 0.8) ? c[0].p : null;
      const fila = { ...f, candidatos: c.map(x => x.p), productoId: '' };
      if (mejor) enlazar(fila, mejor);
      else if (!fila.precio && fila.costo) fila.precio = T.neg.precioSugerido(fila.costo);
      return fila;
    });
    function enlazar(f, p) {
      f.productoId = p.id;
      if (!f.precio) f.precio = p.precio;
      if (!f.costo && origen !== 'foto-ia') f.costo = p.costo || 0;
      if (!f.candidatos.includes(p)) f.candidatos.unshift(p);
    }
    const m = T.modal({
      titulo: 'Entrada de mercancía', ancho: 1040, alCerrar: v => res(v || null),
      cuerpo: `<label class="campo check"><input type="checkbox" id="esCompra" ${esCompra ? 'checked' : ''}><span>Es una compra a un proveedor<small>Apáguelo si solo está contando lo que ya tenía en la tienda.</small></span></label>
        <div class="form" id="cab" style="margin:8px 0 14px">
          <label class="campo medio"><span>Proveedor</span><input id="prov" list="dl-prov" value="${T.esc(proveedor)}" placeholder="Nombre del proveedor"><datalist id="dl-prov">${T.db.lista('proveedores').map(p => `<option value="${T.esc(p.nombre)}">`).join('')}</datalist></label>
          <label class="campo medio"><span>N.º de factura</span><input id="fac" value="${T.esc(factura)}"></label>
          <label class="campo"><span>Cómo se pagó</span><select id="pago"><option value="otro">Ya está pagada (por fuera de la caja)</option><option value="caja">Se pagó con plata de la caja</option><option value="credito">Se queda debiendo al proveedor</option></select></label>
        </div>
        <div id="filas"></div>
        <div class="fila" style="margin-top:10px"><div class="buscador crece">${T.ico('buscar')}<input id="bus" placeholder="Agregar un producto del inventario…" autocomplete="off"></div><button class="btn" id="nuevo">${T.ico('mas')} Producto nuevo</button></div>
        <div id="res" class="chips"></div><p id="tot" style="margin-top:8px;font-weight:700"></p>`,
      botones: [{ txt: 'Cancelar', cls: 'sec' }, { txt: 'Guardar en el inventario', cls: 'pri', fn: () => guardar() }]
    });
    const cu = m.cuerpo;
    const pintar = () => {
      const compra = T.$('#esCompra', cu).checked;
      T.$('#cab', cu).classList.toggle('oculto', !compra);
      T.$('#filas', cu).innerHTML = filas.length ? `<div class="tabla-caja"><table class="tabla"><thead><tr><th style="min-width:230px">Producto</th><th>Código</th><th>Categoría</th><th>Cantidad</th><th>Costo unidad</th><th>Precio venta</th><th></th></tr></thead><tbody>
        ${filas.map((f, i) => `<tr data-i="${i}">
          <td><div class="fila" style="flex-wrap:nowrap">${f.foto ? `<img class="mini-foto" src="${f.foto}" alt="">` : ''}<div class="crece">
            <input data-k="nombre" value="${T.esc(f.productoId ? T.db.get('productos', f.productoId).nombre : f.nombre)}" ${f.productoId ? 'disabled' : ''} aria-label="Nombre">
            <select data-k="productoId" aria-label="Producto existente" style="margin-top:4px"><option value="">➕ Crear como producto nuevo</option>${f.candidatos.map(p => `<option value="${p.id}" ${p.id === f.productoId ? 'selected' : ''}>Ya existe: ${T.esc(p.nombre)} (hay ${T.cant(p.stock)})</option>`).join('')}</select></div></div></td>
          <td><input data-k="codigo" value="${T.esc(f.productoId ? T.db.get('productos', f.productoId).codigo || '' : f.codigo || '')}" ${f.productoId ? 'disabled' : ''} style="width:130px" aria-label="Código"></td>
          <td><select data-k="categoria" ${f.productoId ? 'disabled' : ''} aria-label="Categoría">${['', ...T.categorias()].map(c => `<option ${c === (f.productoId ? T.db.get('productos', f.productoId).categoria : f.categoria) ? 'selected' : ''}>${T.esc(c)}</option>`).join('')}</select></td>
          <td><input data-k="cantidad" type="number" step="any" value="${f.cantidad ?? ''}" style="width:84px" aria-label="Cantidad"></td>
          <td><input data-k="costo" type="number" value="${f.costo || ''}" style="width:104px" aria-label="Costo"></td>
          <td><input data-k="precio" type="number" value="${f.precio || ''}" style="width:104px" aria-label="Precio"></td>
          <td><button class="btn-ico" data-quitar aria-label="Quitar">${T.ico('borrar')}</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="vacio">Agregue productos con el buscador de abajo.</p>';
      pintarTotal();
    };
    const pintarTotal = () => {
      const total = filas.reduce((a, f) => a + T.red((f.cantidad || 0) * (f.costo || 0)), 0);
      T.$('#tot', cu).innerHTML = `${filas.length} producto(s) · Total a costo: ${T.money(total)}${totalFactura ? ` · <span class="etq ${Math.abs(totalFactura - total) <= 100 ? 'ok' : 'aviso'}">La factura dice ${T.money(totalFactura)}${Math.abs(totalFactura - total) > 100 ? ' — revise cantidades y costos' : ''}</span>` : ''}`;
    };
    // Solo se redibuja la tabla al enlazar un producto: así no se pierde el foco al pasar de casilla.
    T.$('#filas', cu).onchange = e => {
      const tr = e.target.closest('tr'), k = e.target.dataset.k; if (!tr || !k) return;
      const f = filas[+tr.dataset.i];
      if (k === 'productoId') { f.productoId = ''; if (e.target.value) enlazar(f, T.db.get('productos', e.target.value)); return pintar(); }
      if (['cantidad', 'costo', 'precio'].includes(k)) {
        f[k] = T.aNum(e.target.value);
        if (k === 'costo' && !f.precio && f.costo) { f.precio = T.neg.precioSugerido(f.costo); T.$('[data-k=precio]', tr).value = f.precio; }
      } else f[k] = e.target.value.trim();
      pintarTotal();
    };
    T.$('#filas', cu).onclick = e => { const b = e.target.closest('[data-quitar]'); if (b) { filas.splice(+b.closest('tr').dataset.i, 1); pintar(); } };
    T.$('#esCompra', cu).onchange = pintar;
    T.$('#nuevo', cu).onclick = () => { filas.push({ nombre: '', codigo: '', categoria: '', unidad: 'und', cantidad: 1, costo: 0, precio: 0, candidatos: [], productoId: '' }); pintar(); };
    T.$('#bus', cu).oninput = e => {
      const t = T.norm(e.target.value), cod = e.target.value.trim();
      T.$('#res', cu).innerHTML = t.length < 2 ? '' : T.db.lista('productos').filter(p => p.codigo === cod || T.norm(p.nombre).includes(t)).slice(0, 8).map(p => `<button data-p="${p.id}">${T.esc(p.nombre)}</button>`).join('');
    };
    T.$('#res', cu).onclick = e => {
      const b = e.target.closest('[data-p]'); if (!b) return;
      const p = T.db.get('productos', b.dataset.p), f = { nombre: p.nombre, cantidad: 1, costo: p.costo || 0, precio: p.precio, candidatos: [p], productoId: '' };
      enlazar(f, p); filas.push(f);
      T.$('#bus', cu).value = ''; T.$('#res', cu).innerHTML = ''; pintar();
    };
    pintar();

    async function guardar() {
      const compra = T.$('#esCompra', cu).checked, nomProv = T.$('#prov', cu).value.trim();
      if (!filas.length) throw new Error('No hay productos para guardar');
      const items = filas.map(f => {
        if (!f.productoId && !f.nombre) throw new Error('Hay un producto sin nombre');
        return { productoId: f.productoId || null, nuevo: f.productoId ? null : { nombre: f.nombre, codigo: f.codigo || '', categoria: f.categoria || '', marca: f.marca || '', unidad: f.unidad || 'und', foto: f.foto || '' }, cantidad: f.cantidad, costo: f.costo || 0, precio: f.precio || 0 };
      });
      let proveedorId = null;
      if (compra && nomProv) {
        const p = T.db.lista('proveedores').find(x => T.norm(x.nombre) === T.norm(nomProv)) || await T.neg.guardarProveedor({ nombre: nomProv });
        proveedorId = p.id;
      }
      const r = await T.neg.entrada({ items, esCompra: compra, proveedorId, factura: T.$('#fac', cu).value.trim(), pago: T.$('#pago', cu).value, origen });
      T.toast(`Guardado: ${r.productos} producto(s)${r.nuevos ? `, ${r.nuevos} nuevo(s)` : ''}`, 'ok');
      T.app.refrescar();
      return r;
    }
  });

  // ── Importar / exportar ──
  const COLS = ['codigo', 'nombre', 'categoria', 'marca', 'unidad', 'costo', 'precio', 'existencias', 'minimo', 'vence'];
  function exportar() {
    T.descargar(`inventario-${T.dia()}.csv`, T.csv([COLS, ...T.db.lista('productos').map(p => [p.codigo, p.nombre, p.categoria, p.marca, p.unidad, p.costo, p.precio, p.stock, p.stockMin, p.vence])]), 'text/csv');
  }
  async function importar() {
    if (!await T.confirmar(`Elija un archivo CSV (Excel → Guardar como → CSV) con estas columnas en la primera fila:\n\n${COLS.join(' ; ')}\n\nSolo "nombre" y "precio" son obligatorias. Los productos que ya existan (mismo código o nombre) se saltan.`, { titulo: 'Importar productos', ok: 'Elegir archivo' })) return;
    const [f] = await T.elegirArchivo('.csv,text/csv'); if (!f) return;
    try {
      const filas = T.leerCSV(await f.text()), cab = filas.shift().map(T.norm), ix = k => cab.indexOf(k);
      if (ix('nombre') < 0 || ix('precio') < 0) throw new Error('El archivo debe tener las columnas "nombre" y "precio" en la primera fila');
      const ya = new Set(T.db.lista('productos').flatMap(p => [p.codigo, T.norm(p.nombre)]).filter(Boolean)), items = [];
      const g = (fila, k) => ix(k) >= 0 ? (fila[ix(k)] || '').trim() : '';
      for (const fila of filas) {
        const nombre = g(fila, 'nombre'), codigo = g(fila, 'codigo');
        if (!nombre || ya.has(T.norm(nombre)) || (codigo && ya.has(codigo))) continue;
        ya.add(T.norm(nombre)); if (codigo) ya.add(codigo);
        const dinero = k => T.red(T.aNum(g(fila, k).replace(/[$.\s]/g, '')));
        items.push({ nuevo: { nombre, codigo, categoria: g(fila, 'categoria'), marca: g(fila, 'marca'), unidad: T.UNIDADES[g(fila, 'unidad')] ? g(fila, 'unidad') : 'und', stockMin: T.aNum(g(fila, 'minimo')), vence: /^\d{4}-\d{2}-\d{2}$/.test(g(fila, 'vence')) ? g(fila, 'vence') : '' }, cantidad: T.aNum(g(fila, 'existencias')), costo: dinero('costo'), precio: dinero('precio') });
      }
      if (!items.length) throw new Error('No había productos nuevos en el archivo');
      // Con existencias entran por kárdex (una sola transacción); sin existencias solo se crea el producto.
      const conStock = items.filter(i => i.cantidad > 0), sinStock = items.filter(i => !(i.cantidad > 0));
      if (conStock.length) await T.neg.entrada({ items: conStock, esCompra: false, origen: 'csv' });
      for (const i of sinStock) await T.neg.guardarProducto({ ...i.nuevo, costo: i.costo, precio: i.precio, iva: 0 });
      T.toast(`Se importaron ${items.length} productos`, 'ok'); T.app.refrescar();
    } catch (e) { T.toast(e.message, 'error'); }
  }

  T.vistas.inventario = {
    render(el) {
      const editar = T.auth.puede('inventario.editar'), verCosto = T.auth.puede('utilidad.ver'), hoy = T.dia(), lim = T.dia(Date.now() + T.regla('diasVence') * 86400000);
      const todos = T.db.lista('productos');
      el.innerHTML = `<div class="cabeza"><h2>Inventario</h2><div class="fila">
          ${editar && T.auth.puede('ia.usar') ? `<button class="btn ia" id="foto">${T.ico('camara')} Agregar con foto</button>` : ''}
          ${editar ? `<button class="btn pri" id="nuevo">${T.ico('mas')} Producto</button><button class="btn" id="entrada">${T.ico('compras')} Entrada</button><button class="btn" id="imp">${T.ico('subir')} Importar</button>` : ''}
          <button class="btn" id="exp">${T.ico('bajar')} Exportar</button></div></div>
        <div class="fila" style="margin-bottom:12px"><div class="buscador crece">${T.ico('buscar')}<input id="q" value="${T.esc(texto)}" placeholder="Nombre, marca o código"></div>
          <select id="filtro" style="width:auto">${[['todos', 'Todos'], ['bajos', 'Por agotarse'], ['agotados', 'Agotados'], ['vence', 'Vencidos o por vencer'], ['inactivos', 'Inactivos']].map(([v, t]) => `<option value="${v}" ${v === filtro ? 'selected' : ''}>${t}</option>`).join('')}</select>
          <select id="cat" style="width:auto"><option value="">Todas las categorías</option>${T.categorias().map(c => `<option ${c === cat ? 'selected' : ''}>${T.esc(c)}</option>`).join('')}</select></div>
        <p class="suave" id="resumen" style="margin-bottom:10px"></p><div id="tabla"></div>`;
      const pintar = () => {
        const pals = T.norm(texto).split(/\s+/).filter(Boolean);
        const lista = todos.filter(p => (filtro === 'inactivos' ? p.activo === false : p.activo !== false) && (!cat || p.categoria === cat) &&
          (filtro !== 'bajos' || (p.stock > 0 && p.stockMin > 0 && p.stock <= p.stockMin)) && (filtro !== 'agotados' || p.stock <= 0) && (filtro !== 'vence' || (p.vence && p.vence <= lim && p.stock > 0)) &&
          (!pals.length || p.codigo === texto.trim() || pals.every(w => T.norm(`${p.nombre} ${p.marca || ''} ${p.codigo || ''}`).includes(w)))).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
        T.$('#resumen', el).textContent = `${lista.length} producto(s)` + (verCosto ? ` · Vale a costo ${T.money(lista.reduce((a, p) => a + Math.max(0, p.stock) * (p.costo || 0), 0))} · a precio de venta ${T.money(lista.reduce((a, p) => a + Math.max(0, p.stock) * (p.precio || 0), 0))}` : '');
        T.$('#tabla', el).innerHTML = T.tabla([
          { t: '', v: p => p.foto ? `<img class="mini-foto" src="${p.foto}" alt="" loading="lazy">` : `<span class="mini-foto ini" style="--h:${T.tono(p.categoria || p.nombre)}">${T.esc(T.iniciales(p.nombre))}</span>` },
          { t: 'Producto', v: p => `<b>${T.esc(p.nombre)}</b><br><small class="suave">${T.esc([p.categoria, p.marca, p.codigo].filter(Boolean).join(' · '))}</small>` },
          ...(verCosto ? [{ t: 'Costo', cls: 'der num', v: p => T.money(p.costo) }] : []),
          { t: 'Precio', cls: 'der num', v: p => `<b>${T.money(p.precio)}</b>${verCosto && p.costo && p.precio ? `<br><small class="suave">${Math.round((p.precio - p.costo) / p.precio * 100)}% margen</small>` : ''}` },
          { t: 'Hay', cls: 'der num', v: p => `<span class="etq ${p.stock <= 0 ? 'mal' : p.stockMin > 0 && p.stock <= p.stockMin ? 'aviso' : 'ok'}">${T.cant(p.stock)} ${p.unidad !== 'und' ? p.unidad : ''}</span>` },
          { t: 'Vence', v: p => p.vence ? `<span class="etq ${p.vence < hoy ? 'mal' : p.vence <= lim ? 'aviso' : ''}">${T.fechaCorta(p.vence)}</span>` : '' },
          { t: '', cls: 'acc', v: p => `${editar ? `<button class="btn-ico" data-a="editar" data-p="${p.id}" title="Editar">${T.ico('editar')}</button>` : ''}${T.auth.puede('inventario.ajustar') ? `<button class="btn mini" data-a="ajustar" data-p="${p.id}">Ajustar</button>` : ''}<button class="btn-ico" data-a="kardex" data-p="${p.id}" title="Kárdex (movimientos)">${T.ico('lista')}</button>` }
        ], lista.slice(0, 300), todos.length ? 'Ningún producto coincide con el filtro.' : 'El inventario está vacío. Use “Agregar con foto” o “Producto”.') + (lista.length > 300 ? `<p class="suave centro" style="margin-top:8px">Se muestran 300 de ${lista.length}. Use el buscador.</p>` : '');
      };
      T.$('#q', el).oninput = e => { texto = e.target.value; pintar(); };
      T.$('#filtro', el).onchange = e => { filtro = e.target.value; pintar(); };
      T.$('#cat', el).onchange = e => { cat = e.target.value; pintar(); };
      T.$('#exp', el).onclick = exportar;
      const en = (id, fn) => { const b = T.$(id, el); if (b) b.onclick = fn; };
      en('#foto', () => T.ui.fotoIA('productos'));
      en('#nuevo', async () => { if (await T.ui.editarProducto()) T.app.refrescar(); });
      en('#entrada', () => T.ui.entrada({ esCompra: false }));
      en('#imp', importar);
      T.$('#tabla', el).onclick = async e => {
        const b = e.target.closest('[data-a]'); if (!b) return;
        const p = T.db.get('productos', b.dataset.p);
        if (b.dataset.a === 'kardex') return T.ui.kardex(p);
        if (await (b.dataset.a === 'editar' ? T.ui.editarProducto(p) : T.ui.ajustar(p))) T.app.refrescar();
      };
      pintar();
    }
  };
})(window.T);
