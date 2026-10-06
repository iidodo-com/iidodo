"""統計データ源の定義（取得・整形・HTML生成・テストで共通利用）。"""

SOUMU = "https://www.soumu.go.jp"

# 政令指定都市20市。estat_area は e-Stat 地域コード(5桁)。
# zaisei_file は「財政状況資料集 令和5年度」の市別 xlsx（総務省 /main_content/ 配下の番号）。
CITIES = [
    # code, name, pref, zaisei_file
    ("01100", "札幌市", "北海道", "000999765"),
    ("04100", "仙台市", "宮城県", "000999766"),
    ("11100", "さいたま市", "埼玉県", "000999767"),
    ("12100", "千葉市", "千葉県", "000999768"),
    ("14100", "横浜市", "神奈川県", "000999769"),
    ("14130", "川崎市", "神奈川県", "000999770"),
    ("14150", "相模原市", "神奈川県", "000999771"),
    ("15100", "新潟市", "新潟県", "000999772"),
    ("22100", "静岡市", "静岡県", "000999773"),
    ("22130", "浜松市", "静岡県", "000999774"),
    ("23100", "名古屋市", "愛知県", "000999775"),
    ("26100", "京都市", "京都府", "000999776"),
    ("27100", "大阪市", "大阪府", "000999777"),
    ("27140", "堺市", "大阪府", "000999778"),
    ("28100", "神戸市", "兵庫県", "000999779"),
    ("33100", "岡山市", "岡山県", "000999780"),
    ("34100", "広島市", "広島県", "000999781"),
    ("40100", "北九州市", "福岡県", "000999782"),
    ("40130", "福岡市", "福岡県", "000999783"),
    ("43100", "熊本市", "熊本県", "000999784"),
]
HIGHLIGHT = "34100"  # 広島市

# 取得対象。files は (保存名, URL)。
SOURCES = [
    {
        "id": "teiin",
        "name": "地方公共団体定員管理調査（令和6年）指定都市データ",
        "publisher": "総務省",
        "stat_id": "e-Stat 統計コード 00200216／ファイル 000983631.xlsx（第1表 部門別職員一覧）",
        "page_url": SOUMU + "/main_sosiki/jichi_gyousei/c-gyousei/teiin/251225data.html",
        "estat_url": "https://www.e-stat.go.jp/statistics/00200216",
        "survey_date": "2024-04-01",
        "survey_label": "令和6年4月1日",
        "files": [("teiin_shitei.xlsx", SOUMU + "/main_content/000983631.xlsx")],
    },
    {
        "id": "jyuki_r6",
        "name": "住民基本台帳に基づく人口、人口動態及び世帯数（令和6年1月1日現在）市区町村別【総計】",
        "publisher": "総務省",
        "stat_id": "e-Stat 統計コード 00200241／ファイル 000959256.xlsx",
        "page_url": SOUMU + "/menu_news/s-news/01gyosei02_02000316.html",
        "estat_url": "https://www.e-stat.go.jp/statistics/00200241",
        "survey_date": "2024-01-01",
        "survey_label": "令和6年1月1日",
        "files": [("jyuki_r6.xlsx", SOUMU + "/main_content/000959256.xlsx")],
    },
    {
        "id": "jyuki_r7",
        "name": "住民基本台帳に基づく人口、人口動態及び世帯数（令和7年1月1日現在）市区町村別【総計】",
        "publisher": "総務省",
        "stat_id": "e-Stat 統計コード 00200241／ファイル 001023714.xlsx",
        "page_url": SOUMU + "/menu_news/s-news/01gyosei02_02000389.html",
        "estat_url": "https://www.e-stat.go.jp/statistics/00200241",
        "survey_date": "2025-01-01",
        "survey_label": "令和7年1月1日",
        "files": [("jyuki_r7.xlsx", SOUMU + "/main_content/001023714.xlsx")],
    },
    {
        "id": "zaisei",
        "name": "財政状況資料集 令和5年度（総括表・市町村）",
        "publisher": "総務省（地方財政状況調査）",
        "stat_id": "e-Stat 統計コード 00200251（地方財政状況調査）／市別 xlsx 000999765〜000999784",
        "page_url": SOUMU + "/iken/zaisei/jyoukyou_shiryou/r05/index.html",
        "estat_url": "https://www.e-stat.go.jp/statistics/00200251",
        "survey_date": "2024-03-31",
        "survey_label": "令和5年度決算",
        "files": [(f"zaisei_{c[0]}.xlsx", f"{SOUMU}/main_content/{c[3]}.xlsx") for c in CITIES],
    },
]

# e-Stat API（appId 必須）で取得するもの。
ESTAT_API = "https://api.e-stat.go.jp/rest/3.0/app/json"
CENSUS = {
    "id": "census2020",
    "name": "令和2年国勢調査 人口等基本集計 男女別人口（全国，都道府県，市区町村）",
    "publisher": "総務省統計局（e-Stat API）",
    "stats_data_id": "0003445078",
    "stat_id": "e-Stat 統計表ID 0003445078（統計コード 00200521）",
    "page_url": "https://www.e-stat.go.jp/dbview?sid=0003445078",
    "estat_url": "https://www.e-stat.go.jp/statistics/00200521",
    "survey_date": "2020-10-01",
    "survey_label": "令和2年10月1日",
}
