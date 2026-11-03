/* 自己テスト（ブラウザ内で実行。外部通信なし）。結果は画面と window.__selftest に出す。 */
(function () {
  "use strict";
  var C = window.GijirokuCore, D = window.GijirokuDocx, DEMO = window.GIJIROKU_DEMO;
  var results = [], queue = [];

  function test(name, fn) { queue.push({ name: name, fn: fn }); }
  function eq(a, b, msg) {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || "不一致") + "：期待 " + JSON.stringify(b) + " ／ 実際 " + JSON.stringify(a));
  }
  function ok(c, msg) { if (!c) throw new Error(msg || "条件を満たしません"); }
  function rejects(p, check, msg) {
    return p.then(function () { throw new Error(msg || "失敗するはずが成功しました"); }, function (e) { check(e); });
  }

  /* ---------- フェッチのモック ---------- */
  var realFetch = window.fetch;
  function mockFetch(handler) {
    var calls = [];
    window.fetch = function (url, init) {
      calls.push({ url: url, init: init });
      return handler(calls.length, url, init);
    };
    return calls;
  }
  function jsonRes(status, obj) {
    return Promise.resolve({ ok: status >= 200 && status < 300, status: status,
      text: function () { return Promise.resolve(JSON.stringify(obj)); },
      json: function () { return Promise.resolve(obj); } });
  }
  function okGen(textObj) { return jsonRes(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(textObj) }] } }] }); }
  var P = { system: "S", user: "U" };

  /* ---------- 分割 ---------- */
  test("分割：上限以下は1件", function () { eq(C.splitParagraphs("あ\nい", 100), ["あ\nい"]); });
  test("分割：段落単位で上限内に収まり、再結合すると元と一致", function () {
    var t = ("会議の内容を記録する。".repeat(600) + "\n").repeat(30); // 約19.8万字
    var ch = C.splitParagraphs(t, 60000);
    ok(ch.length >= 3, "3件以上に分割される：" + ch.length);
    ok(ch.every(function (c) { return c.length <= 60000; }), "全件が上限以内");
    eq(ch.join("").replace(/\n/g, ""), t.replace(/\n/g, ""), "再結合の一致");
    ok(ch.every(function (c) { return c.charAt(c.length - 1) === "。"; }), "段落の途中で切れていない");
  });
  test("分割：1段落が上限超なら句点→文字数で分割", function () {
    var ch = C.splitParagraphs("あ".repeat(130000), 60000);
    eq(ch.map(function (c) { return c.length; }), [60000, 60000, 10000]);
    var ch2 = C.splitParagraphs("今日は晴れ。".repeat(30), 50);
    ok(ch2.length > 1 && ch2.every(function (c) { return c.length <= 50; }), "句点で分割");
  });
  test("分割：空文字・空白のみでも例外にならない", function () { eq(C.splitParagraphs("  \n\n ", 100), [""]); });

  /* ---------- 統合 ---------- */
  test("統合：単値は最初の非空、配列は重複除去、ToDoは担当込みで重複除去、注意書きを追加", function () {
    var m = C.mergeResults("minutes", [
      { meetingName: "", datetime: "11月5日", agenda: ["A", "共通"], decisions: ["X"], attendees: ["甲"], todos: [{ task: "t1", owner: "o", due: "d" }] },
      { meetingName: "会議", datetime: "後", agenda: ["共通", "B"], decisions: [], attendees: ["甲", "乙"], todos: [{ task: "t1", owner: "o", due: "d" }, { task: "t2", owner: "o2", due: "d" }], notes: [] }
    ]);
    eq(m.meetingName, "会議"); eq(m.datetime, "11月5日");
    eq(m.agenda, ["A", "共通", "B"]); eq(m.attendees, ["甲", "乙"]);
    eq(m.todos.length, 2);
    ok(/2件に分割/.test(m.notes[m.notes.length - 1]), "分割の注意書き");
  });
  test("統合：1件ならそのまま（注意書きなし）", function () {
    var m = C.mergeResults("fukumeisho", [{ subject: "件名", purpose: ["a"] }]);
    eq(m.missing, []); eq(m.subject, "件名");
  });

  /* ---------- 伏せ字（出力時） ---------- */
  test("伏字：長い語を優先し、1回の走査で置換する", function () {
    var t = C.parseMaskTerms("山田, 山田太郎，佐藤、山田");
    eq(t, ["山田太郎", "山田", "佐藤"]);
    eq(C.maskString("山田太郎と山田と佐藤", t), "●●と●●と●●");
  });
  test("伏字：正規表現の特殊文字・●を語に含んでも壊れない", function () {
    var t = C.parseMaskTerms("A.B,(株)X,●");
    eq(C.maskString("A.B と AxB と (株)X と ●", t), "●● と AxB と ●● と ●●");
  });
  test("伏字：文書ブロックに適用（項目名は変えない／元は変更しない）", function () {
    var doc = C.buildDoc("minutes", DEMO.minutes.output);
    var before = JSON.stringify(doc);
    var m = C.maskDoc(doc, C.parseMaskTerms("山田,佐藤"));
    var txt = C.toText(m);
    ok(!/山田|佐藤/.test(txt) && txt.indexOf("●●") >= 0, "伏字が適用される");
    ok(txt.indexOf("出席者：") >= 0, "項目名は残る");
    eq(JSON.stringify(doc), before, "元の文書は不変");
  });

  /* ---------- 伏せ字（送信前） ---------- */
  test("送信前：語が送信文に残らず、復元で元に戻る（往復）", function () {
    var terms = C.parseMaskTerms("山田,佐藤,広島 太郎");
    var pm = C.makePlaceholders(terms);
    var src = "山田課長と佐藤係長、広島 太郎さんが出席。山田課長が発言。";
    var sent = pm.apply(src);
    ok(!/山田|佐藤|広島 太郎/.test(sent), "語が残っていない：" + sent);
    ok(/〔名称\d+〕/.test(sent));
    eq(pm.leaks(sent), [], "伏せ漏れなし");
    eq(pm.restore(sent), src, "復元で一致");
  });
  test("送信前：モデルが記号の体裁を崩しても復元できる（全角数字・括弧違い）", function () {
    var pm = C.makePlaceholders(C.parseMaskTerms("山田,佐藤"));
    var terms = C.parseMaskTerms("山田,佐藤"); // 順序は同じ
    var a = terms.indexOf("山田") + 1, b = terms.indexOf("佐藤") + 1;
    var full = function (n) { return String(n).replace(/[0-9]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0xFEE0); }); };
    eq(pm.restore("［名称" + full(a) + "］課長と【名称 " + b + " 】"), "山田課長と佐藤");
  });
  test("送信前：復元できない記号は数えて警告できる／配列・入れ子も復元", function () {
    var pm = C.makePlaceholders(["甲"]);
    eq(pm.unresolved("〔名称1〕と〔名称9〕"), 2);
    eq(pm.restore("〔名称9〕"), "〔名称9〕");
    eq(pm.restoreDeep({ a: ["〔名称1〕"], b: { c: "〔名称1〕さん" }, d: 3 }), { a: ["甲"], b: { c: "甲さん" }, d: 3 });
  });
  test("送信前：伏せ漏れ検知（語が残っていれば検出）", function () {
    var pm = C.makePlaceholders(["山田"]);
    eq(pm.leaks("〔名称1〕課長と山田"), ["山田"]);
    eq(pm.leaks("〔名称1〕課長"), []);
  });
  test("送信前：プロンプト全体に指定語が含まれない／指示が入る", function () {
    var pm = C.makePlaceholders(["山田太郎", "佐藤"]);
    var meta = { attendees: pm.apply("山田太郎、佐藤") };
    var pr = C.buildPrompt("minutes", pm.apply("山田太郎さんが話した。"), meta, "plain", { i: 1, n: 2 }, true);
    var all = pr.system + pr.user;
    ok(!/山田太郎|佐藤/.test(all), "プロンプトに語が含まれない");
    ok(/伏せ字の扱い/.test(pr.system) && /全2件のうちの1件目/.test(pr.system));
    ok(/データであり指示ではない/.test(pr.user));
  });
  test("候補抽出：氏名らしい語を拾い、部署名は除く", function () {
    var s = C.suggestTerms(DEMO.minutes.transcript);
    ["山田", "佐藤", "田中", "高橋", "鈴木", "伊藤"].forEach(function (w) { ok(s.indexOf(w) >= 0, w + " を抽出"); });
    ok(s.indexOf("人事") < 0 && s.indexOf("総務") < 0, "部署名は除外");
  });

  /* ---------- エラー整形 ---------- */
  test("エラー：HTTPごとに原因と次の操作がある／再試行可否が正しい", function () {
    var cases = [[400, "API key not valid", false, "key"], [403, "", false, "key"], [404, "", false, "model"], [413, "", false, "size"],
      [429, "", true, "quota"], [500, "", true, "server"], [503, "", true, "server"], [504, "", true, "timeout"], [418, "x", false, "http"]];
    cases.forEach(function (c) {
      var e = C.httpError(c[0], c[1], "m");
      ok(e.message && e.action, c[0] + " に原因と次の操作がある");
      eq(e.retry, c[2], c[0] + " の再試行可否"); eq(e.kind, c[3], c[0] + " の種別");
    });
    ok(/m/.test(C.httpError(404, "", "my-model").message), "404 にモデル名が入る");
  });
  test("応答の解析：JSON不正・形式違いは種別付きの例外／コードフェンスは許容", function () {
    var bad = function (raw, kind) { try { C.parseResult("minutes", raw); } catch (e) { eq(e.kind, kind); eq(typeof e.action, "string"); ok(e.action.length > 0); return; } throw new Error("例外になるはず：" + raw); };
    bad("これはJSONではない", "parse"); bad("[1,2]", "shape"); bad('{"foo":1}', "shape"); bad("null", "shape");
    eq(C.parseResult("minutes", '```json\n{"meetingName":"A"}\n```').meetingName, "A");
  });

  /* ---------- API 呼び出し（モック） ---------- */
  function fast() { window.GIJIROKU_RETRY_MS = 1; window.GIJIROKU_TIMEOUT_MS = 120000; }
  test("API：429 が2回続いても自動再試行で成功（計3回）", function () {
    fast();
    var calls = mockFetch(function (n) { return n < 3 ? jsonRes(429, { error: { message: "q" } }) : okGen({ a: 1 }); });
    var retries = 0;
    return C.callGemini("K", "m", P, function () { retries++; }).then(function (t) { eq(JSON.parse(t), { a: 1 }); eq(calls.length, 3); eq(retries, 2); });
  });
  test("API：500 が続けば再試行上限で失敗（計3回）し、次の操作を返す", function () {
    fast();
    var calls = mockFetch(function () { return jsonRes(503, { error: { message: "busy" } }); });
    return rejects(C.callGemini("K", "m", P), function (e) { eq(e.kind, "server"); ok(e.action); eq(calls.length, 3); });
  });
  test("API：404・無効キーは再試行しない（1回）", function () {
    fast();
    var calls = mockFetch(function () { return jsonRes(404, { error: { message: "nf" } }); });
    return rejects(C.callGemini("K", "nope", P), function (e) { eq(e.kind, "model"); eq(calls.length, 1); });
  });
  test("API：通信失敗は再試行のうえ、ネットワーク確認の案内を返す", function () {
    fast();
    var calls = mockFetch(function () { return Promise.reject(new TypeError("Failed to fetch")); });
    return rejects(C.callGemini("K", "m", P), function (e) { eq(e.kind, "net"); ok(/ファイアウォール|プロキシ/.test(e.action)); eq(calls.length, 3); });
  });
  test("API：タイムアウト（AbortError）を検出し、再試行する", function () {
    fast(); window.GIJIROKU_TIMEOUT_MS = 30;
    var calls = mockFetch(function (n, url, init) {
      return new Promise(function (res, rej) { init.signal.addEventListener("abort", function () { var e = new Error("aborted"); e.name = "AbortError"; rej(e); }); });
    });
    return rejects(C.callGemini("K", "m", P), function (e) { eq(e.kind, "timeout"); eq(calls.length, 3); }).then(function () { window.GIJIROKU_TIMEOUT_MS = 120000; });
  });
  test("API：安全フィルタ・出力切れ・空応答を区別する", function () {
    fast();
    mockFetch(function () { return jsonRes(200, { promptFeedback: { blockReason: "SAFETY" } }); });
    return rejects(C.callGemini("K", "m", P), function (e) { eq(e.kind, "blocked"); ok(/削除|伏せ/.test(e.action)); }).then(function () {
      mockFetch(function () { return jsonRes(200, { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{" }] } }] }); });
      return rejects(C.callGemini("K", "m", P), function (e) { eq(e.kind, "truncated"); ok(/分割の目安/.test(e.action)); });
    }).then(function () {
      mockFetch(function () { return jsonRes(200, { candidates: [{ finishReason: "STOP" }] }); });
      return rejects(C.callGemini("K", "m", P), function (e) { eq(e.kind, "empty"); });
    });
  });
  test("API：キーはヘッダのみで送り、URL に含めない", function () {
    fast();
    var calls = mockFetch(function () { return okGen({ a: 1 }); });
    return C.callGemini("SECRETKEY", "gemini-x", P).then(function () {
      ok(calls[0].url.indexOf("SECRETKEY") < 0, "URLにキーなし");
      eq(calls[0].init.headers["x-goog-api-key"], "SECRETKEY");
      ok(/models\/gemini-x:generateContent$/.test(calls[0].url));
    });
  });
  test("接続テスト：有効／キー無効／モデルなし／キー未入力", function () {
    var respond = function (key, path) {
      if (key === "BAD") return jsonRes(400, { error: { message: "API key not valid", status: "INVALID_ARGUMENT" } });
      if (/models\?/.test(path)) return jsonRes(200, { models: [] });
      if (/models\/nope/.test(path)) return jsonRes(404, { error: { message: "nf", status: "NOT_FOUND" } });
      return jsonRes(200, { displayName: "M", supportedGenerationMethods: ["generateContent"] });
    };
    mockFetch(function (n, url, init) { return respond(init.headers["x-goog-api-key"], url); });
    return C.testConnection("GOOD", "m").then(function (r) { eq(r.level, "ok");
      return C.testConnection("BAD", "m"); }).then(function (r) { eq(r.level, "err"); ok(/無効/.test(r.lines.join("")));
      return C.testConnection("GOOD", "nope"); }).then(function (r) { eq(r.level, "err"); ok(/404/.test(r.lines.join("")));
      return C.testConnection("", "m"); }).then(function (r) { eq(r.level, "err"); });
  });

  /* ---------- DOCX ---------- */
  function docs() {
    var big = "長い文章。".repeat(2000);
    var weird = { meetingName: "A&B <c> \"d\" 'e'", datetime: "改行\nあり\r\n制御\u0001文字\u000B", place: "絵文字😀と𠮷野家", attendees: [],
      agenda: [big], decisions: ["<script>alert(1)</script>"], todos: [{ task: "t", owner: "", due: "" }], notes: [] };
    return [
      ["議事録（デモ）", C.buildDoc("minutes", DEMO.minutes.output)],
      ["復命書（デモ）", C.buildDoc("fukumeisho", DEMO.fukumeisho.output)],
      ["議事録（空）", C.buildDoc("minutes", {})],
      ["復命書（空）", C.buildDoc("fukumeisho", {})],
      ["特殊文字・長文", C.buildDoc("minutes", weird)],
      ["伏字適用後", C.maskDoc(C.buildDoc("minutes", DEMO.minutes.output), C.parseMaskTerms("山田,佐藤"))]
    ];
  }
  test("DOCX：全パターンで生成でき、自己検証（ZIP/XML/参照/順序/内容）に合格する", function () {
    ok(D.supported(), "DOCX 生成に対応");
    docs().forEach(function (d) {
      var bytes = D.buildBytes(d[1]), v = D.validate(bytes, d[1]);
      ok(v.ok, d[0] + "：" + v.errors.join(" / "));
      ok(D.build(d[1]) instanceof Blob, d[0] + "：Blob を返す");
    });
  });
  test("DOCX：リストごとに番号が独立し、見出しは組み込みスタイルを使う", function () {
    var bytes = D.buildBytes(C.buildDoc("minutes", DEMO.minutes.output)), parts = D._internal.readZip(bytes, function () {});
    var dec = new TextDecoder(), doc = dec.decode(parts["word/document.xml"]), num = dec.decode(parts["word/numbering.xml"]);
    ok(/w:pStyle w:val="Title"/.test(doc) && /w:pStyle w:val="Heading1"/.test(doc));
    ok((num.match(/<w:num /g) || []).length >= 2, "num が複数（リスト単位）");
    ok(/startOverride/.test(num), "番号の振り直し");
    ok(!/<w:t[^>]*>1\. /.test(doc), "番号を文字として埋め込んでいない");
  });
  function tamper(fn, doc) {
    var bytes = D.buildBytes(doc || C.buildDoc("minutes", DEMO.minutes.output)), enc = new TextEncoder(), dec = new TextDecoder();
    var parts = D._internal.readZip(bytes, function () {}), files = Object.keys(parts).map(function (n) { return { name: n, data: parts[n] }; });
    files.forEach(function (f) { f.data = dec.decode(f.data); });
    fn(files);
    return D.validate(D._internal.zipStored(files.map(function (f) { return { name: f.name, data: f.data }; })), null);
  }
  // 最後がToDo表になる文書（要確認事項なし）
  var TABLE_LAST = (function () { var o = JSON.parse(JSON.stringify(DEMO.minutes.output)); o.notes = []; return C.buildDoc("minutes", o); })();
  function part(files, name) { return files.filter(function (f) { return f.name === name; })[0]; }
  test("DOCX 検証の否定テスト：壊れたファイルは必ず検出される", function () {
    var bytes = D.buildBytes(C.buildDoc("minutes", DEMO.minutes.output));
    var flipped = new Uint8Array(bytes); flipped[200] ^= 0xFF;
    ok(!D.validate(flipped, null).ok, "ビット反転（CRC）");
    ok(!D.validate(bytes.subarray(0, bytes.length - 30), null).ok, "末尾欠落");
    var cases = [
      ["XML 不整形", function (f) { part(f, "word/document.xml").data += "<"; }],
      ["必須パート欠落", function (f) { f.splice(f.indexOf(part(f, "word/numbering.xml")), 1); }],
      ["pPr の要素順序違反", function (f) { var p = part(f, "word/document.xml"); p.data = p.data.replace('<w:pStyle w:val="Title"/>', '<w:jc w:val="center"/><w:pStyle w:val="Title"/>'); }],
      ["未定義スタイル参照", function (f) { var p = part(f, "word/document.xml"); p.data = p.data.replace('w:val="Heading1"', 'w:val="NoSuch"'); }],
      ["未定義の番号参照", function (f) { var p = part(f, "word/document.xml"); p.data = p.data.replace(/<w:numId w:val="1"\/>/, '<w:numId w:val="99"/>'); }],
      ["表の列幅不一致", function (f) { var p = part(f, "word/document.xml"); p.data = p.data.replace('<w:gridCol w:w="2100"/>', '<w:gridCol w:w="2000"/>'); }],
      ["セル数が列数と不一致", function (f) { var p = part(f, "word/document.xml"); p.data = p.data.replace(/<w:tc>.*?<\/w:tc>/, ""); }],
      ["表の後に段落なし", function (f) { var p = part(f, "word/document.xml"); p.data = p.data.replace("</w:tbl><w:p></w:p><w:sectPr>", "</w:tbl><w:sectPr>"); }, TABLE_LAST],
      ["関係の参照先なし", function (f) { var p = part(f, "word/_rels/document.xml.rels"); p.data = p.data.replace("styles.xml", "nothing.xml"); }],
      ["コンテントタイプ未定義", function (f) { var p = part(f, "[Content_Types].xml"); p.data = p.data.replace(/<Override PartName="\/word\/numbering.xml"[^>]*\/>/, ""); }]
    ];
    cases.forEach(function (c) {
      var v = tamper(c[1], c[2]);
      ok(!v.ok, "検出されるはず：" + c[0]);
    });
    ok(D.validate(D.buildBytes(TABLE_LAST), null).ok, "表が末尾の正常な文書は合格する（上の否定テストの対照）");
    // 内容欠落は doc を渡した検証でのみ検出する
    var d = C.buildDoc("minutes", DEMO.minutes.output), files2 = null;
    var b2 = D.buildBytes(d), pp = D._internal.readZip(b2, function () {}), dec = new TextDecoder();
    files2 = Object.keys(pp).map(function (n) { var t = dec.decode(pp[n]); if (n === "word/document.xml") t = t.replace("議事録の作成の効率化について", "別の文"); return { name: n, data: t }; });
    ok(!D.validate(D._internal.zipStored(files2), d).ok, "本文の文字列欠落（内容照合）");
  });

  /* ---------- 実行 ---------- */
  function render(summary) {
    var tb = document.querySelector("#results tbody");
    results.forEach(function (r) {
      var tr = document.createElement("tr");
      [r.ok ? "✓ 合格" : "✗ 失敗", r.name, r.detail || ""].forEach(function (t, i) {
        var td = document.createElement("td");
        if (i === 0) { var b = document.createElement("strong"); b.textContent = t; td.appendChild(b); } else td.textContent = t;
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    document.getElementById("summary").textContent = summary;
    document.title = (summary.indexOf("すべて合格") >= 0 ? "PASS" : "FAIL") + "｜自己テスト";
  }
  function run() {
    var chain = Promise.resolve();
    queue.forEach(function (t) {
      chain = chain.then(function () {
        return Promise.resolve().then(t.fn).then(function () { results.push({ name: t.name, ok: true }); },
          function (e) { results.push({ name: t.name, ok: false, detail: e && e.message ? e.message : String(e) }); });
      });
    });
    return chain.then(function () {
      window.fetch = realFetch;
      var pass = results.filter(function (r) { return r.ok; }).length, fail = results.length - pass;
      var summary = fail === 0 ? "すべて合格（" + pass + "／" + results.length + " 件）" : fail + " 件失敗（合格 " + pass + "／" + results.length + " 件）";
      window.__selftest = { pass: pass, fail: fail, total: results.length, results: results, done: true };
      render(summary);
    });
  }
  run();
})();
