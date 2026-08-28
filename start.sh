#!/usr/bin/env bash
# ワンクリック起動用スクリプト。
# macOS ではダブルクリック可能な start.command から呼ばれる。
# Linux / ターミナル利用時は `./start.sh` を直接実行してもよい。
set -e
cd "$(dirname "$0")"

if [ ! -f .env ]; then
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
  npm install
fi

(
  sleep 2
  URL="http://localhost:5173"
  if command -v open >/dev/null 2>&1; then
    open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL"
  fi
) &

npm run dev
