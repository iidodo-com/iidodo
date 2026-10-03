// 物語のセリフとスタッフロール。who が空ならナレーション。
export const HERO = 'アルト';

export const PROLOGUE = [
  { who: '', text: 'かつて大地には、空に浮かぶ城「アルカディア」から、光の魔力が降り注いでいた。' },
  { who: '', text: 'しかしある日を境に光は途絶え、草木は枯れ、大地は魔物であふれはじめた。' },
  { who: '', text: `旅人${HERO}は、すべての元凶を絶つため、はじまりの平原から空の城を目指す――。` },
];

export const BOSS_INTRO = [
  { who: '終焉の王 ヴォイド', text: '……ここまで辿り着いたか。地を這う旅人よ。' },
  { who: HERO, text: '大地の光を返してもらう。お前が奪ったすべてを。' },
  { who: '終焉の王 ヴォイド', text: '光、だと？ 愚かな。この力で我は永遠となる。邪魔をするなら――無へ還れ！' },
];

export const PHASE2 = [
  { who: '終焉の王 ヴォイド', text: '……見事だ。ならば見せてやろう、我が真の姿を！' },
  { who: '終焉の王 ヴォイド', text: '結界よ、我を護れ！ この光は、誰にも砕けぬ！' },
  { who: '', text: '結界を支える3本のピラーを破壊しろ！' },
];

export const SHIELD_BROKEN = [
  { who: '終焉の王 ヴォイド', text: 'ぐっ……我が結界が……！ まだだ、まだ終わらぬ！' },
];

export const DEFEAT = [
  { who: '終焉の王 ヴォイド', text: '馬鹿な……この我が、地を這う者に……。……光が、戻っていく……のか。' },
  { who: '終焉の王 ヴォイド', text: 'そうか……我が欲しかったのは、永遠ではなく……あの温もりだったのかもしれぬ……。' },
  { who: HERO, text: '……終わった。みんな、ありがとう。' },
];

/** エンディング中の字幕 (表示時間 ms) */
export const CAPTIONS = [
  ['王が消え、アルカディアから光が溢れ出した。', 4200],
  ['光は雲を抜け、枯れた大地へと降り注ぎ――', 4200],
  ['草木は芽吹き、水は澄み、魔物たちは静かに森へ還っていった。', 4800],
  [`旅人${HERO}の長い旅は、こうして幕を下ろした。`, 4800],
];

export const CREDITS = [
  ['AETHERIA', 'title'],
  ['3D ACTION ROLE-PLAYING GAME', 'sub'],
  ['', 'gap'],
  ['企画・ディレクション', 'role'], ['あなた', 'name'],
  ['', 'gap'],
  ['ゲームデザイン / プログラミング / アート / サウンド', 'role'], ['Claude (Anthropic)', 'name'],
  ['', 'gap'],
  ['キャラクター', 'role'], [HERO, 'name'], ['終焉の王 ヴォイド', 'name'],
  ['', 'gap'],
  ['使用技術', 'role'], ['Three.js', 'name'], ['Vite', 'name'], ['Web Audio API', 'name'],
  ['', 'gap'],
  ['素材協力 (CC0)', 'role'], ['Poly Haven', 'name'],
  ['Greg Zaal / Jarod Guest — HDRI', 'small'], ['Rob Tuytel / Rico Cilliers / Charlotte Baglioni — テクスチャ・モデル', 'small'],
  ['Jenelle van Heerden / Dario Barresi — 岩モデル', 'small'],
  ['', 'gap'],
  ['スペシャルサンクス', 'role'], ['ここまで遊んでくれた あなた', 'name'],
  ['', 'gap'], ['', 'gap'],
  ['THANK YOU FOR PLAYING', 'title'],
];
