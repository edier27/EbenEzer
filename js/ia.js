'use strict';
// ════════════════════════════════════════════════════════════════════
// INTELIGENCIA ARTIFICIAL (Google Gemini)
//  • Foto de productos o estante  → lista de productos para el inventario
//  • Foto de factura de proveedor → compra completa con cantidades y costos
//  • Asistente: responde preguntas con los datos reales de la tienda
//
// La clave de Gemini se guarda SOLO en este equipo (no se sincroniza ni
// va en los respaldos). Se obtiene gratis en https://aistudio.google.com/apikey
// La IA siempre propone; quien guarda es la persona, después de revisar.
// ════════════════════════════════════════════════════════════════════
(function (T) {
  const BASE = 'https://generativelanguage.googleapis.com/v1beta/';
  const MODELO_DEF = 'gemini-2.5-flash';
  const cfg = () => T.db.loc('ia', {});
  // Número que puede venir como texto en formato colombiano: "1.500" = 1500 y "2,5" = 2.5.
  const n = v => {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const t = String(v ?? '').replace(/[$\s]/g, '');
    return T.aNum(/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? t.replace(/\./g, '') : t);
  };

  async function pedir(ruta, cuerpo) {
    const r = await fetch(BASE + ruta, {
      method: cuerpo ? 'POST' : 'GET',
      headers: { 'x-goog-api-key': cfg().clave, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error((j.error && j.error.message) || `Error ${r.status} de la IA`);
      e.estado = r.status; throw e;
    }
    return j;
  }

  T.ia = {
    lista: () => !!cfg().clave,
    num: n,
    modelo: () => cfg().modelo || MODELO_DEF,

    // Modelos de la cuenta que aceptan imágenes y texto.
    async modelos() {
      const j = await pedir('models?pageSize=200');
      return (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/.test(m.name) && !/embedding|tts|image-generation|audio|live/.test(m.name)).map(m => m.name.replace('models/', ''));
    },

    // texto: instrucción; imagenes: dataURLs; json: true → responde JSON; historial: [{rol, texto}]
    async llamar({ sistema, texto, imagenes = [], json = false, historial = [] }) {
      if (!this.lista()) throw new Error('Falta la clave de la IA. Configúrela en Configuración → Inteligencia artificial.');
      if (!navigator.onLine) throw new Error('La IA necesita internet y ahora no hay conexión.');
      const partes = [{ text: texto }, ...imagenes.map(d => ({ inline_data: { mime_type: d.slice(5, d.indexOf(';')), data: d.slice(d.indexOf(',') + 1) } }))];
      const cuerpo = {
        contents: [...historial.map(h => ({ role: h.rol === 'ia' ? 'model' : 'user', parts: [{ text: h.texto }] })), { role: 'user', parts: partes }],
        generationConfig: { temperature: json ? 0.1 : 0.5, ...(json ? { responseMimeType: 'application/json' } : {}) }
      };
      if (sistema) cuerpo.systemInstruction = { parts: [{ text: sistema }] };
      let j;
      try { j = await pedir(`models/${this.modelo()}:generateContent`, cuerpo); }
      catch (e) {
        if (e.estado !== 404) throw e;
        // El modelo guardado ya no existe: se elige uno vigente y se reintenta una vez.
        const ms = await this.modelos(), nuevo = ms.find(m => /flash/.test(m) && !/lite|preview|exp/.test(m)) || ms.find(m => /flash/.test(m)) || ms[0];
        if (!nuevo) throw e;
        await T.db.setLoc('ia', { ...cfg(), modelo: nuevo });
        j = await pedir(`models/${nuevo}:generateContent`, cuerpo);
      }
      const cand = j.candidates && j.candidates[0];
      const out = cand && cand.content && (cand.content.parts || []).map(p => p.text || '').join('');
      if (!out) throw new Error('La IA no devolvió respuesta' + (j.promptFeedback && j.promptFeedback.blockReason ? ` (${j.promptFeedback.blockReason})` : ''));
      if (!json) return out;
      try { return JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, '')); }
      catch (e) { throw new Error('La IA respondió en un formato que no se pudo leer. Intente de nuevo.'); }
    },

    async productosDeFotos(imagenes) {
      const r = await this.llamar({
        json: true, imagenes,
        texto: `Eres el asistente de inventario de una tienda de barrio / supermercado en Colombia.
Mira ${imagenes.length > 1 ? 'las fotos' : 'la foto'} e identifica cada producto DISTINTO que se vea (un registro por referencia, no por unidad).
Responde SOLO un JSON con esta forma:
{"productos":[{"nombre":"nombre comercial claro con marca y presentación, ej: Arroz Diana 500 g","marca":"","categoria":"una de: ${T.categorias().join(', ')}","unidad":"und|kg|lb|l|paq|caja","codigo":"código de barras SOLO si se lee completo en la foto, si no cadena vacía","cantidad":número de unidades visibles de esa referencia,"precioSugerido":precio de venta al público aproximado en pesos colombianos (entero) o 0 si no sabes,"imagen":índice de la foto (empezando en 0),"caja":[ymin,xmin,ymax,xmax] del producto en esa foto en escala 0-1000,"confianza":0 a 1}]}
No inventes códigos de barras. Si no hay productos, responde {"productos":[]}.`
      });
      return Array.isArray(r.productos) ? r.productos : [];
    },

    // Lee la factura (fotos o PDF de factura electrónica) y devuelve renglones ya convertidos
    // a unidades sueltas con su costo por unidad. Cada renglón trae "revisar" cuando las
    // cifras de la factura no cuadran entre sí.
    async facturaDeFotos(archivos) {
      const varias = archivos.length > 1;
      const r = await this.llamar({
        json: true, imagenes: archivos,
        texto: `Eres el auxiliar de compras de una tienda / supermercado en Colombia. ${varias ? 'Los archivos son páginas de una misma' : 'El archivo es una'} factura, factura electrónica o remisión de un proveedor.
Lee TODOS los renglones de productos (de todas las páginas, sin repetir) y responde SOLO un JSON con esta forma:
{"proveedor":"razón social del proveedor","nit":"NIT del proveedor","telefono":"","numero":"número de la factura","fecha":"AAAA-MM-DD o vacío",
"subtotal":entero,"iva":entero,"descuentos":entero,"total":total a pagar de la factura (entero),
"items":[{"nombre":"nombre del producto como se vendería en la tienda: marca, producto y tamaño, ej. Aceite Premier 1000 ml",
"marca":"","codigo":"código de barras EAN (8 a 14 dígitos) si aparece; si no, vacío","referencia":"código interno del proveedor si aparece",
"categoria":"una de: ${T.categorias().join(', ')}",
"cantidad":cantidad facturada tal como aparece en el renglón,
"empaque":"cómo se factura esa cantidad: unidad, caja x 24, paca x 12, six-pack, bulto, display x 10…",
"unidadesPorEmpaque":unidades sueltas que trae cada empaque (1 si se factura por unidad),
"valorTotal":valor total del renglón en pesos YA con IVA y descuentos (entero),
"ivaPct":0, 5 o 19,
"costoUnitario":costo de UNA unidad suelta con IVA incluido (entero)}]}
Reglas: los números van en formato colombiano (1.500 = mil quinientos; 1.500,50 = mil quinientos con cincuenta centavos). Si el renglón muestra el valor antes de IVA, súmale el IVA. No inventes renglones ni datos: si algo no se lee, déjalo vacío o en 0. No incluyas fletes, retenciones ni bonificaciones sin producto.`
      });
      const items = (Array.isArray(r.items) ? r.items : []).map(x => {
        const cant = Math.max(0, n(x.cantidad)), porEmp = Math.max(1, Math.round(n(x.unidadesPorEmpaque)) || 1);
        const unidades = T.r3((cant || 1) * porEmp), valor = T.red(n(x.valorTotal)), cu = T.red(n(x.costoUnitario));
        // El total del renglón es lo más confiable de una factura; el costo por unidad sale de ahí.
        const porValor = valor > 0 ? T.red(valor / unidades) : 0, costo = porValor || cu;
        const revisar = !cant ? 'No se leyó la cantidad' : !costo ? 'No se leyó el costo'
          : porValor && cu && Math.abs(porValor - cu) > Math.max(50, cu * 0.03) ? `La factura no cuadra: ${T.money(cu)} por unidad, pero el renglón da ${T.money(porValor)}` : '';
        const codigo = String(x.codigo || '').replace(/\D/g, '');
        return {
          nombre: String(x.nombre || '').trim(), marca: String(x.marca || '').trim(), categoria: String(x.categoria || '').trim(),
          codigo: codigo.length >= 8 ? codigo : '', referencia: String(x.referencia || '').trim(),
          cantidad: unidades, costo, valor, iva: [0, 5, 19].includes(n(x.ivaPct)) ? n(x.ivaPct) : 0,
          empaque: porEmp > 1 ? `${T.cant(cant || 1)} × ${String(x.empaque || 'empaque').trim()} = ${T.cant(unidades)} und` : '', revisar
        };
      }).filter(x => x.nombre);
      return {
        proveedor: String(r.proveedor || '').trim(), nit: String(r.nit || '').trim(), telefono: String(r.telefono || '').trim(),
        numero: String(r.numero || '').trim(), fecha: /^\d{4}-\d{2}-\d{2}$/.test(r.fecha || '') ? r.fecha : '',
        subtotal: T.red(n(r.subtotal)), iva: T.red(n(r.iva)), total: T.red(n(r.total)), items
      };
    },

    // Datos compactos del negocio que acompañan cada pregunta al asistente.
    async contexto() {
      const hoy = T.dia(), fin = T.finDia(hoy);
      const [d1, d7, d30] = await Promise.all([T.neg.resumen(T.iniDia(hoy), fin), T.neg.resumen(fin - 7 * 86400000, fin), T.neg.resumen(fin - 30 * 86400000, fin)]);
      const al = T.neg.alertas(), prods = T.db.lista('productos').filter(p => p.activo !== false);
      const top = r => Object.values(r.productos).sort((a, b) => b.total - a.total).slice(0, 25).map(p => `${p.nombre}: ${p.cantidad} und, $${p.total}, utilidad $${p.utilidad}`);
      const vendidos30 = new Set(Object.keys(d30.productos));
      const linea = r => `ventas (dinero recibido) $${r.recibido} = contado $${r.contado} + abonos de fiados $${r.abonos}; fiado nuevo (por cobrar, no cuenta como venta) $${r.fiado}; mercancía que salió $${r.total} en ${r.n} tiquetes, utilidad bruta $${r.utilidad}, gastos $${r.gastos}, dinero por medio de pago ${JSON.stringify(r.ingresosPorMetodo)}`;
      return [
        `Negocio: ${T.db.cfg('negocio', {}).nombre || 'Tienda'}. Fecha: ${hoy}. Moneda: pesos colombianos.`,
        `HOY: ${linea(d1)}`, `ÚLTIMOS 7 DÍAS: ${linea(d7)}`, `ÚLTIMOS 30 DÍAS: ${linea(d30)}`,
        `Ventas por día, dinero recibido (30 días): ${JSON.stringify(d30.porDiaCobrado)}`,
        'Regla de la tienda: lo fiado no es venta hasta que el cliente paga; cuando abona, ese dinero sí cuenta como venta.',
        `Ventas por categoría (30 días): ${JSON.stringify(d30.porCategoria)}`,
        `Más vendidos 30 días:\n${top(d30).join('\n')}`,
        `Inventario: ${prods.length} productos, valor a costo $${prods.reduce((a, p) => a + T.red((p.costo || 0) * Math.max(0, p.stock || 0)), 0)}.`,
        `Agotados (${al.agotados.length}): ${al.agotados.slice(0, 40).map(p => p.nombre).join(', ')}`,
        `Bajo el mínimo (${al.bajos.length}): ${al.bajos.slice(0, 40).map(p => `${p.nombre} (hay ${p.stock}, mín ${p.stockMin})`).join(', ')}`,
        `Vencidos con existencias: ${al.vencidos.map(p => `${p.nombre} (${p.vence}, ${p.stock} und)`).join(', ') || 'ninguno'}`,
        `Por vencer: ${al.porVencer.map(p => `${p.nombre} (${p.vence}, ${p.stock} und)`).join(', ') || 'ninguno'}`,
        `Sin ventas en 30 días con existencias: ${prods.filter(p => p.stock > 0 && !vendidos30.has(p.id)).slice(0, 40).map(p => `${p.nombre} (${p.stock})`).join(', ') || 'ninguno'}`,
        `Clientes que deben: ${T.db.lista('clientes').filter(c => c.saldo > 0).sort((a, b) => b.saldo - a.saldo).slice(0, 30).map(c => `${c.nombre} $${c.saldo}`).join(', ') || 'ninguno'}`
      ].join('\n');
    },

    async asistente(pregunta, historial) {
      return this.llamar({
        historial, texto: pregunta,
        sistema: `Eres el asistente de una tienda en Colombia. Respondes en español sencillo, corto y práctico, como le hablarías al dueño.
Usa ÚNICAMENTE los datos que siguen; si algo no está en los datos, dilo. Da cifras en pesos con separador de miles. No des asesoría legal ni tributaria.
DATOS DE LA TIENDA:
${await this.contexto()}`
      });
    }
  };
})(window.T);
