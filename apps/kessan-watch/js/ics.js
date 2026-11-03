/* iCalendar (RFC 5545) 出力。各決算予定を終日イベントとして書き出す。 */
(function () {
  "use strict";
  var enc = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

  function esc(t) { return String(t).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
  function utf8len(ch) { return enc ? enc.encode(ch).length : unescape(encodeURIComponent(ch)).length; }
  /** 75オクテット/行で折り返す（継続行は先頭に空白1つ）。文字の途中では切らない。 */
  function fold(line) {
    var out = [], cur = "", n = 0, limit = 75;
    Array.from(line).forEach(function (ch) {
      var l = utf8len(ch);
      if (n + l > limit) { out.push(cur); cur = " "; n = 1; limit = 75; }
      cur += ch; n += l;
    });
    out.push(cur);
    return out.join("\r\n");
  }
  function ymd8(s) { return s.replace(/-/g, ""); }
  function nextDay8(s) {
    var a = s.split("-").map(Number), d = new Date(Date.UTC(a[0], a[1] - 1, a[2] + 1));
    return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, "0") + String(d.getUTCDate()).padStart(2, "0");
  }
  function stamp(now) {
    return now.getUTCFullYear() + String(now.getUTCMonth() + 1).padStart(2, "0") + String(now.getUTCDate()).padStart(2, "0") + "T" +
      String(now.getUTCHours()).padStart(2, "0") + String(now.getUTCMinutes()).padStart(2, "0") + String(now.getUTCSeconds()).padStart(2, "0") + "Z";
  }
  function uidPart(s) { return Array.from(s).map(function (c) { return /[A-Za-z0-9]/.test(c) ? c : "_" + c.codePointAt(0).toString(16); }).join(""); }

  /** events: [{code,date,period,source}], nameOf(code) → 銘柄名 */
  function build(events, nameOf, now) {
    now = now || new Date();
    var L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//kessan-watch//prototype//JA", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:" + esc("決算ウォッチ")];
    var seenUid = {};
    events.forEach(function (e) {
      // UID は「銘柄コード+対象期」で固定（日付変更後に再取り込みしても同一予定として更新されるようにする）
      var uid = uidPart(e.code + "-" + e.period) + "@kessan-watch";
      if (seenUid[uid]) return; seenUid[uid] = 1;
      var dummy = e.source === "dummy", name = nameOf(e.code) || e.code;
      var desc = (dummy ? "【ダミーデータ】実際の決算発表日ではありません。\n" : "") +
        "決算ウォッチ(試作)から出力。発表日は変更される場合があります。必ず各社の公式IR情報で確認してください。\n" +
        "出典: " + (e.source === "manual" ? "利用者の手入力" : e.source === "jquants" ? "J-Quants API" : e.source);
      L.push("BEGIN:VEVENT",
        "UID:" + uid,
        "DTSTAMP:" + stamp(now),
        "DTSTART;VALUE=DATE:" + ymd8(e.date),
        "DTEND;VALUE=DATE:" + nextDay8(e.date),
        "SUMMARY:" + esc((dummy ? "【ダミー】" : "") + "決算 " + name + "(" + e.code + ") " + e.period),
        "DESCRIPTION:" + esc(desc),
        "TRANSP:TRANSPARENT",
        "END:VEVENT");
    });
    L.push("END:VCALENDAR");
    return L.map(fold).join("\r\n") + "\r\n";
  }
  window.KW_ICS = { build: build, fold: fold, esc: esc };
})();
