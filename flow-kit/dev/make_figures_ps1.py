# -*- coding: utf-8 -*-
# 図（SVG）を、build_guide.ps1 が読み込む tools/_figures.ps1 に書き出す。
# 使い方: python3 dev/make_figures_ps1.py
import os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import diagrams as d

def body(fig_html):
    # <figure class="fig"><svg ...>...</svg><figcaption>...</figcaption></figure> をそのまま使う
    return fig_html.strip()

figs = {'FigApply': d.FIGS['apply'], 'FigCompose': d.FIGS['compose'], 'FigRunAfter': d.FIGS['runafter'], 'FigLayout': d.FIGS['layout']}
out = ['<#', '  build_guide.ps1 が使う、画面の見取り図（SVG）。dev/make_figures_ps1.py が生成する（手で直さない）。', '#>', '']
for k, v in figs.items():
    assert "'@" not in v
    out.append('$script:%s = @\'' % k)
    out.append(body(v))
    out.append("'@")
    out.append('')
text = '\n'.join(out)
dest = os.path.join(os.path.dirname(HERE), 'tools', '_figures.ps1')
open(dest, 'w', encoding='utf-8-sig', newline='\n').write(text)
print('wrote', dest, len(text))
