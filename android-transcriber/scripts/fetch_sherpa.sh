#!/usr/bin/env bash
# sherpa-onnx の Kotlin API を取得し、app/src/main/java/com/k2fsa/sherpa/onnx/ に配置する。
# ネイティブライブラリ(.so)は scripts/fetch_sherpa_libs.sh で取得する。
set -euo pipefail
REF="${SHERPA_REF:-master}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/app/src/main/java/com/k2fsa/sherpa/onnx"
BASE="https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/${REF}/sherpa-onnx/kotlin-api"
FILES=(SpeakerEmbeddingExtractorConfig FeatureConfig OfflineRecognizer OfflineStream OfflineSpeakerDiarization Vad QnnConfig HomophoneReplacerConfig OfflinePunctuation)
mkdir -p "$DEST"
for f in "${FILES[@]}"; do
  curl -fsSL "${BASE}/${f}.kt" -o "${DEST}/${f}.kt"
  echo "fetched ${f}.kt"
done
