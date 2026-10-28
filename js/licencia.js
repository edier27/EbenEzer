'use strict';
// ════════════════════════════════════════════════════════════════════
// LICENCIA (código de activación)
//
// Los códigos se emiten en la Consola de licencias de Global ACCE
// (panel-admin.html, sección "Eben-ezer"). Viven en el proyecto Firebase
// de licencias (globalacce-37997), colección ebe_users, documento
// code_LIC_<código>. Formato y firma iguales a los del panel:
//   TEST-<minuto de vencimiento>-<firma>      10 minutos
//   DEMO|TRIAL|ANUAL-<AAAAMMDD…>-<firma>      8, 30 o 365 días
//   PRO-<id>-<firma>                          permanente
//
// Activar = comprobar la firma, entrar con una cuenta al proyecto de
// licencias (el mismo correo y clave de la nube de la tienda), comprobar
// que el código lo emitió el administrador y no lo usó otra cuenta, y
// "quemarlo" a nombre de esa cuenta. Queda guardado en la configuración
// compartida, así todos los equipos de la tienda quedan activados.
// ════════════════════════════════════════════════════════════════════
(function (T) {
  const LS = 'EBE2026FIADOSPRO', COLECCION = 'ebe_users';
  // Proyecto de licencias (datos públicos que identifican el proyecto; lo protege firestore.rules de ese proyecto).
  const CFG_LIC = {
    apiKey: 'AIzaSyAzOoK99y6L95sFAKZFZ0wY42Ljw2YEOM8',
    authDomain: 'globalacce-37997.firebaseapp.com',
    projectId: 'globalacce-37997',
    storageBucket: 'globalacce-37997.firebasestorage.app',
    messagingSenderId: '779307465490',
    appId: '1:779307465490:web:848a554272501bbaf251cb'
  };
  const TIPOS = { test: 'Prueba rápida', demo: 'Demo', trial: 'Prueba', anual: 'Anual', pro: 'PRO permanente' };

  // Firma djb2: idéntica a la del panel y a la de las otras apps.
  const firma = s => { let h = 5381; for (let i = 0; i < s.length; i++) { h = ((h << 5) + h) ^ s.charCodeAt(i); h = h >>> 0; } return h.toString(36).toUpperCase().padStart(8, '0').slice(-8); };
  const limpiar = c => String(c || '').trim().toUpperCase().replace(/\s+/g, '');
  const docId = c => 'code_LIC_' + limpiar(c).replace(/[^A-Z0-9]/g, '_');

  // Revisa el código sin internet: formato, firma y vencimiento.
  function verificar(raw) {
    const c = limpiar(raw), p = c.split('-'), clientId = c.replace(/-/g, '_');
    if (!c) return { valido: false, error: 'Escriba el código de activación' };
    if (p.length !== 3) return { valido: false, error: 'El código no es válido. Revíselo e intente de nuevo.' };
    if (p[0] === 'TEST') {
      if (firma(p[1] + 'TEST' + LS) !== p[2]) return { valido: false, error: 'El código no es válido.' };
      const vence = parseInt(p[1], 10) * 60000;
      if (Date.now() > vence) return { valido: false, vencido: true, error: 'El código de prueba ya venció.' };
      return { valido: true, codigo: c, tipo: 'test', vence, clientId };
    }
    if (['DEMO', 'TRIAL', 'ANUAL'].includes(p[0])) {
      if (firma(p[1] + LS) !== p[2]) return { valido: false, error: 'El código no es válido.' };
      const d = p[1].slice(0, 8), vence = new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), 23, 59, 59).getTime();
      if (!isFinite(vence)) return { valido: false, error: 'El código tiene un formato incorrecto.' };
      if (Date.now() > vence) return { valido: false, vencido: true, error: 'El código ya venció.' };
      return { valido: true, codigo: c, tipo: p[0].toLowerCase(), vence, clientId };
    }
    if (p[0] === 'PRO') {
      if (firma(p[1] + 'PRO' + LS) !== p[2]) return { valido: false, error: 'El código no es válido.' };
      return { valido: true, codigo: c, tipo: 'pro', vence: null, clientId };
    }
    return { valido: false, error: 'El código no es válido. Revíselo e intente de nuevo.' };
  }

  const MSJ = { 'auth/wrong-password': 'Correo o clave incorrectos', 'auth/invalid-credential': 'Correo o clave incorrectos', 'auth/invalid-login-credentials': 'Correo o clave incorrectos', 'auth/invalid-email': 'El correo no es válido', 'auth/weak-password': 'La clave debe tener mínimo 6 caracteres', 'auth/too-many-requests': 'Demasiados intentos. Espere unos minutos.', 'auth/network-request-failed': 'No hay internet', 'permission-denied': 'El servidor de licencias no permitió activar el código. Avise a su proveedor.', 'unavailable': 'No hay conexión con el servidor de licencias' };
  const err = e => new Error(MSJ[e.code] || e.message || String(e));

  T.licencia = {
    TIPOS, verificar,
    // Licencia guardada en la tienda (configuración compartida entre equipos).
    actual: () => T.db.cfg('licencia', null),

    // Estado para pantallas: {activa, tipo, nombre, vence, dias, minutos, codigo, motivo}
    estado() {
      const l = this.actual();
      if (!l || !l.codigo) return { activa: false, motivo: 'sin' };
      const v = verificar(l.codigo);
      const base = { ...l, nombre: TIPOS[l.tipo] || l.tipo, vence: v.vence ?? l.vence ?? null };
      if (!v.valido) return { ...base, activa: false, motivo: v.vencido ? 'vencida' : 'invalida' };
      const falta = v.vence ? v.vence - Date.now() : null;
      return { ...base, activa: true, dias: falta == null ? null : Math.ceil(falta / 86400000), minutos: falta == null ? null : Math.ceil(falta / 60000) };
    },

    // Activa (o renueva) con un código del panel. correo/clave: cuenta de la tienda en el servidor de licencias.
    async activar(codigo, correo, clave, negocio) {
      const v = verificar(codigo);
      if (!v.valido) throw new Error(v.error);
      if (!/^\S+@\S+\.\S+$/.test(correo || '')) throw new Error('Escriba un correo válido');
      if (String(clave || '').length < 6) throw new Error('La clave debe tener mínimo 6 caracteres');
      if (!navigator.onLine) throw new Error('Para activar el código se necesita internet');
      await T.sync.cargarFirebase();
      const app = firebase.initializeApp(CFG_LIC, 'licencias-' + Date.now());
      try {
        const auth = app.auth();
        await auth.setPersistence(firebase.auth.Auth.Persistence.NONE);
        // Cuenta de la tienda en el servidor de licencias: se crea la primera vez; si ya existe, se entra.
        let cred, nueva = true;
        try { cred = await auth.createUserWithEmailAndPassword(correo, clave); }
        catch (e) {
          if (e.code !== 'auth/email-already-in-use') throw err(e);
          nueva = false;
          try { cred = await auth.signInWithEmailAndPassword(correo, clave); } catch (e2) { throw err(e2); }
        }
        // La tienda conserva el mismo identificador aunque renueve con otro código.
        const uid = cred.user.uid, ref = app.firestore().collection(COLECCION).doc(docId(v.codigo)), clientId = (this.actual() || {}).clientId || v.clientId;
        let d;
        try { d = await ref.get(); } catch (e) { throw err(e); }
        const x = d.exists ? d.data() : null;
        if (!x || x.createdByAdmin !== true) throw new Error('Este código no fue emitido por el administrador. Pida uno válido.');
        if (x.used === true && x.usedBy && x.usedBy !== uid) throw new Error('Este código ya fue activado por otra cuenta. Pida un código nuevo.');
        if (x.used !== true) {
          try {
            await ref.set({ used: true, usedBy: uid, usedByUser: correo.split('@')[0], usedAt: new Date().toISOString(), usedClientId: clientId, codeType: v.tipo, code: v.codigo, negocio: negocio || '' }, { merge: true });
          } catch (e) { throw err(e); }
        }
        // Ficha de la cuenta para "Cuentas registradas" del panel (si falla, la activación igual vale).
        const ahora = new Date().toISOString();
        await app.firestore().collection(COLECCION).doc(uid).set({
          uid, email: correo, username: correo.split('@')[0], clientId, licenseCode: v.codigo, licenseType: v.tipo,
          negocio: negocio || '', app: 'Tienda Eben-Ezer', actualizadoEn: ahora, ...(nueva ? { createdAt: ahora } : {})
        }, { merge: true }).catch(e => console.warn('No se guardó la ficha de la cuenta en el panel', e));
        return { codigo: v.codigo, tipo: v.tipo, vence: v.vence, correo, cuenta: uid, clientId, activada: Date.now() };
      } finally {
        app.auth().signOut().catch(() => { });
        app.delete().catch(() => { });
      }
    },

    // Guarda la licencia activada en la tienda (queda en la bitácora y llega a todos los equipos).
    async guardar(lic) {
      await T.db.setCfg('licencia', lic, { codigo: lic.codigo, tipo: lic.tipo, vence: lic.vence ? T.fecha(lic.vence) : 'permanente' });
    },

    // Texto corto para mostrar: "PRO permanente", "Anual · vence 28 oct 2027 (365 días)"
    resumen() {
      const e = this.estado();
      if (!e.activa) return e.motivo === 'sin' ? 'Sin activar' : 'Licencia vencida';
      if (e.vence == null) return e.nombre;
      return `${e.nombre} · vence ${T.fecha(e.vence)} (${e.tipo === 'test' ? e.minutos + ' min' : e.dias + ' día' + (e.dias === 1 ? '' : 's')})`;
    }
  };
})(window.T);
