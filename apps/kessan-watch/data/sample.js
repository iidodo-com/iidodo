/* サンプルデータ（すべてダミー）
 * 銘柄名・コードは実在の半導体/AI関連銘柄を「例」として使っていますが、
 * 決算予定日は実際の発表日ではありません。本日を基準にした相対日数で生成した架空の値です。
 * offset = 本日からの日数（負＝通過済み）。 */
window.KW_SAMPLE = {
  stocks: [
    { code: "8035", name: "東京エレクトロン", market: "JP", theme: "製造装置", memo: "" },
    { code: "6857", name: "アドバンテスト", market: "JP", theme: "テスタ", memo: "" },
    { code: "6920", name: "レーザーテック", market: "JP", theme: "検査装置", memo: "" },
    { code: "6146", name: "ディスコ", market: "JP", theme: "後工程装置", memo: "" },
    { code: "7735", name: "SCREENホールディングス", market: "JP", theme: "製造装置", memo: "" },
    { code: "6723", name: "ルネサスエレクトロニクス", market: "JP", theme: "車載半導体", memo: "" },
    { code: "3436", name: "SUMCO", market: "JP", theme: "シリコンウエハ", memo: "" },
    { code: "9984", name: "ソフトバンクグループ", market: "JP", theme: "AI投資", memo: "" },
    { code: "NVDA", name: "NVIDIA", market: "US", theme: "AI半導体", memo: "" },
    { code: "AMD", name: "Advanced Micro Devices", market: "US", theme: "AI半導体", memo: "" },
    { code: "AVGO", name: "Broadcom", market: "US", theme: "AI半導体", memo: "" },
    { code: "TSM", name: "TSMC (ADR)", market: "US", theme: "ファウンドリ", memo: "" },
    { code: "MU", name: "Micron Technology", market: "US", theme: "メモリ", memo: "" },
    { code: "ASML", name: "ASML Holding", market: "US", theme: "露光装置", memo: "" }
  ],
  offsets: {
    "8035": { offset: 4, period: "ダミー第2四半期" },
    "6857": { offset: -3, period: "ダミー第2四半期" },
    "6920": { offset: 9, period: "ダミー第1四半期" },
    "6146": { offset: -10, period: "ダミー第2四半期" },
    "7735": { offset: 12, period: "ダミー第2四半期" },
    "6723": { offset: 16, period: "ダミー第3四半期" },
    "3436": { offset: 21, period: "ダミー第3四半期" },
    "9984": { offset: 7, period: "ダミー第2四半期" },
    "NVDA": { offset: 18, period: "ダミーQ3" },
    "AMD": { offset: -6, period: "ダミーQ3" },
    "AVGO": { offset: 33, period: "ダミーQ4" },
    "TSM": { offset: 2, period: "ダミーQ3" },
    "MU": { offset: 27, period: "ダミーQ1" },
    "ASML": { offset: -1, period: "ダミーQ3" }
  }
};
