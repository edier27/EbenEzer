'use strict';
// ════════════ INVENTARIO · FOTO CON IA · ENTRADA DE MERCANCÍA ════════════
(function (T) {
  T.ui = T.ui || {};
  let filtro = 'todos', cat = '', texto = '';

  const TIPOS_MOV = { inicial: 'Existencia inicial', compra: 'Compra', entrada: 'Entrada', venta: 'Venta', anulacion: 'Anulación de venta', devolucion: 'Devolución de cliente', ajuste: 'Ajuste por conteo', merma: 'Merma / daño' };
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
    const pres = (d.presentaciones || []).map(x => ({ ...x }));
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
        ${p ? `<p class="suave" style="margin-top:10px">Existencias: <b>${T.cant(p.stock)}</b>. Para cambiarlas use “Ajustar” o registre una compra: así queda el rastro.</p>` : ''}
        <h4 style="margin:18px 0 4px">Presentaciones (opcional)</h4>
        <p class="suave" style="font-size:.84rem;margin-bottom:8px">Para vender o comprar este producto también por paca, caja o six-pack. El inventario siempre se lleva en unidades sueltas.</p>
        <div id="pres"></div><button class="btn mini" id="mas-pres" style="margin-top:8px">${T.ico('mas')} Presentación</button>`,
      botones: [...(p && T.auth.puede('inventario.editar') ? [{ txt: 'Eliminar', cls: 'sec', fn: async () => { if (!await T.confirmar(`¿Eliminar "${p.nombre}"? Queda guardado en el historial pero ya no aparece.`, { peligro: true, ok: 'Eliminar' })) return false; await T.neg.borrarProducto(p.id); return { borrado: true }; } }] : []),
      { txt: 'Cancelar', cls: 'sec' }, {
        txt: 'Guardar', cls: 'pri', fn: async cu => {
          const v = T.leerForm(cu, campos), stock = v.stock || 0;
          delete v.stock; v.iva = Number(v.iva);
          v.presentaciones = pres.filter(x => x.nombre || x.factor || x.precio).map(x => ({ id: x.id || T.uid().slice(0, 8), nombre: (x.nombre || '').trim(), factor: T.aNum(x.factor), precio: T.red(T.aNum(x.precio)), codigo: (x.codigo || '').trim() }));
          return T.neg.guardarProducto({ ...(p ? { id: p.id } : {}), ...v, foto }, stock);
        }
      }]
    });
    const cu = m.cuerpo, ponerFoto = f => { foto = f; T.$('#foto', cu).src = f; };
    const pintarPres = () => {
      T.$('#pres', cu).innerHTML = pres.length ? `<div class="tabla-caja"><table class="tabla"><thead><tr><th>Nombre</th><th>Unidades que trae</th><th>Precio de venta</th><th>Código de barras</th><th></th></tr></thead><tbody>
        ${pres.map((x, i) => `<tr data-i="${i}"><td><input data-k="nombre" value="${T.esc(x.nombre || '')}" placeholder="Paca x 24" aria-label="Nombre de la presentación"></td>
          <td><input data-k="factor" type="number" value="${x.factor || ''}" style="width:90px" aria-label="Unidades que trae"></td>
          <td><input data-k="precio" type="number" value="${x.precio || ''}" style="width:110px" aria-label="Precio de la presentación"></td>
          <td><input data-k="codigo" value="${T.esc(x.codigo || '')}" style="width:130px" aria-label="Código de la presentación"></td>
          <td><button class="btn-ico" data-quitar aria-label="Quitar presentación">${T.ico('borrar')}</button></td></tr>`).join('')}</tbody></table></div>` : '';
    };
    T.$('#pres', cu).oninput = e => { const tr = e.target.closest('tr'); if (tr && e.target.dataset.k) pres[+tr.dataset.i][e.target.dataset.k] = e.target.value; };
    T.$('#pres', cu).onclick = e => { const b = e.target.closest('[data-quitar]'); if (b) { pres.splice(+b.closest('tr').dataset.i, 1); pintarPres(); } };
    T.$('#mas-pres', cu).onclick = () => { pres.push({ nombre: '', factor: '', precio: '', codigo: '' }); pintarPres(); const u = T.$$('#pres [data-k=nombre]', cu).pop(); if (u) u.focus(); };
    pintarPres();
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

  // ── Agregar con IA: factura del proveedor o foto de productos ──
  // La última factura leída queda guardada en este equipo hasta que se sube al inventario:
  // si se cierra la ventana o se va la luz, se retoma sin volver a leerla.
  const BORRADOR = 'borradorFactura';
  const hace = ts => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'hace un momento' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : T.fechaHora(ts); };

  T.ui.facturaIA = () => T.ui.fotoIA('factura');
  T.ui.fotoIA = (modo = 'productos') => {
    const fotos = [];
    const m = T.modal({
      titulo: 'Agregar con IA', ancho: 600,
      cuerpo: `<div class="metodos" style="grid-template-columns:1fr 1fr;margin-top:0"><button data-modo="factura">${T.ico('factura')} Factura del proveedor</button><button data-modo="productos">${T.ico('inventario')} Productos o estante</button></div>
        <div id="borrador"></div><ol class="pasos" id="ayuda"></ol>
        <div class="fila" style="margin-top:12px"><button class="btn pri crece" id="tomar">${T.ico('camara')} Tomar foto</button><button class="btn crece" id="elegir">${T.ico('subir')} <span id="elegir-txt"></span></button></div>
        <div class="fotos-ia" id="fotos"></div><div id="estado"></div>`,
      botones: [{ txt: 'Cancelar', cls: 'sec' }, { txt: T.ico('ia') + ' Leer con IA', cls: 'ia', id: 'ok', fn: () => analizar() }]
    });
    const cu = m.cuerpo, pintar = () => {
      const fac = modo === 'factura', b = fac && T.db.loc(BORRADOR);
      T.$$('[data-modo]', cu).forEach(x => x.classList.toggle('activo', x.dataset.modo === modo));
      T.$('#ayuda', cu).innerHTML = (fac
        ? ['Tome una foto por cada hoja de la factura (derecha, completa y con buena luz) o elija el PDF de la factura electrónica.', 'La IA lee el proveedor, los productos, las cantidades y los costos.', 'Usted revisa y la sube al inventario con un solo botón.']
        : ['Tome una foto clara de los productos, de frente y con buena luz.', 'La IA reconoce cada producto, su cantidad y un precio sugerido.', 'Usted revisa y los sube al inventario.']).map(t => `<li>${t}</li>`).join('');
      T.$('#elegir-txt', cu).textContent = fac ? 'Elegir foto o PDF' : 'Elegir del equipo';
      T.$('#borrador', cu).innerHTML = b ? `<div class="banda">${T.ico('factura')}<span>Hay una factura leída sin subir: ${T.esc(b.proveedor || 'proveedor sin nombre')} · ${b.filas.length} producto(s) · ${hace(b.fecha)}.</span><button class="btn" id="retomar">Retomar</button><button class="btn-ico" id="descartar" title="Descartar esa lectura" aria-label="Descartar esa lectura">${T.ico('borrar')}</button></div>` : '';
      T.$('#fotos', cu).innerHTML = fotos.map((f, i) => `<figure>${T.esPDF(f) ? `<span class="pdf-mini">${T.ico('pdf')}PDF</span>` : `<img src="${f}" alt="Foto ${i + 1}">`}<button class="btn-ico" data-quitar="${i}" title="Quitar" aria-label="Quitar">${T.ico('x')}</button></figure>`).join('');
      if (!T.ia.lista()) T.$('#estado', cu).innerHTML = `<div class="banda aviso">${T.ico('alerta')}<span>Falta la clave de la IA.</span><a class="btn" href="#config" id="ir-cfg">Configurar</a></div>`;
    };
    const sumar = async archivos => {
      try { for (const f of archivos) fotos.push(await T.leerParaIA(f)); }
      catch (e) { T.toast(e.message, 'error'); }
      pintar();
    };
    cu.onclick = async e => {
      const b = e.target.closest('[data-modo]'); if (b) { modo = b.dataset.modo; pintar(); }
      const q = e.target.closest('[data-quitar]'); if (q) { fotos.splice(+q.dataset.quitar, 1); pintar(); }
      if (e.target.closest('#ir-cfg')) { T.vistas.config.pestana = 'ia'; m.cerrar(); }
      if (e.target.closest('#retomar')) { const d = T.db.loc(BORRADOR); m.cerrar(); if (d) T.ui.entrada(d); }
      if (e.target.closest('#descartar') && await T.confirmar('¿Descartar la factura leída? Tendría que volver a leerla con la IA.', { ok: 'Descartar', peligro: true })) { await T.db.setLoc(BORRADOR, null); pintar(); }
    };
    T.$('#tomar', cu).onclick = async () => sumar(await T.elegirArchivo('image/*', { camara: true }));
    T.$('#elegir', cu).onclick = async () => sumar(await T.elegirArchivo(modo === 'factura' ? 'image/*,application/pdf,.pdf' : 'image/*', { multiple: true }));
    pintar();

    async function analizar() {
      if (!fotos.length) throw new Error(modo === 'factura' ? 'Primero tome la foto de la factura o elija el PDF' : 'Primero tome o elija una foto');
      if (modo === 'productos' && fotos.some(T.esPDF)) throw new Error('Los PDF solo sirven para facturas. Quítelo o elija "Factura del proveedor".');
      const est = T.$('#estado', cu);
      est.innerHTML = `<div class="pensando">${modo === 'factura' ? 'La IA está leyendo la factura… puede tardar hasta un minuto.' : 'La IA está mirando la foto…'}</div>`;
      try {
        if (modo === 'productos') {
          const filas = [];
          for (const x of await T.ia.productosDeFotos(fotos)) {
            const src = fotos[x.imagen] || fotos[0];
            filas.push({ nombre: x.nombre, marca: x.marca, categoria: x.categoria, unidad: T.UNIDADES[x.unidad] ? x.unidad : 'und', codigo: String(x.codigo || '').replace(/\D/g, ''), cantidad: T.ia.num(x.cantidad) || 1, costo: 0, precio: T.red(T.ia.num(x.precioSugerido)), foto: await T.img.miniatura(src, x.caja).catch(() => '') });
          }
          if (!filas.length) throw new Error('La IA no reconoció productos. Pruebe con otra foto más cercana y con luz.');
          await T.registrar('ia.foto', modo, { fotos: fotos.length, detectados: filas.length });
          setTimeout(() => T.ui.entrada({ filas, esCompra: false, origen: 'foto-ia' }), 0);
        } else {
          const f = await T.ia.facturaDeFotos(fotos);
          if (!f.items.length) throw new Error('La IA no encontró productos en la factura. Pruebe con una foto más nítida, derecha y con buena luz.');
          const datos = {
            filas: f.items.map(x => ({ ...x, unidad: 'und', precio: 0 })), esCompra: true, origen: 'factura-ia', fotos: fotos.slice(),
            proveedor: f.proveedor, nit: f.nit, telefono: f.telefono, factura: f.numero, fechaFactura: f.fecha, totalFactura: f.total
          };
          await T.db.setLoc(BORRADOR, { fecha: Date.now(), ...datos });
          await T.registrar('ia.foto', 'factura', { fotos: fotos.length, detectados: f.items.length, proveedor: f.proveedor, factura: f.numero, total: f.total });
          setTimeout(() => T.ui.entrada(datos), 0);
        }
      } catch (e) { est.innerHTML = ''; throw e; }
    }
  };

  // Factura en grande (foto o PDF) para compararla con lo que leyó la IA.
  const verArchivo = async (f, titulo) => {
    let url = '';
    if (T.esPDF(f)) url = URL.createObjectURL(await (await fetch(f)).blob());
    T.modal({
      titulo, ancho: 980, clase: 'modal-doc', alCerrar: () => { if (url) URL.revokeObjectURL(url); },
      cuerpo: url ? `<iframe class="doc-grande" src="${url}" title="${T.esc(titulo)}"></iframe>` : `<img class="doc-grande" src="${f}" alt="${T.esc(titulo)}">`
    });
  };

  // ── Entrada de mercancía (manual, por foto o por factura leída con IA) ──
  T.ui.entrada = ({ filas = [], esCompra = true, proveedor = '', nit = '', telefono = '', factura = '', fechaFactura = '', totalFactura = 0, fotos = [], origen = 'manual' } = {}) => new Promise(res => {
    const deFactura = origen === 'factura-ia';
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
    const provDe = () => {
      // Por nombre; si no, por el NIT que trae la factura (la razón social suele venir escrita distinto).
      const nom = T.norm(T.$('#prov', cu).value), digitos = s => String(s || '').replace(/\D/g, '').slice(0, 9), n = digitos(nit);
      if (!nom) return null;
      return T.db.lista('proveedores').find(x => T.norm(x.nombre) === nom) || (n.length >= 6 && T.db.lista('proveedores').find(x => digitos(x.nit) === n)) || null;
    };
    const m = T.modal({
      titulo: deFactura ? 'Revisar factura antes de subir' : 'Entrada de mercancía', ancho: 1100, alCerrar: v => res(v || null),
      antesDeCerrar: () => !filas.length || T.confirmar(deFactura ? '¿Cerrar sin subir la factura?\nLa lectura queda guardada en este equipo y puede retomarla desde "Factura con IA".' : '¿Cerrar sin guardar? Se pierden los productos que agregó.', { titulo: 'Cerrar sin guardar', ok: 'Cerrar', peligro: !deFactura }),
      cuerpo: `${fotos.length ? `<div class="doc-tira">${fotos.map((f, i) => `<button data-ver="${i}" title="Ver la factura en grande">${T.esPDF(f) ? `<span class="pdf-mini">${T.ico('pdf')}PDF</span>` : `<img src="${f}" alt="Hoja ${i + 1} de la factura">`}</button>`).join('')}
          <p class="suave">Toque la factura para verla en grande y compararla con lo que leyó la IA.${fechaFactura ? `<br>Fecha de la factura: <b>${T.fechaCorta(fechaFactura)}</b>` : ''}</p></div>` : ''}
        <label class="campo check"><input type="checkbox" id="esCompra" ${esCompra ? 'checked' : ''}><span>Es una compra a un proveedor<small>Apáguelo si solo está contando lo que ya tenía en la tienda.</small></span></label>
        <div class="form form-3" id="cab" style="margin:8px 0 14px">
          <label class="campo"><span>Proveedor</span><input id="prov" list="dl-prov" value="${T.esc(proveedor)}" placeholder="Nombre del proveedor"><datalist id="dl-prov">${T.db.lista('proveedores').map(p => `<option value="${T.esc(p.nombre)}">`).join('')}</datalist><small id="prov-info"></small></label>
          <label class="campo"><span>N.º de factura</span><input id="fac" value="${T.esc(factura)}"></label>
          <label class="campo"><span>Cómo se pagó</span><select id="pago"><option value="otro">Ya está pagada (por fuera de la caja)</option><option value="caja">Se pagó con plata de la caja</option><option value="credito">Se queda debiendo al proveedor</option></select></label>
        </div>
        <div id="avisos-ent"></div><div id="filas"></div>
        <div class="fila" style="margin-top:10px"><div class="buscador crece">${T.ico('buscar')}<input id="bus" placeholder="Agregar un producto del inventario…" autocomplete="off"></div><button class="btn" id="nuevo">${T.ico('mas')} Producto nuevo</button></div>
        <div id="res" class="chips"></div><div class="ent-resumen" id="tot"></div>`,
      botones: [{ txt: 'Cancelar', cls: 'sec' }, { txt: `${T.ico('subir')} Subir al inventario`, cls: 'pri grande', fn: () => guardar() }]
    });
    const cu = m.cuerpo;
    // Presentaciones del producto enlazado: permiten digitar la compra en pacas o cajas.
    const presDe = f => (f.productoId && T.db.get('productos', f.productoId).presentaciones) || [];
    const factorDe = f => (presDe(f).find(x => x.id === f.presCompra) || { factor: 1 }).factor;
    const bajoCosto = f => f.costo > 0 && f.precio > 0 && f.precio * factorDe(f) < f.costo;
    const sinPrecio = f => !f.productoId && !(f.precio > 0);
    const etiquetas = f => {
      const p = f.productoId && T.db.get('productos', f.productoId);
      return `${p ? `<span class="etq ok">Ya existe · hay ${T.cant(p.stock)}</span>` : '<span class="etq info">Nuevo</span>'}${f.empaque ? `<span class="etq">${T.esc(f.empaque)}</span>` : ''}${f.revisar ? `<span class="etq aviso" title="${T.esc(f.revisar)}">${T.ico('alerta')} ${T.esc(f.revisar)}</span>` : ''}${bajoCosto(f) ? '<span class="etq mal">Precio menor que el costo</span>' : sinPrecio(f) ? '<span class="etq mal">Falta el precio de venta</span>' : ''}`;
    };
    const pintar = () => {
      const compra = T.$('#esCompra', cu).checked;
      T.$('#cab', cu).classList.toggle('oculto', !compra);
      T.$('#filas', cu).innerHTML = filas.length ? `<div class="tabla-caja"><table class="tabla tabla-entrada"><thead><tr><th style="min-width:260px">Producto</th><th>Código</th><th>Categoría</th><th class="der">Cantidad</th><th class="der">Costo c/u</th><th class="der">Precio venta</th><th></th></tr></thead><tbody>
        ${filas.map((f, i) => {
          const p = f.productoId && T.db.get('productos', f.productoId), cats = T.categorias(), cat = p ? p.categoria : f.categoria;
          if (cat && !cats.includes(cat)) cats.push(cat);
          return `<tr data-i="${i}" class="${f.revisar ? 'revisar' : ''}">
          <td><div class="fila" style="flex-wrap:nowrap;align-items:flex-start">${f.foto ? `<img class="mini-foto" src="${f.foto}" alt="">` : ''}<div class="crece">
            <input data-k="nombre" value="${T.esc(p ? p.nombre : f.nombre)}" ${p ? 'disabled' : ''} aria-label="Nombre">
            <select data-k="productoId" aria-label="Producto existente" style="margin-top:4px"><option value="">➕ Crear como producto nuevo</option>${f.candidatos.map(c => `<option value="${c.id}" ${c.id === f.productoId ? 'selected' : ''}>Es el mismo que: ${T.esc(c.nombre)} (hay ${T.cant(c.stock)})</option>`).join('')}</select>
            <div class="ent-etqs" data-etq>${etiquetas(f)}</div></div></div></td>
          <td><input data-k="codigo" value="${T.esc(p ? p.codigo || '' : f.codigo || '')}" ${p ? 'disabled' : ''} style="width:130px" aria-label="Código"></td>
          <td><select data-k="categoria" ${p ? 'disabled' : ''} aria-label="Categoría" style="min-width:130px">${['', ...cats].map(c => `<option ${c === cat ? 'selected' : ''}>${T.esc(c)}</option>`).join('')}</select></td>
          <td class="der"><input data-k="cantidad" type="number" step="any" value="${f.cantidad ?? ''}" style="width:84px;text-align:right" aria-label="Cantidad">${presDe(f).length ? `<select data-k="presCompra" style="margin-top:4px;width:auto" aria-label="Se compra por"><option value="">unidades</option>${presDe(f).map(x => `<option value="${x.id}" ${x.id === f.presCompra ? 'selected' : ''}>${T.esc(x.nombre)}</option>`).join('')}</select>` : ''}</td>
          <td class="der"><input data-k="costo" type="number" value="${f.costo || ''}" style="width:104px;text-align:right" aria-label="Costo por unidad"></td>
          <td class="der"><input data-k="precio" type="number" value="${f.precio || ''}" style="width:104px;text-align:right" aria-label="Precio de venta">${p && p.precio && f.precio !== p.precio ? `<br><small class="suave">antes ${T.money(p.precio)}</small>` : ''}</td>
          <td><button class="btn-ico" data-quitar aria-label="Quitar" title="Quitar">${T.ico('borrar')}</button></td></tr>`;
        }).join('')}</tbody></table></div>` : '<p class="vacio">Agregue productos con el buscador de abajo.</p>';
      pintarTotal();
    };
    const pintarTotal = () => {
      const total = filas.reduce((a, f) => a + T.red((f.cantidad || 0) * (f.costo || 0)), 0), nuevos = filas.filter(f => !f.productoId).length;
      const malos = filas.filter(f => bajoCosto(f) || sinPrecio(f)).length, revisar = filas.filter(f => f.revisar).length;
      T.$('#avisos-ent', cu).innerHTML = (malos ? `<div class="banda aviso">${T.ico('alerta')}<span>${malos} producto(s) sin precio de venta o con precio menor que el costo.</span><button class="btn" id="sugerir">Poner precio con ${T.regla('margenDefecto')}% de ganancia</button></div>` : '')
        + (revisar ? `<div class="banda aviso">${T.ico('alerta')}<span>Revise ${revisar === 1 ? 'el renglón marcado' : `los ${revisar} renglones marcados`}: compárelo${revisar === 1 ? '' : 's'} con la factura.</span></div>` : '');
      const dif = totalFactura ? totalFactura - total : 0;
      T.$('#tot', cu).innerHTML = filas.length ? `<span><b>${filas.length}</b> producto(s)</span><span><b>${nuevos}</b> nuevo(s)</span><span><b>${filas.length - nuevos}</b> ya existen</span><span class="crece"></span>
        ${totalFactura ? `<span class="etq ${Math.abs(dif) <= 100 ? 'ok' : 'aviso'}">${Math.abs(dif) <= 100 ? `${T.ico('ok')} Cuadra con la factura` : `La factura dice ${T.money(totalFactura)} · diferencia ${T.money(Math.abs(dif))}`}</span>` : ''}<span>Total a costo <b class="num">${T.money(total)}</b></span>` : '';
    };
    // Solo se redibuja la tabla al enlazar un producto: así no se pierde el foco al pasar de casilla.
    T.$('#filas', cu).onchange = e => {
      const tr = e.target.closest('tr'), k = e.target.dataset.k; if (!tr || !k) return;
      const f = filas[+tr.dataset.i];
      if (k === 'productoId') { f.productoId = ''; f.presCompra = ''; if (e.target.value) enlazar(f, T.db.get('productos', e.target.value)); else if (!f.precio && f.costo) f.precio = T.neg.precioSugerido(f.costo); return pintar(); }
      if (k === 'presCompra') {   // el costo pasa de "por unidad" a "por paca" (o al revés)
        const antes = factorDe(f); f.presCompra = e.target.value;
        f.costo = T.red((f.costo || 0) / antes * factorDe(f)); return pintar();
      }
      if (['cantidad', 'costo', 'precio'].includes(k)) {
        f[k] = T.aNum(e.target.value);
        if (k !== 'precio') f.revisar = '';
        if (k === 'costo' && !f.precio && f.costo) { f.precio = T.neg.precioSugerido(f.costo); T.$('[data-k=precio]', tr).value = f.precio; }
      } else f[k] = e.target.value.trim();
      T.$('[data-etq]', tr).innerHTML = etiquetas(f);
      tr.classList.toggle('revisar', !!f.revisar);
      pintarTotal();
    };
    T.$('#filas', cu).onclick = e => { const b = e.target.closest('[data-quitar]'); if (b) { filas.splice(+b.closest('tr').dataset.i, 1); pintar(); } };
    T.$('#avisos-ent', cu).onclick = e => {
      if (!e.target.closest('#sugerir')) return;
      filas.forEach(f => { if ((bajoCosto(f) || sinPrecio(f)) && f.costo > 0) f.precio = T.neg.precioSugerido(f.costo / factorDe(f)); });
      pintar();
    };
    const doc = T.$('.doc-tira', cu);
    if (doc) doc.onclick = e => { const b = e.target.closest('[data-ver]'); if (b) verArchivo(fotos[+b.dataset.ver], `Factura ${factura || ''} · hoja ${+b.dataset.ver + 1}`); };
    const infoProv = () => {
      const p = provDe(), nom = T.$('#prov', cu).value.trim();
      T.$('#prov-info', cu).textContent = !nom ? '' : p ? `Proveedor registrado: ${p.nombre}${p.nit ? ' · NIT ' + p.nit : ''}` : `Proveedor nuevo: se crea al subir${nit ? ' · NIT ' + nit : ''}`;
    };
    T.$('#prov', cu).oninput = infoProv;
    T.$('#esCompra', cu).onchange = pintar;
    T.$('#nuevo', cu).onclick = () => { filas.push({ nombre: '', codigo: '', categoria: '', unidad: 'und', cantidad: 1, costo: 0, precio: 0, candidatos: [], productoId: '' }); pintar(); const i = T.$$('#filas [data-k=nombre]', cu).pop(); if (i) i.focus(); };
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
    pintar(); infoProv();

    async function guardar() {
      const compra = T.$('#esCompra', cu).checked, nomProv = T.$('#prov', cu).value.trim(), numFac = T.$('#fac', cu).value.trim();
      if (!filas.length) throw new Error('No hay productos para guardar');
      const items = filas.map(f => {
        if (!f.productoId && !f.nombre) throw new Error('Hay un producto sin nombre');
        if (!(f.cantidad > 0)) throw new Error(`Falta la cantidad de "${f.nombre}"`);
        if (sinPrecio(f)) throw new Error(`Falta el precio de venta de "${f.nombre}"`);
        return { productoId: f.productoId || null, nuevo: f.productoId ? null : { nombre: f.nombre, codigo: f.codigo || '', categoria: f.categoria || '', marca: f.marca || '', unidad: f.unidad || 'und', foto: f.foto || '', iva: f.iva || 0 }, cantidad: T.r3((f.cantidad || 0) * factorDe(f)), costo: T.red((f.costo || 0) / factorDe(f)), precio: f.precio || 0 };
      });
      let prov = compra && nomProv ? provDe() : null;
      // Una misma factura no se sube dos veces por error.
      if (compra && numFac) {
        const ya = (await T.db.todos('compras')).find(c => T.norm(c.factura) === T.norm(numFac) && (!prov || !c.proveedorId || c.proveedorId === prov.id) && (prov || !nomProv || T.norm(c.proveedor) === T.norm(nomProv)));
        if (ya && !await T.confirmar(`La factura ${numFac}${ya.proveedor ? ' de ' + ya.proveedor : ''} ya se subió el ${T.fechaHora(ya.fecha)} (compra ${ya.numero}, ${T.money(ya.total)}).\n\n¿Subirla otra vez? Las existencias se sumarían de nuevo.`, { titulo: 'Factura repetida', ok: 'Sí, subir otra vez', peligro: true })) return false;
      }
      if (compra && nomProv && !prov) prov = await T.neg.guardarProveedor({ nombre: nomProv, nit: nit || '', telefono: telefono || '' });
      const r = await T.neg.entrada({ items, esCompra: compra, proveedorId: prov ? prov.id : null, factura: numFac, pago: T.$('#pago', cu).value, origen, nota: fechaFactura ? 'Factura del ' + T.fechaCorta(fechaFactura) : '' });
      if (deFactura) await T.db.setLoc(BORRADOR, null);
      T.toast(`Subido al inventario: ${r.productos} producto(s)${r.nuevos ? `, ${r.nuevos} nuevo(s)` : ''}${r.compra ? ` · compra ${r.compra.numero}` : ''}`, 'ok');
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
          ${T.auth.puede('compras.crear') && T.auth.puede('ia.usar') ? `<button class="btn ia" id="factura">${T.ico('factura')} Factura con IA</button>` : ''}
          ${editar && T.auth.puede('ia.usar') ? `<button class="btn" id="foto">${T.ico('camara')} Foto de productos</button>` : ''}
          ${editar ? `<button class="btn pri" id="nuevo">${T.ico('mas')} Producto</button><button class="btn" id="entrada">${T.ico('compras')} Entrada</button><button class="btn" id="imp">${T.ico('subir')} Importar</button>` : ''}
          <button class="btn" id="exp">${T.ico('bajar')} Excel (CSV)</button><button class="btn" id="pdf">${T.ico('pdf')} PDF / Imprimir</button></div></div>
        <div class="fila" style="margin-bottom:12px"><div class="buscador crece">${T.ico('buscar')}<input id="q" value="${T.esc(texto)}" placeholder="Nombre, marca o código"></div>
          <select id="filtro" style="width:auto">${[['todos', 'Todos'], ['bajos', 'Por agotarse'], ['agotados', 'Agotados'], ['vence', 'Vencidos o por vencer'], ['inactivos', 'Inactivos']].map(([v, t]) => `<option value="${v}" ${v === filtro ? 'selected' : ''}>${t}</option>`).join('')}</select>
          <select id="cat" style="width:auto"><option value="">Todas las categorías</option>${T.categorias().map(c => `<option ${c === cat ? 'selected' : ''}>${T.esc(c)}</option>`).join('')}</select></div>
        <p class="suave" id="resumen" style="margin-bottom:10px"></p><div id="tabla"></div>`;
      let visibles = [];
      const pintar = () => {
        const pals = T.norm(texto).split(/\s+/).filter(Boolean);
        const lista = todos.filter(p => (filtro === 'inactivos' ? p.activo === false : p.activo !== false) && (!cat || p.categoria === cat) &&
          (filtro !== 'bajos' || (p.stock > 0 && p.stockMin > 0 && p.stock <= p.stockMin)) && (filtro !== 'agotados' || p.stock <= 0) && (filtro !== 'vence' || (p.vence && p.vence <= lim && p.stock > 0)) &&
          (!pals.length || p.codigo === texto.trim() || pals.every(w => T.norm(`${p.nombre} ${p.marca || ''} ${p.codigo || ''}`).includes(w)))).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
        visibles = lista;
        T.$('#resumen', el).textContent = `${lista.length} producto(s)` + (verCosto ? ` · Vale a costo ${T.money(lista.reduce((a, p) => a + Math.max(0, p.stock) * (p.costo || 0), 0))} · a precio de venta ${T.money(lista.reduce((a, p) => a + Math.max(0, p.stock) * (p.precio || 0), 0))}` : '');
        T.$('#tabla', el).innerHTML = T.tabla([
          { t: '', v: p => p.foto ? `<img class="mini-foto" src="${p.foto}" alt="" loading="lazy">` : `<span class="mini-foto ini" style="--h:${T.tono(p.categoria || p.nombre)}">${T.esc(T.iniciales(p.nombre))}</span>` },
          { t: 'Producto', v: p => `<b>${T.esc(p.nombre)}</b><br><small class="suave">${T.esc([p.categoria, p.marca, p.codigo].filter(Boolean).join(' · '))}</small>${(p.presentaciones || []).length ? `<br><small class="suave">${p.presentaciones.map(x => `${T.esc(x.nombre)}: ${T.money(x.precio)}`).join(' · ')}</small>` : ''}` },
          ...(verCosto ? [{ t: 'Costo', cls: 'der num', v: p => T.money(p.costo) }] : []),
          { t: 'Precio', cls: 'der num', v: p => `<b>${T.money(p.precio)}</b>${verCosto && p.costo && p.precio ? `<br><small class="suave">${Math.round((p.precio - p.costo) / p.precio * 100)}% margen</small>` : ''}` },
          { t: 'Hay', cls: 'der num', v: p => `<span class="etq ${p.stock <= 0 ? 'mal' : p.stockMin > 0 && p.stock <= p.stockMin ? 'aviso' : 'ok'}">${T.cant(p.stock)} ${p.unidad !== 'und' ? p.unidad : ''}</span>` },
          { t: 'Vence', v: p => p.vence ? `<span class="etq ${p.vence < hoy ? 'mal' : p.vence <= lim ? 'aviso' : ''}">${T.fechaCorta(p.vence)}</span>` : '' },
          { t: '', cls: 'acc', v: p => `${editar ? `<button class="btn-ico" data-a="editar" data-p="${p.id}" title="Editar">${T.ico('editar')}</button>` : ''}${T.auth.puede('inventario.ajustar') ? `<button class="btn mini" data-a="ajustar" data-p="${p.id}">Ajustar</button>` : ''}<button class="btn-ico" data-a="kardex" data-p="${p.id}" title="Kárdex (movimientos)">${T.ico('lista')}</button>` }
        ], lista.slice(0, 300), todos.length ? 'Ningún producto coincide con el filtro.' : 'El inventario está vacío. Use “Factura con IA”, “Foto de productos” o “Producto”.') + (lista.length > 300 ? `<p class="suave centro" style="margin-top:8px">Se muestran 300 de ${lista.length}. Use el buscador.</p>` : '');
      };
      T.$('#q', el).oninput = e => { texto = e.target.value; pintar(); };
      T.$('#filtro', el).onchange = e => { filtro = e.target.value; pintar(); };
      T.$('#cat', el).onchange = e => { cat = e.target.value; pintar(); };
      T.$('#exp', el).onclick = exportar;
      T.$('#pdf', el).onclick = () => {
        const f = [filtro !== 'todos' && T.$('#filtro', el).selectedOptions[0].textContent, cat, texto && `búsqueda "${texto}"`].filter(Boolean).join(' · ');
        T.informes.inventario(visibles, f);
      };
      const en = (id, fn) => { const b = T.$(id, el); if (b) b.onclick = fn; };
      en('#foto', () => T.ui.fotoIA('productos'));
      en('#factura', () => T.ui.facturaIA());
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
