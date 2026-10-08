# -*- coding: utf-8 -*-
import html
esc = html.escape
COL = {'trig':'#0f6cbd','scope':'#8c3a00','excel':'#107c41','apply':'#5f6b7a','comp':'#7a52b3','mail':'#0f6cbd'}

class Svg:
    def __init__(self, w, h, title, uid):
        self.w, self.h, self.uid = w, h, uid
        self.parts = []
        self.title = title
    def rect(self, x, y, w, h, fill='none', stroke='none', sw=1, rx=6, dash=None, cls=''):
        d = f' stroke-dasharray="{dash}"' if dash else ''
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d} class="{cls}"/>')
    def text(self, x, y, s, cls='st', anchor='start', size=14, weight='normal'):
        self.parts.append(f'<text x="{x}" y="{y}" class="{cls}" text-anchor="{anchor}" font-size="{size}" font-weight="{weight}">{esc(s)}</text>')
    def lines(self, x, y, arr, cls='st', anchor='start', size=14, lh=20, weight='normal'):
        for i, s in enumerate(arr):
            self.text(x, y + i*lh, s, cls, anchor, size, weight)
    def arrow(self, x1, y1, x2, y2, col='var(--sub)', sw=2, dash=None):
        d = f' stroke-dasharray="{dash}"' if dash else ''
        self.parts.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{col}" stroke-width="{sw}"{d} marker-end="url(#ah{self.uid}{"w" if col.startswith("var(--warn") else "n"})"/>')
    def path(self, d, col='var(--warn)', sw=2.5, dash=None):
        dd = f' stroke-dasharray="{dash}"' if dash else ''
        self.parts.append(f'<path d="{d}" fill="none" stroke="{col}" stroke-width="{sw}"{dd} marker-end="url(#ah{self.uid}w)"/>')
    def badge(self, x, y, n):
        self.parts.append(f'<circle cx="{x}" cy="{y}" r="13" fill="var(--warn)"/><text x="{x}" y="{y+5}" text-anchor="middle" font-size="14" font-weight="bold" fill="#fff">{n}</text>')
    def node(self, x, y, w, h, col, l1, l2=None):
        self.rect(x, y, w, h, fill=col, rx=5)
        if l2:
            self.text(x+w/2, y+h/2-3, l1, 'sw', 'middle', 14, 'bold'); self.text(x+w/2, y+h/2+15, l2, 'sw', 'middle', 11)
        else:
            self.text(x+w/2, y+h/2+5, l1, 'sw', 'middle', 14, 'bold')
    def out(self):
        u = self.uid
        defs = (f'<defs><marker id="ah{u}n" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="var(--sub)"/></marker>'
                f'<marker id="ah{u}w" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="var(--warn)"/></marker></defs>')
        return (f'<figure class="fig"><svg viewBox="0 0 {self.w} {self.h}" role="img" aria-label="{esc(self.title)}" xmlns="http://www.w3.org/2000/svg" font-family="Yu Gothic UI, Meiryo UI, Hiragino Sans, sans-serif">'
                + defs + ''.join(self.parts) + f'</svg><figcaption>{esc(self.title)}</figcaption></figure>')

# ---------- A: 完成図 ----------
def fig_complete():
    s = Svg(900, 590, '完成図：見本づくりフローの形（番号は第2章の手順の番号）', 'a')
    s.rect(0, 0, 900, 590, fill='var(--card)', stroke='var(--line)', rx=10)
    s.node(270, 18, 240, 46, COL['trig'], 'Manually trigger a flow', '手動で実行するトリガー')
    s.arrow(390, 64, 390, 92)
    # Try
    s.rect(160, 92, 460, 300, fill='var(--bg)', stroke=COL['scope'], sw=2, rx=8)
    s.rect(160, 92, 460, 36, fill=COL['scope'], rx=8)
    s.text(180, 116, 'Try（スコープ＝まとめる箱）', 'sw', 'start', 15, 'bold')
    s.node(230, 148, 320, 50, COL['excel'], 'List rows present in a table', 'Excel Online (Business)：表の行を一覧表示')
    s.arrow(390, 198, 390, 222)
    s.rect(200, 222, 380, 150, fill='var(--card)', stroke=COL['apply'], sw=2, rx=8)
    s.rect(200, 222, 380, 34, fill=COL['apply'], rx=8)
    s.text(218, 245, 'Apply to each（それぞれに適用＝繰り返し）', 'sw', 'start', 14, 'bold')
    s.text(218, 276, '繰り返す対象：一覧取得の「value」', 'ss', 'start', 12)
    s.node(250, 292, 280, 50, COL['comp'], 'Compose', '作成（何か1つ表示するだけ）')
    # Catch
    s.arrow(390, 392, 390, 430)
    s.rect(160, 430, 460, 140, fill='var(--bg)', stroke=COL['scope'], sw=2, rx=8)
    s.rect(160, 430, 460, 36, fill=COL['scope'], rx=8)
    s.text(180, 454, 'Catch（スコープ＝失敗したときの通知）', 'sw', 'start', 15, 'bold')
    s.node(230, 492, 320, 50, COL['mail'], 'Send an email (V2)', 'Outlook：メールの送信（自分宛）')
    # 注釈: 失敗時だけ
    s.path('M 624 300 C 690 300, 690 440, 626 448', 'var(--warn)', 3, '7 5')
    s.text(712, 350, 'Try が失敗した', 'sw2', 'start', 14, 'bold')
    s.text(712, 370, 'ときだけ動く', 'sw2', 'start', 14, 'bold')
    s.text(712, 390, '（Run after）', 'sw2', 'start', 14, 'bold')
    # バッジ
    s.badge(160, 92, 2); s.badge(230, 148, 3); s.badge(200, 222, 4); s.badge(250, 292, 4)
    s.badge(160, 430, 5); s.badge(230, 492, 6); s.badge(600, 430, 7)
    s.text(20, 582, '※ 画面の上の箱が「始まり」、下に向かって順番に動きます。', 'ss', 'start', 12)
    return s.out()

# ---------- B: 画面の見取り図 ----------
def fig_layout():
    s = Svg(880, 520, '画面の見取り図：コードの取り出しはここ（Code view タブ）', 'b')
    s.rect(0, 0, 880, 520, fill='var(--card)', stroke='var(--line)', rx=10)
    s.rect(0, 0, 880, 34, fill='var(--bg)', rx=10)
    s.text(16, 23, '← Back    見本づくり', 'st', 'start', 14)
    # 左パネル
    s.rect(12, 46, 360, 462, fill='var(--bg)', stroke='var(--line)', rx=6)
    s.rect(24, 58, 24, 24, fill=COL['excel'], rx=4)
    s.text(60, 76, 'List rows present in a table', 'st', 'start', 15, 'bold')
    s.text(340, 76, '⋮  «', 'ss', 'start', 15)
    tabs = [('Parameters', 24, 82), ('Settings', 110, 60), ('Code view', 178, 74), ('Testing', 260, 52), ('About', 320, 40)]
    for t, x, w in tabs:
        if t == 'Code view':
            s.rect(x-6, 96, w+12, 30, fill='none', stroke='var(--warn)', sw=3, rx=6)
        s.text(x, 116, t, 'st', 'start', 13, 'bold' if t in ('Parameters', 'Code view') else 'normal')
    s.rect(24, 128, 82, 3, fill='var(--acc)', rx=1)
    # フィールド（ダミー）
    for i, lab in enumerate(['Location *', 'Document Library *', 'File *', 'Table *']):
        y = 150 + i*60
        s.text(24, y, lab, 'ss', 'start', 12)
        s.rect(24, y+8, 334, 30, fill='var(--card)', stroke='var(--line)', rx=4)
    s.text(24, 410, '（Parameters タブでは設定する項目が並びます）', 'ss', 'start', 12)
    # 右キャンバス
    s.node(520, 56, 190, 44, COL['trig'], 'Manually trigger a flow')
    s.arrow(615, 100, 615, 128)
    s.rect(470, 128, 290, 150, fill='var(--bg)', stroke=COL['scope'], sw=2, rx=6)
    s.rect(470, 128, 290, 28, fill=COL['scope'], rx=6)
    s.text(484, 147, 'Try', 'sw', 'start', 14, 'bold')
    s.rect(500, 176, 230, 52, fill=COL['excel'], stroke='var(--acc)', sw=4, rx=5)
    s.text(615, 207, 'List rows present in a table', 'sw', 'middle', 13, 'bold')
    s.arrow(615, 278, 615, 300)
    s.node(520, 300, 190, 44, COL['apply'], 'Apply to each')
    # 吹き出し
    s.badge(640, 177, 1)
    s.text(500, 250, '① 取りたい箱を1回クリック（青い枠が付く）', 'sw2', 'start', 12, 'bold')
    s.path('M 224 100 C 224 82, 250 82, 250 90', 'var(--warn)', 0.1)
    s.badge(215, 90, 2)
    s.lines(395, 372, ['② 左のパネルの「Code view」タブをクリック', '③ 出てきた文字の中をクリック', '    → Ctrl＋A（全部選ぶ）→ Ctrl＋C（コピー）', '④ 伏字ツールに貼り付ける'], 'sw2', 'start', 13, 21, 'bold')
    s.lines(395, 480, ['※ ページ分け・並列実行などの設定は「Settings」タブにあります'], 'ss', 'start', 12, 18)
    return s.out()

# ---------- C: Apply to each の入力 ----------
def fig_apply():
    s = Svg(880, 470, 'Apply to each：「どの結果を繰り返すか」の入れ方', 'c')
    s.rect(0, 0, 880, 470, fill='var(--card)', stroke='var(--line)', rx=10)
    s.rect(14, 14, 420, 300, fill='var(--bg)', stroke='var(--line)', rx=6)
    s.rect(26, 26, 22, 22, fill=COL['apply'], rx=4)
    s.text(58, 44, 'Apply to each', 'st', 'start', 15, 'bold')
    s.text(26, 80, 'Parameters', 'st', 'start', 13, 'bold'); s.text(110, 80, 'Settings', 'st', 'start', 13); s.text(178, 80, 'Code view', 'st', 'start', 13); s.text(262, 80, 'About', 'st', 'start', 13)
    s.rect(26, 88, 82, 3, fill='var(--acc)', rx=1)
    s.text(26, 124, 'Select an output from previous steps *', 'st', 'start', 13)
    s.rect(26, 134, 396, 34, fill='var(--card)', stroke='var(--acc)', sw=2, rx=4)
    s.text(36, 156, 'Select an output from previous steps', 'ss', 'start', 12)
    # 右端アイコン
    s.rect(392, 128, 26, 20, fill='var(--acc)', rx=4); s.text(405, 143, '⚡', 'sw', 'middle', 12)
    s.rect(392, 150, 26, 20, fill='var(--sub)', rx=4); s.text(405, 164, 'fx', 'sw', 'middle', 11, 'bold')
    s.text(26, 192, "'Select an output from previous steps' is required.", 'sred', 'start', 12)
    s.badge(40, 212, 1); s.text(62, 217, '欄をクリックする', 'sw2', 'start', 14, 'bold')
    s.badge(40, 238, 2); s.text(62, 243, '右端の上のアイコン（⚡）を押す', 'sw2', 'start', 14, 'bold')
    s.badge(40, 264, 3); s.text(62, 269, '右の一覧の「value」を選ぶ', 'sw2', 'start', 14, 'bold')
    s.badge(40, 290, 4); s.text(62, 295, '見つからないとき → 下の fx を押して式を貼る', 'sw2', 'start', 13, 'bold')
    # 吹き出し（動的なコンテンツ）
    s.rect(470, 28, 396, 270, fill='var(--bg)', stroke='var(--acc)', sw=2, rx=8)
    s.text(486, 54, '動的なコンテンツ（前の箱の結果の一覧）', 'st', 'start', 14, 'bold')
    s.text(486, 72, '※ 一覧の並びは想定の図です', 'ss', 'start', 11)
    s.rect(482, 88, 372, 26, fill='var(--card)', stroke='var(--line)', rx=4); s.text(494, 106, 'Search', 'ss', 'start', 12)
    s.rect(482, 124, 372, 24, fill='var(--line)', rx=4)
    s.rect(482, 124, 24, 24, fill=COL['excel'], rx=4); s.text(516, 141, 'List rows present in a table', 'st', 'start', 13, 'bold')
    s.rect(482, 156, 372, 34, fill='var(--warn-bg2)', stroke='var(--warn)', sw=3, rx=4)
    s.text(500, 178, 'value', 'st', 'start', 14, 'bold')
    s.text(560, 178, 'List of Items（表の行の一覧）', 'ss', 'start', 12)
    s.badge(840, 173, 3)
    for i, t in enumerate(['body', 'Link to item', 'Item URL（など）']):
        s.text(500, 214 + i*24, t, 'ss', 'start', 13)
    s.path('M 420 140 C 440 140, 450 150, 482 168', 'var(--warn)', 2.5)
    # 結果
    s.rect(14, 330, 852, 126, fill='var(--bg)', stroke='var(--ok)', sw=2, rx=8)
    s.text(30, 356, '③ のあとの完成の姿', 'st', 'start', 14, 'bold')
    s.rect(30, 368, 500, 34, fill='var(--card)', stroke='var(--acc)', sw=2, rx=4)
    s.rect(40, 374, 64, 22, fill=COL['excel'], rx=11); s.text(72, 390, 'value', 'sw', 'middle', 13, 'bold')
    s.text(30, 428, 'このように、欄の中に「value」と書かれた丸い札が入れば成功です。赤い必須エラーが消えます。', 'st', 'start', 13)
    s.text(30, 446, '（見つからないとき：fx で式の欄を開き、body(\'List_rows_present_in_a_table\')?[\'value\'] を貼って「Add」）', 'ss', 'start', 12)
    return s.out()

# ---------- D: 実行条件（実際の画面をもとにした図） ----------
def fig_runafter():
    s = Svg(880, 400, '実行条件の構成（Run after）：Catch を「Try が失敗したときだけ」動かす（実際の画面をもとにした図）', 'd')
    s.rect(0, 0, 880, 400, fill='var(--card)', stroke='var(--line)', rx=10)
    s.rect(14, 14, 430, 372, fill='var(--bg)', stroke='var(--line)', rx=6)
    s.rect(26, 26, 22, 22, fill=COL['scope'], rx=4); s.text(58, 44, 'catch', 'st', 'start', 15, 'bold')
    s.text(26, 80, 'Parameters', 'st', 'start', 13); s.rect(100, 62, 70, 26, fill='none', stroke='var(--warn)', sw=3, rx=5); s.text(106, 80, 'Settings', 'st', 'start', 13, 'bold'); s.text(190, 80, 'Code view', 'st', 'start', 13); s.text(274, 80, 'About', 'st', 'start', 13)
    s.badge(135, 56, 1)
    s.text(26, 114, '⌄ Run after', 'st', 'start', 14, 'bold')
    s.rect(40, 126, 150, 28, fill='var(--card)', stroke='var(--warn)', sw=3, rx=5); s.text(50, 145, '＋ Select actions ⌄', 'st', 'start', 13, 'bold')
    s.badge(206, 140, 2)
    # Try の行
    s.rect(40, 164, 392, 28, fill='var(--line)', rx=4); s.rect(46, 168, 20, 20, fill=COL['scope'], rx=3); s.text(76, 184, 'Try', 'st', 'start', 13, 'bold')
    rows = [('Is successful', False, '#2e8b3a'), ('Has timed out', True, '#d97706'), ('Is skipped', False, '#6b7280'), ('Has failed', True, '#b91c1c')]
    for k, (t, on, c) in enumerate(rows):
        y = 214 + k*24
        s.rect(64, y-13, 16, 16, fill=('var(--acc)' if on else 'var(--card)'), stroke='var(--sub)', sw=1.5, rx=3)
        if on: s.text(72, y, '✓', 'sw', 'middle', 12, 'bold')
        s.parts.append(f'<circle cx="98" cy="{y-5}" r="7" fill="{c}"/>')
        s.text(112, y, t, 'st', 'start', 13, 'bold' if on else 'normal')
    s.badge(300, 262, 3)
    # Apply to each の行
    s.rect(40, 312, 392, 28, fill='var(--ng-bg2)', stroke='var(--ng)', sw=2, rx=4, dash='5 4'); s.rect(46, 316, 20, 20, fill=COL['apply'], rx=3); s.text(76, 332, 'Apply to each', 'st', 'start', 13, 'bold')
    s.text(396, 332, '🗑', 'st', 'start', 14)
    s.badge(416, 297, 4)
    s.lines(470, 70, ['① Catch の箱をクリックして、', '   「Settings」タブを開く'], 'sw2', 'start', 14, 22, 'bold')
    s.lines(470, 130, ['② 「Select actions」を押して、', '   一覧から「Try」にチェックを入れる'], 'sw2', 'start', 14, 22, 'bold')
    s.lines(470, 200, ['③ Try の行で', '   ・「Is successful」のチェックを外す', '   ・「Has timed out」に ✓', '   ・「Has failed」に ✓'], 'sw2', 'start', 14, 24, 'bold')
    s.lines(470, 312, ['④ 「Apply to each」の行は、', '   右端のゴミ箱で削除する', '   （残すと Catch が動かなくなる）'], 'sw2', 'start', 14, 22, 'bold')
    return s.out()

# ---------- E: 伏字ツールの流れ ----------
def fig_mask():
    s = Svg(880, 230, '取り出しから提出までの流れ', 'e')
    s.rect(0, 0, 880, 230, fill='var(--card)', stroke='var(--line)', rx=10)
    xs = [20, 240, 460, 680]
    heads = ['① Code view で\nコピー', '② 伏字ツールに\n貼り付け', '③ 「伏字にする」を\n押す', '④ 結果をチャットに\n貼り付けて送る']
    subs = [['Ctrl＋A → Ctrl＋C'], ['左の枠に Ctrl＋V'], ['右の枠に結果が出る', '「要確認」を目で見る'], ['最初の行にファイル名', '例：【excel__…json】']]
    cols = [COL['excel'], COL['apply'], COL['comp'], COL['trig']]
    for i, x in enumerate(xs):
        s.rect(x, 30, 180, 170, fill='var(--bg)', stroke=cols[i], sw=2, rx=8)
        s.rect(x, 30, 180, 62, fill=cols[i], rx=8)
        h = heads[i].split('\n')
        s.text(x+90, 54, h[0], 'sw', 'middle', 14, 'bold'); s.text(x+90, 76, h[1], 'sw', 'middle', 14, 'bold')
        s.lines(x+90, 126, subs[i], 'st', 'middle', 13, 22)
        if i < 3: s.arrow(x+182, 115, xs[i+1]-4, 115, 'var(--sub)', 3)
    return s.out()


# ---------- F: Compose に式を貼る場所 ----------
def fig_compose():
    s = Svg(880, 500, 'Compose の箱：式を貼る場所（実際の画面をもとにした図）', 'f')
    s.rect(0, 0, 880, 500, fill='var(--card)', stroke='var(--line)', rx=10)
    s.rect(14, 14, 300, 300, fill='var(--bg)', stroke='var(--line)', rx=6)
    s.rect(26, 26, 22, 22, fill=COL['comp'], rx=4); s.text(58, 44, 'G2（Compose の箱）', 'st', 'start', 14, 'bold')
    s.text(26, 80, 'Parameters', 'st', 'start', 13, 'bold'); s.text(106, 80, 'Settings', 'st', 'start', 13); s.text(168, 80, 'Code view', 'st', 'start', 13); s.text(240, 80, 'About', 'st', 'start', 13)
    s.rect(26, 88, 78, 3, fill='var(--acc)', rx=1)
    s.text(26, 124, 'Inputs *', 'st', 'start', 13)
    s.rect(26, 134, 276, 34, fill='var(--card)', stroke='var(--acc)', sw=3, rx=4)
    s.rect(34, 140, 120, 22, fill='var(--line)', rx=4); s.text(40, 156, 'fx createArray(...) ×', 'ss', 'start', 11)
    s.badge(40, 210, 1)
    s.lines(62, 215, ['この「Inputs」欄をクリックする'], 'sw2', 'start', 14, 20, 'bold')
    s.lines(26, 260, ['（クリックすると、右のような', '  式の窓が開きます）'], 'ss', 'start', 12, 18)
    # ポップアップ
    s.rect(340, 14, 526, 472, fill='var(--bg)', stroke='var(--acc)', sw=2, rx=8)
    s.rect(354, 30, 498, 130, fill='var(--card)', stroke='var(--warn)', sw=3, rx=4)
    s.text(366, 56, "createArray(concat('E00_1=',string(convertTimeZone(", 'st', 'start', 12)
    s.text(366, 76, "'2026-10-06T15:30:00Z', 'UTC', 'Tokyo Standard Time')))...", 'st', 'start', 12)
    s.badge(836, 50, 2)
    s.text(366, 148, '← ここに式を貼り付ける（Ctrl＋V）。先頭に @ は付けない', 'sw2', 'start', 13, 'bold')
    # Copilot
    s.rect(354, 176, 262, 34, fill='var(--card)', stroke='var(--ng)', sw=2, rx=6, dash='5 4')
    s.text(366, 198, 'Create an expression with Copilot', 'ss', 'start', 13)
    s.text(630, 198, '✕ これは使わない（AI用の別の欄）', 'sred', 'start', 13, 'bold')
    # タブ
    s.text(366, 244, 'Function', 'st', 'start', 13, 'bold'); s.text(450, 244, 'Dynamic content', 'ss', 'start', 13)
    s.rect(366, 250, 66, 3, fill='var(--acc)', rx=1)
    s.rect(354, 262, 498, 28, fill='var(--card)', stroke='var(--line)', rx=4); s.text(366, 281, 'Search', 'ss', 'start', 12)
    s.rect(354, 300, 498, 84, fill='var(--card)', stroke='var(--line)', rx=4)
    s.lines(366, 322, ['String functions', 'concat(text_1, text_2?, ...)', 'substring(text, startIndex, length?)', '（関数の一覧。使わなくてよい）'], 'ss', 'start', 12, 20)
    s.rect(354, 420, 92, 38, fill='var(--acc)', rx=6); s.text(400, 444, 'Update', 'sw', 'middle', 15, 'bold')
    s.text(462, 444, '（初めてのときは「Add」または「OK」）', 'ss', 'start', 12)
    s.badge(470, 404, 3)
    s.lines(488, 408, ['最後に、このボタンを押して確定する'], 'sw2', 'start', 14, 20, 'bold')
    s.text(366, 478, '※ 窓の見た目は少し違うことがあります。違うときは画面を撮って送ってください。', 'ss', 'start', 11)
    return s.out()

FIGS = dict(compose=fig_compose(), complete=fig_complete(), layout=fig_layout(), apply=fig_apply(), runafter=fig_runafter(), mask=fig_mask())
