/* DOCX 生成・自己検証（外部ライブラリなし・クライアント完結）
 *
 * 最小構成の OOXML（WordprocessingML）を作り、無圧縮（stored）の ZIP に格納する。
 * 互換性のための構造：
 *   - 見出しは組み込みスタイル（Title / Heading1 / Heading2）。Word のナビゲーションウィンドウに出る。
 *   - 箇条書き・項番は本物の番号定義（numbering.xml）。リストごとに番号を 1 から振り直す。
 *   - 表は固定レイアウト（tblGrid と tcW を一致させる）。見出し行は繰り返し、行はページをまたいで割れない。
 *   - 要素の並びは ECMA-376 のスキーマ順に従う（Word は順序違反を「破損」と判定することがある）。
 * build() は生成後に validate() を必ず通し、検証 NG の場合は例外を投げる（不完全なファイルを渡さない）。
 * validate() はスキーマ（XSD）の完全検証ではなく、本ファイルが生成する範囲の構造・参照・順序・内容の検査である。 */
(function () {
  "use strict";

  var W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  var R_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
  var CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
  var XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  /* ---------- ZIP（stored）書き込み・読み取り ---------- */
  var CRC_TABLE = (function () {
    var t = [], c, n, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zipStored(files) {
    var enc = new TextEncoder();
    var now = new Date();
    var dosDate = ((Math.max(now.getFullYear(), 1980) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    var dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    var entries = files.map(function (f) {
      var data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
      return { name: enc.encode(f.name), data: data, crc: crc32(data), offset: 0 };
    });
    var size = 22;
    entries.forEach(function (e) { size += 30 + e.name.length + e.data.length + 46 + e.name.length; });
    var buf = new Uint8Array(size), dv = new DataView(buf.buffer), pos = 0;
    function u16(v) { dv.setUint16(pos, v, true); pos += 2; }
    function u32(v) { dv.setUint32(pos, v, true); pos += 4; }
    function bytes(b) { buf.set(b, pos); pos += b.length; }
    entries.forEach(function (e) {
      e.offset = pos;
      u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(dosTime); u16(dosDate);
      u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.name.length); u16(0);
      bytes(e.name); bytes(e.data);
    });
    var cdStart = pos;
    entries.forEach(function (e) {
      u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(dosTime); u16(dosDate);
      u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.name.length);
      u16(0); u16(0); u16(0); u16(0); u32(0); u32(e.offset);
      bytes(e.name);
    });
    var cdSize = pos - cdStart;
    u32(0x06054b50); u16(0); u16(0); u16(entries.length); u16(entries.length);
    u32(cdSize); u32(cdStart); u16(0);
    return buf;
  }
  // 検証用：ZIP を読み戻して {name: Uint8Array} を返す。CRC・サイズ・重複名もここで検査する。
  function readZip(bytes, err) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), dec = new TextDecoder("utf-8");
    var eocd = -1, i;
    for (i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) { err("ZIP：終端レコードが見つかりません"); return {}; }
    var count = dv.getUint16(eocd + 10, true), pos = dv.getUint32(eocd + 16, true), parts = {};
    for (i = 0; i < count; i++) {
      if (dv.getUint32(pos, true) !== 0x02014b50) { err("ZIP：中央ディレクトリが壊れています"); break; }
      var method = dv.getUint16(pos + 10, true), crc = dv.getUint32(pos + 16, true),
          csize = dv.getUint32(pos + 20, true), usize = dv.getUint32(pos + 24, true),
          nlen = dv.getUint16(pos + 28, true), elen = dv.getUint16(pos + 30, true),
          clen = dv.getUint16(pos + 32, true), lho = dv.getUint32(pos + 42, true);
      var name = dec.decode(bytes.subarray(pos + 46, pos + 46 + nlen));
      pos += 46 + nlen + elen + clen;
      if (parts[name]) err("ZIP：パス名が重複しています：" + name);
      if (/^\/|\.\.|\\/.test(name)) err("ZIP：不正なパス名：" + name);
      if (dv.getUint32(lho, true) !== 0x04034b50) { err("ZIP：ローカルヘッダが壊れています：" + name); continue; }
      var dstart = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      if (method !== 0 || csize !== usize) err("ZIP：想定外の圧縮方式：" + name);
      var data = bytes.subarray(dstart, dstart + usize);
      if (crc32(data) !== crc) err("ZIP：CRC が一致しません：" + name);
      parts[name] = data;
    }
    return parts;
  }

  /* ---------- WordprocessingML の組み立て ---------- */
  function clean(s) {
    return String(s == null ? "" : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
  }
  function x(s) {
    return clean(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function run(text, bold) {
    var parts = clean(text).replace(/\r\n?/g, "\n").split("\n").map(function (t) {
      return '<w:t xml:space="preserve">' + x(t) + "</w:t>";
    });
    return "<w:r>" + (bold ? "<w:rPr><w:b/></w:rPr>" : "") + parts.join("<w:br/>") + "</w:r>";
  }
  // style: 段落スタイルID、o: {keepNext, numId, bold}
  function para(text, style, o) {
    o = o || {};
    var ppr = (style ? '<w:pStyle w:val="' + style + '"/>' : "") +
      (o.numId ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="' + o.numId + '"/></w:numPr>' : "");
    return "<w:p>" + (ppr ? "<w:pPr>" + ppr + "</w:pPr>" : "") + (text === "" ? "" : run(text, o.bold)) + "</w:p>";
  }
  var BORDERS = ["top", "left", "bottom", "right", "insideH", "insideV"].map(function (s) {
    return "<w:" + s + ' w:val="single" w:sz="4" w:space="0" w:color="808080"/>';
  }).join("");
  function cell(text, w, o) {
    return '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' +
      (o.shade ? '<w:shd w:val="clear" w:color="auto" w:fill="EDEDED"/>' : "") +
      '<w:vAlign w:val="top"/></w:tcPr>' + para(text, "TableText", { bold: o.bold }) + "</w:tc>";
  }
  function table(rows, widths, o) {
    var total = widths.reduce(function (a, b) { return a + b; }, 0);
    var xml = '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="' + total + '" w:type="dxa"/>' +
      "<w:tblBorders>" + BORDERS + '</w:tblBorders><w:tblLayout w:type="fixed"/>' +
      '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>' +
      '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>' +
      widths.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join("") + "</w:tblGrid>";
    rows.forEach(function (r, ri) {
      var head = o.headerRow && ri === 0;
      xml += "<w:tr><w:trPr><w:cantSplit/>" + (head ? "<w:tblHeader/>" : "") + "</w:trPr>";
      r.forEach(function (c, ci) {
        var h = head || (o.firstColHead && ci === 0);
        xml += cell(c, widths[ci], { shade: h, bold: h });
      });
      xml += "</w:tr>";
    });
    return xml + "</w:tbl>" + para("", null);
  }

  function documentXml(doc) {
    var nums = [], body = para(doc.title, "Title");
    function listId(kind) { nums.push(kind); return nums.length + 0; } // numId は 1 始まり
    doc.blocks.forEach(function (b) {
      if (b.t === "kv") body += table(b.rows, [2100, 7538], { firstColHead: true });
      else if (b.t === "h") body += para(b.text, "Heading1");
      else if (b.t === "h2") body += para(b.text, "Heading2");
      else if (b.t === "ol" || b.t === "ul") {
        if (!b.items.length) body += para("（なし）", null);
        else {
          var id = listId(b.t);
          b.items.forEach(function (s) { body += para(s, "ListParagraph", { numId: id }); });
        }
      } else if (b.t === "table") {
        if (!b.rows.length) body += para("（なし）", null);
        else body += table([b.head].concat(b.rows), [5238, 2000, 2400], { headerRow: true });
      }
    });
    var xml = XML_HEAD + '<w:document xmlns:w="' + W_NS + '"><w:body>' + body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>' +
      "</w:body></w:document>";
    return { xml: xml, nums: nums };
  }

  function numberingXml(nums) {
    // abstractNum 1 = 項番（1. 2. 3.）、2 = 箇条書き（・）。num は abstractNum より後に置く。
    var xml = XML_HEAD + '<w:numbering xmlns:w="' + W_NS + '">' +
      '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>' +
      '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>' +
      '<w:pPr><w:ind w:left="420" w:hanging="420"/></w:pPr></w:lvl></w:abstractNum>' +
      '<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="singleLevel"/>' +
      '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="・"/><w:lvlJc w:val="left"/>' +
      '<w:pPr><w:ind w:left="420" w:hanging="420"/></w:pPr></w:lvl></w:abstractNum>';
    nums.forEach(function (kind, i) {
      xml += '<w:num w:numId="' + (i + 1) + '"><w:abstractNumId w:val="' + (kind === "ol" ? 1 : 2) + '"/>' +
        '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>';
    });
    return xml + "</w:numbering>";
  }

  var STYLES = XML_HEAD + '<w:styles xmlns:w="' + W_NS + '">' +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="Yu Mincho" w:hAnsi="Yu Mincho" w:eastAsia="游明朝" w:cs="Yu Mincho"/>' +
    '<w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-US" w:eastAsia="ja-JP" w:bidi="ar-SA"/>' +
    '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:keepNext/><w:spacing w:before="0" w:after="240"/><w:jc w:val="center"/></w:pPr>' +
    '<w:rPr><w:b/><w:spacing w:val="200"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:keepNext/><w:keepLines/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="808080"/></w:pBdr>' +
    '<w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="120" w:after="40"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:spacing w:after="40"/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:style>' +
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>' +
    '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="59"/>' +
    "<w:tblPr><w:tblBorders>" + BORDERS + "</w:tblBorders></w:tblPr></w:style>" +
    "</w:styles>";

  var SETTINGS = XML_HEAD + '<w:settings xmlns:w="' + W_NS + '"><w:defaultTabStop w:val="840"/>' +
    '<w:characterSpacingControl w:val="doNotCompress"/>' +
    '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>';

  var CONTENT_TYPES = XML_HEAD + '<Types xmlns="' + CT_NS + '">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    "</Types>";
  var REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
  var ROOT_RELS = XML_HEAD + '<Relationships xmlns="' + R_NS + '">' +
    '<Relationship Id="rId1" Type="' + REL + 'officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="' + REL + 'extended-properties" Target="docProps/app.xml"/></Relationships>';
  var DOC_RELS = XML_HEAD + '<Relationships xmlns="' + R_NS + '">' +
    '<Relationship Id="rId1" Type="' + REL + 'styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="' + REL + 'numbering" Target="numbering.xml"/>' +
    '<Relationship Id="rId3" Type="' + REL + 'settings" Target="settings.xml"/></Relationships>';
  function coreXml(title) {
    var iso = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    return XML_HEAD + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      "<dc:title>" + x(title) + "</dc:title><dc:creator>議事録・文書作成支援（試作）</dc:creator>" +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + iso + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + iso + "</dcterms:modified></cp:coreProperties>";
  }
  var APP_XML = XML_HEAD + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
    "<Application>議事録・文書作成支援（試作）</Application></Properties>";

  function supported() {
    try {
      return typeof Blob === "function" && typeof TextEncoder === "function" && typeof TextDecoder === "function" &&
        typeof DOMParser === "function" && typeof Uint8Array === "function" && !!(window.URL && URL.createObjectURL);
    } catch (e) { return false; }
  }

  /* ---------- 自己検証 ---------- */
  var ORDER = {
    pPr: ["pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr", "suppressLineNumbers", "pBdr", "shd", "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection", "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange"],
    rPr: ["rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath"],
    tblPr: ["tblStyle", "tblpPr", "tblOverlap", "bidiVisual", "tblStyleRowBandSize", "tblStyleColBandSize", "tblW", "jc", "tblCellSpacing", "tblInd", "tblBorders", "shd", "tblLayout", "tblCellMar", "tblLook", "tblCaption", "tblDescription"],
    tcPr: ["cnfStyle", "tcW", "gridSpan", "hMerge", "vMerge", "tcBorders", "shd", "noWrap", "tcMar", "textDirection", "tcFitText", "vAlign", "hideMark"],
    tblBorders: ["top", "left", "start", "bottom", "right", "end", "insideH", "insideV"],
    tblCellMar: ["top", "left", "start", "bottom", "right", "end"],
    lvl: ["start", "numFmt", "lvlRestart", "pStyle", "isLgl", "suff", "lvlText", "lvlPicBulletId", "legacy", "lvlJc", "pPr", "rPr"],
    abstractNum: ["nsid", "multiLevelType", "tmpl", "name", "styleLink", "numStyleLink", "lvl"],
    style: ["name", "aliases", "basedOn", "next", "link", "autoRedefine", "hidden", "uiPriority", "semiHidden", "unhideWhenUsed", "qFormat", "locked", "personal", "personalCompose", "personalReply", "rsid", "pPr", "rPr", "tblPr", "trPr", "tcPr", "tblStylePr"],
    settings: ["defaultTabStop", "characterSpacingControl", "compat"]
  };

  function kids(el) { var o = []; for (var n = el.firstElementChild; n; n = n.nextElementSibling) o.push(n); return o; }
  function loc(el) { return el.localName; }
  function wattr(el, name) { return el.getAttributeNS(W_NS, name); }
  function resolve(baseDir, target) {
    var segs = (target.charAt(0) === "/" ? target.slice(1) : baseDir + target).split("/"), out = [];
    segs.forEach(function (s) { if (s === "..") out.pop(); else if (s && s !== ".") out.push(s); });
    return out.join("/");
  }

  function validate(bytes, doc) {
    var errors = [], dec = new TextDecoder("utf-8");
    function err(m) { if (errors.indexOf(m) < 0) errors.push(m); }
    var parts = readZip(bytes, err);
    var REQUIRED = ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/numbering.xml", "word/settings.xml", "word/_rels/document.xml.rels"];
    REQUIRED.forEach(function (n) { if (!parts[n]) err("必須パートがありません：" + n); });

    // 1) XML の整形式
    var xml = {};
    Object.keys(parts).forEach(function (n) {
      var d = new DOMParser().parseFromString(dec.decode(parts[n]), "application/xml");
      if (d.getElementsByTagName("parsererror").length) err("XML が整形式ではありません：" + n);
      else xml[n] = d;
    });

    // 2) コンテントタイプ
    var ct = xml["[Content_Types].xml"];
    if (ct) {
      var defaults = {}, overrides = {};
      Array.prototype.forEach.call(ct.getElementsByTagNameNS(CT_NS, "Default"), function (e) { defaults[e.getAttribute("Extension").toLowerCase()] = e.getAttribute("ContentType"); });
      Array.prototype.forEach.call(ct.getElementsByTagNameNS(CT_NS, "Override"), function (e) { overrides["/" + e.getAttribute("PartName").replace(/^\//, "")] = e.getAttribute("ContentType"); });
      Object.keys(parts).forEach(function (n) {
        if (n === "[Content_Types].xml") return;
        var ext = (n.split(".").pop() || "").toLowerCase();
        if (!overrides["/" + n] && !defaults[ext]) err("コンテントタイプが未定義です：" + n);
      });
      Object.keys(overrides).forEach(function (p) { if (!parts[p.slice(1)]) err("Override の対象パートがありません：" + p); });
      var CT = "application/vnd.openxmlformats-officedocument.wordprocessingml.";
      var WANT = { "/word/document.xml": CT + "document.main+xml", "/word/styles.xml": CT + "styles+xml", "/word/numbering.xml": CT + "numbering+xml", "/word/settings.xml": CT + "settings+xml" };
      Object.keys(WANT).forEach(function (pn) { if (overrides[pn] !== WANT[pn]) err("コンテントタイプが不正または未定義です：" + pn); });
    }

    // 3) リレーションシップ
    Object.keys(xml).filter(function (n) { return /\.rels$/.test(n); }).forEach(function (n) {
      var srcDir = n.replace(/_rels\/[^/]*$/, ""), ids = {};
      Array.prototype.forEach.call(xml[n].getElementsByTagNameNS(R_NS, "Relationship"), function (r) {
        var id = r.getAttribute("Id");
        if (ids[id]) err("Relationship の Id が重複しています：" + n + " " + id);
        ids[id] = 1;
        if (r.getAttribute("TargetMode") === "External") return;
        if (!parts[resolve(srcDir, r.getAttribute("Target"))]) err("リレーションの参照先がありません：" + n + " → " + r.getAttribute("Target"));
      });
    });
    if (xml["_rels/.rels"] && !/officeDocument/.test(dec.decode(parts["_rels/.rels"]))) err("ルートに officeDocument の関係がありません");

    var D = xml["word/document.xml"], S = xml["word/styles.xml"], N = xml["word/numbering.xml"];
    if (D && S && N) {
      // 4) スタイル・番号の参照
      var styleIds = {};
      Array.prototype.forEach.call(S.getElementsByTagNameNS(W_NS, "style"), function (s) { styleIds[wattr(s, "styleId")] = 1; });
      ["basedOn", "next", "link"].forEach(function (t) {
        Array.prototype.forEach.call(S.getElementsByTagNameNS(W_NS, t), function (e) { if (!styleIds[wattr(e, "val")]) err("スタイルの参照先がありません：" + wattr(e, "val")); });
      });
      ["pStyle", "tblStyle", "rStyle"].forEach(function (t) {
        Array.prototype.forEach.call(D.getElementsByTagNameNS(W_NS, t), function (e) { if (!styleIds[wattr(e, "val")]) err("本文が未定義のスタイルを参照しています：" + wattr(e, "val")); });
      });
      var absIds = {}, numIds = {};
      Array.prototype.forEach.call(N.getElementsByTagNameNS(W_NS, "abstractNum"), function (a) { absIds[wattr(a, "abstractNumId")] = 1; });
      Array.prototype.forEach.call(N.getElementsByTagNameNS(W_NS, "num"), function (n2) {
        numIds[wattr(n2, "numId")] = 1;
        var ab = n2.getElementsByTagNameNS(W_NS, "abstractNumId")[0];
        if (!ab || !absIds[wattr(ab, "val")]) err("番号定義の abstractNum 参照が不正です");
      });
      Array.prototype.forEach.call(D.getElementsByTagNameNS(W_NS, "numId"), function (e) { if (!numIds[wattr(e, "val")]) err("本文が未定義の番号を参照しています：" + wattr(e, "val")); });
      // numbering：abstractNum はすべて num より前
      var seenNum = false;
      kids(N.documentElement).forEach(function (e) {
        if (loc(e) === "num") seenNum = true;
        else if (loc(e) === "abstractNum" && seenNum) err("numbering：abstractNum が num より後ろにあります");
      });

      // 5) 本文構造・表
      var body = D.getElementsByTagNameNS(W_NS, "body")[0], bk = kids(body);
      if (!bk.length || loc(bk[bk.length - 1]) !== "sectPr") err("本文の最後が sectPr ではありません");
      if (bk.length > 1 && loc(bk[bk.length - 2]) === "tbl") err("本文の最後の表の後に段落がありません（Word が破損と判定します）");
      Array.prototype.forEach.call(D.getElementsByTagNameNS(W_NS, "tbl"), function (t) {
        var grid = kids(t).filter(function (e) { return loc(e) === "tblGrid"; })[0];
        var cols = grid ? kids(grid).map(function (g) { return parseInt(wattr(g, "w"), 10); }) : [];
        if (!cols.length) { err("表に tblGrid がありません"); return; }
        var tw = t.getElementsByTagNameNS(W_NS, "tblW")[0];
        if (tw && parseInt(wattr(tw, "w"), 10) !== cols.reduce(function (a, b) { return a + b; }, 0)) err("表の幅（tblW）と tblGrid の合計が一致しません");
        var rows = kids(t).filter(function (e) { return loc(e) === "tr"; });
        if (!rows.length) err("表に行がありません");
        rows.forEach(function (tr) {
          var tcs = kids(tr).filter(function (e) { return loc(e) === "tc"; });
          if (tcs.length !== cols.length) err("表の行のセル数が列数と一致しません");
          tcs.forEach(function (tc, i) {
            var w = tc.getElementsByTagNameNS(W_NS, "tcW")[0];
            if (w && parseInt(wattr(w, "w"), 10) !== cols[i]) err("セル幅が tblGrid と一致しません");
            var last = kids(tc).pop();
            if (!last || loc(last) !== "p") err("セルの末尾が段落ではありません");
          });
        });
      });

      // 6) 子要素の順序（スキーマ順）
      [D, S, N].forEach(function (d) {
        Object.keys(ORDER).forEach(function (name) {
          Array.prototype.forEach.call(d.getElementsByTagNameNS(W_NS, name), function (el) {
            var last = -1;
            kids(el).forEach(function (c) {
              var idx = ORDER[name].indexOf(loc(c));
              if (idx < 0) { err("想定外の要素です：" + name + "/" + loc(c)); return; }
              if (idx < last) err("要素の順序がスキーマと異なります：" + name + "/" + loc(c));
              last = idx;
            });
          });
        });
      });
      var sp = xml["word/settings.xml"];
      if (sp) { var lastS = -1; kids(sp.documentElement).forEach(function (c) { var i = ORDER.settings.indexOf(loc(c)); if (i < 0) err("想定外の要素です：settings/" + loc(c)); else { if (i < lastS) err("settings の順序が不正です"); lastS = i; } }); }

      // 7) 内容の欠落がないか（入力の全文字列が本文に出ているか）
      if (doc) {
        var texts = [];
        Array.prototype.forEach.call(D.getElementsByTagNameNS(W_NS, "p"), function (p) {
          var s = ""; Array.prototype.forEach.call(p.getElementsByTagNameNS(W_NS, "t"), function (t) { s += t.textContent; });
          texts.push(s.replace(/\s+/g, ""));
        });
        var have = {}; texts.forEach(function (t) { have[t] = (have[t] || 0) + 1; });
        var want = [doc.title];
        doc.blocks.forEach(function (b) {
          if (b.t === "kv") b.rows.forEach(function (r) { want.push(r[0], r[1]); });
          else if (b.t === "h" || b.t === "h2") want.push(b.text);
          else if (b.items) { if (!b.items.length) want.push("（なし）"); b.items.forEach(function (s) { want.push(s); }); }
          else if (b.t === "table") {
            if (!b.rows.length) want.push("（なし）");
            else { b.head.forEach(function (s) { want.push(s); }); b.rows.forEach(function (r) { r.forEach(function (s) { want.push(s); }); }); }
          }
        });
        want.forEach(function (s) {
          var k = clean(s).replace(/\s+/g, "");
          if (k && !have[k]) err("本文に出力されていない文字列があります：" + k.slice(0, 20));
        });
      }
    }
    return { ok: errors.length === 0, errors: errors };
  }

  /* ---------- 公開 API ---------- */
  function buildBytes(doc) {
    var d = documentXml(doc);
    return zipStored([
      { name: "[Content_Types].xml", data: CONTENT_TYPES },
      { name: "_rels/.rels", data: ROOT_RELS },
      { name: "docProps/core.xml", data: coreXml(doc.title) },
      { name: "docProps/app.xml", data: APP_XML },
      { name: "word/document.xml", data: d.xml },
      { name: "word/styles.xml", data: STYLES },
      { name: "word/numbering.xml", data: numberingXml(d.nums) },
      { name: "word/settings.xml", data: SETTINGS },
      { name: "word/_rels/document.xml.rels", data: DOC_RELS }
    ]);
  }
  // 検証に通らない場合は例外（不完全なファイルを利用者に渡さない）
  function build(doc) {
    var bytes = buildBytes(doc), v = validate(bytes, doc);
    if (!v.ok) { var e = new Error("DOCX の自己検証に失敗：" + v.errors.slice(0, 3).join(" / ")); e.validation = v; throw e; }
    return new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  window.GijirokuDocx = { supported: supported, build: build, buildBytes: buildBytes, validate: validate, _internal: { zipStored: zipStored, readZip: readZip } }; // _internal は自己テスト用
})();
