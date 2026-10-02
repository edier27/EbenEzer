'use strict';
// ════════════════════════════════════════════════════════════════════
// REGLAS DEL SISTEMA — permisos por rol, reglas de negocio y usuarios.
//
// Hay dos clases de reglas:
//  1) FIJAS (no se pueden desactivar, protegen la información):
//     • Las ventas no se borran: solo se anulan, con motivo y responsable.
//     • El inventario solo cambia por movimientos (kárdex); no se edita a mano.
//     • La bitácora no se puede editar ni borrar.
//     • Ningún registro se elimina físicamente.
//  2) CONFIGURABLES (Configuración → Reglas): las de T.REGLAS_DEF.
// ════════════════════════════════════════════════════════════════════
(function (T) {
  T.PERMISOS = {
    'ventas.crear': 'Registrar ventas',
    'ventas.precio': 'Cambiar el precio durante la venta',
    'ventas.descuento': 'Dar descuentos por encima del límite',
    'ventas.anular': 'Anular ventas y hacer devoluciones',
    'ventas.sinstock': 'Vender sin existencias',
    'clientes.editar': 'Crear y editar clientes',
    'clientes.cupo': 'Fiar por encima del cupo',
    'abonos.crear': 'Recibir abonos de fiados',
    'caja.operar': 'Abrir y cerrar caja',
    'caja.movimientos': 'Registrar gastos, ingresos y retiros',
    'inventario.ver': 'Ver el inventario',
    'inventario.editar': 'Crear y editar productos',
    'inventario.ajustar': 'Ajustar existencias',
    'compras.crear': 'Registrar compras y proveedores',
    'reportes.ver': 'Ver reportes',
    'utilidad.ver': 'Ver costos y utilidades',
    'ia.usar': 'Usar la inteligencia artificial',
    'auditoria.ver': 'Ver la bitácora',
    'usuarios.editar': 'Administrar usuarios',
    'config.editar': 'Cambiar configuración y reglas',
    'respaldo.gestionar': 'Descargar y restaurar respaldos'
  };

  const TODOS = Object.keys(T.PERMISOS);
  T.ROLES_DEF = {
    admin: { nombre: 'Administrador', permisos: TODOS },
    supervisor: { nombre: 'Supervisor', permisos: TODOS.filter(p => !['usuarios.editar', 'config.editar', 'respaldo.gestionar'].includes(p)) },
    cajero: { nombre: 'Cajero', permisos: ['ventas.crear', 'clientes.editar', 'abonos.crear', 'caja.operar', 'caja.movimientos', 'inventario.ver'] },
    bodeguero: { nombre: 'Bodeguero', permisos: ['inventario.ver', 'inventario.editar', 'inventario.ajustar', 'compras.crear', 'ia.usar'] }
  };
  // El administrador siempre conserva todos los permisos, para que nadie se quede por fuera.
  T.roles = () => {
    const guardados = T.db.cfg('roles', {}), out = {};
    for (const [k, r] of Object.entries(T.ROLES_DEF)) out[k] = { nombre: r.nombre, permisos: k === 'admin' ? TODOS : (guardados[k] || r.permisos) };
    return out;
  };

  T.REGLAS_DEF = {
    cajaObligatoria: true,     // no se vende ni se reciben abonos sin caja abierta
    venderSinStock: false,     // permitir vender productos sin existencias
    bloquearVencidos: true,    // no vender productos con fecha de vencimiento pasada
    bloquearBajoCosto: true,   // no permitir precio de venta menor que el costo
    descMaxPct: 10,            // descuento máximo (%) sin autorización
    respetarCupo: true,        // no fiar por encima del cupo del cliente
    cupoDefecto: 100000,       // cupo de fiado para clientes nuevos
    redondeo: 50,              // redondear el total de la venta (0 = no redondear)
    costoPromedio: true,       // costo promedio ponderado al comprar (si no: último costo)
    margenDefecto: 30,         // % de ganancia sugerido para productos nuevos
    diasVence: 15,             // avisar productos que vencen en estos días
    bloqueoMin: 0,             // cerrar sesión tras X minutos sin uso (0 = nunca)
    intentosPin: 5             // intentos de clave antes de bloquear 1 minuto
  };
  T.REGLAS_INFO = {
    cajaObligatoria: ['check', 'Exigir caja abierta', 'No se puede vender ni recibir abonos sin abrir caja.'],
    venderSinStock: ['check', 'Permitir vender sin existencias', 'Si está apagado, solo un supervisor puede autorizarlo.'],
    bloquearVencidos: ['check', 'Bloquear productos vencidos', 'Impide vender productos con la fecha de vencimiento pasada.'],
    bloquearBajoCosto: ['check', 'No vender por debajo del costo', 'Impide guardar precios menores que el costo.'],
    respetarCupo: ['check', 'Respetar el cupo de fiado', 'Fiar por encima del cupo requiere autorización.'],
    costoPromedio: ['check', 'Costo promedio ponderado', 'Al comprar, promedia el costo con las existencias. Apagado: usa el último costo.'],
    descMaxPct: ['number', 'Descuento máximo sin autorización (%)'],
    cupoDefecto: ['number', 'Cupo de fiado para clientes nuevos ($)'],
    redondeo: ['number', 'Redondear total de la venta a múltiplos de ($)', '0 para no redondear.'],
    margenDefecto: ['number', 'Ganancia sugerida para productos nuevos (%)'],
    diasVence: ['number', 'Avisar vencimientos con estos días de anticipación'],
    bloqueoMin: ['number', 'Cerrar sesión tras minutos sin uso', '0 para no cerrar nunca.'],
    intentosPin: ['number', 'Intentos de clave antes de bloquear']
  };
  T.regla = k => ({ ...T.REGLAS_DEF, ...T.db.cfg('reglas', {}) })[k];

  T.METODOS = { efectivo: 'Efectivo', nequi: 'Nequi', daviplata: 'Daviplata', tarjeta: 'Tarjeta', transferencia: 'Transferencia', fiado: 'Fiado' };
  T.UNIDADES = { und: 'Unidad', kg: 'Kilo', lb: 'Libra', g: 'Gramo', l: 'Litro', ml: 'Mililitro', paq: 'Paquete', caja: 'Caja' };
  T.CATEGORIAS_DEF = ['Abarrotes', 'Bebidas', 'Lácteos', 'Carnes y fríos', 'Frutas y verduras', 'Panadería', 'Aseo hogar', 'Aseo personal', 'Dulces y snacks', 'Licores', 'Mascotas', 'Papelería', 'Otros'];
  T.categorias = () => Array.from(new Set([...T.db.cfg('categorias', T.CATEGORIAS_DEF), ...T.db.lista('productos').map(p => p.categoria).filter(Boolean)])).sort((a, b) => a.localeCompare(b, 'es'));

  // ── Sesión y usuarios ──
  let fallos = 0, bloqueadoHasta = 0;
  const sal = () => T.uid().replace(/-/g, '').slice(0, 16);

  T.auth = {
    usuario: null,
    hash: (pin, s) => T.sha256(s + ':' + pin),

    puede(p, u = this.usuario) {
      if (!u) return false;
      const rol = T.roles()[u.rol];
      return !!rol && rol.permisos.includes(p);
    },
    exigir(p) { if (!this.puede(p)) throw new Error(`No tiene permiso para: ${T.PERMISOS[p] || p}`); },

    verificar(u, pin) { return !!u && u.activo !== false && u.hash === this.hash(pin, u.sal); },

    async iniciar(usuarioId, pin) {
      if (Date.now() < bloqueadoHasta) throw new Error(`Demasiados intentos. Espere ${Math.ceil((bloqueadoHasta - Date.now()) / 1000)} segundos.`);
      const u = T.db.get('usuarios', usuarioId);
      if (!this.verificar(u, pin)) {
        if (++fallos >= T.regla('intentosPin')) { bloqueadoHasta = Date.now() + 60000; fallos = 0; }
        await T.registrar('sesion.fallida', u ? u.usuario : '?', null);
        throw new Error('Clave incorrecta');
      }
      fallos = 0; this.usuario = u;
      sessionStorage.setItem('tienda.sesion', u.id);
      await T.registrar('sesion.iniciar', u.usuario);
      return u;
    },
    reanudar() {
      const u = T.db.get('usuarios', sessionStorage.getItem('tienda.sesion'));
      if (u && u.activo !== false && !u._borrado) this.usuario = u;
      return this.usuario;
    },
    async salir() {
      if (this.usuario) await T.registrar('sesion.cerrar', this.usuario.usuario);
      this.usuario = null; sessionStorage.removeItem('tienda.sesion');
    },

    // Si el usuario actual no tiene el permiso, pide la clave de alguien que sí lo tenga.
    // Devuelve el nombre de quien autoriza, o null si se cancela.
    async autorizar(p, motivo) {
      if (this.puede(p)) return this.usuario.nombre;
      const jefes = T.db.lista('usuarios').filter(u => u.activo !== false && this.puede(p, u));
      if (!jefes.length) { T.toast('Ningún usuario puede autorizar esta acción', 'error'); return null; }
      const campos = [
        { id: 'uid', label: 'Quién autoriza', tipo: 'select', opciones: jefes.map(u => [u.id, u.nombre]) },
        { id: 'pin', label: 'Clave', tipo: 'password', req: true, attrs: 'inputmode="numeric" autofocus' }
      ];
      let quien = null;
      const r = await T.pedir({
        titulo: 'Se necesita autorización', ok: 'Autorizar', ancho: 400, campos,
        nota: `${T.PERMISOS[p]}${motivo ? ' — ' + motivo : ''}`,
        validar: v => {
          const u = T.db.get('usuarios', v.uid);
          if (!this.verificar(u, v.pin)) throw new Error('Clave incorrecta');
          quien = u;
        }
      });
      if (!r) return null;
      await T.registrar('autorizacion', p, { autoriza: quien.nombre, solicita: this.usuario.nombre, motivo: motivo || '' });
      return quien.nombre;
    },

    async guardarUsuario(d) {
      const ant = d.id ? T.db.get('usuarios', d.id) : null;
      // Sin sesión solo ocurre al crear la tienda. Cada quien puede cambiar su propia clave, nada más.
      const soloMiClave = ant && this.usuario && ant.id === this.usuario.id && d.rol === ant.rol && d.activo !== false;
      if (this.usuario && !soloMiClave) this.exigir('usuarios.editar');
      const login = T.norm(d.usuario).replace(/\s+/g, '');
      if (!d.nombre || !login) throw new Error('Nombre y usuario son obligatorios');
      if (T.db.lista('usuarios').some(u => u.usuario === login && u.id !== d.id)) throw new Error('Ya existe ese nombre de usuario');
      if (!ant && !d.pin) throw new Error('Asigne una clave');
      if (d.pin && String(d.pin).length < 4) throw new Error('La clave debe tener al menos 4 caracteres');
      const u = { ...(ant || { id: T.uid() }), nombre: d.nombre, usuario: login, rol: d.rol, activo: d.activo !== false };
      if (d.pin) { u.sal = sal(); u.hash = this.hash(String(d.pin), u.sal); }
      const admins = T.db.lista('usuarios').filter(x => x.id !== u.id && x.rol === 'admin' && x.activo !== false);
      if (ant && (u.rol !== 'admin' || !u.activo) && !admins.length) throw new Error('Debe quedar al menos un administrador activo');
      await T.db.lote([{ s: 'usuarios', r: u }, T.aud(ant ? 'usuario.editar' : 'usuario.crear', u.usuario, { nombre: u.nombre, rol: u.rol, activo: u.activo, cambioClave: !!d.pin })]);
      if (this.usuario && this.usuario.id === u.id) this.usuario = u;
      return u;
    }
  };
})(window.T);
