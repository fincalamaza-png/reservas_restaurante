#!/usr/bin/env python3
# Copia a la base oficial los datos propios de Gestión que se metieron en la versión de pruebas.
# No toca reservas, propuestas ni los menús que ya tenía la oficial.
import json, sqlite3, sys
dev, prod, antes = sys.argv[1], sys.argv[2], sys.argv[3]
menus_oficiales = set(json.load(open(antes)))
s = sqlite3.connect(dev); s.row_factory = sqlite3.Row
d = sqlite3.connect(prod)
def cols(c, t): return [r[1] for r in c.execute('PRAGMA table_info(%s)' % t)]
def existe(c, t): return bool(c.execute("select 1 from sqlite_master where type='table' and name=?", (t,)).fetchone())
with d:
    # Tablas que solo usa Gestión: se copian enteras si en la oficial están vacías
    for t in ['gastos_admin', 'pagos', 'trabajadores', 'celebraciones', 'documentos_admin', 'menus_personalizados']:
        if not existe(s, t) or not existe(d, t): continue
        n_dest = d.execute('select count(*) from %s' % t).fetchone()[0]
        filas = s.execute('select * from %s' % t).fetchall()
        if n_dest:
            print('  %-22s la oficial ya tiene %d: no se copia' % (t, n_dest)); continue
        comunes = [c for c in cols(s, t) if c in cols(d, t)]
        for f in filas:
            d.execute('insert into %s (%s) values (%s)' % (t, ','.join(comunes), ','.join('?' * len(comunes))), [f[c] for c in comunes])
        print('  %-22s %d copiados' % (t, len(filas)))
    # Menús nuevos de Gestión (los que la oficial no tenía): se trae la versión de pruebas, con sus cambios
    comunes = [c for c in cols(s, 'plantillas_menu') if c in cols(d, 'plantillas_menu') and c != 'id']
    for f in s.execute('select * from plantillas_menu'):
        if f['nombre'] in menus_oficiales:
            o = d.execute('select secciones, precio_persona from plantillas_menu where nombre = ?', (f['nombre'],)).fetchone()
            if o and (o[0] != f['secciones'] or o[1] != f['precio_persona']):
                print('  menú «%s»: distinto en pruebas y en la oficial → se deja el de la oficial' % f['nombre'])
            continue
        if d.execute('select 1 from plantillas_menu where nombre = ?', (f['nombre'],)).fetchone():
            d.execute('update plantillas_menu set %s where nombre = ?' % ','.join(c + '=?' for c in comunes), [f[c] for c in comunes] + [f['nombre']])
        else:
            d.execute('insert into plantillas_menu (%s) values (%s)' % (','.join(comunes), ','.join('?' * len(comunes))), [f[c] for c in comunes])
        print('  menú «%s» traído de Gestión' % f['nombre'])
    # Permisos de usuarios configurados en Gestión (Ángela, etc.) y sus PIN si la oficial no los tiene
    cfg_s = dict(s.execute("select clave, valor from config where clave in ('pin_admin','permisos_usuarios','ver_fichajes')").fetchall())
    cfg_d = dict(d.execute("select clave, valor from config where clave in ('pin_admin','permisos_usuarios','ver_fichajes')").fetchall())
    pins_s, pins_d = json.loads(cfg_s.get('pin_admin') or '{}'), json.loads(cfg_d.get('pin_admin') or '{}')
    nuevos = {k: v for k, v in pins_s.items() if k not in pins_d}
    if nuevos:
        pins_d.update(nuevos); d.execute("insert or replace into config (clave, valor) values ('pin_admin', ?)", (json.dumps(pins_d, ensure_ascii=False),))
        print('  usuarios añadidos: ' + ', '.join(nuevos))
    if cfg_s.get('permisos_usuarios'):
        perm = json.loads(cfg_d.get('permisos_usuarios') or '{}'); perm.update(json.loads(cfg_s['permisos_usuarios']))
        d.execute("insert or replace into config (clave, valor) values ('permisos_usuarios', ?)", (json.dumps(perm, ensure_ascii=False),))
        print('  permisos: ' + ', '.join('%s=%s' % (k, 'admin' if v.get('admin') else ','.join(v.get('modulos', []))) for k, v in perm.items()))
    if cfg_s.get('ver_fichajes'):
        d.execute("insert or replace into config (clave, valor) values ('ver_fichajes', ?)", (cfg_s['ver_fichajes'],))
print('Datos de Gestión pasados a la oficial.')
