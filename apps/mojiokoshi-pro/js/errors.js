/* エラーの共通表現: 「何が起きたか」+「利用者が次に取る行動」を必ずセットで表示する */
(function (g) {
  const MP = g.MP;

  class AppError extends Error {
    constructor(message, hint, code) {
      super(message);
      this.name = 'AppError';
      this.hint = hint || '';
      this.code = code || '';
    }
  }
  MP.AppError = AppError;

  /** 任意の例外を {message, hint} に正規化（内部情報や長い文字列はそのまま出さない） */
  MP.describeError = function (e) {
    if (e && e.name === 'AbortError') {
      return { message: 'キャンセルしました。', hint: 'もう一度実行するには「文字起こしを実行」を押してください。' };
    }
    if (e instanceof AppError) return { message: e.message, hint: e.hint };
    const raw = e && e.message ? String(e.message).slice(0, 120) : '';
    return {
      message: '予期しないエラーが発生しました。' + (raw ? `（${raw}）` : ''),
      hint: 'ページを再読み込みして、もう一度お試しください。繰り返す場合は、ブラウザを最新版に更新するか、デモモードで画面の動作を確認してください。',
    };
  };

  /** エラー表示ボックスを描画（textContent経由のみ） */
  MP.renderError = function (box, e) {
    const d = MP.describeError(e);
    MP.clear(box).append(
      MP.h('strong', null, d.message),
      d.hint ? MP.h('p', { class: 'hint' }, '▶ 次にやること: ' + d.hint) : null);
    box.hidden = false;
  };

  MP.errorToast = function (e) {
    const d = MP.describeError(e);
    MP.toast(d.hint ? `${d.message} ${d.hint}` : d.message, 'err');
  };
})(window);
