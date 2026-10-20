// ─── PORTAL DE GESTIÓN DON FADRIQUE ──────────────────────────────────────────
// Portada con Hotel / Restaurante y los módulos nuevos del restaurante:
//   · Carta y Menús (carta conectada al TPV, menús imprimibles y menús personalizados)
//   · Bodas y Comuniones (calendario, fichas, fianza, documento)
//   · Contabilidad (ventas TPV + cobros de bodas y comuniones + presupuestos)
// Todo lo que va bajo /api/portal/ exige la misma sesión con PIN que el resto de la app.
'use strict';
const path = require('path');
const crypto = require('crypto');

const TPV_URL = (process.env.TPV_URL || 'https://gestion.palaciocondealdana.com').replace(/\/$/, '');
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
    'tel', 'tel2', 'email', 'direccion', 'menu_nombre', 'fianza_fecha', 'fianza_forma', 'notas'];
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
  app.get('/api/portal/celebraciones', (req, res) => {
    let sql = 'SELECT * FROM celebraciones WHERE 1=1';
    const p = [];
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
    const tipo = d.tipo === 'comunion' ? 'comunion' : 'boda';
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
      const quien = c.tipo === 'boda' ? [c.nombre1, c.nombre2].filter(Boolean).join(' y ') : (c.protagonista || c.nombre1 || '');
      if (c.fianza_pagada && c.fianza_importe && enMes(c.fianza_fecha))
        cobros.push({ fecha: c.fianza_fecha, tipo: c.tipo, quien, concepto: 'Fianza', importe: c.fianza_importe, forma: c.fianza_forma || '', id: c.id });
      c.pagos.forEach(p => { if (enMes(p.fecha) && num(p.importe)) cobros.push({ fecha: p.fecha, tipo: c.tipo, quien, concepto: p.concepto || 'Pago', importe: num(p.importe), forma: p.forma || '', id: c.id }); });
    });
    cobros.sort((a, b) => a.fecha.localeCompare(b.fecha));
    const delMes = celebs.filter(c => enMes(c.fecha) && c.estado !== 'cancelada').map(c => ({
      id: c.id, tipo: c.tipo, fecha: c.fecha, estado: c.estado,
      quien: c.tipo === 'boda' ? [c.nombre1, c.nombre2].filter(Boolean).join(' y ') : (c.protagonista || c.nombre1 || ''),
      comensales: (c.adultos || 0) + (c.ninos || 0), previsto: c.importe_previsto, cobrado: c.cobrado, pendiente: c.pendiente }));
    const suma = (arr, k) => Math.round(arr.reduce((s, x) => s + (x[k] || 0), 0) * 100) / 100;
    out.celebraciones = {
      cobros, total_cobros: suma(cobros, 'importe'),
      cobros_bodas: suma(cobros.filter(c => c.tipo === 'boda'), 'importe'),
      cobros_comuniones: suma(cobros.filter(c => c.tipo === 'comunion'), 'importe'),
      del_mes: delMes, previsto_mes: suma(delMes, 'previsto')
    };

    // 3) Presupuestos de eventos con fecha en el mes (app de reservas)
    try {
      const pres = db.prepare('SELECT numero, cliente, fecha_evento, tipo_evento, total, enviado FROM presupuestos WHERE fecha_evento >= ? AND fecha_evento <= ? ORDER BY fecha_evento').all(desde, hasta);
      out.presupuestos = { lista: pres, total: suma(pres, 'total') };
    } catch (e) { out.presupuestos = { lista: [], total: 0 }; }

    out.total_ingresos = Math.round(((out.tpv ? out.tpv.total : 0) + out.celebraciones.total_cobros) * 100) / 100;
    res.json(out);
  });
};
