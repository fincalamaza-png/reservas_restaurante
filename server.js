const express = require('express');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── BASE DE DATOS ────────────────────────────────────────────────
const db = new Database('/data/reservas.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS reservas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT, salon TEXT, mesa INTEGER, fecha TEXT, hora TEXT,
    nombre TEXT, tel TEXT, email TEXT, pax INTEGER, menu TEXT,
    alergias TEXT, obs TEXT, estado TEXT DEFAULT 'pendiente',
    tipo_evento TEXT, montaje TEXT DEFAULT 'imperial',
    protocolo INTEGER DEFAULT 0, coctel INTEGER DEFAULT 0,
    coctel_det TEXT, entrantes TEXT, pescado TEXT,
    sorbete INTEGER DEFAULT 0, carne TEXT, postre TEXT,
    vino_blanco TEXT DEFAULT 'Verdejo', vino_tinto TEXT DEFAULT 'Cinco de Copas', vino_cava TEXT DEFAULT 'Cava',
    vino_extra TEXT, copas INTEGER DEFAULT 0,
    fianza INTEGER DEFAULT 0, fianza_imp REAL,
    conf_env INTEGER DEFAULT 0, rec_env INTEGER DEFAULT 0,
    menus_detalle TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS config (
    clave TEXT PRIMARY KEY,
    valor TEXT
  );

  CREATE TABLE IF NOT EXISTS extras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    apellidos TEXT NOT NULL,
    dni TEXT,
    tel TEXT,
    email TEXT,
    actitud REAL DEFAULT 3,
    capacidad REAL DEFAULT 3,
    rigor REAL DEFAULT 3,
    conocimientos REAL DEFAULT 3,
    aspecto REAL DEFAULT 3,
    veces_si INTEGER DEFAULT 0,
    veces_no INTEGER DEFAULT 0,
    rechazos_seguidos INTEGER DEFAULT 0,
    aceptaciones_seguidas INTEGER DEFAULT 0,
    penalizado INTEGER DEFAULT 0,
    activo INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS extras_reservas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    extra_id INTEGER,
    reserva_id INTEGER,
    fecha TEXT,
    estado TEXT DEFAULT 'pendiente',
    manual INTEGER DEFAULT 0,
    conv_env INTEGER DEFAULT 0,
    rec_env INTEGER DEFAULT 0,
    hora_convocatoria TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (extra_id) REFERENCES extras(id),
    FOREIGN KEY (reserva_id) REFERENCES reservas(id)
  );

  INSERT OR IGNORE INTO config VALUES ('email_rest', '');
  INSERT OR IGNORE INTO config VALUES ('tel_rest', '');
  INSERT OR IGNORE INTO config VALUES ('dir_rest', 'Castilla y Leon');
  INSERT OR IGNORE INTO config VALUES ('email_smtp', '');
  INSERT OR IGNORE INTO config VALUES ('email_pass', '');
  INSERT OR IGNORE INTO config VALUES ('recordatorios', '1');
`);

// Create presupuestos table
try { db.exec("CREATE TABLE IF NOT EXISTS presupuestos (id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT, reserva_id INTEGER, cliente TEXT, fecha_evento TEXT, salon TEXT, pax INTEGER, tipo_evento TEXT, firmante TEXT, lineas TEXT, subtotal REAL, iva REAL, total REAL, obs TEXT, enviado INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))"); } catch(e) {}


  // Add new wine columns if not exist
  try { db.exec("ALTER TABLE reservas ADD COLUMN vino_blanco TEXT DEFAULT 'Verdejo'"); } catch(e) {}
  try { db.exec("ALTER TABLE reservas ADD COLUMN vino_tinto TEXT DEFAULT 'Cinco de Copas'"); } catch(e) {}
  try { db.exec("ALTER TABLE reservas ADD COLUMN vino_cava TEXT DEFAULT 'Cava'"); } catch(e) {}
  // Ensure presupuestos table exists
  try { db.exec("CREATE TABLE IF NOT EXISTS presupuestos (id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT, reserva_id INTEGER, cliente TEXT, fecha_evento TEXT, salon TEXT, pax INTEGER, tipo_evento TEXT, firmante TEXT, lineas TEXT, subtotal REAL, iva REAL, total REAL, obs TEXT, enviado INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime(\'now\')))"); } catch(e) {}



// ─── MIDDLEWARE ───────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─── HELPERS ─────────────────────────────────────────────────────
function getConfig() {
  const rows = db.prepare('SELECT clave, valor FROM config').all();
  const cfg = {};
  rows.forEach(r => cfg[r.clave] = r.valor);
  return cfg;
}

function parseBool(v) { return v ? 1 : 0; }
function parseArr(v) { return Array.isArray(v) ? v.join('||') : (v || ''); }
function toArr(v) { return v ? v.split('||') : []; }

function rowToObj(r) {
  if (!r) return null;
  return {
    ...r,
    protocolo: !!r.protocolo, coctel: !!r.coctel, sorbete: !!r.sorbete,
    copas: !!r.copas, fianza: !!r.fianza,
    conf_env: !!r.conf_env, rec_env: !!r.rec_env,
    vinos: toArr(r.vinos)
  };
}

function puntuacionExtra(e) {
  return ((e.actitud + e.capacidad + e.rigor + e.conocimientos + e.aspecto) / 5).toFixed(2);
}

// Calcular hora de convocatoria para un dia dado
function calcHoraConvocatoria(fecha) {
  // Buscar todas las reservas del dia
  const reservas = db.prepare(
    "SELECT hora, tipo FROM reservas WHERE fecha = ? AND estado != 'cancelada' ORDER BY hora"
  ).all(fecha);
  
  if (!reservas.length) return null;
  
  // Ver si hay eventos (>20 pax)
  const reservasPax = db.prepare(
    "SELECT hora, tipo, pax FROM reservas WHERE fecha = ? AND estado != 'cancelada' ORDER BY hora"
  ).all(fecha);
  
  const totalPax = reservasPax.reduce((s, r) => s + (r.pax || 0), 0);
  if (totalPax <= 20) return null;
  
  // Primera reserva del dia
  const primera = reservas[0];
  const [h, m] = primera.hora.split(':').map(Number);
  const minutos = h * 60 + m - 15;
  const hh = Math.floor(minutos / 60);
  const mm = minutos % 60;
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}

// Cuantos extras se necesitan para un dia
function extrasNecesarios(fecha) {
  const reservas = db.prepare(
    "SELECT pax, tipo FROM reservas WHERE fecha = ? AND estado != 'cancelada'"
  ).all(fecha);

  // Separar comensales por tipo
  const paxEventos = reservas
    .filter(r => r.tipo === 'evento')
    .reduce((s, r) => s + (r.pax || 0), 0);

  const paxCarta = reservas
    .filter(r => r.tipo === 'carta')
    .reduce((s, r) => s + (r.pax || 0), 0);

  // Eventos: 1 extra por cada 12 comensales (sin minimo)
  const extrasEventos = paxEventos > 0 ? Math.ceil(paxEventos / 12) : 0;

  // Carta: 1 extra por cada 12 comensales, solo a partir de 24
  const extrasCarta = paxCarta >= 24 ? Math.ceil(paxCarta / 12) : 0;

  return extrasEventos + extrasCarta;
}

// Convocar automaticamente extras cuando se crea/actualiza una reserva
async function autoConvocar(fecha) {
  const necesarios = extrasNecesarios(fecha);
  if (necesarios === 0) return;

  const horaConv = calcHoraConvocatoria(fecha);
  const cfg = getConfig();

  // Cuantos confirmados hay ya
  const confirmados = db.prepare("SELECT COUNT(*) as n FROM extras_reservas WHERE fecha = ? AND estado = 'confirmado'").get(fecha);
  if (confirmados.n >= necesarios) return; // Ya hay suficientes

  // Cuantos convocados ya hay (para no volver a convocar los mismos)
  const yaConvocados = db.prepare("SELECT extra_id FROM extras_reservas WHERE fecha = ?").all(fecha).map(r => r.extra_id);

  // Cuantos mas necesitamos convocar (triple para asegurar respuestas)
  const faltanConvocar = (necesarios * 3) - yaConvocados.length;
  if (faltanConvocar <= 0) return;

  // Extras ordenados por puntuacion, penalizados al final, excluyendo ya convocados
  const placeholders = yaConvocados.length ? yaConvocados.map(() => '?').join(',') : '0';
  const extras = db.prepare(`
    SELECT * FROM extras WHERE activo = 1 AND id NOT IN (${placeholders})
    ORDER BY penalizado ASC, (actitud+capacidad+rigor+conocimientos+aspecto) DESC
    LIMIT ?
  `).all(...yaConvocados, faltanConvocar);

  for (const extra of extras) {
    const result = db.prepare(`
      INSERT INTO extras_reservas (extra_id, reserva_id, fecha, estado, hora_convocatoria)
      VALUES (?, null, ?, 'convocado', ?)
    `).run(extra.id, fecha, horaConv);

    const asignacion = db.prepare('SELECT * FROM extras_reservas WHERE id = ?').get(result.lastInsertRowid);

    if (extra.email && cfg.email_smtp && cfg.email_pass) {
      try {
        await enviarEmailExtra(extra, asignacion, 'convocatoria');
        db.prepare('UPDATE extras_reservas SET conv_env = 1 WHERE id = ?').run(asignacion.id);
      } catch (e) { console.error('Error email autoconvocatoria:', e.message); }
    }
  }
}

// ─── EMAIL CLIENTE ────────────────────────────────────────────────
async function enviarEmailCliente(r, tipo) {
  const cfg = getConfig();
  if (!cfg.email_smtp || !cfg.email_pass) return { ok: false, msg: 'SMTP no configurado' };
  if (!r.email) return { ok: false, msg: 'Sin email' };

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: cfg.email_smtp, pass: cfg.email_pass }
  });

  const salones = { bodega: 'Salon Bodega', cristalera: 'Salon Cristalera' };
  const menus = { sabor: 'Sabor de la Memoria', chef: 'Menu Chef', instinto: 'Menu Instinto', carta: 'A la carta' };
  const eventos = { boda: 'Boda', comunion: 'Comunion', familiar: 'Grupo familiar', turista: 'Grupo turista' };
  const esRec = tipo === 'recordatorio';
  const fecha = new Date(r.fecha + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

  let filas = `
    <tr><td style="color:#888;padding:5px 0;width:38%">Fecha</td><td style="padding:5px 0"><strong>${fecha}</strong></td></tr>
    <tr><td style="color:#888;padding:5px 0">Hora</td><td style="padding:5px 0"><strong>${r.hora}</strong></td></tr>
    <tr><td style="color:#888;padding:5px 0">Personas</td><td style="padding:5px 0"><strong>${r.pax}</strong></td></tr>
    <tr><td style="color:#888;padding:5px 0">Salon</td><td style="padding:5px 0"><strong>${salones[r.salon] || r.salon}</strong></td></tr>
  `;
  if (r.tipo === 'carta' && r.mesa) filas += `<tr><td style="color:#888;padding:5px 0">Mesa</td><td style="padding:5px 0"><strong>Mesa ${r.mesa}</strong></td></tr>`;
  if (r.tipo === 'carta' && r.menu) filas += `<tr><td style="color:#888;padding:5px 0">Menu</td><td style="padding:5px 0"><strong>${menus[r.menu] || ''}</strong></td></tr>`;
  if (r.tipo === 'evento') filas += `<tr><td style="color:#888;padding:5px 0">Evento</td><td style="padding:5px 0"><strong>${eventos[r.tipo_evento] || ''}</strong></td></tr>`;
  if (r.alergias) filas += `<tr><td style="color:#888;padding:5px 0">Alergias</td><td style="padding:5px 0;color:#791f1f"><strong>${r.alergias}</strong></td></tr>`;

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#f5f3ef;font-family:-apple-system,sans-serif">
<div style="max-width:520px;margin:0 auto">
  <div style="background:#b8965a;padding:24px;text-align:center;border-radius:8px 8px 0 0">
    <div style="font-family:Georgia,serif;font-size:24px;color:#fff;letter-spacing:3px">Don Fadrique</div>
    <div style="font-size:11px;color:#e8c8cc;margin-top:8px">Seleccionado Michelin 2026 · 1 Sol Repsol 2026 · Tierra de Sabor</div>
  </div>
  <div style="background:#fff;padding:24px;border:1px solid #ddd;border-top:none">
    <p style="font-size:15px">Estimado/a <strong>${r.nombre.split(' ')[0]}</strong>,</p>
    <p style="font-size:13px;color:#444;line-height:1.7">${esRec ? 'Le recordamos que <strong>mañana</strong> tiene una reserva.' : 'Confirmamos su reserva. Sera un placer recibirle.'}</p>
    <div style="background:#f9f9f7;border-radius:8px;padding:16px;margin:16px 0">
      <table style="width:100%;border-collapse:collapse;font-size:13px">${filas}</table>
    </div>
    <p style="font-size:13px;color:#444">Contacto: ${cfg.tel_rest} · ${cfg.email_rest}</p>
    <p style="font-size:13px;color:#666;font-style:italic">Gracias por elegirnos.</p>
    <p style="font-size:13px">Un cordial saludo,<br><strong>Restaurante Don Fadrique</strong></p>
  </div>
</div></body></html>`;

  await transporter.sendMail({
    from: `"Restaurante Don Fadrique" <${cfg.email_smtp}>`,
    to: r.email,
    subject: esRec ? 'Recordatorio de su reserva - Don Fadrique' : 'Confirmacion de reserva - Don Fadrique',
    html
  });
  return { ok: true };
}

// ─── EMAIL EXTRA ──────────────────────────────────────────────────

// Bloque de cabecera comun para emails de extras
function emailHeader(titulo, subtitulo, color) {
  color = color || '#b8965a';
  return `<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#f5f3ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:0 auto;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)">
  <div style="background:${color};padding:28px 24px;text-align:center">
    <div style="font-family:Georgia,serif;font-size:26px;color:#fff;letter-spacing:3px;margin-bottom:4px">Don Fadrique</div>
    <div style="font-size:11px;color:rgba(255,255,255,.75);letter-spacing:1px">RESTAURANTE · PALACIO CONDE DE ALDANA</div>
    ${titulo ? `<div style="margin-top:14px;font-size:17px;font-weight:700;color:#fff;letter-spacing:1px">${titulo}</div>` : ''}
    ${subtitulo ? `<div style="font-size:12px;color:rgba(255,255,255,.8);margin-top:4px">${subtitulo}</div>` : ''}
  </div>
  <div style="background:#fff;padding:28px 24px;border:1px solid #e0dcd6;border-top:none">`;
}

function emailFooter(cfg) {
  return `
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #f0ede8;text-align:center">
      <p style="font-size:11px;color:#aaa;margin:0">Restaurante Don Fadrique · Palacio Conde de Aldana</p>
      <p style="font-size:11px;color:#aaa;margin:4px 0">${cfg.tel_rest || ''} · ${cfg.email_rest || ''}</p>
    </div>
  </div>
</div></body></html>`;
}

async function enviarEmailExtra(extra, asignacion, tipo) {
  const cfg = getConfig();
  if (!cfg.email_smtp || !cfg.email_pass) return { ok: false, msg: 'SMTP no configurado' };
  if (!extra.email) return { ok: false, msg: 'Extra sin email' };

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: cfg.email_smtp, pass: cfg.email_pass }
  });

  const baseUrl = `http://reservas.palaciocondealdana.com`;
  const fechaStr = asignacion && asignacion.fecha
    ? new Date(asignacion.fecha + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  let html = '';

  // ── BIENVENIDA / OPERATIVA ─────────────────────────────────────
  if (tipo === 'bienvenida') {
    html = emailHeader('Bienvenido/a al equipo', 'Carta de incorporacion y normas de servicio', '#1a1a2e') + `
    <p style="font-size:15px;margin-bottom:6px">Estimado/a <strong>${extra.nombre} ${extra.apellidos || ''}</strong>,</p>
    <p style="font-size:13px;color:#444;line-height:1.8">Es un placer contar contigo como personal de refuerzo en el <strong>Restaurante Don Fadrique</strong>. Queremos que conozcas nuestra forma de trabajar para que tu incorporacion sea lo mas satisfactoria posible para ti y para el equipo.</p>

    <div style="background:#f9f9f7;border-left:4px solid #b8965a;border-radius:0 8px 8px 0;padding:16px 20px;margin:20px 0">
      <p style="font-size:13px;font-weight:700;color:#b8965a;margin:0 0 10px 0;text-transform:uppercase;letter-spacing:1px">&#9733; Criterios de seleccion</p>
      <p style="font-size:13px;color:#444;line-height:1.8;margin:0">Los servicios se asignan atendiendo a criterios objetivos de valoracion: <strong>actitud</strong>, <strong>capacidad de trabajo</strong>, <strong>respeto por los horarios</strong>, <strong>relacion con los compañeros</strong> y <strong>buen hacer en los servicios</strong>. Todos teneis las mismas oportunidades, y vuestra trayectoria es lo que determina vuestra posicion en la lista de convocatoria.</p>
    </div>

    <div style="background:#f9f9f7;border-left:4px solid #b8965a;border-radius:0 8px 8px 0;padding:16px 20px;margin:20px 0">
      <p style="font-size:13px;font-weight:700;color:#b8965a;margin:0 0 10px 0;text-transform:uppercase;letter-spacing:1px">&#128203; Como funciona el sistema</p>
      <p style="font-size:13px;color:#444;line-height:1.8;margin:0">Cuando haya un servicio que requiera personal de refuerzo, recibireis un email de convocatoria con la fecha y hora de presentacion. <strong>El primero en confirmar asegura su plaza.</strong> Una vez confirmado, sois responsables de asistir o de encontrar un sustituto si surgiese algun imprevisto. Si rechazais tres servicios consecutivos sin causa justificada, pasareis temporalmente al final de la lista de convocatoria.</p>
    </div>

    <div style="background:#fff3cd;border-left:4px solid #856404;border-radius:0 8px 8px 0;padding:16px 20px;margin:20px 0">
      <p style="font-size:13px;font-weight:700;color:#856404;margin:0 0 10px 0;text-transform:uppercase;letter-spacing:1px">&#9888; Normas durante el servicio</p>
      <ul style="font-size:13px;color:#444;line-height:2;margin:0;padding-left:18px">
        <li><strong>Movil:</strong> queda totalmente prohibido el uso del telefono movil durante el servicio.</li>
        <li><strong>Tabaco:</strong> no esta permitido fumar en ningun momento mientras se este de servicio.</li>
        <li><strong>Alcohol:</strong> esta absolutamente prohibido consumir alcohol durante la prestacion del servicio.</li>
        <li><strong>Puntualidad:</strong> la hora de presentacion indicada en la convocatoria es la hora maxima de llegada, no la de salida del domicilio.</li>
        <li><strong>Imagen:</strong> se exige uniformidad correcta y cuidado personal acorde con la imagen del restaurante.</li>
      </ul>
    </div>

    <div style="background:#fce4e4;border-left:4px solid #842029;border-radius:0 8px 8px 0;padding:16px 20px;margin:20px 0">
      <p style="font-size:13px;font-weight:700;color:#842029;margin:0 0 8px 0;text-transform:uppercase;letter-spacing:1px">&#9888;&#65039; Aviso importante sobre seguridad</p>
      <p style="font-size:13px;color:#5a0000;line-height:1.8;margin:0"><strong>Desde el año 2026, cualquier hurto o robo detectado en el establecimiento, independientemente de su cuantia, sera denunciado de inmediato ante la Guardia Civil.</strong> El restaurante cuenta con sistemas de seguridad activos. Esta medida aplica a todo el personal, sin excepcion.</p>
    </div>

    <p style="font-size:13px;color:#444;line-height:1.8">Si tienes cualquier duda, no dudes en ponerte en contacto con nosotros. Estamos seguros de que tu incorporacion sera una experiencia positiva para todos.</p>
    <p style="font-size:13px;color:#444">Un cordial saludo,<br><strong>Direccion · Restaurante Don Fadrique</strong></p>
    ${emailFooter(cfg)}`;
  }

  // ── CONVOCATORIA ───────────────────────────────────────────────
  if (tipo === 'convocatoria') {
    html = emailHeader('Convocatoria de servicio', fechaStr, '#b8965a') + `
    <p style="font-size:15px;margin-bottom:6px">Hola <strong>${extra.nombre}</strong>,</p>
    <p style="font-size:13px;color:#444;line-height:1.8">Necesitamos personal de refuerzo para el siguiente servicio y contamos contigo. Por favor, confirma tu disponibilidad lo antes posible.</p>

    <div style="background:#f9f9f7;border-radius:8px;padding:16px 20px;margin:20px 0;border:1px solid #e8e0d6">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr><td style="color:#888;padding:6px 0;width:42%">Fecha del servicio</td><td style="padding:6px 0"><strong>${fechaStr}</strong></td></tr>
        <tr style="border-top:1px solid #f0ede8"><td style="color:#888;padding:6px 0">Hora de presentacion</td><td style="padding:6px 0"><strong>${asignacion.hora_convocatoria || '---'}</strong></td></tr>
        <tr style="border-top:1px solid #f0ede8"><td style="color:#888;padding:6px 0">Lugar</td><td style="padding:6px 0"><strong>Restaurante Don Fadrique · Palacio Conde de Aldana</strong></td></tr>
      </table>
    </div>

    <p style="font-size:13px;color:#444;font-weight:600;text-align:center;margin:20px 0 8px 0">&#128071; Indica tu disponibilidad pulsando uno de los botones:</p>
    <div style="text-align:center;margin:16px 0">
      <a href="${baseUrl}/api/extras/respuesta/${asignacion.id}/si" style="display:inline-block;background:#0f5132;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;margin-right:12px;letter-spacing:.5px">&#10003;&nbsp; SI, PUEDO IR</a>
      <a href="${baseUrl}/api/extras/respuesta/${asignacion.id}/no" style="display:inline-block;background:#842029;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:.5px">&#10007;&nbsp; NO PUEDO IR</a>
    </div>

    <div style="background:#fff8e1;border-radius:8px;padding:12px 16px;margin-top:20px;border:1px solid #ffe082">
      <p style="font-size:12px;color:#555;margin:0;line-height:1.7"><strong>Recuerda:</strong> el primero en confirmar asegura su plaza. Una vez confirmado, eres responsable de asistir o de gestionar tu sustitucion con antelacion suficiente.</p>
    </div>
    ${emailFooter(cfg)}`;
  }

  // ── CONFIRMACION ───────────────────────────────────────────────
  if (tipo === 'confirmacion') {
    const eventoFechaDate = new Date(asignacion.fecha + 'T12:00:00');
    const hoyNow = new Date();
    const diasParaEvento = Math.round((eventoFechaDate - hoyNow) / (1000*60*60*24));
    const puedeAnular = diasParaEvento >= 7;
    const cancelUrl = `${baseUrl}/api/extras/respuesta/${asignacion.id}/no`;

    html = emailHeader('Plaza Confirmada', 'Tu servicio esta reservado', '#0f5132') + `
    <p style="font-size:15px;margin-bottom:6px">Hola <strong>${extra.nombre}</strong>,</p>
    <p style="font-size:13px;color:#444;line-height:1.8">Tu plaza esta <strong>confirmada</strong> para el siguiente servicio. Apunta los datos:</p>

    <div style="background:#f0f7f3;border-radius:8px;padding:16px 20px;margin:20px 0;border:1px solid #a8d5bc">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr><td style="color:#555;padding:6px 0;width:42%">Fecha</td><td style="padding:6px 0"><strong>${fechaStr}</strong></td></tr>
        <tr style="border-top:1px solid #d0eada"><td style="color:#555;padding:6px 0">Hora de presentacion</td><td style="padding:6px 0"><strong>${asignacion.hora_convocatoria || '---'}</strong></td></tr>
        <tr style="border-top:1px solid #d0eada"><td style="color:#555;padding:6px 0">Lugar</td><td style="padding:6px 0"><strong>Restaurante Don Fadrique · Palacio Conde de Aldana</strong></td></tr>
      </table>
    </div>

    <div style="background:#fff3cd;border-radius:8px;padding:12px 16px;margin:16px 0;border:1px solid #ffe082">
      <p style="font-size:12px;color:#555;margin:0;line-height:1.7"><strong>Recuerda durante el servicio:</strong> prohibido el uso del movil, fumar y consumir alcohol. Puntualidad obligatoria en la hora de presentacion.</p>
    </div>

    <p style="font-size:13px;color:#842029;font-weight:600">En caso de no poder asistir, es tu responsabilidad encontrar un companero que te cubra y comunicarlo al restaurante con la maxima antelacion posible.</p>

    ${puedeAnular
      ? `<div style="text-align:center;margin:20px 0"><a href="${cancelUrl}" style="display:inline-block;background:#842029;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">Cancelar mi plaza</a><p style="font-size:11px;color:#888;margin-top:6px">Puedes cancelar hasta 7 dias antes del servicio</p></div>`
      : `<p style="font-size:12px;color:#888;text-align:center">Han pasado los 7 dias para cancelar libremente. Si no puedes asistir, debes gestionar tu sustitucion directamente.</p>`
    }
    ${emailFooter(cfg)}`;
  }

  // ── LISTA DE ESPERA ────────────────────────────────────────────
  if (tipo === 'espera') {
    html = emailHeader('Lista de Espera', 'El equipo esta completo por ahora', '#856404') + `
    <p style="font-size:15px;margin-bottom:6px">Hola <strong>${extra.nombre}</strong>,</p>
    <p style="font-size:13px;color:#444;line-height:1.8">Gracias por confirmar tu disponibilidad para el servicio del <strong>${fechaStr}</strong>. El equipo ya esta completo en este momento, por lo que quedas en <strong>lista de espera</strong>.</p>
    <p style="font-size:13px;color:#444;line-height:1.8">Si se produce alguna baja, seremos en contacto contigo de inmediato. Tu disponibilidad queda registrada y la tenemos en cuenta.</p>
    <p style="font-size:13px;color:#444">Muchas gracias por tu colaboracion.</p>
    ${emailFooter(cfg)}`;
  }

  // ── RECORDATORIO ───────────────────────────────────────────────
  if (tipo === 'recordatorio') {
    html = emailHeader('Recordatorio de Servicio', 'Hoy tienes servicio en Don Fadrique', '#b8965a') + `
    <p style="font-size:15px;margin-bottom:6px">Hola <strong>${extra.nombre}</strong>,</p>
    <p style="font-size:13px;color:#444;line-height:1.8">Te recordamos que <strong>hoy</strong> tienes servicio en el Restaurante Don Fadrique.</p>

    <div style="background:#f9f9f7;border-radius:8px;padding:16px 20px;margin:20px 0;border:1px solid #e8e0d6">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr><td style="color:#888;padding:6px 0;width:42%">Hora de presentacion</td><td style="padding:6px 0"><strong style="font-size:16px">${asignacion.hora_convocatoria || '---'}</strong></td></tr>
        <tr style="border-top:1px solid #f0ede8"><td style="color:#888;padding:6px 0">Lugar</td><td style="padding:6px 0"><strong>Restaurante Don Fadrique · Palacio Conde de Aldana</strong></td></tr>
      </table>
    </div>

    <div style="background:#fff3cd;border-radius:8px;padding:12px 16px;margin:16px 0;border:1px solid #ffe082">
      <p style="font-size:12px;color:#555;margin:0;line-height:1.7"><strong>Recuerda:</strong> prohibido el uso del movil, fumar y consumir alcohol durante el servicio. La puntualidad es obligatoria.</p>
    </div>

    <p style="font-size:13px;color:#842029;font-weight:600">Si por algun imprevisto no puedes asistir, comunica lo antes posible al restaurante y busca un companero que te cubra.</p>
    <p style="font-size:13px;color:#444">Contacto: ${cfg.tel_rest}</p>
    ${emailFooter(cfg)}`;
  }

  // ── NO HAY PLAZA (desplazado por asignacion manual) ────────────
  if (tipo === 'no_hay_plaza') {
    html = emailHeader('Servicio Completo', null, '#5a5a5a') + `
    <p style="font-size:15px;margin-bottom:6px">Hola <strong>${extra.nombre}</strong>,</p>
    <p style="font-size:13px;color:#444;line-height:1.8">Sintiendolo mucho, te informamos de que el servicio del <strong>${fechaStr}</strong> no puede admitir mas personal. El equipo ya esta completo y no hay posibilidad de incorporar a nadie mas.</p>
    <p style="font-size:13px;color:#444;line-height:1.8">Queremos agradecerte sinceramente tu disponibilidad y la rapidez con la que has respondido. Tu actitud es exactamente la que valoramos y tenemos en cuenta para futuros servicios.</p>
    <p style="font-size:13px;color:#444">Esperamos contar contigo muy pronto.<br><br>Un cordial saludo,<br><strong>Direccion · Restaurante Don Fadrique</strong></p>
    ${emailFooter(cfg)}`;
  }

  if (!html) return { ok: false, msg: 'Tipo desconocido' };

  const asuntos = {
    bienvenida:   'Bienvenido/a al equipo - Don Fadrique',
    convocatoria: 'Convocatoria de servicio - Don Fadrique',
    confirmacion: 'Plaza confirmada - Don Fadrique',
    espera:       'Lista de espera - Don Fadrique',
    recordatorio: 'Recordatorio de servicio hoy - Don Fadrique',
    no_hay_plaza: 'Servicio completo - Don Fadrique'
  };

  await transporter.sendMail({
    from: `"Restaurante Don Fadrique" <${cfg.email_smtp}>`,
    to: extra.email,
    subject: asuntos[tipo] || 'Don Fadrique',
    html
  });
  return { ok: true };
}

// ─── API RESERVAS ─────────────────────────────────────────────────
app.get('/api/reservas', (req, res) => {
  const { fecha } = req.query;
  let rows;
  if (fecha) {
    rows = db.prepare('SELECT * FROM reservas WHERE fecha = ? ORDER BY hora').all(fecha);
  } else {
    rows = db.prepare('SELECT * FROM reservas ORDER BY fecha, hora').all();
  }
  res.json(rows.map(rowToObj));
});

app.post('/api/reservas', (req, res) => {
  const d = req.body;
  const stmt = db.prepare(`
    INSERT INTO reservas (tipo,salon,mesa,fecha,hora,nombre,tel,email,pax,menu,alergias,obs,estado,
      tipo_evento,montaje,protocolo,coctel,coctel_det,entrantes,pescado,sorbete,carne,postre,
      vino_blanco,vino_tinto,vino_cava,vino_extra,copas,fianza,fianza_imp,conf_env,rec_env,menus_detalle)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const result = stmt.run(
    d.tipo, d.salon, d.mesa||null, d.fecha, d.hora, d.nombre, d.tel||'', d.email||'', d.pax,
    d.menu||'', d.alergias||'', d.obs||'', d.estado||'pendiente',
    d.tipo_evento||'', d.montaje||'imperial', parseBool(d.protocolo),
    parseBool(d.coctel), d.coctel_det||'', d.entrantes||'', d.pescado||'',
    parseBool(d.sorbete), d.carne||'', d.postre||'',
    d.vino_blanco||'', d.vino_tinto||'', d.vino_cava||'',
    d.vino_extra||'', parseBool(d.copas),
    parseBool(d.fianza), d.fianza_imp||null, 0, 0,
    d.menus_detalle||null
  );
  const nueva = rowToObj(db.prepare('SELECT * FROM reservas WHERE id = ?').get(result.lastInsertRowid));

  if (nueva.email) {
    enviarEmailCliente(nueva, 'confirmacion').then(r2 => {
      if (r2.ok) {
        db.prepare('UPDATE reservas SET conf_env = 1 WHERE id = ?').run(nueva.id);
        nueva.conf_env = true;
      }
    }).catch(() => {});
  }

  // Autoconvocar extras si se necesitan
  autoConvocar(nueva.fecha).catch(e => console.error('autoConvocar error:', e.message));

  res.json(nueva);
});

app.put('/api/reservas/:id', (req, res) => {
  const d = req.body;
  db.prepare(`
    UPDATE reservas SET tipo=?,salon=?,mesa=?,fecha=?,hora=?,nombre=?,tel=?,email=?,pax=?,menu=?,
    alergias=?,obs=?,estado=?,tipo_evento=?,montaje=?,protocolo=?,coctel=?,coctel_det=?,
    entrantes=?,pescado=?,sorbete=?,carne=?,postre=?,vino_blanco=?,vino_tinto=?,vino_cava=?,
    vino_extra=?,copas=?,fianza=?,fianza_imp=?,menus_detalle=? WHERE id=?
  `).run(
    d.tipo, d.salon, d.mesa||null, d.fecha, d.hora, d.nombre, d.tel||'', d.email||'', d.pax,
    d.menu||'', d.alergias||'', d.obs||'', d.estado||'pendiente',
    d.tipo_evento||'', d.montaje||'imperial', parseBool(d.protocolo),
    parseBool(d.coctel), d.coctel_det||'', d.entrantes||'', d.pescado||'',
    parseBool(d.sorbete), d.carne||'', d.postre||'',
    d.vino_blanco||'', d.vino_tinto||'', d.vino_cava||'',
    d.vino_extra||'', parseBool(d.copas),
    parseBool(d.fianza), d.fianza_imp||null, d.menus_detalle||null,
    req.params.id
  );
  const actualizada = rowToObj(db.prepare('SELECT * FROM reservas WHERE id = ?').get(req.params.id));

  // Autoconvocar extras si se necesitan (por si cambio el pax o la fecha)
  autoConvocar(actualizada.fecha).catch(e => console.error('autoConvocar error:', e.message));

  res.json(actualizada);
});

app.delete('/api/reservas/:id', (req, res) => {
  db.prepare('DELETE FROM reservas WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM extras_reservas WHERE reserva_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── API EMAIL CLIENTE ────────────────────────────────────────────
app.post('/api/email/:id/:tipo', async (req, res) => {
  const r = rowToObj(db.prepare('SELECT * FROM reservas WHERE id = ?').get(req.params.id));
  if (!r) return res.json({ ok: false, msg: 'Reserva no encontrada' });
  const result = await enviarEmailCliente(r, req.params.tipo);
  if (result.ok) {
    const campo = req.params.tipo === 'confirmacion' ? 'conf_env' : 'rec_env';
    db.prepare(`UPDATE reservas SET ${campo} = 1 WHERE id = ?`).run(r.id);
  }
  res.json(result);
});

// ─── API EXTRAS ───────────────────────────────────────────────────
app.get('/api/extras', (req, res) => {
  const extras = db.prepare('SELECT * FROM extras WHERE activo = 1 ORDER BY (actitud+capacidad+rigor+conocimientos+aspecto) DESC').all();
  res.json(extras.map(e => ({ ...e, puntuacion: puntuacionExtra(e) })));
});

app.post('/api/extras', async (req, res) => {
  const d = req.body;
  const result = db.prepare(`
    INSERT INTO extras (nombre,apellidos,dni,tel,email,actitud,capacidad,rigor,conocimientos,aspecto)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    d.nombre, d.apellidos, d.dni||'', d.tel||'', d.email||'',
    d.actitud||3, d.capacidad||3, d.rigor||3, d.conocimientos||3, d.aspecto||3
  );
  const extra = db.prepare('SELECT * FROM extras WHERE id = ?').get(result.lastInsertRowid);

  // Enviar email de bienvenida con operativa
  if (extra.email) {
    enviarEmailExtra(extra, { fecha: new Date().toISOString().slice(0,10) }, 'bienvenida').catch(e => console.error('Error email bienvenida:', e.message));
  }

  res.json({ ...extra, puntuacion: puntuacionExtra(extra) });
});

app.put('/api/extras/:id', (req, res) => {
  const d = req.body;
  db.prepare(`
    UPDATE extras SET nombre=?,apellidos=?,dni=?,tel=?,email=?,
    actitud=?,capacidad=?,rigor=?,conocimientos=?,aspecto=?,activo=?
    WHERE id=?
  `).run(
    d.nombre, d.apellidos, d.dni||'', d.tel||'', d.email||'',
    d.actitud, d.capacidad, d.rigor, d.conocimientos, d.aspecto,
    d.activo !== undefined ? d.activo : 1,
    req.params.id
  );
  const extra = db.prepare('SELECT * FROM extras WHERE id = ?').get(req.params.id);
  res.json({ ...extra, puntuacion: puntuacionExtra(extra) });
});

app.delete('/api/extras/:id', (req, res) => {
  db.prepare('UPDATE extras SET activo = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Reenviar email de bienvenida/operativa a un extra
app.post('/api/extras/:id/bienvenida', async (req, res) => {
  const extra = db.prepare('SELECT * FROM extras WHERE id = ?').get(req.params.id);
  if (!extra) return res.json({ ok: false, msg: 'Extra no encontrado' });
  const result = await enviarEmailExtra(extra, { fecha: new Date().toISOString().slice(0,10) }, 'bienvenida').catch(e => ({ ok: false, msg: e.message }));
  res.json(result);
});

// Stats extras - veces que ha dicho si/no
app.get('/api/extras/:id/stats', (req, res) => {
  const asignaciones = db.prepare('SELECT * FROM extras_reservas WHERE extra_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(asignaciones);
});

// ─── CONVOCATORIA EXTRAS ──────────────────────────────────────────
// Convocar extras para un dia
app.post('/api/extras/convocar/:fecha', async (req, res) => {
  const fecha = req.params.fecha;
  const necesarios = extrasNecesarios(fecha);
  if (necesarios === 0) return res.json({ ok: false, msg: 'No se necesitan extras para este dia (menos de 20 personas)' });

  const horaConv = calcHoraConvocatoria(fecha);

  // Extras a convocar: el doble de los necesarios (para asegurar respuestas)
  // Ordenados por puntuacion, penalizados al final
  const extras = db.prepare(`
    SELECT * FROM extras WHERE activo = 1
    ORDER BY penalizado ASC,
    (actitud+capacidad+rigor+conocimientos+aspecto) DESC
    LIMIT ?
  `).all(necesarios * 3);

  const cfg = getConfig();
  let enviados = 0;

  for (const extra of extras) {
    // Verificar que no tenga ya una asignacion para este dia
    const yaAsignado = db.prepare('SELECT id FROM extras_reservas WHERE extra_id = ? AND fecha = ?').get(extra.id, fecha);
    if (yaAsignado) continue;

    const result = db.prepare(`
      INSERT INTO extras_reservas (extra_id, reserva_id, fecha, estado, hora_convocatoria)
      VALUES (?, null, ?, 'convocado', ?)
    `).run(extra.id, fecha, horaConv);

    const asignacion = db.prepare('SELECT * FROM extras_reservas WHERE id = ?').get(result.lastInsertRowid);

    if (extra.email && cfg.email_smtp && cfg.email_pass) {
      try {
        await enviarEmailExtra(extra, asignacion, 'convocatoria');
        db.prepare('UPDATE extras_reservas SET conv_env = 1 WHERE id = ?').run(asignacion.id);
        enviados++;
      } catch (e) { console.error('Error email extra:', e.message); }
    }
  }

  res.json({ ok: true, necesarios, convocados: extras.length, emails_enviados: enviados, hora: horaConv });
});

// Ver asignaciones de extras para un dia
app.get('/api/extras/dia/:fecha', (req, res) => {
  const asignaciones = db.prepare(`
    SELECT er.*, e.nombre, e.apellidos, e.email, e.tel,
    (e.actitud+e.capacidad+e.rigor+e.conocimientos+e.aspecto)/5.0 as puntuacion
    FROM extras_reservas er
    JOIN extras e ON e.id = er.extra_id
    WHERE er.fecha = ?
    ORDER BY er.estado, puntuacion DESC
  `).all(req.params.fecha);
  res.json(asignaciones);
});

// Respuesta del extra (SI o NO) via link en email
app.get('/api/extras/respuesta/:asignacion_id/:respuesta', async (req, res) => {
  const { asignacion_id, respuesta } = req.params;
  const asig = db.prepare('SELECT * FROM extras_reservas WHERE id = ?').get(asignacion_id);

  if (!asig) return res.send('<h2>Enlace no valido</h2>');
  if (asig.estado === 'confirmado' || asig.estado === 'rechazado') {
    return res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>Ya has respondido a esta convocatoria</h2>
      <p>Estado: ${asig.estado}</p>
    </body></html>`);
  }

  const extra = db.prepare('SELECT * FROM extras WHERE id = ?').get(asig.extra_id);
  const cfg = getConfig();
  const necesarios = extrasNecesarios(asig.fecha);

  if (respuesta === 'si') {
    // Cuantos confirmados hay ya
    const confirmados = db.prepare("SELECT COUNT(*) as n FROM extras_reservas WHERE fecha = ? AND estado = 'confirmado'").get(asig.fecha);

    if (confirmados.n < necesarios) {
      // Hay plaza
      db.prepare("UPDATE extras_reservas SET estado = 'confirmado' WHERE id = ?").run(asignacion_id);
      db.prepare('UPDATE extras SET veces_si = veces_si + 1, rechazos_seguidos = 0, aceptaciones_seguidas = aceptaciones_seguidas + 1 WHERE id = ?').run(extra.id);
      // Si lleva 3 aceptaciones seguidas, quitar penalizacion
      const e2 = db.prepare('SELECT * FROM extras WHERE id = ?').get(extra.id);
      if (e2.aceptaciones_seguidas >= 3 && e2.penalizado) {
        db.prepare('UPDATE extras SET penalizado = 0 WHERE id = ?').run(extra.id);
      }
      await enviarEmailExtra(extra, asig, 'confirmacion').catch(() => {});
      res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#f0ede8">
        <div style="background:#0f5132;color:#fff;padding:20px;border-radius:12px;display:inline-block;margin-bottom:20px">
          <h1 style="margin:0">&#10003; Plaza confirmada</h1>
        </div>
        <p style="font-size:16px">Perfecto <strong>${extra.nombre}</strong>, tu plaza esta confirmada.</p>
        <p>Hora de presentacion: <strong>${asig.hora_convocatoria || '---'}</strong></p>
        <p style="color:#842029">Recuerda: en caso de no poder asistir, es tu responsabilidad buscar un companero que te cubra.</p>
        <p>Contacto: ${cfg.tel_rest}</p>
      </body></html>`);

      // Avisar a los que estaban en espera si hay manual asignado
      const enEspera = db.prepare("SELECT er.*, e.nombre, e.email FROM extras_reservas er JOIN extras e ON e.id = er.extra_id WHERE er.fecha = ? AND er.estado = 'en_espera'").all(asig.fecha);
      for (const esp of enEspera) {
        await enviarEmailExtra({ nombre: esp.nombre, email: esp.email }, { ...esp, hora_convocatoria: asig.hora_convocatoria }, 'espera').catch(() => {});
      }

    } else {
      // No hay plaza - lista de espera
      db.prepare("UPDATE extras_reservas SET estado = 'en_espera' WHERE id = ?").run(asignacion_id);
      db.prepare('UPDATE extras SET veces_si = veces_si + 1 WHERE id = ?').run(extra.id);
      res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#f0ede8">
        <div style="background:#856404;color:#fff;padding:20px;border-radius:12px;display:inline-block;margin-bottom:20px">
          <h1 style="margin:0">Lista de espera</h1>
        </div>
        <p style="font-size:16px">Hola <strong>${extra.nombre}</strong>, gracias por tu disponibilidad.</p>
        <p>El equipo ya esta completo pero quedas en lista de espera por si hay alguna baja. Te avisaremos.</p>
      </body></html>`);
    }

  } else {
    // NO / CANCELACION
    const hoyDate = new Date();
    const eventoDate = new Date(asig.fecha + 'T12:00:00');
    const diasRestantes = Math.round((eventoDate - hoyDate) / (1000*60*60*24));
    const esCancelacionTardia = asig.estado === 'confirmado' && diasRestantes < 7;
    
    const nuevoEstado = esCancelacionTardia ? 'cancelado_tardio' : 'rechazado';
    db.prepare("UPDATE extras_reservas SET estado = ? WHERE id = ?").run(nuevoEstado, asignacion_id);
    db.prepare('UPDATE extras SET veces_no = veces_no + 1, rechazos_seguidos = rechazos_seguidos + 1, aceptaciones_seguidas = 0 WHERE id = ?').run(extra.id);
    const e2 = db.prepare('SELECT * FROM extras WHERE id = ?').get(extra.id);
    if (e2.rechazos_seguidos >= 3 && !e2.penalizado) {
      db.prepare('UPDATE extras SET penalizado = 1 WHERE id = ?').run(extra.id);
    }

    if (esCancelacionTardia) {
      // Guardar aviso para el restaurante
      db.prepare("INSERT OR IGNORE INTO config (clave, valor) VALUES ('avisos_cancelacion', '[]')").run();
      const avisos = JSON.parse(db.prepare("SELECT valor FROM config WHERE clave = 'avisos_cancelacion'").get()?.valor || '[]');
      avisos.push({
        extra: extra.nombre + ' ' + extra.apellidos,
        fecha: asig.fecha,
        hora_conv: asig.hora_convocatoria,
        ts: new Date().toISOString(),
        id: asignacion_id
      });
      db.prepare("UPDATE config SET valor = ? WHERE clave = 'avisos_cancelacion'").run(JSON.stringify(avisos));

      res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#f0ede8">
        <div style="background:#842029;color:#fff;padding:20px;border-radius:12px;display:inline-block;margin-bottom:20px">
          <h1 style="margin:0">Cancelacion registrada</h1>
        </div>
        <p style="font-size:16px">Hola <strong>${extra.nombre}</strong>,</p>
        <p>Tu cancelacion ha sido registrada para el servicio del ${new Date(asig.fecha+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'})}.</p>
        <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px;margin:20px auto;max-width:400px;text-align:left">
          <p style="font-weight:600;color:#856404">⚠️ IMPORTANTE</p>
          <p>Como faltan menos de 7 días para el servicio, es tu responsabilidad encontrar un compañero que te cubra. Una vez lo hayas acordado con él, comunícalo al restaurante.</p>
          <p style="margin-top:10px"><strong>Contacto restaurante: ${cfg.tel_rest}</strong></p>
        </div>
      </body></html>`);
    } else {
      res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#f0ede8">
        <div style="background:#842029;color:#fff;padding:20px;border-radius:12px;display:inline-block;margin-bottom:20px">
          <h1 style="margin:0">Entendido</h1>
        </div>
        <p style="font-size:16px">Hola <strong>${extra.nombre}</strong>, queda registrado que no puedes asistir.</p>
        <p>Gracias por avisarnos.</p>
      </body></html>`);
    }
  }
});

// Asignar extra manualmente a un dia
app.post('/api/extras/asignar', async (req, res) => {
  const { extra_id, fecha, reserva_id } = req.body;
  const extra = db.prepare('SELECT * FROM extras WHERE id = ?').get(extra_id);
  if (!extra) return res.json({ ok: false, msg: 'Extra no encontrado' });

  const horaConv = calcHoraConvocatoria(fecha) || req.body.hora_convocatoria;
  const necesarios = extrasNecesarios(fecha);
  const cfg = getConfig();

  // Si ya tiene asignacion, actualizarla
  const yaAsig = db.prepare('SELECT * FROM extras_reservas WHERE extra_id = ? AND fecha = ?').get(extra_id, fecha);
  let asigId;

  if (yaAsig) {
    db.prepare("UPDATE extras_reservas SET estado = 'confirmado', manual = 1, hora_convocatoria = ? WHERE id = ?")
      .run(horaConv, yaAsig.id);
    asigId = yaAsig.id;
  } else {
    const result = db.prepare(`
      INSERT INTO extras_reservas (extra_id, reserva_id, fecha, estado, manual, hora_convocatoria)
      VALUES (?, ?, ?, 'confirmado', 1, ?)
    `).run(extra_id, reserva_id||null, fecha, horaConv);
    asigId = result.lastInsertRowid;
  }

  const asig = db.prepare('SELECT * FROM extras_reservas WHERE id = ?').get(asigId);

  // Enviar confirmacion al extra manual
  if (extra.email) {
    await enviarEmailExtra(extra, asig, 'confirmacion').catch(() => {});
  }

  // Ver cuantos confirmados hay ahora
  const totalConfirmados = db.prepare("SELECT COUNT(*) as n FROM extras_reservas WHERE fecha = ? AND estado = 'confirmado'").get(fecha).n;

  // Si hay mas confirmados de los necesarios, desplazar al ultimo confirmado NO manual
  if (necesarios > 0 && totalConfirmados > necesarios) {
    // Buscar el ultimo confirmado no-manual (el de menor puntuacion, no manual)
    const ultimo = db.prepare(`
      SELECT er.*, e.nombre, e.email,
      (e.actitud+e.capacidad+e.rigor+e.conocimientos+e.aspecto) as pts
      FROM extras_reservas er
      JOIN extras e ON e.id = er.extra_id
      WHERE er.fecha = ? AND er.estado = 'confirmado' AND (er.manual = 0 OR er.manual IS NULL) AND er.id != ?
      ORDER BY pts ASC, er.created_at DESC
      LIMIT 1
    `).get(fecha, asigId);

    if (ultimo) {
      // Quitarlo y mandarle mail de no_hay_plaza
      db.prepare("UPDATE extras_reservas SET estado = 'no_hay_plaza' WHERE id = ?").run(ultimo.id);
      if (ultimo.email) {
        await enviarEmailExtra(
          { nombre: ultimo.nombre, email: ultimo.email },
          { ...ultimo, hora_convocatoria: horaConv },
          'no_hay_plaza'
        ).catch(() => {});
      }
    }
  }

  // Avisar a los que estaban en espera
  const enEspera = db.prepare(`
    SELECT er.*, e.nombre, e.email FROM extras_reservas er 
    JOIN extras e ON e.id = er.extra_id 
    WHERE er.fecha = ? AND er.estado = 'en_espera' AND er.extra_id != ?
  `).all(fecha, extra_id);

  for (const esp of enEspera) {
    await enviarEmailExtra({ nombre: esp.nombre, email: esp.email }, { ...esp, hora_convocatoria: horaConv }, 'espera').catch(() => {});
  }

  res.json({ ok: true, asignacion: asig });
});

// Quitar extra de un dia
app.delete('/api/extras/asignar/:id', (req, res) => {
  db.prepare('DELETE FROM extras_reservas WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Enviar recordatorio a extras confirmados del dia actual
app.post('/api/extras/recordatorio/:fecha', async (req, res) => {
  const confirmados = db.prepare(`
    SELECT er.*, e.nombre, e.email FROM extras_reservas er
    JOIN extras e ON e.id = er.extra_id
    WHERE er.fecha = ? AND er.estado = 'confirmado' AND er.rec_env = 0 AND e.email != ''
  `).all(req.params.fecha);

  let enviados = 0;
  for (const c of confirmados) {
    try {
      await enviarEmailExtra({ nombre: c.nombre, email: c.email }, c, 'recordatorio');
      db.prepare('UPDATE extras_reservas SET rec_env = 1 WHERE id = ?').run(c.id);
      enviados++;
    } catch (e) { console.error(e.message); }
  }
  res.json({ ok: true, enviados });
});

// ─── API CONFIG ───────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  const cfg = getConfig();
  const safe = { ...cfg };
  if (safe.email_pass) safe.email_pass = '••••••••';
  res.json(safe);
});

app.post('/api/config', (req, res) => {
  const allowed = ['email_rest', 'tel_rest', 'dir_rest', 'email_smtp', 'recordatorios'];
  Object.entries(req.body).forEach(([k, v]) => {
    if (allowed.includes(k)) {
      db.prepare('INSERT OR REPLACE INTO config (clave, valor) VALUES (?, ?)').run(k, v);
    }
  });
  if (req.body.email_pass && req.body.email_pass !== '••••••••') {
    db.prepare('INSERT OR REPLACE INTO config (clave, valor) VALUES (?, ?)').run('email_pass', req.body.email_pass);
  }
  res.json({ ok: true });
});

// ─── RECORDATORIOS CLIENTES ───────────────────────────────────────
function programarRecordatorios() {
  const ahora = new Date();
  const hoy19 = new Date(ahora);
  hoy19.setHours(19, 0, 0, 0);
  if (ahora > hoy19) hoy19.setDate(hoy19.getDate() + 1);
  const msHasta19 = hoy19 - ahora;

  setTimeout(async function tick() {
    const cfg = getConfig();
    if (cfg.recordatorios === '1' && cfg.email_smtp && cfg.email_pass) {
      const manana = new Date();
      manana.setDate(manana.getDate() + 1);
      const fechaManana = manana.toISOString().slice(0, 10);
      const rows = db.prepare(
        "SELECT * FROM reservas WHERE fecha = ? AND rec_env = 0 AND estado != 'cancelada' AND email != ''"
      ).all(fechaManana);
      for (const row of rows) {
        const r = rowToObj(row);
        const result = await enviarEmailCliente(r, 'recordatorio');
        if (result.ok) db.prepare('UPDATE reservas SET rec_env = 1 WHERE id = ?').run(r.id);
      }

      // Recordatorio extras para hoy
      const hoy = new Date().toISOString().slice(0, 10);
      const confirmedExtras = db.prepare(`
        SELECT er.*, e.nombre, e.email FROM extras_reservas er
        JOIN extras e ON e.id = er.extra_id
        WHERE er.fecha = ? AND er.estado = 'confirmado' AND er.rec_env = 0 AND e.email != ''
      `).all(hoy);
      for (const c of confirmedExtras) {
        try {
          await enviarEmailExtra({ nombre: c.nombre, email: c.email }, c, 'recordatorio');
          db.prepare('UPDATE extras_reservas SET rec_env = 1 WHERE id = ?').run(c.id);
        } catch (e) { console.error(e.message); }
      }
    }
    setTimeout(tick, 24 * 60 * 60 * 1000);
  }, msHasta19);

  console.log(`Recordatorios programados. Proxima ejecucion en ${Math.round(msHasta19/60000)} minutos`);
}



// ─── API PRESUPUESTOS ─────────────────────────────────────────────────────────
app.get('/api/presupuesto/siguiente', (req, res) => {
  const anio = new Date().getFullYear();
  const row = db.prepare("SELECT COUNT(*) as n FROM presupuestos WHERE numero LIKE ?").get('%/' + String(anio).slice(-2));
  res.json({ num: (row.n || 0) + 1 });
});

app.get('/api/presupuestos', (req, res) => {
  const rows = db.prepare('SELECT * FROM presupuestos ORDER BY fecha_evento DESC').all();
  res.json(rows);
});

app.post('/api/presupuestos', async (req, res) => {
  const d = req.body;
  const result = db.prepare(`
    INSERT INTO presupuestos (numero, reserva_id, cliente, fecha_evento, salon, pax, tipo_evento, firmante, lineas, subtotal, iva, total, obs, enviado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(d.numero, d.reserva_id||null, d.cliente, d.fecha_evento, d.salon, d.pax, d.tipo_evento, d.firmante, JSON.stringify(d.lineas), d.subtotal, d.iva, d.total, d.obs||'');

  const presup = db.prepare('SELECT * FROM presupuestos WHERE id = ?').get(result.lastInsertRowid);

  // Send email
  if (d.email_cliente || d.enviar_email) {
    try {
      await enviarEmailPresupuesto(presup, d.email_cliente, d.lineas);
      db.prepare('UPDATE presupuestos SET enviado = 1 WHERE id = ?').run(presup.id);
    } catch(e) { console.error('Error email presupuesto:', e.message); }
  }

  res.json({ ok: true, presupuesto: presup });
});

app.delete('/api/presupuestos/:id', (req, res) => {
  db.prepare('DELETE FROM presupuestos WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

async function enviarEmailPresupuesto(presup, emailCliente, lineas) {
  const cfg = getConfig();
  if (!cfg.email_smtp || !cfg.email_pass) return;

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: cfg.email_smtp, pass: cfg.email_pass }
  });

  const fecha = new Date(presup.fecha_evento + 'T12:00:00').toLocaleDateString('es-ES', {day:'numeric', month:'long', year:'numeric'});
  const lineasHtml = lineas.map(l => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0">${l.desc}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right">${l.qty}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right">${(l.precio||0).toFixed(2)} €</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right">${((l.qty||0)*(l.precio||0)).toFixed(2)} €</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#f5f3ef;font-family:sans-serif">
<div style="max-width:600px;margin:0 auto">
  <div style="background:#b8965a;padding:24px;border-radius:8px 8px 0 0;text-align:left">
    <div style="font-size:10px;letter-spacing:3px;color:rgba(255,255,255,0.8)">R E S T A U R A N T E</div>
    <div style="font-size:24px;font-weight:900;color:#fff;letter-spacing:2px">DON FADRIQUE</div>
    <div style="font-size:10px;letter-spacing:2px;color:rgba(255,255,255,0.8)">H O T E L R E S T A U R A N T E · A L B A D E T O R M E S</div>
    <div style="float:right;margin-top:-50px;color:#fff;text-align:right">
      <div style="font-size:18px;font-weight:700;letter-spacing:2px">PRESUPUESTO</div>
      <div style="font-size:13px">Nº ${presup.numero}</div>
    </div>
  </div>
  <div style="background:#fff;padding:24px;border:1px solid #ddd;border-top:none">
    <table style="width:100%;margin-bottom:20px;font-size:13px">
      <tr>
        <td><span style="font-size:10px;color:#888;display:block">CLIENTE</span><strong>${presup.cliente}</strong></td>
        <td><span style="font-size:10px;color:#888;display:block">FECHA EVENTO</span><strong>${fecha}</strong></td>
        <td><span style="font-size:10px;color:#888;display:block">PERSONAS</span><strong>${presup.pax} pax</strong></td>
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">
      <thead>
        <tr style="background:#f5f2ee">
          <th style="padding:8px 12px;text-align:left;font-size:10px;letter-spacing:1px;color:#666">CONCEPTO</th>
          <th style="padding:8px 12px;text-align:right;font-size:10px;letter-spacing:1px;color:#666">CANTIDAD</th>
          <th style="padding:8px 12px;text-align:right;font-size:10px;letter-spacing:1px;color:#666">PRECIO UNIT.</th>
          <th style="padding:8px 12px;text-align:right;font-size:10px;letter-spacing:1px;color:#666">TOTAL</th>
        </tr>
      </thead>
      <tbody>${lineasHtml}</tbody>
    </table>
    <table style="width:40%;margin-left:auto;font-size:13px">
      <tr><td style="padding:6px 12px">Subtotal</td><td style="padding:6px 12px;text-align:right">${presup.subtotal.toFixed(2)} €</td></tr>
      <tr><td style="padding:6px 12px">IVA (10%)</td><td style="padding:6px 12px;text-align:right">${presup.iva.toFixed(2)} €</td></tr>
      <tr style="font-weight:700;font-size:15px;border-top:2px solid #b8965a"><td style="padding:8px 12px">TOTAL</td><td style="padding:8px 12px;text-align:right">${presup.total.toFixed(2)} €</td></tr>
    </table>
    <p style="font-size:10px;color:#888;text-align:right">* IVA 10% no incluido en los precios anteriores</p>
    ${presup.obs ? `<p style="font-size:13px;color:#444;margin-top:16px"><strong>Observaciones:</strong> ${presup.obs}</p>` : ''}
    <p style="font-size:13px;color:#444;margin-top:20px">Firmado por: <strong>${presup.firmante}</strong></p>
    <hr style="border:none;border-top:1px solid #e0dcd6;margin:20px 0">
    <p style="font-size:12px;color:#888">Restaurante Don Fadrique · Alba de Tormes · ${cfg.tel_rest}</p>
  </div>
</div></body></html>`;

  const destinatarios = ['oscar@donfadrique.com'];
  if (emailCliente) destinatarios.unshift(emailCliente);

  await transporter.sendMail({
    from: `"Don Fadrique" <${cfg.email_smtp}>`,
    to: destinatarios.join(', '),
    subject: `Presupuesto Nº ${presup.numero} - ${presup.cliente}`,
    html
  });
}

// ─── API AVISOS CANCELACION ───────────────────────────────────────────────────
app.get('/api/avisos-cancelacion', (req, res) => {
  db.prepare("INSERT OR IGNORE INTO config (clave, valor) VALUES ('avisos_cancelacion', '[]')").run();
  const row = db.prepare("SELECT valor FROM config WHERE clave = 'avisos_cancelacion'").get();
  res.json(JSON.parse(row?.valor || '[]'));
});

app.delete('/api/avisos-cancelacion/:idx', (req, res) => {
  const row = db.prepare("SELECT valor FROM config WHERE clave = 'avisos_cancelacion'").get();
  const avisos = JSON.parse(row?.valor || '[]');
  avisos.splice(parseInt(req.params.idx), 1);
  db.prepare("UPDATE config SET valor = ? WHERE clave = 'avisos_cancelacion'").run(JSON.stringify(avisos));
  res.json({ ok: true });
});

// ─── CATCH-ALL ────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Don Fadrique corriendo en puerto ${PORT}`);
  programarRecordatorios();
});
