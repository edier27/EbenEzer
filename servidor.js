'use strict';
// ════════════════════════════════════════════════════════════════════
// SERVIDOR DE LA TIENDA — se ejecuta en el computador principal.
//   Abrir con doble clic en "Iniciar Tienda.bat"  (o:  node servidor.js)
//
//  • Sirve la aplicación a este computador y a los celulares/equipos
//    conectados al mismo WiFi.
//  • Guarda una copia de TODO en  datos/registro.ndjson  (solo se agrega,
//    nunca se sobrescribe: queda el historial completo de cada registro).
//  • Guarda respaldos completos en  respaldos/  (conserva los últimos 60).
//
// No necesita instalar nada aparte de Node.js.
// ════════════════════════════════════════════════════════════════════
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

const PUERTO = Number(process.env.PUERTO) || 8080;
const RAIZ = __dirname;
const DIR_DATOS = path.join(RAIZ, 'datos'), DIR_RESP = path.join(RAIZ, 'respaldos');
const REGISTRO = path.join(DIR_DATOS, 'registro.ndjson'), ID_ARCHIVO = path.join(DIR_DATOS, 'id.txt');
const MAX_RESPALDOS = 60, MAX_CUERPO = 200 * 1024 * 1024, MAX_RESPUESTA = 4 * 1024 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
// Solo estos archivos y carpetas son públicos: datos/ y respaldos/ nunca se sirven.
const PUBLICO = /^\/(index\.html|manifest\.json|sw\.js|version\.json|icon\.svg|css\/[\w.-]+|js\/[\w./-]+)$/;

fs.mkdirSync(DIR_DATOS, { recursive: true }); fs.mkdirSync(DIR_RESP, { recursive: true });
if (!fs.existsSync(ID_ARCHIVO)) fs.writeFileSync(ID_ARCHIVO, crypto.randomUUID());
const ID = fs.readFileSync(ID_ARCHIVO, 'utf8').trim();

// Clave del servidor: la piden los celulares y demás equipos la primera vez que se conectan,
// para que cualquiera que esté en el WiFi no pueda leer ni cambiar los datos.
// Este computador (localhost) no la necesita. Para cambiarla, edite datos/clave.txt y reinicie.
const CLAVE_ARCHIVO = path.join(DIR_DATOS, 'clave.txt');
if (!fs.existsSync(CLAVE_ARCHIVO)) fs.writeFileSync(CLAVE_ARCHIVO, Array.from(crypto.randomBytes(8), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join(''));
const CLAVE = fs.readFileSync(CLAVE_ARCHIVO, 'utf8').trim();
const esLocal = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const claveOk = req => {
  const dada = Buffer.from(String(req.headers['x-clave'] || '')), buena = Buffer.from(CLAVE);
  return dada.length === buena.length && crypto.timingSafeEqual(dada, buena);
};

// Estado en memoria: última versión de cada registro. clave = tabla|id
const actual = new Map();
let seq = 0, lineas = 0;
if (fs.existsSync(REGISTRO)) {
  for (const linea of fs.readFileSync(REGISTRO, 'utf8').split('\n')) {
    if (!linea) continue;
    try { const e = JSON.parse(linea); actual.set(e.s + '|' + e.r.id, e); seq = Math.max(seq, e.q); lineas++; }
    catch (e) { console.warn('Línea dañada ignorada en el registro'); }
  }
}
const salida = fs.createWriteStream(REGISTRO, { flags: 'a' });

function recibir(equipo, cambios) {
  let n = 0, texto = '';
  for (const c of cambios) {
    if (!c || typeof c.s !== 'string' || !c.r || typeof c.r.id !== 'string') continue;
    const k = c.s + '|' + c.r.id, ant = actual.get(k);
    if (ant && (ant.r.actualizado || 0) >= (c.r.actualizado || 0)) continue;   // el último cambio gana
    const e = { q: ++seq, o: equipo, t: Date.now(), s: c.s, r: c.r };
    actual.set(k, e); texto += JSON.stringify(e) + '\n'; n++;
  }
  if (texto) salida.write(texto);
  return n;
}

function desde(q, equipo) {
  const cambios = []; let bytes = 0, ult = q, mas = false;
  const pend = Array.from(actual.values()).filter(e => e.q > q).sort((a, b) => a.q - b.q);
  for (const e of pend) {
    if (bytes > MAX_RESPUESTA) { mas = true; break; }
    ult = e.q;
    if (e.o === equipo) continue;
    cambios.push({ s: e.s, r: e.r }); bytes += JSON.stringify(e.r).length;
  }
  return { seq: mas ? ult : seq, cambios, mas };
}

function guardarRespaldo(cuerpo) {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const nombre = `respaldo-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${String(cuerpo.motivo || 'auto').replace(/[^\w-]/g, '')}.json`;
  fs.writeFileSync(path.join(DIR_RESP, nombre), JSON.stringify(cuerpo.respaldo));
  const viejos = fs.readdirSync(DIR_RESP).filter(f => f.startsWith('respaldo-')).sort();
  viejos.slice(0, Math.max(0, viejos.length - MAX_RESPALDOS)).forEach(f => fs.unlinkSync(path.join(DIR_RESP, f)));
  return nombre;
}

const leerCuerpo = req => new Promise((ok, err) => {
  const partes = []; let n = 0;
  req.on('data', c => { n += c.length; if (n > MAX_CUERPO) { err(new Error('Cuerpo demasiado grande')); req.destroy(); } else partes.push(c); });
  req.on('end', () => { try { ok(JSON.parse(Buffer.concat(partes).toString('utf8'))); } catch (e) { err(new Error('JSON inválido')); } });
  req.on('error', err);
});
const json = (res, obj, estado = 200) => { res.writeHead(estado, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/ping') return json(res, { app: 'tienda-ebenezer', id: ID, ...(esLocal(req) ? { clave: CLAVE } : {}) });
    if (url.pathname.startsWith('/api/') && !esLocal(req) && !claveOk(req)) return json(res, { error: 'Clave del servidor incorrecta' }, 401);
    if (url.pathname === '/api/acceso') return json(res, { ok: true });
    if (url.pathname === '/api/sync') {
      if (req.method === 'POST') { const c = await leerCuerpo(req); return json(res, { recibidos: recibir(String(c.equipo || ''), c.cambios || []), seq }); }
      return json(res, desde(Number(url.searchParams.get('desde')) || 0, url.searchParams.get('equipo') || ''));
    }
    if (url.pathname === '/api/respaldo') {
      if (req.method === 'POST') return json(res, { archivo: guardarRespaldo(await leerCuerpo(req)) });
      return json(res, { archivos: fs.readdirSync(DIR_RESP).filter(f => f.startsWith('respaldo-')).sort().reverse() });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, { error: 'Método no permitido' }, 405);
    const ruta = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    if (!PUBLICO.test(ruta) || ruta.includes('..')) return json(res, { error: 'No encontrado' }, 404);
    fs.readFile(path.join(RAIZ, ruta), (e, datos) => {
      if (e) return json(res, { error: 'No encontrado' }, 404);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(ruta)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(datos);
    });
  } catch (e) { json(res, { error: e.message }, 400); }
}).listen(PUERTO, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('\n  TIENDA EBEN-EZER — servidor en marcha');
  console.log('  ─────────────────────────────────────');
  console.log(`  En este computador:   http://localhost:${PUERTO}`);
  ips.forEach(ip => console.log(`  Celular / otro equipo (mismo WiFi):   http://${ip}:${PUERTO}`));
  console.log(`  Clave para conectar otros equipos:    ${CLAVE}`);
  console.log(`\n  Registros guardados: ${actual.size}   (historial: ${lineas} líneas)`);
  console.log('  Datos:      ' + DIR_DATOS);
  console.log('  Respaldos:  ' + DIR_RESP);
  console.log('\n  NO cierre esta ventana mientras la tienda esté trabajando.\n');
});
