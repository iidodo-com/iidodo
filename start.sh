#!/usr/bin/env bash
# ワンクリック起動用スクリプト。
# macOS ではダブルクリック可能な start.command から呼ばれる。
# Linux / ターミナル利用時は `./start.sh` を直接実行してもよい。
cd "$(dirname "$0")" || exit 1

fail() {
  echo ""
  echo "======================================================"
  echo " $1"
  echo "======================================================"
  echo ""
  read -n 1 -s -r -p "何かキーを押すと閉じます..."
  echo ""
  exit 1
}

if [ ! -f package.json ]; then
  fail "このフォルダに package.json が見つかりません。プロジェクト一式を展開したフォルダの直下（package.jsonやcontextフォルダと同じ階層）で実行してください。"
fi

if ! command -v npm >/dev/null 2>&1; then
  fail "npm（Node.js）が見つかりません。https://nodejs.org/ja/ からインストールしてから、もう一度実行してください。"
fi

if [ ! -f .env ]; then
  if [ ! -f .env.example ]; then
    fail ".env.example が見つからないため .env を作成できません。プロジェクト一式が正しく展開されているか確認してください。"
  fi
  cp .env.example .env
  echo ""
  echo "======================================================"
  echo " .env を新規作成しました。"
  echo " ANTHROPIC_API_KEY にご自身のAPIキーを設定してください。"
  echo " (キーは https://console.anthropic.com で発行できます)"
  echo " 保存して閉じると、自動的にアプリが起動します。"
  echo "======================================================"
  echo ""
  if command -v open >/dev/null 2>&1; then
    open -W -e .env 2>/dev/null || open -W .env
  else
    "${EDITOR:-nano}" .env
  fi
fi

if [ ! -d node_modules ]; then
  echo "初回起動のため依存パッケージをインストールします…（数十秒かかります）"
  if ! npm install; then
    fail "npm install に失敗しました。上に表示されたエラー内容を確認してください。"
  fi
fi

echo ""
echo "起動します。ブラウザが自動で開かない場合は http://localhost:5173 を手動で開いてください。"
echo "このウィンドウを閉じるとアプリも終了します。"
echo ""

(
  sleep 2
  URL="http://localhost:5173"
  if command -v open >/dev/null 2>&1; then
    open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL"
  fi
) &

if ! npm run dev; then
  fail "アプリの起動に失敗しました。上に表示されたエラー内容を確認してください。"
fi

read -n 1 -s -r -p "アプリが終了しました。何かキーを押すと閉じます..."
echo ""
