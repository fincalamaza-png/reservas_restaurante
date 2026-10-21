// ─── PORTAL DE GESTIÓN DON FADRIQUE ──────────────────────────────────────────
// Portada con Hotel / Restaurante y los módulos nuevos del restaurante:
//   · Carta y Menús (carta conectada al TPV, menús imprimibles y menús personalizados)
//   · Bodas y Comuniones (calendario, fichas, fianza, documento)
//   · Contabilidad (ventas TPV + cobros de bodas y comuniones + presupuestos)
// Todo lo que va bajo /api/portal/ exige la misma sesión con PIN que el resto de la app.
'use strict';
const path = require('path');
const crypto = require('crypto');
const PERMISOS = require('./permisos');

const TPV_URL = (process.env.TPV_URL || 'https://gestion.palaciocondealdana.com').replace(/\/$/, '');
const HOTEL_URL = (process.env.HOTEL_URL || 'https://hotel.palaciocondealdana.com').replace(/\/$/, '');
// Familias de la carta del restaurante en el TPV (las mismas que usa generar_carta.py)
const FAMILIAS_EXCLUIDAS_CARTA = [15, 16];

module.exports = function montarPortal(app, db) {
  const dir = __dirname;

  // ── Migraciones ────────────────────────────────────────────────────────────
  try { db.exec("ALTER TABLE plantillas_menu ADD COLUMN formato TEXT DEFAULT 'a4'"); } catch (e) {}
  try { db.exec("ALTER TABLE plantillas_menu ADD COLUMN subtitulo TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE plantillas_menu ADD COLUMN nota TEXT"); } catch (e) {}

  db.exec(`CREATE TABLE IF NOT EXISTS menus_personalizados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE,
    titulo TEXT,
    cliente TEXT,
    telefono TEXT,
    email TEXT,
    fecha TEXT,
    pax INTEGER,
    secciones TEXT,
    precio_persona REAL DEFAULT 0,
    nota TEXT,
    formato TEXT DEFAULT 'a4',
    propuesta_id INTEGER,
    creado_por TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS celebraciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL,
    fecha TEXT NOT NULL,
    hora TEXT,
    lugar TEXT,
    estado TEXT DEFAULT 'bloqueada',
    nombre1 TEXT, apellidos1 TEXT, dni1 TEXT,
    nombre2 TEXT, apellidos2 TEXT, dni2 TEXT,
    protagonista TEXT,
    tel TEXT, tel2 TEXT, email TEXT, direccion TEXT,
    adultos INTEGER DEFAULT 0, ninos INTEGER DEFAULT 0,
    plantilla_id INTEGER, menu_nombre TEXT,
    precio_adulto REAL DEFAULT 0, precio_nino REAL DEFAULT 0,
    fianza_importe REAL DEFAULT 0, fianza_pagada INTEGER DEFAULT 0,
    fianza_fecha TEXT, fianza_forma TEXT,
    pagos TEXT DEFAULT '[]',
    notas TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  try { db.exec("ALTER TABLE celebraciones ADD COLUMN nombre_evento TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE celebraciones ADD COLUMN categoria TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE celebraciones ADD COLUMN empresa TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE celebraciones ADD COLUMN cif TEXT"); } catch (e) {}

  // Administración: albaranes, facturas, presupuestos y proformas de hotel y restaurante
  db.exec(`CREATE TABLE IF NOT EXISTS documentos_admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    area TEXT NOT NULL DEFAULT 'restaurante',
    tipo TEXT NOT NULL DEFAULT 'factura',
    direccion TEXT NOT NULL DEFAULT 'recibido',
    numero TEXT, fecha TEXT, tercero TEXT, nif TEXT, concepto TEXT,
    base REAL DEFAULT 0, iva_pct REAL DEFAULT 21, iva REAL DEFAULT 0, total REAL DEFAULT 0,
    estado TEXT DEFAULT 'pendiente', fecha_pago TEXT, forma_pago TEXT,
    archivo TEXT, archivo_nombre TEXT, archivo_tipo TEXT,
    notas TEXT, creado_por TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`);
  const DOCS_DIR = path.join(path.dirname(process.env.DB_PATH || '/data/reservas.db'), 'documentos');
  try { require('fs').mkdirSync(DOCS_DIR, { recursive: true }); } catch (e) {}

  // Siembra única: menú Sabor de la Memoria, formato tríptico y menús de boda/comunión
  (function sembrarPortalV1() {
    const flag = db.prepare("SELECT valor FROM config WHERE clave = 'portal_v1'").get();
    if (flag && flag.valor === '1') return;
    const existe = n => db.prepare('SELECT id FROM plantillas_menu WHERE nombre = ?').get(n);
    const maxOrden = () => (db.prepare('SELECT MAX(orden) m FROM plantillas_menu').get().m || 0) + 1;
    const ins = db.prepare('INSERT INTO plantillas_menu (nombre, tipo, orden, secciones, precio_persona, activo, formato, subtitulo) VALUES (?,?,?,?,?,1,?,?)');

    if (!existe('Menú Sabor de la Memoria')) {
      // Parte de los platos del "Menú Degustación Tradición" (se puede cambiar después)
      const trad = db.prepare("SELECT secciones, precio_persona FROM plantillas_menu WHERE nombre = 'Menú Degustación Tradición'").get();
      const secc = trad ? trad.secciones : JSON.stringify([
        { tipo: 'lista', titulo: 'Aperitivos', items: ['', ''] },
        { tipo: 'lista', titulo: 'Entrantes', items: ['', '', ''] },
        { tipo: 'plato', titulo: 'Pescado', texto: '' },
        { tipo: 'plato', titulo: 'Carne', texto: '' },
        { tipo: 'plato', titulo: 'Postre', texto: '' }
      ]);
      ins.run('Menú Sabor de la Memoria', 'degustacion', maxOrden(), secc, trad ? trad.precio_persona : 0, 'triptico', 'Los sabores de siempre');
    }
    db.prepare("UPDATE plantillas_menu SET formato = 'triptico' WHERE nombre IN ('Menú Instinto', 'Menú Sabor de la Memoria')").run();

    const barra = { tipo: 'barra_libre', titulo: 'Barra libre', horas: '3,5 horas', precio: 29.90, valor: false };
    const recena = { tipo: 'recena', titulo: 'Recena', valor: false, platos: [
      { nombre: 'Bandeja de minihamburguesas', precio: 0 }, { nombre: 'Pizza', precio: 0 }, { nombre: 'Montaditos', precio: 0 }] };
    if (!existe('Menú de Boda')) {
      ins.run('Menú de Boda', 'boda', maxOrden(), JSON.stringify([
        { tipo: 'lista', titulo: 'Cóctel de bienvenida', items: ['', '', '', '', '', ''] },
        { tipo: 'lista', titulo: 'Entrantes', items: ['', ''] },
        { tipo: 'eleccion', titulo: 'Pescado', elegir: false, opciones: ['', ''] },
        { tipo: 'sino', titulo: 'Sorbete', valor: true },
        { tipo: 'eleccion', titulo: 'Carne', elegir: false, opciones: ['', ''] },
        { tipo: 'plato', titulo: 'Tarta nupcial', texto: '' },
        { tipo: 'plato', titulo: 'Vino blanco', texto: '' },
        { tipo: 'plato', titulo: 'Vino tinto', texto: '' },
        { tipo: 'plato', titulo: 'Cava', texto: '' },
        barra, recena
      ]), 0, 'a4', 'Banquete nupcial');
    }
    if (!existe('Menú de Comunión')) {
      ins.run('Menú de Comunión', 'comunion', maxOrden(), JSON.stringify([
        { tipo: 'plato', titulo: 'Entrante 1', texto: '', compartir: true },
        { tipo: 'plato', titulo: 'Entrante 2', texto: '', compartir: true },
        { tipo: 'plato', titulo: 'Entrante 3', texto: '', compartir: true },
        { tipo: 'eleccion', titulo: 'Pescado', elegir: false, opciones: [''] },
        { tipo: 'sino', titulo: 'Sorbete', valor: false },
        { tipo: 'eleccion', titulo: 'Carne', elegir: false, opciones: [''] },
        { tipo: 'plato', titulo: 'Postre', texto: '' },
        { tipo: 'plato', titulo: 'Vino blanco', texto: '' },
        { tipo: 'plato', titulo: 'Vino tinto', texto: '' }
      ]), 0, 'a4', 'Primera Comunión');
    }
    if (!existe('Menú infantil de Comunión')) {
      ins.run('Menú infantil de Comunión', 'comunion', maxOrden(), JSON.stringify([
        { tipo: 'lista', titulo: 'Para picar', items: ['', ''] },
        { tipo: 'plato', titulo: 'Plato principal', texto: '' },
        { tipo: 'plato', titulo: 'Postre', texto: '' },
        { tipo: 'plato', titulo: 'Bebida', texto: 'Refrescos y agua' }
      ]), 0, 'a4', 'Menú infantil');
    }
    db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES ('portal_v1', '1')").run();
  })();

  // ── Utilidades ─────────────────────────────────────────────────────────────
  const json = (v, def) => { try { return v ? JSON.parse(v) : def; } catch (e) { return def; } };
  const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; };
  const int = v => { const n = parseInt(v, 10); return isFinite(n) ? n : 0; };
  const txt = v => (v == null ? '' : String(v)).slice(0, 5000);

  // ── Páginas ────────────────────────────────────────────────────────────────
  // Menú personalizado compartido: página pública (solo lectura) con su enlace único
  app.get('/menu/:token', (req, res) => res.sendFile(path.join(dir, 'menu.html')));

  // ── Plantillas de menú (las mismas que usan las propuestas) ────────────────
  const parsePlantilla = r => r && Object.assign({}, r, { secciones: json(r.secciones, []), formato: r.formato || 'a4' });

  app.get('/api/portal/plantillas', (req, res) => {
    const rows = db.prepare('SELECT * FROM plantillas_menu WHERE activo = 1 ORDER BY orden, id').all();
    res.json(rows.map(parsePlantilla));
  });
  app.post('/api/portal/plantillas', (req, res) => {
    const d = req.body || {};
    const orden = (db.prepare('SELECT MAX(orden) m FROM plantillas_menu').get().m || 0) + 1;
    const r = db.prepare('INSERT INTO plantillas_menu (nombre, tipo, orden, secciones, precio_persona, activo, formato, subtitulo, nota) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(txt(d.nombre) || 'Nuevo menú', txt(d.tipo) || 'comida', orden, JSON.stringify(d.secciones || []), num(d.precio_persona),
        d.formato === 'triptico' ? 'triptico' : 'a4', txt(d.subtitulo), txt(d.nota));
    res.json(parsePlantilla(db.prepare('SELECT * FROM plantillas_menu WHERE id = ?').get(r.lastInsertRowid)));
  });
  app.put('/api/portal/plantillas/:id', (req, res) => {
    const d = req.body || {};
    const act = db.prepare('SELECT * FROM plantillas_menu WHERE id = ?').get(req.params.id);
    if (!act) return res.status(404).json({ error: 'Menú no encontrado' });
    db.prepare('UPDATE plantillas_menu SET nombre=?, tipo=?, secciones=?, precio_persona=?, formato=?, subtitulo=?, nota=? WHERE id=?')
      .run(txt(d.nombre) || act.nombre, txt(d.tipo) || act.tipo, JSON.stringify(d.secciones || []), num(d.precio_persona),
        d.formato === 'triptico' ? 'triptico' : 'a4', txt(d.subtitulo), txt(d.nota), req.params.id);
    res.json(parsePlantilla(db.prepare('SELECT * FROM plantillas_menu WHERE id = ?').get(req.params.id)));
  });
  app.delete('/api/portal/plantillas/:id', (req, res) => {
    // Se archiva (no se borra) para no romper propuestas antiguas que la referencian
    db.prepare('UPDATE plantillas_menu SET activo = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ── Menús personalizados ───────────────────────────────────────────────────
  const parsePers = r => r && Object.assign({}, r, { secciones: json(r.secciones, []) });
  app.get('/api/portal/personalizados', (req, res) => {
    res.json(db.prepare('SELECT * FROM menus_personalizados ORDER BY updated_at DESC').all().map(parsePers));
  });
  app.get('/api/portal/personalizados/:id', (req, res) => {
    const r = db.prepare('SELECT * FROM menus_personalizados WHERE id = ?').get(req.params.id);
    if (!r) return res.status(404).json({ error: 'No encontrado' });
    res.json(parsePers(r));
  });
  function guardarPers(id, d, usuario) {
    const vals = [txt(d.titulo) || 'Menú personalizado', txt(d.cliente), txt(d.telefono), txt(d.email), txt(d.fecha),
      int(d.pax) || null, JSON.stringify(d.secciones || []), num(d.precio_persona), txt(d.nota), d.formato === 'triptico' ? 'triptico' : 'a4'];
    if (id) {
      db.prepare("UPDATE menus_personalizados SET titulo=?, cliente=?, telefono=?, email=?, fecha=?, pax=?, secciones=?, precio_persona=?, nota=?, formato=?, updated_at=datetime('now') WHERE id=?")
        .run(...vals, id);
      return id;
    }
    return db.prepare('INSERT INTO menus_personalizados (titulo, cliente, telefono, email, fecha, pax, secciones, precio_persona, nota, formato, token, creado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(...vals, crypto.randomBytes(12).toString('hex'), usuario || '').lastInsertRowid;
  }
  app.post('/api/portal/personalizados', (req, res) => {
    const id = guardarPers(null, req.body || {}, req.usuario);
    res.json(parsePers(db.prepare('SELECT * FROM menus_personalizados WHERE id = ?').get(id)));
  });
  app.put('/api/portal/personalizados/:id', (req, res) => {
    if (!db.prepare('SELECT id FROM menus_personalizados WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'No encontrado' });
    guardarPers(req.params.id, req.body || {}, req.usuario);
    res.json(parsePers(db.prepare('SELECT * FROM menus_personalizados WHERE id = ?').get(req.params.id)));
  });
  app.delete('/api/portal/personalizados/:id', (req, res) => {
    db.prepare('DELETE FROM menus_personalizados WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });
  // Convierte el menú personalizado en una propuesta de las de siempre (con enlace de confirmación)
  app.post('/api/portal/personalizados/:id/propuesta', (req, res) => {
    const m = db.prepare('SELECT * FROM menus_personalizados WHERE id = ?').get(req.params.id);
    if (!m) return res.status(404).json({ error: 'No encontrado' });
    const menus = [{ plantilla_id: null, plantilla_nombre: m.titulo, precio_persona: m.precio_persona || 0, secciones: json(m.secciones, []) }];
    const token = crypto.randomBytes(16).toString('hex');
    const r = db.prepare(`INSERT INTO propuestas (plantilla_id, plantilla_nombre, cliente, telefono, email, fecha_evento, tipo_evento, pax, menus, extras, notas, estado, token)
      VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, 'borrador', ?)`)
      .run(m.titulo, m.cliente || '', m.telefono || '', m.email || '', m.fecha || '', txt((req.body || {}).tipo_evento) || 'Grupo familiar',
        m.pax || null, JSON.stringify(menus), m.nota || '', token);
    db.prepare('UPDATE menus_personalizados SET propuesta_id = ? WHERE id = ?').run(r.lastInsertRowid, m.id);
    res.json({ ok: true, propuesta_id: r.lastInsertRowid });
  });

  // Público: lectura del menú compartido por enlace (sin datos de contacto)
  app.get('/api/publico/menu/:token', (req, res) => {
    const r = db.prepare('SELECT titulo, cliente, fecha, pax, secciones, precio_persona, nota, formato FROM menus_personalizados WHERE token = ?').get(req.params.token);
    if (!r) return res.status(404).json({ error: 'Este menú ya no está disponible' });
    res.json(parsePers(r));
  });

  // ── Bodas y comuniones ─────────────────────────────────────────────────────
  const CAMPOS_CELEB = ['fecha', 'hora', 'lugar', 'nombre1', 'apellidos1', 'dni1', 'nombre2', 'apellidos2', 'dni2', 'protagonista',
    'tel', 'tel2', 'email', 'direccion', 'menu_nombre', 'fianza_fecha', 'fianza_forma', 'notas', 'nombre_evento', 'categoria', 'empresa', 'cif'];
  const TIPOS_CELEB = ['boda', 'comunion', 'evento'];
  const quienCeleb = c => c.tipo === 'boda' ? [c.nombre1, c.nombre2].filter(Boolean).join(' y ')
    : c.tipo === 'evento' ? (c.nombre_evento || c.empresa || c.nombre1 || '') : (c.protagonista || c.nombre1 || '');
  const parseCeleb = r => {
    if (!r) return r;
    const o = Object.assign({}, r, { pagos: json(r.pagos, []), fianza_pagada: !!r.fianza_pagada });
    o.importe_previsto = Math.round(((r.adultos || 0) * (r.precio_adulto || 0) + (r.ninos || 0) * (r.precio_nino || 0)) * 100) / 100;
    o.cobrado = Math.round(((o.fianza_pagada ? (r.fianza_importe || 0) : 0) + o.pagos.reduce((s, p) => s + num(p.importe), 0)) * 100) / 100;
    o.pendiente = Math.round((o.importe_previsto * 1.10 - o.cobrado) * 100) / 100; // previsto con IVA 10% menos lo cobrado
    return o;
  };
  function datosCeleb(d, act) {
    const o = {};
    CAMPOS_CELEB.forEach(k => { o[k] = d[k] !== undefined ? txt(d[k]) : (act ? act[k] : ''); });
    o.adultos = d.adultos !== undefined ? int(d.adultos) : (act ? act.adultos : 0);
    o.ninos = d.ninos !== undefined ? int(d.ninos) : (act ? act.ninos : 0);
    o.plantilla_id = d.plantilla_id !== undefined ? (int(d.plantilla_id) || null) : (act ? act.plantilla_id : null);
    o.precio_adulto = d.precio_adulto !== undefined ? num(d.precio_adulto) : (act ? act.precio_adulto : 0);
    o.precio_nino = d.precio_nino !== undefined ? num(d.precio_nino) : (act ? act.precio_nino : 0);
    o.fianza_importe = d.fianza_importe !== undefined ? num(d.fianza_importe) : (act ? act.fianza_importe : 0);
    o.fianza_pagada = d.fianza_pagada !== undefined ? (d.fianza_pagada ? 1 : 0) : (act ? act.fianza_pagada : 0);
    o.pagos = JSON.stringify(Array.isArray(d.pagos) ? d.pagos.map(p => ({ fecha: txt(p.fecha), concepto: txt(p.concepto), importe: num(p.importe), forma: txt(p.forma) })) : (act ? json(act.pagos, []) : []));
    // Estado: bloqueada (ámbar) hasta que se paga la fianza → confirmada (verde)
    let estado = d.estado !== undefined ? txt(d.estado) : (act ? act.estado : 'bloqueada');
    if (estado !== 'cancelada') estado = o.fianza_pagada ? 'confirmada' : 'bloqueada';
    o.estado = estado;
    if (o.fianza_pagada && !o.fianza_fecha) o.fianza_fecha = new Date().toISOString().slice(0, 10);
    return o;
  }
  // Bodas y comuniones tienen permiso por separado
  const modTipo = t => (t === 'comunion' ? 'comuniones' : t === 'evento' ? 'eventos' : 'bodas');
  const puedeTipo = (req, t) => PERMISOS.puede(db, req.usuario, modTipo(t));
  const sinPermiso = res => res.status(403).json({ error: 'No tienes permiso para esta sección' });
  app.use('/api/portal/celebraciones/:id', (req, res, next) => {
    const r = db.prepare('SELECT tipo FROM celebraciones WHERE id = ?').get(req.params.id);
    if (r && !puedeTipo(req, r.tipo)) return sinPermiso(res);
    next();
  });
  app.get('/api/portal/celebraciones', (req, res) => {
    const tipos = TIPOS_CELEB.filter(t => puedeTipo(req, t));
    if (req.query.tipo && !tipos.includes(req.query.tipo)) return sinPermiso(res);
    if (!tipos.length) return sinPermiso(res);
    let sql = 'SELECT * FROM celebraciones WHERE tipo IN (' + tipos.map(() => '?').join(',') + ')';
    const p = tipos.slice();
    if (req.query.tipo) { sql += ' AND tipo = ?'; p.push(req.query.tipo); }
    if (req.query.desde) { sql += ' AND fecha >= ?'; p.push(req.query.desde); }
    if (req.query.hasta) { sql += ' AND fecha <= ?'; p.push(req.query.hasta); }
    sql += ' ORDER BY fecha, hora';
    res.json(db.prepare(sql).all(...p).map(parseCeleb));
  });
  app.get('/api/portal/celebraciones/:id', (req, res) => {
    const r = db.prepare('SELECT * FROM celebraciones WHERE id = ?').get(req.params.id);
    if (!r) return res.status(404).json({ error: 'No encontrada' });
    res.json(parseCeleb(r));
  });
  app.post('/api/portal/celebraciones', (req, res) => {
    const d = req.body || {};
    const tipo = TIPOS_CELEB.includes(d.tipo) ? d.tipo : 'boda';
    if (!puedeTipo(req, tipo)) return sinPermiso(res);
    if (!d.fecha) return res.status(400).json({ error: 'Falta la fecha' });
    const o = datosCeleb(d, null);
    const cols = Object.keys(o);
    const r = db.prepare(`INSERT INTO celebraciones (tipo, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})`)
      .run(tipo, ...cols.map(k => o[k]));
    res.json(parseCeleb(db.prepare('SELECT * FROM celebraciones WHERE id = ?').get(r.lastInsertRowid)));
  });
  app.put('/api/portal/celebraciones/:id', (req, res) => {
    const act = db.prepare('SELECT * FROM celebraciones WHERE id = ?').get(req.params.id);
    if (!act) return res.status(404).json({ error: 'No encontrada' });
    const o = datosCeleb(req.body || {}, act);
    const cols = Object.keys(o);
    db.prepare(`UPDATE celebraciones SET ${cols.map(k => k + '=?').join(',')}, updated_at=datetime('now') WHERE id=?`)
      .run(...cols.map(k => o[k]), req.params.id);
    res.json(parseCeleb(db.prepare('SELECT * FROM celebraciones WHERE id = ?').get(req.params.id)));
  });
  app.delete('/api/portal/celebraciones/:id', (req, res) => {
    db.prepare('DELETE FROM celebraciones WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ── Conexión con el TPV (carta del restaurante y ventas) ──────────────────
  async function tpv(ruta, opts) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const r = await fetch(TPV_URL + ruta, Object.assign({ signal: ctrl.signal }, opts || {}));
      if (!r.ok) throw new Error('El TPV respondió ' + r.status);
      return r;
    } finally { clearTimeout(t); }
  }
  const errTPV = (res, e) => res.status(502).json({ error: 'No se pudo conectar con el TPV (' + (e.name === 'AbortError' ? 'tiempo agotado' : e.message) + ')' });

  app.get('/api/portal/tpv/carta', async (req, res) => {
    try {
      const d = await (await tpv('/api/productos')).json();
      const familias = (d.familias || []).filter(f => f.destino === 'cocina' && !FAMILIAS_EXCLUIDAS_CARTA.includes(f.id));
      const ids = new Set(familias.map(f => f.id));
      let temporada = 'Primavera';
      try { const c = await (await tpv('/api/configuracion/temporada_carta')).json(); temporada = c.valor || temporada; } catch (e) {}
      res.json({ temporada, familias, productos: (d.productos || []).filter(p => ids.has(p.familia_id)) });
    } catch (e) { errTPV(res, e); }
  });
  app.put('/api/portal/tpv/productos/:id', async (req, res) => {
    const d = req.body || {};
    const body = {};
    if (d.nombre !== undefined) body.nombre = txt(d.nombre);
    if (d.precio !== undefined) body.precio = num(d.precio);
    if (d.disponible !== undefined) body.disponible = d.disponible ? 1 : 0;
    try {
      await tpv('/api/productos/' + encodeURIComponent(req.params.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      res.json({ ok: true });
    } catch (e) { errTPV(res, e); }
  });
  app.post('/api/portal/tpv/productos', async (req, res) => {
    const d = req.body || {};
    if (!d.familia_id || !d.nombre) return res.status(400).json({ error: 'Faltan datos del plato' });
    try {
      const r = await (await tpv('/api/productos', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familia_id: int(d.familia_id), nombre: txt(d.nombre), precio: num(d.precio), iva: 10, destino: 'cocina' }) })).json();
      res.json(r);
    } catch (e) { errTPV(res, e); }
  });
  app.put('/api/portal/tpv/temporada', async (req, res) => {
    try {
      await tpv('/api/configuracion/temporada_carta', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valor: txt((req.body || {}).valor) }) });
      res.json({ ok: true });
    } catch (e) { errTPV(res, e); }
  });
  // PDF de la carta con el formato de siempre (lo genera el TPV con generar_carta.py)
  app.get('/api/portal/tpv/carta-pdf', async (req, res) => {
    try {
      const r = await tpv('/api/carta-pdf/generar');
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="carta_don_fadrique.pdf"');
      res.setHeader('Cache-Control', 'no-store');
      res.send(buf);
    } catch (e) { res.status(502).send('No se pudo generar la carta desde el TPV: ' + e.message); }
  });

  // ── Contabilidad ───────────────────────────────────────────────────────────
  app.get('/api/portal/contabilidad', async (req, res) => {
    const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : new Date().toISOString().slice(0, 7);
    const desde = mes + '-01';
    const [y, m] = mes.split('-').map(Number);
    const hasta = mes + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0');
    const enMes = f => f && f >= desde && f <= hasta;

    // 1) TPV
    const out = { mes, desde, hasta, tpv: null, tpv_error: null };
    try {
      const dias = await (await tpv(`/api/informes/ventas?fecha_desde=${desde}&fecha_hasta=${hasta}`)).json();
      const porEspacio = {};
      let total = 0, efectivo = 0, tarjeta = 0, tickets = 0;
      (dias || []).forEach(d => {
        const k = d.espacio_nombre || 'Sin espacio';
        porEspacio[k] = porEspacio[k] || { espacio: k, total: 0, tickets: 0 };
        porEspacio[k].total += d.total || 0; porEspacio[k].tickets += d.tickets || 0;
        total += d.total || 0; efectivo += d.efectivo || 0; tarjeta += d.tarjeta || 0; tickets += d.tickets || 0;
      });
      const porDia = {};
      (dias || []).forEach(d => { porDia[d.fecha] = (porDia[d.fecha] || 0) + (d.total || 0); });
      out.tpv = { total, efectivo, tarjeta, otros: Math.max(0, total - efectivo - tarjeta), tickets,
        espacios: Object.values(porEspacio).sort((a, b) => b.total - a.total),
        dias: Object.keys(porDia).sort().map(f => ({ fecha: f, total: porDia[f] })) };
      try {
        const g = await (await tpv(`/api/gestion/resumen?mes=${mes}`)).json();
        if (g && g.ingresos) out.tpv.base = g.ingresos.total_neto; out.tpv.iva = g.ingresos && g.ingresos.total_iva;
        if (g && Array.isArray(g.personal)) out.tpv.personal = g.personal.reduce((s, p) => s + (p.total_coste || 0), 0);
        if (g && Array.isArray(g.gastos)) out.tpv.gastos = g.gastos.reduce((s, p) => s + (p.total || 0), 0);
      } catch (e) { /* el módulo de gestión del TPV puede no estar publicado */ }
    } catch (e) { out.tpv_error = 'No se pudo leer el TPV (' + (e.name === 'AbortError' ? 'tiempo agotado' : e.message) + ')'; }

    // 2) Bodas y comuniones: cobros del mes y celebraciones del mes
    const celebs = db.prepare('SELECT * FROM celebraciones').all().map(parseCeleb);
    const cobros = [];
    celebs.forEach(c => {
      const quien = quienCeleb(c);
      if (c.fianza_pagada && c.fianza_importe && enMes(c.fianza_fecha))
        cobros.push({ fecha: c.fianza_fecha, tipo: c.tipo, quien, concepto: 'Fianza', importe: c.fianza_importe, forma: c.fianza_forma || '', id: c.id });
      c.pagos.forEach(p => { if (enMes(p.fecha) && num(p.importe)) cobros.push({ fecha: p.fecha, tipo: c.tipo, quien, concepto: p.concepto || 'Pago', importe: num(p.importe), forma: p.forma || '', id: c.id }); });
    });
    cobros.sort((a, b) => a.fecha.localeCompare(b.fecha));
    const delMes = celebs.filter(c => enMes(c.fecha) && c.estado !== 'cancelada').map(c => ({
      id: c.id, tipo: c.tipo, fecha: c.fecha, estado: c.estado,
      quien: quienCeleb(c),
      comensales: (c.adultos || 0) + (c.ninos || 0), previsto: c.importe_previsto, cobrado: c.cobrado, pendiente: c.pendiente }));
    const suma = (arr, k) => Math.round(arr.reduce((s, x) => s + (x[k] || 0), 0) * 100) / 100;
    out.celebraciones = {
      cobros, total_cobros: suma(cobros, 'importe'),
      cobros_bodas: suma(cobros.filter(c => c.tipo === 'boda'), 'importe'),
      cobros_comuniones: suma(cobros.filter(c => c.tipo === 'comunion'), 'importe'),
      cobros_eventos: suma(cobros.filter(c => c.tipo === 'evento'), 'importe'),
      del_mes: delMes, previsto_mes: suma(delMes, 'previsto')
    };

    // 3) Presupuestos de eventos con fecha en el mes (app de reservas)
    try {
      const pres = db.prepare('SELECT numero, cliente, fecha_evento, tipo_evento, total, enviado FROM presupuestos WHERE fecha_evento >= ? AND fecha_evento <= ? ORDER BY fecha_evento').all(desde, hasta);
      out.presupuestos = { lista: pres, total: suma(pres, 'total') };
    } catch (e) { out.presupuestos = { lista: [], total: 0 }; }

    // 4) Documentos de administración del mes (facturas emitidas y recibidas, por área)
    const docs = db.prepare('SELECT * FROM documentos_admin WHERE fecha >= ? AND fecha <= ?').all(desde, hasta);
    const facturas = docs.filter(d => d.tipo === 'factura');
    const sumaD = (f) => Math.round(facturas.filter(f).reduce((s, d) => s + (d.total || 0), 0) * 100) / 100;
    out.documentos = {
      emitidas: { hotel: sumaD(d => d.direccion === 'emitido' && d.area === 'hotel'), restaurante: sumaD(d => d.direccion === 'emitido' && d.area === 'restaurante') },
      recibidas: { hotel: sumaD(d => d.direccion === 'recibido' && d.area === 'hotel'), restaurante: sumaD(d => d.direccion === 'recibido' && d.area === 'restaurante') },
      pendientes_pago: Math.round(docs.filter(d => d.tipo === 'factura' && d.direccion === 'recibido' && d.estado !== 'pagado').reduce((s, d) => s + (d.total || 0), 0) * 100) / 100,
      num: docs.length
    };
    out.documentos.total_emitidas = Math.round((out.documentos.emitidas.hotel + out.documentos.emitidas.restaurante) * 100) / 100;
    out.documentos.total_recibidas = Math.round((out.documentos.recibidas.hotel + out.documentos.recibidas.restaurante) * 100) / 100;

    out.total_ingresos = Math.round(((out.tpv ? out.tpv.total : 0) + out.celebraciones.total_cobros) * 100) / 100;
    try {
      const gm = gastosDelMes(mes);
      out.gastos_admin = { total: Math.round(gm.reduce((t, g) => t + (g.importe_mes || 0), 0) * 100) / 100,
        fijos: Math.round(gm.filter(g => g.tipo === 'fijo').reduce((t, g) => t + g.importe_mes, 0) * 100) / 100,
        variables: Math.round(gm.filter(g => g.tipo === 'variable').reduce((t, g) => t + g.importe_mes, 0) * 100) / 100 };
    } catch (e) {}
    res.json(out);
  });

  // ── Administración: archivo de documentos ──────────────────────────────────
  const TIPOS_DOC = ['albaran', 'factura', 'presupuesto', 'proforma'];
  const parseDoc = d => d && Object.assign({}, d, { tiene_archivo: !!d.archivo });
  function datosDoc(d, act) {
    const o = {};
    o.area = d.area === 'hotel' ? 'hotel' : (d.area === 'restaurante' ? 'restaurante' : (act ? act.area : 'restaurante'));
    o.tipo = TIPOS_DOC.includes(d.tipo) ? d.tipo : (act ? act.tipo : 'factura');
    o.direccion = d.direccion === 'emitido' ? 'emitido' : (d.direccion === 'recibido' ? 'recibido' : (act ? act.direccion : 'recibido'));
    ['numero', 'fecha', 'tercero', 'nif', 'concepto', 'fecha_pago', 'forma_pago', 'notas'].forEach(k => { o[k] = d[k] !== undefined ? txt(d[k]) : (act ? act[k] : ''); });
    o.base = d.base !== undefined ? num(d.base) : (act ? act.base : 0);
    o.iva_pct = d.iva_pct !== undefined ? num(d.iva_pct) : (act ? act.iva_pct : 21);
    o.iva = d.iva !== undefined ? num(d.iva) : Math.round(o.base * o.iva_pct) / 100;
    o.total = d.total !== undefined && num(d.total) ? num(d.total) : Math.round((o.base + o.iva) * 100) / 100;
    o.estado = d.estado === 'pagado' ? 'pagado' : 'pendiente';
    if (o.estado === 'pagado' && !o.fecha_pago) o.fecha_pago = new Date().toISOString().slice(0, 10);
    if (!o.fecha) o.fecha = new Date().toISOString().slice(0, 10);
    return o;
  }
  app.get('/api/portal/documentos', (req, res) => {
    let sql = 'SELECT * FROM documentos_admin WHERE 1=1'; const p = [];
    ['area', 'tipo', 'direccion', 'estado'].forEach(k => { if (req.query[k]) { sql += ` AND ${k} = ?`; p.push(req.query[k]); } });
    if (req.query.desde) { sql += ' AND fecha >= ?'; p.push(req.query.desde); }
    if (req.query.hasta) { sql += ' AND fecha <= ?'; p.push(req.query.hasta); }
    if (req.query.q) { sql += ' AND (tercero LIKE ? OR numero LIKE ? OR concepto LIKE ?)'; const q = '%' + req.query.q + '%'; p.push(q, q, q); }
    sql += ' ORDER BY fecha DESC, id DESC LIMIT 500';
    res.json(db.prepare(sql).all(...p).map(parseDoc));
  });
  app.get('/api/portal/documentos/:id', (req, res) => {
    const d = db.prepare('SELECT * FROM documentos_admin WHERE id = ?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'No encontrado' });
    res.json(parseDoc(d));
  });
  app.post('/api/portal/documentos', (req, res) => {
    const o = datosDoc(req.body || {}, null); const cols = Object.keys(o);
    const r = db.prepare(`INSERT INTO documentos_admin (${cols.join(',')}, creado_por) VALUES (${cols.map(() => '?').join(',')}, ?)`).run(...cols.map(k => o[k]), req.usuario || '');
    res.json(parseDoc(db.prepare('SELECT * FROM documentos_admin WHERE id = ?').get(r.lastInsertRowid)));
  });
  app.put('/api/portal/documentos/:id', (req, res) => {
    const act = db.prepare('SELECT * FROM documentos_admin WHERE id = ?').get(req.params.id);
    if (!act) return res.status(404).json({ error: 'No encontrado' });
    const o = datosDoc(req.body || {}, act); const cols = Object.keys(o);
    db.prepare(`UPDATE documentos_admin SET ${cols.map(k => k + '=?').join(',')}, updated_at=datetime('now') WHERE id=?`).run(...cols.map(k => o[k]), req.params.id);
    res.json(parseDoc(db.prepare('SELECT * FROM documentos_admin WHERE id = ?').get(req.params.id)));
  });
  app.delete('/api/portal/documentos/:id', (req, res) => {
    const d = db.prepare('SELECT archivo FROM documentos_admin WHERE id = ?').get(req.params.id);
    if (d && d.archivo) { try { require('fs').unlinkSync(path.join(DOCS_DIR, d.archivo)); } catch (e) {} }
    db.prepare('DELETE FROM documentos_admin WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });
  // Archivo adjunto (foto o PDF del documento)
  const TIPOS_ARCHIVO = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic' };
  app.post('/api/portal/documentos/:id/archivo', require('express').raw({ type: () => true, limit: '25mb' }), (req, res) => {
    const d = db.prepare('SELECT * FROM documentos_admin WHERE id = ?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'No encontrado' });
    const tipo = String(req.headers['content-type'] || '').split(';')[0];
    if (!TIPOS_ARCHIVO[tipo]) return res.status(400).json({ error: 'Solo se admiten fotos (JPG, PNG) o PDF' });
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'Archivo vacío' });
    const nombre = 'doc_' + d.id + '_' + crypto.randomBytes(6).toString('hex') + TIPOS_ARCHIVO[tipo];
    require('fs').writeFileSync(path.join(DOCS_DIR, nombre), req.body);
    if (d.archivo) { try { require('fs').unlinkSync(path.join(DOCS_DIR, d.archivo)); } catch (e) {} }
    const original = decodeURIComponent(String(req.headers['x-nombre'] || '')).slice(0, 200) || nombre;
    db.prepare('UPDATE documentos_admin SET archivo=?, archivo_nombre=?, archivo_tipo=? WHERE id=?').run(nombre, original, tipo, d.id);
    res.json({ ok: true });
  });
  app.get('/api/portal/documentos/:id/archivo', (req, res) => {
    const d = db.prepare('SELECT * FROM documentos_admin WHERE id = ?').get(req.params.id);
    if (!d || !d.archivo) return res.status(404).send('Sin archivo');
    const f = path.join(DOCS_DIR, d.archivo);
    if (!require('fs').existsSync(f)) return res.status(404).send('Archivo no encontrado');
    res.setHeader('Content-Type', d.archivo_tipo || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(d.archivo_nombre || d.archivo) + '"');
    res.sendFile(f);
  });

  // ══ GASTOS FIJOS, PAGOS Y PANEL «MI DÍA» ═════════════════════════════════
  // · gastos_admin: gastos FIJOS (luz, agua, seguro…) con su importe y cada cuánto se pagan.
  //   En los listados se reparten por días (prorrateo) según las fechas que se miren.
  // · pagos: TODO lo que se paga (pescado, carne, recibo de la luz…), con fecha, forma de pago
  //   y quién lo paga. Los de categorías variables cuentan como gasto del día; los de categorías
  //   fijas solo cuentan como dinero que ha salido (el gasto ya está en el fijo prorrateado).
  db.exec(`CREATE TABLE IF NOT EXISTS gastos_admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL, importe REAL DEFAULT 0,
    tipo TEXT DEFAULT 'fijo', periodicidad TEXT DEFAULT 'mensual',
    area TEXT DEFAULT 'restaurante', fecha TEXT, fecha_fin TEXT,
    forma_pago TEXT, notas TEXT, activo INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  try { db.exec("ALTER TABLE gastos_admin ADD COLUMN categoria TEXT"); } catch (e) {}
  db.exec(`CREATE TABLE IF NOT EXISTS pagos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL, area TEXT DEFAULT 'restaurante',
    categoria TEXT, tipo_gasto TEXT DEFAULT 'variable',
    concepto TEXT, proveedor TEXT, importe REAL DEFAULT 0,
    forma_pago TEXT, pagado_por TEXT, notas TEXT,
    creado_por TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`);
  // Migración única: los antiguos gastos «variables» pasan a ser pagos
  (function () {
    const f = db.prepare("SELECT valor FROM config WHERE clave = 'pagos_v1'").get();
    if (f && f.valor === '1') return;
    db.prepare("SELECT * FROM gastos_admin WHERE tipo = 'variable'").all().forEach(g => {
      db.prepare('INSERT INTO pagos (fecha, area, categoria, tipo_gasto, concepto, importe, forma_pago, notas) VALUES (?,?,?,?,?,?,?,?)')
        .run(g.fecha, g.area === 'hotel' ? 'hotel' : 'restaurante', 'Varios', 'variable', g.nombre, g.importe, g.forma_pago || '', g.notas || '');
    });
    db.prepare("DELETE FROM gastos_admin WHERE tipo = 'variable'").run();
    db.prepare("UPDATE gastos_admin SET categoria = COALESCE(categoria, nombre) WHERE tipo = 'fijo'").run();
    db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES ('pagos_v1', '1')").run();
  })();

  const CATEGORIAS = {
    restaurante: { fijos: ['Luz', 'Agua', 'Gas', 'Seguro', 'Personal', 'IBI'], variables: ['Pescado', 'Carne', 'Fruta y verdura', 'Bebidas', 'Café', 'Varios', 'Otros'] },
    hotel: { fijos: ['Luz', 'Agua', 'Gas', 'Seguro', 'Personal'], variables: ['Comisiones', 'Publicidad', 'Mantenimiento', 'Varios'] }
  };
  const AREAS = ['restaurante', 'hotel'];
  const MESES_PERIODO = { mensual: 1, trimestral: 3, semestral: 6, anual: 12 };
  const FORMAS_PAGO = ['Efectivo', 'Tarjeta', 'Transferencia', 'Domiciliación', 'Bizum'];
  const fijasDe = area => {
    const extra = db.prepare("SELECT DISTINCT categoria FROM gastos_admin WHERE area = ? AND categoria IS NOT NULL").all(area).map(r => r.categoria);
    return Array.from(new Set((CATEGORIAS[area] || CATEGORIAS.restaurante).fijos.concat(extra)));
  };
  const tipoDeCategoria = (area, cat) => fijasDe(area).includes(cat) ? 'fijo' : 'variable';
  const r2 = n => Math.round((n || 0) * 100) / 100;
  const diasEntre = (desde, hasta) => { const out = []; let d = desde; while (d <= hasta && out.length < 1200) { out.push(d); const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); d = t.toISOString().slice(0, 10); } return out; };
  const diasMes = d => new Date(+d.slice(0, 4), +d.slice(5, 7), 0).getDate();

  // Gastos de un periodo: fijos repartidos por día + pagos de categorías variables
  function gastosEnRango(desde, hasta) {
    const dias = diasEntre(desde, hasta);
    const fijos = db.prepare("SELECT * FROM gastos_admin WHERE tipo = 'fijo' AND activo = 1").all().map(g => {
      let imp = 0;
      const mensual = (g.importe || 0) / (MESES_PERIODO[g.periodicidad] || 1);
      dias.forEach(d => { if ((g.fecha || '') <= d && (!g.fecha_fin || g.fecha_fin >= d)) imp += mensual / diasMes(d); });
      return Object.assign({}, g, { categoria: g.categoria || g.nombre, prorrateado: r2(imp), mensual: r2(mensual) });
    }).filter(g => g.prorrateado);
    const pagosVar = db.prepare("SELECT * FROM pagos WHERE fecha >= ? AND fecha <= ? AND tipo_gasto = 'variable' ORDER BY fecha").all(desde, hasta);
    return { fijos, variables: pagosVar };
  }
  // Compatibilidad con el resumen mensual
  function gastosDelMes(mes) {
    const desde = mes + '-01', hasta = mes + '-' + String(diasMes(desde)).padStart(2, '0');
    const g = gastosEnRango(desde, hasta);
    return g.fijos.map(f => Object.assign({}, f, { tipo: 'fijo', importe_mes: f.prorrateado }))
      .concat(g.variables.map(v => ({ id: v.id, nombre: v.concepto || v.categoria, tipo: 'variable', fecha: v.fecha, area: v.area, importe_mes: v.importe })));
  }

  // ── Opciones para los formularios: categorías, formas de pago y quién puede pagar
  function pagadores() {
    const pines = (() => { try { return JSON.parse(db.prepare("SELECT valor FROM config WHERE clave = 'pin_admin'").get().valor || '{}'); } catch (e) { return {}; } })();
    return Object.keys(pines).filter(n => PERMISOS.puede(db, n, 'pagos'));
  }
  app.get('/api/portal/pagos/opciones', (req, res) => {
    const cats = {}; AREAS.forEach(a => {
      const extraVar = db.prepare("SELECT DISTINCT categoria FROM pagos WHERE area = ? AND tipo_gasto = 'variable' AND categoria IS NOT NULL").all(a).map(r => r.categoria);
      cats[a] = { fijos: fijasDe(a), variables: Array.from(new Set(CATEGORIAS[a].variables.concat(extraVar))) };
    });
    res.json({ categorias: cats, formas: FORMAS_PAGO, pagadores: pagadores(), puede_anotar: PERMISOS.puede(db, req.usuario, 'pagos'), usuario: req.usuario });
  });

  // ── Gastos fijos (definiciones)
  function datosFijo(d, act) {
    const o = {};
    o.categoria = d.categoria !== undefined ? txt(d.categoria).slice(0, 60) : (act ? act.categoria : '');
    o.nombre = (d.nombre !== undefined ? txt(d.nombre).slice(0, 120) : (act ? act.nombre : '')) || o.categoria;
    o.importe = d.importe !== undefined ? num(d.importe) : (act ? act.importe : 0);
    o.tipo = 'fijo';
    o.periodicidad = MESES_PERIODO[d.periodicidad] ? d.periodicidad : (act ? act.periodicidad : 'mensual');
    o.area = AREAS.includes(d.area) ? d.area : (act ? act.area : 'restaurante');
    ['fecha', 'fecha_fin', 'forma_pago', 'notas'].forEach(k => { o[k] = d[k] !== undefined ? txt(d[k]) : (act ? act[k] : ''); });
    if (!o.fecha) o.fecha = new Date().toISOString().slice(0, 8) + '01';
    o.activo = d.activo !== undefined ? (d.activo ? 1 : 0) : (act ? act.activo : 1);
    return o;
  }
  app.get('/api/portal/gastos', (req, res) => {
    const l = db.prepare("SELECT * FROM gastos_admin WHERE tipo = 'fijo' ORDER BY area, activo DESC, categoria, nombre").all()
      .map(g => Object.assign({}, g, { mensual: r2((g.importe || 0) / (MESES_PERIODO[g.periodicidad] || 1)) }));
    const total = a => r2(l.filter(g => g.activo && g.area === a).reduce((t, g) => t + g.mensual, 0));
    res.json({ fijos: l, mensual_restaurante: total('restaurante'), mensual_hotel: total('hotel') });
  });
  app.get('/api/portal/gastos/:id', (req, res) => {
    const g = db.prepare('SELECT * FROM gastos_admin WHERE id = ?').get(req.params.id);
    if (!g) return res.status(404).json({ error: 'No encontrado' });
    res.json(g);
  });
  app.post('/api/portal/gastos', (req, res) => {
    const o = datosFijo(req.body || {}, null);
    if (!o.categoria) return res.status(400).json({ error: 'Elige o escribe la categoría del gasto' });
    const cols = Object.keys(o);
    const r = db.prepare(`INSERT INTO gastos_admin (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(k => o[k]));
    res.json(db.prepare('SELECT * FROM gastos_admin WHERE id = ?').get(r.lastInsertRowid));
  });
  app.put('/api/portal/gastos/:id', (req, res) => {
    const act = db.prepare('SELECT * FROM gastos_admin WHERE id = ?').get(req.params.id);
    if (!act) return res.status(404).json({ error: 'No encontrado' });
    const o = datosFijo(req.body || {}, act); const cols = Object.keys(o);
    db.prepare(`UPDATE gastos_admin SET ${cols.map(k => k + '=?').join(',')} WHERE id=?`).run(...cols.map(k => o[k]), req.params.id);
    res.json(db.prepare('SELECT * FROM gastos_admin WHERE id = ?').get(req.params.id));
  });
  app.delete('/api/portal/gastos/:id', (req, res) => {
    db.prepare('DELETE FROM gastos_admin WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ── Pagos (solo los usuarios con permiso «pagos» pueden anotarlos)
  function datosPago(d, act, usuario) {
    const o = {};
    o.fecha = /^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '') ? d.fecha : (act ? act.fecha : new Date().toISOString().slice(0, 10));
    o.area = AREAS.includes(d.area) ? d.area : (act ? act.area : 'restaurante');
    o.categoria = d.categoria !== undefined ? txt(d.categoria).slice(0, 60) : (act ? act.categoria : '');
    o.tipo_gasto = tipoDeCategoria(o.area, o.categoria);
    ['concepto', 'proveedor', 'notas'].forEach(k => { o[k] = d[k] !== undefined ? txt(d[k]) : (act ? act[k] : ''); });
    o.importe = d.importe !== undefined ? num(d.importe) : (act ? act.importe : 0);
    o.forma_pago = d.forma_pago !== undefined ? txt(d.forma_pago) : (act ? act.forma_pago : '');
    o.pagado_por = d.pagado_por !== undefined ? txt(d.pagado_por) : (act ? act.pagado_por : usuario);
    return o;
  }
  function validarPago(o) {
    if (!o.categoria) return 'Elige la categoría';
    if (!(o.importe > 0)) return 'Pon el importe';
    if (!o.forma_pago) return 'Indica cómo se ha pagado';
    if (!pagadores().includes(o.pagado_por)) return 'Indica quién lo ha pagado';
    return null;
  }
  app.get('/api/portal/pagos', (req, res) => {
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde || '') ? req.query.desde : new Date().toISOString().slice(0, 8) + '01';
    const hasta = /^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta || '') ? req.query.hasta : new Date().toISOString().slice(0, 10);
    res.json(db.prepare('SELECT * FROM pagos WHERE fecha >= ? AND fecha <= ? ORDER BY fecha DESC, id DESC').all(desde, hasta));
  });
  app.get('/api/portal/pagos/:id', (req, res) => {
    const p = db.prepare('SELECT * FROM pagos WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'No encontrado' });
    res.json(p);
  });
  app.post('/api/portal/pagos', (req, res) => {
    const o = datosPago(req.body || {}, null, req.usuario);
    const err = validarPago(o); if (err) return res.status(400).json({ error: err });
    const cols = Object.keys(o);
    const r = db.prepare(`INSERT INTO pagos (${cols.join(',')}, creado_por) VALUES (${cols.map(() => '?').join(',')}, ?)`).run(...cols.map(k => o[k]), req.usuario || '');
    res.json(db.prepare('SELECT * FROM pagos WHERE id = ?').get(r.lastInsertRowid));
  });
  app.put('/api/portal/pagos/:id', (req, res) => {
    const act = db.prepare('SELECT * FROM pagos WHERE id = ?').get(req.params.id);
    if (!act) return res.status(404).json({ error: 'No encontrado' });
    const o = datosPago(req.body || {}, act, req.usuario);
    const err = validarPago(o); if (err) return res.status(400).json({ error: err });
    const cols = Object.keys(o);
    db.prepare(`UPDATE pagos SET ${cols.map(k => k + '=?').join(',')}, updated_at=datetime('now') WHERE id=?`).run(...cols.map(k => o[k]), req.params.id);
    res.json(db.prepare('SELECT * FROM pagos WHERE id = ?').get(req.params.id));
  });
  app.delete('/api/portal/pagos/:id', (req, res) => {
    db.prepare('DELETE FROM pagos WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ── Panel «Mi día»: facturado, cobrado, gastos y pagos de un periodo (en directo si incluye hoy)
  app.get('/api/portal/panel', async (req, res) => {
    const ok = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
    let desde = ok(req.query.desde) ? req.query.desde : null, hasta = ok(req.query.hasta) ? req.query.hasta : null;
    const out = { avisos: [] };
    // 1) Restaurante (TPV) por jornadas de 03:00 a 03:00
    let tpvD = null;
    try {
      tpvD = await (await tpv(`/api/informes/jornada${desde ? `?desde=${desde}&hasta=${hasta || desde}` : ''}`)).json();
      desde = desde || tpvD.desde; hasta = hasta || tpvD.hasta;
      out.jornada_actual = tpvD.jornada_actual;
    } catch (e) { out.avisos.push('No se pudo leer el TPV'); }
    if (!desde) { desde = new Date().toISOString().slice(0, 10); }
    if (!hasta || hasta < desde) hasta = desde;
    out.desde = desde; out.hasta = hasta;
    const enRango = f => f && f >= desde && f <= hasta;

    const facturado = { 'Restaurante': 0, 'Hotel': 0, 'Eventos': 0, 'Facturas emitidas': 0 };
    const cobrado = {}; ['Efectivo', 'Tarjeta', 'Transferencia', 'Bizum', 'Empresa / a cuenta', 'Sin indicar'].forEach(f => { cobrado[f] = 0; });
    if (tpvD) {
      facturado.Restaurante = tpvD.total;
      cobrado.Efectivo += tpvD.efectivo; cobrado.Tarjeta += tpvD.tarjeta; cobrado['Empresa / a cuenta'] += tpvD.empresa; cobrado['Sin indicar'] += tpvD.otros;
      out.tpv = { total: r2(tpvD.total), tickets: tpvD.tickets, ticket_medio: tpvD.tickets ? r2(tpvD.total / tpvD.tickets) : 0, efectivo: r2(tpvD.efectivo), tarjeta: r2(tpvD.tarjeta),
        espacios: Object.keys(tpvD.espacios).map(k => ({ espacio: k, total: r2(tpvD.espacios[k].total), tickets: tpvD.espacios[k].tickets })).sort((a, b) => b.total - a.total),
        dias: tpvD.dias, ultima_venta: tpvD.ultima_venta, comandas_abiertas: tpvD.comandas_abiertas, en_mesas: tpvD.en_mesas, cierres: tpvD.cierres,
        zonas: tpvD.zonas || [], camareros: tpvD.camareros || [], abiertas: tpvD.abiertas || [], ventas: tpvD.ventas || [] };
    }
    // 2) Hotel: facturas emitidas en esas fechas
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 10000);
      const fr = await fetch(HOTEL_URL + '/api/facturas', { signal: ctrl.signal }); clearTimeout(t);
      if (!fr.ok) throw new Error(fr.status);
      (await fr.json()).filter(f => enRango(String(f.fecha_emision || f.created_at || '').slice(0, 10)) && f.estado !== 'anulada')
        .forEach(f => { facturado.Hotel += f.total || 0; cobrado['Sin indicar'] += f.total || 0; });
    } catch (e) { out.avisos.push('No se pudo leer la app del hotel'); }
    // 3) Eventos: fianzas y pagos recibidos
    const formaN = f => { const x = String(f || '').toLowerCase(); return x.startsWith('efect') ? 'Efectivo' : x.startsWith('tarj') ? 'Tarjeta' : x.startsWith('transf') ? 'Transferencia' : x.startsWith('bizum') ? 'Bizum' : 'Sin indicar'; };
    db.prepare('SELECT * FROM celebraciones').all().map(parseCeleb).forEach(c => {
      if (c.fianza_pagada && c.fianza_importe && enRango(c.fianza_fecha)) { facturado.Eventos += c.fianza_importe; cobrado[formaN(c.fianza_forma)] += c.fianza_importe; }
      c.pagos.forEach(p => { if (enRango(p.fecha) && num(p.importe)) { facturado.Eventos += num(p.importe); cobrado[formaN(p.forma)] += num(p.importe); } });
    });
    // 4) Facturas emitidas registradas en Documentos
    db.prepare("SELECT * FROM documentos_admin WHERE tipo = 'factura' AND direccion = 'emitido'").all().forEach(d => {
      if (enRango(d.fecha)) facturado['Facturas emitidas'] += d.total || 0;
      if (d.estado === 'pagado' && enRango(d.fecha_pago || d.fecha)) cobrado[formaN(d.forma_pago)] += d.total || 0;
    });
    Object.keys(facturado).forEach(k => { facturado[k] = r2(facturado[k]); });
    Object.keys(cobrado).forEach(k => { cobrado[k] = r2(cobrado[k]); });
    out.facturado = facturado; out.total_facturado = r2(Object.values(facturado).reduce((a, b) => a + b, 0));
    out.cobrado = cobrado; out.total_cobrado = r2(Object.values(cobrado).reduce((a, b) => a + b, 0));

    // 5) Gastos (fijos prorrateados + variables) por área y categoría
    const g = gastosEnRango(desde, hasta);
    const gastos = {};
    AREAS.forEach(a => {
      const fij = {}, vari = {};
      g.fijos.filter(x => x.area === a).forEach(x => { fij[x.categoria] = r2((fij[x.categoria] || 0) + x.prorrateado); });
      g.variables.filter(x => x.area === a).forEach(x => { vari[x.categoria] = r2((vari[x.categoria] || 0) + x.importe); });
      const lista = o => Object.keys(o).map(k => ({ categoria: k, importe: o[k] })).sort((x, y) => y.importe - x.importe);
      gastos[a] = { fijos: lista(fij), variables: lista(vari), total_fijos: r2(Object.values(fij).reduce((s, v) => s + v, 0)), total_variables: r2(Object.values(vari).reduce((s, v) => s + v, 0)) };
      gastos[a].total = r2(gastos[a].total_fijos + gastos[a].total_variables);
    });
    out.gastos = gastos;
    out.total_gastos = r2(AREAS.reduce((s, a) => s + gastos[a].total, 0));
    out.resultado = r2(out.total_facturado - out.total_gastos);

    // 6) Pagos anotados (dinero que ha salido), por forma de pago y por quién
    const pagos = db.prepare('SELECT * FROM pagos WHERE fecha >= ? AND fecha <= ? ORDER BY fecha DESC, id DESC').all(desde, hasta);
    const porForma = {}, porPersona = {};
    pagos.forEach(p => { porForma[p.forma_pago || 'Sin indicar'] = r2((porForma[p.forma_pago || 'Sin indicar'] || 0) + p.importe); porPersona[p.pagado_por || '—'] = r2((porPersona[p.pagado_por || '—'] || 0) + p.importe); });
    out.pagos = pagos.slice(0, 200);
    out.total_pagado = r2(pagos.reduce((s, p) => s + p.importe, 0));
    out.pagado_por_forma = porForma; out.pagado_por_persona = porPersona;
    out.dias = diasEntre(desde, hasta).length;
    out.actualizado = new Date().toISOString();
    res.json(out);
  });

  // ══ FACTURACIÓN Y COBROS (qué se ha facturado y cómo se ha cobrado) ══════
  const FORMAS = ['Efectivo', 'Tarjeta', 'Transferencia', 'Bizum', 'Domiciliación', 'Sin indicar'];
  const normForma = f => {
    const x = String(f || '').toLowerCase();
    if (x.startsWith('efect')) return 'Efectivo';
    if (x.startsWith('tarj')) return 'Tarjeta';
    if (x.startsWith('transf')) return 'Transferencia';
    if (x.startsWith('bizum')) return 'Bizum';
    if (x.startsWith('domic')) return 'Domiciliación';
    return 'Sin indicar';
  };
  app.get('/api/portal/facturacion', async (req, res) => {
    const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : new Date().toISOString().slice(0, 7);
    const desde = mes + '-01';
    const [y, m] = mes.split('-').map(Number);
    const hasta = mes + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0');
    const enMes = f => f && f >= desde && f <= hasta;
    const r2 = n => Math.round((n || 0) * 100) / 100;
    const origenes = ['Restaurante (TPV)', 'Hotel', 'Eventos', 'Facturas emitidas'];
    const cobros = {}; FORMAS.forEach(f => { cobros[f] = {}; origenes.forEach(o => { cobros[f][o] = 0; }); });
    const facturado = {}; origenes.forEach(o => { facturado[o] = 0; });
    const avisos = [];

    // TPV: lo cobrado en el restaurante (efectivo / tarjeta)
    try {
      const dias = await (await tpv(`/api/informes/ventas?fecha_desde=${desde}&fecha_hasta=${hasta}`)).json();
      (dias || []).forEach(d => {
        facturado['Restaurante (TPV)'] += d.total || 0;
        cobros.Efectivo['Restaurante (TPV)'] += d.efectivo || 0;
        cobros.Tarjeta['Restaurante (TPV)'] += d.tarjeta || 0;
        cobros['Sin indicar']['Restaurante (TPV)'] += Math.max(0, (d.total || 0) - (d.efectivo || 0) - (d.tarjeta || 0));
      });
    } catch (e) { avisos.push('No se pudo leer el TPV'); }

    // Hotel: facturas emitidas en el mes (la app del hotel no guarda la forma de pago)
    let facturasHotel = [];
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
      const fr = await fetch(HOTEL_URL + '/api/facturas', { signal: ctrl.signal }); clearTimeout(t);
      if (!fr.ok) throw new Error(fr.status);
      facturasHotel = (await fr.json()).filter(f => enMes(String(f.fecha_emision || f.created_at || '').slice(0, 10)) && f.estado !== 'anulada');
      facturasHotel.forEach(f => { facturado.Hotel += f.total || 0; cobros['Sin indicar'].Hotel += f.total || 0; });
    } catch (e) { avisos.push('No se pudo leer la app del hotel'); }

    // Eventos (bodas, comuniones y eventos): fianzas y pagos con su forma de pago
    db.prepare('SELECT * FROM celebraciones').all().map(parseCeleb).forEach(c => {
      if (c.fianza_pagada && c.fianza_importe && enMes(c.fianza_fecha)) { cobros[normForma(c.fianza_forma)].Eventos += c.fianza_importe; facturado.Eventos += c.fianza_importe; }
      c.pagos.forEach(p => { if (enMes(p.fecha) && num(p.importe)) { cobros[normForma(p.forma)].Eventos += num(p.importe); facturado.Eventos += num(p.importe); } });
    });

    // Facturas emitidas en Administración: facturado por fecha; cobrado por fecha de pago
    const emitidas = db.prepare("SELECT * FROM documentos_admin WHERE tipo = 'factura' AND direccion = 'emitido'").all();
    emitidas.forEach(d => {
      if (enMes(d.fecha)) facturado['Facturas emitidas'] += d.total || 0;
      if (d.estado === 'pagado' && enMes(d.fecha_pago || d.fecha)) cobros[normForma(d.forma_pago)]['Facturas emitidas'] += d.total || 0;
    });
    const pendientesCobro = emitidas.filter(d => d.estado !== 'pagado').map(d => ({ id: d.id, area: d.area, numero: d.numero, fecha: d.fecha, tercero: d.tercero, total: d.total }));

    // Pagado a proveedores (facturas y albaranes recibidos pagados) y gastos del mes
    const pagadoProv = {}; FORMAS.forEach(f => { pagadoProv[f] = 0; });
    db.prepare("SELECT * FROM documentos_admin WHERE direccion = 'recibido' AND tipo IN ('factura','albaran') AND estado = 'pagado'").all()
      .forEach(d => { if (enMes(d.fecha_pago || d.fecha)) pagadoProv[normForma(d.forma_pago)] += d.total || 0; });
    const gastos = gastosDelMes(mes);

    // Redondeo y totales
    const filas = FORMAS.map(f => {
      const fila = { forma: f, total: 0 };
      origenes.forEach(o => { fila[o] = r2(cobros[f][o]); fila.total += cobros[f][o]; });
      fila.total = r2(fila.total);
      return fila;
    }).filter(f => f.total || f.forma !== 'Sin indicar' && f.forma !== 'Domiciliación' && f.forma !== 'Bizum');
    origenes.forEach(o => { facturado[o] = r2(facturado[o]); });
    res.json({
      mes, origenes, facturado, total_facturado: r2(origenes.reduce((s, o) => s + facturado[o], 0)),
      cobros: filas, total_cobrado: r2(filas.reduce((s, f) => s + f.total, 0)),
      pagado_proveedores: FORMAS.map(f => ({ forma: f, total: r2(pagadoProv[f]) })).filter(x => x.total),
      total_pagado_proveedores: r2(FORMAS.reduce((s, f) => s + pagadoProv[f], 0)),
      gastos_mes: r2(gastos.reduce((s, g) => s + (g.importe_mes || 0), 0)),
      pendientes_cobro: pendientesCobro, facturas_hotel: facturasHotel.length, avisos
    });
  });

  // ══ PERSONAL (solo administradores) ═════════════════════════════════════
  // Los trabajadores están en el TPV (su PIN sirve para fichar allí); aquí se guarda su ficha.
  db.exec(`CREATE TABLE IF NOT EXISTS trabajadores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tpv_usuario_id INTEGER UNIQUE,
    nombre TEXT, apellidos TEXT, dni TEXT, nss TEXT, fecha_nacimiento TEXT,
    telefono TEXT, email TEXT, direccion TEXT, iban TEXT,
    puesto TEXT, area TEXT, contrato TEXT, jornada TEXT, horas_semana REAL,
    salario REAL, fecha_alta TEXT, fecha_baja TEXT, notas TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`);
  const CAMPOS_TRAB = ['nombre', 'apellidos', 'dni', 'nss', 'fecha_nacimiento', 'telefono', 'email', 'direccion', 'iban', 'puesto', 'area', 'contrato', 'jornada', 'fecha_alta', 'fecha_baja', 'notas'];
  const jsonTPV = async (ruta, metodo, cuerpo) => {
    const r = await fetch(TPV_URL + ruta, { method: metodo || 'GET', headers: { 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || ('El TPV respondió ' + r.status));
    return d;
  };
  app.get('/api/portal/personal', async (req, res) => {
    const fichas = db.prepare('SELECT * FROM trabajadores').all();
    let usuarios = [], error = null;
    try { usuarios = await jsonTPV('/api/auth/usuarios/todos'); } catch (e) { error = 'No se pudo leer el TPV: ' + e.message; }
    const porTpv = {}; fichas.forEach(f => { if (f.tpv_usuario_id) porTpv[f.tpv_usuario_id] = f; });
    const lista = (usuarios || []).filter(u => u.rol !== 'propietario').map(u => {
      const f = porTpv[u.id] || {};
      return Object.assign({}, f, { id: f.id || null, tpv_usuario_id: u.id, nombre: f.nombre || u.nombre, apellidos: f.apellidos || u.apellidos || '', rol: u.rol, activo: !!u.activo, pin: u.pin, color: u.color });
    });
    fichas.filter(f => !f.tpv_usuario_id || !usuarios.some(u => u.id === f.tpv_usuario_id)).forEach(f => lista.push(Object.assign({}, f, { activo: !f.fecha_baja, sin_tpv: true })));
    lista.sort((a, b) => (b.activo - a.activo) || String(a.nombre).localeCompare(String(b.nombre)));
    res.json({ trabajadores: lista, error });
  });
  // Guardar ficha (alta o cambios). También crea o actualiza su usuario del TPV (PIN y puesto en el TPV).
  app.post('/api/portal/personal', async (req, res) => {
    const d = req.body || {};
    const o = {}; CAMPOS_TRAB.forEach(k => { o[k] = d[k] !== undefined ? txt(d[k]) : ''; });
    o.horas_semana = d.horas_semana ? num(d.horas_semana) : null;
    o.salario = d.salario ? num(d.salario) : null;
    if (!o.nombre) return res.status(400).json({ error: 'Falta el nombre' });
    const pin = d.pin !== undefined ? String(d.pin).trim() : '';
    if (pin && !/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'El PIN para fichar tiene que ser de 4 números' });
    const rol = ['camarero', 'cocinero', 'encargado', 'fichaje'].includes(d.rol) ? d.rol : 'fichaje';
    let tpvId = d.tpv_usuario_id ? int(d.tpv_usuario_id) : null;
    try {
      const activo = !o.fecha_baja;
      if (tpvId) await jsonTPV('/api/auth/usuarios/' + tpvId, 'PUT', Object.assign({ nombre: o.nombre, apellidos: o.apellidos, rol, activo }, pin ? { pin } : {}));
      else {
        if (!pin) return res.status(400).json({ error: 'Pon un PIN de 4 números para que pueda fichar en el TPV' });
        tpvId = (await jsonTPV('/api/auth/usuarios', 'POST', { nombre: o.nombre, apellidos: o.apellidos, pin, rol, color: '#b8965a' })).id;
      }
    } catch (e) { return res.status(400).json({ error: e.message }); }
    const existe = db.prepare('SELECT id FROM trabajadores WHERE tpv_usuario_id = ? OR id = ?').get(tpvId, int(d.id) || -1);
    const cols = Object.keys(o);
    if (existe) db.prepare(`UPDATE trabajadores SET ${cols.map(k => k + '=?').join(',')}, tpv_usuario_id=?, updated_at=datetime('now') WHERE id=?`).run(...cols.map(k => o[k]), tpvId, existe.id);
    else db.prepare(`INSERT INTO trabajadores (${cols.join(',')}, tpv_usuario_id) VALUES (${cols.map(() => '?').join(',')}, ?)`).run(...cols.map(k => o[k]), tpvId);
    res.json({ ok: true, tpv_usuario_id: tpvId });
  });
  // Fichajes de un trabajador en un mes, con horas por día.
  // Cada salida se empareja con la entrada anterior aunque sea del día antes (turnos que pasan
  // de medianoche); las horas cuentan para el día de la entrada.
  app.get('/api/portal/personal/:tpvId/fichajes', async (req, res) => {
    const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : new Date().toISOString().slice(0, 7);
    const [y, m] = mes.split('-').map(Number);
    const desde = mes + '-01', hasta = mes + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0');
    const dia = (iso, d) => { const t = new Date(iso + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
    try {
      const l = await jsonTPV(`/api/personal/fichajes-usuario?usuario_id=${int(req.params.tpvId)}&desde=${dia(desde, -1)}&hasta=${dia(hasta, 1)}`);
      const aMin = f => Date.UTC(+f.fecha.slice(0, 4), +f.fecha.slice(5, 7) - 1, +f.fecha.slice(8, 10), +f.hora.slice(0, 2), +f.hora.slice(3, 5)) / 60000;
      const minutosDia = {}, abiertoDia = {};
      let ent = null;
      l.forEach(f => {
        if (f.tipo === 'entrada') { if (ent) abiertoDia[ent.fecha] = true; ent = f; }
        else if (ent) { const mins = aMin(f) - aMin(ent); if (mins >= 0 && mins < 24 * 60) minutosDia[ent.fecha] = (minutosDia[ent.fecha] || 0) + mins; ent = null; }
      });
      if (ent) abiertoDia[ent.fecha] = true;
      const dias = {};
      l.filter(f => f.fecha >= desde && f.fecha <= hasta).forEach(f => { (dias[f.fecha] = dias[f.fecha] || []).push(f); });
      Object.keys(minutosDia).forEach(f => { if (f >= desde && f <= hasta && !dias[f]) dias[f] = []; });
      let totalMin = 0;
      const resumen = Object.keys(dias).sort().map(fecha => {
        const mins = minutosDia[fecha] || 0; totalMin += mins;
        return { fecha, fichajes: dias[fecha], minutos: mins, sin_salida: !!abiertoDia[fecha] };
      });
      res.json({ mes, dias: resumen, total_minutos: totalMin });
    } catch (e) { res.status(502).json({ error: 'No se pudo leer el TPV: ' + e.message }); }
  });
  app.post('/api/portal/personal/:tpvId/fichajes', async (req, res) => {
    const d = req.body || {};
    try { res.json(await jsonTPV('/api/personal/fichajes', 'POST', { usuario_id: int(req.params.tpvId), tipo: d.tipo, fecha: txt(d.fecha), hora: txt(d.hora) })); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.delete('/api/portal/personal/fichajes/:id', async (req, res) => {
    try { res.json(await jsonTPV('/api/personal/fichajes/' + int(req.params.id), 'DELETE')); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
};
