/* 外部データ取得アダプタ層
 *
 * アプリ本体(app.js)はこのファイルの KW_ADAPTERS だけを経由して決算予定を取得する。
 * 実データ連携時は EarningsAdapter を実装したクラスを追加し、レジストリに登録するだけでよい。
 *
 * interface EarningsAdapter {
 *   id: string                    // レジストリのキー
 *   name: string                  // 画面表示名
 *   requiresKey: boolean          // 利用者のAPIキー入力が必要か
 *   isDummy: boolean              // true の場合、画面に「ダミー」表示を出す
 *   fetchSchedule(stocks, ctx): Promise<EarningsEvent[] | {events:EarningsEvent[], warnings:string[]}>
 *       失敗時は Error を reject（理由をそのまま画面に表示する）。ctx.fetch はテスト用の差し替え
 *       stocks: [{code,name,market}]  ctx: {apiKey, today:'YYYY-MM-DD'}
 * }
 * EarningsEvent = { code, date:'YYYY-MM-DD', period:string, source:adapter.id }
 */
(function () {
  "use strict";

  function pad(n) { return String(n).padStart(2, "0"); }
  function toYmd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function addDays(base, n) {
    var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
    return toYmd(d);
  }

  /** ダミーアダプタ: 同梱サンプル14銘柄のみ、本日基準の相対日で返す。表にない銘柄は返さない。ネットワーク通信なし。 */
  var DummyAdapter = {
    id: "dummy",
    name: "ダミーデータ（サンプル同梱）",
    requiresKey: false,
    isDummy: true,
    fetchSchedule: function (stocks, ctx) {
      var base = new Date();
      var table = (window.KW_SAMPLE && window.KW_SAMPLE.offsets) || {};
      var out = [];
      stocks.forEach(function (s) {
        var row = table[s.code];
        // サンプル表にない銘柄には日付を割り当てない（実在銘柄への架空日付の誤認を防ぐ）。
        // 予定未設定として扱い、利用者が手動で決算日を追加する。
        if (!row) return;
        out.push({ code: s.code, date: addDays(base, row.offset), period: row.period, source: "dummy" });
      });
      return Promise.resolve(out);
    }
  };

  /** J-Quants API V2「決算発表予定日」アダプタ。
   *
   * 【出典】J-Quants 公式API仕様「決算発表予定日(/fins/earnings-date)」
   *   https://jpx-jquants.com/ja/spec/fin-earnings-date  （Markdown版: 同URL末尾に .md）
   *   2026-11-01 に上記仕様ページを取得し、以下を実装根拠とした。
   *   - GET https://api.jquants.com/v2/fins/earnings-date
   *   - 認証: リクエストヘッダ x-api-key（利用者が設定画面で入力。コードには埋め込まない）
   *   - クエリ: code / date / scheduled_date のいずれか1つのみ指定可（2つ以上は400）、pagination_key
   *     → 本実装は銘柄ごとに code（4桁。仕様例に "8697" の記載あり）のみを指定する
   *   - 応答: { data: [ {PubDate, SchDate, FQName(1Q/2Q/3Q/FY), FYE(MMDD), Code(5桁), CoName, CoNameEn} ], pagination_key }
   *   - code 指定は「予定日の公表・変更履歴」を返す。変更は別の PubDate の新レコードとして追加され、
   *     後から未定になった場合 SchDate は空文字。→ 決算区分(FQName+FYE)ごとに PubDate 最大のレコードを採用し、
   *     SchDate が空のものは予定なしとして扱う。
   *
   * 【未検証の範囲】（実キーでの動作確認は未実施。モック応答でのみ検証）
   *   - 実際のレスポンス内容・エラー本文、各プランで参照できる公表日の範囲
   *   - レート制限の値（仕様ページで確認できていない）。本実装は逐次リクエストし、429受信で中断する
   *   - 通信の堅牢化（本実装の独自方針・仕様由来ではない）: 15秒タイムアウト、5xxは1回だけ再試行、
   *     認証/429/通信断は即中断、5xxが2銘柄連続なら中断。失敗した銘柄は failedCodes で返し、呼び出し側が前回表示を保持する
   *   - ブラウザからの CORS。API Gateway への OPTIONS プリフライトに access-control-allow-origin: * が
   *     返ることは確認したが、実キー付き GET 応答の CORS ヘッダは未確認。失敗時は理由を表示する
   *   - 提供データの再配布・商用利用条件（利用規約の確認が別途必要）
   *   - 対象は日本株のみ。米国銘柄は取得対象外
   *   - 「5桁コード(末尾0)」と「4桁コード」のどちらでも code に指定できる旨は仕様の例示に基づく。
   *     英字を含む新コード体系の銘柄は未検証
   */
  var JQ_BASE = "https://api.jquants.com/v2";
  var FQ_LABEL = { "1Q": "第1四半期", "2Q": "第2四半期", "3Q": "第3四半期", "FY": "通期" };
  var RECENT_PAST_DAYS = 45;
  var MAX_PAGES = 5;

  /** kind: nokey|auth|bad|rate|http|network|timeout|format。hint は利用者向けの再試行方法 */
  function JqError(kind, message, hint) { var e = new Error(message); e.kind = kind; e.hint = hint || ""; return e; }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /** fetch 1回分(タイムアウト付き)。ネットワーク層の失敗は network / timeout に分類 */
  function jqOnce(fetchFn, apiKey, url, timeoutMs) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = null, timedOut = false;
    var opts = { method: "GET", headers: { "x-api-key": apiKey } };
    if (ctrl) { opts.signal = ctrl.signal; timer = setTimeout(function () { timedOut = true; ctrl.abort(); }, timeoutMs); }
    return fetchFn(url, opts).then(function (res) { clearTimeout(timer); return res; }, function () {
      clearTimeout(timer);
      if (timedOut) throw JqError("timeout", "応答がありません（" + Math.round(timeoutMs / 1000) + "秒でタイムアウト）", "回線状況を確認し、「予定を再取得」を押してください。");
      throw JqError("network", "通信に失敗しました（ネットワーク未接続、またはブラウザのCORS制限でAPIへ直接アクセスできない可能性があります）",
        "接続を確認して「予定を再取得」を押してください。繰り返す場合はCORS制限の可能性があり、ブラウザ直接接続では利用できません。ダミーデータに切り替えるか、決算日を手入力してください。");
    });
  }

  function jqRequest(ctx, params) {
    var qs = Object.keys(params).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); }).join("&");
    var url = JQ_BASE + "/fins/earnings-date?" + qs;
    var timeoutMs = ctx.timeoutMs == null ? 15000 : ctx.timeoutMs, retryDelay = ctx.retryDelayMs == null ? 800 : ctx.retryDelayMs;
    function attempt(n) {
      return jqOnce(ctx.fetchFn, ctx.apiKey, url, timeoutMs).then(function (res) {
        if (res.ok) return res.json().catch(function () { throw JqError("format", "応答がJSONとして読み取れませんでした", "時間をおいて再取得してください。続く場合はJ-Quants側の仕様変更の可能性があります。"); });
        var st = res.status;
        if (st >= 500 && n < 1) return sleep(retryDelay).then(function () { return attempt(n + 1); });   // 5xxは1回だけ再試行
        if (st === 401 || st === 403) throw JqError("auth", "認証エラー(HTTP " + st + "): APIキーが無効、またはこのデータの利用権限がありません", "設定でAPIキーを確認してください（前後の空白やコピーミス、プランの権限）。");
        if (st === 400) throw JqError("bad", "リクエスト不正(HTTP 400): 銘柄コード、またはプランの参照可能期間外の指定の可能性があります", "銘柄コードを確認してください。");
        if (st === 429) throw JqError("rate", "リクエスト過多(HTTP 429)", "数分待ってから「予定を再取得」を押してください。銘柄数が多い場合は分けて取得してください。");
        if (st >= 500) throw JqError("http", "J-Quants側のエラー(HTTP " + st + ")", "時間をおいて「予定を再取得」を押してください。続く場合はJ-Quantsの障害情報を確認してください。");
        throw JqError("http", "想定外の応答(HTTP " + st + ")", "時間をおいて再取得してください。");
      });
    }
    return attempt(0);
  }

  /** 1銘柄分の履歴を取得（最大 MAX_PAGES ページ追従）。上限で打ち切った場合 truncated=true */
  function jqFetchAll(ctx, code) {
    var all = [];
    function page(n, pk) {
      var params = { code: code }; if (pk) params.pagination_key = pk;
      return jqRequest(ctx, params).then(function (body) {
        if (!body || !Array.isArray(body.data)) throw JqError("format", "想定外の応答形式です（data 配列がありません）", "時間をおいて再取得してください。続く場合はJ-Quants側の仕様変更の可能性があります。");
        all = all.concat(body.data);
        if (body.pagination_key) {
          if (n >= MAX_PAGES) return { records: all, truncated: true };
          return page(n + 1, body.pagination_key);
        }
        return { records: all, truncated: false };
      });
    }
    return page(1, null);
  }

  /** 履歴レコード → 採用する EarningsEvent。
   *  決算区分(FQName+FYE)ごとに PubDate が最新のレコードだけを採用（予定変更＝新しい公表日のレコードが勝つ）。
   *  SchDate が空(未定)なら予定なし。採用結果のうち「直近の今後の予定1件」＋「直近45日以内に通過した1件」を返す。 */
  function jqNormalize(records, appCode, todayYmd) {
    todayYmd = todayYmd || toYmd(new Date());
    var latest = {};
    records.forEach(function (r) {
      if (!r || typeof r.FQName !== "string" || typeof r.PubDate !== "string") return;
      var k = r.FQName + "|" + r.FYE;
      if (!latest[k] || latest[k].PubDate < r.PubDate) latest[k] = r;
    });
    var cands = Object.keys(latest).map(function (k) { return latest[k]; })
      .filter(function (r) { return /^\d{4}-\d{2}-\d{2}$/.test(r.SchDate || ""); });   // 空文字=未定は除外
    var limit = addDays(new Date(todayYmd + "T00:00:00"), -RECENT_PAST_DAYS);
    var upcoming = cands.filter(function (r) { return r.SchDate >= todayYmd; }).sort(function (a, b) { return a.SchDate < b.SchDate ? -1 : 1; });
    var past = cands.filter(function (r) { return r.SchDate < todayYmd && r.SchDate >= limit; }).sort(function (a, b) { return a.SchDate < b.SchDate ? 1 : -1; });
    return upcoming.slice(0, 1).concat(past.slice(0, 1)).map(function (r) {
      var m = parseInt(String(r.FYE).slice(0, 2), 10);
      var period = (isNaN(m) ? "" : m + "月期 ") + (FQ_LABEL[r.FQName] || r.FQName);
      return { code: appCode, date: r.SchDate, period: period, source: "jquants" };
    });
  }

  var JQuantsAdapter = {
    id: "jquants",
    name: "J-Quants API V2（利用者のAPIキー）",
    requiresKey: true,
    isDummy: false,
    normalize: jqNormalize,   // テスト用に公開
    /** 戻り値: { events, warnings, failedCodes }。failedCodes は取得に失敗した銘柄（呼び出し側は前回データを保持する） */
    fetchSchedule: function (stocks, ctx) {
      ctx = ctx || {};
      var apiKey = (ctx.apiKey || "").trim();
      if (!apiKey) return Promise.reject(JqError("nokey", "APIキーが未入力です", "設定画面でJ-QuantsのAPIキーを入力して保存してください。"));
      var rctx = { apiKey: apiKey, fetchFn: ctx.fetch || window.fetch.bind(window), timeoutMs: ctx.timeoutMs, retryDelayMs: ctx.retryDelayMs };
      var targets = stocks.filter(function (s) { return s.market === "JP" && /^[0-9A-Za-z]{4}$/.test(s.code); });
      var skipped = stocks.length - targets.length;
      var events = [], warnings = [], failedCodes = [], okCount = 0, fatal = null, firstErr = null, httpStreak = 0;
      if (skipped) warnings.push("米国銘柄など日本株(4桁コード)以外の " + skipped + " 件は取得対象外です（手入力で予定を登録できます）");
      var chain = Promise.resolve();
      targets.forEach(function (s) {
        chain = chain.then(function () {
          if (fatal) { failedCodes.push(s.code); return; }
          return jqFetchAll(rctx, s.code).then(function (r) {
            okCount++; httpStreak = 0; events = events.concat(jqNormalize(r.records, s.code, ctx.today));
            if (r.truncated) warnings.push(s.code + ": 履歴が多いため先頭 " + MAX_PAGES + " ページまでで打ち切りました（最新の予定が含まれない可能性）");
          }, function (err) {
            firstErr = firstErr || err; failedCodes.push(s.code);
            httpStreak = err.kind === "http" ? httpStreak + 1 : 0;
            // 認証・レート制限・通信断は全銘柄に共通の障害 → 即中断。5xx は2銘柄連続で失敗したら中断（待ち時間の無駄を避ける）
            if (err.kind === "auth" || err.kind === "rate" || err.kind === "network" || err.kind === "timeout" || httpStreak >= 2) fatal = err;
            else warnings.push(s.code + ": " + err.message);
          });
        });
      });
      return chain.then(function () {
        if (targets.length && okCount === 0) throw firstErr;
        if (fatal) warnings.push("途中で中断しました（" + fatal.message + "）。未取得の銘柄は前回の表示を保持しています");
        return { events: events, warnings: warnings, failedCodes: failedCodes };
      });
    }
  };

  window.KW_ADAPTERS = {
    registry: {},
    register: function (a) { this.registry[a.id] = a; },
    get: function (id) { return this.registry[id] || this.registry.dummy; },
    list: function () { var r = this.registry; return Object.keys(r).map(function (k) { return r[k]; }); }
  };
  window.KW_ADAPTERS.register(DummyAdapter);
  window.KW_ADAPTERS.register(JQuantsAdapter);
  window.KW_DATE = { toYmd: toYmd, addDays: addDays };
})();
