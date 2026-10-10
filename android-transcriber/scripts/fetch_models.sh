#!/usr/bin/env bash
# 文字起こし・話者分離に使うモデルを Hugging Face から取得し、アプリが期待する配置で ./models/ に置く。
# 取得元（いずれも公開リポジトリ。各ライセンスは取得元ページで確認すること）:
#   SenseVoice  : csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17
#   Silero VAD  : deepghs/silero-vad-onnx            （MIT と表記）
#   話者分離    : csukuangfj/sherpa-onnx-pyannote-segmentation-3-0 / csukuangfj/speaker-embedding-models
# 使い方: ./scripts/fetch_models.sh [出力先(既定 ./models)] [--no-diarization]
set -euo pipefail
OUT="${1:-./models}"
HF=https://huggingface.co
mkdir -p "$OUT/sense-voice" "$OUT/diarization"
get() { [ -s "$2" ] && { echo "skip $2"; return; }; echo "get  $2"; curl -fL --retry 3 -o "$2.part" "$1" && mv "$2.part" "$2"; }
SV="$HF/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main"
get "$SV/model.int8.onnx" "$OUT/sense-voice/model.int8.onnx"
get "$SV/tokens.txt" "$OUT/sense-voice/tokens.txt"
get "$HF/deepghs/silero-vad-onnx/resolve/main/silero_vad.onnx" "$OUT/silero_vad.onnx"
if [ "${2:-}" != "--no-diarization" ]; then
  get "$HF/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.onnx" "$OUT/diarization/segmentation.onnx"
  get "$HF/csukuangfj/speaker-embedding-models/resolve/main/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx" "$OUT/diarization/embedding.onnx"
fi
echo "done: $OUT"
