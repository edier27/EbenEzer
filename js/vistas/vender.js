'use strict';
// ════════════ VENDER (punto de venta) ════════════
// El lector de código de barras USB funciona solo: escribe el código en el
// buscador y da Enter. F2 = cobrar · F4 = buscar · Esc = cerrar ventanas.
(function (T) {
  T.ui = T.ui || {};
  let carrito = [], clienteId = '', categoria = '', autorizaDesc = '';

  const guardar = () => T.db.setLoc('carrito', { carrito, clienteId });
  const totales = () => T.neg.calcular(carrito);
  const cantEnCarrito = id => carrito.filter(l => l.productoId === id).reduce((a, l) => a + l.cantidad, 0);

  // ── Recibo ──
  T.ui.reciboHTML = v => {
    const n = T.db.cfg('negocio', {});
    return `<div class="recibo" style="max-width:${n.anchoRecibo === 58 ? 200 : 300}px">
      <h5>${T.esc(n.nombre || 'Tienda')}</h5>
      <div class="c">${n.nit ? 'NIT ' + T.esc(n.nit) + '<br>' : ''}${T.esc(n.direccion || '')}${n.telefono ? '<br>Tel. ' + T.esc(n.telefono) : ''}</div><hr>
      <div>Recibo ${T.esc(v.numero)}<br>${T.fechaHora(v.fecha)}<br>Atendió: ${T.esc(v.usuario)}${v.cliente ? '<br>Cliente: ' + T.esc(v.cliente) : ''}</div>
      ${v.estado === 'anulada' ? '<div class="c t">*** ANULADA ***</div>' : ''}<hr>
      <table>${v.items.map(l => `<tr><td colspan="2">${T.esc(l.nombre)}</td></tr><tr><td>&nbsp;${T.cant(l.cantidad)} ${l.unidad !== 'und' ? l.unidad + ' ' : ''}× ${T.num(l.precio)}${l.descuento ? ` (−${T.num(l.descuento)})` : ''}</td><td>${T.num(l.total)}</td></tr>`).join('')}</table><hr>
      <table>
        ${v.descuento ? `<tr><td>Subtotal</td><td>${T.num(v.subtotal)}</td></tr><tr><td>Descuento</td><td>−${T.num(v.descuento)}</td></tr>` : ''}
        ${v.ajuste ? `<tr><td>Redondeo</td><td>${T.num(v.ajuste)}</td></tr>` : ''}
        <tr class="t"><td>TOTAL</td><td>${T.money(v.total)}</td></tr>
        ${v.impuesto ? `<tr><td>IVA incluido</td><td>${T.num(v.impuesto)}</td></tr>` : ''}
        ${v.pagos.map(p => `<tr><td>${T.METODOS[p.metodo]}</td><td>${T.num(p.monto)}</td></tr>`).join('')}
        ${v.cambio ? `<tr><td>Recibido</td><td>${T.num(v.recibido)}</td></tr><tr><td>Cambio</td><td>${T.num(v.cambio)}</td></tr>` : ''}
      </table><hr><div class="c">${T.esc(n.pie || '')}</div></div>`;
  };
  T.ui.verRecibo = (v, { nueva } = {}) => {
    const cli = v.clienteId && T.db.get('clientes', v.clienteId), tel = cli && String(cli.telefono || '').replace(/\D/g, '');
    const texto = `*${T.db.cfg('negocio', {}).nombre || 'Tienda'}*\nRecibo ${v.numero} · ${T.fechaHora(v.fecha)}\n${v.items.map(l => `${T.cant(l.cantidad)} × ${l.nombre}: ${T.money(l.total)}`).join('\n')}\n*TOTAL ${T.money(v.total)}*`;
    T.modal({
      titulo: nueva ? `Venta registrada${v.cambio ? ' · Cambio ' + T.money(v.cambio) : ''}` : 'Recibo ' + v.numero, ancho: 400, cuerpo: T.ui.reciboHTML(v),
      botones: [
        { txt: 'WhatsApp', cls: 'sec', fn: () => { window.open(`https://wa.me/${tel && tel.length === 10 ? '57' + tel : tel || ''}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener'); return false; } },
        { txt: T.ico('imprimir') + ' Imprimir', cls: 'sec', fn: () => { T.imprimir(T.ui.reciboHTML(v)); return false; } },
        { txt: nueva ? 'Nueva venta' : 'Cerrar', cls: 'pri' }
      ]
    });
  };

  // ── Lector de códigos con la cámara (celulares y equipos compatibles) ──
  T.ui.escanear = () => new Promise(async res => {
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices) { T.toast('Este equipo no puede leer códigos con la cámara. Use un lector USB o escriba el código.', 'error'); return res(null); }
    let flujo, activo = true;
    const m = T.modal({ titulo: 'Apunte al código de barras', ancho: 420, cuerpo: '<video class="video-scan" playsinline muted></video>', alCerrar: v => { activo = false; if (flujo) flujo.getTracks().forEach(t => t.stop()); res(v); } });
    try {
      flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = T.$('video', m.el), det = new BarcodeDetector();
      video.srcObject = flujo; await video.play();
      const ciclo = async () => {
        if (!activo) return;
        try { const r = await det.detect(video); if (r.length) return m.cerrar(r[0].rawValue); } catch (e) { /* cuadro sin leer */ }
        setTimeout(ciclo, 180);
      };
      ciclo();
    } catch (e) { T.toast('No se pudo usar la cámara: ' + e.message, 'error'); m.cerrar(null); }
  });

  T.vistas.vender = {
    render(el) {
      const g = T.db.loc('carrito');
      if (g && !carrito.length) { carrito = (g.carrito || []).filter(l => T.db.get('productos', l.productoId)); clienteId = g.clienteId || ''; }
      el.innerHTML = `<div class="pos">
        <section>
          <div class="pos-buscar"><div class="buscador">${T.ico('buscar')}<input id="q" placeholder="Buscar producto o pasar el código de barras" autocomplete="off" autofocus><kbd>F4</kbd></div>
            <button class="btn" id="scan" title="Leer código con la cámara" aria-label="Leer código con la cámara">${T.ico('codigo')}</button></div>
          <div class="chips" id="cats"></div><div class="prods" id="prods"></div>
        </section>
        <aside class="tiquete">
          <div class="tiq-cab">
            <div class="titulo"><h3>Venta actual</h3><span class="etq" id="cuenta"></span></div>
            <div class="cliente"><div class="buscador cli-buscar">${T.ico('clientes')}<input id="cli" placeholder="Cliente general · buscar cliente" autocomplete="off" aria-label="Buscar cliente" role="combobox" aria-expanded="false" aria-controls="cli-lista">
                <button class="btn-ico oculto" id="cli-x" title="Quitar cliente" aria-label="Quitar cliente">${T.ico('x')}</button>
                <div class="cli-lista oculto" id="cli-lista" role="listbox"></div></div>
              <button class="btn-ico" id="nuevo-cli" title="Cliente nuevo" aria-label="Cliente nuevo">${T.ico('mas')}</button></div>
            <div class="cli-info oculto" id="cli-info"></div>
          </div>
          <div class="lineas" id="lineas"></div>
          <div class="tiq-pie">
            <div class="totales" id="totales"></div>
            <div class="tiq-acc"><button class="btn" id="desc">Descuento</button><button class="btn" id="espera">En espera</button><button class="btn" id="vaciar">Vaciar</button></div>
            <button class="cobrar" id="cobrar"><span>Cobrar</span><kbd>F2</kbd></button>
          </div>
        </aside>
        <button class="pos-flota oculto" id="flota"></button></div>`;
      // En celular la venta queda debajo de los productos: esta barra la mantiene a la vista.
      T.$('#flota', el).onclick = () => T.$('.tiquete', el).scrollIntoView({ behavior: 'smooth', block: 'start' });
      const q = T.$('#q', el);
      const pintarCats = () => {
        T.$('#cats', el).innerHTML = ['', ...T.categorias()].map(c => `<button data-c="${T.esc(c)}" class="${c === categoria ? 'activo' : ''}">${T.esc(c || 'Todo')}</button>`).join('');
      };
      const pintarProds = () => {
        const t = T.norm(q.value), pals = t.split(/\s+/).filter(Boolean);
        const lista = T.db.lista('productos').filter(p => p.activo !== false && (!categoria || p.categoria === categoria) &&
          (!t || p.codigo === q.value.trim() || pals.every(w => T.norm(p.nombre + ' ' + (p.marca || '')).includes(w)))).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).slice(0, 60);
        T.$('#prods', el).innerHTML = lista.length ? lista.map(p => `<button class="prod ${p.stock <= 0 ? 'agotado' : ''}" data-p="${p.id}">
            <span class="prod-img" style="--h:${T.tono(p.categoria || p.nombre)}">${p.foto ? `<img src="${p.foto}" alt="" loading="lazy">` : T.esc(T.iniciales(p.nombre))}</span>
            <span class="prod-nom">${T.esc(p.nombre)}</span>
            <span class="prod-pie"><span class="precio">${T.money(p.precio)}</span><small class="${p.stock > 0 && p.stockMin > 0 && p.stock <= p.stockMin ? 'poco' : ''}">${p.stock <= 0 ? 'Agotado' : T.cant(p.stock) + (p.unidad && p.unidad !== 'und' ? ' ' + p.unidad : ' und')}</small></span></button>`).join('')
          : `<p class="vacio" style="grid-column:1/-1">${T.db.lista('productos').length ? 'Ningún producto coincide.' : 'Aún no hay productos. Vaya a Inventario para agregarlos.'}</p>`;
        return lista;
      };
      // Cliente: buscador por nombre, celular o cédula. Vacío = cliente general.
      const cli = T.$('#cli', el), cliLista = T.$('#cli-lista', el);
      const pintarCli = () => {
        const c = clienteId && T.db.get('clientes', clienteId);
        if (!c) clienteId = '';
        cli.value = c ? c.nombre : '';
        T.$('#cli-x', el).classList.toggle('oculto', !c);
        const info = T.$('#cli-info', el);
        info.classList.toggle('oculto', !c);
        if (c) info.innerHTML = `${c.saldo > 0 ? `<span class="etq ${c.saldo >= c.cupo ? 'mal' : 'aviso'}">Debe ${T.money(c.saldo)}</span>` : '<span class="etq ok">Al día</span>'}<span>Puede fiar ${T.money(Math.max(0, (c.cupo || 0) - (c.saldo || 0)))} más</span>`;
      };
      const cerrarCli = () => { cliLista.classList.add('oculto'); cli.setAttribute('aria-expanded', 'false'); };
      const buscarCli = () => {
        const t = T.norm(cli.value);
        const lista = T.db.lista('clientes').filter(c => !t || T.norm(`${c.nombre} ${c.telefono || ''} ${c.documento || ''}`).includes(t))
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).slice(0, 8);
        cliLista.innerHTML = `<button data-cli="" role="option">Cliente general<small>Venta sin nombre</small></button>` + lista.map(c => `<button data-cli="${c.id}" role="option"><span>${T.esc(c.nombre)}<small>${T.esc(c.telefono || 'Sin celular')}</small></span>${c.saldo > 0 ? `<span class="etq aviso">Debe ${T.money(c.saldo)}</span>` : ''}</button>`).join('')
          + (t && !lista.length ? '<p class="suave">Ningún cliente con ese nombre. Use el botón + para crearlo.</p>' : '');
        cliLista.classList.remove('oculto'); cli.setAttribute('aria-expanded', 'true');
        return lista;
      };
      const elegirCli = id => { clienteId = id || ''; guardar(); pintarCli(); cerrarCli(); };
      cli.onfocus = () => { cli.select(); buscarCli(); };
      cli.oninput = buscarCli;
      cli.onkeydown = e => {
        if (e.key === 'Enter') { e.preventDefault(); const l = buscarCli(); elegirCli(cli.value.trim() && l[0] ? l[0].id : ''); q.focus(); }
        if (e.key === 'Escape') { e.stopPropagation(); pintarCli(); cerrarCli(); cli.blur(); }
      };
      cli.onblur = () => setTimeout(() => { pintarCli(); cerrarCli(); }, 160);
      cliLista.onmousedown = e => { const b = e.target.closest('[data-cli]'); if (b) { e.preventDefault(); elegirCli(b.dataset.cli); q.focus(); } };
      T.$('#cli-x', el).onclick = () => elegirCli('');
      const pintar = () => {
        const t = totales();
        T.$('#lineas', el).innerHTML = carrito.length ? carrito.map((l, i) => `<div class="linea" data-i="${i}">
          <span class="paso"><button data-a="menos" aria-label="Menos">${T.ico('menos')}</button><input type="number" step="any" inputmode="decimal" value="${l.cantidad}" aria-label="Cantidad"><button data-a="mas" aria-label="Más">${T.ico('mas')}</button></span>
          <span class="nom" title="${T.esc(l.nombre)}">${T.esc(l.nombre)}</span><span class="tot num">${T.money(l.precio * l.cantidad - (l.descuento || 0))}</span>
          <span class="det"><button class="precio-u num" data-a="precio" title="Cambiar precio">${T.money(l.precio)}${l.unidad !== 'und' ? '/' + l.unidad : ' c/u'}</button>${l.descuento ? `<span class="etq aviso">−${T.money(l.descuento)}</span>` : ''}</span>
          <button class="btn-ico quitar" data-a="quitar" aria-label="Quitar" title="Quitar">${T.ico('x')}</button></div>`).join('')
          : `<div class="vacio">${T.ico('vender')}<span>Busque un producto o pase<br>el código de barras</span></div>`;
        const unidades = carrito.reduce((a, l) => a + (l.unidad === 'und' ? l.cantidad : 1), 0);
        T.$('#cuenta', el).textContent = carrito.length ? `${T.cant(unidades)} artículo${unidades === 1 ? '' : 's'}` : 'Vacía';
        T.$('#flota', el).classList.toggle('oculto', !carrito.length);
        T.$('#flota', el).innerHTML = `<span>${T.cant(unidades)} artículo${unidades === 1 ? '' : 's'} · Ver venta</span><b class="num">${T.money(t.total)}</b>`;
        const enEspera = T.db.loc('espera', []).length;
        T.$('#espera', el).textContent = carrito.length || !enEspera ? 'En espera' : `Recuperar (${enEspera})`;
        T.$('#totales', el).innerHTML = `${t.descuento ? `<div><span>Subtotal</span><span class="num">${T.money(t.subtotal)}</span></div><div><span>Descuento</span><span class="num">−${T.money(t.descuento)}</span></div>` : ''}
          ${t.ajuste ? `<div><span>Redondeo</span><span class="num">${T.money(t.ajuste)}</span></div>` : ''}
          <div class="total"><span>Total</span><span class="num">${T.money(t.total)}</span></div>`;
        T.$('#cobrar', el).disabled = !carrito.length;
        guardar();
      };
      const agregar = async p => {
        if (p.stock - cantEnCarrito(p.id) <= 0 && !T.regla('venderSinStock')) return T.toast(`No hay existencias de "${p.nombre}"`, 'error');
        let cant = 1;
        if (['kg', 'lb', 'g', 'l', 'ml'].includes(p.unidad)) {
          const r = await T.pedir({ titulo: p.nombre, ok: 'Agregar', ancho: 360, campos: [{ id: 'c', label: `Cantidad en ${T.UNIDADES[p.unidad].toLowerCase()}s — ${T.money(p.precio)} por ${p.unidad}`, tipo: 'number', req: true }] });
          if (!r || !(r.c > 0)) return q.focus();
          cant = r.c;
        }
        const l = carrito.find(x => x.productoId === p.id && !x.descuento);
        if (l) l.cantidad = T.r3(l.cantidad + cant);
        else carrito.push({ productoId: p.id, nombre: p.nombre, unidad: p.unidad || 'und', precio: p.precio, cantidad: cant, descuento: 0 });
        pintar(); q.value = ''; pintarProds(); q.focus();
      };

      q.oninput = pintarProds;
      q.onkeydown = e => {
        if (e.key !== 'Enter') return;
        const exacto = T.neg.buscarCodigo(q.value.trim()), lista = pintarProds();
        if (exacto) agregar(exacto); else if (lista.length === 1) agregar(lista[0]); else if (q.value.trim()) T.toast('No se encontró ese código', 'error');
      };
      T.$('#scan', el).onclick = async () => {
        const cod = await T.ui.escanear();
        if (!cod) return;
        const p = T.neg.buscarCodigo(cod);
        if (p) agregar(p); else { q.value = cod; pintarProds(); T.toast('Ese código no está en el inventario', 'error'); }
      };
      T.$('#cats', el).onclick = e => { const b = e.target.closest('[data-c]'); if (b) { categoria = b.dataset.c; pintarCats(); pintarProds(); } };
      T.$('#prods', el).onclick = e => { const b = e.target.closest('[data-p]'); if (b) agregar(T.db.get('productos', b.dataset.p)); };
      T.$('#nuevo-cli', el).onclick = async () => { const c = await T.ui.editarCliente(); if (c) { clienteId = c.id; pintarCli(); guardar(); } };

      T.$('#lineas', el).onclick = async e => {
        const b = e.target.closest('[data-a]'); if (!b) return;
        const i = +b.closest('.linea').dataset.i, l = carrito[i];
        if (b.dataset.a === 'mas') l.cantidad = T.r3(l.cantidad + 1);
        if (b.dataset.a === 'menos') { l.cantidad = T.r3(l.cantidad - 1); if (l.cantidad <= 0) carrito.splice(i, 1); }
        if (b.dataset.a === 'quitar') carrito.splice(i, 1);
        if (b.dataset.a === 'precio') {
          const quien = await T.auth.autorizar('ventas.precio', l.nombre);
          if (!quien) return;
          const r = await T.pedir({ titulo: 'Precio de ' + l.nombre, ancho: 360, ok: 'Cambiar', campos: [{ id: 'p', label: 'Precio por ' + (T.UNIDADES[l.unidad] || 'unidad').toLowerCase(), tipo: 'number', valor: l.precio, req: true }] });
          if (!r) return;
          const p = T.db.get('productos', l.productoId);
          if (T.regla('bloquearBajoCosto') && r.p < (p.costo || 0)) return T.toast('Ese precio queda por debajo del costo', 'error');
          l.precio = T.red(r.p); l.descuento = 0; autorizaDesc = quien;
        }
        pintar();
      };
      T.$('#lineas', el).onchange = e => {
        if (e.target.tagName !== 'INPUT') return;
        const i = +e.target.closest('.linea').dataset.i, c = T.r3(T.aNum(e.target.value));
        if (c > 0) carrito[i].cantidad = c; else carrito.splice(i, 1);
        pintar();
      };
      T.$('#vaciar', el).onclick = async () => { if (carrito.length && await T.confirmar('¿Vaciar la venta actual?', { peligro: true, ok: 'Vaciar' })) { carrito = []; clienteId = ''; autorizaDesc = ''; pintar(); pintarCli(); } };
      T.$('#desc', el).onclick = async () => {
        if (!carrito.length) return;
        const r = await T.pedir({ titulo: 'Descuento a toda la venta', ancho: 360, ok: 'Aplicar', campos: [{ id: 'pct', label: `Porcentaje (hasta ${T.regla('descMaxPct')}% sin autorización)`, tipo: 'number', valor: 0, req: true }] });
        if (!r) return;
        if (r.pct < 0 || r.pct > 100) return T.toast('Porcentaje inválido', 'error');
        autorizaDesc = '';
        if (r.pct > T.regla('descMaxPct')) { autorizaDesc = await T.auth.autorizar('ventas.descuento', `${r.pct}%`); if (!autorizaDesc) return; }
        carrito.forEach(l => { l.descuento = T.red(l.precio * l.cantidad * r.pct / 100); });
        pintar();
      };
      T.$('#espera', el).onclick = async () => {
        const lista = T.db.loc('espera', []);
        if (carrito.length) {
          lista.push({ id: T.uid(), fecha: Date.now(), carrito, clienteId, total: totales().total });
          await T.db.setLoc('espera', lista);
          carrito = []; clienteId = ''; pintar(); pintarCli();
          return T.toast('Venta puesta en espera', 'ok');
        }
        if (!lista.length) return T.toast('No hay ventas en espera');
        const m = T.modal({ titulo: 'Ventas en espera', ancho: 420, cuerpo: `<ul class="lista-simple">${lista.map(x => `<li><span>${T.hora(x.fecha)} · ${x.carrito.length} producto(s) · ${T.esc((T.db.get('clientes', x.clienteId) || {}).nombre || 'Cliente general')}</span><button class="btn mini pri" data-e="${x.id}">${T.money(x.total)}</button></li>`).join('')}</ul>` });
        m.cuerpo.onclick = async e => {
          const b = e.target.closest('[data-e]'); if (!b) return;
          const x = lista.find(y => y.id === b.dataset.e);
          carrito = x.carrito; clienteId = x.clienteId;
          await T.db.setLoc('espera', lista.filter(y => y !== x));
          m.cerrar(); pintar(); pintarCli();
        };
      };

      const cobrar = () => {
        if (!carrito.length || T.$('.modal-fondo')) return;
        try { T.neg.exigirCaja(); } catch (e) { T.toast(e.message, 'error'); location.hash = '#caja'; return; }
        const t = totales();
        let metodo = 'efectivo';
        const m = T.modal({
          titulo: 'Cobrar', ancho: 440,
          cuerpo: `<div class="gran-total"><span class="suave">Total a pagar</span><b class="num">${T.money(t.total)}</b></div>
            <div class="metodos">${Object.entries(T.METODOS).map(([k, v]) => `<button data-m="${k}" class="${k === metodo ? 'activo' : ''}">${v}</button>`).join('')}</div>
            <div id="ef"><label class="campo"><span>Recibe en efectivo</span><input type="number" id="recibe" inputmode="numeric" placeholder="${t.total}" autofocus></label>
              <div class="billetes">${[2000, 5000, 10000, 20000, 50000, 100000].filter(b => b >= t.total || b >= 10000).map(b => `<button class="btn mini" data-b="${b}">${T.num(b)}</button>`).join('')}</div></div>
            <label class="campo check" style="margin-top:10px"><input type="checkbox" id="mixto"><span>Pago mixto (parte con otro medio)</span></label>
            <div id="mix" class="form oculto"><label class="campo medio"><span>Otro medio</span><select id="m2">${Object.entries(T.METODOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
              <label class="campo medio"><span>Valor con ese medio</span><input type="number" id="v2" inputmode="numeric"></label></div>
            <div class="cambio" id="cambio"></div>`,
          botones: [{ txt: 'Cancelar', cls: 'sec' }, { txt: 'Registrar venta', cls: 'pri grande', id: 'ok', fn: () => registrar() }]
        });
        const c = m.cuerpo, recibe = T.$('#recibe', c);
        const partes = () => {
          const v2 = T.$('#mixto', c).checked ? Math.min(t.total, Math.max(0, T.red(T.aNum(T.$('#v2', c).value)))) : 0;
          return { v2, m2: T.$('#m2', c).value, v1: t.total - v2 };
        };
        const ver = () => {
          const p = partes(), ef = (metodo === 'efectivo' ? p.v1 : 0) + (p.v2 && p.m2 === 'efectivo' ? p.v2 : 0);
          T.$('#ef', c).classList.toggle('oculto', !ef);
          T.$('#mix', c).classList.toggle('oculto', !T.$('#mixto', c).checked);
          const rec = recibe.value === '' ? ef : T.aNum(recibe.value), caj = T.$('#cambio', c);
          caj.classList.toggle('falta', ef > 0 && rec < ef);
          caj.textContent = !ef ? `${T.METODOS[metodo]}: ${T.money(p.v1)}` : rec < ef ? `Faltan ${T.money(ef - rec)}` : `Cambio: ${T.money(rec - ef)}`;
        };
        c.onclick = e => {
          const bm = e.target.closest('[data-m]'), bb = e.target.closest('[data-b]');
          if (bm) { metodo = bm.dataset.m; T.$$('[data-m]', c).forEach(x => x.classList.toggle('activo', x === bm)); }
          if (bb) recibe.value = bb.dataset.b;
          ver();
        };
        c.oninput = ver;
        c.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); T.$('[data-id=ok]', m.el).click(); } };
        ver();

        async function registrar() {
          const p = partes(), pagos = [{ metodo, monto: p.v1 }];
          if (p.v2) { if (p.m2 === metodo) throw new Error('Para pago mixto elija dos medios distintos'); pagos.push({ metodo: p.m2, monto: p.v2 }); }
          const ef = pagos.filter(x => x.metodo === 'efectivo').reduce((a, x) => a + x.monto, 0);
          const datos = { items: carrito, pagos, clienteId: clienteId || null, recibido: ef ? (recibe.value === '' ? ef : T.aNum(recibe.value)) : null, autoriza: autorizaDesc };
          let v;
          for (; ;) {
            try { v = await T.neg.venta(datos); break; }
            catch (e) {
              // Reglas que un supervisor puede levantar con su clave.
              const permiso = /supera su cupo/.test(e.message) && !datos.sinCupo ? 'clientes.cupo' : /No hay suficiente/.test(e.message) && !datos.sinStock ? 'ventas.sinstock' : null;
              if (!permiso) throw e;
              const quien = await T.auth.autorizar(permiso, e.message);
              if (!quien) return false;
              datos[permiso === 'clientes.cupo' ? 'sinCupo' : 'sinStock'] = true; datos.autoriza = quien;
            }
          }
          carrito = []; clienteId = ''; autorizaDesc = '';
          pintar(); pintarCli(); pintarProds();
          setTimeout(() => T.ui.verRecibo(v, { nueva: true }), 0);
        }
      };
      T.$('#cobrar', el).onclick = cobrar;
      if (!this._teclas) {
        this._teclas = true;
        document.addEventListener('keydown', e => {
          if (T.app.actual !== 'vender') return;
          if (e.key === 'F2') { e.preventDefault(); const b = T.$('#cobrar'); if (b && !b.disabled) b.click(); }
          if (e.key === 'F4') { e.preventDefault(); const i = T.$('#q'); if (i) i.focus(); }
        });
      }
      pintarCats(); pintarProds(); pintarCli(); pintar();
    }
  };
})(window.T);
