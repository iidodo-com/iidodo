#!/usr/bin/env bash
# sherpa-onnx の Android 用ネイティブライブラリ(libsherpa-onnx-jni.so, libonnxruntime.so)を取得し、
# app/src/main/jniLibs/arm64-v8a/ に置く。GitHub Releases から取得するため、github.com に接続できる環境で実行する。
# バージョンは Kotlin API(scripts/fetch_sherpa.sh の SHERPA_REF)と揃えること。
# 注意: アセット名 `sherpa-onnx-v<ver>-android.tar.bz2` は公式の命名規則に基づく想定で、未検証。取得に失敗したら
#       https://github.com/k2-fsa/sherpa-onnx/releases で実際のファイル名を確認する。
set -euo pipefail
VER="${1:?usage: $0 <version e.g. 1.13.8>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/v${VER}/sherpa-onnx-v${VER}-android.tar.bz2"
curl -fL --retry 3 -o "$TMP/android.tar.bz2" "$URL"
tar -xjf "$TMP/android.tar.bz2" -C "$TMP"
DEST="$ROOT/app/src/main/jniLibs/arm64-v8a"
mkdir -p "$DEST"
find "$TMP" -path '*arm64-v8a*' -name '*.so' -exec cp -v {} "$DEST"/ \;
ls -la "$DEST"
