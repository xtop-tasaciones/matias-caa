"""Descarga los pictogramas ARASAAC del vocabulario inicial para que la app funcione sin internet.
Se ejecuta en GitHub Actions (ver .github/workflows/pictos.yml)."""
import io, json, os, time, urllib.parse, urllib.request
from PIL import Image

API = 'https://api.arasaac.org/v1/pictograms'
queries = json.load(open('tools/pictos-queries.json', encoding='utf-8'))
os.makedirs('pictos/color', exist_ok=True)
os.makedirs('pictos/bn', exist_ok=True)
index_path = 'pictos/index.json'
index = json.load(open(index_path, encoding='utf-8')) if os.path.exists(index_path) else {}

def get(url):
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'matias-caa'}), timeout=30) as r:
                return r.read()
        except Exception as e:
            err = e
            time.sleep(1 + i)
    raise err

def find(q):
    for kind in ('bestsearch', 'search'):
        try:
            res = json.loads(get(f"{API}/es/{kind}/{urllib.parse.quote(q)}"))
            if res:
                return res[0]
        except Exception:
            pass
    return None

def save_png(data, path, size=300):
    im = Image.open(io.BytesIO(data)).convert('RGBA')
    im.thumbnail((size, size), Image.LANCZOS)
    im.save(path, optimize=True)

for card_id, qs in queries.items():
    forced = index.get(card_id, {}).get('fixed')
    hit = None
    if forced:
        hit = {'_id': forced, 'keywords': [{'keyword': index[card_id].get('keyword', '')}]}
    else:
        for q in qs:
            hit = find(q)
            if hit:
                break
    if not hit:
        print('SIN RESULTADO', card_id, qs)
        continue
    pid = hit['_id']
    if index.get(card_id, {}).get('arasaac') == pid and os.path.exists(f'pictos/bn/{card_id}.png'):
        continue
    try:
        save_png(get(f'https://static.arasaac.org/pictograms/{pid}/{pid}_500.png'), f'pictos/color/{card_id}.png')
        save_png(get(f'{API}/{pid}?color=false&resolution=500&download=false'), f'pictos/bn/{card_id}.png')
    except Exception as e:
        print('ERROR', card_id, pid, e)
        continue
    kw = (hit.get('keywords') or [{}])[0].get('keyword', '')
    index[card_id] = {**index.get(card_id, {}), 'arasaac': pid, 'keyword': kw}
    print(card_id, pid, kw)

json.dump(index, open(index_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, sort_keys=True)
