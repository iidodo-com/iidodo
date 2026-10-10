#!/usr/bin/env python3
"""アプリと同じ構成（Silero VAD → SenseVoice、任意で話者分離）を PC 上の sherpa-onnx(Python) で実行し、
文字起こし結果・CER・処理時間（実測）を表示する検証用スクリプト。アプリ本体には含まれない。

使い方:
    pip install sherpa-onnx numpy
    python scripts/e2e_sherpa.py --models <models dir> --wav sample.wav [--ref ref.txt] [--diarize --num-speakers 2]
モデル配置は README の「モデルの配置」と同じ。
"""
from __future__ import annotations

import argparse
import time
import wave
from pathlib import Path

import numpy as np
import sherpa_onnx


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as w:
        sr, ch, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        if width != 2:
            raise SystemExit("16bit PCM の WAV のみ対応")
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    if ch > 1:
        data = data.reshape(-1, ch).mean(axis=1)
    if sr != 16000:  # 検証用の簡易リサンプル（アプリは線形補間を使用）
        x = np.arange(int(len(data) * 16000 / sr)) * sr / 16000
        data = np.interp(x, np.arange(len(data)), data).astype(np.float32)
    return data, 16000


def cer(ref: str, hyp: str) -> float:
    import unicodedata

    def norm(s: str) -> str:
        return "".join(c for c in s if not c.isspace() and not unicodedata.category(c).startswith(("P", "S")))

    r, h = norm(ref), norm(hyp)
    if not r:
        return 0.0 if not h else 1.0
    prev = list(range(len(h) + 1))
    for i, a in enumerate(r, 1):
        cur = [i]
        for j, b in enumerate(h, 1):
            cur.append(min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a != b)))
        prev = cur
    return prev[-1] / len(r)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", type=Path, required=True)
    ap.add_argument("--wav", type=Path, required=True)
    ap.add_argument("--ref", type=Path, help="正解テキスト（CER 算出用）")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--diarize", action="store_true")
    ap.add_argument("--num-speakers", type=int, default=-1)
    a = ap.parse_args()

    samples, sr = read_wav(a.wav)
    dur = len(samples) / sr
    t0 = time.perf_counter()

    vad = sherpa_onnx.VoiceActivityDetector(
        sherpa_onnx.VadModelConfig(
            silero_vad=sherpa_onnx.SileroVadModelConfig(
                model=str(a.models / "silero_vad.onnx"), threshold=0.5, min_silence_duration=0.5,
                min_speech_duration=0.25, window_size=512, max_speech_duration=25,
            ),
            sample_rate=sr, num_threads=1,
        ),
        buffer_size_in_seconds=60,
    )
    regions = []
    for i in range(0, len(samples) - 512 + 1, 512):
        vad.accept_waveform(samples[i : i + 512])
        while not vad.empty():
            regions.append((vad.front.start, len(vad.front.samples)))
            vad.pop()
    vad.flush()
    while not vad.empty():
        regions.append((vad.front.start, len(vad.front.samples)))
        vad.pop()
    t_vad = time.perf_counter()

    turns = []
    if a.diarize:
        sd = sherpa_onnx.OfflineSpeakerDiarization(
            sherpa_onnx.OfflineSpeakerDiarizationConfig(
                segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
                    pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
                        model=str(a.models / "diarization/segmentation.onnx")),
                    num_threads=a.threads),
                embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(
                    model=str(a.models / "diarization/embedding.onnx"), num_threads=a.threads),
                clustering=sherpa_onnx.FastClusteringConfig(num_clusters=a.num_speakers, threshold=0.5),
                min_duration_on=0.2, min_duration_off=0.5,
            )
        )
        turns = [(s.start, s.end, s.speaker) for s in sd.process(samples).sort_by_start_time()]
    t_dia = time.perf_counter()

    rec = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(a.models / "sense-voice/model.int8.onnx"), tokens=str(a.models / "sense-voice/tokens.txt"),
        num_threads=a.threads, language="ja", use_itn=True,
    )
    t_load = time.perf_counter()
    out = []
    for start, n in regions:
        st = rec.create_stream()
        st.accept_waveform(sr, samples[start : start + n])
        rec.decode_stream(st)
        s0 = start / sr
        spk = next((t[2] for t in turns if t[0] <= s0 + (n / sr) / 2 <= t[1]), None)
        out.append((s0, (start + n) / sr, spk, st.result.text.strip()))
    t_asr = time.perf_counter()

    for s, e, spk, text in out:
        print(f"[{s:7.2f}-{e:7.2f}]{'' if spk is None else f' spk{spk}'} {text}")
    full = "".join(t for *_, t in out)
    print("---")
    print(f"音声 {dur:.1f}s / 発話区間 {len(regions)} / 話者区間 {len(turns)}")
    print(f"VAD {t_vad - t0:.2f}s, 話者分離 {t_dia - t_vad:.2f}s, モデル読込 {t_load - t_dia:.2f}s, 認識 {t_asr - t_load:.2f}s")
    print(f"合計 {t_asr - t0:.2f}s（音声の {dur / (t_asr - t0):.1f} 倍速, threads={a.threads}）")
    if a.ref:
        print(f"CER = {cer(a.ref.read_text(encoding='utf-8'), full):.3f}")


if __name__ == "__main__":
    main()
