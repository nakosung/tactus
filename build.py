#!/usr/bin/env python3
"""Build Tactus into self-contained HTML pages.

    python3 build.py                     # dist/: the site (index.html, play/index.html, icons) and dist/tactus.html
    python3 build.py --out ../site/tactus   # write the site somewhere else (e.g. a GitHub Pages checkout)
    python3 build.py --app-url URL       # also write dist/landing-standalone.html that links to the app at URL

Everything is inlined: scripts, the sample kit, the Rust DSP module and the demo audio, so each page works
from a single file. Nothing here needs network access.
"""
import argparse, base64, datetime, json, os, shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'src')
REPO = 'https://github.com/nakosung/tactus'
# order matters: later scripts use what earlier ones define
APP_JS = ['i18n', 'kit', 'engine', 'gen', 'presets', 'audio', 'mix', 'dsp_wasm', 'synth', 'samples', 'musical',
          'nsax_net', 'gpu', 'loops', 'preview', 'hand', 'ui', 'viz']
PLACEHOLDER = {'dsp_wasm': 'DSPWASM', 'nsax_net': 'NSAXNET'}


def read(*p):
    with open(os.path.join(*p), encoding='utf-8') as f:
        return f.read()


def js(name):
    return read(SRC, 'js', name + '.js')


def build_app():
    page = read(SRC, 'app.html')
    stamp = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime('%m.%d %H:%M')
    page = page.replace('/*BUILD*/', 'build ' + stamp)
    for name in APP_JS:
        page = page.replace('/*%s*/' % PLACEHOLDER.get(name, name.upper()), js(name))
    return page.replace("if (typeof module !== 'undefined') module.exports", 'if (false) module.exports')


def build_landing(app_url, home, conduct):
    meta = json.loads(read(ROOT, 'assets', 'demos', 'meta.json'))
    demos = {}
    for k, v in meta.items():
        with open(os.path.join(ROOT, 'assets', 'demos', k + '.mp3'), 'rb') as f:
            demos[k] = {'code': v['code'], 'pos0': round(v['pos0'], 4), 'cps': v['cps'], 'mp3': base64.b64encode(f.read()).decode()}
    ko, en = conduct
    dsp_link = f'<a href="{REPO}/tree/main/dsp" target="_blank" rel="noopener" data-ko="Rust 소스와 벤치마크 보기" data-en="Rust source and benchmark">Rust 소스와 벤치마크 보기</a>'
    s = read(SRC, 'landing.html')
    s = (s.replace('/*DSPSRC*/', dsp_link).replace('/*CONDUCT*/', f'<p data-ko="{ko}" data-en="{en}">{ko}</p>').replace('/*HOME*/', home)
          .replace('/*REPO*/', REPO).replace('/*I18N*/', js('i18n')).replace('/*ENGINE*/', js('engine').replace("if (typeof module !== 'undefined') module.exports", 'if (false) module.exports'))
          .replace('/*GEN*/', js('gen')).replace('/*GPUJS*/', js('gpu')).replace('/*DEMOS*/', json.dumps(demos)).replace('/*APP_URL*/', app_url))
    return s


def page(body, head_extra, desc):
    """Wrap a page body in a full HTML document (the sources start with <title> and inline <style>)."""
    head = ('<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            f'<meta name="description" content="{desc}">\n' + head_extra + '<meta name="theme-color" content="#17191e">\n')
    first = body.find('<div class="')
    return head + body[:first] + '</head>\n<body>\n' + body[first:] + '\n</body>\n</html>\n'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(ROOT, 'dist'))
    ap.add_argument('--app-url', default=None)
    a = ap.parse_args()
    os.makedirs(os.path.join(a.out, 'play'), exist_ok=True)

    app = build_app()
    # the app on its own, for opening from disk
    os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
    with open(os.path.join(ROOT, 'dist', 'tactus.html'), 'w', encoding='utf-8') as f:
        f.write(app)

    conduct_site = ('카메라로 두 손을 따라가요. Chrome에서 Tactus를 열고 손 컨트롤을 켠 뒤 카메라를 허용하면 돼요.',
                    'The camera follows both hands. Open Tactus in Chrome, turn on hand control and allow the camera.')
    land = build_landing('./play/', '<a class="home" href="/">Nako Sung</a>', conduct_site)
    land = land.replace('href="./play/" target="_blank" rel="noopener"', 'href="./play/"')
    icons = '<link rel="icon" type="image/png" sizes="32x32" href="{p}favicon-32.png">\n<link rel="apple-touch-icon" href="{p}apple-touch-icon.png">\n'
    og = '<meta property="og:title" content="Tactus">\n<meta property="og:description" content="A live-coding music instrument built live, in one conversation with Claude.">\n'
    with open(os.path.join(a.out, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(page(land, icons.format(p='') + og, 'Tactus: a live-coding music instrument for the browser. Write it, play it with pads, compose from a seed, conduct it with your hands.'))
    app_site = app.replace('<b>TACTUS</b>', '<a href="../" style="color:inherit;text-decoration:none" title="Tactus"><b>TACTUS</b></a>', 1)
    with open(os.path.join(a.out, 'play', 'index.html'), 'w', encoding='utf-8') as f:
        f.write(page(app_site, icons.format(p='../'), 'Tactus live-coding instrument'))
    for icon in ('favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'):
        shutil.copy(os.path.join(ROOT, 'assets', 'icons', icon), os.path.join(a.out, icon))

    if a.app_url:
        conduct = ('카메라로 두 손을 따라가요. 내려받은 파일을 Chrome에서 열면 쓸 수 있어요.', 'The camera follows both hands. It works when you open the downloaded file in Chrome.')
        with open(os.path.join(ROOT, 'dist', 'landing-standalone.html'), 'w', encoding='utf-8') as f:
            f.write(build_landing(a.app_url, '', conduct))
    for p in [os.path.join(ROOT, 'dist', 'tactus.html'), os.path.join(a.out, 'index.html'), os.path.join(a.out, 'play', 'index.html')]:
        print('%6d KB  %s' % (os.path.getsize(p) // 1024, p))


if __name__ == '__main__':
    main()
