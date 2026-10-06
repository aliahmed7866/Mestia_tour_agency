"""Build a public sandbox from fresh seed content, never the operator database."""
import json, secrets, shutil, sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from mestia import create_app
from mestia.db import connect
OUT = ROOT / '_pages_site'
OUT.mkdir(exist_ok=True)
for p in (ROOT / 'pages-demo').glob('*'):
    if p.is_file() and p.suffix in {'.html', '.css', '.js'}:
        shutil.copy2(p, OUT / p.name)
with tempfile.TemporaryDirectory() as tmp:
    app = create_app({'TESTING': True, 'SECRET_KEY': secrets.token_hex(32),
                      'DATABASE': str(Path(tmp)/'demo.sqlite3'), 'MEDIA_DIR': str(Path(tmp)/'media')})
    conn = connect(app.config['DATABASE'])
    fields = ['id','kind','title_en','title_ka','description_en','description_ka','duration','difficulty','season_months','region','base_location','price_basis','itinerary_en','inclusions_en','exclusions_en','requirements_en','weather_en','meeting_point_en','published','capacity']
    services = [dict(zip(fields, tuple(r))) for r in conn.execute('SELECT '+','.join(fields)+' FROM services WHERE archived_at IS NULL')]
    conn.close()
for s in services:
    s.update(price=120 if s['kind']=='tour' else (90 if s['kind']=='stay' else 160), archived=False)
(OUT/'seed.js').write_text('window.DEMO_SEED = '+json.dumps(services,ensure_ascii=False)+';\n')
assets = OUT/'assets'
assets.mkdir(exist_ok=True)
for p in [ROOT/'mestia/static/mountains.svg', * (ROOT/'mestia/static/destinations').glob('*.svg')]:
    shutil.copy2(p,assets/p.name)
(OUT/'.nojekyll').touch()
(OUT/'robots.txt').write_text('User-agent: *\nDisallow: /\n')
print(f'Built public demo with {len(services)} seeded offerings at {OUT}')
