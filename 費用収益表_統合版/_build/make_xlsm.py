# -*- coding: utf-8 -*-
"""xlsx に VBA(.bas) を埋め込んで xlsm を作る（Excel不要）。
python make_xlsm.py 入力.xlsx 出力.xlsm 標準モジュール.bas [...] [--thisworkbook ThisWorkbook.bas]
vbaProject.bin(MS-OVBA / MS-CFB)を自前で生成し、ソースのみ格納（Excelが開くときに再コンパイル）。"""
import sys, struct, zipfile, re, uuid

CP = "cp932"


# ---------- MS-OVBA 圧縮 ----------
def compress(data: bytes) -> bytes:
    out = bytearray(b"\x01")
    pos = 0
    while pos < len(data) or pos == 0:
        chunk = data[pos:pos + 4096]
        pos += 4096
        body = bytearray()
        i = 0
        n = len(chunk)
        while i < n:
            flag = 0
            toks = bytearray()
            for bit in range(8):
                if i >= n:
                    break
                diff = i
                best_len, best_off = 0, 0
                if diff > 0:
                    bc = max((diff - 1).bit_length(), 4)
                    maxlen = (0xFFFF >> bc) + 3
                    start = max(0, i - (1 << bc))
                    for j in range(i - 1, start - 1, -1):
                        if chunk[j] != chunk[i]:
                            continue
                        l = 0
                        while i + l < n and l < maxlen and chunk[j + l] == chunk[i + l]:
                            l += 1
                        if l > best_len:
                            best_len, best_off = l, i - j
                            if l == maxlen:
                                break
                if best_len >= 3:
                    bc = max((diff - 1).bit_length(), 4)
                    tok = ((best_off - 1) << (16 - bc)) | (best_len - 3)
                    toks += struct.pack("<H", tok)
                    flag |= 1 << bit
                    i += best_len
                else:
                    toks.append(chunk[i])
                    i += 1
            body.append(flag)
            body += toks
        if len(body) < 4096 and n > 0:
            out += struct.pack("<H", ((len(body) + 2 - 3) & 0xFFF) | 0xB000) + body
        else:  # 非圧縮チャンク
            raw = chunk.ljust(4096, b"\x00")
            out += struct.pack("<H", (4096 + 2 - 3) | 0x3000) + raw
        if n == 0:
            break
    return bytes(out)


# ---------- MS-CFB 書き込み ----------
def cfb(streams):
    """streams: {'PROJECT': bytes, 'VBA/dir': bytes, ...}"""
    SEC, MINI = 512, 64
    entries = []  # dict(name,type,data,children)
    root = dict(name="Root Entry", type=5, data=b"", kids=[])
    storages = {"": root}

    def storage(path):
        if path in storages:
            return storages[path]
        parent = storage(path.rsplit("/", 1)[0] if "/" in path else "")
        e = dict(name=path.rsplit("/", 1)[-1], type=1, data=b"", kids=[])
        parent["kids"].append(e)
        storages[path] = e
        return e

    for p, d in streams.items():
        par = storage(p.rsplit("/", 1)[0] if "/" in p else "")
        par["kids"].append(dict(name=p.rsplit("/", 1)[-1], type=2, data=d, kids=[]))
    flat = []

    def walk(e):
        flat.append(e)
        for k in e["kids"]:
            walk(k)
    walk(root)
    for i, e in enumerate(flat):
        e["id"] = i
    key = lambda e: (len(e["name"]), e["name"].upper())
    for e in flat:
        ks = sorted(e["kids"], key=key)
        e["child"] = ks[0]["id"] if ks else 0xFFFFFFFF
        for a, b in zip(ks, ks[1:]):
            a["right"] = b["id"]
    # ミニストリーム
    mini = bytearray(); minifat = []
    for e in flat:
        if e["type"] == 2 and len(e["data"]) < 4096:
            e["start"] = len(mini) // MINI
            d = e["data"]
            nsec = max(1, -(-len(d) // MINI)) if d else 0
            mini += d.ljust(nsec * MINI, b"\x00")
            for k in range(nsec):
                minifat.append(e["start"] + k + 1 if k < nsec - 1 else 0xFFFFFFFE)
            if not d:
                e["start"] = 0xFFFFFFFE
    sectors = []  # bytes list
    fat = []

    def add_chain(data):
        n = max(1, -(-len(data) // SEC))
        first = len(sectors)
        data = data.ljust(n * SEC, b"\x00")
        for k in range(n):
            sectors.append(data[k * SEC:(k + 1) * SEC])
            fat.append(first + k + 1 if k < n - 1 else 0xFFFFFFFE)
        return first
    for e in flat:
        if e["type"] == 2 and len(e["data"]) >= 4096:
            e["start"] = add_chain(e["data"])
    root["start"] = add_chain(bytes(mini)) if mini else 0xFFFFFFFE
    root["size"] = len(mini)
    mf_first, mf_n = 0xFFFFFFFE, 0
    if minifat:
        mfb = b"".join(struct.pack("<I", x) for x in minifat)
        mfb = mfb.ljust(-(-len(mfb) // SEC) * SEC, b"\xff")
        mf_n = len(mfb) // SEC
        mf_first = len(sectors)
        for k in range(mf_n):
            sectors.append(mfb[k * SEC:(k + 1) * SEC]); fat.append(mf_first + k + 1 if k < mf_n - 1 else 0xFFFFFFFE)
    dirb = bytearray()
    for e in flat:
        nm = e["name"].encode("utf-16-le") + b"\x00\x00"
        size = e["size"] if e["type"] == 5 else len(e["data"])
        start = e.get("start", 0) if e["type"] != 1 else 0
        if e["type"] == 1:
            start = 0
        dirb += nm.ljust(64, b"\x00") + struct.pack("<HBB", len(nm), e["type"], 1)
        dirb += struct.pack("<III", 0xFFFFFFFF, e.get("right", 0xFFFFFFFF), e["child"])
        dirb += b"\x00" * 16 + struct.pack("<I", 0) + b"\x00" * 16
        dirb += struct.pack("<IQ", start, size)[:12]
    while len(dirb) % SEC:
        dirb += b"\x00" * 68 + struct.pack("<III", 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF) + b"\x00" * 48
    d_first = len(sectors)
    nd = len(dirb) // SEC
    for k in range(nd):
        sectors.append(bytes(dirb[k * SEC:(k + 1) * SEC])); fat.append(d_first + k + 1 if k < nd - 1 else 0xFFFFFFFE)
    nfat = 1
    while nfat * 128 < len(fat) + nfat:
        nfat += 1
    fat_first = len(sectors)
    fat += [0xFFFFFFFD] * nfat
    fat += [0xFFFFFFFF] * (nfat * 128 - len(fat))
    fb = b"".join(struct.pack("<I", x) for x in fat)
    for k in range(nfat):
        sectors.append(fb[k * SEC:(k + 1) * SEC])
    difat = [fat_first + k for k in range(nfat)] + [0xFFFFFFFF] * (109 - nfat)
    hdr = b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1" + b"\x00" * 16 + struct.pack("<HHHHH", 0x3E, 3, 0xFFFE, 9, 6) + b"\x00" * 6
    hdr += struct.pack("<IIIIIIIII", 0, nfat, d_first, 0, 4096, mf_first, mf_n, 0xFFFFFFFE, 0)
    hdr += b"".join(struct.pack("<I", x) for x in difat)
    return hdr + b"".join(sectors)


# ---------- VBAプロジェクト ----------
def rec(i, data=b""):
    return struct.pack("<HI", i, len(data)) + data


def build_project(mods, this_code):
    """mods: [(name, source_text)]  this_code: ThisWorkbook のコード本文"""
    attr_this = ('Attribute VB_Name = "ThisWorkbook"\r\nAttribute VB_Base = "0{00020819-0000-0000-C000-000000000046}"\r\n'
                 'Attribute VB_GlobalNameSpace = False\r\nAttribute VB_Creatable = False\r\nAttribute VB_PredeclaredId = True\r\n'
                 'Attribute VB_Exposed = True\r\nAttribute VB_TemplateDerived = False\r\nAttribute VB_Customizable = True\r\n')
    allm = [("ThisWorkbook", attr_this + this_code, True)] + [(n, f'Attribute VB_Name = "{n}"\r\n' + s, False) for n, s in mods]
    d = rec(1, struct.pack("<I", 1)) + rec(2, struct.pack("<I", 0x409)) + rec(0x14, struct.pack("<I", 0x409)) + rec(3, struct.pack("<H", 932))
    d += rec(4, b"VBAProject") + rec(5) + rec(0x40) + rec(6) + rec(0x3D) + rec(7, struct.pack("<I", 0)) + rec(8, struct.pack("<I", 0))
    d += struct.pack("<HIIH", 9, 4, 1, 0) + rec(0x0C) + rec(0x3C)
    refs = [("stdole", r"*\G{00020430-0000-0000-C000-000000000046}#2.0#0#C:\Windows\System32\stdole2.tlb#OLE Automation"),
            ("Office", r"*\G{2DF8D04C-5BFA-101B-BDE5-00AA0044DE52}#2.0#0#C:\Program Files\Common Files\Microsoft Shared\OFFICE16\MSO.DLL#Microsoft Office 16.0 Object Library")]
    for nm, lib in refs:
        d += rec(0x16, nm.encode()) + rec(0x3E, nm.encode("utf-16-le"))
        lb = lib.encode()
        d += rec(0x0D, struct.pack("<I", len(lb)) + lb + struct.pack("<IH", 0, 0))
    d += rec(0x0F, struct.pack("<H", len(allm))) + rec(0x13, struct.pack("<H", 0xFFFF))
    streams = {}
    for n, src, is_doc in allm:
        nb = n.encode(CP)
        d += rec(0x19, nb) + rec(0x47, n.encode("utf-16-le")) + rec(0x1A, nb) + rec(0x32, n.encode("utf-16-le"))
        d += rec(0x1C) + rec(0x48) + rec(0x31, struct.pack("<I", 0)) + rec(0x1E, struct.pack("<I", 0)) + rec(0x2C, struct.pack("<H", 0xFFFF))
        d += rec(0x22 if is_doc else 0x21) + rec(0x2B)
        streams["VBA/" + n] = compress(src.encode(CP, errors="replace"))
    d += rec(0x10)
    streams["VBA/dir"] = compress(d)
    streams["VBA/_VBA_PROJECT"] = b"\xCC\x61\xFF\xFF\x00\x00\x00"
    proj = ('ID="{%s}"\r\nDocument=ThisWorkbook/&H00000000\r\n' % str(uuid.uuid4()).upper())
    proj += "".join(f"Module={n}\r\n" for n, _ in mods)
    proj += 'Name="VBAProject"\r\nHelpContextID="0"\r\nVersionCompatible32="393222000"\r\n\r\n'
    proj += "[Host Extender Info]\r\n&H00000001={3832D640-CF90-11CF-8E43-00A0C911005A};VBE;&H00000000\r\n\r\n[Workspace]\r\n"
    proj += "ThisWorkbook=0, 0, 0, 0, C\r\n" + "".join(f"{n}=0, 0, 0, 0, C\r\n" for n, _ in mods)
    streams["PROJECT"] = proj.encode(CP)
    wm = b"".join(n.encode(CP) + b"\x00" + n.encode("utf-16-le") + b"\x00\x00" for n, *_ in allm) + b"\x00\x00"
    streams["PROJECTwm"] = wm
    return cfb(streams)


def drawing_xml(btns):
    ns = ('xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" '
          'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"')
    out = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr {ns}>'
    for i, b in enumerate(btns, 2):
        c0, o0, r0, ro0, c1, o1, r1, ro1 = b["pos"]
        out += (f'<xdr:twoCellAnchor editAs="absolute"><xdr:from><xdr:col>{c0}</xdr:col><xdr:colOff>{o0}</xdr:colOff><xdr:row>{r0}</xdr:row><xdr:rowOff>{ro0}</xdr:rowOff></xdr:from>'
                f'<xdr:to><xdr:col>{c1}</xdr:col><xdr:colOff>{o1}</xdr:colOff><xdr:row>{r1}</xdr:row><xdr:rowOff>{ro1}</xdr:rowOff></xdr:to>'
                f'<xdr:sp macro="[0]!{b["macro"]}" textlink=""><xdr:nvSpPr><xdr:cNvPr id="{i}" name="Button{i}"/><xdr:cNvSpPr/></xdr:nvSpPr>'
                f'<xdr:spPr><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="{b["color"]}"/></a:solidFill>'
                f'<a:ln w="12700"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></xdr:spPr>'
                f'<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip" rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/>'
                f'<a:r><a:rPr lang="ja-JP" sz="1100" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>{b["label"]}</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>')
    return out + "</xdr:wsDr>"


BUTTONS = {  # シート名 -> ボタン定義
    "入力": [dict(label="請求書を印刷", macro="請求書を印刷", color="1F4E78", pos=(10, 60000, 0, 40000, 10, 1350000, 0, 360000)),
             dict(label="翌月分用にクリア", macro="翌月分用にクリア", color="7F7F7F", pos=(10, 1450000, 0, 40000, 10, 2750000, 0, 360000)),
             dict(label="請求日を今日に", macro="請求日を今日にする", color="7F7F7F", pos=(10, 2850000, 0, 40000, 10, 4000000, 0, 360000)),
             dict(label="共済組合へメール送信", macro="共済組合へメール送信", color="C55A11", pos=(11, 60000, 0, 40000, 11, 3000000, 0, 360000))],
    "請求記録": [dict(label="申請書ファイルを取り込む", macro="申請書ファイルを取り込む", color="2E7D32", pos=(12, 0, 0, 60000, 15, 0, 2, 150000)),
             dict(label="フォルダ内の申請書を一括取込", macro="申請書フォルダを一括取り込む", color="2E7D32", pos=(15, 60000, 0, 60000, 18, 0, 2, 150000)),
             dict(label="未処理に支給月を一括入力", macro="未処理に支給月を一括入力", color="1F4E78", pos=(18, 60000, 0, 60000, 21, 0, 2, 150000))],
}


def read_bas(path):
    t = open(path, encoding="cp932").read().replace("\r\n", "\n")
    lines = [l for l in t.split("\n") if not l.startswith("Attribute VB_Name")]
    return "\r\n".join(lines).rstrip() + "\r\n"


def main():
    a = sys.argv[1:]
    src, dst = a[0], a[1]
    this_code, mods = "", []
    i = 2
    while i < len(a):
        if a[i] == "--thisworkbook":
            body = [l for l in read_bas(a[i + 1]).split("\r\n") if not l.startswith("'")]
            this_code = "\r\n".join(body).strip() + "\r\n"; i += 2
        else:
            n = re.sub(r"_.*$", "", a[i].replace("\\", "/").split("/")[-1].rsplit(".", 1)[0])
            mods.append((n, read_bas(a[i]))); i += 1
    binary = build_project(mods, this_code)
    zin = zipfile.ZipFile(src)
    wbx = zin.read("xl/workbook.xml").decode("utf8")
    rels = zin.read("xl/_rels/workbook.xml.rels").decode("utf8")
    rid2t = {m.group(2): m.group(1) for m in re.finditer(r'Target="([^"]+)"[^>]*Id="([^"]+)"', rels)}
    rid2t.update({m.group(1): m.group(2) for m in re.finditer(r'Id="([^"]+)"[^>]*Target="([^"]+)"', rels)})
    sheetfile = {}
    for m in re.finditer(r'<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"', wbx):
        sheetfile[m.group(1)] = rid2t[m.group(2)].lstrip("/").replace("xl/", "", 1)
    btn_sheets = {sheetfile[n]: v for n, v in BUTTONS.items() if n in sheetfile and not any(
        n2 == "xl/worksheets/_rels/" + sheetfile[n].split("/")[-1] + ".rels" and b"drawing" in zin.read(n2) for n2 in zin.namelist())}
    extra = {}
    zout = zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED)
    for it in zin.infolist():
        data = zin.read(it.filename)
        if it.filename == "[Content_Types].xml":
            s = data.decode("utf8")
            s = s.replace("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml", "application/vnd.ms-excel.sheet.macroEnabled.main+xml")
            if 'Extension="bin"' not in s:
                s = s.replace("<Default ", '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/><Default ', 1)
            data = s.encode("utf8")
        elif it.filename == "xl/workbook.xml":
            s = data.decode("utf8")
            if "<workbookPr" in s:
                s = re.sub(r"<workbookPr", '<workbookPr codeName="ThisWorkbook"', s, count=1)
            else:
                s = re.sub(r"(<workbook[^>]*>)", r'\1<workbookPr codeName="ThisWorkbook"/>', s, count=1)
            data = s.encode("utf8")
        elif it.filename == "xl/_rels/workbook.xml.rels":
            s = data.decode("utf8")
            s = s.replace("</Relationships>", '<Relationship Id="rIdVba1" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>')
            data = s.encode("utf8")
        fn = it.filename
        short = fn[len("xl/"):] if fn.startswith("xl/") else fn
        if short in btn_sheets:
            sx = data.decode("utf8")
            sx = sx.replace("</worksheet>", '<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdBtn1"/></worksheet>')
            data = sx.encode("utf8")
        if fn.startswith("xl/worksheets/_rels/") and fn.endswith(".rels"):
            sh = "worksheets/" + fn.split("/")[-1][:-5]
            if sh in btn_sheets:
                data = data.decode("utf8").replace("</Relationships>", '<Relationship Id="rIdBtn1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="/xl/drawings/drawingBtn_%s.xml"/></Relationships>' % sh.split("/")[-1].replace(".xml", "")).encode("utf8")
                extra[sh] = True
        if fn == "[Content_Types].xml":
            ct = data.decode("utf8")
            for sh in btn_sheets:
                ct = ct.replace("</Types>", '<Override PartName="/xl/drawings/drawingBtn_%s.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>' % sh.split("/")[-1].replace(".xml", ""))
            data = ct.encode("utf8")
        zout.writestr(it, data)
    for sh, btns in btn_sheets.items():
        nm = sh.split("/")[-1].replace(".xml", "")
        if sh not in extra:
            zout.writestr("xl/worksheets/_rels/%s.xml.rels" % nm, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdBtn1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="/xl/drawings/drawingBtn_%s.xml"/></Relationships>' % nm)
        zout.writestr("xl/drawings/drawingBtn_%s.xml" % nm, drawing_xml(btns))
    zout.writestr("xl/vbaProject.bin", binary)
    zout.close()
    print("saved", dst, len(binary), "bytes")


if __name__ == "__main__":
    main()
