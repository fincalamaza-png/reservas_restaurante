// ─── PRESUPUESTO DE BODA / COMUNIÓN / EVENTO CON DISEÑO ──────────────────────
// Mismo formato que el dossier «Presupuesto de boda» de Don Fadrique:
//   1. Portada · 2. Cóctel de bienvenida · 3. Menú · 4. Barra libre, recena y resumen por persona
//   5. Importe y aceptación (firma con el dedo) · 6. Anexo: montaje
// Los textos fijos (cóctel, barra libre, opcionales, condiciones) salen de la plantilla editable
// (config «eventos_plantilla_boda»); lo de cada celebración, de su carpeta.
'use strict';
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const F = path.join(__dirname, 'fonts');
const FUENTES = {
  'J-XL': path.join(F, 'pdf', 'jost-latin-200-normal.woff'),
  'J-L': path.join(F, 'ttf', 'Jost_300Light.ttf'),
  'J-LI': path.join(F, 'ttf', 'Jost_300Light_Italic.ttf'),
  'J-R': path.join(F, 'ttf', 'Jost_400Regular.ttf'),
  'J-M': path.join(F, 'ttf', 'Jost_500Medium.ttf'),
  'C-L': path.join(F, 'pdf', 'cormorant-garamond-latin-300-normal.woff'),
  'C-LI': path.join(F, 'pdf', 'cormorant-garamond-latin-300-italic.woff'),
  'C-R': path.join(F, 'pdf', 'cormorant-garamond-latin-400-normal.woff'),
  'C-RI': path.join(F, 'pdf', 'cormorant-garamond-latin-400-italic.woff'),
  'C-M': path.join(F, 'pdf', 'cormorant-garamond-latin-500-normal.woff')
};
const FOTO_COCTEL = path.join(__dirname, 'marca', 'fotos', 'alba.jpg');
const FOTO_MENU = path.join(__dirname, 'marca', 'fotos', 'salon.jpg');
const PREMIOS = ['michelin.png', 'repsol.png', 'tierra.png'].map(f => path.join(__dirname, 'marca', 'premios', f)).filter(f => fs.existsSync(f));

const PAPEL = '#f7f3ef', TINTA = '#2a2325', SUAVE = '#6b5f61', ACENTO = '#6f5c5f', BANDA = '#d8cfcf', CAJA = '#ece4e2', REGLA = '#c9bebe';

// Plantilla por defecto (la del dossier de bodas); se cambia desde la app
const PLANTILLA = {
  coctel_titulo: 'Cóctel de bienvenida DF',
  coctel_sub: 'Entre 30 y 40 minutos, en el jardín o en La Cúpula, mientras llegan los invitados.',
  coctel_precio: 29.5,
  coctel: 'Red de gazpachos\nGazpacho tradicional\nGazpacho de sandía\nAjoblanco de almendras\nGazpacho de mango\n\nBandeja Don Fadrique\nYogur de boletus\nYogur de bacalao\nFruta con micuit\nTomate con ventresca\nSalmón con chocolate blanco\nMilhoja de manzana y queso\nCarpaccio de ibérico con queso de Hinojosa\n\n' +
    'Sabores de la infancia\nChorizo con gianduja\nPavo con gianduja\nBocata de sardinas\nPan con mantequilla\nEspaguetis carbonara\nSabor de la infancia de la novia\nSabor de la infancia del novio\n\nImprescindibles\nTosta de jamón y foie\nTortilla S. XXI\nAnchoa con pimiento dulce\n\n' +
    'Aperitivos calientes\nCroqueta de jamón\nCroqueta de bacalao\nMorcilla con pistacho\nCaramelo de farinato\nRosquilla de sobrasada y queso\nChupa-chups\nFalsas patatas fritas\nTempuras de cebolla dulce, pimiento y zanahoria\nTortillita fina de bacalao\nEmpanadas al vapor\n\nConcurso gastro\nDiferentes steak tartares para acertar y ganar\n\nInterludio\nMelón-lina\nCaipiriña masticable',
  estaciones: 'Podéis añadir cualquiera de nuestras estaciones: corner ibérico, barra de encurtidos, barra vasca, quesos del mundo, estación vegetal, ahumados estilo nórdico, estación de pulpo, plancha de marisco, zona internacional y estación tradicional.',
  menu_sub: 'El banquete, servido en mesa por nuestro equipo de sala.',
  menu_incluye: 'Pan, agua, vinos tinto y blanco, cava para el brindis y café.',
  alergias: 'Todos nuestros menús se pueden adaptar a alergias e intolerancias. Menú infantil y menús especiales, a consultar.',
  barra_sub: 'Para que la fiesta siga cuando termina el banquete.',
  barra_horas: 4, barra_precio: 25.5, barra_hora_extra: 5,
  barra_condiciones: 'Las horas se cuentan desde la apertura de la barra, al terminar el banquete.\nIncluye combinados, cerveza, vino, refrescos y agua.\nSe factura por el número total de invitados adultos.\nLas horas adicionales se contratan antes del evento o durante la fiesta, con el acuerdo de los novios.\nNo se sirven bebidas alcohólicas a menores de 18 años.\nEl horario de cierre se ajusta al permitido por la licencia del espacio.',
  opcionales: 'Bandejas variadas · 50 piezas = 70\nBurger party · por unidad = 16\nEstación tradicional · por persona = 8\nPizzas en horno de leña · por unidad = 25\nDJ residente = 750\nAudiovisuales = 300\nWedding planner = 1450',
  condiciones: 'Presupuesto válido durante 30 días desde su emisión y sujeto a disponibilidad de la fecha.\nEl número definitivo de invitados se confirma 15 días antes de la boda; se facturará como mínimo ese número.\nIndicadnos alergias e intolerancias al confirmar el número de invitados.\nLos cambios de menú, estaciones u horas de barra libre pueden modificar el precio final.',
  contacto_wa: '650 488 113 · 661 724 158', contacto_email: 'reservas@donfadrique.com', contacto_tel: '923 37 00 76'
};

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
function eur(n) { const v = r2(n); const s = (Number.isInteger(v) ? String(v) : v.toFixed(2)).split('.'); return s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (s[1] ? ',' + s[1] : '') + ' €'; }
function eur2(n) { const v = r2(n).toFixed(2).split('.'); return v[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + v[1] + ' €'; }
const lineas = t => String(t || '').split('\n').map(x => x.replace(/^[-·•]\s*/, '').trim()).filter(Boolean);
function grupos(t) { return String(t || '').split(/\n\s*\n/).map(b => lineas(b)).filter(b => b.length).map(b => ({ t: b[0], platos: b.slice(1) })); }
function opcionales(t) { return lineas(t).map(l => { const m = l.match(/^(.*?)\s*=\s*([\d.,]+)\s*€?$/); return m ? { concepto: m[1].trim(), precio: Number(m[2].replace(/\./g, '').replace(',', '.')) } : { concepto: l, precio: 0 }; }); }
const fechaLarga = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
const TIPO = { boda: 'boda', comunion: 'comunión', evento: 'evento' };

function generar(d, opts) {
  const P = Object.assign({}, PLANTILLA, opts.plantilla || {});
  const datos = d.datos || {}, cli = datos.cliente || {}, ev = datos.evento || {}, pq = datos.paquete || {};
  const tipo = ev.tipo || 'boda';
  const nombres = tipo === 'boda' ? [cli.persona1, cli.persona2].filter(Boolean).map(n => n.split(' ')[0]).join(' & ') || cli.nombre || 'Nombre & Nombre'
    : tipo === 'comunion' ? (ev.protagonista || cli.nombre || '') : (ev.nombre || cli.nombre || '');
  const fechaTxt = fechaLarga(ev.fecha);
  const cabDer = (TIPO[tipo] + ' ' + nombres + ' · ' + (ev.fecha ? new Date(ev.fecha + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : '')).toUpperCase();
  return new Promise(async (resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: 'Presupuesto ' + (d.numero || ''), Author: 'NIMANSANMON S.L. · Don Fadrique' } });
    const bufs = []; doc.on('data', b => bufs.push(b)); doc.on('end', () => resolve(Buffer.concat(bufs))); doc.on('error', reject);
    Object.keys(FUENTES).forEach(k => { try { doc.registerFont(k, FUENTES[k]); } catch (e) { doc.registerFont(k, 'Helvetica'); } });
    const W = 595.28, H = 841.89, L = 51, R = W - 51;
    const esp = (txt, x, y, o) => { o = o || {}; doc.font(o.f || 'J-L').fontSize(o.s || 7).fillColor(o.c || TINTA).text(o.upper === false ? txt : String(txt).toUpperCase(), x, y, Object.assign({ characterSpacing: o.cs == null ? 2.2 : o.cs, lineBreak: false }, o.op || {})); };
    const fondo = () => { doc.rect(0, 0, W, H).fill(PAPEL); };
    const nueva = () => { doc.addPage({ size: 'A4', margin: 0 }); fondo(); };
    const premios = (x, y, h, centrado) => {
      const ws = [h * 1.0, h * 1.6, h * 1.25]; const total = ws.reduce((a, b) => a + b, 0) + (PREMIOS.length - 1) * 8;
      let xx = centrado ? x - total / 2 : x;
      PREMIOS.forEach((f, i) => { try { doc.image(f, xx, y, { fit: [ws[i], h], valign: 'center' }); } catch (e) {} xx += ws[i] + 8; });
    };
    const pie = () => {
      doc.rect(0, 774, W, H - 774).fill(BANDA);
      esp('Reservas', L - 6, 792, { s: 5.4, cs: 2.6, c: TINTA });
      doc.font('J-R').fontSize(7.8).fillColor(TINTA).text('WhatsApp ' + P.contacto_wa, L - 6, 803, { lineBreak: false });
      doc.text(P.contacto_email + ' · ' + P.contacto_tel, L - 6, 817, { lineBreak: false });
      premios(R - 125, 790, 34, false);
    };
    const cabecera = y => {
      esp('DONFADRIQUE', L, y, { f: 'J-XL', s: 10.5, cs: 4.2, upper: false });
      const w = doc.font('J-L').fontSize(6).widthOfString(cabDer, { characterSpacing: 2.4 });
      esp(cabDer, R - w, y + 3, { s: 6, cs: 2.4 });
      doc.moveTo(L, y + 18).lineTo(R, y + 18).lineWidth(.5).strokeColor(REGLA).stroke();
    };
    // Título con la última parte en cursiva: «Cóctel de ·bienvenida·»
    const titulo = (a, b, x, y, s, centro) => {
      doc.font('C-L').fontSize(s); const wa = doc.widthOfString(a + ' '); doc.font('C-LI'); const wb = doc.widthOfString(b || '');
      const x0 = centro ? (W - wa - wb) / 2 : x;
      doc.font('C-L').fontSize(s).fillColor(TINTA).text(a + (b ? ' ' : ''), x0, y, { lineBreak: false });
      if (b) doc.font('C-LI').fontSize(s).fillColor(ACENTO).text(b, x0 + wa, y, { lineBreak: false });
    };
    const bandaPrecio = (x, y, w, h, etiqueta, precio) => {
      doc.rect(x, y, w, h).fill(BANDA);
      doc.font('J-L').fontSize(6.2); const we = doc.widthOfString(etiqueta.toUpperCase(), { characterSpacing: 2.6 });
      doc.font('C-M').fontSize(17); const wp = doc.widthOfString(precio);
      doc.font('J-LI').fontSize(6.4); const wq = doc.widthOfString('por persona');
      let xx = x + (w - we - wp - wq - 34) / 2;
      esp(etiqueta, xx, y + h / 2 - 2.5, { s: 6.2, cs: 2.6, c: SUAVE }); xx += we + 16;
      doc.font('C-M').fontSize(17).fillColor(TINTA).text(precio, xx, y + h / 2 - 10, { lineBreak: false }); xx += wp + 14;
      doc.font('J-LI').fontSize(6.4).fillColor(SUAVE).text('por persona', xx, y + h / 2 - 2.5, { lineBreak: false });
    };
    const vinetas = (items, x, y, w, s) => {
      items.forEach(t => {
        doc.circle(x + 2, y + 4, 1.4).fill(TINTA);
        doc.font('J-L').fontSize(s || 7.2).fillColor(TINTA).text(t, x + 10, y, { width: w - 10, lineGap: 2 });
        y = doc.y + 4;
      });
      return y;
    };

    // ── 1. Portada ──
    fondo();
    doc.font('J-XL').fontSize(26); const wWm = doc.widthOfString('DONFADRIQUE', { characterSpacing: 8.5 });
    esp('DONFADRIQUE', (W - wWm) / 2 + 4, 88, { f: 'J-XL', s: 26, cs: 8.5, upper: false });
    const sub = 'Restaurante · Alba de Tormes · Salamanca'.toUpperCase(); doc.font('J-L').fontSize(5.6); const wSub = doc.widthOfString(sub, { characterSpacing: 2.8 });
    esp(sub, (W - wSub) / 2, 134, { s: 5.6, cs: 2.8, c: TINTA });
    doc.moveTo(W / 2 - 26, 294).lineTo(W / 2 + 26, 294).lineWidth(.5).strokeColor(REGLA).stroke();
    const etq = ('Presupuesto de ' + TIPO[tipo]).toUpperCase(); doc.font('J-L').fontSize(6.6); const wEtq = doc.widthOfString(etq, { characterSpacing: 3.6 });
    doc.rect((W - wEtq) / 2 - 14, 323, wEtq + 28, 20).lineWidth(.6).strokeColor(ACENTO).stroke();
    esp(etq, (W - wEtq) / 2 + 1.5, 330, { s: 6.6, cs: 3.6, c: TINTA });
    let sN = 52; doc.font('C-LI').fontSize(sN); while (doc.widthOfString(nombres) > R - L - 20 && sN > 22) { sN -= 2; doc.fontSize(sN); }
    doc.font('C-LI').fontSize(sN).fillColor(TINTA).text(nombres, L, 372, { width: R - L, align: 'center', lineBreak: false });
    const fT = fechaTxt.toUpperCase(); doc.font('J-L').fontSize(7.6); const wF = doc.widthOfString(fT, { characterSpacing: 2.8 });
    esp(fT, (W - wF) / 2, 446, { s: 7.6, cs: 2.8 });
    doc.moveTo(68, 502).lineTo(527, 502).lineWidth(.5).strokeColor(REGLA).stroke(); doc.moveTo(68, 550).lineTo(527, 550).stroke();
    const invit = (ev.adultos || 0) + (ev.ninos || 0);
    [['Lugar', ev.lugar || 'Don Fadrique'], ['Invitados', invit ? invit + ' personas' : '—'], ['Presupuesto nº', d.numero + (d.version > 1 ? ' · v' + d.version : '')]].forEach((c, i) => {
      const cx = 68 + (459 / 3) * i, cw = 459 / 3;
      doc.font('J-L').fontSize(5.2); const w1 = doc.widthOfString(c[0].toUpperCase(), { characterSpacing: 2.4 });
      esp(c[0], cx + (cw - w1) / 2, 513, { s: 5.2, cs: 2.4, c: TINTA });
      doc.font('C-R').fontSize(13).fillColor(TINTA).text(c[1], cx, 525, { width: cw, align: 'center', lineBreak: false });
    });
    const firmaEm = [new Date(d.created_at ? d.created_at.replace(' ', 'T') + 'Z' : Date.now()).toLocaleDateString('es-ES'), opts.autor].filter(Boolean).join(' · ');
    doc.font('J-L').fontSize(7).fillColor(SUAVE).text(firmaEm, L, 570, { width: R - L, align: 'center', characterSpacing: .6, lineBreak: false });
    premios(W / 2, 730, 40, true);
    const ct = (P.contacto_email + ' · WhatsApp ' + P.contacto_wa + ' · ' + P.contacto_tel); doc.font('J-L').fontSize(6.2); const wCt = doc.widthOfString(ct, { characterSpacing: 1 });
    doc.fillColor(SUAVE).text(ct, (W - wCt) / 2, 788, { characterSpacing: 1, lineBreak: false });

    // ── 2. Cóctel de bienvenida ──
    const resumen = [];
    if (pq.coctel && pq.coctel.si) {
      nueva();
      try { doc.save(); doc.rect(0, 0, W, 199).clip(); doc.image(FOTO_COCTEL, 0, 0, { cover: [W, 199], align: 'center', valign: 'center' }); doc.restore(); } catch (e) { doc.restore(); }
      cabecera(228);
      const tc = String(P.coctel_titulo).replace(/\s*DF$/i, ''); const pc = tc.split(' ');
      titulo(pc.slice(0, -1).join(' '), pc.slice(-1)[0], L, 262, 27);
      doc.font('J-L').fontSize(7.6).fillColor(SUAVE).text(P.coctel_sub, L, 297, { width: R - L });
      const gs = grupos(P.coctel), colW = (R - L) / 3;
      // Reparte los grupos en tres columnas equilibradas
      const alto = g => 22 + g.platos.reduce((a, p) => a + (p.length > 32 ? 22 : 11), 0) + 10; const totalH = gs.reduce((a, g) => a + alto(g), 0);
      let col = 0, y = 322, acum = 0, yMax = 0;
      gs.forEach(g => {
        if (col < 2 && acum > 0 && acum + alto(g) / 2 > totalH / 3 * (col + 1)) { col++; y = 322; }
        const x = L + col * colW;
        doc.font('C-LI').fontSize(12.5).fillColor(ACENTO).text(g.t, x, y, { width: colW - 12, lineBreak: false }); y += 17;
        g.platos.forEach(p => { doc.font('J-L').fontSize(7).fillColor(TINTA).text(p.toUpperCase(), x, y, { width: colW - 16, characterSpacing: .5, lineGap: 0 }); y = doc.y + 2.6; });
        yMax = Math.max(yMax, y); y += 10; acum += alto(g);
      });
      const yB = Math.max(572, yMax + 12);
      bandaPrecio(L, yB, R - L, 44, P.coctel_titulo, eur(pq.coctel.precio));
      doc.font('C-L').fontSize(14).fillColor(TINTA).text('Estaciones opcionales', L, yB + 60, { lineBreak: false });
      doc.font('J-LI').fontSize(6.8).fillColor(SUAVE).text(P.estaciones, L, yB + 82, { width: R - L, lineGap: 2 });
      pie();
      resumen.push([P.coctel_titulo, pq.coctel.precio]);
    }

    // ── 3. Menú ──
    const menu = datos.menu || {}, nomMenu = String(pq.menu_nombre || menu.nombre || 'Menú').split(' · ')[0];
    nueva();
    try { doc.save(); doc.rect(0, 0, W, 131).clip(); doc.image(FOTO_MENU, 0, 0, { cover: [W, 131], align: 'center', valign: 'center' }); doc.restore(); } catch (e) { doc.restore(); }
    cabecera(160);
    const pm = nomMenu.split(' '); titulo(pm[0], pm.slice(1).join(' '), 0, 194, 27, true);
    doc.font('J-L').fontSize(7.4).fillColor(SUAVE).text(P.menu_sub, L, 229, { width: R - L, align: 'center' });
    let ym = 262;
    const platosMenu = (menu.lineas || []).filter(m => !/c[oó]ctel|barra libre|recena|^vino|cava|bodega/i.test(m.t));
    const bodega = (menu.lineas || []).filter(m => /^vino|cava|bodega/i.test(m.t) && m.v);
    const hueco = Math.max(14, Math.min(26, (560 - ym - platosMenu.length * 34) / Math.max(1, platosMenu.length)));
    platosMenu.forEach(m => {
      if (!m.v) { doc.font('C-LI').fontSize(11.5).fillColor(ACENTO).text('— ' + m.t + ' —', L, ym, { width: R - L, align: 'center' }); ym = doc.y + hueco * .6; return; }
      doc.font('C-LI').fontSize(15.5).fillColor(TINTA).text(m.t, L, ym, { width: R - L, align: 'center' }); ym = doc.y + 3;
      doc.font('J-L').fontSize(8.2).fillColor(TINTA).text(String(m.v).toUpperCase(), L + 40, ym, { width: R - L - 80, align: 'center', characterSpacing: 1.3, lineGap: 3.5 }); ym = doc.y + hueco;
    });
    if (!platosMenu.length) { doc.font('J-LI').fontSize(8).fillColor(SUAVE).text('Menú por definir', L, ym + 20, { width: R - L, align: 'center' }); ym += 60; }
    const incl = bodega.length ? P.menu_incluye + ' Bodega: ' + bodega.map(b => b.v).join(' · ') + '.' : P.menu_incluye;
    doc.font('J-L').fontSize(7).fillColor(SUAVE).text(incl, L + 30, ym + 4, { width: R - L - 60, align: 'center' }); ym = doc.y + 18;
    const yb = Math.max(ym, 560);
    bandaPrecio(142, yb, 312, 43, nomMenu, eur(pq.menu_precio || 0));
    doc.font('J-LI').fontSize(6).fillColor(SUAVE).text(P.alergias, L, yb + 58, { width: R - L, align: 'center' });
    pie();
    resumen.push([nomMenu, pq.menu_precio || 0]);

    // ── 4. Barra libre, recena y resumen ──
    nueva();
    cabecera(52);
    const conBarra = pq.barra && pq.barra.si;
    let y4 = 86;
    if (conBarra) {
      titulo('Barra', 'libre', L, y4, 27); doc.font('J-L').fontSize(7.6).fillColor(SUAVE).text(P.barra_sub, L, y4 + 34);
      doc.rect(L, 146, 118, 85).lineWidth(.6).strokeColor(ACENTO).stroke();
      doc.font('C-L').fontSize(30).fillColor(TINTA).text(String(pq.barra.horas || ''), L, 165, { width: 118, align: 'center', lineBreak: false });
      doc.font('J-L').fontSize(5.2); const wh = doc.widthOfString('HORAS CONTRATADAS', { characterSpacing: 2.6 }); esp('Horas contratadas', L + (118 - wh) / 2, 209, { s: 5.2, cs: 2.6 });
      bandaPrecio(193, 158, R - 193, 43, 'Barra libre · ' + pq.barra.horas + ' horas', eur(pq.barra.precio));
      doc.font('J-L').fontSize(7).fillColor(SUAVE).text('Hora adicional: ' + eur(P.barra_hora_extra) + ' por persona y hora.', 193, 210);
      doc.font('C-L').fontSize(15).fillColor(TINTA).text('Condiciones de la barra libre', L, 248, { lineBreak: false });
      vinetas(lineas(P.barra_condiciones), L, 270, 240);
      resumen.push(['Barra libre · ' + pq.barra.horas + ' horas', pq.barra.precio]);
      y4 = 248;
    } else {
      titulo('Recena y', 'servicios', L, y4, 27); y4 = 136;
    }
    const xo = conBarra ? 310 : L, wo = R - xo;
    doc.font('C-L').fontSize(15).fillColor(TINTA).text('Recena y servicios opcionales', xo, y4, { lineBreak: false });
    let yo = y4 + 24;
    opcionales(P.opcionales).forEach(o => {
      doc.font('J-L').fontSize(7.2).fillColor(TINTA).text(o.concepto, xo, yo, { width: wo - 70, lineBreak: false });
      doc.font('C-R').fontSize(10).text(o.precio ? eur(o.precio) : '', xo + wo - 80, yo - 2, { width: 80, align: 'right', lineBreak: false });
      yo += 15; doc.moveTo(xo, yo).lineTo(R, yo).lineWidth(.4).strokeColor(REGLA).stroke(); yo += 7;
    });
    // Resumen por persona
    const yr = Math.max(yo + 14, 440), alR = 54 + resumen.length * 23 + 40;
    doc.rect(L, yr, R - L, alR).fill(CAJA);
    titulo('Resumen', 'por persona', L + 20, yr + 16, 15);
    let yy = yr + 44;
    resumen.forEach(([k, v]) => {
      doc.font('J-L').fontSize(7.4).fillColor(TINTA).text(k, L + 20, yy, { lineBreak: false });
      doc.font('C-R').fontSize(11).text(eur(v), R - 120, yy - 2, { width: 100, align: 'right', lineBreak: false });
      yy += 15; doc.moveTo(L + 20, yy).lineTo(R - 20, yy).lineWidth(.4).strokeColor(REGLA).stroke(); yy += 8;
    });
    const pp = resumen.reduce((a, x) => a + Number(x[1] || 0), 0);
    esp('Precio por persona', L + 20, yy + 10, { s: 6.4, cs: 2.6 });
    doc.font('C-M').fontSize(19).fillColor(TINTA).text(eur(pp), R - 160, yy + 2, { width: 140, align: 'right', lineBreak: false });
    doc.font('J-LI').fontSize(6).fillColor(SUAVE).text('10 % de IVA no incluido', R - 160, yy + 28, { width: 140, align: 'right', lineBreak: false });
    // Condiciones generales
    const yc = yr + alR + 22;
    doc.font('C-L').fontSize(15).fillColor(TINTA).text('Condiciones generales', L, yc, { lineBreak: false });
    const cg = lineas(P.condiciones).map(t => tipo === 'boda' ? t : t.replace(/la boda/g, 'la celebración'));
    const mitad = Math.ceil(cg.length / 2);
    vinetas(cg.slice(0, mitad), L, yc + 24, 240); vinetas(cg.slice(mitad), 306, yc + 24, R - 306);
    pie();

    // ── 5. Importe y aceptación (firma) ──
    nueva();
    cabecera(52);
    titulo('Importe y', 'aceptación', L, 86, 27);
    const t = opts.totales(datos);
    let yl = 140;
    esp('Concepto', L, yl, { s: 5.4, cs: 2, c: SUAVE }); esp('Cant.', L + 300, yl, { s: 5.4, cs: 2, c: SUAVE }); esp('Precio', L + 360, yl, { s: 5.4, cs: 2, c: SUAVE });
    doc.font('J-L').fontSize(5.4); const wImp = doc.widthOfString('IMPORTE', { characterSpacing: 2 }); esp('Importe', R - wImp, yl, { s: 5.4, cs: 2, c: SUAVE });
    yl += 12; doc.moveTo(L, yl).lineTo(R, yl).lineWidth(.5).strokeColor(REGLA).stroke(); yl += 8;
    (datos.lineas || []).forEach(l => {
      const imp = r2(Number(l.cantidad || 0) * Number(l.precio || 0));
      const h = doc.font('J-L').fontSize(7.6).heightOfString(l.concepto || '', { width: 290 });
      doc.fillColor(TINTA).text(l.concepto || '', L, yl, { width: 290 });
      doc.text(String(l.cantidad ?? ''), L + 300, yl, { width: 40, lineBreak: false });
      doc.text(Number(l.precio) ? eur2(l.precio) : '', L + 340, yl, { width: 60, align: 'right', lineBreak: false });
      doc.font('C-R').fontSize(10.5).text(Number(l.precio) ? eur2(imp) : 'Incluido', R - 100, yl - 2, { width: 100, align: 'right', lineBreak: false });
      yl += Math.max(h, 10) + 6; doc.moveTo(L, yl - 3).lineTo(R, yl - 3).lineWidth(.3).strokeColor('#e3dad8').stroke();
    });
    yl += 8;
    const fila = (k, v, fuerte) => {
      doc.font(fuerte ? 'J-R' : 'J-L').fontSize(fuerte ? 7.6 : 7).fillColor(TINTA).text(fuerte ? k.toUpperCase() : k, R - 260, yl + (fuerte ? 6 : 0), { width: 150, characterSpacing: fuerte ? 2 : 0, lineBreak: false });
      doc.font(fuerte ? 'C-M' : 'C-R').fontSize(fuerte ? 18 : 11).text(v, R - 140, yl - (fuerte ? 0 : 2), { width: 140, align: 'right', lineBreak: false });
      yl += fuerte ? 28 : 16;
    };
    fila('Base imponible', eur2(t.base)); Object.keys(t.porIva).sort().forEach(k => fila('IVA ' + k + ' %', eur2(t.porIva[k] * k / 100)));
    doc.moveTo(R - 260, yl).lineTo(R, yl).lineWidth(.6).strokeColor(ACENTO).stroke(); yl += 6;
    fila('Total', eur2(t.total), true);
    if (datos.notas) { doc.font('J-LI').fontSize(7).fillColor(SUAVE).text(datos.notas, L, yl + 4, { width: R - L }); yl = doc.y + 8; }
    if (datos.condiciones) { doc.font('J-L').fontSize(6.4).fillColor(SUAVE).text(datos.condiciones, L, yl + 6, { width: R - L, lineGap: 1.5 }); yl = doc.y + 10; }
    // Firmas
    const yf = Math.max(yl + 20, 560), fw = (R - L - 30) / 2;
    esp('Conforme, ' + (tipo === 'boda' ? 'los novios' : 'el cliente'), L, yf, { s: 5.6, cs: 2.4, c: SUAVE });
    esp('Por Don Fadrique', L + fw + 30, yf, { s: 5.6, cs: 2.4, c: SUAVE });
    doc.rect(L, yf + 12, fw, 92).lineWidth(.5).strokeColor(REGLA).stroke(); doc.rect(L + fw + 30, yf + 12, fw, 92).stroke();
    if (d.firma) { try { doc.image(Buffer.from(d.firma.split(',')[1], 'base64'), L + 8, yf + 18, { fit: [fw - 16, 80], align: 'center', valign: 'center' }); } catch (e) {} }
    else doc.font('J-LI').fontSize(7).fillColor('#b8aeae').text('Firma con el dedo en la pantalla', L, yf + 54, { width: fw, align: 'center' });
    doc.font('C-R').fontSize(12).fillColor(TINTA).text('NIMANSANMON S.L.', L + fw + 30, yf + 44, { width: fw, align: 'center' });
    doc.font('J-L').fontSize(6.4).fillColor(SUAVE).text('CIF B37297223 · Don Fadrique · Alba de Tormes', L + fw + 30, yf + 62, { width: fw, align: 'center' });
    if (d.firma) doc.font('J-L').fontSize(7).fillColor(TINTA).text((d.firmado_nombre || '') + (d.firmado_dni ? ' · DNI ' + d.firmado_dni : ''), L, yf + 110, { width: fw, align: 'center' });
    if (d.firma && d.firmado_at) doc.font('J-L').fontSize(5.6).fillColor(SUAVE).text('Firmado electrónicamente con firma manuscrita en pantalla el ' + new Date(d.firmado_at.replace(' ', 'T') + 'Z').toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }) + (d.firmado_ip ? ' desde ' + d.firmado_ip : '') + '. Huella (SHA-256): ' + (d.huella || ''), L, yf + 128, { width: R - L });
    if (!d.firma) doc.save().rotate(-30, { origin: [W / 2, 420] }).font('C-M').fontSize(80).fillColor(ACENTO).opacity(.07).text('BORRADOR', 40, 380, { width: W - 80, align: 'center', lineBreak: false }).restore();
    pie();

    // ── 6. Anexo: montaje ──
    if (Array.isArray(datos.montaje) && datos.montaje.length) {
      nueva(); cabecera(52); titulo('Anexo ·', 'montaje', L, 86, 27);
      doc.font('J-L').fontSize(7.2).fillColor(SUAVE).text('Dónde y cómo va cada parte de la celebración. Forma parte del presupuesto ' + (d.numero || '') + '.', L, 120, { width: R - L });
      let ya = 150;
      datos.montaje.forEach(sec => {
        if (ya > 700) { pie(); nueva(); cabecera(52); ya = 90; }
        doc.font('C-LI').fontSize(14).fillColor(ACENTO).text(sec.t, L, ya, { lineBreak: false }); ya += 20;
        (sec.filas || []).forEach(([k, v]) => {
          const h = doc.font('J-L').fontSize(7.4).heightOfString(v, { width: R - L - 130 });
          if (ya + h > 750) { pie(); nueva(); cabecera(52); ya = 90; }
          if (k) esp(k, L, ya + 1, { s: 5.6, cs: 1.8, c: SUAVE });
          doc.font('J-L').fontSize(7.4).fillColor(TINTA).text(v, k ? L + 130 : L, ya, { width: k ? R - L - 130 : R - L, lineGap: 1.6 });
          ya += Math.max(h, 9) + 6;
        });
        doc.moveTo(L, ya).lineTo(R, ya).lineWidth(.4).strokeColor(REGLA).stroke(); ya += 14;
      });
      if (d.firma) doc.font('J-LI').fontSize(6.4).fillColor(SUAVE).text('Anexo firmado junto con el presupuesto por ' + (d.firmado_nombre || '') + (d.firmado_dni ? ' (DNI ' + d.firmado_dni + ')' : '') + '.', L, ya, { width: R - L });
      pie();
    }
    doc.end();
  });
}

module.exports = { generar, PLANTILLA, opcionales, eur };
