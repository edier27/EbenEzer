'use strict';
// ════════════ CONFIGURACIÓN ════════════
(function (T) {
  const admin = () => T.auth.puede('config.editar');

  const SECCIONES = {
    negocio: ['Negocio', admin, el => {
      const n = T.db.cfg('negocio', {}), campos = [
        { id: 'nombre', label: 'Nombre de la tienda', req: true, valor: n.nombre }, { id: 'nit', label: 'NIT o cédula', medio: true, valor: n.nit }, { id: 'telefono', label: 'Teléfono', medio: true, valor: n.telefono },
        { id: 'direccion', label: 'Dirección', valor: n.direccion }, { id: 'pie', label: 'Mensaje al final del recibo', valor: n.pie },
        { id: 'anchoRecibo', label: 'Impresora de recibos', tipo: 'select', medio: true, valor: n.anchoRecibo || 80, opciones: [[80, 'Térmica de 80 mm'], [58, 'Térmica de 58 mm']] }];
      el.innerHTML = `<div class="tarjeta" style="max-width:620px">${T.form(campos)}<button class="btn pri" id="g" style="margin-top:14px">Guardar</button></div>`;
      T.$('#g', el).onclick = async () => { try { const v = T.leerForm(el, campos); v.anchoRecibo = Number(v.anchoRecibo); await T.db.setCfg('negocio', v); T.toast('Guardado', 'ok'); T.$('.marca b').textContent = v.nombre; } catch (e) { T.toast(e.message, 'error'); } };
    }],

    reglas: ['Reglas', admin, el => {
      const act = { ...T.REGLAS_DEF, ...T.db.cfg('reglas', {}) }, roles = T.roles();
      const campos = Object.entries(T.REGLAS_INFO).map(([id, [tipo, label, ayuda]]) => ({ id, tipo, label, ayuda, valor: act[id], medio: tipo === 'number' }));
      el.innerHTML = `<div class="tarjeta" style="margin-bottom:14px"><h4>Reglas que nunca se pueden apagar</h4><ul style="margin:0;padding-left:20px;line-height:1.7">
          <li>Las ventas no se borran: solo se anulan, con motivo y responsable.</li><li>Las existencias solo cambian por compras, ventas o ajustes con motivo (kárdex).</li>
          <li>La bitácora no se puede editar ni borrar.</li><li>Ningún registro se elimina de verdad: todo queda en el historial.</li><li>Siempre debe existir un administrador activo.</li></ul></div>
        <div class="tarjeta" style="margin-bottom:14px"><h4>Reglas del negocio</h4>${T.form(campos)}<button class="btn pri" id="g" style="margin-top:14px">Guardar reglas</button></div>
        <div class="tarjeta"><h4>Qué puede hacer cada cargo</h4><div class="tabla-caja"><table class="tabla"><thead><tr><th>Permiso</th>${Object.values(roles).map(r => `<th class="centro">${r.nombre}</th>`).join('')}</tr></thead>
          <tbody>${Object.entries(T.PERMISOS).map(([p, t]) => `<tr><td>${t}</td>${Object.entries(roles).map(([k, r]) => `<td class="centro"><input type="checkbox" data-rol="${k}" data-p="${p}" ${r.permisos.includes(p) ? 'checked' : ''} ${k === 'admin' ? 'disabled' : ''} aria-label="${t} — ${r.nombre}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>
          <button class="btn pri" id="gp" style="margin-top:14px">Guardar permisos</button></div>`;
      T.$('#g', el).onclick = async () => {
        try {
          const v = T.leerForm(el, campos), antes = {};
          for (const k of Object.keys(v)) { if (typeof v[k] === 'number' && v[k] < 0) throw new Error('Los valores no pueden ser negativos'); if (v[k] !== act[k]) antes[k] = [act[k], v[k]]; }
          await T.db.setCfg('reglas', v, antes); T.toast('Reglas guardadas', 'ok');
        } catch (e) { T.toast(e.message, 'error'); }
      };
      T.$('#gp', el).onclick = async () => {
        const nuevo = {};
        T.$$('[data-rol]', el).forEach(c => { if (c.dataset.rol !== 'admin') { (nuevo[c.dataset.rol] = nuevo[c.dataset.rol] || []); if (c.checked) nuevo[c.dataset.rol].push(c.dataset.p); } });
        await T.db.setCfg('roles', nuevo, 'permisos por cargo'); T.toast('Permisos guardados', 'ok');
      };
    }],

    usuarios: ['Usuarios', () => T.auth.puede('usuarios.editar'), function pintar(el) {
      const us = T.db.lista('usuarios').sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')), roles = T.roles();
      el.innerHTML = `<div class="fila" style="margin-bottom:12px"><button class="btn pri" id="nuevo">${T.ico('mas')} Usuario</button></div>` + T.tabla([
        { t: 'Nombre', v: u => `<b>${T.esc(u.nombre)}</b>` }, { t: 'Usuario', v: u => T.esc(u.usuario) }, { t: 'Cargo', v: u => roles[u.rol].nombre },
        { t: 'Estado', v: u => u.activo !== false ? '<span class="etq ok">Activo</span>' : '<span class="etq mal">Bloqueado</span>' },
        { t: '', cls: 'acc', v: u => `<button class="btn-ico" data-u="${u.id}" title="Editar">${T.ico('editar')}</button>` }], us);
      const editar = async u => {
        const campos = [{ id: 'nombre', label: 'Nombre completo', req: true, valor: u && u.nombre }, { id: 'usuario', label: 'Usuario', req: true, medio: true, valor: u && u.usuario },
        { id: 'rol', label: 'Cargo', tipo: 'select', medio: true, valor: u ? u.rol : 'cajero', opciones: Object.entries(roles).map(([k, r]) => [k, r.nombre]) },
        { id: 'pin', label: u ? 'Clave nueva (vacío = no cambiar)' : 'Clave (mínimo 4)', tipo: 'password', req: !u }, ...(u ? [{ id: 'activo', label: 'Puede entrar al sistema', tipo: 'check', valor: u.activo !== false }] : [])];
        if (await T.pedir({ titulo: u ? 'Editar usuario' : 'Usuario nuevo', campos, validar: async v => { await T.auth.guardarUsuario({ ...(u ? { id: u.id } : {}), ...v }); } })) pintar(el);
      };
      T.$('#nuevo', el).onclick = () => editar();
      el.onclick = e => { const b = e.target.closest('[data-u]'); if (b) editar(T.db.get('usuarios', b.dataset.u)); };
    }],

    ia: ['Inteligencia artificial', admin, function pintar(el) {
      const c = T.db.loc('ia', {});
      el.innerHTML = `<div class="tarjeta" style="max-width:620px"><h4>Google Gemini</h4>
        <p class="texto">La IA reconoce productos y facturas en fotos y responde preguntas del negocio. La clave es gratuita:\n1. Entre a <b>aistudio.google.com/apikey</b> con una cuenta de Google.\n2. Toque “Crear clave de API” y cópiela.\n3. Péguela aquí.</p>
        <label class="campo"><span>Clave de API</span><input type="password" id="clave" value="${T.esc(c.clave || '')}" placeholder="AIza…" autocomplete="off"><small>Se guarda solo en este equipo. No viaja en los respaldos ni a los otros equipos.</small></label>
        <label class="campo" style="margin-top:10px"><span>Modelo</span><select id="modelo"><option>${T.esc(T.ia.modelo())}</option></select><small>Si el modelo deja de existir, el sistema elige solo uno vigente.</small></label>
        <div class="fila" style="margin-top:14px"><button class="btn pri" id="g">Guardar</button><button class="btn" id="probar">Probar conexión</button></div><p id="res" class="suave" style="margin-top:10px"></p></div>`;
      const guardar = () => T.db.setLoc('ia', { clave: T.$('#clave', el).value.trim(), modelo: T.$('#modelo', el).value });
      T.$('#g', el).onclick = async () => { await guardar(); await T.registrar('config.cambiar', 'ia', 'clave o modelo de IA'); T.toast('Guardado', 'ok'); };
      T.$('#probar', el).onclick = async () => {
        const res = T.$('#res', el); res.textContent = 'Probando…';
        try {
          await guardar();
          const ms = await T.ia.modelos(), sel = T.$('#modelo', el), act = sel.value;
          sel.innerHTML = ms.map(m => `<option ${m === act ? 'selected' : ''}>${T.esc(m)}</option>`).join('');
          const r = await T.ia.llamar({ texto: 'Responde solo: OK' });
          res.textContent = `✔ Conexión correcta con ${T.ia.modelo()} (respondió: ${r.trim().slice(0, 30)})`;
        } catch (e) { res.textContent = '✖ ' + e.message; }
      };
    }],

    copias: ['Copias y nube', () => T.auth.puede('respaldo.gestionar'), async function pintar(el) {
      const pend = await T.sync.pendientes(), dias = T.respaldo.diasSin();
      let archivos = [];
      if (T.sync.hub) try { archivos = (await fetch('api/respaldo', { cache: 'no-store' }).then(r => r.json())).archivos; } catch (e) { /* servidor apagado */ }
      el.innerHTML = `<div class="rejilla dos">
        <div class="tarjeta"><h4>1 · Este equipo</h4><p class="texto">Todo se guarda al instante en este navegador, aunque no haya internet.\nÚltima copia: <b>${dias === null ? 'nunca' : dias === 0 ? 'hoy' : `hace ${dias} día(s)`}</b>.</p>
          <div class="fila"><button class="btn pri" id="bajar">${T.ico('bajar')} Descargar copia</button><button class="btn" id="subir">${T.ico('subir')} Restaurar copia</button></div></div>
        <div class="tarjeta"><h4>2 · Servidor de la tienda <span class="etq ${T.sync.hub ? 'ok' : ''}">${T.sync.hub ? 'Conectado' : 'No detectado'}</span></h4>
          ${T.sync.hub ? `<p class="texto">Cada cambio se copia al computador principal (carpeta <b>datos</b>) y se une con los demás equipos del WiFi. Pendientes por copiar: <b>${pend}</b>.${T.sync.claveHub ? `\nClave para conectar celulares y otros equipos: <b>${T.esc(T.sync.claveHub)}</b>` : ''}\nRespaldos completos guardados en la carpeta <b>respaldos</b>: <b>${archivos.length}</b>${archivos[0] ? `\nÚltimo: ${T.esc(archivos[0])}` : ''}</p><button class="btn" id="resp-srv">Hacer respaldo ahora</button>`
          : '<p class="texto">Abra la tienda con el archivo <b>Iniciar Tienda.bat</b> en el computador principal. Así los datos quedan también en el disco, se respaldan solos y los celulares del mismo WiFi comparten el mismo inventario.</p>'}</div>
        <div class="tarjeta"><h4>3 · Nube (Firebase) <span class="etq ${T.sync.nube ? 'ok' : ''}">${T.sync.nube ? 'Conectada' : 'Sin conectar'}</span></h4>
          ${T.sync.nube ? `<p class="texto">Cuenta: <b>${T.esc(T.sync.nube)}</b>. Los datos se copian a internet y llegan a cualquier equipo que entre con esta misma cuenta.</p><button class="btn" id="salir-nube">Desconectar</button>`
          : `<p class="texto">Copia en internet (por si se daña o roban el computador) y acceso desde cualquier equipo. La primera vez toque <b>Crear cuenta</b>; en los demás equipos, <b>Entrar</b> con ese mismo correo y clave.</p>
              <div class="form"><label class="campo medio"><span>Correo</span><input id="correo" type="email" autocomplete="username"></label><label class="campo medio"><span>Clave (mínimo 6)</span><input id="clave-n" type="password" autocomplete="current-password"></label></div>
              <div class="fila" style="margin-top:12px"><button class="btn pri" id="crear-nube">Crear cuenta</button><button class="btn" id="entrar-nube">Entrar</button></div>
              <p class="suave" style="margin-top:10px">Proyecto: ${T.esc(T.sync.proyectoNube)} · <a href="#config" id="quitar-nube">Cambiar proyecto</a></p>`}</div>
        <div class="tarjeta"><h4>Este equipo</h4><p class="texto">Identificador: <b>${T.esc(T.db.loc('dispositivo'))}</b>. Cada equipo numera sus recibos con una letra propia para que nunca se repitan (ej. VA-00012 es la venta 12 del equipo A). Puede cambiarla, por ejemplo por el número de la caja.</p>
          <div class="fila"><input id="prefijo" value="${T.esc(T.db.cfg('equipos', {})[T.db.loc('dispositivo')] || '')}" maxlength="3" style="width:90px" placeholder="Letra" aria-label="Letra de este equipo en los recibos"><button class="btn" id="g-prefijo">Guardar prefijo</button>
            <button class="btn" id="tema">Tema ${document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro'}</button></div>
          <p class="texto" style="margin-top:14px">Versión instalada: <b>${T.VERSION}</b></p><button class="btn" id="act">Buscar actualización</button></div></div>`;
      const en = (id, fn) => { const b = T.$(id, el); if (b) b.onclick = async () => { try { await fn(); } catch (e) { T.toast(e.message, 'error'); } }; };
      en('#bajar', async () => { await T.respaldo.descargar(); pintar(el); });
      en('#subir', async () => {
        const [f] = await T.elegirArchivo('.json,application/json'); if (!f) return;
        const resp = JSON.parse(await f.text());
        if (!await T.confirmar(`Respaldo de "${resp.negocio || '?'}" del ${T.fechaHora(resp.fecha)}.\n\nSe unirá con los datos actuales: se agregan los registros que falten y gana el más reciente. No se borra nada.\nAntes se descargará una copia de lo que hay ahora.`, { titulo: 'Restaurar copia', ok: 'Restaurar' })) return;
        await T.respaldo.descargar('antes-de-restaurar');
        T.toast(`Restaurados ${await T.respaldo.restaurar(resp)} registros`, 'ok'); pintar(el);
      });
      en('#resp-srv', async () => { if (await T.respaldo.aServidor('manual')) { T.toast('Respaldo guardado en el computador principal', 'ok'); pintar(el); } else throw new Error('No se pudo guardar el respaldo en el servidor'); });
      en('#quitar-nube', async () => {
        const v = await T.pedir({ titulo: 'Usar otro proyecto de Firebase', ok: 'Guardar y recargar', nota: 'Solo si va a mover la tienda a otro proyecto. Pegue el bloque firebaseConfig de la consola de Firebase.', campos: [{ id: 'cfg', label: 'Configuración', tipo: 'textarea', req: true }], validar: x => T.sync.configurarNube(x.cfg) });
        if (v) location.reload();
      });
      en('#entrar-nube', async () => { await T.sync.entrarNube(T.$('#correo', el).value.trim(), T.$('#clave-n', el).value, false); T.toast('Nube conectada', 'ok'); pintar(el); });
      en('#crear-nube', async () => { await T.sync.entrarNube(T.$('#correo', el).value.trim(), T.$('#clave-n', el).value, true); T.toast('Cuenta creada y conectada', 'ok'); pintar(el); });
      en('#salir-nube', async () => { await T.sync.salirNube(); pintar(el); });
      en('#g-prefijo', async () => {
        const l = T.$('#prefijo', el).value.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''), eq = T.db.cfg('equipos', {}), yo = T.db.loc('dispositivo');
        if (!l) throw new Error('Escriba una letra o número');
        if (Object.entries(eq).some(([k, v]) => k !== yo && v === l)) throw new Error(`La letra ${l} ya la usa otro equipo`);
        await T.db.setCfg('equipos', { ...eq, [yo]: l }); T.toast('Letra guardada', 'ok'); pintar(el);
      });
      en('#tema', async () => { const t = document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro'; await T.db.setLoc('tema', t); document.documentElement.dataset.tema = t; pintar(el); });
      en('#act', async () => { await T.app.buscarActualizacion(); if (!T.$('#banda-version')) T.toast('Ya tiene la última versión'); });
    }],

    cuenta: ['Mi clave', () => true, el => {
      const campos = [{ id: 'actual', label: 'Clave actual', tipo: 'password', req: true }, { id: 'nueva', label: 'Clave nueva (mínimo 4)', tipo: 'password', req: true }, { id: 'otra', label: 'Repita la clave nueva', tipo: 'password', req: true }];
      el.innerHTML = `<div class="tarjeta" style="max-width:420px">${T.form(campos)}<button class="btn pri" id="g" style="margin-top:14px">Cambiar clave</button></div>`;
      T.$('#g', el).onclick = async () => {
        try {
          const v = T.leerForm(el, campos), u = T.auth.usuario;
          if (!T.auth.verificar(u, v.actual)) throw new Error('La clave actual no es correcta');
          if (v.nueva !== v.otra) throw new Error('Las claves nuevas no coinciden');
          await T.auth.guardarUsuario({ ...u, pin: v.nueva }); T.toast('Clave cambiada', 'ok'); T.app.refrescar();
        } catch (e) { T.toast(e.message, 'error'); }
      };
    }]
  };

  T.vistas.config = {
    pestana: null,
    async render(el) {
      const visibles = Object.entries(SECCIONES).filter(([, s]) => s[1]());
      if (!visibles.some(([k]) => k === this.pestana)) this.pestana = visibles[0][0];
      el.innerHTML = `<div class="cabeza"><h2>Configuración</h2></div><div class="pestanas">${visibles.map(([k, s]) => `<button data-t="${k}" class="${k === this.pestana ? 'activo' : ''}">${s[0]}</button>`).join('')}</div><div id="sec"></div>`;
      T.$('.pestanas', el).onclick = e => { const b = e.target.closest('[data-t]'); if (b) { this.pestana = b.dataset.t; this.render(el); } };
      await SECCIONES[this.pestana][2](T.$('#sec', el));
    }
  };
})(window.T);
