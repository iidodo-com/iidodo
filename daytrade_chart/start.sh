#!/usr/bin/env bash
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "初回セットアップ中です（数分かかります）..."
  python3 -m venv .venv || { echo "Python 3.11以上をインストールしてください"; exit 1; }
  . .venv/bin/activate
  pip install -r requirements.txt || exit 1
else
  . .venv/bin/activate
fi
[ -f .env ] || cp .env.example .env
echo "ブラウザで http://127.0.0.1:8000 を開いてください（終了は Ctrl+C）"
python main.py "$@"
