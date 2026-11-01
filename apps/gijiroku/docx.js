/* DOCX 生成（外部ライブラリなし・クライアント完結）
 * 最小構成の OOXML（WordprocessingML）を作り、無圧縮（stored）の ZIP に詰める。
 * app.js の文書ブロック {title, blocks} を受け取り、Blob を返す。 */
(function () {
  "use strict";

  /* ---------- ZIP（stored） ---------- */
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
    var dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    var dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    var entries = files.map(function (f) {
      var data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
      return { name: enc.encode(f.name), data: data, crc: crc32(data), offset: 0 };
    });
    var size = 22, i;
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

  /* ---------- WordprocessingML ---------- */
  function x(s) {
    return String(s == null ? "" : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function run(text, o) {
    o = o || {};
    var rpr = (o.bold ? "<w:b/>" : "") +
      (o.spacing ? '<w:spacing w:val="' + o.spacing + '"/>' : "") +
      (o.size ? '<w:sz w:val="' + o.size + '"/><w:szCs w:val="' + o.size + '"/>' : "");
    return "<w:r>" + (rpr ? "<w:rPr>" + rpr + "</w:rPr>" : "") +
      '<w:t xml:space="preserve">' + x(text) + "</w:t></w:r>";
  }
  function para(text, o) {
    o = o || {};
    var ppr = (o.keepNext ? "<w:keepNext/>" : "") +
      (o.border ? '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="808080"/></w:pBdr>' : "") +
      '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 60 : o.after) + '"/>' +
      (o.left ? '<w:ind w:left="' + o.left + '" w:hanging="' + (o.hanging || 0) + '"/>' : "") +
      (o.center ? '<w:jc w:val="center"/>' : "");
    return "<w:p><w:pPr>" + ppr + "</w:pPr>" + run(text, o) + "</w:p>";
  }
  var BORDERS = ["top", "left", "bottom", "right", "insideH", "insideV"].map(function (s) {
    return "<w:" + s + ' w:val="single" w:sz="4" w:space="0" w:color="808080"/>';
  }).join("");
  function cell(text, w, o) {
    o = o || {};
    return "<w:tc><w:tcPr><w:tcW w:w=\"" + w + "\" w:type=\"dxa\"/>" +
      (o.shade ? '<w:shd w:val="clear" w:color="auto" w:fill="EDEDED"/>' : "") + "</w:tcPr>" +
      para(text, { bold: o.bold, after: 0 }) + "</w:tc>";
  }
  function table(rows, widths, o) {
    o = o || {};
    var xml = '<w:tbl><w:tblPr><w:tblW w:w="' + widths.reduce(function (a, b) { return a + b; }, 0) +
      '" w:type="dxa"/><w:tblBorders>' + BORDERS + '</w:tblBorders><w:tblLayout w:type="fixed"/>' +
      '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' +
      widths.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join("") + "</w:tblGrid>";
    rows.forEach(function (r, ri) {
      xml += "<w:tr>" + (o.headerRow && ri === 0 ? "<w:trPr><w:tblHeader/></w:trPr>" : "");
      r.forEach(function (c, ci) {
        var head = (o.headerRow && ri === 0) || (o.firstColHead && ci === 0);
        xml += cell(c, widths[ci], { shade: head, bold: head });
      });
      xml += "</w:tr>";
    });
    return xml + "</w:tbl>" + para("", { after: 60 });
  }

  function documentXml(doc) {
    var body = para(doc.title, { center: true, bold: true, size: 32, spacing: 200, after: 240 });
    doc.blocks.forEach(function (b) {
      if (b.t === "kv") body += table(b.rows, [2100, 7538], { firstColHead: true });
      else if (b.t === "h") body += para(b.text, { bold: true, size: 24, before: 200, border: true, keepNext: true });
      else if (b.t === "h2") body += para(b.text, { bold: true, before: 120, keepNext: true });
      else if (b.t === "ol" || b.t === "ul") {
        if (!b.items.length) body += para("（なし）");
        b.items.forEach(function (s, i) {
          body += para((b.t === "ol" ? (i + 1) + ". " : "・") + s, { left: 420, hanging: 420 });
        });
      } else if (b.t === "table") {
        if (!b.rows.length) body += para("（なし）");
        else body += table([b.head].concat(b.rows), [5238, 2000, 2400], { headerRow: true });
      }
    });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>' +
      "</w:body></w:document>";
  }

  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="Century" w:hAnsi="Century" w:eastAsia="游明朝" w:cs="Century"/>' +
    '<w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-US" w:eastAsia="ja-JP"/>' +
    '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    "</w:styles>";

  var CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    "</Types>";
  var ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    "</Relationships>";
  var DOC_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    "</Relationships>";

  function supported() {
    try {
      return typeof Blob === "function" && typeof TextEncoder === "function" &&
        typeof Uint8Array === "function" && !!(window.URL && URL.createObjectURL);
    } catch (e) { return false; }
  }

  function build(doc) {
    var data = zipStored([
      { name: "[Content_Types].xml", data: CONTENT_TYPES },
      { name: "_rels/.rels", data: ROOT_RELS },
      { name: "word/document.xml", data: documentXml(doc) },
      { name: "word/styles.xml", data: STYLES },
      { name: "word/_rels/document.xml.rels", data: DOC_RELS }
    ]);
    return new Blob([data], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  window.GijirokuDocx = { supported: supported, build: build };
})();
