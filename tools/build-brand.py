#!/usr/bin/env python3
"""Build the production Cirrus Cc brand SVGs from the design handoff.

    python3 tools/build-brand.py

Reads brand/source/assets/*.svg (the files exactly as Claude Design handed them
over) and writes brand/*.svg with:
  - the C2PA <metadata> block removed (8 KB of provenance per file, which would
    be pasted into the apps every time a logo is embedded), and
  - every <text> element converted to an outlined <path>, as the handoff README
    asks for before production. The source SVGs set the wordmark in live text,
    which only renders correctly where Michroma and Saira are installed or
    loaded. An <img src="data:...svg">, a Word letterhead PNG and a print view
    can load neither, so they would fall back to a generic sans-serif.

Glyph positions come straight from the source files (x, baseline y, font size,
letter-spacing, text-anchor), shaped with HarfBuzz so kerning matches a
browser's. Needs: pip install fonttools uharfbuzz. Fonts (Michroma, Saira 300,
both SIL OFL) are downloaded from Google Fonts into tools/.font-cache/.
"""
import os, re, sys, urllib.request
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import uharfbuzz as hb

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'brand', 'source', 'assets')
OUT = os.path.join(ROOT, 'brand')
CACHE = os.path.join(ROOT, 'tools', '.font-cache')

FONTS = {
    ('michroma', '400'): 'https://fonts.gstatic.com/s/michroma/v21/PN_zRfy9qWD8fEagAMg6.ttf',
    ('saira', '300'): 'https://fonts.gstatic.com/s/saira/v23/memWYa2wxmKQyPMrZX79wwYZQMhsyuShhKMjjbU9uXuA7wTCosg.ttf',
}

_loaded = {}
def font(family, weight):
    key = (family.lower(), weight)
    if key in _loaded: return _loaded[key]
    path = os.path.join(CACHE, '%s-%s.ttf' % key)
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        urllib.request.urlretrieve(FONTS[key], path)
    data = open(path, 'rb').read()
    face = hb.Face(data)
    f = {'tt': TTFont(path), 'hb': hb.Font(face), 'upm': face.upem}
    _loaded[key] = f
    return f

def attr(tag, name, default=None):
    m = re.search(r'\s%s="([^"]*)"' % re.escape(name), tag)
    return m.group(1) if m else default

def num(v):
    return ('%.2f' % v).rstrip('0').rstrip('.')

def outline(tag, text):
    """One <text ...>text</text> element -> an equivalent <path>."""
    family = attr(tag, 'font-family', '').split(',')[0].strip().strip("'\"")
    weight = attr(tag, 'font-weight', '400')
    size = float(attr(tag, 'font-size'))
    spacing = float(attr(tag, 'letter-spacing', '0'))
    x = float(attr(tag, 'x', '0')); y = float(attr(tag, 'y', '0'))
    anchor = attr(tag, 'text-anchor', 'start')
    fill = attr(tag, 'fill', '#000')
    f = font(family, weight)
    scale = size / f['upm']
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(f['hb'], buf, {'kern': True, 'liga': False})
    # SVG letter-spacing is added after every character, the last one included,
    # and text-anchor positions that full advance (what Chromium does).
    width = sum(p.x_advance * scale + spacing for p in buf.glyph_positions)
    if anchor == 'middle': x -= width / 2
    elif anchor == 'end': x -= width
    glyphs = f['tt'].getGlyphSet(); order = f['tt'].getGlyphOrder()
    pen = SVGPathPen(glyphs, ntos=num)
    pen_x = x
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = order[info.codepoint]
        # font units are y-up; flip onto the SVG baseline
        t = TransformPen(pen, (scale, 0, 0, -scale, pen_x + pos.x_offset * scale, y - pos.y_offset * scale))
        glyphs[name].draw(t)
        pen_x += pos.x_advance * scale + spacing
    return '<path d="%s" fill="%s"></path>' % (pen.getCommands(), fill)

def build(name):
    s = open(os.path.join(SRC, name), encoding='utf-8').read()
    s = re.sub(r'<metadata>.*?</metadata>\s*', '', s, flags=re.S)
    s = re.sub(r'\s+xmlns:c2pa="[^"]*"', '', s)
    s = s.replace('<?xml version="1.0"?>', '')
    s = s.replace('<defs></defs>\n', '').replace('<defs></defs>', '')
    s = re.sub(r'<text([^>]*)>([^<]*)</text>', lambda m: outline(m.group(1), m.group(2)), s)
    label = 'Cirrus Cc' if 'symbol' not in name and 'icon' not in name else 'Cirrus Cc symbol'
    s = s.replace('<svg xmlns="http://www.w3.org/2000/svg"',
                  '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="%s"' % label, 1)
    s = s.strip() + '\n'
    open(os.path.join(OUT, name), 'w', encoding='utf-8').write(s)
    return len(s)

# ── Lockups, laid out from the reference HTML's spacing rules ────────────────
# The handoff's lockup/wordmark SVGs place live text at approximate positions
# (their README says so), and with the real fonts the horizontal lockup's
# "STAKEHOLDER MANAGEMENT" runs past its 400-wide viewBox. So the lockups are
# rebuilt here from the rules in "Cirrus Cc Logo Suite.dc.html", which the
# README names as the source of truth for spacing:
#   CIRRUS  Michroma, size F, line-height 1, letter-spacing 0.02em
#   Cc      Michroma F/2, top-aligned, gap 0.3F, border 1.5px (1px below
#           F=22), radius 3px (2px small), padding 0.1F / 0.17F / 0.07F
#   subtitle Saira 300, 0.37F (min 8), letter-spacing 0.4em, margin-top 0.4F
#   horizontal: symbol 104/34 F, gap 0.3 x symbol, text block centred on it
#   stacked:    symbol 96/26 F, gap 0.26 x symbol, everything centred
THEMES = {
    #         CIRRUS     Cc badge   subtitle
    'light': ('#141A24', '#35A6C9', '#5A6573'),
    'dark':  ('#FFFFFF', '#35A6C9', '#FFFFFF'),
    'ink':   ('#141A24', '#141A24', '#141A24'),
    'white': ('#FFFFFF', '#FFFFFF', '#FFFFFF'),
}
SUBTITLE = 'STAKEHOLDER MANAGEMENT'

def _metrics(family, weight):
    t = font(family, weight)['tt']; o = t['OS/2']; upm = t['head'].unitsPerEm
    return o.sTypoAscender / upm, -o.sTypoDescender / upm   # USE_TYPO_METRICS is set on both

def advance(family, weight, text, size, spacing):
    f = font(family, weight); scale = size / f['upm']
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(f['hb'], buf, {'kern': True, 'liga': False})
    return sum(p.x_advance * scale + spacing for p in buf.glyph_positions)

def text_el(family, weight, text, size, spacing, x, y, fill):
    tag = ' font-family="%s" font-weight="%s" font-size="%s" letter-spacing="%s" x="%s" y="%s" fill="%s"' % (
        family, weight, num(size), num(spacing), num(x), num(y), fill)
    return outline(tag, text)

def baseline_lh1(family, weight, size):
    """Baseline of a line-height:1 box, from its top (CSS half-leading)."""
    asc, desc = _metrics(family, weight)
    return (1 - (asc + desc)) / 2 * size + asc * size

def wordmark(F, theme, x0=0.0, y0=0.0):
    c_word, c_badge, _ = THEMES[theme]
    els = []
    sp = 0.02 * F
    w_cirrus = advance('michroma', '400', 'CIRRUS', F, sp)
    els.append(text_el('michroma', '400', 'CIRRUS', F, sp, x0, y0 + baseline_lh1('michroma', '400', F), c_word))
    f = F / 2; b = 1.5 if F >= 22 else 1.0; r = 3.0 if F >= 22 else 2.0
    pt, ps, pb = 0.1 * F, 0.17 * F, 0.07 * F
    w_cc = advance('michroma', '400', 'Cc', f, 0)
    bw, bh = 2 * b + 2 * ps + w_cc, 2 * b + pt + pb + f
    bx = x0 + w_cirrus + 0.3 * F
    els.append('<rect x="%s" y="%s" width="%s" height="%s" rx="%s" fill="none" stroke="%s" stroke-width="%s"></rect>' % (
        num(bx + b / 2), num(y0 + b / 2), num(bw - b), num(bh - b), num(r - b / 2), c_badge, num(b)))
    els.append(text_el('michroma', '400', 'Cc', f, 0, bx + b + ps, y0 + b + pt + baseline_lh1('michroma', '400', f), c_badge))
    return els, bx + bw - x0, max(F, bh)

def subtitle(F, theme, x, top, anchor='start'):
    s = max(8.0, 0.37 * F); sp = 0.4 * s
    w = advance('saira', '300', SUBTITLE, s, sp) - sp      # visible width, trailing spacing dropped
    if anchor == 'middle': x -= w / 2
    asc, desc = _metrics('saira', '300')
    el = text_el('saira', '300', SUBTITLE, s, sp, x, top + asc * s, THEMES[theme][2])
    return el, w, (asc + desc) * s

def symbol_inner(theme):
    s = open(os.path.join(OUT, 'cirrus-cc-symbol-%s.svg' % theme), encoding='utf-8').read()
    return s[s.index('>') + 1:s.rindex('</svg>')].strip()

def svg(w, h, body, label='Cirrus Cc'):
    return ('<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="%s" viewBox="0 0 %s %s" width="%s" height="%s">\n%s\n</svg>\n'
            % (label, num(w), num(h), num(w), num(h), '\n'.join(body)))

PAD = 2.0   # room for the wisp's round cap, which sits just outside the 100-unit box

def lockup_horizontal(theme, F=34.0):
    S = 104 / 34 * F
    wm_probe = wordmark(F, theme)
    _, sub_w, sub_h = subtitle(F, theme, 0, 0)
    col_h = wm_probe[2] + 0.4 * F + sub_h
    x0 = PAD + S + 0.3 * S; top = PAD + (S - col_h) / 2
    wm, wm_w, row_h = wordmark(F, theme, x0, top)
    sub, _, _ = subtitle(F, theme, x0, top + row_h + 0.4 * F)
    body = ['<g transform="translate(%s,%s) scale(%s)">%s</g>' % (num(PAD), num(PAD), num(S / 100), symbol_inner(theme))] + wm + [sub]
    return svg(x0 + max(wm_w, sub_w) + PAD, S + 2 * PAD, body)

def lockup_stacked(theme, F=26.0):
    S = 96 / 26 * F
    _, wm_w, row_h = wordmark(F, theme)
    _, sub_w, sub_h = subtitle(F, theme, 0, 0)
    W = max(S, wm_w, sub_w) + 2 * PAD; cx = W / 2
    top = PAD + S + 0.26 * S
    wm, _, _ = wordmark(F, theme, cx - wm_w / 2, top)
    sub, _, _ = subtitle(F, theme, cx, top + row_h + 0.4 * F, 'middle')
    body = ['<g transform="translate(%s,%s) scale(%s)">%s</g>' % (num(cx - S / 2), num(PAD), num(S / 100), symbol_inner(theme))] + wm + [sub]
    return svg(W, top + row_h + 0.4 * F + sub_h + PAD, body)

def wordmark_only(theme, F=34.0):
    wm, w, h = wordmark(F, theme, PAD, PAD)
    return svg(w + 2 * PAD, h + 2 * PAD, wm)

if __name__ == '__main__':
    names = sorted(n for n in os.listdir(SRC) if n.endswith('.svg'))
    for n in names:
        if n.startswith('cirrus-cc-symbol') or n in ('cirrus-cc-favicon.svg', 'cirrus-cc-app-icon.svg'):
            print('%-42s %6d bytes' % (n, build(n)))
    for theme in THEMES:
        for kind, fn in (('lockup-horizontal', lockup_horizontal), ('lockup-stacked', lockup_stacked), ('wordmark', wordmark_only)):
            n = 'cirrus-cc-%s-%s.svg' % (kind, theme)
            out = fn(theme)
            open(os.path.join(OUT, n), 'w', encoding='utf-8').write(out)
            print('%-42s %6d bytes' % (n, len(out)))
