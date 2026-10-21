// ─── USUARIOS Y PERMISOS ─────────────────────────────────────────────────────
// Cada usuario entra con su PIN (config 'pin_admin' = { nombre: pin }) y tiene una
// lista de módulos permitidos (config 'permisos_usuarios' = { nombre: { admin, modulos } }).
// Los administradores (Manuel y Nicolás) tienen acceso a todo y gestionan los usuarios.
'use strict';

const MODULOS = ['hotel', 'reservas', 'tpv', 'carta', 'bodas', 'comuniones', 'eventos', 'contabilidad', 'pagos'];
const ADMINS_INICIALES = ['Manuel', 'Nicolás'];

function leer(db, clave, def) {
  try { const r = db.prepare('SELECT valor FROM config WHERE clave = ?').get(clave); return r ? JSON.parse(r.valor || 'null') || def : def; }
  catch (e) { return def; }
}
function escribir(db, clave, valor) {
  db.prepare('INSERT OR REPLACE INTO config (clave, valor) VALUES (?, ?)').run(clave, JSON.stringify(valor));
}

function iniciar(db) {
  const pines = leer(db, 'pin_admin', {});
  const perm = leer(db, 'permisos_usuarios', null);
  if (!perm) {
    // Primera vez: todos los usuarios que ya existían (Manuel y Nicolás) quedan como administradores
    const p = {};
    Object.keys(pines).forEach(n => { p[n] = { admin: true, modulos: MODULOS.slice() }; });
    escribir(db, 'permisos_usuarios', p);
  }
}

// Permisos efectivos de un usuario
function permisosDe(db, usuario) {
  const perm = leer(db, 'permisos_usuarios', {});
  const p = perm[usuario];
  if (!p) return { admin: ADMINS_INICIALES.includes(usuario), modulos: ADMINS_INICIALES.includes(usuario) ? MODULOS.slice() : [] };
  if (p.admin) return { admin: true, modulos: MODULOS.slice() };
  return { admin: false, modulos: (p.modulos || []).filter(m => MODULOS.includes(m)) };
}
// Quién puede ver los fichajes y las horas trabajadas (por defecto, solo Manuel)
function verFichajes(db, usuario) {
  let l = ['Manuel'];
  try { const r = db.prepare("SELECT valor FROM config WHERE clave = 'ver_fichajes'").get(); if (r && r.valor) l = JSON.parse(r.valor); } catch (e) {}
  return Array.isArray(l) && l.includes(usuario);
}
function puede(db, usuario, modulo) { const p = permisosDe(db, usuario); return p.admin || p.modulos.includes(modulo); }

// Qué módulo hace falta para cada ruta de la API (null = basta con tener sesión)
function moduloDeRuta(ruta, metodo) {
  if (/^\/api\/(sesion|login|logout)$/.test(ruta)) return null;
  if (/^\/api\/portal\/usuarios/.test(ruta)) return 'admin';
  // Fichajes y horas de los trabajadores: solo Manuel (lista en config «ver_fichajes»)
  if (/^\/api\/portal\/personal\/(horas|fichajes\/|[^/]+\/fichajes)/.test(ruta)) return 'fichajes';
  if (/^\/api\/portal\/personal/.test(ruta)) return 'admin'; // Personal: solo Manuel y Nicolás
  // Anotar pagos y gastos fijos: solo quien tenga el permiso «pagos» (Manuel, Nicolás y Ángela)
  if (/^\/api\/portal\/(pagos|gastos)/.test(ruta) && metodo !== 'GET') return 'pagos';
  if (/^\/api\/portal\/(contabilidad|documentos|gastos|facturacion|pagos|panel)/.test(ruta)) return 'contabilidad';
  if (/^\/api\/portal\/celebraciones/.test(ruta)) return 'celebraciones'; // se comprueba por tipo en la propia ruta
  // Los menús los consultan también bodas, comuniones y reservas; editarlos es de Carta y Menús
  if (/^\/api\/portal\/plantillas/.test(ruta)) return metodo === 'GET' ? ['carta', 'bodas', 'comuniones', 'eventos', 'reservas'] : ['carta', 'bodas', 'comuniones', 'eventos'];
  if (/^\/api\/portal\//.test(ruta)) return 'carta';
  return 'reservas'; // el resto de la API es la app de reservas, propuestas y presupuestos
}

// Middleware: va justo después del de sesión (req.usuario ya está puesto)
function middleware(db) {
  return (req, res, next) => {
    if (!req.usuario) return next(); // rutas públicas
    const ruta = req.originalUrl.split('?')[0];
    const m = moduloDeRuta(ruta, req.method);
    if (!m || m === 'celebraciones') return next();
    if (m === 'fichajes') return verFichajes(db, req.usuario) ? next() : res.status(403).json({ error: 'Los fichajes solo los puede ver Manuel' });
    const p = permisosDe(db, req.usuario);
    req.permisos = p;
    if (p.admin) return next();
    const ok = m === 'admin' ? false : (Array.isArray(m) ? m.some(x => p.modulos.includes(x)) : p.modulos.includes(m));
    if (!ok) return res.status(403).json({ error: 'No tienes permiso para esta sección' });
    next();
  };
}

// Rutas de gestión de usuarios (solo administradores)
function montar(app, db) {
  const limpiarNombre = n => String(n || '').trim().replace(/\s+/g, ' ').slice(0, 40);

  app.get('/api/portal/usuarios', (req, res) => {
    const pines = leer(db, 'pin_admin', {});
    res.json({ modulos: MODULOS, usuarios: Object.keys(pines).map(n => Object.assign({ nombre: n, pin: pines[n] }, permisosDe(db, n))) });
  });

  app.post('/api/portal/usuarios', (req, res) => {
    const d = req.body || {};
    const pines = leer(db, 'pin_admin', {});
    const perm = leer(db, 'permisos_usuarios', {});
    const anterior = d.anterior ? limpiarNombre(d.anterior) : null;
    const nombre = limpiarNombre(d.nombre);
    const pin = String(d.pin || '').trim();
    if (!nombre) return res.status(400).json({ error: 'Falta el nombre' });
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'El PIN tiene que ser de 4 números' });
    if (anterior && !(anterior in pines)) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (nombre !== anterior && nombre in pines) return res.status(400).json({ error: 'Ya existe un usuario con ese nombre' });
    const otro = Object.keys(pines).find(n => pines[n] === pin && n !== anterior);
    if (otro) return res.status(400).json({ error: 'Ese PIN ya lo usa otro usuario' });

    const admin = !!d.admin;
    // Siempre tiene que quedar al menos un administrador
    if (anterior && permisosDe(db, anterior).admin && !admin) {
      const admins = Object.keys(pines).filter(n => n !== anterior && permisosDe(db, n).admin);
      if (!admins.length) return res.status(400).json({ error: 'Tiene que quedar al menos un administrador' });
    }
    if (anterior && anterior !== nombre) {
      delete pines[anterior]; delete perm[anterior];
      db.prepare('UPDATE sesiones SET usuario = ? WHERE usuario = ?').run(nombre, anterior);
    }
    pines[nombre] = pin;
    perm[nombre] = { admin, modulos: admin ? MODULOS.slice() : (Array.isArray(d.modulos) ? d.modulos.filter(m => MODULOS.includes(m)) : []) };
    escribir(db, 'pin_admin', pines);
    escribir(db, 'permisos_usuarios', perm);
    res.json({ ok: true });
  });

  app.delete('/api/portal/usuarios/:nombre', (req, res) => {
    const nombre = limpiarNombre(req.params.nombre);
    const pines = leer(db, 'pin_admin', {});
    const perm = leer(db, 'permisos_usuarios', {});
    if (!(nombre in pines)) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (nombre === req.usuario) return res.status(400).json({ error: 'No puedes borrarte a ti mismo' });
    if (permisosDe(db, nombre).admin && !Object.keys(pines).some(n => n !== nombre && permisosDe(db, n).admin))
      return res.status(400).json({ error: 'Tiene que quedar al menos un administrador' });
    delete pines[nombre]; delete perm[nombre];
    escribir(db, 'pin_admin', pines);
    escribir(db, 'permisos_usuarios', perm);
    db.prepare('DELETE FROM sesiones WHERE usuario = ?').run(nombre); // se le cierra la sesión
    res.json({ ok: true });
  });
}

module.exports = { MODULOS, iniciar, permisosDe, puede, verFichajes, middleware, montar };
