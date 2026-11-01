/* デモモード用モックデータ（架空の会議。実在の人物・組織とは無関係） */
(function (g) {
  const MP = g.MP;
  const U = MP.UNINTELLIGIBLE;

  const BASE = {
    speakers: { A: '話者A', B: '話者B', C: '話者C' },
    transcript: [
      { spk: 'A', start: '00:00', text: 'えー、それでは定例会議を始めます。本日はあの、新サービスのリリース準備の件が中心です。', uncertain: false },
      { spk: 'B', start: '00:12', text: 'はい。えっと、テスト環境での確認は、ほぼ終わっていて、残りは決済まわりだけです。', uncertain: false },
      { spk: 'A', start: '00:27', text: 'リリース日は、来月の第二週あたりで、いいですかね。', uncertain: false },
      { spk: 'C', start: '00:36', text: U, uncertain: true },
      { spk: 'B', start: '00:41', text: 'ええ、問題ないと思います。ただ、法務のチェックがまだなので、そこが条件です。', uncertain: false },
      { spk: 'A', start: '00:55', text: 'わかりました。じゃあ、リリースは来月第二週を目標にして、法務確認が終わり次第、正式に確定としましょう。', uncertain: false },
      { spk: 'C', start: '01:12', text: 'あの、利用規約の更新案は、私のほうで今週中にまとめます。', uncertain: false },
      { spk: 'A', start: '01:22', text: 'お願いします。あと、えーと、料金ページの文言は、Bさん、確認してもらえますか。', uncertain: false },
      { spk: 'B', start: '01:31', text: '了解です。金曜までに、見直します。', uncertain: false },
      { spk: 'A', start: '01:38', text: '他に、なければ、これで終わります。お疲れさまでした。', uncertain: false },
    ],
    polished: [
      { spk: 'A', text: 'それでは、定例会議を始めます。本日は、新サービスのリリース準備が中心の議題です。' },
      { spk: 'B', text: 'テスト環境での確認はほぼ完了しており、残りは決済まわりのみです。' },
      { spk: 'A', text: 'リリース日は、来月の第二週あたりでよいでしょうか。' },
      { spk: 'C', text: U },
      { spk: 'B', text: '問題ないと思います。ただし、法務のチェックが未完了のため、それが条件となります。' },
      { spk: 'A', text: 'わかりました。リリースは来月第二週を目標とし、法務確認が完了次第、正式に確定とします。' },
      { spk: 'C', text: '利用規約の更新案は、私のほうで今週中にまとめます。' },
      { spk: 'A', text: 'お願いします。また、料金ページの文言について、Bさんに確認をお願いします。' },
      { spk: 'B', text: '承知しました。金曜日までに見直します。' },
      { spk: 'A', text: '他に議題がなければ、これで終了とします。お疲れさまでした。' },
    ],
    summary: [
      '新サービスのリリース準備について定例会議を実施した。',
      'テスト環境での確認はほぼ完了しており、残りは決済まわりのみ。',
      'リリース時期は来月第二週を目標とするが、法務チェックの完了が条件。',
      '※ 00:36 付近の発言は聞き取れず、内容に反映していない。',
    ],
    decisions: [
      'リリースは来月第二週を目標とし、法務確認の完了後に正式確定する。',
    ],
    todos: [
      { task: '利用規約の更新案をまとめる', owner: '話者C', due: '今週中' },
      { task: '料金ページの文言を見直す', owner: '話者B', due: '金曜日' },
      { task: '法務チェックを完了させる', owner: '不明', due: '不明' },
    ],
    audio_notes: '00:36 付近は声が小さく聞き取れませんでした（デモデータ）。',
  };

  MP.mock = {
    /** モックの結果を返す（毎回ディープコピー） */
    make() { return JSON.parse(JSON.stringify(BASE)); },
    /** ファイル無しのデモ用に擬似的な音量チェック結果を返す */
    fakeCheck() {
      const peaks = Array.from({ length: 120 }, (_, i) =>
        Math.min(1, 0.15 + 0.6 * Math.abs(Math.sin(i / 5) * Math.sin(i / 17 + 1)) + (i % 7 === 0 ? 0.1 : 0)));
      return {
        level: 'ok', duration: 104, rmsDb: -24.3, peakDb: -3.2, silenceRatio: 0.12, clipRatio: 0,
        messages: ['デモ用の擬似データです（実ファイルは解析していません）。'], peaks,
      };
    },
  };
})(window);
