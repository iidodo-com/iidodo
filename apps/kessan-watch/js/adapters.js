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
 *   fetchSchedule(stocks, ctx): Promise<EarningsEvent[]>
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

  /** J-Quants 用スタブ（未実装）。
   * 実装時のメモ:
   *  - 利用者が自分のAPIキー/認証情報を設定画面で入力する（コードに埋め込まない）。
   *  - 決算発表予定日の取得に使うエンドポイント・認証方式・レート制限・再配布条件は
   *    実装時に J-Quants 公式ドキュメントで必ず確認すること（本試作では未検証）。
   *  - ブラウザ直接アクセスが CORS で許可されるかは未確認。不可の場合は中継サーバが必要。
   *  - 返却値を EarningsEvent に正規化して返すこと。
   */
  var JQuantsAdapter = {
    id: "jquants",
    name: "J-Quants API（未実装・利用者キー入力）",
    requiresKey: true,
    isDummy: false,
    fetchSchedule: function () {
      return Promise.reject(new Error("J-Quants アダプタは未実装です（試作）。README の残作業を参照してください。"));
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
