// Maquetación de menús para imprimir: A4 vertical y tríptico A4 horizontal.
// Lo usan la app (portal) y la página pública del menú compartido (/menu/:token).
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function limpio(s) { return String(s == null ? '' : s).trim(); }
  function euros(n) {
    n = Number(n) || 0;
    return n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €';
  }
  function fechaLarga(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T12:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  var VINOS = /^(vino|cava|champ|bodega|bebida)/i;

  // Convierte las secciones (mismo formato que las plantillas y propuestas) en grupos
  // { titulo, lineas:[{t, sub}], nota } listos para pintar.
  function agrupar(secciones) {
    var grupos = [];
    var bodega = { titulo: 'Bodega', lineas: [] };
    function grupo(titulo) {
      var base = limpio(titulo).replace(/\s*\d+$/, '');
      if (/^entrante$/i.test(base)) base = 'Entrantes';
      if (/^aperitivo$/i.test(base)) base = 'Aperitivos';
      var ult = grupos[grupos.length - 1];
      if (ult && ult.base === base.toLowerCase()) return ult;
      var g = { titulo: base, base: base.toLowerCase(), lineas: [], compartir: 0, total: 0 };
      grupos.push(g);
      return g;
    }
    (secciones || []).forEach(function (s) {
      if (!s) return;
      var tipo = s.tipo || 'plato';
      if (tipo === 'plato') {
        var t = limpio(s.texto);
        if (!t) return;
        if (VINOS.test(limpio(s.titulo))) {
          var tt = limpio(s.titulo);
          bodega.lineas.push({ t: t, sub: /^(vino|cava)/i.test(tt) && t.toLowerCase().indexOf(tt.toLowerCase()) === -1 ? tt.toLowerCase() : '' });
          return;
        }
        var g = grupo(s.titulo);
        g.lineas.push({ t: t });
        g.total++;
        if (s.compartir) g.compartir++;
      } else if (tipo === 'eleccion') {
        var ops = (s.opciones || []).map(limpio).filter(Boolean);
        if (!ops.length) return;
        var ge = grupo(s.titulo);
        if (s.elegir && ops.length > 1) {
          ge.nota = 'A elegir';
          ops.forEach(function (o, i) { ge.lineas.push({ t: o, o: i > 0 }); });
        } else ge.lineas.push({ t: ops[0] });
      } else if (tipo === 'sino') {
        if (!s.valor) return;
        grupos.push({ titulo: '', base: '_sino' + grupos.length, lineas: [{ t: limpio(s.titulo), suave: true }] });
      } else if (tipo === 'lista') {
        var items = (s.items || []).map(limpio).filter(Boolean);
        if (!items.length) return;
        if (VINOS.test(limpio(s.titulo))) { items.forEach(function (i) { bodega.lineas.push({ t: i }); }); return; }
        var gl = grupo(s.titulo);
        items.forEach(function (i) { gl.lineas.push({ t: i }); });
        if (s.compartir) gl.nota = 'Para compartir';
      } else if (tipo === 'barra_libre') {
        if (!s.valor) return;
        grupos.push({ titulo: limpio(s.titulo) || 'Barra libre', base: '_barra', lineas: [{ t: limpio(s.horas) || '' }].filter(function (l) { return l.t; }),
          nota: Number(s.precio) ? 'Suplemento ' + euros(s.precio) + ' por persona' : '' });
      } else if (tipo === 'recena') {
        if (!s.valor) return;
        var pl = (s.platos || []).filter(function (p) { return p && limpio(p.nombre); });
        if (!pl.length) return;
        grupos.push({ titulo: limpio(s.titulo) || 'Recena', base: '_recena', lineas: pl.map(function (p) { return { t: limpio(p.nombre) }; }) });
      }
    });
    grupos.forEach(function (g) { if (g.total && g.compartir === g.total) g.nota = 'Para compartir'; });
    if (bodega.lineas.length) grupos.push(bodega);
    return grupos;
  }

  function htmlGrupo(g) {
    var h = '<div class="dfm-grupo">';
    if (g.titulo) h += '<div class="dfm-tit">' + esc(g.titulo) + '</div>';
    if (g.nota && g.base !== '_barra') h += '<div class="dfm-nota-g">' + esc(g.nota) + '</div>';
    g.lineas.forEach(function (l) {
      h += (l.o ? '<div class="dfm-o">o</div>' : '') +
        '<div class="dfm-plato' + (l.suave ? ' suave' : '') + '">' + esc(l.t) + (l.sub ? ' <span class="dfm-sub">' + esc(l.sub) + '</span>' : '') + '</div>';
    });
    if (g.nota && g.base === '_barra') h += '<div class="dfm-nota-g">' + esc(g.nota) + '</div>';
    return h + '</div>';
  }

  function logos(base) {
    base = base || '';
    return '<div class="dfm-logos"><img src="' + base + '/logos/michelin.jpg" alt=""><img src="' + base + '/logos/repsol.jpg" alt=""><img src="' + base + '/logos/tierra.png" alt=""></div>';
  }
  function pie(m) {
    var h = '';
    if (Number(m.precio_persona)) h += '<div class="dfm-precio">' + euros(m.precio_persona) + '<span> por persona</span></div>';
    if (limpio(m.nota)) h += '<div class="dfm-nota">' + esc(m.nota) + '</div>';
    return h;
  }
  function cabeceraCliente(m) {
    var partes = [];
    if (limpio(m.cliente)) partes.push(esc(m.cliente));
    if (m.fecha) partes.push(esc(fechaLarga(m.fecha)));
    if (m.pax) partes.push(esc(m.pax) + ' comensales');
    return partes.length ? '<div class="dfm-cliente">' + partes.join(' · ') + '</div>' : '';
  }

  // ── A4 vertical ──
  function a4(m) {
    var grupos = agrupar(m.secciones);
    return '<div class="dfm-hoja dfm-a4"><div class="dfm-marco">' +
      '<div class="dfm-cab"><div class="dfm-casa">DON FADRIQUE</div><div class="dfm-lugar">Alba de Tormes</div></div>' +
      '<div class="dfm-nombre">' + esc(m.titulo || m.nombre || 'Menú') + '</div>' +
      (limpio(m.subtitulo) ? '<div class="dfm-subt">' + esc(m.subtitulo) + '</div>' : '') +
      cabeceraCliente(m) +
      '<div class="dfm-orla"></div>' +
      '<div class="dfm-cuerpo dfm-ajustar"><div class="dfm-in">' + grupos.map(htmlGrupo).join('<div class="dfm-sep">·</div>') + '</div></div>' +
      '<div class="dfm-final">' + pie(m) + logos(m._base) + '</div>' +
      '</div></div>';
  }

  // ── Tríptico A4 horizontal: portada + dos paneles de platos ──
  // ── A4 horizontal con 3 menús iguales, para cortar y entregar uno a cada cliente ──
  function triptico(m) {
    var grupos = agrupar(m.secciones);
    var uno = '<div class="dfm-panel"><div class="dfm-marco3">' +
      '<div class="dfm-casa">DON FADRIQUE</div><div class="dfm-lugar">Alba de Tormes</div>' +
      '<div class="dfm-nombre">' + esc(m.titulo || m.nombre || 'Menú') + '</div>' +
      (limpio(m.subtitulo) ? '<div class="dfm-subt">' + esc(m.subtitulo) + '</div>' : '') +
      cabeceraCliente(m) +
      '<div class="dfm-orla"></div>' +
      '<div class="dfm-cuerpo dfm-ajustar"><div class="dfm-in">' + grupos.map(htmlGrupo).join('<div class="dfm-sep">·</div>') + '</div></div>' +
      '<div class="dfm-final">' + pie(m) + logos(m._base) + '</div>' +
      '</div></div>';
    return '<div class="dfm-hoja dfm-trip">' + uno + uno + uno + '</div>';
  }

  // Reduce la letra si un bloque no cabe en su hoja/panel
  function ajustar(raiz) {
    (raiz || document).querySelectorAll('.dfm-ajustar').forEach(function (el) {
      var k = 1;
      el.style.removeProperty('--k');
      var cont = el.closest('.dfm-marco, .dfm-marco3') || el.parentElement;
      for (var n = 0; n < 30 && (cont.scrollHeight > cont.clientHeight + 1 || el.scrollHeight > el.clientHeight + 1) && k > 0.55; n++) {
        k -= 0.03; el.style.setProperty('--k', k);
      }
    });
  }

  var CSS = [
    "@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Montserrat:wght@500;600&display=swap');",
    '.dfm-hoja{background:#fff;color:#2b2621;font-family:"Cormorant Garamond",Georgia,serif;box-shadow:0 2px 18px rgba(0,0,0,.12);margin:0 auto 18px;overflow:hidden;position:relative}',
    '.dfm-a4{width:210mm;height:297mm;padding:14mm}',
    '.dfm-marco{height:100%;border:1px solid #c9b07a;outline:1px solid #c9b07a;outline-offset:-5px;padding:14mm 16mm 10mm;display:flex;flex-direction:column;align-items:center;text-align:center}',
    '.dfm-cab{margin-bottom:6mm}',
    '.dfm-casa{font-family:Montserrat,Arial,sans-serif;font-weight:600;letter-spacing:.45em;font-size:15pt;color:#2b2621;padding-left:.45em}',
    '.dfm-lugar{font-family:Montserrat,Arial,sans-serif;font-size:7.5pt;letter-spacing:.3em;color:#9a7f45;text-transform:uppercase;margin-top:2mm;padding-left:.3em}',
    '.dfm-nombre{font-size:27pt;font-weight:600;color:#8b6a2e;line-height:1.1;margin-top:2mm}',
    '.dfm-subt{font-style:italic;font-size:13pt;color:#6d6257;margin-top:1.5mm}',
    '.dfm-cliente{font-family:Montserrat,Arial,sans-serif;font-size:8pt;letter-spacing:.06em;color:#6d6257;margin-top:3mm;text-transform:uppercase}',
    '.dfm-orla{width:28mm;height:1px;background:#c9b07a;margin:6mm auto;position:relative}',
    '.dfm-orla:after{content:"";position:absolute;left:50%;top:-2.5px;width:6px;height:6px;margin-left:-3px;background:#c9b07a;transform:rotate(45deg)}',
    '.dfm-cuerpo{width:100%;font-size:calc(13pt * var(--k, 1))}',
    '.dfm-a4 .dfm-cuerpo{flex:1;overflow:hidden;display:flex;flex-direction:column}',
    '.dfm-in{margin:auto 0;width:100%}',
    '.dfm-grupo{margin:0 0 .2em}',
    '.dfm-tit{font-family:Montserrat,Arial,sans-serif;font-weight:600;font-size:.62em;letter-spacing:.32em;text-transform:uppercase;color:#9a7f45;margin-bottom:.45em;padding-left:.32em}',
    '.dfm-nota-g{font-style:italic;font-size:.8em;color:#8a7f73;margin:-.25em 0 .35em}',
    '.dfm-plato{font-size:1em;line-height:1.3;margin:.12em 0}',
    '.dfm-plato.suave{font-style:italic;color:#6d6257}',
    '.dfm-sub{font-style:italic;color:#8a7f73;font-size:.82em}',
    '.dfm-o{font-style:italic;font-size:.78em;color:#9a7f45;margin:.05em 0}',
    '.dfm-sep{color:#c9b07a;font-size:1.1em;line-height:1;margin:.45em 0}',
    '.dfm-final{margin-top:auto;padding-top:4mm;text-align:center;width:100%}',
    '.dfm-precio{font-size:17pt;font-weight:600;color:#2b2621}',
    '.dfm-precio span{font-size:10pt;font-weight:500;font-style:italic;color:#6d6257}',
    '.dfm-nota{font-family:Montserrat,Arial,sans-serif;font-size:7pt;color:#8a7f73;margin-top:1.5mm;letter-spacing:.03em}',
    '.dfm-logos{display:flex;justify-content:center;align-items:center;gap:7mm;margin-top:5mm}',
    '.dfm-logos img{height:11mm;width:auto;object-fit:contain}',
    '.dfm-trip{width:297mm;height:210mm;display:flex}',
    '.dfm-panel{width:99mm;height:210mm;padding:7mm 6mm;position:relative}',
    '.dfm-panel+.dfm-panel:before{content:"";position:absolute;left:0;top:0;bottom:0;border-left:.3mm dashed #d9d2c4}',
    '.dfm-marco3{height:100%;border:1px solid #c9b07a;padding:8mm 6mm 5mm;display:flex;flex-direction:column;align-items:center;text-align:center;overflow:hidden}',
    '.dfm-trip .dfm-casa{font-size:11pt}',
    '.dfm-trip .dfm-lugar{font-size:6pt;margin-top:1.2mm}',
    '.dfm-trip .dfm-nombre{font-size:19pt;margin-top:5mm}',
    '.dfm-trip .dfm-subt{font-size:10pt}',
    '.dfm-trip .dfm-cliente{font-size:6.5pt}',
    '.dfm-trip .dfm-orla{margin:4mm auto}',
    '.dfm-trip .dfm-cuerpo{flex:1;overflow:hidden;display:flex;flex-direction:column;font-size:calc(11pt * var(--k, 1))}',
    '.dfm-trip .dfm-final{padding-top:2mm}',
    '.dfm-trip .dfm-precio{font-size:13pt}.dfm-trip .dfm-precio span{font-size:8pt}',
    '.dfm-trip .dfm-nota{font-size:6pt}',
    '.dfm-trip .dfm-logos{gap:4mm;margin-top:3mm}.dfm-trip .dfm-logos img{height:7.5mm}',
    '@media print{.dfm-hoja{box-shadow:none;margin:0}}'
  ].join('\n');

  global.DFMenu = { agrupar: agrupar, a4: a4, triptico: triptico, ajustar: ajustar, css: CSS, euros: euros, fechaLarga: fechaLarga, esc: esc };
})(window);
