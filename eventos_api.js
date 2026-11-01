// ─── CARPETA DE CADA EVENTO (bodas, comuniones y eventos) ────────────────────
// Todo lo de un evento en un mismo sitio:
//   · Historial: reuniones, llamadas y notas con su fecha (y lo que pasa solo: firmas, envíos…)
//   · Hoja interna: espacios y horarios, ceremonia, cóctel, banquete, barra libre, DJ… (para el equipo)
//   · Presupuesto y reserva con fianza: se firman con el dedo en el móvil (aquí o por enlace)
//     y queda un PDF firmado que se envía por email a los clientes.
//   · Factura: se rellena sola con el presupuesto firmado; al emitirla recibe número y no se toca.
//   · Archivos: fotos, PDF y lo que haga falta.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const PDFDocument = require('./pdf-fuentes');
const DISENO = require('./presupuesto_diseno');

const TEXTOS_DEFECTO = {
  presupuesto: 'Precios por persona salvo indicación. IVA (10%) no incluido en los precios unitarios; se suma al final.\n' +
    'El número definitivo de invitados se confirmará como máximo 10 días antes del evento; se facturará ese número como mínimo.\n' +
    'La fecha queda reservada con la firma del documento de reserva y el pago de la fianza.\n' +
    'Forma de pago: fianza a la reserva, 50% un mes antes y el resto en los 7 días siguientes al evento.\n' +
    'Validez del presupuesto: 30 días.',
  fianza: 'Con la firma de este documento y el pago de la fianza, Don Fadrique reserva en exclusiva la fecha indicada para la celebración.\n' +
    'La fianza se descontará del importe final del evento.\n' +
    'En caso de anulación por parte del cliente, la fianza no será devuelta, salvo causa de fuerza mayor debidamente justificada.\n' +
    'Si Don Fadrique no pudiera prestar el servicio por causas propias, devolverá íntegramente la fianza.\n' +
    'Los datos personales se tratarán para gestionar la celebración y el cumplimiento de obligaciones legales (NIMANSANMON S.L.).',
  factura: 'Gracias por celebrarlo con nosotros.'
};
const TITULO = { presupuesto: 'Presupuesto', fianza: 'Reserva de fecha y fianza', factura: 'Factura' };
const PREFIJO = { presupuesto: 'EP', fianza: 'RF', factura: 'EF' };
const TIPO_TXT = { boda: 'Boda', comunion: 'Primera Comunión', evento: 'Evento' };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const eur = n => { const v = r2(n).toFixed(2).split('.'); return v[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + v[1] + ' €'; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fechaLarga = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';

module.exports = function montarEventos(app, db, h) {
  const { puedeTipo } = h;
  const BASE_DIR = path.join(path.dirname(process.env.DB_PATH || '/data/reservas.db'), 'eventos');
  try { fs.mkdirSync(BASE_DIR, { recursive: true }); } catch (e) {}
  const carpeta = id => { const d = path.join(BASE_DIR, String(parseInt(id, 10))); try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} return d; };

  // ── Tablas ──
  try { db.exec("ALTER TABLE celebraciones ADD COLUMN ficha TEXT DEFAULT '{}'"); } catch (e) {}
  db.exec(`CREATE TABLE IF NOT EXISTS evento_notas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, celebracion_id INTEGER NOT NULL,
    fecha TEXT NOT NULL, tipo TEXT DEFAULT 'reunion', texto TEXT, autor TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS evento_archivos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, celebracion_id INTEGER NOT NULL,
    nombre TEXT, archivo TEXT NOT NULL, mime TEXT, tamano INTEGER, categoria TEXT DEFAULT 'otro',
    subido_por TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS evento_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, celebracion_id INTEGER NOT NULL,
    tipo TEXT NOT NULL, numero TEXT, version INTEGER DEFAULT 1, estado TEXT DEFAULT 'borrador',
    datos TEXT DEFAULT '{}', base REAL DEFAULT 0, iva REAL DEFAULT 0, total REAL DEFAULT 0,
    token TEXT UNIQUE, enviado_at TEXT, fecha_emision TEXT,
    firma TEXT, firmado_nombre TEXT, firmado_dni TEXT, firmado_at TEXT, firmado_ip TEXT, firmado_ua TEXT, huella TEXT,
    pdf TEXT, sustituido INTEGER DEFAULT 0, creado_por TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
  try { db.exec("ALTER TABLE evento_docs ADD COLUMN envios TEXT DEFAULT '[]'"); } catch (e) {}
  try { db.exec('ALTER TABLE evento_docs ADD COLUMN qr TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE celebraciones ADD COLUMN hab_novios TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE celebraciones ADD COLUMN hab_reserva_id INTEGER'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS ix_evnotas ON evento_notas(celebracion_id)'); db.exec('CREATE INDEX IF NOT EXISTS ix_evdocs ON evento_docs(celebracion_id)'); db.exec('CREATE INDEX IF NOT EXISTS ix_evarch ON evento_archivos(celebracion_id)'); } catch (e) {}

  const json = (s, d) => { try { return JSON.parse(s || '') || d; } catch (e) { return d; } };
  const cfg = () => { const o = {}; db.prepare('SELECT clave, valor FROM config').all().forEach(r => { o[r.clave] = r.valor; }); return o; };
  const textos = () => { const c = cfg(); const t = json(c.eventos_textos, {}); return Object.assign({}, TEXTOS_DEFECTO, t); };
  const celeb = id => { const c = db.prepare('SELECT * FROM celebraciones WHERE id = ?').get(id); if (c) { c.pagos = json(c.pagos, []); c.ficha = json(c.ficha, {}); } return c; };
  const nombreCeleb = c => {
    const a = [c.nombre1, c.apellidos1].filter(Boolean).join(' '), b = [c.nombre2, c.apellidos2].filter(Boolean).join(' ');
    if (c.tipo === 'boda') return [a, b].filter(Boolean).join(' y ') || 'Sin nombres';
    if (c.tipo === 'evento') return c.nombre_evento || c.empresa || a || 'Evento';
    return c.protagonista || a || 'Sin nombre';
  };
  const nota = (cid, tipo, texto, autor) => db.prepare("INSERT INTO evento_notas (celebracion_id, fecha, tipo, texto, autor) VALUES (?, date('now','localtime'), ?, ?, ?)").run(cid, tipo, texto, autor || '');
  // Permiso: el del tipo del evento (bodas / comuniones / eventos)
  const conPermiso = (req, res, cid) => {
    const c = celeb(cid);
    if (!c) { res.status(404).json({ error: 'No encontrado' }); return null; }
    if (!puedeTipo(req, c.tipo)) { res.status(403).json({ error: 'No tienes permiso para esta sección' }); return null; }
    return c;
  };
  const docDe = id => { const d = db.prepare('SELECT * FROM evento_docs WHERE id = ?').get(id); if (d) { d.datos = json(d.datos, {}); d.envios = json(d.envios, []); } return d; };
  const sinFirma = d => { const o = Object.assign({}, d); o.tiene_firma = !!o.firma; delete o.firma; return o; };

  // ── Importes ──
  function totales(datos) {
    let base = 0; const porIva = {};
    (datos.lineas || []).forEach(l => {
      const imp = r2(Number(l.cantidad || 0) * Number(l.precio || 0)); const t = [4, 10, 21].includes(Number(l.iva)) ? Number(l.iva) : 10;
      base += imp; porIva[t] = (porIva[t] || 0) + imp;
    });
    const iva = Object.keys(porIva).reduce((s, t) => s + porIva[t] * t / 100, 0);
    return { base: r2(base), iva: r2(iva), total: r2(base + iva), porIva };
  }
  function clienteDe(c) {
    const p1 = [c.nombre1, c.apellidos1].filter(Boolean).join(' '), p2 = [c.nombre2, c.apellidos2].filter(Boolean).join(' ');
    return { nombre: c.tipo === 'evento' && c.empresa ? c.empresa : [p1, p2].filter(Boolean).join(' y '), persona1: p1, dni1: c.dni1 || '', persona2: p2, dni2: c.dni2 || '',
      empresa: c.empresa || '', cif: c.cif || '', direccion: c.direccion || '', email: c.email || '', tel: c.tel || '' };
  }
  function eventoDe(c) {
    return { tipo: c.tipo, nombre: nombreCeleb(c), fecha: c.fecha, hora: c.hora || '', lugar: c.lugar || '', adultos: c.adultos || 0, ninos: c.ninos || 0, menu: c.menu_nombre || '', protagonista: c.protagonista || '' };
  }
  // Líneas propuestas para un presupuesto nuevo: menú + lo marcado en la hoja interna
  // Menú de la celebración en texto (el propio de la boda, o el del menú elegido)
  function menuDe(c) {
    const f = c.ficha || {};
    let m = null;
    if (f.menu_pers_id) m = db.prepare('SELECT titulo AS nombre, secciones FROM menus_personalizados WHERE id = ?').get(f.menu_pers_id);
    if (!m && c.plantilla_id) m = db.prepare('SELECT nombre, secciones FROM plantillas_menu WHERE id = ?').get(c.plantilla_id);
    if (!m) return null;
    const lineas = [];
    json(m.secciones, []).forEach(x => {
      const lim = a => (a || []).map(t => String(t || '').trim()).filter(Boolean);
      if (x.tipo === 'lista') { const it = lim(x.items); if (it.length) lineas.push({ t: x.titulo, v: it.join(' · ') }); }
      else if (x.tipo === 'eleccion') { const o = lim(x.opciones); if (o.length) lineas.push({ t: x.titulo, v: o.join(x.elegir ? ' o ' : ' · ') + (x.elegir && o.length > 1 ? ' (a elegir)' : '') }); }
      else if (x.tipo === 'sino') { if (x.valor) lineas.push({ t: x.titulo, v: '' }); }
      else if (x.tipo === 'barra_libre' || x.tipo === 'recena') { if (x.valor) lineas.push({ t: x.titulo, v: [x.horas, x.texto].filter(Boolean).join(' · ') }); }
      else if (String(x.texto || '').trim()) lineas.push({ t: x.titulo, v: String(x.texto).trim() });
    });
    return lineas.length ? { nombre: c.menu_nombre || String(m.nombre || '').split(' · ')[0], lineas } : null;
  }
  // Montaje (anexo al presupuesto): dónde y cómo va cada parte de la celebración
  const MONTAJE = [['general', 'Espacios y horario', [['espacios', 'Espacios'], ['horario', 'Horario']]],
    ['ceremonia', 'Ceremonia', [['tipo', 'Tipo'], ['lugar', 'Dónde'], ['hora', 'Hora'], ['oficiante', 'Oficia'], ['montaje', 'Montaje']]],
    ['coctel', 'Cóctel de bienvenida', [['lugar', 'Dónde'], ['hora', 'Hora'], ['duracion', 'Duración'], ['montaje', 'Montaje']]],
    ['banquete', 'Menú sentados', [['lugar', 'Dónde'], ['hora', 'Hora'], ['mesas', 'Mesas'], ['presidencial', 'Mesa presidencial'], ['montaje', 'Montaje']]],
    ['barra', 'Barra libre', [['lugar', 'Dónde'], ['hora', 'Desde las'], ['horas', 'Horas'], ['bebidas', 'Bebidas']]],
    ['musica', 'Música y DJ', [['dj', 'DJ'], ['proveedor', 'Empresa'], ['montaje', 'Necesita']]],
    ['otros', 'Otros detalles', [['fotografo', 'Fotógrafo / vídeo'], ['flores', 'Flores y decoración'], ['tarta', 'Tarta'], ['ninos', 'Niños'], ['proveedores', 'Otros proveedores']]]];
  const DJ = { nosotros: 'Lo pone Don Fadrique', ellos: 'Lo contratan los clientes aparte', no: 'Sin DJ' };
  function montajeDe(c) {
    const f = c.ficha || {}, out = [];
    MONTAJE.forEach(([k, tit, campos]) => {
      const d = f[k] || {};
      if (d.si === false) { out.push({ t: tit, filas: [['', 'No']] }); return; }
      const filas = campos.map(([ck, ct]) => { let v = d[ck]; if (v == null || v === '') return null; if (ck === 'dj') v = DJ[v] || v; if (ck === 'hora') v = v + ' h'; if (ck === 'horas') v = v + ' h'; return [ct, String(v)]; }).filter(Boolean);
      if (filas.length || d.si) out.push({ t: tit, filas: filas.length ? filas : [['', 'Sí']] });
    });
    return out.length ? out : null;
  }
  // ── Presupuesto con diseño (como el dossier de bodas): plantilla editable y «paquete» de cada celebración ──
  const plantillaBoda = () => Object.assign({}, DISENO.PLANTILLA, json(cfg().eventos_plantilla_boda, {}));
  const NOMBRE_COMPLETO = { Manuel: 'Manuel Sánchez', 'Nicolás': 'Nicolás Sánchez' };
  function paqueteDe(c, previo) {
    const P = plantillaBoda(), f = c.ficha || {}, boda = c.tipo === 'boda', pv = previo || {};
    return {
      coctel: pv.coctel || { si: boda, precio: Number(P.coctel_precio) || 0 },
      barra: pv.barra || { si: boda || !!(f.barra && f.barra.si), horas: Number((f.barra || {}).horas) || Number(P.barra_horas) || 4, precio: Number(P.barra_precio) || 0 },
      menu_nombre: c.menu_nombre || pv.menu_nombre || 'Menú', menu_precio: Number(c.precio_adulto) || Number(pv.menu_precio) || 0, nino_precio: Number(c.precio_nino) || Number(pv.nino_precio) || 0,
      extras: Array.isArray(pv.extras) ? pv.extras : []
    };
  }
  const ivaServicio = t => /dj|audiovisual|wedding planner|fot[oó]graf|animaci/i.test(t) ? 21 : 10;
  function lineasPaquete(c, pq, extraManual) {
    const P = plantillaBoda(), ad = Number(c.adultos) || 0, ni = Number(c.ninos) || 0, f = c.ficha || {}, l = [];
    if (pq.coctel && pq.coctel.si) l.push({ concepto: P.coctel_titulo, cantidad: ad, precio: Number(pq.coctel.precio) || 0, iva: 10 });
    l.push({ concepto: pq.menu_nombre || 'Menú', cantidad: ad, precio: Number(pq.menu_precio) || 0, iva: 10 });
    if (ni) l.push({ concepto: 'Menú infantil', cantidad: ni, precio: Number(pq.nino_precio) || 0, iva: 10 });
    if (pq.barra && pq.barra.si) l.push({ concepto: 'Barra libre · ' + (pq.barra.horas || '') + ' horas', cantidad: ad, precio: Number(pq.barra.precio) || 0, iva: 10 });
    if (f.ceremonia && f.ceremonia.si) l.push({ concepto: 'Montaje de ceremonia' + (f.ceremonia.lugar ? ' en ' + f.ceremonia.lugar : ''), cantidad: 1, precio: 0, iva: 10 });
    (pq.extras || []).filter(x => Number(x.cantidad)).forEach(x => l.push({ concepto: x.concepto, cantidad: Number(x.cantidad) || 1, precio: Number(x.precio) || 0, iva: ivaServicio(x.concepto) }));
    return l.concat(extraManual || []);
  }
  // Nº como el del dossier: DF-B-AAMMDD (boda), DF-C-… (comunión), DF-E-… (evento), con la fecha de la celebración
  function numeroDiseno(c) {
    const base = 'DF-' + ({ boda: 'B', comunion: 'C', evento: 'E' }[c.tipo] || 'E') + '-' + String(c.fecha || new Date().toISOString().slice(0, 10)).slice(2).replace(/-/g, '');
    let n = base, i = 2;
    while (db.prepare('SELECT 1 FROM evento_docs WHERE numero = ? AND celebracion_id != ?').get(n, c.id)) n = base + '-' + i++;
    return n;
  }
  const limpiaLineas = a => (Array.isArray(a) ? a : []).filter(l => String(l.concepto || '').trim()).map(l => ({ concepto: String(l.concepto).slice(0, 300), cantidad: Number(String(l.cantidad).replace(',', '.')) || 0, precio: Number(String(l.precio).replace(',', '.')) || 0, iva: [4, 10, 21].includes(Number(l.iva)) ? Number(l.iva) : 10 }));
  function lineasPropuestas(c) {
    const f = c.ficha || {}, l = [];
    if (c.adultos) l.push({ concepto: (/^men[uú]/i.test(c.menu_nombre || '') ? c.menu_nombre : 'Menú ' + (c.menu_nombre || '')).trim() + ' · adultos', cantidad: c.adultos, precio: c.precio_adulto || 0, iva: 10 });
    if (c.ninos) l.push({ concepto: 'Menú infantil', cantidad: c.ninos, precio: c.precio_nino || 0, iva: 10 });
    if (f.ceremonia && f.ceremonia.si) l.push({ concepto: 'Montaje de ceremonia' + (f.ceremonia.lugar ? ' en ' + f.ceremonia.lugar : ''), cantidad: 1, precio: 0, iva: 10 });
    if (f.coctel && f.coctel.si) l.push({ concepto: 'Cóctel de bienvenida' + (f.coctel.lugar ? ' en ' + f.coctel.lugar : ''), cantidad: 1, precio: 0, iva: 10 });
    if (f.barra && f.barra.si) l.push({ concepto: 'Barra libre' + (f.barra.horas ? ' (' + f.barra.horas + ' h)' : ''), cantidad: c.adultos || 1, precio: 0, iva: 10 });
    if (f.musica && f.musica.dj === 'nosotros') l.push({ concepto: 'Servicio de DJ', cantidad: 1, precio: 0, iva: 10 });
    return l;
  }
  function siguienteNumero(tipo) {
    const anio = new Date().getFullYear(), pre = PREFIJO[tipo] + '-' + anio + '-';
    const u = db.prepare("SELECT numero FROM evento_docs WHERE numero LIKE ? ORDER BY id DESC LIMIT 1").get(pre + '%');
    const n = u ? parseInt(u.numero.slice(pre.length), 10) + 1 : 1;
    return pre + String(n).padStart(tipo === 'factura' ? 4 : 3, '0');
  }
  function guardarDatos(id, datos) {
    const t = totales(datos);
    db.prepare("UPDATE evento_docs SET datos = ?, base = ?, iva = ?, total = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(datos), t.base, t.iva, t.total, id);
  }
  // Factura en borrador a partir del presupuesto firmado (se actualiza sola mientras no se emita)
  function facturaDesdePresupuesto(c, pres, autor) {
    const emitida = db.prepare("SELECT id FROM evento_docs WHERE celebracion_id = ? AND tipo = 'factura' AND estado = 'emitida'").get(c.id);
    if (emitida) return null;
    let f = db.prepare("SELECT * FROM evento_docs WHERE celebracion_id = ? AND tipo = 'factura' AND estado = 'borrador' ORDER BY id DESC LIMIT 1").get(c.id);
    const datos = { cliente: Object.assign({}, pres.datos.cliente || clienteDe(c)), evento: eventoDe(c), lineas: (pres.datos.lineas || []).map(x => Object.assign({}, x)),
      condiciones: textos().factura, presupuesto: pres.numero };
    if (!f) { const r = db.prepare("INSERT INTO evento_docs (celebracion_id, tipo, estado, datos, creado_por) VALUES (?, 'factura', 'borrador', '{}', ?)").run(c.id, autor || 'automático'); f = { id: r.lastInsertRowid }; }
    guardarDatos(f.id, datos);
    return f.id;
  }
  function crearDoc(c, tipo, autor) {
    const t = textos();
    let datos;
    if (tipo === 'presupuesto') { const pq = paqueteDe(c); datos = { diseno: true, paquete: pq, lineas_extra: [], cliente: clienteDe(c), evento: eventoDe(c), lineas: lineasPaquete(c, pq, []), menu: menuDe(c), montaje: montajeDe(c), condiciones: '' }; }
    else if (tipo === 'fianza') datos = { cliente: clienteDe(c), evento: eventoDe(c), importe_fianza: c.fianza_importe || 0, forma_pago: c.fianza_forma || 'Transferencia', condiciones: t.fianza,
      presupuesto: (db.prepare("SELECT numero, total FROM evento_docs WHERE celebracion_id = ? AND tipo = 'presupuesto' AND estado = 'firmado' AND sustituido = 0 ORDER BY id DESC LIMIT 1").get(c.id) || null) };
    else {
      const pres = db.prepare("SELECT * FROM evento_docs WHERE celebracion_id = ? AND tipo = 'presupuesto' AND estado = 'firmado' AND sustituido = 0 ORDER BY id DESC LIMIT 1").get(c.id);
      datos = { cliente: clienteDe(c), evento: eventoDe(c), lineas: pres ? json(pres.datos, {}).lineas || [] : lineasPropuestas(c), condiciones: t.factura, presupuesto: pres ? pres.numero : '' };
    }
    const numero = tipo === 'factura' ? null : tipo === 'presupuesto' ? numeroDiseno(c) : siguienteNumero(tipo);
    const r = db.prepare("INSERT INTO evento_docs (celebracion_id, tipo, numero, estado, datos, creado_por) VALUES (?, ?, ?, 'borrador', '{}', ?)").run(c.id, tipo, numero, autor || '');
    guardarDatos(r.lastInsertRowid, datos);
    return r.lastInsertRowid;
  }

  // ── PDF ──
  const PREMIOS = ['michelin.png', 'repsol.png', 'tierra.png'].map(f => path.join(__dirname, 'marca', 'premios', f)).filter(f => fs.existsSync(f));
  let pdfDoc = function (d, c) {
    return new Promise(async (resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 46, bottom: 60, left: 52, right: 52 }, info: { Title: (TITULO[d.tipo] + ' ' + (d.numero || '')).trim(), Author: 'NIMANSANMON S.L. · Don Fadrique' } });
      const bufs = []; doc.on('data', b => bufs.push(b)); doc.on('end', () => resolve(Buffer.concat(bufs))); doc.on('error', reject);
      const W = doc.page.width, L = 52, R = W - 52, ORO = '#b8965a', GRIS = '#8a8278', TINTA = '#1a1a1a';
      const datos = d.datos || {}, cli = datos.cliente || {}, ev = datos.evento || {};
      const firmado = d.estado === 'firmado' || d.estado === 'emitida';
      // Cabecera
      doc.font('Helvetica').fontSize(20).fillColor(TINTA).text('D O N   F A D R I Q U E', L, 42, { width: R - L, align: 'center', characterSpacing: 1 });
      doc.font('Helvetica-Bold').fontSize(7).fillColor(ORO).text('NIMANSANMON S.L. · CIF B37297223 · ALBA DE TORMES (SALAMANCA) · 920 37 00 51', L, 70, { width: R - L, align: 'center', characterSpacing: .6 });
      doc.moveTo(L + 120, 86).lineTo(R - 120, 86).lineWidth(.6).strokeColor(ORO).stroke();
      // Título
      let y = 104;
      doc.font('Helvetica').fontSize(15).fillColor(TINTA).text(TITULO[d.tipo].toUpperCase(), L, y, { characterSpacing: 2 });
      doc.font('Helvetica').fontSize(10).fillColor(GRIS).text([d.numero || (d.tipo === 'factura' ? 'Borrador (sin número)' : ''), d.tipo === 'factura' && d.fecha_emision ? 'Fecha: ' + new Date(d.fecha_emision + 'T12:00:00').toLocaleDateString('es-ES') : 'Fecha: ' + new Date(d.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('es-ES')].filter(Boolean).join('   ·   '), L, y + 4, { width: R - L, align: 'right' });
      y += 30;
      // Cliente y evento
      const caja = (x, w, tit, lineas) => {
        doc.font('Helvetica-Bold').fontSize(7).fillColor(ORO).text(tit, x, y, { characterSpacing: 1.2 });
        let yy = y + 12;
        lineas.filter(Boolean).forEach((t, i) => { doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(i === 0 ? 10.5 : 9).fillColor(i === 0 ? TINTA : '#4a4540').text(t, x, yy, { width: w }); yy = doc.y + 1; });
        return yy;
      };
      const yc = caja(L, 230, 'CLIENTE', [cli.nombre, cli.persona1 ? cli.persona1 + (cli.dni1 ? ' · DNI ' + cli.dni1 : '') : '', cli.persona2 ? cli.persona2 + (cli.dni2 ? ' · DNI ' + cli.dni2 : '') : '',
        cli.cif ? 'CIF ' + cli.cif : '', cli.direccion, [cli.tel, cli.email].filter(Boolean).join(' · ')]);
      const ye = caja(L + 260, R - L - 260, 'CELEBRACIÓN', [(TIPO_TXT[ev.tipo] || 'Evento') + (ev.tipo === 'comunion' && ev.protagonista ? ' de ' + ev.protagonista : ''), fechaLarga(ev.fecha) + (ev.hora ? ' · ' + ev.hora + ' h' : ''), ev.lugar,
        (ev.adultos || ev.ninos) ? (ev.adultos || 0) + ' adultos' + (ev.ninos ? ' y ' + ev.ninos + ' niños' : '') : '', ev.menu ? 'Menú: ' + ev.menu : '']);
      y = Math.max(yc, ye) + 14;
      doc.moveTo(L, y).lineTo(R, y).lineWidth(.4).strokeColor('#e6dfd3').stroke(); y += 12;
      const nuevaPagina = alto => { if (y + alto > doc.page.height - 80) { doc.addPage(); y = 50; } };
      // Líneas (presupuesto y factura)
      if (d.tipo !== 'fianza') {
        const t = totales(datos);
        const col = [L, L + 285, L + 340, L + 410];
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GRIS);
        doc.text('CONCEPTO', col[0], y); doc.text('CANT.', col[1], y, { width: 45, align: 'right' }); doc.text('PRECIO', col[2], y, { width: 60, align: 'right' }); doc.text('IMPORTE', col[3], y, { width: R - col[3], align: 'right' });
        y += 13;
        (datos.lineas || []).forEach(l => {
          const imp = r2(Number(l.cantidad || 0) * Number(l.precio || 0));
          const hgt = doc.font('Helvetica').fontSize(9.5).heightOfString(l.concepto || '', { width: 280 });
          nuevaPagina(hgt + 8);
          doc.fillColor(TINTA).text(l.concepto || '', col[0], y, { width: 280 });
          doc.text(String(l.cantidad ?? ''), col[1], y, { width: 45, align: 'right' });
          doc.text(Number(l.precio) ? eur(l.precio) : '', col[2], y, { width: 60, align: 'right' });
          doc.text(Number(l.precio) ? eur(imp) : 'Incluido', col[3], y, { width: R - col[3], align: 'right' });
          y += hgt + 6; doc.moveTo(L, y - 3).lineTo(R, y - 3).lineWidth(.3).strokeColor('#f0ebe2').stroke();
        });
        y += 6; nuevaPagina(90);
        const fila = (k, v, fuerte) => {
          doc.font(fuerte ? 'Helvetica-Bold' : 'Helvetica').fontSize(fuerte ? 12 : 9.5).fillColor(TINTA);
          const hk = doc.heightOfString(k, { width: 215 });
          doc.text(k, L + 190, y, { width: 215 }); doc.text(v, L + 410, y, { width: R - L - 410, align: 'right' });
          y += Math.max(hk, fuerte ? 14 : 11) + (fuerte ? 5 : 3);
        };
        fila('Base imponible', eur(t.base));
        Object.keys(t.porIva).sort().forEach(k => fila('IVA ' + k + '%', eur(t.porIva[k] * k / 100)));
        doc.moveTo(L + 190, y - 2).lineTo(R, y - 2).lineWidth(.6).strokeColor(ORO).stroke(); y += 3;
        fila('TOTAL', eur(t.total), true);
        if (d.tipo === 'factura' && datos.a_cuenta && datos.a_cuenta.length) {
          const ac = datos.a_cuenta.reduce((s, p) => s + Number(p.importe || 0), 0);
          datos.a_cuenta.forEach(p => fila('A cuenta: ' + (p.concepto || 'pago') + (p.fecha ? ' (' + p.fecha.split('-').reverse().join('/') + ')' : ''), '− ' + eur(p.importe)));
          fila('PENDIENTE DE PAGO', eur(t.total - ac), true);
        }
        y += 8;
      } else {
        // Reserva de fecha y fianza
        nuevaPagina(120);
        const quien = [cli.persona1 && (cli.persona1 + (cli.dni1 ? ', con DNI ' + cli.dni1 : '')), cli.persona2 && (cli.persona2 + (cli.dni2 ? ', con DNI ' + cli.dni2 : ''))].filter(Boolean).join(', y ');
        const texto = 'En Alba de Tormes, a ' + new Date(d.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) + '.\n\n' +
          'De una parte, NIMANSANMON S.L. (CIF B37297223), titular de Don Fadrique. De otra parte, ' + (quien || cli.nombre || '________________') + (cli.empresa ? ', en representación de ' + cli.empresa + (cli.cif ? ' (CIF ' + cli.cif + ')' : '') : '') + '.\n\n' +
          'Ambas partes acuerdan la reserva de la fecha del ' + fechaLarga(ev.fecha) + (ev.hora ? ', a las ' + ev.hora + ' h' : '') + ', en ' + (ev.lugar || 'Don Fadrique') + ', para la celebración de ' +
          (ev.tipo === 'boda' ? 'su boda' : ev.tipo === 'comunion' ? 'la Primera Comunión' + (ev.protagonista ? ' de ' + ev.protagonista : '') : 'el evento «' + (ev.nombre || '') + '»') +
          ((ev.adultos || ev.ninos) ? ', con una previsión de ' + (ev.adultos || 0) + ' adultos' + (ev.ninos ? ' y ' + ev.ninos + ' niños' : '') : '') + '.\n\n' +
          'Para ello se entrega una fianza de ' + eur(datos.importe_fianza) + ' mediante ' + (datos.forma_pago || '________') + '.' +
          (datos.presupuesto && datos.presupuesto.numero ? ' El servicio se prestará según el presupuesto ' + datos.presupuesto.numero + '.' : '');
        doc.font('Helvetica').fontSize(10.5).fillColor(TINTA).text(texto, L, y, { width: R - L, align: 'justify', lineGap: 2 });
        y = doc.y + 14;
      }
      // Menú (presupuesto)
      if (d.tipo === 'presupuesto' && datos.menu && datos.menu.lineas && datos.menu.lineas.length) {
        nuevaPagina(70);
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(ORO).text('MENÚ' + (datos.menu.nombre ? ' · ' + String(datos.menu.nombre).toUpperCase() : ''), L, y, { characterSpacing: 1.2 }); y += 13;
        datos.menu.lineas.forEach(m => {
          const txt = m.v ? m.v : '';
          const h = doc.font('Helvetica').fontSize(9).heightOfString(txt || ' ', { width: R - L - 120 });
          nuevaPagina(h + 6);
          doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#4a4540').text(m.t || '', L, y, { width: 112 });
          if (txt) doc.font('Helvetica').fontSize(9).fillColor(TINTA).text(txt, L + 120, y, { width: R - L - 120 });
          y += Math.max(h, 11) + 4;
        });
        y += 8;
      }
      // Verifactu (factura emitida): código QR de la AEAT y huella encadenada
      if (d.tipo === 'factura' && d.estado === 'emitida' && d.qr) {
        nuevaPagina(110);
        try {
          const png = await require('qrcode').toBuffer(d.qr, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
          doc.image(png, L, y, { width: 78 });
        } catch (e) {}
        doc.font('Helvetica-Bold').fontSize(8).fillColor(TINTA).text('Factura verificable en la sede electrónica de la AEAT', L + 92, y + 6, { width: R - L - 92 });
        doc.font('Helvetica').fontSize(7.2).fillColor(GRIS).text('Escanee el código QR para comprobarla. Registro de facturación conforme al Real Decreto 1007/2023 (sistema VERI*FACTU).\nHuella: ' + (d.huella || ''), L + 92, y + 20, { width: R - L - 92, lineGap: 1 });
        y += 92;
      }
      // Condiciones
      if (datos.condiciones) {
        nuevaPagina(60);
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(ORO).text(d.tipo === 'factura' ? 'OBSERVACIONES' : 'CONDICIONES', L, y, { characterSpacing: 1.2 }); y += 12;
        doc.font('Helvetica').fontSize(8.8).fillColor('#3a3632').text(datos.condiciones, L, y, { width: R - L, lineGap: 1.5 }); y = doc.y + 14;
      }
      if (datos.notas) { nuevaPagina(40); doc.font('Helvetica').fontSize(9).fillColor('#3a3632').text(datos.notas, L, y, { width: R - L }); y = doc.y + 12; }
      // Firmas (presupuesto y fianza)
      if (d.tipo !== 'factura') {
        nuevaPagina(150);
        const fw = (R - L - 30) / 2;
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GRIS).text('CONFORME, EL CLIENTE', L, y, { width: fw, align: 'center' });
        doc.text('POR DON FADRIQUE', L + fw + 30, y, { width: fw, align: 'center' });
        const yf = y + 14;
        doc.roundedRect(L, yf, fw, 82, 6).lineWidth(.5).strokeColor('#e6dfd3').stroke();
        doc.roundedRect(L + fw + 30, yf, fw, 82, 6).stroke();
        if (d.firma) { try { doc.image(Buffer.from(d.firma.split(',')[1], 'base64'), L + 8, yf + 6, { fit: [fw - 16, 70], align: 'center', valign: 'center' }); } catch (e) {} }
        else doc.font('Helvetica').fontSize(8).fillColor('#c8c0b4').text('Pendiente de firma', L, yf + 36, { width: fw, align: 'center' });
        doc.font('Helvetica').fontSize(9).fillColor(TINTA).text('NIMANSANMON S.L.', L + fw + 30, yf + 32, { width: fw, align: 'center' });
        doc.fontSize(7.5).fillColor(GRIS).text('Don Fadrique · Alba de Tormes', L + fw + 30, yf + 46, { width: fw, align: 'center' });
        y = yf + 88;
        if (d.firma) {
          doc.font('Helvetica').fontSize(8).fillColor('#4a4540').text((d.firmado_nombre || '') + (d.firmado_dni ? ' · DNI ' + d.firmado_dni : ''), L, y, { width: fw, align: 'center' });
          y = doc.y + 2;
        }
      }
      // Huella de la firma electrónica
      if (d.firma && d.firmado_at) {
        y += 6; nuevaPagina(30);
        doc.font('Helvetica').fontSize(6.8).fillColor(GRIS).text('Firmado electrónicamente con firma manuscrita en pantalla el ' + new Date(d.firmado_at.replace(' ', 'T') + 'Z').toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }) +
          (d.firmado_ip ? ' desde ' + d.firmado_ip : '') + '. Huella del documento (SHA-256): ' + (d.huella || ''), L, y, { width: R - L });
      }
      // Anexo: montaje (presupuesto)
      if (d.tipo === 'presupuesto' && Array.isArray(datos.montaje) && datos.montaje.length) {
        doc.addPage(); y = 50;
        doc.font('Helvetica').fontSize(14).fillColor(TINTA).text('ANEXO · MONTAJE', L, y, { characterSpacing: 2 });
        doc.font('Helvetica').fontSize(9).fillColor(GRIS).text('Presupuesto ' + (d.numero || '') + ' · ' + (cli.nombre || '') + ' · ' + fechaLarga(ev.fecha), L, y + 4, { width: R - L, align: 'right' });
        y += 30;
        datos.montaje.forEach(sec => {
          nuevaPagina(40);
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor(ORO).text(String(sec.t).toUpperCase(), L, y, { characterSpacing: 1.2 }); y += 12;
          (sec.filas || []).forEach(([k, v]) => {
            const h = doc.font('Helvetica').fontSize(9.5).heightOfString(v, { width: R - L - 130 });
            nuevaPagina(h + 6);
            if (k) doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#4a4540').text(k, L, y, { width: 122 });
            doc.font('Helvetica').fontSize(9.5).fillColor(TINTA).text(v, k ? L + 130 : L, y, { width: k ? R - L - 130 : R - L });
            y += Math.max(h, 11) + 4;
          });
          y += 8;
        });
        if (d.firma) { nuevaPagina(60); doc.font('Helvetica').fontSize(8).fillColor(GRIS).text('Anexo firmado junto con el presupuesto por ' + (d.firmado_nombre || '') + (d.firmado_dni ? ' (DNI ' + d.firmado_dni + ')' : '') + '.', L, y, { width: R - L }); }
      }
      if (!firmado) doc.save().rotate(-30, { origin: [W / 2, 420] }).font('Helvetica-Bold').fontSize(70).fillColor('#b8965a').opacity(.08).text('BORRADOR', 60, 380, { width: W - 120, align: 'center' }).restore();
      // Pie con distintivos en todas las páginas
      const rango = doc.bufferedPageRange();
      for (let i = rango.start; i < rango.start + rango.count; i++) {
        doc.switchToPage(i); doc.page.margins.bottom = 0;
        const yb = doc.page.height - 50; let x = W / 2 - (PREMIOS.length * 34 + (PREMIOS.length - 1) * 12) / 2;
        PREMIOS.forEach(f => { try { doc.image(f, x, yb, { height: 24 }); } catch (e) {} x += 46; });
        doc.font('Helvetica').fontSize(6.5).fillColor(GRIS).text('Página ' + (i + 1) + ' de ' + rango.count, L, yb + 30, { width: R - L, align: 'right', lineBreak: false });
      }
      doc.end();
    });
  };
  const pdfDocBase = pdfDoc;
  pdfDoc = function (d, c) {
    if (d.tipo === 'presupuesto' && d.datos && d.datos.diseno) return DISENO.generar(d, { plantilla: plantillaBoda(), totales, autor: NOMBRE_COMPLETO[d.creado_por] || d.creado_por || '' });
    return pdfDocBase(d, c);
  };
  async function pdfDe(d) {
    if (d.pdf) { const f = path.join(carpeta(d.celebracion_id), d.pdf); if (fs.existsSync(f)) return fs.readFileSync(f); }
    return pdfDoc(d, celeb(d.celebracion_id));
  }
  async function congelarPdf(d) {
    const nombre = (d.numero || ('doc' + d.id)) + (d.tipo === 'factura' ? '' : '_firmado') + '.pdf';
    const buf = await pdfDoc(d, celeb(d.celebracion_id));
    fs.writeFileSync(path.join(carpeta(d.celebracion_id), nombre), buf);
    db.prepare('UPDATE evento_docs SET pdf = ? WHERE id = ?').run(nombre, d.id);
    return buf;
  }

  // ── Email ──
  // Correo de envío de eventos: el propio (reservas@donfadrique.com) si está configurado; si no, el general de la app
  function correoCfg() {
    const c = cfg(), e = json(c.eventos_correo, {});
    if (e.user && e.pass) return { desde: e.desde || e.user, nombre: e.nombre || 'Don Fadrique', host: e.host || 'smtp.gmail.com', port: Number(e.port) || 587, user: e.user, pass: e.pass, propio: true };
    if (c.email_smtp && c.email_pass) return { desde: c.email_smtp, nombre: 'Don Fadrique', host: 'smtp.gmail.com', port: 587, user: c.email_smtp, pass: c.email_pass, propio: false };
    return null;
  }
  function transporte(k) { return nodemailer.createTransport({ host: k.host, port: k.port, secure: k.port === 465, auth: { user: k.user, pass: k.pass } }); }
  async function enviarEmail(d, asunto, html, pdf, que) {
    const k = correoCfg();
    if (!k) throw new Error('Falta configurar el correo de envío (reservas@donfadrique.com) en Eventos › Correo');
    const cl = celeb(d.celebracion_id), para = [cl.email].filter(Boolean);
    if (!para.length) throw new Error('Esta ficha no tiene email de los clientes');
    await transporte(k).sendMail({ from: `"${k.nombre}" <${k.desde}>`, replyTo: k.desde, to: para.join(', '), bcc: k.desde, subject: asunto, html,
      attachments: pdf ? [{ filename: (TITULO[d.tipo] + ' ' + (d.numero || '')).trim().replace(/\s+/g, '_') + '.pdf', content: pdf, contentType: 'application/pdf' }] : [] });
    // Constancia: cuándo, a quién y desde qué dirección
    const env = json((db.prepare('SELECT envios FROM evento_docs WHERE id = ?').get(d.id) || {}).envios, []);
    env.push({ at: new Date().toISOString(), para: para.join(', '), desde: k.desde, que: que || 'pdf', asunto });
    db.prepare('UPDATE evento_docs SET envios = ? WHERE id = ?').run(JSON.stringify(env), d.id);
    return para;
  }
  const marcoEmail = (titulo, cuerpo) => `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f7f4ee;font-family:Jost,'Helvetica Neue',Arial,sans-serif;color:#1a1a1a">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e6dfd3;border-radius:14px;overflow:hidden">
<div style="padding:28px 24px 18px;text-align:center"><div style="font-size:22px;font-weight:300;letter-spacing:.34em">DON FADRIQUE</div><div style="font-size:9px;letter-spacing:.4em;color:#b8965a;margin-top:8px">${esc(titulo).toUpperCase()}</div></div>
<div style="padding:4px 28px 26px;font-size:14px;line-height:1.6">${cuerpo}</div>
<div style="padding:14px;text-align:center;font-size:11px;color:#9a9086;border-top:1px solid #f0ebe2">Don Fadrique · NIMANSANMON S.L. · Alba de Tormes (Salamanca) · 920 37 00 51</div></div></body></html>`;
  const urlFirma = (req, d) => (req.headers['x-forwarded-proto'] || req.protocol) + '://' + req.get('host') + '/firma/' + d.token;

  // ══ API (con sesión) ══
  app.get('/api/portal/eventos/textos', (req, res) => res.json(textos()));
  app.put('/api/portal/eventos/textos', (req, res) => {
    const t = {}; ['presupuesto', 'fianza', 'factura'].forEach(k => { if (typeof (req.body || {})[k] === 'string') t[k] = req.body[k].slice(0, 8000); });
    db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES ('eventos_textos', ?)").run(JSON.stringify(Object.assign(json(cfg().eventos_textos, {}), t)));
    res.json(textos());
  });

  // Plantilla del presupuesto con diseño (cóctel, barra libre, opcionales, condiciones)
  app.get('/api/portal/eventos/plantilla', (req, res) => res.json(plantillaBoda()));
  app.put('/api/portal/eventos/plantilla', (req, res) => {
    const b = req.body || {}, o = {};
    Object.keys(DISENO.PLANTILLA).forEach(k => { if (b[k] !== undefined) o[k] = typeof DISENO.PLANTILLA[k] === 'number' ? (Number(String(b[k]).replace(',', '.')) || 0) : String(b[k]).slice(0, 8000); });
    db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES ('eventos_plantilla_boda', ?)").run(JSON.stringify(Object.assign(json(cfg().eventos_plantilla_boda, {}), o)));
    res.json(plantillaBoda());
  });

  // Todo lo de la carpeta de un evento, de una vez
  app.get('/api/portal/eventos/:cid/carpeta', (req, res) => {
    const c = conPermiso(req, res, req.params.cid); if (!c) return;
    const notas = db.prepare('SELECT * FROM evento_notas WHERE celebracion_id = ? ORDER BY fecha DESC, id DESC').all(c.id);
    const archivos = db.prepare('SELECT * FROM evento_archivos WHERE celebracion_id = ? ORDER BY id DESC').all(c.id);
    const docs = db.prepare('SELECT * FROM evento_docs WHERE celebracion_id = ? ORDER BY tipo, id DESC').all(c.id).map(d => { d.datos = json(d.datos, {}); d.envios = json(d.envios, []); return sinFirma(d); });
    res.json({ ficha: c.ficha, notas, archivos, docs, textos: textos(), plantilla: plantillaBoda() });
  });
  app.put('/api/portal/eventos/:cid/ficha', (req, res) => {
    const c = conPermiso(req, res, req.params.cid); if (!c) return;
    const ficha = (req.body || {}).ficha || {};
    db.prepare("UPDATE celebraciones SET ficha = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(ficha).slice(0, 60000), c.id);
    // Se anota en el historial (como mucho una vez cada hora)
    const ult = db.prepare("SELECT created_at FROM evento_notas WHERE celebracion_id = ? AND tipo = 'sistema' AND texto LIKE 'Hoja interna%' ORDER BY id DESC LIMIT 1").get(c.id);
    if (!ult || Date.now() - new Date(ult.created_at.replace(' ', 'T') + 'Z').getTime() > 3600e3) nota(c.id, 'sistema', 'Hoja interna actualizada', req.usuario);
    res.json({ ok: true });
  });
  // Historial: reuniones, llamadas y notas
  app.post('/api/portal/eventos/:cid/notas', (req, res) => {
    const c = conPermiso(req, res, req.params.cid); if (!c) return;
    const d = req.body || {};
    if (!String(d.texto || '').trim()) return res.status(400).json({ error: 'Escribe lo que se habló' });
    const tipo = ['reunion', 'llamada', 'nota', 'visita', 'email'].includes(d.tipo) ? d.tipo : 'nota';
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '') ? d.fecha : new Date().toISOString().slice(0, 10);
    const r = db.prepare('INSERT INTO evento_notas (celebracion_id, fecha, tipo, texto, autor) VALUES (?,?,?,?,?)').run(c.id, fecha, tipo, String(d.texto).slice(0, 20000), req.usuario || '');
    res.json(db.prepare('SELECT * FROM evento_notas WHERE id = ?').get(r.lastInsertRowid));
  });
  app.put('/api/portal/eventos/notas/:id', (req, res) => {
    const n = db.prepare('SELECT * FROM evento_notas WHERE id = ?').get(req.params.id); if (!n) return res.status(404).json({ error: 'No existe' });
    if (!conPermiso(req, res, n.celebracion_id)) return;
    if (n.tipo === 'sistema') return res.status(400).json({ error: 'Las anotaciones automáticas no se cambian' });
    const d = req.body || {};
    db.prepare("UPDATE evento_notas SET texto = ?, fecha = ?, tipo = ?, updated_at = datetime('now') WHERE id = ?").run(String(d.texto || n.texto).slice(0, 20000), /^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '') ? d.fecha : n.fecha, d.tipo || n.tipo, n.id);
    res.json({ ok: true });
  });
  app.delete('/api/portal/eventos/notas/:id', (req, res) => {
    const n = db.prepare('SELECT * FROM evento_notas WHERE id = ?').get(req.params.id); if (!n) return res.status(404).json({ error: 'No existe' });
    if (!conPermiso(req, res, n.celebracion_id)) return;
    if (n.tipo === 'sistema') return res.status(400).json({ error: 'Las anotaciones automáticas no se borran' });
    db.prepare('DELETE FROM evento_notas WHERE id = ?').run(n.id); res.json({ ok: true });
  });
  // Archivos de la carpeta
  const EXT = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx', 'application/vnd.ms-excel': '.xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx', 'text/plain': '.txt' };
  app.post('/api/portal/eventos/:cid/archivos', require('express').raw({ type: () => true, limit: '30mb' }), (req, res) => {
    const c = conPermiso(req, res, req.params.cid); if (!c) return;
    const mime = String(req.headers['content-type'] || '').split(';')[0];
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'Archivo vacío' });
    const original = decodeURIComponent(String(req.headers['x-nombre'] || '')).replace(/[\\/]/g, ' ').slice(0, 180) || 'archivo';
    const ext = EXT[mime] || (path.extname(original).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 6) || '.bin');
    const archivo = 'arch_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex') + ext;
    fs.writeFileSync(path.join(carpeta(c.id), archivo), req.body);
    const cat = ['presupuesto', 'fianza', 'factura', 'contrato', 'proveedor', 'foto', 'otro'].includes(req.headers['x-categoria']) ? req.headers['x-categoria'] : 'otro';
    const r = db.prepare('INSERT INTO evento_archivos (celebracion_id, nombre, archivo, mime, tamano, categoria, subido_por) VALUES (?,?,?,?,?,?,?)').run(c.id, original, archivo, mime, req.body.length, cat, req.usuario || '');
    nota(c.id, 'sistema', 'Archivo añadido: ' + original, req.usuario);
    res.json(db.prepare('SELECT * FROM evento_archivos WHERE id = ?').get(r.lastInsertRowid));
  });
  app.get('/api/portal/eventos/archivos/:id', (req, res) => {
    const a = db.prepare('SELECT * FROM evento_archivos WHERE id = ?').get(req.params.id); if (!a) return res.status(404).send('No existe');
    if (!conPermiso(req, res, a.celebracion_id)) return;
    const f = path.join(carpeta(a.celebracion_id), a.archivo); if (!fs.existsSync(f)) return res.status(404).send('Archivo no encontrado');
    res.setHeader('Content-Type', a.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(a.nombre) + '"');
    res.sendFile(f);
  });
  app.delete('/api/portal/eventos/archivos/:id', (req, res) => {
    const a = db.prepare('SELECT * FROM evento_archivos WHERE id = ?').get(req.params.id); if (!a) return res.status(404).json({ error: 'No existe' });
    if (!conPermiso(req, res, a.celebracion_id)) return;
    try { fs.renameSync(path.join(carpeta(a.celebracion_id), a.archivo), path.join(carpeta(a.celebracion_id), 'borrado_' + a.archivo)); } catch (e) {}
    db.prepare('DELETE FROM evento_archivos WHERE id = ?').run(a.id);
    nota(a.celebracion_id, 'sistema', 'Archivo quitado: ' + a.nombre, req.usuario);
    res.json({ ok: true });
  });

  // Presupuesto, reserva con fianza y factura
  app.post('/api/portal/eventos/:cid/docs', (req, res) => {
    const c = conPermiso(req, res, req.params.cid); if (!c) return;
    const tipo = (req.body || {}).tipo;
    if (!TITULO[tipo]) return res.status(400).json({ error: 'Tipo de documento no válido' });
    if (tipo === 'factura' && db.prepare("SELECT id FROM evento_docs WHERE celebracion_id = ? AND tipo = 'factura' AND estado IN ('borrador','emitida')").get(c.id)) return res.status(400).json({ error: 'Ya hay una factura para este evento' });
    const id = crearDoc(c, tipo, req.usuario);
    nota(c.id, 'sistema', TITULO[tipo] + ' ' + (docDe(id).numero || '') + ' creado (borrador)', req.usuario);
    res.json(sinFirma(docDe(id)));
  });
  app.get('/api/portal/eventos/docs/:id', (req, res) => {
    const d = docDe(req.params.id); if (!d) return res.status(404).json({ error: 'No existe' });
    if (!conPermiso(req, res, d.celebracion_id)) return;
    res.json(sinFirma(d));
  });
  app.put('/api/portal/eventos/docs/:id', (req, res) => {
    const d = docDe(req.params.id); if (!d) return res.status(404).json({ error: 'No existe' });
    if (!conPermiso(req, res, d.celebracion_id)) return;
    if (!['borrador', 'enviado'].includes(d.estado)) return res.status(400).json({ error: d.estado === 'firmado' ? 'Ya está firmado: haz una nueva versión para cambiarlo' : 'Este documento ya no se puede cambiar' });
    const datos = (req.body || {}).datos || {};
    if (d.datos.diseno && datos.paquete) {
      const c = celeb(d.celebracion_id);
      datos.lineas_extra = limpiaLineas(datos.lineas_extra);
      datos.paquete.extras = (Array.isArray(datos.paquete.extras) ? datos.paquete.extras : []).map(x => ({ concepto: String(x.concepto || '').slice(0, 200), precio: Number(x.precio) || 0, cantidad: Number(x.cantidad) || 0 })).filter(x => x.cantidad);
      datos.lineas = lineasPaquete(c, datos.paquete, datos.lineas_extra);
    } else datos.lineas = limpiaLineas(datos.lineas);
    guardarDatos(d.id, Object.assign({}, d.datos, datos));
    if (d.estado === 'enviado') db.prepare("UPDATE evento_docs SET estado = 'borrador' WHERE id = ?").run(d.id); // cambió: hay que volver a mandarlo
    res.json(sinFirma(docDe(d.id)));
  });
  app.delete('/api/portal/eventos/docs/:id', (req, res) => {
    const d = docDe(req.params.id); if (!d) return res.status(404).json({ error: 'No existe' });
    if (!conPermiso(req, res, d.celebracion_id)) return;
    if (!['borrador', 'enviado'].includes(d.estado)) return res.status(400).json({ error: 'Los documentos firmados o emitidos no se borran' });
    db.prepare('DELETE FROM evento_docs WHERE id = ?').run(d.id);
    nota(d.celebracion_id, 'sistema', TITULO[d.tipo] + ' ' + (d.numero || '') + ' (borrador) eliminado', req.usuario);
    res.json({ ok: true });
  });
  app.get('/api/portal/eventos/docs/:id/pdf', async (req, res) => {
    const d = docDe(req.params.id); if (!d) return res.status(404).send('No existe');
    if (!conPermiso(req, res, d.celebracion_id)) return;
    try { const buf = await pdfDe(d); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent((TITULO[d.tipo] + ' ' + (d.numero || 'borrador')).trim()) + '.pdf"'); res.send(buf); }
    catch (e) { res.status(500).send('No se pudo generar el PDF: ' + e.message); }
  });
  // Preparar para firmar: genera el enlace (para firmar aquí o mandarlo por WhatsApp / email)
  app.post('/api/portal/eventos/docs/:id/firmar', async (req, res) => {
    const d = docDe(req.params.id); if (!d) return res.status(404).json({ error: 'No existe' });
    if (!conPermiso(req, res, d.celebracion_id)) return;
    if (d.tipo === 'factura') return res.status(400).json({ error: 'La factura no se firma' });
    if (!['borrador', 'enviado'].includes(d.estado)) return res.status(400).json({ error: 'Este documento ya está firmado' });
    if (d.tipo === 'presupuesto' && !(d.datos.lineas || []).length) return res.status(400).json({ error: 'El presupuesto no tiene líneas' });
    const token = d.token || crypto.randomBytes(18).toString('base64url');
    db.prepare("UPDATE evento_docs SET token = ?, estado = 'enviado', enviado_at = datetime('now') WHERE id = ?").run(token, d.id);
    const d2 = docDe(d.id), url = urlFirma(req, d2), out = { ok: true, url, email: null };
    if ((req.body || {}).email) {
      try {
        const pdf = await pdfDoc(d2, celeb(d2.celebracion_id));
        const cl = celeb(d2.celebracion_id);
        out.email = await enviarEmail(d2, TITULO[d2.tipo] + ' ' + d2.numero + ' · Don Fadrique', marcoEmail(TITULO[d2.tipo], `<p>Hola${cl.nombre1 ? ' ' + esc(cl.nombre1) : ''},</p><p>Te enviamos ${d2.tipo === 'fianza' ? 'el documento de <b>reserva de fecha y fianza</b>' : 'el <b>presupuesto ' + esc(d2.numero) + '</b>'} para ${esc(nombreCeleb(cl))} el ${esc(fechaLarga(cl.fecha))}.</p>
<p>Puedes revisarlo y <b>firmarlo con el dedo desde el móvil</b> en este enlace:</p><p style="text-align:center;margin:22px 0"><a href="${url}" style="background:#1a1a1a;color:#fff;text-decoration:none;padding:13px 26px;border-radius:10px;display:inline-block">Revisar y firmar</a></p>
<p style="font-size:12px;color:#8a8278">Te adjuntamos también el documento en PDF. Para cualquier duda, responde a este correo o llámanos.</p>`), pdf, 'enlace para firmar');
        nota(d2.celebracion_id, 'sistema', TITULO[d2.tipo] + ' ' + d2.numero + ' enviado para firmar a ' + out.email.join(', ') + ' desde ' + (correoCfg() || {}).desde, req.usuario);
      } catch (e) { out.aviso = 'No se pudo enviar el email: ' + e.message; }
    }
    res.json(out);
  });
  // Nueva versión de un presupuesto o reserva ya firmados (el firmado queda en el historial)
  app.post('/api/portal/eventos/docs/:id/version', (req, res) => {
    const d = docDe(req.params.id); if (!d) return res.status(404).json({ error: 'No existe' });
    if (!conPermiso(req, res, d.celebracion_id)) return;
    if (d.tipo === 'factura') return res.status(400).json({ error: 'Las facturas no tienen versiones' });
    const r = db.prepare("INSERT INTO evento_docs (celebracion_id, tipo, numero, version, estado, datos, creado_por) VALUES (?, ?, ?, ?, 'borrador', '{}', ?)").run(d.celebracion_id, d.tipo, d.numero, (d.version || 1) + 1, req.usuario || '');
    guardarDatos(r.lastInsertRowid, d.datos);
    db.prepare('UPDATE evento_docs SET sustituido = 1 WHERE id = ?').run(d.id);
    nota(d.celebracion_id, 'sistema', TITULO[d.tipo] + ' ' + (d.numero || '') + ': nueva versión ' + ((d.version || 1) + 1) + ' (la anterior queda guardada)', req.usuario);
    res.json(sinFirma(docDe(r.lastInsertRowid)));
  });
  // Emitir la factura: recibe número y fecha y ya no se cambia
  app.post('/api/portal/eventos/docs/:id/emitir', async (req, res) => {
    const d = docDe(req.params.id); if (!d) return res.status(404).json({ error: 'No existe' });
    const c = conPermiso(req, res, d.celebracion_id); if (!c) return;
    if (d.tipo !== 'factura' || d.estado !== 'borrador') return res.status(400).json({ error: 'Solo se emite una factura en borrador' });
    if (!(d.datos.lineas || []).length) return res.status(400).json({ error: 'La factura no tiene líneas' });
    // Entregas a cuenta: fianza pagada y pagos anotados en la ficha
    const ac = [];
    if (c.fianza_pagada && c.fianza_importe) ac.push({ concepto: 'Fianza', fecha: c.fianza_fecha || '', importe: c.fianza_importe });
    (c.pagos || []).forEach(p => { if (Number(p.importe)) ac.push({ concepto: p.concepto || 'Pago', fecha: p.fecha || '', importe: Number(p.importe) }); });
    const datos = Object.assign({}, d.datos, { cliente: Object.assign({}, d.datos.cliente), a_cuenta: ac });
    guardarDatos(d.id, datos);
    const numero = siguienteNumero('factura'), hoy = new Date().toISOString().slice(0, 10);
    // Registro de facturación (RD 1007/2023): huella SHA-256 encadenada con la factura anterior de la serie y QR de la AEAT
    const t = totales(datos), fechaEs = hoy.split('-').reverse().join('-');
    const ant = db.prepare("SELECT huella FROM evento_docs WHERE tipo = 'factura' AND estado = 'emitida' AND huella IS NOT NULL ORDER BY fecha_emision DESC, id DESC LIMIT 1").get();
    const genReg = new Date().toISOString().replace(/\.\d+Z$/, '+00:00');
    const cadena = 'IDEmisorFactura=B37297223&NumSerieFactura=' + numero + '&FechaExpedicionFactura=' + fechaEs + '&TipoFactura=F1&CuotaTotal=' + t.iva.toFixed(2) +
      '&ImporteTotal=' + t.total.toFixed(2) + '&Huella=' + (ant ? ant.huella : '') + '&FechaHoraHusoGenRegistro=' + genReg;
    const huella = crypto.createHash('sha256').update(cadena, 'utf8').digest('hex').toUpperCase();
    const qr = 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=B37297223&numserie=' + encodeURIComponent(numero) + '&fecha=' + fechaEs + '&importe=' + t.total.toFixed(2);
    datos.registro = { cadena, anterior: ant ? ant.huella : null, generado: genReg };
    guardarDatos(d.id, datos);
    db.prepare("UPDATE evento_docs SET numero = ?, estado = 'emitida', fecha_emision = ?, huella = ?, qr = ? WHERE id = ?").run(numero, hoy, huella, qr, d.id);
    await congelarPdf(docDe(d.id));
    nota(c.id, 'sistema', 'Factura ' + numero + ' emitida por ' + eur(docDe(d.id).total), req.usuario);
    res.json(sinFirma(docDe(d.id)));
  });
  app.post('/api/portal/eventos/docs/:id/enviar', async (req, res) => {
    const d = docDe(req.params.id); if (!d) return res.status(404).json({ error: 'No existe' });
    if (!conPermiso(req, res, d.celebracion_id)) return;
    try {
      const pdf = await pdfDe(d), cl = celeb(d.celebracion_id);
      const para = await enviarEmail(d, TITULO[d.tipo] + ' ' + (d.numero || '') + ' · Don Fadrique', marcoEmail(TITULO[d.tipo], `<p>Hola${cl.nombre1 ? ' ' + esc(cl.nombre1) : ''},</p><p>Te adjuntamos ${d.tipo === 'factura' ? 'la <b>factura ' + esc(d.numero) + '</b>' : d.tipo === 'fianza' ? 'el documento de <b>reserva de fecha y fianza</b>' + (d.firma ? ' firmado' : '') : 'el <b>presupuesto ' + esc(d.numero) + '</b>' + (d.firma ? ' firmado' : '')} de ${esc(nombreCeleb(cl))} (${esc(fechaLarga(cl.fecha))}).</p><p>Un saludo,<br>Don Fadrique</p>`), pdf, d.firma ? 'copia firmada' : d.tipo === 'factura' ? 'factura' : 'pdf');
      nota(d.celebracion_id, 'sistema', TITULO[d.tipo] + ' ' + (d.numero || '') + ' enviado por email a ' + para.join(', ') + ' desde ' + (correoCfg() || {}).desde, req.usuario);
      res.json({ ok: true, para });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // Volver a tomar nombres, fecha, invitados y menú de la ficha (solo en borrador)
  app.post('/api/portal/eventos/docs/:id/refrescar', (req, res) => {
    const d = docDe(req.params.id); if (!d) return res.status(404).json({ error: 'No existe' });
    const c = conPermiso(req, res, d.celebracion_id); if (!c) return;
    if (!['borrador', 'enviado'].includes(d.estado)) return res.status(400).json({ error: 'Este documento ya no se puede cambiar' });
    const datos = Object.assign({}, d.datos, { cliente: clienteDe(c), evento: eventoDe(c) });
    if (d.tipo === 'presupuesto') {
      datos.menu = menuDe(c); datos.montaje = montajeDe(c);
      if (datos.diseno) { const pq = Object.assign({}, datos.paquete || {}); pq.menu_nombre = c.menu_nombre || pq.menu_nombre; if (Number(c.precio_adulto)) pq.menu_precio = Number(c.precio_adulto); if (Number(c.precio_nino)) pq.nino_precio = Number(c.precio_nino); datos.paquete = pq; datos.lineas = lineasPaquete(c, pq, datos.lineas_extra || []); }
    }
    if (d.tipo === 'fianza' && !Number(datos.importe_fianza) && c.fianza_importe) datos.importe_fianza = c.fianza_importe;
    guardarDatos(d.id, datos);
    if (d.estado === 'enviado') db.prepare("UPDATE evento_docs SET estado = 'borrador' WHERE id = ?").run(d.id);
    res.json(sinFirma(docDe(d.id)));
  });

  // Estado de cada carpeta para la lista de bodas / comuniones / eventos
  app.get('/api/portal/eventos/estado', (req, res) => {
    const out = {};
    db.prepare('SELECT * FROM celebraciones').all().forEach(c => {
      if (!puedeTipo(req, c.tipo)) return;
      const docs = db.prepare('SELECT tipo, estado, sustituido FROM evento_docs WHERE celebracion_id = ?').all(c.id);
      const est = t => docs.some(x => x.tipo === t && (x.estado === 'firmado' || x.estado === 'emitida')) ? 2 : docs.some(x => x.tipo === t) ? 1 : 0;
      const f = json(c.ficha, {});
      out[c.id] = { fianza: est('fianza') === 2 && c.fianza_pagada ? 2 : (est('fianza') || c.fianza_pagada) ? 1 : 0, presupuesto: est('presupuesto'), factura: est('factura'),
        menu: (f.menu_pers_id || c.plantilla_id) && (f.banquete || {}).lugar ? 2 : (f.menu_pers_id || c.plantilla_id || Object.keys(f).length) ? 1 : 0,
        hab: c.hab_novios || null, notas: db.prepare("SELECT COUNT(*) n FROM evento_notas WHERE celebracion_id = ? AND tipo != 'sistema'").get(c.id).n };
    });
    res.json(out);
  });

  // Correo de envío de los eventos (solo administradores)
  app.get('/api/portal/eventos/correo', (req, res) => {
    const e = json(cfg().eventos_correo, {}), k = correoCfg();
    res.json({ desde: e.desde || 'reservas@donfadrique.com', nombre: e.nombre || 'Don Fadrique', host: e.host || '', port: e.port || 587, user: e.user || '', tiene_pass: !!e.pass, activo: k ? k.desde : null, propio: !!(k && k.propio) });
  });
  app.put('/api/portal/eventos/correo', (req, res) => {
    const b = req.body || {}, e = json(cfg().eventos_correo, {});
    ['desde', 'nombre', 'host', 'user'].forEach(k => { if (typeof b[k] === 'string') e[k] = b[k].trim().slice(0, 200); });
    if (b.port) e.port = parseInt(b.port, 10) || 587;
    if (typeof b.pass === 'string' && b.pass.trim()) e.pass = b.pass.trim();
    db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES ('eventos_correo', ?)").run(JSON.stringify(e));
    res.json({ ok: true });
  });
  app.post('/api/portal/eventos/correo/prueba', async (req, res) => {
    const k = correoCfg(); if (!k) return res.status(400).json({ error: 'Falta configurar el correo' });
    try {
      await transporte(k).sendMail({ from: `"${k.nombre}" <${k.desde}>`, to: (req.body || {}).para || k.desde, subject: 'Prueba de correo · Don Fadrique', html: marcoEmail('Prueba', '<p>El correo de envío de eventos funciona correctamente.</p>') });
      res.json({ ok: true, desde: k.desde });
    } catch (e) { res.status(400).json({ error: 'No se pudo enviar: ' + e.message }); }
  });

  // ── Habitación de los novios en el hotel (115, 109 o 110), la noche de la boda, importe 0 ──
  const HOTEL_URL = (process.env.HOTEL_URL || 'https://hotel.palaciocondealdana.com').replace(/\/$/, '');
  const HABS_NOVIOS = ['115', '109', '110'];
  async function hotel(ruta, opts) {
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const r = await fetch(HOTEL_URL + ruta, Object.assign({ signal: ctrl.signal, headers: { 'Content-Type': 'application/json' } }, opts || {}));
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.ok === false) { const e = new Error((d && (d.msg || d.error)) || ('El hotel respondió ' + r.status)); e.status = r.status; throw e; }
      return d;
    } catch (e) { if (e.name === 'AbortError') throw new Error('El hotel no responde'); throw e; }
    finally { clearTimeout(t); }
  }
  // En el hotel las habitaciones se llaman «H115», «H109»…: se busca la que corresponde al número
  let HABS_HOTEL = null;
  async function idHotel(num) {
    if (!HABS_HOTEL) { try { HABS_HOTEL = (await hotel('/api/habitaciones')).map(h => String(h.id)); } catch (e) { HABS_HOTEL = null; } }
    return (HABS_HOTEL || []).find(id => id === num || id.replace(/\D/g, '') === num) || ('H' + num);
  }
  const diaSig = f => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
  function reservaNovios(c, hab, estado) {
    return { habitacion_id: hab, /* id del hotel */ nombre: [c.nombre1, c.nombre2].filter(Boolean).join(' y ') || nombreCeleb(c), apellidos: [c.apellidos1, c.apellidos2].filter(Boolean).join(' / '),
      dni: c.dni1 || '', telefono: c.tel || '', email: c.email || '', fecha_entrada: c.fecha, fecha_salida: diaSig(c.fecha), pax: 2, tratamiento: 'alojamiento',
      precio_noche: 0, precio_total: 0, estado: estado || 'confirmada', sin_email: true, invitacion: true,
      obs: 'Habitación de los novios (invitación por la boda en Don Fadrique' + (c.lugar ? ', ' + c.lugar : '') + '). Importe 0 €.' + (c.nombre2 ? ' ' + [c.nombre1, c.apellidos1].filter(Boolean).join(' ') + ' y ' + [c.nombre2, c.apellidos2].filter(Boolean).join(' ') + (c.dni2 ? ' (DNI ' + c.dni2 + ')' : '') + '.' : '') };
  }
  app.get('/api/portal/eventos/:cid/habitacion', async (req, res) => {
    const c = conPermiso(req, res, req.params.cid); if (!c) return;
    // Qué habitaciones de novios están libres esa noche
    const libres = {};
    await Promise.all(HABS_NOVIOS.map(async h => {
      try { const r = await hotel('/api/reservas/check', { method: 'POST', body: JSON.stringify({ habitacion_id: await idHotel(h), fecha_entrada: c.fecha, fecha_salida: diaSig(c.fecha), id: c.hab_novios === h ? c.hab_reserva_id : null }) }); libres[h] = true; }
      catch (e) { libres[h] = /ocupada/i.test(e.message) ? false : null; }
    }));
    res.json({ habitacion: c.hab_novios || null, reserva_id: c.hab_reserva_id || null, opciones: HABS_NOVIOS, libres, noche: c.fecha, salida: diaSig(c.fecha) });
  });
  app.post('/api/portal/eventos/:cid/habitacion', async (req, res) => {
    const c = conPermiso(req, res, req.params.cid); if (!c) return;
    const hab = String((req.body || {}).habitacion || c.hab_novios || '');
    if (!HABS_NOVIOS.includes(hab)) return res.status(400).json({ error: 'Elige la 115, la 109 o la 110' });
    if (!c.fecha) return res.status(400).json({ error: 'La boda no tiene fecha' });
    try {
      let r;
      if (c.hab_reserva_id) {
        try { r = await hotel('/api/reservas/' + c.hab_reserva_id, { method: 'PUT', body: JSON.stringify(reservaNovios(c, await idHotel(hab))) }); }
        catch (e) { if (e.status === 404) r = null; else throw e; }
      }
      if (!r || !r.id) r = await hotel('/api/reservas', { method: 'POST', body: JSON.stringify(reservaNovios(c, await idHotel(hab))) });
      db.prepare('UPDATE celebraciones SET hab_novios = ?, hab_reserva_id = ? WHERE id = ?').run(hab, r.id, c.id);
      nota(c.id, 'sistema', 'Habitación ' + hab + ' de los novios reservada en el hotel para la noche del ' + c.fecha + ' (importe 0 €)', req.usuario);
      res.json({ ok: true, habitacion: hab, reserva_id: r.id });
    } catch (e) { res.status(e.status === 409 ? 409 : 502).json({ error: e.status === 409 ? 'La habitación ' + hab + ' ya está ocupada esa noche en el hotel. Elige otra.' : 'No se pudo reservar en el hotel: ' + e.message }); }
  });
  app.delete('/api/portal/eventos/:cid/habitacion', async (req, res) => {
    const c = conPermiso(req, res, req.params.cid); if (!c) return;
    if (c.hab_reserva_id) {
      try { await hotel('/api/reservas/' + c.hab_reserva_id, { method: 'PUT', body: JSON.stringify(reservaNovios(c, await idHotel(c.hab_novios), 'cancelada')) }); }
      catch (e) { if (e.status !== 404) return res.status(502).json({ error: 'No se pudo anular en el hotel: ' + e.message }); }
    }
    db.prepare('UPDATE celebraciones SET hab_novios = NULL, hab_reserva_id = NULL WHERE id = ?').run(c.id);
    nota(c.id, 'sistema', 'Habitación de los novios anulada en el hotel', req.usuario);
    res.json({ ok: true });
  });

  // ══ FIRMA PÚBLICA (enlace que se abre en el móvil del cliente o en el nuestro) ══
  const porToken = t => { const d = db.prepare('SELECT * FROM evento_docs WHERE token = ?').get(String(t || '')); if (d) d.datos = json(d.datos, {}); return d; };
  app.get('/api/publico/firma/:token', (req, res) => {
    const d = porToken(req.params.token); if (!d || d.tipo === 'factura') return res.status(404).json({ error: 'Este enlace no existe o ha caducado' });
    const t = totales(d.datos);
    res.json({ tipo: d.tipo, titulo: TITULO[d.tipo], numero: d.numero, version: d.version, estado: d.estado, sustituido: !!d.sustituido, datos: d.datos, totales: t,
      firmado_nombre: d.firmado_nombre, firmado_dni: d.firmado_dni, firmado_at: d.firmado_at, tiene_firma: !!d.firma });
  });
  const intentos = {};
  app.post('/api/publico/firma/:token', require('express').json({ limit: '3mb' }), async (req, res) => {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const ahora = Date.now(); intentos[ip] = (intentos[ip] || []).filter(x => ahora - x < 600e3); if (intentos[ip].length > 20) return res.status(429).json({ error: 'Demasiados intentos' }); intentos[ip].push(ahora);
    const d = porToken(req.params.token); if (!d || d.tipo === 'factura') return res.status(404).json({ error: 'Este enlace no existe o ha caducado' });
    if (d.estado === 'firmado') return res.status(409).json({ error: 'Este documento ya está firmado' });
    if (d.sustituido) return res.status(409).json({ error: 'Hay una versión más reciente de este documento: pide el enlace nuevo' });
    const b = req.body || {}, firma = String(b.firma || '');
    if (!b.acepto) return res.status(400).json({ error: 'Marca la casilla de conformidad' });
    if (!String(b.nombre || '').trim()) return res.status(400).json({ error: 'Escribe tu nombre' });
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(firma) || firma.length < 800 || firma.length > 2e6) return res.status(400).json({ error: 'Falta la firma' });
    const huella = crypto.createHash('sha256').update(JSON.stringify([d.tipo, d.numero, d.version, d.datos])).digest('hex');
    db.prepare("UPDATE evento_docs SET estado = 'firmado', firma = ?, firmado_nombre = ?, firmado_dni = ?, firmado_at = datetime('now'), firmado_ip = ?, firmado_ua = ?, huella = ? WHERE id = ? AND estado != 'firmado'")
      .run(firma, String(b.nombre).trim().slice(0, 150), String(b.dni || '').trim().slice(0, 30), ip, String(req.headers['user-agent'] || '').slice(0, 300), huella, d.id);
    const firmado = docDe(d.id), c = celeb(d.celebracion_id);
    nota(c.id, 'sistema', TITULO[d.tipo] + ' ' + (d.numero || '') + ' FIRMADO por ' + firmado.firmado_nombre + (firmado.firmado_dni ? ' (DNI ' + firmado.firmado_dni + ')' : ''), 'firma');
    let pdf = null;
    try { pdf = await congelarPdf(firmado); } catch (e) { console.error('[eventos] pdf firmado:', e.message); }
    // Presupuesto firmado → la factura se rellena sola
    if (d.tipo === 'presupuesto') { try { if (facturaDesdePresupuesto(c, firmado, 'automático')) nota(c.id, 'sistema', 'Factura (borrador) actualizada con el presupuesto ' + d.numero + ' firmado', 'automático'); } catch (e) { console.error('[eventos] factura:', e.message); } }
    // Copia por email a los clientes
    let enviado = null;
    if (pdf && c.email) {
      try { enviado = await enviarEmail(firmado, TITULO[d.tipo] + ' ' + (d.numero || '') + ' firmado · Don Fadrique', marcoEmail(TITULO[d.tipo] + ' firmado', `<p>Hola ${esc(firmado.firmado_nombre)},</p><p>Gracias por firmar ${d.tipo === 'fianza' ? 'el documento de <b>reserva de fecha y fianza</b>' : 'el <b>presupuesto ' + esc(d.numero) + '</b>'}. Te adjuntamos la copia firmada en PDF.</p><p>Un saludo,<br>Don Fadrique</p>`), pdf, 'copia firmada (automático)');
        nota(c.id, 'sistema', 'Copia firmada enviada por email a ' + enviado.join(', '), 'automático'); } catch (e) { console.error('[eventos] email firma:', e.message); }
    }
    res.json({ ok: true, enviado });
  });
  app.get('/firma/:token/pdf', async (req, res) => {
    const d = porToken(req.params.token); if (!d || d.tipo === 'factura') return res.status(404).send('No existe');
    try { const buf = await pdfDe(d); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(TITULO[d.tipo] + ' ' + (d.numero || '')) + '.pdf"'); res.send(buf); }
    catch (e) { res.status(500).send('Error'); }
  });
  app.get('/firma/:token', (req, res) => res.sendFile(path.join(__dirname, 'firma.html')));

  // Para el panel y el archivo
  return { totales, pdfDoc, carpeta };
};
