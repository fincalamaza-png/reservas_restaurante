const express = require('express');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const crypto = require('crypto');

const LOGOS_DIR = path.join(__dirname, 'logos');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── BASE DE DATOS ────────────────────────────────────────────────
const db = new Database(process.env.DB_PATH || '/data/reservas.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS reservas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT, salon TEXT, mesa INTEGER, fecha TEXT, hora TEXT,
    nombre TEXT, tel TEXT, email TEXT, pax INTEGER, menu TEXT,
    alergias TEXT, obs TEXT, estado TEXT DEFAULT 'pendiente',
    tipo_evento TEXT, montaje TEXT DEFAULT 'imperial',
    protocolo INTEGER DEFAULT 0, coctel INTEGER DEFAULT 0,
    coctel_det TEXT, entrantes TEXT, pescado TEXT,
    sorbete INTEGER DEFAULT 0, carne TEXT, postre TEXT, platos_principales TEXT,
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
  // Add niños columns if not exist
  try { db.exec("ALTER TABLE reservas ADD COLUMN ninos INTEGER DEFAULT 0"); } catch(e) {}
  try { db.exec("ALTER TABLE reservas ADD COLUMN menu_ninos_entrante TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE reservas ADD COLUMN menu_ninos_principal TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE reservas ADD COLUMN menu_ninos_postre TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE reservas ADD COLUMN menu_ninos_precio REAL"); } catch(e) {}
  // Ensure presupuestos table exists
  try { db.exec("CREATE TABLE IF NOT EXISTS presupuestos (id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT, reserva_id INTEGER, cliente TEXT, fecha_evento TEXT, salon TEXT, pax INTEGER, tipo_evento TEXT, firmante TEXT, lineas TEXT, subtotal REAL, iva REAL, total REAL, obs TEXT, enviado INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime(\'now\')))"); } catch(e) {}

// ─── PROPUESTAS DE MENÚ (envío previo a reserva) ──────────────────────────────
try { db.exec(`
  CREATE TABLE IF NOT EXISTS plantillas_menu (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT,
    tipo TEXT,
    orden INTEGER DEFAULT 0,
    secciones TEXT,
    precio_persona REAL DEFAULT 0,
    activo INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS propuestas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plantilla_id INTEGER,
    plantilla_nombre TEXT,
    cliente TEXT,
    telefono TEXT,
    email TEXT,
    fecha_evento TEXT,
    tipo_evento TEXT,
    pax INTEGER,
    secciones TEXT,
    precio_persona REAL DEFAULT 0,
    notas TEXT,
    estado TEXT DEFAULT 'borrador',
    fecha_envio TEXT,
    reserva_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (reserva_id) REFERENCES reservas(id)
  );
`); } catch(e) {}
// Propuestas: soporte para varios menús en un mismo documento + suplementos opcionales con coste adicional
try { db.exec("ALTER TABLE propuestas ADD COLUMN menus TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE propuestas ADD COLUMN extras TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE propuestas ADD COLUMN token TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE propuestas ADD COLUMN firma_cliente TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE propuestas ADD COLUMN fecha_confirmacion TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE propuestas ADD COLUMN firma_restaurante TEXT"); } catch(e) {}
// Seguimiento automático de propuestas enviadas sin respuesta
try { db.exec("ALTER TABLE propuestas ADD COLUMN seguimientos INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE propuestas ADD COLUMN ultimo_seguimiento TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE propuestas ADD COLUMN seguimiento_auto INTEGER DEFAULT 1"); } catch(e) {}
try { db.exec("ALTER TABLE propuestas ADD COLUMN texto_original TEXT"); } catch(e) {}
try {
  db.exec("INSERT OR IGNORE INTO config VALUES ('dias_seguimiento', '3')");
  db.exec("INSERT OR IGNORE INTO config VALUES ('max_seguimientos', '2')");
  db.exec("INSERT OR IGNORE INTO config VALUES ('resumen_diario', '1')");
  db.exec("INSERT OR IGNORE INTO config VALUES ('email_resumen', 'fincalamaza@gmail.com, nicocuadri@hotmail.com')");
} catch(e) {}
// Generar token para propuestas antiguas que no lo tengan aún (enlace público de confirmación)
(function generarTokensFaltantes() {
  const rows = db.prepare('SELECT id FROM propuestas WHERE token IS NULL OR token = ?').all('');
  const upd = db.prepare('UPDATE propuestas SET token = ? WHERE id = ?');
  rows.forEach(r => upd.run(crypto.randomBytes(16).toString('hex'), r.id));
})();

// Sembrar las 8 plantillas base si la tabla está vacía
(function seedPlantillasMenu() {
  const n = db.prepare('SELECT COUNT(*) as n FROM plantillas_menu').get().n;
  if (n > 0) return;
  const base = [
    { nombre: 'Reunión Familiar Tradicional 1', tipo: 'comida', secciones: [
      { titulo: 'Aperitivo', texto: 'Por definir' },
      { titulo: 'Entrantes', texto: 'Por definir' },
      { titulo: 'Plato principal', texto: 'Por definir' },
      { titulo: 'Postre', texto: 'Por definir' },
      { titulo: 'Bebidas', texto: 'Agua, vino blanco, vino tinto, cava, refrescos, café' }
    ]},
    { nombre: 'Reunión Familiar Tradicional 2', tipo: 'comida', secciones: [
      { titulo: 'Aperitivo', texto: 'Por definir' },
      { titulo: 'Entrantes', texto: 'Por definir' },
      { titulo: 'Pescado', texto: 'Por definir' },
      { titulo: 'Carne', texto: 'Por definir' },
      { titulo: 'Postre', texto: 'Por definir' },
      { titulo: 'Bebidas', texto: 'Agua, vino blanco, vino tinto, cava, refrescos, café' }
    ]},
    { nombre: 'Cóctel Comida', tipo: 'coctel', secciones: [
      { titulo: 'Cóctel de bienvenida', texto: 'Por definir' },
      { titulo: 'Aperitivos variados', texto: 'Por definir' },
      { titulo: 'Plato principal', texto: 'Por definir' },
      { titulo: 'Postre', texto: 'Por definir' },
      { titulo: 'Bebidas', texto: 'Agua, vino blanco, vino tinto, cava, refrescos, café' }
    ]},
    { nombre: 'Cóctel con Estaciones', tipo: 'coctel', secciones: [
      { titulo: 'Estación 1', texto: 'Por definir' },
      { titulo: 'Estación 2', texto: 'Por definir' },
      { titulo: 'Estación 3', texto: 'Por definir' },
      { titulo: 'Postres', texto: 'Por definir' },
      { titulo: 'Bebidas', texto: 'Agua, vino blanco, vino tinto, cava, refrescos, café' }
    ]},
    { nombre: 'Menú Degustación Tradición', tipo: 'degustacion', secciones: [
      { titulo: 'Aperitivo', texto: 'Por definir' },
      { titulo: 'Primer plato', texto: 'Por definir' },
      { titulo: 'Pescado', texto: 'Por definir' },
      { titulo: 'Carne', texto: 'Por definir' },
      { titulo: 'Postre', texto: 'Por definir' },
      { titulo: 'Bebidas', texto: 'Agua, vino blanco, vino tinto, cava, refrescos, café' }
    ]},
    { nombre: 'Menú Degustación Tradición 2', tipo: 'degustacion', secciones: [
      { titulo: 'Aperitivo', texto: 'Por definir' },
      { titulo: 'Entrante', texto: 'Por definir' },
      { titulo: 'Pescado', texto: 'Por definir' },
      { titulo: 'Carne', texto: 'Por definir' },
      { titulo: 'Pre-postre', texto: 'Por definir' },
      { titulo: 'Postre', texto: 'Por definir' },
      { titulo: 'Bebidas', texto: 'Agua, vino blanco, vino tinto, cava, refrescos, café' }
    ]},
    { nombre: 'Menú Chef', tipo: 'degustacion', secciones: [
      { titulo: 'Aperitivo del chef', texto: 'Por definir' },
      { titulo: 'Entrante', texto: 'Por definir' },
      { titulo: 'Plato principal', texto: 'Por definir' },
      { titulo: 'Pre-postre', texto: 'Por definir' },
      { titulo: 'Postre', texto: 'Por definir' },
      { titulo: 'Bebidas', texto: 'Agua, vino blanco, vino tinto, cava, refrescos, café' }
    ]},
    { nombre: 'Menú Instinto', tipo: 'degustacion', secciones: [
      { titulo: 'Snacks de bienvenida', texto: 'Por definir' },
      { titulo: 'Entrante', texto: 'Por definir' },
      { titulo: 'Pescado', texto: 'Por definir' },
      { titulo: 'Carne', texto: 'Por definir' },
      { titulo: 'Postre', texto: 'Por definir' },
      { titulo: 'Bebidas', texto: 'Agua, vino blanco, vino tinto, cava, refrescos, café' }
    ]}
  ];
  const stmt = db.prepare('INSERT INTO plantillas_menu (nombre, tipo, orden, secciones, precio_persona, activo) VALUES (?,?,?,?,?,1)');
  base.forEach((p, i) => stmt.run(p.nombre, p.tipo, i, JSON.stringify(p.secciones), 0));
})();

// Migración: estructura detallada por campos para "Reunión Familiar Tradicional 1"
// (entrantes editables con opción "para compartir", pescado/carne "a elegir" con varias
// opciones, sorbete sí/no, vinos). Se aplica una sola vez, controlada por config, para no
// pisar ediciones manuales posteriores de Manuel.
(function migrarPlantilla1V2() {
  const flag = db.prepare("SELECT valor FROM config WHERE clave = 'plantilla1_v2'").get();
  if (flag && flag.valor === '1') return;
  const campos = [
    { tipo: 'plato', titulo: 'Entrante 1', texto: 'Jamón y lomo ibéricos de bellota', compartir: false },
    { tipo: 'plato', titulo: 'Entrante 2', texto: 'Gamba blanca', compartir: false },
    { tipo: 'plato', titulo: 'Entrante 3', texto: 'Croquetas variadas', compartir: false },
    { tipo: 'plato', titulo: 'Entrante 4', texto: '', compartir: false },
    { tipo: 'eleccion', titulo: 'Pescado', elegir: false, opciones: ['', '', ''] },
    { tipo: 'sino', titulo: 'Sorbete', valor: false },
    { tipo: 'eleccion', titulo: 'Carne', elegir: false, opciones: ['', '', '', ''] },
    { tipo: 'plato', titulo: 'Postre', texto: '' },
    { tipo: 'plato', titulo: 'Vino blanco', texto: '' },
    { tipo: 'plato', titulo: 'Vino tinto', texto: '' },
    { tipo: 'plato', titulo: 'Cava', texto: '' }
  ];
  db.prepare('UPDATE plantillas_menu SET secciones = ? WHERE nombre = ?')
    .run(JSON.stringify(campos), 'Reunión Familiar Tradicional 1');
  db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES ('plantilla1_v2', '1')").run();
})();

// Migración: "Reunión Familiar Tradicional 2" usa la misma estructura que la 1
// (entrantes con opción de compartir, pescado/carne a elegir, sorbete sí/no, vinos),
// pero sin platos por defecto rellenados.
(function migrarPlantilla2V2() {
  const flag = db.prepare("SELECT valor FROM config WHERE clave = 'plantilla2_v2'").get();
  if (flag && flag.valor === '1') return;
  const campos = [
    { tipo: 'plato', titulo: 'Entrante 1', texto: '', compartir: false },
    { tipo: 'plato', titulo: 'Entrante 2', texto: '', compartir: false },
    { tipo: 'plato', titulo: 'Entrante 3', texto: '', compartir: false },
    { tipo: 'plato', titulo: 'Entrante 4', texto: '', compartir: false },
    { tipo: 'eleccion', titulo: 'Pescado', elegir: false, opciones: ['', '', ''] },
    { tipo: 'sino', titulo: 'Sorbete', valor: false },
    { tipo: 'eleccion', titulo: 'Carne', elegir: false, opciones: ['', '', '', ''] },
    { tipo: 'plato', titulo: 'Postre', texto: '' },
    { tipo: 'plato', titulo: 'Vino blanco', texto: '' },
    { tipo: 'plato', titulo: 'Vino tinto', texto: '' },
    { tipo: 'plato', titulo: 'Cava', texto: '' }
  ];
  db.prepare('UPDATE plantillas_menu SET secciones = ? WHERE nombre = ?')
    .run(JSON.stringify(campos), 'Reunión Familiar Tradicional 2');
  db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES ('plantilla2_v2', '1')").run();
})();

// Migración: "Menú Degustación Tradición" con los platos concretos indicados por Manuel
(function migrarPlantilla5V2() {
  const flag = db.prepare("SELECT valor FROM config WHERE clave = 'plantilla5_v2'").get();
  if (flag && flag.valor === '1') return;
  const campos = [
    { tipo: 'plato', titulo: 'Aperitivo', texto: 'Sobrasada casera con encurtidos y miel' },
    { tipo: 'plato', titulo: 'Aperitivo 2', texto: 'Peces de Alba (solo si los hay)' },
    { tipo: 'plato', titulo: 'Entrante 1', texto: 'Salmorejo tradicional como se hacía en el huerto' },
    { tipo: 'plato', titulo: 'Entrante 2', texto: 'Limón serrano al estilo albense' },
    { tipo: 'plato', titulo: 'Entrante 3', texto: 'Judías verdes de nuestro huerto con pil-pil de jamón' },
    { tipo: 'plato', titulo: 'Pescado', texto: 'Bacalao a la brasa' },
    { tipo: 'plato', titulo: 'Carne', texto: 'Chuleta de morucha 100% con patatas y pimientos asados' },
    { tipo: 'plato', titulo: 'Postre', texto: 'Tarta de queso estilo la viña con helado' }
  ];
  db.prepare('UPDATE plantillas_menu SET secciones = ? WHERE nombre = ?')
    .run(JSON.stringify(campos), 'Menú Degustación Tradición');
  db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES ('plantilla5_v2', '1')").run();
})();

// Migración: "Menú Degustación Tradición 2" con la misma estructura que la anterior,
// pero sin platos por defecto (a rellenar).
(function migrarPlantilla6V2() {
  const flag = db.prepare("SELECT valor FROM config WHERE clave = 'plantilla6_v2'").get();
  if (flag && flag.valor === '1') return;
  const campos = [
    { tipo: 'plato', titulo: 'Aperitivo', texto: '' },
    { tipo: 'plato', titulo: 'Aperitivo 2', texto: '' },
    { tipo: 'plato', titulo: 'Entrante 1', texto: '' },
    { tipo: 'plato', titulo: 'Entrante 2', texto: '' },
    { tipo: 'plato', titulo: 'Entrante 3', texto: '' },
    { tipo: 'plato', titulo: 'Pescado', texto: '' },
    { tipo: 'plato', titulo: 'Carne', texto: '' },
    { tipo: 'plato', titulo: 'Postre', texto: '' }
  ];
  db.prepare('UPDATE plantillas_menu SET secciones = ? WHERE nombre = ?')
    .run(JSON.stringify(campos), 'Menú Degustación Tradición 2');
  db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES ('plantilla6_v2', '1')").run();
})();

// Migración: "Cóctel Comida" con listas de platos (aperitivos fríos, calientes y postres),
// cada una editable y ampliable con un botón "+ Añadir plato".
(function migrarPlantilla3V2() {
  const flag = db.prepare("SELECT valor FROM config WHERE clave = 'plantilla3_v2'").get();
  if (flag && flag.valor === '1') return;
  const campos = [
    { tipo: 'lista', titulo: 'Aperitivos fríos', items: [
      'Ensalada de ventresca', 'Rulo de salmón con chocolate', 'Carpaccio de presa',
      'Anchoa con pimiento dulce', 'Tosta de jamón y foie', 'Yogur de bacalao',
      'Gallo en escabeche con alioli', 'Gildas'
    ]},
    { tipo: 'lista', titulo: 'Aperitivos calientes', items: [
      'Croqueta de jamón', 'Croqueta de bacalao', 'Croquetas de capón',
      'Morcilla con pistacho', 'Caramelo de farinato', 'Verduras en tempura',
      'Falsas patatas de berenjena', 'Nuestro huerto en miniatura', 'Saam de panceta', 'Carne a la brasa'
    ]},
    { tipo: 'lista', titulo: 'Postres', items: [
      'Tarta de queso', 'Arroz con leche', 'Crème brûlée', 'Brownie', 'Fruta de temporada en brochetas'
    ]}
  ];
  db.prepare('UPDATE plantillas_menu SET secciones = ? WHERE nombre = ?')
    .run(JSON.stringify(campos), 'Cóctel Comida');
  db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES ('plantilla3_v2', '1')").run();
})();

// Migración: "Cóctel con Estaciones" — 6 estaciones, cada una con espacio para varios
// productos editables y ampliables (+ Añadir plato).
(function migrarPlantilla4V2() {
  const flag = db.prepare("SELECT valor FROM config WHERE clave = 'plantilla4_v2'").get();
  if (flag && flag.valor === '1') return;
  const vacios = n => Array.from({ length: n }, () => '');
  const campos = [
    { tipo: 'lista', titulo: 'Estación Ibéricos', items: vacios(5) },
    { tipo: 'lista', titulo: 'Estación Tradicional', items: vacios(5) },
    { tipo: 'lista', titulo: 'Estación Quesos', items: vacios(8) },
    { tipo: 'lista', titulo: 'Estación Marisco', items: vacios(8) },
    { tipo: 'lista', titulo: 'Estación Carnes', items: vacios(5) },
    { tipo: 'lista', titulo: 'Estación Postres', items: vacios(6) }
  ];
  db.prepare('UPDATE plantillas_menu SET secciones = ? WHERE nombre = ?')
    .run(JSON.stringify(campos), 'Cóctel con Estaciones');
  db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES ('plantilla4_v2', '1')").run();
})();

// Migración global: añade "Barra libre" y "Recena" al final de TODAS las plantillas
// (se ejecuta una sola vez, controlada por config, para no duplicarlos en reinicios futuros).
(function migrarBarraLibreRecenaV1() {
  const flag = db.prepare("SELECT valor FROM config WHERE clave = 'campos_barra_recena_v1'").get();
  if (flag && flag.valor === '1') return;
  const barraLibre = () => ({ tipo: 'barra_libre', titulo: 'Barra libre', horas: '3,5 horas', precio: 29.90, valor: false });
  const recena = () => ({ tipo: 'recena', titulo: 'Recena', valor: false, platos: [
    { nombre: 'Bandeja de minihamburguesas', precio: 0 },
    { nombre: 'Pizza', precio: 0 },
    { nombre: 'Montaditos', precio: 0 },
    { nombre: '', precio: 0 },
    { nombre: '', precio: 0 },
    { nombre: '', precio: 0 }
  ]});
  const rows = db.prepare('SELECT id, secciones FROM plantillas_menu').all();
  const upd = db.prepare('UPDATE plantillas_menu SET secciones = ? WHERE id = ?');
  rows.forEach(r => {
    const secciones = JSON.parse(r.secciones || '[]');
    secciones.push(barraLibre());
    secciones.push(recena());
    upd.run(JSON.stringify(secciones), r.id);
  });
  db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES ('campos_barra_recena_v1', '1')").run();
})();

// Migración: "Menú Chef" — aperitivos, entrantes, carnes y postres con espacio para varios
// platos ampliables, pescado como plato único, más barra libre y recena.
(function migrarPlantilla7V2() {
  const flag = db.prepare("SELECT valor FROM config WHERE clave = 'plantilla7_v2'").get();
  if (flag && flag.valor === '1') return;
  const vacios = n => Array.from({ length: n }, () => '');
  const campos = [
    { tipo: 'lista', titulo: 'Aperitivos', items: vacios(3) },
    { tipo: 'lista', titulo: 'Entrantes', items: vacios(4) },
    { tipo: 'plato', titulo: 'Pescado', texto: '' },
    { tipo: 'lista', titulo: 'Carnes', items: vacios(3) },
    { tipo: 'lista', titulo: 'Postres', items: vacios(2) },
    { tipo: 'barra_libre', titulo: 'Barra libre', horas: '3,5 horas', precio: 29.90, valor: false },
    { tipo: 'recena', titulo: 'Recena', valor: false, platos: [
      { nombre: 'Bandeja de minihamburguesas', precio: 0 },
      { nombre: 'Pizza', precio: 0 },
      { nombre: 'Montaditos', precio: 0 },
      { nombre: '', precio: 0 },
      { nombre: '', precio: 0 },
      { nombre: '', precio: 0 }
    ]}
  ];
  db.prepare('UPDATE plantillas_menu SET secciones = ? WHERE nombre = ?')
    .run(JSON.stringify(campos), 'Menú Chef');
  db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES ('plantilla7_v2', '1')").run();
})();

// Migración: "Menú Instinto" — misma estructura que el Menú Chef pero con 2 platos más
// en cada sección (incluido el pescado, que aquí pasa a admitir varias opciones).
(function migrarPlantilla8V2() {
  const flag = db.prepare("SELECT valor FROM config WHERE clave = 'plantilla8_v2'").get();
  if (flag && flag.valor === '1') return;
  const vacios = n => Array.from({ length: n }, () => '');
  const campos = [
    { tipo: 'lista', titulo: 'Aperitivos', items: vacios(5) },
    { tipo: 'lista', titulo: 'Entrantes', items: vacios(6) },
    { tipo: 'lista', titulo: 'Pescado', items: vacios(3) },
    { tipo: 'lista', titulo: 'Carnes', items: vacios(5) },
    { tipo: 'lista', titulo: 'Postres', items: vacios(4) },
    { tipo: 'barra_libre', titulo: 'Barra libre', horas: '3,5 horas', precio: 29.90, valor: false },
    { tipo: 'recena', titulo: 'Recena', valor: false, platos: [
      { nombre: 'Bandeja de minihamburguesas', precio: 0 },
      { nombre: 'Pizza', precio: 0 },
      { nombre: 'Montaditos', precio: 0 },
      { nombre: '', precio: 0 },
      { nombre: '', precio: 0 },
      { nombre: '', precio: 0 }
    ]}
  ];
  db.prepare('UPDATE plantillas_menu SET secciones = ? WHERE nombre = ?')
    .run(JSON.stringify(campos), 'Menú Instinto');
  db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES ('plantilla8_v2', '1')").run();
})();



// ─── MIDDLEWARE ───────────────────────────────────────────────────
const jsonNormal = express.json();
const jsonGrande = express.json({ limit: '60mb' });
app.use((req, res, next) => (req.path === '/api/estudio-email' ? jsonGrande : jsonNormal)(req, res, next));

// ─── ACCESO CON PIN (panel de administración) ─────────────────────
db.exec(`CREATE TABLE IF NOT EXISTS sesiones (
  token TEXT PRIMARY KEY,
  usuario TEXT NOT NULL,
  creada TEXT DEFAULT (datetime('now')),
  ultimo_uso TEXT DEFAULT (datetime('now'))
)`);
db.prepare("INSERT OR IGNORE INTO config (clave, valor) VALUES ('pin_admin', ?)")
  .run(JSON.stringify({ 'Manuel': '1510', 'Nicolás': '2609' }));
// Las sesiones caducan tras 90 días sin uso
try { db.exec("DELETE FROM sesiones WHERE ultimo_uso < datetime('now', '-90 days')"); } catch(e) {}

const COOKIE_SESION = 'df_sesion';
const intentosPin = new Map(); // ip -> { fallos, hasta }

function leerCookie(req, nombre) {
  const c = req.headers.cookie || '';
  for (const parte of c.split(';')) {
    const i = parte.indexOf('=');
    if (i > -1 && parte.slice(0, i).trim() === nombre) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}
function usuarioSesion(req) {
  const t = leerCookie(req, COOKIE_SESION);
  if (!t) return null;
  const s = db.prepare('SELECT usuario FROM sesiones WHERE token = ?').get(t);
  if (!s) return null;
  db.prepare("UPDATE sesiones SET ultimo_uso = datetime('now') WHERE token = ?").run(t);
  return s.usuario;
}
function pinesAdmin() {
  try { return JSON.parse(db.prepare("SELECT valor FROM config WHERE clave = 'pin_admin'").get().valor || '{}'); }
  catch(e) { return {}; }
}

app.post('/api/login', (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '';
  const reg = intentosPin.get(ip) || { fallos: 0, hasta: 0 };
  if (reg.hasta > Date.now()) {
    const min = Math.ceil((reg.hasta - Date.now()) / 60000);
    return res.status(429).json({ error: `Demasiados intentos. Espera ${min} min.` });
  }
  const pin = String((req.body && req.body.pin) || '').trim();
  const usuario = Object.keys(pinesAdmin()).find(n => pinesAdmin()[n] === pin);
  if (!pin || !usuario) {
    reg.fallos++;
    if (reg.fallos >= 5) { reg.hasta = Date.now() + 10 * 60000; reg.fallos = 0; }
    intentosPin.set(ip, reg);
    return res.status(401).json({ error: 'PIN incorrecto' });
  }
  intentosPin.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sesiones (token, usuario) VALUES (?, ?)').run(token, usuario);
  const segura = (req.headers['x-forwarded-proto'] === 'https' || req.secure) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_SESION}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60*60*24*365}${segura}`);
  res.json({ ok: true, usuario });
});

app.post('/api/logout', (req, res) => {
  const t = leerCookie(req, COOKIE_SESION);
  if (t) db.prepare('DELETE FROM sesiones WHERE token = ?').run(t);
  res.setHeader('Set-Cookie', `${COOKIE_SESION}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/sesion', (req, res) => {
  const u = usuarioSesion(req);
  if (!u) return res.status(401).json({ error: 'Sin sesión' });
  res.json({ usuario: u });
});

// Archivos del servidor que nunca deben descargarse
const PRIVADOS = /^\/(estudio(\/.*)?|scripts(\/.*)?|server\.js|package(-lock)?\.json|Dockerfile|start\.sh|.*\.db(-wal|-shm)?|\.git(\/.*)?|node_modules(\/.*)?|\.env.*)$/i;
app.use((req, res, next) => {
  if (PRIVADOS.test(req.path)) return res.status(404).send('Not found');
  next();
});

// Rutas públicas: portal del personal, respuestas de extras por email y confirmación del cliente
const RUTAS_PUBLICAS = [/^\/api\/personal\//, /^\/api\/extras\/respuesta\//];
app.use('/api', (req, res, next) => {
  const ruta = req.originalUrl.split('?')[0];
  if (RUTAS_PUBLICAS.some(r => r.test(ruta))) return next();
  const u = usuarioSesion(req);
  if (!u) return res.status(401).json({ error: 'Sesión caducada. Introduce tu PIN.' });
  req.usuario = u;
  next();
});
app.use(['/minuta-print'], (req, res, next) => {
  if (!usuarioSesion(req)) return res.redirect('/');
  next();
});

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
// Calcula extras con margen de 6:
// Solo sube si sobran MAS de 6 del multiplo
// Ej: 120/12=10, 125/12=10 (sobran 5, no sube), 126/12=11 (sobran 6, SUBE)
function calcExtras(pax, ratio) {
  if (pax <= 0) return 0;
  const base = Math.floor(pax / ratio);
  const resto = pax % ratio;
  return resto >= 6 ? base + 1 : base;
}

// Carta: empieza en 25 personas (1 extra), sube cada 12: 25,37,49,61...
// Es decir: 1 + Math.floor((pax - 25) / 12) cuando pax >= 25
function calcExtrasCarta(pax) {
  if (pax < 25) return 0;
  return 1 + Math.floor((pax - 25) / 12);
}

function extrasNecesarios(fecha) {
  const reservas = db.prepare(
    "SELECT pax, tipo, tipo_evento FROM reservas WHERE fecha = ? AND estado != 'cancelada'"
  ).all(fecha);

  // Sumar comensales por tipo PRIMERO, luego calcular extras sobre el total
  let paxBoda = 0, paxTurista = 0, paxCarta = 0;

  for (const r of reservas) {
    const pax = r.pax || 0;
    if (r.tipo === 'carta') {
      paxCarta += pax;
    } else if (r.tipo === 'evento') {
      if (r.tipo_evento === 'turista') {
        paxTurista += pax;
      } else {
        // Boda, comunion, familiar
        paxBoda += pax;
      }
    }
  }

  // Calcular extras sobre el total de cada tipo
  let total = 0;
  total += calcExtras(paxBoda, 12);      // Boda/comunion/familiar: 1 cada 12
  total += calcExtras(paxTurista, 15);   // Turista: 1 cada 15
  total += calcExtrasCarta(paxCarta);    // Carta: desde 25, luego cada 12

  return total;
}

// Migracion: añadir columna platos_principales si no existe
try {
  db.prepare("ALTER TABLE reservas ADD COLUMN platos_principales TEXT DEFAULT ''").run();
  console.log('Columna platos_principales añadida');
} catch(e) {} // Ya existe

// Convierte entrantes JSON a texto plano para PDF y emails
function entrantesToTexto(entrantes) {
  try {
    const arr = JSON.parse(entrantes || '[]');
    if (!Array.isArray(arr)) return entrantes || '';
    return arr.filter(e => e.texto)
      .map(e => e.texto + (e.compartir ? ' (para compartir)' : ''))
      .join(' / ');
  } catch(ex) { return entrantes || ''; }
}

// Preparar convocatoria: registra extras pendientes de convocar
// NO envia emails - el usuario confirma desde la app antes de enviar
// Se llama al crear/modificar reserva. Los emails se envian:
//   - Al momento si el evento es en menos de 10 dias
//   - 10 dias antes si el evento es mas lejano (via cron)
async function autoConvocar(fecha) {
  const necesarios = extrasNecesarios(fecha);
  if (necesarios === 0) return;

  const horaConv = calcHoraConvocatoria(fecha);

  // Cuantos confirmados hay ya
  const confirmados = db.prepare("SELECT COUNT(*) as n FROM extras_reservas WHERE fecha = ? AND estado = 'confirmado'").get(fecha);
  if (confirmados.n >= necesarios) return;

  // Cuantos convocados ya hay
  const yaConvocados = db.prepare("SELECT extra_id FROM extras_reservas WHERE fecha = ?").all(fecha).map(r => r.extra_id);

  const faltanConvocar = (necesarios * 3) - yaConvocados.length;
  if (faltanConvocar <= 0) return;

  const placeholders = yaConvocados.length ? yaConvocados.map(() => '?').join(',') : '0';
  const extras = db.prepare(`
    SELECT * FROM extras WHERE activo = 1 AND id NOT IN (${placeholders})
    ORDER BY penalizado ASC, (actitud+capacidad+rigor+conocimientos+aspecto) DESC
    LIMIT ?
  `).all(...yaConvocados, faltanConvocar);

  // Registrar como pendientes de convocatoria (sin enviar email aun)
  for (const extra of extras) {
    db.prepare(`
      INSERT OR IGNORE INTO extras_reservas (extra_id, reserva_id, fecha, estado, hora_convocatoria)
      VALUES (?, null, ?, 'pendiente_conv', ?)
    `).run(extra.id, fecha, horaConv);
  }

  // Calcular dias hasta el evento
  const hoy = new Date();
  hoy.setHours(0,0,0,0);
  const eventoDate = new Date(fecha + 'T00:00:00');
  const diasRestantes = Math.round((eventoDate - hoy) / (1000*60*60*24));

  // Si el evento es en menos de 10 dias, avisar al restaurante para confirmar envio
  // Guardar alerta de convocatoria pendiente
  const pendientes = db.prepare("SELECT COUNT(*) as n FROM extras_reservas WHERE fecha = ? AND estado = 'pendiente_conv'").get(fecha);
  if (pendientes.n > 0) {
    db.prepare("INSERT OR IGNORE INTO config (clave, valor) VALUES ('alertas_conv', '[]')").run();
    const alertas = JSON.parse(db.prepare("SELECT valor FROM config WHERE clave = 'alertas_conv'").get()?.valor || '[]');
    // Evitar duplicados para la misma fecha
    const yaExiste = alertas.find(a => a.fecha === fecha);
    if (!yaExiste) {
      alertas.push({
        fecha,
        necesarios,
        pendientes: pendientes.n,
        diasRestantes,
        horaConv,
        ts: new Date().toISOString()
      });
      db.prepare("UPDATE config SET valor = ? WHERE clave = 'alertas_conv'").run(JSON.stringify(alertas));
    }
  }
}

// Enviar emails de convocatoria para una fecha (llamado desde la app tras confirmacion del usuario)
async function enviarConvocatoria(fecha) {
  const cfg = getConfig();
  const pendientes = db.prepare(`
    SELECT er.*, e.nombre, e.email FROM extras_reservas er
    JOIN extras e ON e.id = er.extra_id
    WHERE er.fecha = ? AND er.estado = 'pendiente_conv' AND e.email != ''
  `).all(fecha);

  let enviados = 0;
  for (const p of pendientes) {
    const extra = db.prepare('SELECT * FROM extras WHERE id = ?').get(p.extra_id);
    if (extra && extra.email && cfg.email_smtp && cfg.email_pass) {
      try {
        const asig = db.prepare('SELECT * FROM extras_reservas WHERE id = ?').get(p.id);
        await enviarEmailExtra(extra, asig, 'convocatoria');
        db.prepare("UPDATE extras_reservas SET estado = 'convocado', conv_env = 1 WHERE id = ?").run(p.id);
        enviados++;
      } catch (e) { console.error('Error envio convocatoria:', e.message); }
    }
  }

  // Limpiar alerta
  const alertas = JSON.parse(db.prepare("SELECT valor FROM config WHERE clave = 'alertas_conv'").get()?.valor || '[]');
  const nuevasAlertas = alertas.filter(a => a.fecha !== fecha);
  db.prepare("UPDATE config SET valor = ? WHERE clave = 'alertas_conv'").run(JSON.stringify(nuevasAlertas));

  return enviados;
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
    <tr><td style="color:#888;padding:5px 0">Adultos</td><td style="padding:5px 0"><strong>${r.pax}</strong></td></tr>
  `;
  if (r.ninos > 0) filas += `<tr><td style="color:#888;padding:5px 0">Niños</td><td style="padding:5px 0"><strong>${r.ninos}</strong></td></tr>`;
  filas += `<tr><td style="color:#888;padding:5px 0">Salon</td><td style="padding:5px 0"><strong>${salones[r.salon] || r.salon}</strong></td></tr>
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

// ─── LOGOS EMAIL ─────────────────────────────────────────────────
const LOGO_MICHELIN = 'data:image/jpeg;base64,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';
const LOGO_REPSOL   = 'data:image/jpeg;base64,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';
const LOGO_TIERRA   = 'data:image/png;base64,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';

// ─── EMAIL EXTRA ──────────────────────────────────────────────────

// Bloque de cabecera comun para emails de extras
function emailHeader(titulo, subtitulo, color) {
  color = color || '#b8965a';
  return `<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#f5f3ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:0 auto;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)">
  <div style="background:${color};padding:28px 24px;text-align:center">
    <div style="font-family:Georgia,serif;font-size:26px;color:#fff;letter-spacing:3px;margin-bottom:4px">Don Fadrique</div>
    <div style="font-size:11px;color:rgba(255,255,255,.75);letter-spacing:1px">RESTAURANTE · PALACIO CONDE DE ALDANA</div>
    <div style="margin-top:12px;display:flex;justify-content:center;gap:10px;align-items:center">
      <img src="${LOGO_MICHELIN}" style="height:28px;width:auto;object-fit:contain;vertical-align:middle">
      <img src="${LOGO_REPSOL}" style="height:28px;width:auto;object-fit:contain;vertical-align:middle">
      <img src="${LOGO_TIERRA}" style="height:28px;width:auto;object-fit:contain;vertical-align:middle">
    </div>
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
    <div style="background:#fce4e4;border-radius:8px;padding:12px 16px;margin-top:12px;border:1px solid #f5c6cb">
      <p style="font-size:12px;color:#842029;margin:0;line-height:1.7">&#9201; <strong>Esta invitacion caduca en 24 horas.</strong> Si no confirmas antes, perderás la plaza automaticamente.</p>
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

    // Cargar datos completos de la reserva si tenemos reserva_id
    let reserva = null;
    if (asignacion.reserva_id) {
      reserva = db.prepare('SELECT * FROM reservas WHERE id = ?').get(asignacion.reserva_id);
    }

    // Construir bloque de menu
    let menuHtml = '';
    if (reserva) {
      if (reserva.coctel) menuHtml += `<tr><td style="color:#555;padding:5px 0">Coctel</td><td style="padding:5px 0">${reserva.coctel_det || 'Si'}</td></tr>`;
      if (reserva.entrantes) {
        try {
          const entArr = JSON.parse(reserva.entrantes || '[]');
          if (Array.isArray(entArr) && entArr.some(e => e.texto)) {
            const conTexto = entArr.filter(e => e.texto);
            if (conTexto.length === 1) {
              menuHtml += `<tr style="border-top:1px solid #d0eada"><td style="color:#555;padding:5px 0">Entrante</td><td style="padding:5px 0">${conTexto[0].texto}${conTexto[0].compartir ? ' (para compartir)' : ''}</td></tr>`;
            } else {
              conTexto.forEach((e, i) => {
                menuHtml += `<tr style="border-top:1px solid #d0eada"><td style="color:#555;padding:5px 0">Entrante ${i+1}</td><td style="padding:5px 0">${e.texto}${e.compartir ? ' (para compartir)' : ''}</td></tr>`;
              });
            }
          } else {
            menuHtml += `<tr style="border-top:1px solid #d0eada"><td style="color:#555;padding:5px 0">Entrantes</td><td style="padding:5px 0">${entrantesToTexto(reserva.entrantes)}</td></tr>`;
          }
        } catch(ex) {
          menuHtml += `<tr style="border-top:1px solid #d0eada"><td style="color:#555;padding:5px 0">Entrantes</td><td style="padding:5px 0">${reserva.entrantes}</td></tr>`;
        }
      }
      if (reserva.pescado) menuHtml += `<tr style="border-top:1px solid #d0eada"><td style="color:#555;padding:5px 0">Pescado</td><td style="padding:5px 0">${reserva.pescado}</td></tr>`;
      if (reserva.sorbete) menuHtml += `<tr style="border-top:1px solid #d0eada"><td style="color:#555;padding:5px 0">Sorbete</td><td style="padding:5px 0">${reserva.sorbete}</td></tr>`;
      if (reserva.carne) menuHtml += `<tr style="border-top:1px solid #d0eada"><td style="color:#555;padding:5px 0">Carne</td><td style="padding:5px 0">${reserva.carne}</td></tr>`;
      if (reserva.postre) menuHtml += `<tr style="border-top:1px solid #d0eada"><td style="color:#555;padding:5px 0">Postre</td><td style="padding:5px 0">${reserva.postre}</td></tr>`;
    }

    // Comensales
    const paxTotal = reserva ? (reserva.ninos > 0 ? `${reserva.pax} adultos + ${reserva.ninos} ninos` : `${reserva.pax} personas`) : '---';

    html = emailHeader('Plaza Confirmada', 'Tu servicio esta reservado', '#0f5132') + `
    <p style="font-size:15px;margin-bottom:6px">Hola <strong>${extra.nombre}</strong>,</p>
    <p style="font-size:13px;color:#444;line-height:1.8">Tu plaza esta <strong>confirmada</strong> para el siguiente servicio. Lee con atencion todos los detalles:</p>

    <div style="background:#f0f7f3;border-radius:8px;padding:16px 20px;margin:20px 0;border:1px solid #a8d5bc">
      <p style="font-size:12px;font-weight:700;color:#0f5132;margin:0 0 10px;text-transform:uppercase;letter-spacing:1px">Datos del servicio</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr><td style="color:#555;padding:6px 0;width:42%">Tipo de evento</td><td style="padding:6px 0"><strong>${reserva ? (reserva.tipo_evento || 'Evento') : '---'}</strong></td></tr>
        <tr style="border-top:1px solid #d0eada"><td style="color:#555;padding:6px 0">Fecha</td><td style="padding:6px 0"><strong>${fechaStr}</strong></td></tr>
        <tr style="border-top:1px solid #d0eada"><td style="color:#555;padding:6px 0">Hora del evento</td><td style="padding:6px 0"><strong>${reserva ? (reserva.hora || '---') : '---'}</strong></td></tr>
        <tr style="border-top:1px solid #d0eada;background:#e8f5e9"><td style="color:#1b5e20;padding:8px;font-weight:700">&#9201; Tu hora de llegada</td><td style="padding:8px;color:#1b5e20;font-weight:700">${asignacion.hora_convocatoria || '---'} (15 min antes)</td></tr>
        <tr style="border-top:1px solid #d0eada"><td style="color:#555;padding:6px 0">Salon</td><td style="padding:6px 0"><strong>${reserva ? (reserva.salon || '---') : '---'}</strong></td></tr>
        <tr style="border-top:1px solid #d0eada"><td style="color:#555;padding:6px 0">Lugar</td><td style="padding:6px 0">Restaurante Don Fadrique · Palacio Conde de Aldana</td></tr>
        <tr style="border-top:1px solid #d0eada"><td style="color:#555;padding:6px 0">Comensales</td><td style="padding:6px 0"><strong>${paxTotal}</strong></td></tr>
        ${reserva && reserva.montaje ? `<tr style="border-top:1px solid #d0eada"><td style="color:#555;padding:6px 0">Montaje</td><td style="padding:6px 0">${reserva.montaje}</td></tr>` : ''}
      </table>
    </div>

    ${menuHtml ? `
    <div style="background:#f9f9f7;border-radius:8px;padding:16px 20px;margin:16px 0;border:1px solid #e8e0d6">
      <p style="font-size:12px;font-weight:700;color:#b8965a;margin:0 0 10px;text-transform:uppercase;letter-spacing:1px">Menu del evento</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">${menuHtml}</table>
    </div>` : ''}

    ${reserva && reserva.alergias ? `
    <div style="background:#fce4e4;border-radius:8px;padding:12px 16px;margin:16px 0;border:1px solid #f5c6cb">
      <p style="font-size:13px;color:#842029;margin:0;font-weight:700">&#9888; ALERGIAS DETECTADAS: ${reserva.alergias}</p>
    </div>` : ''}

    <div style="background:#1a1a2e;border-radius:8px;padding:20px;margin:20px 0">
      <p style="font-size:13px;font-weight:700;color:#b8965a;margin:0 0 14px;text-transform:uppercase;letter-spacing:1px">&#128203; Protocolo de servicio Don Fadrique</p>

      <p style="font-size:12px;font-weight:700;color:#e0c068;margin:12px 0 6px;text-transform:uppercase;letter-spacing:1px">Antes del servicio</p>
      <ul style="font-size:12px;color:#ddd;line-height:2;margin:0;padding-left:18px">
        <li>Presentarse <strong style="color:white">15 minutos antes</strong> de la hora indicada para el briefing con el responsable</li>
        <li>Uniforme: camisa blanca planchada, pantalon negro, zapatos negros cerrados</li>
        <li>Sin joyeria visible ni perfume excesivo</li>
        <li>Revisar el menu del evento y preguntar por las alergias detectadas</li>
      </ul>

      <p style="font-size:12px;font-weight:700;color:#e0c068;margin:12px 0 6px;text-transform:uppercase;letter-spacing:1px">Durante el servicio</p>
      <ul style="font-size:12px;color:#ddd;line-height:2;margin:0;padding-left:18px">
        <li>Las bebidas se sirven siempre por la <strong style="color:white">derecha</strong> del comensal</li>
        <li>Los platos se sirven y retiran por la <strong style="color:white">izquierda</strong></li>
        <li>Nunca cruzar los brazos delante del comensal al colocar cubiertos</li>
        <li>El pan se sirve por la izquierda</li>
        <li>Orden de servicio: senoras primero, luego caballeros</li>
        <li>Usar siempre bandeja para transportar cristaleria</li>
        <li>Comunicacion entre personal: discreta y en voz baja</li>
        <li>Movil <strong style="color:white">apagado o en silencio</strong>, nunca visible durante el servicio</li>
        <li>Rellenar copas de agua y vino sin esperar a que esten vacias</li>
        <li>Retirar platos solo cuando <strong style="color:white">todos los comensales</strong> de la mesa hayan terminado</li>
      </ul>

      <p style="font-size:12px;font-weight:700;color:#e0c068;margin:12px 0 6px;text-transform:uppercase;letter-spacing:1px">Actitud</p>
      <ul style="font-size:12px;color:#ddd;line-height:2;margin:0;padding-left:18px">
        <li>Trato siempre de <strong style="color:white">usted</strong> salvo indicacion contraria</li>
        <li>Sonrisa natural, postura erguida</li>
        <li>Ante cualquier incidencia: mantener la calma y avisar al responsable</li>
        <li>Nunca decir no se — buscar la respuesta y volver con ella</li>
      </ul>

      <p style="font-size:12px;font-weight:700;color:#e0c068;margin:12px 0 6px;text-transform:uppercase;letter-spacing:1px">Al finalizar</p>
      <ul style="font-size:12px;color:#ddd;line-height:2;margin:0;padding-left:18px">
        <li>No abandonar el puesto sin autorizacion del responsable</li>
        <li>Colaborar en el recogido si se requiere</li>
      </ul>
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
      tipo_evento,montaje,protocolo,coctel,coctel_det,entrantes,pescado,sorbete,carne,postre,platos_principales,
      vino_blanco,vino_tinto,vino_cava,vino_extra,copas,fianza,fianza_imp,conf_env,rec_env,menus_detalle,
      ninos,menu_ninos_entrante,menu_ninos_principal,menu_ninos_postre,menu_ninos_precio)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const result = stmt.run(
    d.tipo, d.salon, d.mesa||null, d.fecha, d.hora, d.nombre, d.tel||'', d.email||'', d.pax,
    d.menu||'', d.alergias||'', d.obs||'', d.estado||'pendiente',
    d.tipo_evento||'', d.montaje||'imperial', parseBool(d.protocolo),
    parseBool(d.coctel), d.coctel_det||'', d.entrantes||'', d.pescado||'',
    parseBool(d.sorbete), d.carne||'', d.postre||'', d.platos_principales||'',
    d.vino_blanco||'', d.vino_tinto||'', d.vino_cava||'',
    d.vino_extra||'', parseBool(d.copas),
    parseBool(d.fianza), d.fianza_imp||null, 0, 0,
    d.menus_detalle||null,
    d.ninos||0, d.menu_ninos_entrante||null, d.menu_ninos_principal||null,
    d.menu_ninos_postre||null, d.menu_ninos_precio||null
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
    entrantes=?,pescado=?,sorbete=?,carne=?,postre=?,platos_principales=?,vino_blanco=?,vino_tinto=?,vino_cava=?,
    vino_extra=?,copas=?,fianza=?,fianza_imp=?,menus_detalle=?,
    ninos=?,menu_ninos_entrante=?,menu_ninos_principal=?,menu_ninos_postre=?,menu_ninos_precio=?
    WHERE id=?
  `).run(
    d.tipo, d.salon, d.mesa||null, d.fecha, d.hora, d.nombre, d.tel||'', d.email||'', d.pax,
    d.menu||'', d.alergias||'', d.obs||'', d.estado||'pendiente',
    d.tipo_evento||'', d.montaje||'imperial', parseBool(d.protocolo),
    parseBool(d.coctel), d.coctel_det||'', d.entrantes||'', d.pescado||'',
    parseBool(d.sorbete), d.carne||'', d.postre||'', d.platos_principales||'',
    d.vino_blanco||'', d.vino_tinto||'', d.vino_cava||'',
    d.vino_extra||'', parseBool(d.copas),
    parseBool(d.fianza), d.fianza_imp||null, d.menus_detalle||null,
    d.ninos||0, d.menu_ninos_entrante||null, d.menu_ninos_principal||null,
    d.menu_ninos_postre||null, d.menu_ninos_precio||null,
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

  if (req.params.tipo === 'orden') {
    const cfg = getConfig();
    if (!cfg.email_smtp || !cfg.email_pass) return res.json({ ok: false, msg: 'SMTP no configurado' });
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 587, secure: false,
      auth: { user: cfg.email_smtp, pass: cfg.email_pass }
    });
    const ev = { boda: 'Boda', comunion: 'Comunion', familiar: 'Grupo familiar', turista: 'Grupo turista' };
    const salones = { bodega: 'Salon Bodega', cristalera: 'Salon Cristalera', cayetana: 'Salon Cayetana', cupula: 'Salon Cupula' };
    const fecha = new Date(r.fecha + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

    const seccion = (titulo, color) => `
      <tr><td colspan="2" style="padding:14px 0 6px">
        <div style="font-size:10px;letter-spacing:2px;color:${color||'#b8965a'};font-weight:700;border-bottom:1px solid #f0ede8;padding-bottom:4px">${titulo}</div>
      </td></tr>`;
    const fila = (label, val, color) => `<tr>
      <td style="color:#888;padding:4px 0;width:38%;font-size:13px">${label}</td>
      <td style="padding:4px 0;font-size:13px${color?';color:'+color:''}"><strong>${val}</strong></td>
    </tr>`;

    let filas = seccion('DATOS DEL EVENTO');
    filas += fila('Cliente', r.nombre);
    if (r.tel) filas += fila('Telefono', r.tel);
    if (r.email) filas += fila('Email', r.email);
    filas += fila('Tipo', ev[r.tipo_evento] || r.tipo_evento);
    filas += fila('Fecha', fecha);
    filas += fila('Hora', r.hora);
    filas += fila('Salon', salones[r.salon] || r.salon);
    if (r.montaje) filas += fila('Montaje', r.montaje);
    filas += fila('Adultos', r.pax);
    if (r.ninos > 0) filas += fila('Niños', r.ninos);
    filas += fila('Total comensales', r.pax + (r.ninos || 0));

    filas += seccion('MENU');
    if (r.coctel) filas += fila('Coctel previo', r.coctel_det || 'Si', '#b8965a');
    if (r.copas) filas += fila('Copas de cava', 'Si', '#b8965a');
    if (r.entrantes) {
      try {
        const entArr = JSON.parse(r.entrantes || '[]');
        if (Array.isArray(entArr) && entArr.some(e => e.texto)) {
          const conTexto = entArr.filter(e => e.texto);
          if (conTexto.length === 1) {
            filas += fila('Entrante', conTexto[0].texto + (conTexto[0].compartir ? ' (para compartir)' : ''));
          } else {
            conTexto.forEach((e, i) => {
              filas += fila('Entrante ' + (i+1), e.texto + (e.compartir ? ' (para compartir)' : ''));
            });
          }
        } else {
          filas += fila('Entrantes', entrantesToTexto(r.entrantes));
        }
      } catch(ex) { filas += fila('Entrantes', r.entrantes); }
    }
    if (r.platos_principales) {
      if (r.sorbete) filas += fila('Sorbete', 'Si');
      try {
        const ppArr = JSON.parse(r.platos_principales || '[]');
        ppArr.filter(p => p.texto).forEach(p => {
          filas += fila('Plato principal', p.texto + (p.cantidad ? ' (' + p.cantidad + ' pax)' : ''));
        });
      } catch(e) {}
    } else {
      if (r.pescado) filas += fila('Pescado', r.pescado);
      if (r.sorbete) filas += fila('Sorbete', 'Si');
      if (r.carne) filas += fila('Carne', r.carne);
    }
    if (r.postre) filas += fila('Postre', r.postre);

    if (r.ninos > 0 && (r.menu_ninos_entrante || r.menu_ninos_principal || r.menu_ninos_postre)) {
      filas += seccion('MENU NIÑOS (' + r.ninos + ' pax)', '#3c3489');
      if (r.menu_ninos_entrante) filas += fila('Entrante', r.menu_ninos_entrante);
      if (r.menu_ninos_principal) filas += fila('Plato principal', r.menu_ninos_principal);
      if (r.menu_ninos_postre) filas += fila('Postre', r.menu_ninos_postre);
      if (r.menu_ninos_precio) filas += fila('Precio por niño', r.menu_ninos_precio.toFixed(2) + ' €');
      if (r.menu_ninos_precio) filas += fila('Total menu niños', (r.menu_ninos_precio * r.ninos).toFixed(2) + ' €', '#2c7a3a');
    }

    filas += seccion('BODEGA');
    if (r.vino_blanco) filas += fila('Vino blanco', r.vino_blanco);
    if (r.vino_tinto) filas += fila('Vino tinto', r.vino_tinto);
    if (r.vino_cava) filas += fila('Cava', r.vino_cava);
    if (r.vino_extra) filas += fila('Otro', r.vino_extra);

    if (r.alergias) {
      filas += seccion('⚠ ALERGIAS / INTOLERANCIAS', '#dc3545');
      filas += fila('Alergias', r.alergias, '#dc3545');
    }
    if (r.fianza) {
      filas += seccion('FIANZA');
      filas += fila('Importe', r.fianza_imp ? r.fianza_imp.toFixed(2) + ' €' : 'Pendiente definir');
    }
    if (r.obs) {
      filas += seccion('OBSERVACIONES');
      filas += fila('Notas', r.obs);
    }

    const htmlOrden = `<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#f5f3ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:0 auto;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)">
  <div style="background:#b8965a;padding:28px 24px;text-align:center">
    <div style="font-size:10px;letter-spacing:3px;color:rgba(255,255,255,0.7)">R E S T A U R A N T E</div>
    <div style="font-family:Georgia,serif;font-size:28px;color:#fff;letter-spacing:3px;margin:4px 0">Don Fadrique</div>
    <div style="font-size:10px;letter-spacing:2px;color:rgba(255,255,255,0.7)">P A L A C I O · C O N D E · D E · A L D A N A</div>
    <div style="margin-top:12px;display:inline-block;background:rgba(255,255,255,0.15);border-radius:20px;padding:4px 16px">
      <span style="font-size:12px;color:#fff;font-weight:600;letter-spacing:1px">ORDEN DE SERVICIO — ADMINISTRACION</span>
    </div>
  </div>
  <div style="background:#fff;padding:28px 24px;border:1px solid #e0dcd6;border-top:none">
    <table style="width:100%;border-collapse:collapse">${filas}</table>
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid #f0ede8;text-align:center">
      <p style="font-size:11px;color:#aaa;margin:0">Restaurante Don Fadrique · NIMANSANMON S.L. · CIF: B37297223</p>
      <p style="font-size:11px;color:#aaa;margin:4px 0">${cfg.tel_rest || '920 37 00 51'} · Alba de Tormes, Salamanca</p>
    </div>
  </div>
</div></body></html>`;

    try {
      await transporter.sendMail({
        from: `"Restaurante Don Fadrique" <${cfg.email_smtp}>`,
        to: 'oscar@donfadrique.com',
        cc: 'nicocuadri@icloud.com, fincalamaza@gmail.com',
        subject: `Orden de servicio — ${r.nombre} — ${fecha}`,
        html: htmlOrden
      });
      return res.json({ ok: true });
    } catch(e) {
      return res.json({ ok: false, msg: e.message });
    }
  }

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
    (e.actitud+e.capacidad+e.rigor+e.conocimientos+e.aspecto)/5.0 as puntuacion,
    r.hora as hora_reserva
    FROM extras_reservas er
    JOIN extras e ON e.id = er.extra_id
    LEFT JOIN reservas r ON r.id = er.reserva_id
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
  delete safe.pin_admin;
  res.json(safe);
});

app.post('/api/config', (req, res) => {
  const allowed = ['email_rest', 'tel_rest', 'dir_rest', 'email_smtp', 'recordatorios', 'dias_seguimiento', 'max_seguimientos', 'resumen_diario', 'email_resumen'];
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
// Migrar tabla presupuestos para añadir firmas si no existen
try { db.exec("ALTER TABLE presupuestos ADD COLUMN firma_restaurante TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE presupuestos ADD COLUMN firma_cliente TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE presupuestos ADD COLUMN pago TEXT"); } catch(e) {}

// Nuevo endpoint: guardar firmas
app.post('/api/presupuestos/:id/firmas', (req, res) => {
  const { firma_restaurante, firma_cliente } = req.body;
  db.prepare('UPDATE presupuestos SET firma_restaurante=?, firma_cliente=? WHERE id=?')
    .run(firma_restaurante||null, firma_cliente||null, req.params.id);
  res.json({ ok: true });
});

// Nuevo endpoint: obtener presupuestos de una reserva
app.get('/api/presupuestos/reserva/:id', (req, res) => {
  const rows = db.prepare('SELECT * FROM presupuestos WHERE reserva_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(rows);
});

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
  console.log('POST presupuestos reserva_id:', req.body.reserva_id);
  const d = req.body;
  // Si ya existe un presupuesto para esta reserva, actualizar en vez de insertar
  const existente = d.reserva_id ? db.prepare('SELECT id FROM presupuestos WHERE reserva_id = ? ORDER BY id DESC LIMIT 1').get(d.reserva_id) : null;

  let presupId;
  if (existente) {
    db.prepare(`UPDATE presupuestos SET numero=?, cliente=?, fecha_evento=?, salon=?, pax=?, tipo_evento=?, firmante=?, lineas=?, subtotal=?, iva=?, total=?, obs=? WHERE id=?`)
      .run(d.numero, d.cliente, d.fecha_evento, d.salon, d.pax, d.tipo_evento, d.firmante, JSON.stringify(d.lineas), d.subtotal, d.iva, d.total, d.obs||'', existente.id);
    if (d.pago) db.prepare('UPDATE presupuestos SET pago=? WHERE id=?').run(d.pago, existente.id);
    presupId = existente.id;
  } else {
    const result = db.prepare(`INSERT INTO presupuestos (numero, reserva_id, cliente, fecha_evento, salon, pax, tipo_evento, firmante, lineas, subtotal, iva, total, obs, enviado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`)
      .run(d.numero, d.reserva_id||null, d.cliente, d.fecha_evento, d.salon, d.pax, d.tipo_evento, d.firmante, JSON.stringify(d.lineas), d.subtotal, d.iva, d.total, d.obs||'');
    if (d.pago) db.prepare('UPDATE presupuestos SET pago=? WHERE id=?').run(d.pago, result.lastInsertRowid);
    presupId = result.lastInsertRowid;
  }

  const presup = db.prepare('SELECT * FROM presupuestos WHERE id = ?').get(presupId);
  res.json({ ok: true, presupuesto: presup });
});

app.delete('/api/presupuestos/:id', (req, res) => {
  db.prepare('DELETE FROM presupuestos WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/presupuestos/:id/enviar', async (req, res) => {
  console.log('Enviando presupuesto id:', req.params.id);
  const presup = db.prepare('SELECT * FROM presupuestos WHERE id = ?').get(req.params.id);
  if (!presup) return res.json({ ok: false, msg: 'Presupuesto no encontrado' });
  const reserva = db.prepare('SELECT * FROM reservas WHERE id = ?').get(presup.reserva_id);
  const emailCliente = reserva ? reserva.email : null;
  let lineas = [];
  try { lineas = JSON.parse(presup.lineas || '[]'); } catch(e) {}
  try {
    await enviarEmailPresupuesto(presup, emailCliente, lineas);
    db.prepare('UPDATE presupuestos SET enviado = 1 WHERE id = ?').run(presup.id);
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: false, msg: e.message });
  }
});

async function generarPDFPresupuesto(presup, lineas) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const gold = '#b8965a';
    const dark = '#2c2c2c';
    const gray = '#666666';
    const lightgray = '#f5f2ee';

    const fechaEvento = new Date(presup.fecha_evento + 'T12:00:00');
    const fecha = fechaEvento.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    const dia = fechaEvento.toLocaleDateString('es-ES', { day: 'numeric' });
    const mes = fechaEvento.toLocaleDateString('es-ES', { month: 'long' });
    const anio = fechaEvento.getFullYear();

    // Cabecera dorada
    doc.rect(50, 50, 495, 80).fill(gold);
    doc.fillColor('#fff').fontSize(20).font('Helvetica-Bold').text('DON FADRIQUE', 65, 65);
    doc.fontSize(8).font('Helvetica').text('R E S T A U R A N T E · A L B A D E T O R M E S', 65, 88);
    doc.fontSize(16).font('Helvetica-Bold').text('PRESUPUESTO', 380, 65, { width: 150, align: 'right' });
    doc.fontSize(11).font('Helvetica').text('Nº ' + presup.numero, 380, 88, { width: 150, align: 'right' });

    // Logos bajo la cabecera
    let logoY = 140;
    try {
      const michelin = path.join(LOGOS_DIR, 'michelin.jpg');
      const repsol = path.join(LOGOS_DIR, 'repsol.jpg');
      const tierra = path.join(LOGOS_DIR, 'tierra.png');
      if (fs.existsSync(michelin)) doc.image(michelin, 65, logoY, { height: 38 });
      if (fs.existsSync(repsol)) doc.image(repsol, 130, logoY, { height: 38 });
      if (fs.existsSync(tierra)) doc.image(tierra, 200, logoY, { height: 38 });
    } catch(e) {}

    // Datos cliente
    doc.fillColor(dark).fontSize(9).font('Helvetica');
    doc.rect(50, 190, 495, 55).fill(lightgray);
    doc.fillColor(gray).text('CLIENTE', 65, 200).text('FECHA EVENTO', 240, 200).text('PERSONAS', 420, 200);
    doc.fillColor(dark).fontSize(11).font('Helvetica-Bold');
    doc.text(presup.cliente, 65, 213).text(fecha, 240, 213).text(presup.pax + ' pax', 420, 213);

    // Tabla líneas
    let y = 265;
    doc.rect(50, y, 495, 22).fill(lightgray);
    doc.fillColor(gray).fontSize(8).font('Helvetica');
    doc.text('CONCEPTO', 65, y + 7).text('CANT.', 340, y + 7, { width: 50, align: 'right' })
       .text('PRECIO UNIT.', 395, y + 7, { width: 70, align: 'right' })
       .text('TOTAL', 465, y + 7, { width: 70, align: 'right' });
    y += 22;

    lineas.forEach((l, i) => {
      if (i % 2 === 0) doc.rect(50, y, 495, 20).fill('#fafaf8');
      doc.fillColor(dark).fontSize(10).font('Helvetica');
      doc.text(l.desc || '', 65, y + 5, { width: 270 })
         .text(String(l.qty || 0), 340, y + 5, { width: 50, align: 'right' })
         .text((l.precio || 0).toFixed(2) + ' \u20ac', 395, y + 5, { width: 70, align: 'right' })
         .text(((l.qty || 0) * (l.precio || 0)).toFixed(2) + ' \u20ac', 465, y + 5, { width: 70, align: 'right' });
      y += 20;
    });

    // Totales
    y += 10;
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#e0dcd6').stroke();
    y += 10;
    doc.fillColor(gray).fontSize(10).font('Helvetica');
    doc.text('Subtotal:', 380, y).fillColor(dark).text(presup.subtotal.toFixed(2) + ' \u20ac', 460, y, { width: 80, align: 'right' });
    y += 18;
    doc.fillColor(gray).text('IVA (10%):', 380, y).fillColor(dark).text(presup.iva.toFixed(2) + ' \u20ac', 460, y, { width: 80, align: 'right' });
    y += 5;
    doc.moveTo(380, y + 8).lineTo(545, y + 8).strokeColor(gold).lineWidth(1.5).stroke();
    y += 14;
    doc.fillColor(dark).fontSize(13).font('Helvetica-Bold');
    doc.text('TOTAL:', 380, y).text(presup.total.toFixed(2) + ' \u20ac', 460, y, { width: 80, align: 'right' });
    doc.lineWidth(1);

    // Condiciones
    y += 35;
    doc.rect(50, y, 495, presup.obs ? 90 : 70).fill('#f9f9f7');
    doc.fillColor(gray).fontSize(9).font('Helvetica');
    doc.text('NIMANSANMON S.L.  ·  CIF: B37297223', 65, y + 10);
    if (presup.pago) doc.text('Forma de pago: ' + presup.pago, 65, y + 23);
    doc.text('El número de comensales facturados será el indicado 7 días antes del banquete.', 65, y + 36, { width: 460 });
    doc.text('Validez 30 días. Precios sin IVA (10%).', 65, y + 49);
    if (presup.obs) doc.text('Obs: ' + presup.obs, 65, y + 62, { width: 460 });

    // Firmas
    y += presup.obs ? 105 : 85;
    doc.fillColor('#555').fontSize(10).font('Helvetica').text(
      'En Alba de Tormes, a ' + dia + ' de ' + mes + ' de ' + anio,
      50, y, { align: 'center', width: 495 }
    );
    y += 25;

    const firmaPromises = [];

    // Firma restaurante
    const xRest = 65;
    const xCli = 310;
    const wFirma = 220;

    doc.fillColor(gray).fontSize(8).font('Helvetica');
    doc.text('FIRMA DEL RESTAURANTE', xRest, y, { width: wFirma, align: 'center' });
    doc.text('FIRMA DEL CLIENTE', xCli, y, { width: wFirma, align: 'center' });
    y += 12;

    const drawFirmaBox = (x, nombre, yPos) => {
      doc.rect(x, yPos, wFirma, 55).stroke('#cccccc');
      doc.fillColor(gray).fontSize(9).font('Helvetica').text(nombre, x, yPos + 60, { width: wFirma, align: 'center' });
    };

    const loadFirma = (dataUrl, x, yPos) => {
      if (!dataUrl) return Promise.resolve();
      try {
        const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        const buf = Buffer.from(base64, 'base64');
        doc.image(buf, x + 5, yPos + 3, { width: wFirma - 10, height: 49, fit: [wFirma - 10, 49] });
      } catch(e) {}
      return Promise.resolve();
    };

    drawFirmaBox(xRest, presup.firmante || 'Don Fadrique', y);
    drawFirmaBox(xCli, presup.cliente, y);
    loadFirma(presup.firma_restaurante, xRest, y);
    loadFirma(presup.firma_cliente, xCli, y);

    doc.end();
  });
}

async function enviarEmailPresupuesto(presup, emailCliente, lineas) {
  const cfg = getConfig();
  if (!cfg.email_smtp || !cfg.email_pass) throw new Error('SMTP no configurado');

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: cfg.email_smtp, pass: cfg.email_pass }
  });

  const fecha = new Date(presup.fecha_evento + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  const destinatarios = ['oscar@donfadrique.com'];
  if (emailCliente) destinatarios.unshift(emailCliente);
  const copias = 'nicocuadri@hotmail.com, fincalamaza@gmail.com';

  // Generar PDF
  const pdfBuffer = await generarPDFPresupuesto(presup, lineas);

  const htmlBody = `<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#f5f3ef;font-family:sans-serif">
<div style="max-width:560px;margin:0 auto;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)">
  <div style="background:#b8965a;padding:28px 24px;text-align:center">
    <div style="font-size:10px;letter-spacing:3px;color:rgba(255,255,255,0.7)">R E S T A U R A N T E</div>
    <div style="font-family:Georgia,serif;font-size:28px;color:#fff;letter-spacing:3px;margin:4px 0">Don Fadrique</div>
    <div style="margin-top:8px;font-size:12px;color:rgba(255,255,255,0.8)">Presupuesto Nº ${presup.numero}</div>
  </div>
  <div style="background:#fff;padding:24px;border:1px solid #e0dcd6;border-top:none">
    <p style="font-size:14px;color:#333">Estimado/a <strong>${presup.cliente}</strong>,</p>
    <p style="font-size:13px;color:#555">Adjunto encontrará el presupuesto Nº <strong>${presup.numero}</strong> para el evento del <strong>${fecha}</strong>.</p>
    <p style="font-size:13px;color:#555">Importe total: <strong>${presup.total.toFixed(2)} € (IVA 10% incluido)</strong></p>
    <p style="font-size:11px;color:#aaa;margin-top:20px">Restaurante Don Fadrique · NIMANSANMON S.L. · CIF: B37297223 · Alba de Tormes</p>
  </div>
</div></body></html>`;

  await transporter.sendMail({
    from: `"Don Fadrique" <${cfg.email_smtp}>`,
    to: destinatarios.join(', '),
    cc: copias,
    subject: `Presupuesto Nº ${presup.numero} - ${presup.cliente}`,
    html: htmlBody,
    attachments: [{
      filename: `Presupuesto_${presup.numero}_${presup.cliente.replace(/\s+/g, '_')}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf'
    }]
  });
}

// ─── API PLANTILLAS DE MENÚ ───────────────────────────────────────────────────
app.get('/api/plantillas-menu', (req, res) => {
  const rows = db.prepare('SELECT * FROM plantillas_menu WHERE activo = 1 ORDER BY orden, id').all();
  res.json(rows.map(r => ({ ...r, secciones: JSON.parse(r.secciones || '[]') })));
});

app.get('/api/plantillas-menu/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM plantillas_menu WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'No encontrada' });
  res.json({ ...r, secciones: JSON.parse(r.secciones || '[]') });
});

app.put('/api/plantillas-menu/:id', (req, res) => {
  const d = req.body;
  db.prepare('UPDATE plantillas_menu SET nombre=?, secciones=?, precio_persona=? WHERE id=?')
    .run(d.nombre, JSON.stringify(d.secciones || []), d.precio_persona || 0, req.params.id);
  const r = db.prepare('SELECT * FROM plantillas_menu WHERE id = ?').get(req.params.id);
  res.json({ ...r, secciones: JSON.parse(r.secciones || '[]') });
});

// ─── API PROPUESTAS DE MENÚ (envío previo a reserva) ─────────────────────────
// Cada propuesta puede incluir varios menús a elegir (menus: array) y una lista
// de suplementos opcionales con coste adicional (extras: array de {nombre, precio}).
function parsePropuesta(r) {
  return {
    ...r,
    menus: JSON.parse(r.menus || '[]'),
    extras: JSON.parse(r.extras || '[]')
  };
}

app.get('/api/propuestas', (req, res) => {
  const rows = db.prepare("SELECT * FROM propuestas ORDER BY (fecha_evento IS NULL OR fecha_evento = ''), fecha_evento ASC, created_at DESC").all();
  res.json(rows.map(parsePropuesta));
});

app.get('/api/propuestas/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM propuestas WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'No encontrada' });
  res.json(parsePropuesta(r));
});

app.post('/api/propuestas', (req, res) => {
  const d = req.body;
  const menus = d.menus || [];
  const nombreConjunto = menus.map(m => m.plantilla_nombre).filter(Boolean).join(' / ');
  const token = crypto.randomBytes(16).toString('hex');
  const result = db.prepare(`
    INSERT INTO propuestas (plantilla_id, plantilla_nombre, cliente, telefono, email, fecha_evento, tipo_evento, pax, menus, extras, notas, estado, token)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'borrador', ?)
  `).run(
    (menus[0] && menus[0].plantilla_id) || null, nombreConjunto, d.cliente || '', d.telefono || '', d.email || '',
    d.fecha_evento || '', d.tipo_evento || '', d.pax || null,
    JSON.stringify(menus), JSON.stringify(d.extras || []), d.notas || '', token
  );
  if (d.texto_original) db.prepare('UPDATE propuestas SET texto_original = ? WHERE id = ?').run(String(d.texto_original).slice(0, 20000), result.lastInsertRowid);
  const nueva = db.prepare('SELECT * FROM propuestas WHERE id = ?').get(result.lastInsertRowid);
  res.json(parsePropuesta(nueva));
});

app.put('/api/propuestas/:id', (req, res) => {
  const d = req.body;
  const menus = d.menus || [];
  const nombreConjunto = menus.map(m => m.plantilla_nombre).filter(Boolean).join(' / ');
  db.prepare(`
    UPDATE propuestas SET plantilla_nombre=?, cliente=?, telefono=?, email=?, fecha_evento=?, tipo_evento=?, pax=?, menus=?, extras=?, notas=?
    WHERE id=?
  `).run(
    nombreConjunto, d.cliente || '', d.telefono || '', d.email || '', d.fecha_evento || '', d.tipo_evento || '',
    d.pax || null, JSON.stringify(menus), JSON.stringify(d.extras || []), d.notas || '', req.params.id
  );
  const actualizada = db.prepare('SELECT * FROM propuestas WHERE id = ?').get(req.params.id);
  res.json(parsePropuesta(actualizada));
});

app.delete('/api/propuestas/:id', (req, res) => {
  db.prepare('DELETE FROM propuestas WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Guardar las firmas (restaurante y/o cliente) de una propuesta, para dejar constancia
// de que se ha firmado en el momento de entregarla o de confirmarla en persona.
app.post('/api/propuestas/:id/firmas', (req, res) => {
  const { firma_restaurante, firma_cliente } = req.body;
  db.prepare('UPDATE propuestas SET firma_restaurante=?, firma_cliente=? WHERE id=?')
    .run(firma_restaurante || null, firma_cliente || null, req.params.id);
  res.json({ ok: true });
});

// Devuelve el texto a mostrar (PDF / menú de reserva) para un campo de un menú, según su tipo
function textoCampoMenu(s) {
  if (s.tipo === 'eleccion') {
    if (s.elegir) {
      const ops = (s.opciones || []).map((o, idx) => (o && o.trim()) ? `${idx + 1}. ${o}` : null).filter(Boolean);
      return ops.length ? ops.join('\n') : 'Por definir';
    }
    return (s.opciones && s.opciones[0]) || 'Por definir';
  }
  if (s.tipo === 'sino') return s.valor ? 'Sí' : 'No';
  if (s.tipo === 'lista') {
    const items = (s.items || []).filter(it => it && it.trim());
    return items.length ? items.map(it => `• ${it}`).join('\n') : 'Por definir';
  }
  if (s.tipo === 'barra_libre') {
    return s.valor ? `Incluida (${s.horas} · ${Number(s.precio).toFixed(2)} €/persona)` : 'No incluida';
  }
  if (s.tipo === 'recena') {
    if (!s.valor) return 'No incluida';
    const platos = (s.platos || []).filter(p => p.nombre && p.nombre.trim());
    return platos.length
      ? platos.map(p => `• ${p.nombre}${p.precio ? ` (${Number(p.precio).toFixed(2)} €)` : ''}`).join('\n')
      : 'Incluida';
  }
  return s.texto || '';
}

// Genera el PDF de una propuesta: portada + una página por cada menú incluido + página
// final con suplementos, observaciones y condiciones. Usado tanto para enviar como para
// volver a consultar la propuesta más tarde.
async function generarPDFPropuesta(prop) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const gold = '#b8965a';
    const dark = '#2c2c2c';
    const gray = '#666666';
    const baseUrl = 'https://restaurantefadrique.palaciocondealdana.com';
    const confirmUrl = `${baseUrl}/confirmar/${prop.token}`;

    const menus = typeof prop.menus === 'string' ? JSON.parse(prop.menus || '[]') : (prop.menus || []);
    const extras = typeof prop.extras === 'string' ? JSON.parse(prop.extras || '[]') : (prop.extras || []);

    let fechaTxt = '';
    if (prop.fecha_evento) {
      const fechaEvento = new Date(prop.fecha_evento + 'T12:00:00');
      fechaTxt = fechaEvento.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    function dibujarLogos(y) {
      try {
        const michelin = path.join(LOGOS_DIR, 'michelin.jpg');
        const repsol = path.join(LOGOS_DIR, 'repsol.jpg');
        const tierra = path.join(LOGOS_DIR, 'tierra.png');
        const pw2 = doc.page.width;
        if (fs.existsSync(michelin)) doc.image(michelin, pw2 / 2 - 85, y, { height: 26 });
        if (fs.existsSync(repsol)) doc.image(repsol, pw2 / 2 - 15, y, { height: 26 });
        if (fs.existsSync(tierra)) doc.image(tierra, pw2 / 2 + 50, y, { height: 26 });
      } catch(e) {}
    }

    // ── PORTADA (minimalista y elegante) ──────────────────────────────────────
    const pw = doc.page.width, ph = doc.page.height;
    doc.rect(0, 0, pw, ph).fill('#faf7f2');
    doc.rect(0, 0, pw, 5).fill(gold);
    doc.rect(0, ph - 5, pw, 5).fill(gold);

    doc.fillColor(gold).font('Helvetica-Bold').fontSize(36).text('DON FADRIQUE', 0, ph / 2 - 170, { align: 'center', width: pw });
    doc.fillColor(gray).font('Helvetica').fontSize(10)
      .text('R E S T A U R A N T E   ·   A L B A   D E   T O R M E S', 0, ph / 2 - 120, { align: 'center', width: pw });

    doc.moveTo(pw / 2 - 50, ph / 2 - 95).lineTo(pw / 2 + 50, ph / 2 - 95).strokeColor(gold).lineWidth(1).stroke();

    doc.fillColor(dark).font('Helvetica-Bold').fontSize(19).text('PROPUESTA DE MENÚ', 0, ph / 2 - 65, { align: 'center', width: pw });

    doc.fillColor(dark).font('Helvetica-Bold').fontSize(14).text(prop.cliente || '', 0, ph / 2 - 10, { align: 'center', width: pw });
    let subY = ph / 2 + 12;
    if (fechaTxt) { doc.fillColor(gray).font('Helvetica').fontSize(11).text(fechaTxt, 0, subY, { align: 'center', width: pw }); subY += 18; }
    if (prop.tipo_evento) { doc.fillColor(gray).font('Helvetica').fontSize(11).text(prop.tipo_evento, 0, subY, { align: 'center', width: pw }); }

    dibujarLogos(ph - 110);

    // ── UNA PÁGINA POR CADA MENÚ INCLUIDO ─────────────────────────────────────
    menus.forEach((menu) => {
      doc.addPage();
      doc.rect(50, 50, 495, 42).fill(gold);
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(14).text((menu.plantilla_nombre || '').toUpperCase(), 65, 65, { width: 465 });

      let y = 112;
      const secciones = menu.secciones || [];
      secciones.forEach((s) => {
        const compartirTag = (s.tipo === 'plato' && s.compartir) ? ' (para compartir)' : '';
        doc.fillColor(gold).font('Helvetica-Bold').fontSize(9.5).text((s.titulo || '').toUpperCase() + compartirTag, 65, y);
        y += 13;
        const texto = textoCampoMenu(s);
        doc.fillColor(dark).font('Helvetica').fontSize(8.5);
        const h = doc.heightOfString(texto, { width: 460 });
        doc.text(texto, 65, y, { width: 460 });
        y += h + 8;
      });

      y += 6;
      doc.moveTo(65, y).lineTo(545, y).strokeColor('#e0dcd6').stroke();
      y += 12;
      doc.fillColor(dark).font('Helvetica-Bold').fontSize(11.5)
        .text('Precio por persona: ' + Number(menu.precio_persona || 0).toFixed(2) + ' €', 65, y);
      doc.fillColor(gray).font('Helvetica').fontSize(8).text('IVA 10% no incluido  ·  Los consumos extra no incluidos en el menú se facturarán aparte', 65, y + 15);

      dibujarLogos(ph - 65);
    });

    // ── PÁGINA FINAL: SUPLEMENTOS, OBSERVACIONES, CONFIRMACIÓN Y CONDICIONES ──
    doc.addPage();
    let y = 60;
    const extrasConTexto = (extras || []).filter(e => e.nombre && e.nombre.trim());
    if (extrasConTexto.length) {
      doc.fillColor(gold).font('Helvetica-Bold').fontSize(12).text('SUPLEMENTOS OPCIONALES', 65, y);
      y += 20;
      doc.fillColor(gray).font('Helvetica').fontSize(9).text('Se añaden al precio por persona del menú elegido, si el cliente los solicita.', 65, y, { width: 460 });
      y += 20;
      extrasConTexto.forEach((e) => {
        doc.fillColor(dark).font('Helvetica').fontSize(10.5)
          .text(`•  ${e.nombre}   +${Number(e.precio || 0).toFixed(2)} €`, 65, y, { width: 460 });
        y += 18;
      });
      y += 15;
    }

    if (prop.notas) {
      doc.fillColor(gold).font('Helvetica-Bold').fontSize(11).text('OBSERVACIONES', 65, y);
      y += 16;
      doc.fillColor(dark).font('Helvetica').fontSize(9.5).text(prop.notas, 65, y, { width: 460 });
      y += doc.heightOfString(prop.notas, { width: 460 }) + 20;
    }

    if (y > 700) { doc.addPage(); y = 60; }
    doc.fillColor(gray).font('Helvetica-Oblique').fontSize(9.5)
      .text(TEXTO_ALERGIAS, 65, y, { width: 460, align: 'center' });
    y += 22;

    // Botón de confirmación (enlace a la página pública de confirmación)
    if (y > 680) { doc.addPage(); y = 60; }
    y += 10;
    const btnX = 50, btnW = 495, btnH = 42;
    doc.rect(btnX, y, btnW, btnH).fill(gold);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(12)
      .text('CONFIRMAR MI RESERVA CON ESTE MENÚ', btnX, y + 14, { width: btnW, align: 'center' });
    doc.link(btnX, y, btnW, btnH, confirmUrl);
    y += btnH + 10;
    doc.fillColor(gray).font('Helvetica').fontSize(8)
      .text('Pulse el botón para confirmar online, o visite: ' + confirmUrl, 65, y, { width: 460, align: 'center' });
    y += 24;

    if (y > 720) { doc.addPage(); y = 60; }
    doc.rect(50, y, 495, 68).fill('#f9f9f7');
    doc.fillColor(gray).font('Helvetica').fontSize(9);
    doc.text('NIMANSANMON S.L.  ·  CIF: B37297223', 65, y + 12);
    doc.text('Precios sin IVA (10% no incluido). Validez de la propuesta: 30 días.', 65, y + 28);
    doc.text('Los consumos extra no incluidos en el menú (bebidas, rondas, etc.) se facturarán aparte.', 65, y + 44);
    y += 68 + 25;

    // Firmas (restaurante y cliente) — igual que en los presupuestos, para dejar constancia
    if (y > 740) { doc.addPage(); y = 60; }
    const xRest = 65, xCli = 310, wFirma = 220;
    doc.fillColor(gray).fontSize(8).font('Helvetica');
    doc.text('FIRMA DEL RESTAURANTE', xRest, y, { width: wFirma, align: 'center' });
    doc.text('FIRMA DEL CLIENTE', xCli, y, { width: wFirma, align: 'center' });
    y += 12;

    const drawFirmaBox = (x, nombre, yPos) => {
      doc.rect(x, yPos, wFirma, 55).stroke('#cccccc');
      doc.fillColor(gray).fontSize(9).font('Helvetica').text(nombre, x, yPos + 60, { width: wFirma, align: 'center' });
    };
    const dibujarFirmaImg = (dataUrl, x, yPos) => {
      if (!dataUrl) return;
      try {
        const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        const buf = Buffer.from(base64, 'base64');
        doc.image(buf, x + 5, yPos + 3, { width: wFirma - 10, height: 49, fit: [wFirma - 10, 49] });
      } catch(e) {}
    };

    drawFirmaBox(xRest, 'Don Fadrique', y);
    drawFirmaBox(xCli, prop.cliente || '', y);
    dibujarFirmaImg(prop.firma_restaurante, xRest, y);
    dibujarFirmaImg(prop.firma_cliente, xCli, y);

    dibujarLogos(ph - 65);

    doc.end();
  });
}

async function enviarEmailPropuesta(prop, pdfBuffer) {
  const cfg = getConfig();
  if (!cfg.email_smtp || !cfg.email_pass) throw new Error('SMTP no configurado');

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: cfg.email_smtp, pass: cfg.email_pass }
  });

  const destinatarios = [];
  if (prop.email) destinatarios.push(prop.email);
  destinatarios.push('oscar@donfadrique.com');
  const copias = 'nicocuadri@hotmail.com, fincalamaza@gmail.com';

  let fechaTxt = 'por confirmar';
  if (prop.fecha_evento) {
    fechaTxt = new Date(prop.fecha_evento + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  const confirmUrl = `https://restaurantefadrique.palaciocondealdana.com/confirmar/${prop.token}`;

  const htmlBody = `<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#f5f3ef;font-family:sans-serif">
<div style="max-width:560px;margin:0 auto;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)">
  <div style="background:#b8965a;padding:28px 24px;text-align:center">
    <div style="font-size:10px;letter-spacing:3px;color:rgba(255,255,255,0.7)">R E S T A U R A N T E</div>
    <div style="font-family:Georgia,serif;font-size:28px;color:#fff;letter-spacing:3px;margin:4px 0">Don Fadrique</div>
    <div style="margin-top:8px;font-size:12px;color:rgba(255,255,255,0.8)">Propuesta de menú: ${prop.plantilla_nombre || ''}</div>
  </div>
  <div style="background:#fff;padding:24px;border:1px solid #e0dcd6;border-top:none">
    <p style="font-size:14px;color:#333">Estimado/a <strong>${prop.cliente || ''}</strong>,</p>
    <p style="font-size:13px;color:#555">Adjuntamos la propuesta de menú para el evento del <strong>${fechaTxt}</strong>.</p>
    <p style="font-size:13px;color:#555">Si está de acuerdo, puede confirmar su reserva y el menú elegido directamente pulsando el siguiente botón:</p>
    <div style="text-align:center;margin:22px 0">
      <a href="${confirmUrl}" style="background:#b8965a;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-size:14px;font-weight:bold;display:inline-block">Confirmar mi reserva</a>
    </div>
    <p style="font-size:13px;color:#555;font-style:italic;text-align:center">${TEXTO_ALERGIAS}</p>
    <p style="font-size:13px;color:#555;text-align:center">¿Alguna duda o cambio? Escríbenos por WhatsApp: <a href="${waLinkReservas('Hola, tengo una consulta sobre la propuesta de menú para ' + (prop.cliente || '') + '.')}" style="color:#2f6b4f;font-weight:bold">661 724 158</a></p>
    <p style="font-size:11px;color:#aaa;margin-top:20px">Restaurante Don Fadrique · NIMANSANMON S.L. · CIF: B37297223 · Alba de Tormes · Tel. 920 37 00 51</p>
  </div>
</div></body></html>`;

  await transporter.sendMail({
    from: `"Don Fadrique" <${cfg.email_smtp}>`,
    to: destinatarios.join(', '),
    cc: copias,
    subject: `Propuesta de menú - ${prop.plantilla_nombre || ''} - ${prop.cliente || ''}`,
    html: htmlBody,
    attachments: [{
      filename: `Propuesta_${(prop.cliente||'cliente').replace(/\s+/g, '_')}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf'
    }]
  });
}

// ─── SEGUIMIENTO AUTOMÁTICO DE PROPUESTAS Y RESUMEN DIARIO ─────────────────
const TEXTO_ALERGIAS = 'Todos nuestros menús se pueden adaptar a alergias e intolerancias.';
const WA_RESERVAS = '34661724158';
function waLinkReservas(texto) { return `https://wa.me/${WA_RESERVAS}?text=${encodeURIComponent(texto || '')}`; }
function hoyMadrid() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' }); }
function horaMadrid() { return +new Date().toLocaleString('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }); }
function diasDesde(fechaSql) {
  if (!fechaSql) return 0;
  const t = new Date(String(fechaSql).replace(' ', 'T') + (String(fechaSql).includes('Z') ? '' : 'Z')).getTime();
  return Math.floor((Date.now() - t) / 86400000);
}
function fechaLarga(iso) {
  return iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : 'la fecha prevista';
}
function transporterSMTP() {
  const cfg = getConfig();
  if (!cfg.email_smtp || !cfg.email_pass) return null;
  return { cfg, t: nodemailer.createTransport({ host: 'smtp.gmail.com', port: 587, secure: false, auth: { user: cfg.email_smtp, pass: cfg.email_pass } }) };
}
function propuestasPendientesSeguimiento() {
  const cfg = getConfig();
  const dias = Math.max(1, parseInt(cfg.dias_seguimiento || '3', 10));
  return db.prepare("SELECT * FROM propuestas WHERE estado = 'enviada'").all().filter(p => {
    const ref = p.ultimo_seguimiento || p.fecha_envio;
    return diasDesde(ref) >= dias && (!p.fecha_evento || p.fecha_evento >= hoyMadrid());
  });
}
async function enviarSeguimientoPropuesta(prop) {
  const sm = transporterSMTP();
  if (!sm) throw new Error('SMTP no configurado');
  if (!prop.email) throw new Error('La propuesta no tiene email del cliente');
  const confirmUrl = `https://restaurantefadrique.palaciocondealdana.com/confirmar/${prop.token}`;
  const nombre = (prop.cliente || '').split(/[\s-]/)[0] || '';
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#f5f3ef;font-family:sans-serif">
<div style="max-width:560px;margin:0 auto;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)">
  <div style="background:#b8965a;padding:22px 24px;text-align:center"><div style="font-family:Georgia,serif;font-size:26px;color:#fff;letter-spacing:3px">Don Fadrique</div></div>
  <div style="background:#fff;padding:24px;border:1px solid #e0dcd6;border-top:none;font-size:14px;color:#444;line-height:1.6">
    <p>Hola ${nombre}:</p>
    <p>Te escribimos para saber si pudiste revisar la propuesta de menú que te enviamos para el <strong>${fechaLarga(prop.fecha_evento)}</strong>. Si quieres cambiar algún plato o ajustar el número de personas, dínoslo y lo preparamos.</p>
    <div style="text-align:center;margin:22px 0"><a href="${confirmUrl}" style="background:#b8965a;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:bold;display:inline-block">Ver y confirmar la propuesta</a></div>
    <p style="text-align:center">O escríbenos por WhatsApp: <a href="${waLinkReservas('Hola, sobre la propuesta de menú para ' + (prop.cliente || '') + '...')}" style="color:#2f6b4f;font-weight:bold">661 724 158</a></p>
    <p style="font-size:13px;font-style:italic;color:#777;text-align:center">${TEXTO_ALERGIAS}</p>
    <p>Un saludo,<br>Don Fadrique</p>
  </div></div></body></html>`;
  await sm.t.sendMail({ from: `"Don Fadrique" <${sm.cfg.email_smtp}>`, to: prop.email, subject: `Tu propuesta de menú · Don Fadrique`, html });
  db.prepare("UPDATE propuestas SET seguimientos = COALESCE(seguimientos,0) + 1, ultimo_seguimiento = datetime('now') WHERE id = ?").run(prop.id);
}
async function enviarResumenDiario(enviadosHoy, estudioManuales) {
  const sm = transporterSMTP();
  const cfg = getConfig();
  if (!sm || cfg.resumen_diario === '0' || !cfg.email_resumen) return;
  const hoy = hoyMadrid();
  const max = parseInt(cfg.max_seguimientos || '2', 10);
  const props = db.prepare('SELECT * FROM propuestas').all();
  const sinRespuesta = propuestasPendientesSeguimiento().filter(p => !p.email || (p.seguimientos || 0) >= max || p.seguimiento_auto === 0);
  const borradores = props.filter(p => p.estado === 'borrador' && p.fecha_evento && p.fecha_evento >= hoy);
  const en14 = new Date(Date.now() + 14 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
  const eventos = db.prepare("SELECT * FROM reservas WHERE tipo = 'evento' AND fecha >= ? AND fecha <= ? AND (estado IS NULL OR estado != 'cancelada') ORDER BY fecha, hora").all(hoy, en14);
  const li = (t) => `<li style="margin-bottom:6px">${t}</li>`;
  const bloque = (titulo, items) => items.length ? `<h3 style="font-family:Georgia,serif;color:#8b1a2a;margin:18px 0 6px">${titulo}</h3><ul style="padding-left:18px;margin:0">${items.join('')}</ul>` : '';
  const html = [
    bloque('Seguimientos automáticos enviados hoy', enviadosHoy.map(p => li(`${p.cliente || 'Sin nombre'} · ${p.email}`))),
    bloque('Propuestas sin respuesta: llamar o escribir por WhatsApp', sinRespuesta.map(p => li(`${p.cliente || 'Sin nombre'} · evento ${fechaLarga(p.fecha_evento)} · tel. ${p.telefono || '—'} · enviada hace ${diasDesde(p.fecha_envio)} días`))),
    bloque('Presupuestos sin respuesta: llamar o escribir por WhatsApp', (estudioManuales || []).map(p => li(`${(p.cliente || 'Sin nombre')} · ${String(p.titulo || '').replace(/\*/g, '')} · ${fechaLarga(p.fecha)} · tel. ${p.telefono || '—'}`))),
    bloque('Borradores sin enviar', borradores.map(p => li(`${p.cliente || 'Sin nombre'} · ${fechaLarga(p.fecha_evento)}`))),
    bloque('Eventos de los próximos 14 días', eventos.map(r => li(`${fechaLarga(r.fecha)}${r.hora ? ' · ' + r.hora : ''} · ${r.nombre || ''} · ${r.pax || '?'} pax${r.salon ? ' · ' + r.salon : ''}`)))
  ].join('');
  if (!html) return;
  await sm.t.sendMail({
    from: `"Don Fadrique" <${sm.cfg.email_smtp}>`, to: cfg.email_resumen,
    subject: `Resumen Don Fadrique · ${fechaLarga(hoy)}`,
    html: `<div style="font-family:sans-serif;font-size:14px;color:#333;max-width:620px">${html}<p style="margin-top:22px"><a href="https://restaurantefadrique.palaciocondealdana.com" style="color:#b8965a">Abrir la app</a></p></div>`
  });
}
async function tareaDiariaPropuestas(forzar) {
  try {
    const hoy = hoyMadrid();
    const cfg = getConfig();
    if (!forzar && (cfg.ultima_tarea_diaria === hoy || horaMadrid() < 10)) return { ok: true, saltada: true };
    db.prepare('INSERT OR REPLACE INTO config (clave, valor) VALUES (?, ?)').run('ultima_tarea_diaria', hoy);
    const max = parseInt(cfg.max_seguimientos || '2', 10);
    const enviados = [];
    for (const p of propuestasPendientesSeguimiento()) {
      if (!p.email || p.seguimiento_auto === 0 || (p.seguimientos || 0) >= max) continue;
      try { await enviarSeguimientoPropuesta(p); enviados.push(p); } catch (e) { console.error('Seguimiento propuesta', p.id, e.message); }
    }
    let est = { enviados: [], manuales: [] };
    try { est = await estudioSeguimientos(); } catch (e) { console.error('estudioSeguimientos:', e.message); }
    await enviarResumenDiario(enviados.concat(est.enviados), est.manuales);
    return { ok: true, enviados: enviados.length + est.enviados.length };
  } catch (e) { console.error('tareaDiariaPropuestas:', e.message); return { ok: false, msg: e.message }; }
}

// ─── ESTUDIO: presupuestos con diseño, dossieres, platos e imágenes para redes ────
db.exec(`CREATE TABLE IF NOT EXISTS estudio_docs (
  col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
  actualizado TEXT DEFAULT (datetime('now')), usuario TEXT,
  PRIMARY KEY (col, id)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS estudio_blobs (
  id TEXT PRIMARY KEY, nombre TEXT, tipo TEXT, tamano INTEGER, creado TEXT DEFAULT (datetime('now'))
)`);
const ESTUDIO_COLS = ['presupuestos', 'plantillas', 'platos', 'dossieres', 'fotos', 'ajustes'];
const ESTUDIO_DIR = path.join(__dirname, 'estudio');
const BLOBS_DIR = path.join(path.dirname(process.env.DB_PATH || '/data/reservas.db'), 'estudio_blobs');
try { fs.mkdirSync(BLOBS_DIR, { recursive: true }); } catch (e) { console.error('No se pudo crear', BLOBS_DIR, e.message); }

(function sembrarEstudio() {
  try {
    const hay = db.prepare('SELECT COUNT(*) n FROM estudio_docs').get().n;
    const seedFile = path.join(ESTUDIO_DIR, 'seed', 'data.json');
    if (hay || !fs.existsSync(seedFile)) return;
    const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
    const ins = db.prepare('INSERT OR IGNORE INTO estudio_docs (col, id, data) VALUES (?, ?, ?)');
    db.transaction(() => {
      for (const col of Object.keys(seed.docs || {})) for (const [id, data] of Object.entries(seed.docs[col])) ins.run(col, id, JSON.stringify(data));
    })();
    for (const b of seed.blobs || []) {
      const src = path.join(ESTUDIO_DIR, 'seed', 'blobs', b.file);
      const dst = path.join(BLOBS_DIR, b.id);
      if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
      db.prepare('INSERT OR IGNORE INTO estudio_blobs (id, nombre, tipo, tamano) VALUES (?, ?, ?, ?)').run(b.id, b.nombre, b.tipo, b.tamano);
    }
    console.log('Estudio: datos iniciales cargados');
  } catch (e) { console.error('sembrarEstudio:', e.message); }
})();

function estudioLista(col) {
  return db.prepare('SELECT id, data FROM estudio_docs WHERE col = ?').all(col).map(r => ({ id: r.id, ...JSON.parse(r.data) }));
}
function estudioGuardar(col, id, data, usuario) {
  db.prepare("INSERT OR REPLACE INTO estudio_docs (col, id, data, actualizado, usuario) VALUES (?, ?, ?, datetime('now'), ?)").run(col, id, JSON.stringify(data), usuario || null);
}

app.get('/presupuestos', (req, res) => {
  if (!usuarioSesion(req)) return res.redirect('/');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(ESTUDIO_DIR, 'index.html'));
});

app.get('/api/estudio/:col', (req, res) => {
  if (!ESTUDIO_COLS.includes(req.params.col)) return res.status(404).json({ error: 'Colección desconocida' });
  res.json(estudioLista(req.params.col));
});
app.put('/api/estudio/:col/:id', (req, res) => {
  if (!ESTUDIO_COLS.includes(req.params.col)) return res.status(404).json({ error: 'Colección desconocida' });
  const data = { ...(req.body || {}) }; delete data.id;
  estudioGuardar(req.params.col, req.params.id, data, req.usuario);
  res.json({ ok: true });
});
app.delete('/api/estudio/:col/:id', (req, res) => {
  db.prepare('DELETE FROM estudio_docs WHERE col = ? AND id = ?').run(req.params.col, req.params.id);
  res.json({ ok: true });
});

app.post('/api/estudio-blob', express.raw({ type: () => true, limit: '30mb' }), (req, res) => {
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'Archivo vacío' });
  const id = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(path.join(BLOBS_DIR, id), req.body);
  let nombre = ''; try { nombre = decodeURIComponent(req.headers['x-nombre'] || ''); } catch (e) {}
  db.prepare('INSERT INTO estudio_blobs (id, nombre, tipo, tamano) VALUES (?, ?, ?, ?)').run(id, nombre, req.headers['content-type'] || 'application/octet-stream', req.body.length);
  res.json({ id, sizeBytes: req.body.length });
});
function enviarBlob(res, id, nombreDescarga) {
  if (!/^[a-f0-9]{32}$/.test(id)) return res.status(404).send('No encontrado');
  const meta = db.prepare('SELECT * FROM estudio_blobs WHERE id = ?').get(id);
  const f = path.join(BLOBS_DIR, id);
  if (!meta || !fs.existsSync(f)) return res.status(404).send('No encontrado');
  res.setHeader('Content-Type', meta.tipo || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  if (nombreDescarga) res.setHeader('Content-Disposition', `inline; filename="${String(nombreDescarga).replace(/[^\w.\- ]/g, '_')}"`);
  res.sendFile(f);
}
app.get('/_blob/:id', (req, res) => {
  if (!usuarioSesion(req)) return res.status(401).send('Sin sesión');
  enviarBlob(res, req.params.id);
});
// Enlace público para que el cliente abra el dossier desde WhatsApp
app.get('/dossier/:id', (req, res) => {
  const row = db.prepare("SELECT data FROM estudio_docs WHERE col = 'dossieres' AND id = ?").get(req.params.id);
  if (!row) return res.status(404).send('Dossier no encontrado');
  const d = JSON.parse(row.data);
  enviarBlob(res, d.assetId, d.archivo || 'Dossier_Don_Fadrique.pdf');
});

function textoAHtml(t) {
  const e = String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return e.replace(/(https?:\/\/[^\s<]+)/g, u => {
    const wa = /wa\.me\/34661724158/.test(u);
    return wa ? `<a href="${u}" style="display:inline-block;background:#2f6b4f;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:bold">Aceptar el presupuesto por WhatsApp</a>`
      : `<a href="${u}" style="color:#6e5158">${u.length > 60 ? 'Abrir enlace' : u}</a>`;
  }).replace(/\n/g, '<br>');
}
async function estudioEmail({ to, subject, body, attachments }) {
  const sm = transporterSMTP();
  if (!sm) { const e = new Error('El email del restaurante no está configurado (Config → email y contraseña).'); e.code = 'server_not_connected'; throw e; }
  const dest = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!dest.length) throw new Error('Falta el email del cliente');
  await sm.t.sendMail({
    from: `"Don Fadrique" <${sm.cfg.email_smtp}>`, to: dest.join(', '), replyTo: sm.cfg.email_rest || undefined, subject, text: body,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#2a2325;max-width:600px">${textoAHtml(body)}</div>`,
    attachments: (attachments || []).map(a => ({ filename: a.filename, content: Buffer.from(a.base64, 'base64'), contentType: a.mimeType }))
  });
}
app.post('/api/estudio-email', async (req, res) => {
  try { await estudioEmail(req.body || {}); res.json({ ok: true }); }
  catch (e) { console.error('estudio-email:', e.message); res.status(500).json({ error: e.message, code: e.code || 'error' }); }
});

// Seguimiento automático de los presupuestos del estudio (lo llama la tarea diaria)
const ESTUDIO_TXT_SEG = 'Hola {cliente}:\n\nTe escribimos para saber si pudiste revisar el presupuesto que te enviamos para {evento} el {fecha}. Si quieres cambiar algún plato o ajustar el número de personas, dínoslo y lo preparamos. Si ya te encaja, puedes aceptarlo aquí: {aceptar}\n\nUn saludo,\nDon Fadrique\nreservas@donfadrique.com · WhatsApp 650 488 113 / 661 724 158';
function estudioAjustes() {
  const r = db.prepare("SELECT data FROM estudio_docs WHERE col = 'ajustes' AND id = 'general'").get();
  return { diasSeguimiento: 3, maxSeguimientos: 2, asunto: 'Presupuesto {evento} · Don Fadrique', textoSeguimiento: ESTUDIO_TXT_SEG, ...(r ? JSON.parse(r.data) : {}) };
}
function estudioRellenar(tpl, p) {
  const plain = s => String(s || '').replace(/\*/g, '');
  const acc = `https://wa.me/${WA_RESERVAS}?text=${encodeURIComponent(`Hola, acepto el presupuesto de Don Fadrique: ${plain(p.titulo)}${p.fecha ? ' el ' + fechaLarga(p.fecha) : ''}${p.pax ? ', ' + p.pax + ' personas' : ''}${p.cliente ? '. ' + p.cliente : ''}. Ref. ${p.id}`)}`;
  return String(tpl).replace(/\{cliente\}/g, (p.cliente || '').split(' ')[0] || 'hola').replace(/\{evento\}/g, plain(p.titulo) || 'vuestro evento')
    .replace(/\{fecha\}/g, fechaLarga(p.fecha)).replace(/\{hora\}/g, p.hora ? ` a las ${p.hora} h` : '').replace(/\{aceptar\}/g, acc)
    .replace(/\{alergias\}/g, TEXTO_ALERGIAS).replace(/\{pax\}/g, p.pax || '—').replace(/\{menu\}/g, '').replace(/\{precio\}/g, '');
}
function estudioPendientes() {
  const hoy = hoyMadrid();
  return estudioLista('presupuestos').filter(p => p.estado === 'enviado' && p.proximoSeguimiento && p.proximoSeguimiento <= hoy && (!p.fecha || p.fecha >= hoy));
}
async function estudioSeguimientos() {
  const aj = estudioAjustes(), max = +aj.maxSeguimientos || 2, dias = +aj.diasSeguimiento || 3;
  const enviados = [], manuales = [];
  for (const p of estudioPendientes()) {
    if (!p.email || p.autoSeguimiento === false || (p.seguimientosEnviados || 0) >= max) { manuales.push(p); continue; }
    try {
      await estudioEmail({ to: [p.email], subject: estudioRellenar(aj.asunto, p), body: estudioRellenar(aj.textoSeguimiento || ESTUDIO_TXT_SEG, p) });
      p.seguimientosEnviados = (p.seguimientosEnviados || 0) + 1;
      const sig = new Date(hoyMadrid() + 'T12:00:00'); sig.setDate(sig.getDate() + dias);
      p.proximoSeguimiento = p.seguimientosEnviados >= max ? '' : sig.toISOString().slice(0, 10);
      p.historial = [...(p.historial || []), { at: new Date().toISOString(), txt: 'Seguimiento automático enviado por email' }];
      const { id, ...data } = p; estudioGuardar('presupuestos', id, data, 'automático');
      enviados.push({ cliente: p.cliente, email: p.email });
    } catch (e) { console.error('Seguimiento estudio', p.id, e.message); manuales.push(p); }
  }
  return { enviados, manuales };
}

setInterval(() => tareaDiariaPropuestas(false), 30 * 60 * 1000);
setTimeout(() => tareaDiariaPropuestas(false), 60 * 1000);

app.post('/api/propuestas/:id/seguimiento', async (req, res) => {
  const prop = db.prepare('SELECT * FROM propuestas WHERE id = ?').get(req.params.id);
  if (!prop) return res.json({ ok: false, msg: 'Propuesta no encontrada' });
  try { await enviarSeguimientoPropuesta(prop); res.json({ ok: true, propuesta: parsePropuesta(db.prepare('SELECT * FROM propuestas WHERE id = ?').get(prop.id)) }); }
  catch (e) { res.json({ ok: false, msg: e.message }); }
});
app.post('/api/propuestas/:id/seguimiento-auto', (req, res) => {
  db.prepare('UPDATE propuestas SET seguimiento_auto = ? WHERE id = ?').run(req.body && req.body.activo ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
app.post('/api/tarea-diaria', async (req, res) => { res.json(await tareaDiariaPropuestas(true)); });

app.post('/api/propuestas/:id/enviar', async (req, res) => {
  const prop = db.prepare('SELECT * FROM propuestas WHERE id = ?').get(req.params.id);
  if (!prop) return res.json({ ok: false, msg: 'Propuesta no encontrada' });
  try {
    const pdfBuffer = await generarPDFPropuesta(prop);
    await enviarEmailPropuesta(prop, pdfBuffer);
    db.prepare("UPDATE propuestas SET estado = 'enviada', fecha_envio = datetime('now') WHERE id = ?").run(prop.id);
    const actualizada = db.prepare('SELECT * FROM propuestas WHERE id = ?').get(prop.id);
    res.json({ ok: true, propuesta: parsePropuesta(actualizada) });
  } catch(e) {
    res.json({ ok: false, msg: e.message });
  }
});

// Ver / descargar de nuevo el PDF de una propuesta ya generada
app.get('/api/propuestas/:id/pdf', async (req, res) => {
  const prop = db.prepare('SELECT * FROM propuestas WHERE id = ?').get(req.params.id);
  if (!prop) return res.status(404).send('Propuesta no encontrada');
  try {
    const pdfBuffer = await generarPDFPropuesta(prop);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Propuesta_${prop.id}.pdf"`);
    res.send(pdfBuffer);
  } catch(e) {
    res.status(500).send('Error generando PDF');
  }
});

// Convierte una propuesta (ya decidida por el cliente) en una reserva real, incorporando
// el menú elegido (si había varios en la propuesta, se indica menu_index) + suplementos.
// Lógica compartida: crea la reserva a partir de una propuesta ya decidida (menú elegido + suplementos)
function confirmarPropuestaEnReserva(prop, d) {
  const menus = JSON.parse(prop.menus || '[]');
  const extras = JSON.parse(prop.extras || '[]');
  const menuElegido = menus[d.menu_index || 0] || menus[0];
  if (!menuElegido) return { ok: false, msg: 'La propuesta no tiene ningún menú' };

  const secciones = menuElegido.secciones || [];
  let menuTexto = `${menuElegido.plantilla_nombre || ''} (${Number(menuElegido.precio_persona || 0).toFixed(2)} €/persona)\n`;
  menuTexto += secciones.map(s => `${s.titulo}: ${textoCampoMenu(s)}`).join('\n');
  const extrasConTexto = extras.filter(e => e.nombre && e.nombre.trim());
  if (extrasConTexto.length) {
    menuTexto += '\nSuplementos: ' + extrasConTexto.map(e => `${e.nombre} (+${Number(e.precio || 0).toFixed(2)} €)`).join(', ');
  }

  const stmt = db.prepare(`
    INSERT INTO reservas (tipo, salon, mesa, fecha, hora, nombre, tel, email, pax, menu, alergias, obs, estado,
      tipo_evento, montaje, protocolo, coctel, coctel_det, entrantes, pescado, sorbete, carne, postre,
      vino_blanco, vino_tinto, vino_cava, vino_extra, copas, fianza, fianza_imp, conf_env, rec_env, menus_detalle)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?)
  `);
  const result = stmt.run(
    'evento', d.salon || null, d.mesa || null, prop.fecha_evento, d.hora || '',
    prop.cliente, prop.telefono || '', prop.email || '', d.pax || prop.pax || 0,
    menuElegido.plantilla_nombre || '', d.alergias || '', d.obs || prop.notas || '', 'pendiente',
    prop.tipo_evento || '', d.montaje || 'imperial', 0, 0, '', '', '', 0, '', '',
    d.vino_blanco || '', d.vino_tinto || '', d.vino_cava || '', d.vino_extra || '', 0,
    0, null, menuTexto
  );

  db.prepare("UPDATE propuestas SET estado = 'confirmada', reserva_id = ? WHERE id = ?").run(result.lastInsertRowid, prop.id);
  const nueva = rowToObj(db.prepare('SELECT * FROM reservas WHERE id = ?').get(result.lastInsertRowid));
  autoConvocar(nueva.fecha).catch(e => console.error('autoConvocar error:', e.message));
  return { ok: true, reserva: nueva, menuElegido };
}

app.post('/api/propuestas/:id/confirmar', (req, res) => {
  const d = req.body || {};
  const prop = db.prepare('SELECT * FROM propuestas WHERE id = ?').get(req.params.id);
  if (!prop) return res.json({ ok: false, msg: 'Propuesta no encontrada' });
  const resultado = confirmarPropuestaEnReserva(prop, d);
  res.json(resultado);
});

// ── PÁGINA PÚBLICA DE CONFIRMACIÓN (para el cliente, desde el botón del PDF/email) ──
app.get('/confirmar/:token', (req, res) => {
  const prop = db.prepare('SELECT * FROM propuestas WHERE token = ?').get(req.params.token);
  if (!prop) {
    return res.status(404).send(paginaConfirmacionHTML('Enlace no válido', '<p>Este enlace de confirmación no es válido o ha caducado.</p>'));
  }
  if (prop.estado === 'confirmada') {
    return res.send(paginaConfirmacionHTML('Reserva ya confirmada', '<p>Esta propuesta ya fue confirmada anteriormente. Si necesita algún cambio, contacte con nosotros en el <strong>920 37 00 51</strong>.</p>'));
  }
  const menus = JSON.parse(prop.menus || '[]');
  let fechaTxt = 'por confirmar';
  if (prop.fecha_evento) {
    fechaTxt = new Date(prop.fecha_evento + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  let opcionesHtml = '';
  if (menus.length > 1) {
    opcionesHtml += '<div class="campo"><label>Elija el menú que desea confirmar</label>';
    menus.forEach((m, idx) => {
      opcionesHtml += `<label class="opcion-menu"><input type="radio" name="menu_index" value="${idx}" ${idx === 0 ? 'checked' : ''}> ${m.plantilla_nombre} — ${Number(m.precio_persona || 0).toFixed(2)} €/persona</label>`;
    });
    opcionesHtml += '</div>';
  } else if (menus.length === 1) {
    opcionesHtml += `<div class="campo"><label>Menú</label><div class="valor">${menus[0].plantilla_nombre} — ${Number(menus[0].precio_persona || 0).toFixed(2)} €/persona</div><input type="hidden" name="menu_index" value="0"></div>`;
  }

  const cuerpo = `
    <p>Estimado/a <strong>${prop.cliente || ''}</strong>,</p>
    <p>Revise los datos de su evento, firme abajo y confirme su reserva.</p>
    <div class="campo"><label>Fecha del evento</label><div class="valor">${fechaTxt}</div></div>
    ${prop.tipo_evento ? `<div class="campo"><label>Tipo de evento</label><div class="valor">${prop.tipo_evento}</div></div>` : ''}
    ${opcionesHtml}
    <form method="POST" action="/confirmar/${prop.token}" id="form-confirmar">
      <div class="campo">
        <label>Firme aquí para confirmar</label>
        <canvas id="firma-canvas" width="400" height="150" style="width:100%;height:150px;border:1.5px dashed #cbb98a;border-radius:8px;background:#fdfbf7;touch-action:none"></canvas>
        <button type="button" id="btn-limpiar-firma" style="margin-top:6px;background:none;border:none;color:#b8965a;font-size:12px;cursor:pointer">Borrar y firmar de nuevo</button>
      </div>
      <input type="hidden" name="firma_cliente" id="firma_cliente_input">
      <button type="submit" class="boton" id="btn-confirmar">Confirmar mi reserva</button>
    </form>
    <p class="nota">Si tiene cualquier duda antes de confirmar, puede llamarnos al 920 37 00 51.</p>
  `;
  const script = `
    (function(){
      var canvas = document.getElementById('firma-canvas');
      var ctx = canvas.getContext('2d');
      canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight;
      ctx.strokeStyle = '#2c2c2c'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      var dibujando = false, haFirmado = false;
      function pos(e){
        var r = canvas.getBoundingClientRect();
        var p = e.touches ? e.touches[0] : e;
        return { x: p.clientX - r.left, y: p.clientY - r.top };
      }
      function empezar(e){ dibujando = true; haFirmado = true; var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); }
      function mover(e){ if(!dibujando) return; var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); }
      function terminar(){ dibujando = false; }
      canvas.addEventListener('mousedown', empezar);
      canvas.addEventListener('mousemove', mover);
      window.addEventListener('mouseup', terminar);
      canvas.addEventListener('touchstart', empezar);
      canvas.addEventListener('touchmove', mover);
      canvas.addEventListener('touchend', terminar);
      document.getElementById('btn-limpiar-firma').addEventListener('click', function(){
        ctx.clearRect(0,0,canvas.width,canvas.height); haFirmado = false;
      });
      document.getElementById('form-confirmar').addEventListener('submit', function(ev){
        if(!haFirmado){
          ev.preventDefault();
          alert('Por favor, firme en el recuadro antes de confirmar.');
          return;
        }
        document.getElementById('firma_cliente_input').value = canvas.toDataURL('image/png');
      });
    })();
  `;
  res.send(paginaConfirmacionHTML('Confirmar reserva', cuerpo, script));
});

app.post('/confirmar/:token', express.urlencoded({ extended: true, limit: '2mb' }), async (req, res) => {
  const prop = db.prepare('SELECT * FROM propuestas WHERE token = ?').get(req.params.token);
  if (!prop) {
    return res.status(404).send(paginaConfirmacionHTML('Enlace no válido', '<p>Este enlace de confirmación no es válido o ha caducado.</p>'));
  }
  if (prop.estado === 'confirmada') {
    return res.send(paginaConfirmacionHTML('Reserva ya confirmada', '<p>Esta propuesta ya fue confirmada anteriormente. Si necesita algún cambio, contacte con nosotros en el <strong>920 37 00 51</strong>.</p>'));
  }
  const menuIndex = parseInt(req.body.menu_index, 10) || 0;
  const resultado = confirmarPropuestaEnReserva(prop, { menu_index: menuIndex });
  if (!resultado.ok) {
    return res.status(400).send(paginaConfirmacionHTML('No se pudo confirmar', `<p>${resultado.msg}</p>`));
  }

  if (req.body.firma_cliente) {
    db.prepare("UPDATE propuestas SET firma_cliente = ?, fecha_confirmacion = datetime('now') WHERE id = ?")
      .run(req.body.firma_cliente, prop.id);
  }

  // Avisar a administración de que el cliente ha confirmado desde el enlace público
  try {
    const cfg = getConfig();
    if (cfg.email_smtp && cfg.email_pass) {
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com', port: 587, secure: false,
        auth: { user: cfg.email_smtp, pass: cfg.email_pass }
      });
      await transporter.sendMail({
        from: `"Don Fadrique" <${cfg.email_smtp}>`,
        to: 'oscar@donfadrique.com',
        cc: 'nicocuadri@hotmail.com, fincalamaza@gmail.com',
        subject: `✅ Reserva confirmada online - ${prop.cliente || ''}`,
        html: `<p><strong>${prop.cliente || ''}</strong> ha confirmado y firmado su reserva online con el menú <strong>${resultado.menuElegido.plantilla_nombre}</strong> para el evento del ${prop.fecha_evento || 'sin fecha'}.</p><p>Ya se ha creado la reserva en el sistema, pendiente de completar salón, hora y demás detalles. Puede ver la firma en el PDF de la propuesta, en la carpeta de Entregados.</p>`
      });
    }
  } catch(e) { console.error('Error notificando confirmación online:', e.message); }

  res.send(paginaConfirmacionHTML('¡Reserva confirmada!', '<p>Gracias, su reserva y su firma han quedado registradas. En breve nos pondremos en contacto para terminar de concretar todos los detalles.</p>'));
});

// Plantilla HTML simple y de marca para las páginas públicas de confirmación
function paginaConfirmacionHTML(titulo, cuerpoHtml, scriptExtra) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${titulo} · Don Fadrique</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:-apple-system,sans-serif;background:#f5f2ee;margin:0;padding:24px 16px;color:#2c2c2c}
    .card{max-width:480px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)}
    .top{background:#b8965a;padding:26px 20px;text-align:center;color:#fff}
    .top .marca{font-size:24px;letter-spacing:2px;margin-bottom:4px}
    .top .sub{font-size:10px;letter-spacing:2px;opacity:.8}
    .body{padding:24px 22px}
    .body h1{font-size:17px;margin:0 0 12px}
    .campo{margin-bottom:14px}
    .campo label{display:block;font-size:11px;color:#888;margin-bottom:3px;font-weight:600}
    .campo .valor{font-size:14px;font-weight:600}
    .opcion-menu{display:block;font-size:13px;padding:8px 0;border-bottom:1px solid #eee}
    .boton{width:100%;padding:13px;border:none;border-radius:10px;background:#b8965a;color:#fff;font-size:15px;font-weight:700;cursor:pointer;margin-top:8px}
    .nota{font-size:11px;color:#999;margin-top:16px}
    p{font-size:14px;line-height:1.5}
  </style></head>
  <body>
    <div class="card">
      <div class="top"><div class="marca">DON FADRIQUE</div><div class="sub">R E S T A U R A N T E &middot; A L B A  D E  T O R M E S</div></div>
      <div class="body"><h1>${titulo}</h1>${cuerpoHtml}</div>
    </div>
    ${scriptExtra ? `<script>${scriptExtra}</script>` : ''}
  </body></html>`;
}

// ─── API ALERTAS CONVOCATORIA ────────────────────────────────────────────────
// Ver alertas de convocatorias pendientes de confirmar
app.get('/api/alertas-convocatoria', (req, res) => {
  db.prepare("INSERT OR IGNORE INTO config (clave, valor) VALUES ('alertas_conv', '[]')").run();
  const row = db.prepare("SELECT valor FROM config WHERE clave = 'alertas_conv'").get();
  res.json(JSON.parse(row?.valor || '[]'));
});

// Confirmar y enviar convocatoria para una fecha
// Convocar extras seleccionados manualmente para una reserva concreta
app.post('/api/extras/convocar-reserva', async (req, res) => {
  const { reserva_id, extra_ids } = req.body;
  if (!reserva_id || !extra_ids || !extra_ids.length)
    return res.status(400).json({ error: 'Faltan datos' });

  const reserva = db.prepare('SELECT * FROM reservas WHERE id = ?').get(reserva_id);
  if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });

  const cfg = getConfig();
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: cfg.email_smtp, pass: cfg.email_pass }
  });

  const baseUrl = 'https://restaurantefadrique.palaciocondealdana.com';
  const fechaStr = new Date(reserva.fecha + 'T12:00:00').toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const horaConv = calcHoraConvocatoria(reserva.fecha);
  const resultados = [];

  for (const extra_id of extra_ids) {
    const extra = db.prepare('SELECT * FROM extras WHERE id = ?').get(extra_id);
    if (!extra || !extra.email) {
      resultados.push({ extra_id, estado: 'sin_email' });
      continue;
    }

    // Verificar que no este ya convocado para esta reserva
    const yaConvocado = db.prepare(`
      SELECT id FROM extras_reservas
      WHERE extra_id = ? AND reserva_id = ? AND estado NOT IN ('rechazado','cancelado_tardio')
    `).get(extra_id, reserva_id);

    if (yaConvocado) {
      resultados.push({ extra_id, nombre: extra.nombre, estado: 'ya_convocado' });
      continue;
    }

    // Verificar conflicto de turno el mismo dia
    const horaEvento = parseInt((reserva.hora || '00:00').split(':')[0]);
    const turnoEvento = horaEvento < 17 ? 'almuerzo' : 'cena';

    const conflicto = db.prepare(`
      SELECT er.id, r.hora FROM extras_reservas er
      JOIN reservas r ON r.id = er.reserva_id
      WHERE er.extra_id = ? AND er.fecha = ? AND er.estado IN ('convocado','confirmado','en_espera')
      AND er.reserva_id != ?
    `).all(extra_id, reserva.fecha, reserva_id);

    const hayConflicto = conflicto.some(c => {
      const h = parseInt((c.hora || '00:00').split(':')[0]);
      const turno = h < 17 ? 'almuerzo' : 'cena';
      return turno === turnoEvento;
    });

    if (hayConflicto) {
      resultados.push({ extra_id, nombre: `${extra.nombre} ${extra.apellidos}`, estado: 'conflicto_turno' });
      continue;
    }

    // Crear registro
    const ins = db.prepare(`
      INSERT INTO extras_reservas (extra_id, reserva_id, fecha, estado, hora_convocatoria, conv_env, created_at)
      VALUES (?, ?, ?, 'convocado', ?, 1, datetime('now'))
    `).run(extra_id, reserva_id, reserva.fecha, horaConv);

    const asignacion_id = ins.lastInsertRowid;

    const htmlConv = emailHeader('Convocatoria de servicio', fechaStr, '#b8965a') + `
    <p style="font-size:15px;margin-bottom:6px">Hola <strong>${extra.nombre}</strong>,</p>
    <p style="font-size:13px;color:#444;line-height:1.8">Necesitamos personal de refuerzo para el siguiente servicio y contamos contigo. Confirma tu disponibilidad lo antes posible.</p>

    <div style="background:#f9f9f7;border-radius:8px;padding:16px 20px;margin:20px 0;border:1px solid #e8e0d6">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr><td style="color:#888;padding:6px 0;width:42%">Tipo de evento</td><td style="padding:6px 0"><strong>${reserva.tipo_evento || 'Evento'}</strong></td></tr>
        <tr style="border-top:1px solid #f0ede8"><td style="color:#888;padding:6px 0">Fecha</td><td style="padding:6px 0"><strong>${fechaStr}</strong></td></tr>
        <tr style="border-top:1px solid #f0ede8"><td style="color:#888;padding:6px 0">Hora del evento</td><td style="padding:6px 0"><strong>${reserva.hora || '---'}</strong></td></tr>
        <tr style="border-top:1px solid #f0ede8"><td style="color:#888;padding:6px 0">Hora de presentacion</td><td style="padding:6px 0"><strong>${horaConv}</strong></td></tr>
        <tr style="border-top:1px solid #f0ede8"><td style="color:#888;padding:6px 0">Salon</td><td style="padding:6px 0"><strong>${reserva.salon || '---'}</strong></td></tr>
        <tr style="border-top:1px solid #f0ede8"><td style="color:#888;padding:6px 0">Lugar</td><td style="padding:6px 0"><strong>Restaurante Don Fadrique · Palacio Conde de Aldana</strong></td></tr>
        <tr style="border-top:1px solid #f0ede8"><td style="color:#888;padding:6px 0">Comensales</td><td style="padding:6px 0"><strong>${reserva.pax} personas</strong></td></tr>
      </table>
    </div>

    <p style="font-size:13px;color:#444;font-weight:600;text-align:center;margin:20px 0 8px 0">&#128071; Indica tu disponibilidad pulsando uno de los botones:</p>
    <div style="text-align:center;margin:16px 0">
      <a href="${baseUrl}/api/extras/respuesta/${asignacion_id}/si" style="display:inline-block;background:#0f5132;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;margin-right:12px;letter-spacing:.5px">&#10003;&nbsp; SI, PUEDO IR</a>
      <a href="${baseUrl}/api/extras/respuesta/${asignacion_id}/no" style="display:inline-block;background:#842029;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:.5px">&#10007;&nbsp; NO PUEDO IR</a>
    </div>

    <div style="background:#fce4e4;border-radius:8px;padding:12px 16px;margin-top:12px;border:1px solid #f5c6cb">
      <p style="font-size:12px;color:#842029;margin:0;line-height:1.7">&#9201; <strong>Esta invitacion caduca en 24 horas.</strong> Si no confirmas antes, perderas la plaza automaticamente.</p>
    </div>
    ${emailFooter(cfg)}`;

    try {
      await transporter.sendMail({
        from: `"Don Fadrique" <${cfg.email_smtp}>`,
        to: extra.email,
        subject: `Convocatoria: ${reserva.tipo_evento || 'Evento'} - ${fechaStr}`,
        html: htmlConv
      });
      resultados.push({ extra_id, nombre: `${extra.nombre} ${extra.apellidos}`, estado: 'enviado' });
    } catch(err) {
      console.error('Error convocatoria extra', extra.email, err.message);
      resultados.push({ extra_id, nombre: `${extra.nombre} ${extra.apellidos}`, estado: 'error' });
    }
  }

  res.json({ ok: true, resultados });
});

app.post('/api/extras/enviar-convocatoria/:fecha', async (req, res) => {
  const { fecha } = req.params;
  const enviados = await enviarConvocatoria(fecha).catch(e => { console.error(e); return 0; });
  res.json({ ok: true, enviados });
});

// Cancelar convocatoria pendiente (no enviar)
app.delete('/api/alertas-convocatoria/:fecha', (req, res) => {
  const { fecha } = req.params;
  // Eliminar pendientes
  db.prepare("DELETE FROM extras_reservas WHERE fecha = ? AND estado = 'pendiente_conv'").run(fecha);
  // Limpiar alerta
  const row = db.prepare("SELECT valor FROM config WHERE clave = 'alertas_conv'").get();
  const alertas = JSON.parse(row?.valor || '[]').filter(a => a.fecha !== fecha);
  db.prepare("UPDATE config SET valor = ? WHERE clave = 'alertas_conv'").run(JSON.stringify(alertas));
  res.json({ ok: true });
});

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

// ─── CRON 10 DIAS ANTES ──────────────────────────────────────────────────────
function programarConvocatorias10Dias() {
  // Revisar cada hora si hay eventos en exactamente 10 dias que necesiten convocatoria
  setInterval(async () => {
    const hoy = new Date();
    hoy.setHours(0,0,0,0);
    const en10dias = new Date(hoy);
    en10dias.setDate(en10dias.getDate() + 10);
    const fechaStr = en10dias.toISOString().slice(0,10);

    // Ver si hay reservas ese dia que necesiten extras
    const necesarios = extrasNecesarios(fechaStr);
    if (necesarios === 0) return;

    // Ver si ya hay pendientes o convocados para ese dia
    const yaHay = db.prepare("SELECT COUNT(*) as n FROM extras_reservas WHERE fecha = ? AND estado IN ('pendiente_conv','convocado','confirmado')").get(fechaStr);
    if (yaHay.n > 0) return;

    // Crear convocatoria pendiente
    await autoConvocar(fechaStr).catch(e => console.error('cron10dias error:', e.message));
    console.log(`[Cron 10 dias] Convocatoria pendiente creada para ${fechaStr}`);
  }, 60 * 60 * 1000); // cada hora
}

// ─── MINUTA PRINT ────────────────────────────────────────────────
const minutasTemp = {};

app.post('/api/minuta-temp', (req, res) => {
  const id = Date.now().toString();
  minutasTemp[id] = req.body.html;
  setTimeout(() => delete minutasTemp[id], 5 * 60 * 1000); // borrar en 5 min
  res.json({ id });
});

app.get('/minuta-print', (req, res) => {
  const html = minutasTemp[req.query.id];
  if (!html) return res.status(404).send('Minuta no encontrada');
  res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Minuta</title>'
    + '<style>*{margin:0;padding:0;box-sizing:border-box}body{background:white}'
    + '@page{size:A4 landscape;margin:8mm}'
    + '</style></head><body>'
    + html
    + '<script>setTimeout(function(){window.print();},500);<\/script>'
    + '</body></html>');
});

// ─── CATCH-ALL ────────────────────────────────────────────────────

// ═══════════════════════════════════════════
//  VISTA PERSONAL — SOLO LECTURA
// ═══════════════════════════════════════════

app.get('/personal', (req, res) => {
  res.sendFile(path.join(__dirname, 'camareros.html'));
});

app.get('/api/personal/verificar-pin', (req, res) => {
  try {
    const { pin } = req.query;
    if (!pin) return res.status(400).json({ ok: false });
    const row = db.prepare("SELECT valor FROM config WHERE clave = 'pin_personal'").get();
    let ok = false;
    if (row) { try { ok = Object.values(JSON.parse(row.valor)).includes(pin); } catch { ok = pin === row.valor; } }
    else { ok = pin === '1234'; }
    res.json({ ok });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

app.get('/api/personal/reservas-mes', (req, res) => {
  try {
    const { pin, mes, anio } = req.query;
    const row = db.prepare("SELECT valor FROM config WHERE clave = 'pin_personal'").get();
    let auth = false;
    if (row) { try { auth = Object.values(JSON.parse(row.valor)).includes(pin); } catch { auth = pin === row.valor; } }
    else { auth = pin === '1234'; }
    if (!auth) return res.status(401).json({ error: 'No autorizado' });
    const m = String(mes || (new Date().getMonth() + 1)).padStart(2, '0');
    const a = anio || new Date().getFullYear();
    const reservas = db.prepare(`
      SELECT id, tipo, salon, mesa, fecha, hora, nombre, pax, menu,
             alergias, obs, estado, tipo_evento, montaje,
             coctel, coctel_det, entrantes, pescado, sorbete, carne, postre,
             vino_blanco, vino_tinto, vino_cava,
             ninos, menu_ninos_entrante, menu_ninos_principal, menu_ninos_postre
      FROM reservas
      WHERE fecha >= ? AND fecha <= ?
        AND (estado IS NULL OR estado NOT LIKE '%cancel%')
      ORDER BY fecha ASC, hora ASC
    `).all(`${a}-${m}-01`, `${a}-${m}-31`);
    res.json(reservas);
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});



// ═══════════════════════════════════════════
//  PDFs VISTA PERSONAL
// ═══════════════════════════════════════════

const _GOLD = '#C9A84C';
const _DARK = '#1A1A1A';
const _RED  = '#C0392B';
const _MESES_PDF = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

function _pinOk(pin) {
  const row = db.prepare("SELECT valor FROM config WHERE clave = 'pin_personal'").get();
  if (!row) return false;
  try { return Object.values(JSON.parse(row.valor)).includes(pin); }
  catch { return pin === row.valor; }
}

function _fmtFecha(f) {
  if (!f) return '';
  const [y, m, d] = f.split('-');
  return `${parseInt(d)} de ${_MESES_PDF[parseInt(m)-1]} de ${y}`;
}

function _pdfCabecera(doc, titulo, subtitulo) {
  doc.rect(0, 0, 595.28, 105).fill(_DARK);
  const logos = ['logos/michelin.jpg', 'logos/repsol.jpg', 'logos/tierra.png'];
  let lx = 55;
  logos.forEach(l => {
    try { doc.image(path.join(__dirname, l), lx, 22, { height: 55, fit: [55, 55] }); lx += 65; } catch(e) {}
  });
  doc.fillColor(_GOLD).fontSize(16).font('Helvetica-Bold').text(titulo, 250, 28, { width: 295, align: 'right' });
  if (subtitulo) doc.fillColor('#aaaaaa').fontSize(9).font('Helvetica').text(subtitulo, 250, 52, { width: 295, align: 'right' });
  doc.moveTo(50, 113).lineTo(545, 113).strokeColor(_GOLD).lineWidth(1.5).stroke();
}

// Orden de servicio PDF
app.get('/api/personal/orden-pdf/:id', (req, res) => {
  try {
    const { pin } = req.query;
    if (!_pinOk(pin)) return res.status(401).json({ error: 'No autorizado' });
    const r = db.prepare('SELECT * FROM reservas WHERE id = ?').get(req.params.id);
    if (!r) return res.status(404).json({ error: 'No encontrada' });

    const PDFDoc = require('pdfkit');
    const doc = new PDFDoc({ margin: 40, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="orden_${r.id}.pdf"`);
    doc.pipe(res);

    const W = 515; // ancho útil (595 - 2*40)
    const X = 40;  // margen izquierdo

    // ── CABECERA ──────────────────────────────────────────────
    doc.rect(0, 0, 595.28, 110).fill('#1a1a1a');
    try { doc.image(path.join(__dirname,'logos/michelin.jpg'), X, 18, {height:50,fit:[50,50]}); } catch(e){}
    try { doc.image(path.join(__dirname,'logos/repsol.jpg'),   X+58, 18, {height:50,fit:[50,50]}); } catch(e){}
    try { doc.image(path.join(__dirname,'logos/tierra.png'),   X+116, 18, {height:50,fit:[50,50]}); } catch(e){}
    doc.fillColor('#c9a84c').fontSize(20).font('Helvetica-Bold')
       .text('ORDEN DE SERVICIO', 230, 22, {width:325, align:'right'});
    doc.fillColor('#fff').fontSize(14).font('Helvetica')
       .text((r.tipo_evento||'EVENTO').toUpperCase(), 230, 48, {width:325, align:'right'});
    doc.fillColor('#888').fontSize(10).font('Helvetica')
       .text('Don Fadrique · Alba de Tormes', 230, 70, {width:325, align:'right'});
    doc.moveTo(X,118).lineTo(555,118).strokeColor('#c9a84c').lineWidth(2).stroke();

    let y = 132;

    // ── FUNCIÓN helpers ───────────────────────────────────────
    const fila = (label, valor, x, yy, w) => {
      doc.rect(x, yy, w, 52).fill('#f5f0e8');
      doc.fillColor('#999').fontSize(9).font('Helvetica').text(label.toUpperCase(), x+10, yy+8, {width:w-20});
      doc.fillColor('#1a1a1a').fontSize(16).font('Helvetica-Bold').text(valor||'—', x+10, yy+22, {width:w-20});
    };
    const seccion = (titulo, color, yy) => {
      doc.rect(X, yy, W, 30).fill(color||'#1a1a1a');
      doc.fillColor('#c9a84c').fontSize(11).font('Helvetica-Bold')
         .text(titulo, X, yy+9, {width:W, align:'center'});
      return yy+30;
    };
    const lineaMenu = (label, valor, yy, par) => {
      doc.rect(X, yy, W, 34).fill(par ? '#f8f5ef' : '#fff');
      doc.fillColor('#aaa').fontSize(10).font('Helvetica').text(label.toUpperCase(), X+12, yy+6, {width:110});
      doc.fillColor('#1a1a1a').fontSize(14).font('Helvetica').text(valor, X+130, yy+9, {width:W-140});
      return yy+34;
    };

    // ── DATOS EVENTO ──────────────────────────────────────────
    // Fila 1: Cliente + Tipo
    fila('Cliente', r.nombre, X, y, W*0.6);
    fila('Tipo evento', r.tipo_evento||'Evento', X + W*0.6 + 5, y, W*0.4 - 5);
    y += 58;
    // Fila 2: Fecha + Hora + Salón
    fila('Fecha', _fmtFecha(r.fecha), X, y, W*0.5);
    fila('Hora', r.hora?r.hora.substring(0,5):'—', X + W*0.5 + 5, y, W*0.25 - 5);
    fila('Salón', r.salon||'—', X + W*0.75 + 5, y, W*0.25 - 5);
    y += 58;
    // Fila 3: Comensales + Montaje
    const paxTxt = r.ninos>0 ? `${r.pax} adultos + ${r.ninos} niños` : `${r.pax} personas`;
    fila('Comensales', paxTxt, X, y, r.montaje ? W*0.5 : W);
    if (r.montaje) fila('Montaje', r.montaje, X + W*0.5 + 5, y, W*0.5 - 5);
    y += 62;

    // ── MENÚ ──────────────────────────────────────────────────
    const platos = [
      ['Cóctel',    r.coctel&&r.coctel!=='No' ? (r.coctel_det||r.coctel) : null],
      ['Entrantes', r.entrantes], ['Pescado', r.pescado],
      ['Sorbete',   r.sorbete],  ['Carne', r.carne], ['Postre', r.postre],
    ].filter(([,v])=>v);

    if (platos.length) {
      y = seccion('— M E N Ú —', '#1a1a1a', y);
      platos.forEach(([k,v],i) => { y = lineaMenu(k, v, y, i%2===0); });
      y += 8;
    }

    // ── MENÚ INFANTIL ─────────────────────────────────────────
    if (r.ninos>0 && (r.menu_ninos_entrante||r.menu_ninos_principal||r.menu_ninos_postre)) {
      y = seccion(`— MENÚ INFANTIL  (${r.ninos} ${r.ninos===1?'niño':'niños'}) —`, '#5b2c6f', y);
      const ni = [['Entrante',r.menu_ninos_entrante],['Principal',r.menu_ninos_principal],['Postre',r.menu_ninos_postre]].filter(([,v])=>v);
      ni.forEach(([k,v],i) => {
        doc.rect(X, y, W, 34).fill(i%2===0 ? '#f3e8fa' : '#ede0f5');
        doc.fillColor('#7d3c98').fontSize(10).font('Helvetica').text(k.toUpperCase(), X+12, y+6, {width:110});
        doc.fillColor('#1a1a1a').fontSize(14).font('Helvetica').text(v, X+130, y+9, {width:W-140});
        y += 34;
      });
      y += 8;
    }

    // ── BODEGA ────────────────────────────────────────────────
    const vinos = [['Blanco',r.vino_blanco],['Tinto',r.vino_tinto],['Cava',r.vino_cava]].filter(([,v])=>v);
    if (vinos.length) {
      y = seccion('— B O D E G A —', '#1a4f7a', y);
      vinos.forEach(([k,v],i) => {
        doc.rect(X, y, W, 34).fill(i%2===0 ? '#e8f4fd' : '#d6eaf8');
        doc.fillColor('#1a4f7a').fontSize(10).font('Helvetica').text(k.toUpperCase(), X+12, y+6, {width:110});
        doc.fillColor('#1a1a1a').fontSize(14).font('Helvetica').text(v, X+130, y+9, {width:W-140});
        y += 34;
      });
      y += 8;
    }

    // ── ALERGIAS ──────────────────────────────────────────────
    if (r.alergias && r.alergias.trim()) {
      if (y > 720) { doc.addPage(); y = 40; }
      doc.rect(X, y, W, 60).fill('#fde8e8');
      doc.moveTo(X, y).lineTo(555, y).strokeColor('#c0392b').lineWidth(3).stroke();
      doc.fillColor('#c0392b').fontSize(10).font('Helvetica-Bold').text('⚠  ALERGIAS / INTOLERANCIAS', X+12, y+10);
      doc.fillColor('#7b1c1c').fontSize(14).font('Helvetica').text(r.alergias, X+12, y+28, {width:W-24});
      y += 70;
    }

    // ── OBSERVACIONES ─────────────────────────────────────────
    if (r.obs && r.obs.trim()) {
      doc.fillColor('#aaa').fontSize(9).font('Helvetica').text('OBSERVACIONES', X, y+4);
      doc.fillColor('#444').fontSize(13).font('Helvetica-Oblique').text(r.obs, X, y+18, {width:W});
    }

    // ── PIE ───────────────────────────────────────────────────
    const rng = doc.bufferedPageRange();
    for (let i=0; i<rng.count; i++) {
      doc.switchToPage(i);
      doc.rect(0,818,595.28,24).fill('#1a1a1a');
      doc.fillColor('#666').fontSize(8).font('Helvetica')
         .text('NIMANSANMON S.L.  ·  CIF: B37297223  ·  Don Fadrique  ·  Alba de Tormes  ·  920 37 00 51',
               X, 824, {align:'center', width:W+5});
    }
    doc.end();
  } catch(e) {
    console.error('Error orden-pdf:', e);
    if (!res.headersSent) res.status(500).json({error:'Error generando PDF'});
  }
});


// Listado diario PDF
app.get('/api/personal/listado-pdf', (req, res) => {
  try {
    const { pin, fecha } = req.query;
    if (!_pinOk(pin)) return res.status(401).json({ error: 'No autorizado' });
    if (!fecha) return res.status(400).json({ error: 'Falta fecha' });

    const reservas = db.prepare(`
      SELECT * FROM reservas
      WHERE fecha = ? AND (estado IS NULL OR estado NOT LIKE '%cancel%')
      ORDER BY salon ASC, hora ASC
    `).all(fecha);

    const PDFDoc = require('pdfkit');
    const doc = new PDFDoc({ margin: 40, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="listado_${fecha}.pdf"`);
    doc.pipe(res);

    const W = 515, X = 40;

    // ── CABECERA ──────────────────────────────────────────────
    doc.rect(0,0,595.28,110).fill('#1a1a1a');
    try { doc.image(path.join(__dirname,'logos/michelin.jpg'), X, 18, {height:50,fit:[50,50]}); } catch(e){}
    try { doc.image(path.join(__dirname,'logos/repsol.jpg'),   X+58, 18, {height:50,fit:[50,50]}); } catch(e){}
    try { doc.image(path.join(__dirname,'logos/tierra.png'),   X+116, 18, {height:50,fit:[50,50]}); } catch(e){}
    doc.fillColor('#c9a84c').fontSize(20).font('Helvetica-Bold')
       .text('LISTADO DEL DÍA', 230, 22, {width:325, align:'right'});
    doc.fillColor('#fff').fontSize(15).font('Helvetica')
       .text(_fmtFecha(fecha), 230, 48, {width:325, align:'right'});
    doc.fillColor('#888').fontSize(10).font('Helvetica')
       .text('Don Fadrique · Alba de Tormes', 230, 72, {width:325, align:'right'});
    doc.moveTo(X,118).lineTo(555,118).strokeColor('#c9a84c').lineWidth(2).stroke();

    let y = 130;

    // ── RESUMEN ───────────────────────────────────────────────
    const totalPax = reservas.reduce((s,r)=>s+(r.pax||0)+(r.ninos||0), 0);
    const nEventos = reservas.filter(r=>r.tipo==='evento').length;
    doc.rect(X,y,W,40).fill('#f5f0e8');
    doc.moveTo(X,y).lineTo(555,y).strokeColor('#c9a84c').lineWidth(1).stroke();
    doc.moveTo(X,y+40).lineTo(555,y+40).strokeColor('#c9a84c').lineWidth(1).stroke();
    doc.fillColor('#1a1a1a').fontSize(13).font('Helvetica-Bold')
       .text(`${reservas.length} reservas   ·   ${totalPax} comensales   ·   ${nEventos} eventos`,
             X, y+13, {width:W, align:'center'});
    y += 52;

    if (reservas.length === 0) {
      doc.fillColor('#888').fontSize(16).font('Helvetica')
         .text('Sin reservas este día', X, y+60, {align:'center', width:W});
    }

    // ── AGRUPAR POR SALÓN ─────────────────────────────────────
    const salonesOrden = ['Bodega','Cristalera','Cayetana','Cúpula'];
    const grupos = {};
    reservas.forEach(r => {
      const s = r.salon || 'Sin salón';
      if (!grupos[s]) grupos[s] = [];
      grupos[s].push(r);
    });
    // Ordenar salones: primero los conocidos, luego el resto
    const salonesEnDia = [
      ...salonesOrden.filter(s => grupos[s]),
      ...Object.keys(grupos).filter(s => !salonesOrden.includes(s))
    ];

    salonesEnDia.forEach(salon => {
      const lista = grupos[salon];

      // Estimar si cabe la cabecera de salón + al menos 1 reserva
      if (y > 720) { doc.addPage(); y = 40; }

      // ── CABECERA DE SALÓN ──────────────────────────────────
      doc.rect(X, y, W, 36).fill('#c9a84c');
      doc.fillColor('#1a1a1a').fontSize(16).font('Helvetica-Bold')
         .text(salon.toUpperCase(), X+15, y+9, {width: W*0.5});
      doc.fillColor('#1a1a1a').fontSize(11).font('Helvetica')
         .text(`${lista.length} ${lista.length===1?'reserva':'reservas'}`, X, y+11, {width:W-15, align:'right'});
      y += 36;

      lista.forEach((r, idx) => {
        const paxTxt = r.ninos > 0
          ? `${r.pax} adultos + ${r.ninos} niños`
          : `${r.pax} personas`;
        const mesaTxt = r.mesa ? `Mesa ${r.mesa}` : '';
        const tieneAler = r.alergias && r.alergias.trim();
        const tieneObs  = r.obs && r.obs.trim();
        const esEvento  = r.tipo === 'evento';

        const altBase = 52;
        const altAler = tieneAler ? 28 : 0;
        const altObs  = tieneObs  ? 24 : 0;
        const altTotal = altBase + altAler + altObs;

        if (y + altTotal > 800) { doc.addPage(); y = 40; }

        // Fondo alternado
        doc.rect(X, y, W, altTotal).fill(idx%2===0 ? '#fff' : '#f8f5ef');
        doc.moveTo(X, y+altTotal).lineTo(555, y+altTotal).strokeColor('#e8e0d0').lineWidth(0.5).stroke();

        // Hora — grande y dorada
        doc.fillColor('#c9a84c').fontSize(20).font('Helvetica-Bold')
           .text(r.hora ? r.hora.substring(0,5) : '--', X+10, y+8, {width:70});

        // Nombre
        doc.fillColor('#1a1a1a').fontSize(14).font('Helvetica-Bold')
           .text(r.nombre, X+88, y+6, {width: W-200});

        // Tipo badge (evento/carta/menú) — derecha
        const badgeTxt = esEvento ? (r.tipo_evento||'EVENTO') : r.menu ? 'MENÚ '+r.menu : 'CARTA';
        doc.fillColor('#888').fontSize(10).font('Helvetica')
           .text(badgeTxt, X+88, y+26, {width:W-103, align:'right'});

        // Mesa + comensales — segunda línea
        const infoTxt = [mesaTxt, paxTxt].filter(Boolean).join('   ·   ');
        doc.fillColor('#555').fontSize(12).font('Helvetica')
           .text(infoTxt, X+88, y+26, {width: W*0.55});

        let yExtra = y + altBase;

        // Alergias
        if (tieneAler) {
          doc.rect(X, yExtra, W, altAler).fill('#fde8e8');
          doc.fillColor('#c0392b').fontSize(10).font('Helvetica-Bold')
             .text('⚠  '+r.alergias, X+12, yExtra+8, {width:W-24});
          yExtra += altAler;
        }

        // Observaciones
        if (tieneObs) {
          doc.fillColor('#888').fontSize(10).font('Helvetica-Oblique')
             .text('Obs: '+r.obs, X+12, yExtra+6, {width:W-24});
          yExtra += altObs;
        }

        y += altTotal;
      });

      y += 20; // espacio entre salones
    });

    // ── PIE ───────────────────────────────────────────────────
    const rng = doc.bufferedPageRange();
    for (let i=0; i<rng.count; i++) {
      doc.switchToPage(i);
      doc.rect(0,818,595.28,24).fill('#1a1a1a');
      doc.fillColor('#666').fontSize(8).font('Helvetica')
         .text(`NIMANSANMON S.L.  ·  Don Fadrique  ·  Página ${i+1} de ${rng.count}`,
               X, 824, {align:'center', width:W+5});
    }
    doc.end();
  } catch(e) {
    console.error('Error listado-pdf:', e);
    if (!res.headersSent) res.status(500).json({error:'Error generando PDF'});
  }
});


app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});


app.listen(PORT, () => {
  console.log(`Don Fadrique corriendo en puerto ${PORT}`);
  programarRecordatorios();
  programarConvocatorias10Dias();
});
