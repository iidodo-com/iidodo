#!/usr/bin/env bash
# fetch_models.sh で用意した models/ を、USB デバッグ接続した端末のアプリ専用領域へ送る。
# 要: adb、端末で開発者向けオプション→USBデバッグを有効化、アプリを一度起動済み。
set -euo pipefail
SRC="${1:-./models}"
PKG=com.iidodo.transcriber
DEST="/sdcard/Android/data/$PKG/files/models"
adb shell mkdir -p "$DEST"
adb push "$SRC"/. "$DEST"/
adb shell ls -R "$DEST"
