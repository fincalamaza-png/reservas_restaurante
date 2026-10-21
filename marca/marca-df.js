/* Marca Don Fadrique. Uso en cualquier pantalla:
   <div data-df-logo="TPV Restaurante"></div>          logotipo con su sección debajo
   <div data-df-logo="Cocina" class="fila inv"></div>  en una línea, sobre fondo oscuro
   <div data-df-premios></div>                         Michelin · Sol Repsol · Tierra de Sabor */
(function(){
  var s = document.currentScript, base = s ? s.src.replace(/[^\/]*$/, '') : '/marca/';
  function esc(t){ return String(t).replace(/[&<>"]/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function logo(sub){ return '<span class="df-n">DON FADRIQUE</span>' + (sub ? '<span class="df-s">' + esc(sub) + '</span>' : '') + '<span class="df-l"></span>'; }
  function premios(){ return '<img src="' + base + 'premios/michelin.png" alt="Guía Michelin 2026">' +
    '<img class="r" src="' + base + 'premios/repsol.png" alt="1 Sol Guía Repsol 2026">' +
    '<img src="' + base + 'premios/tierra.png" alt="Tierra de Sabor · Castilla y León">'; }
  function pintar(raiz){
    (raiz || document).querySelectorAll('[data-df-logo]').forEach(function(e){ if (e.getAttribute('data-df-hecho')) return; e.classList.add('df-logo'); e.innerHTML = logo(e.getAttribute('data-df-logo')); e.setAttribute('data-df-hecho', '1'); });
    (raiz || document).querySelectorAll('[data-df-premios]').forEach(function(e){ if (e.getAttribute('data-df-hecho')) return; e.classList.add('df-premios'); e.innerHTML = premios(); e.setAttribute('data-df-hecho', '1'); });
  }
  window.DFMarca = { logo: function(sub, clases){ return '<div class="df-logo ' + (clases || '') + '">' + logo(sub) + '</div>'; },
    premios: function(clases, alto){ return '<div class="df-premios ' + (clases || '') + '"' + (alto ? ' style="--h:' + alto + 'px"' : '') + '>' + premios() + '</div>'; }, pintar: pintar };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ pintar(); }); else pintar();
  // Pantallas que se dibujan con JavaScript: se rellenan solas al aparecer
  var pend = false;
  if (window.MutationObserver) new MutationObserver(function(){ if (pend) return; pend = true; setTimeout(function(){ pend = false; pintar(); }, 60); }).observe(document.documentElement, { childList: true, subtree: true });
})();
