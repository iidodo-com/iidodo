package com.iidodo.transcriber.engine

import com.iidodo.transcriber.audio.FilePcmSource
import com.iidodo.transcriber.core.AudioMath
import com.iidodo.transcriber.core.Diarizer
import com.iidodo.transcriber.core.PcmSource
import com.iidodo.transcriber.core.RecognizedText
import com.iidodo.transcriber.core.Recognizer
import com.iidodo.transcriber.core.SampleRange
import com.iidodo.transcriber.core.SpeakerTurn
import com.iidodo.transcriber.core.SpeechDetector
import com.iidodo.transcriber.core.Word
import com.k2fsa.sherpa.onnx.FastClusteringConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineSenseVoiceModelConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerDiarization
import com.k2fsa.sherpa.onnx.OfflineSpeakerDiarizationConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerSegmentationModelConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerSegmentationPyannoteModelConfig
import com.k2fsa.sherpa.onnx.SileroVadModelConfig
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractorConfig
import com.k2fsa.sherpa.onnx.Vad
import com.k2fsa.sherpa.onnx.VadModelConfig
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import java.io.Closeable
import java.io.File

/** 端末に置くモデルファイルの配置（[ModelPaths.layoutHelp] 参照）。 */
class ModelPaths(private val root: File) {
    val senseVoiceModel = File(root, "sense-voice/model.int8.onnx")
    val senseVoiceTokens = File(root, "sense-voice/tokens.txt")
    val vad = File(root, "silero_vad.onnx")
    val segmentation = File(root, "diarization/segmentation.onnx")
    val embedding = File(root, "diarization/embedding.onnx")

    fun missingAsr(): List<File> = listOf(senseVoiceModel, senseVoiceTokens, vad).filterNot { it.isFile }
    fun missingDiarization(): List<File> = listOf(segmentation, embedding).filterNot { it.isFile }
    fun relative(f: File): String = f.relativeTo(root).path

    companion object {
        val layoutHelp = """
            models/
              silero_vad.onnx
              sense-voice/model.int8.onnx
              sense-voice/tokens.txt
              diarization/segmentation.onnx   （pyannote-segmentation-3-0 の model.onnx）
              diarization/embedding.onnx      （3D-Speaker 等の話者埋め込みモデル）
        """.trimIndent()
    }
}

class ModelsMissingException(val files: List<String>) : Exception("models missing: ${files.joinToString()}")

/**
 * sherpa-onnx を使った推論一式。モデルは使う時にだけ読み込む。
 * 認識は SenseVoice(日本語)。SenseVoice はホットワード/初期プロンプトに非対応のため、
 * 用語辞書は出力後の置換で反映する（hotwords/prompt 引数は無視）。
 */
class SherpaEngine(private val paths: ModelPaths, private val threads: Int = 4) : Closeable {
    private var recognizer: OfflineRecognizer? = null

    val detector: SpeechDetector = object : SpeechDetector {
        override suspend fun detect(source: PcmSource, onProgress: (Float) -> Unit): List<SampleRange> {
            val missing = paths.missingAsr().filter { it == paths.vad }
            if (missing.isNotEmpty()) throw ModelsMissingException(missing.map(paths::relative))
            val vad = Vad(
                config = VadModelConfig(
                    sileroVadModelConfig = SileroVadModelConfig(
                        model = paths.vad.absolutePath,
                        threshold = 0.5f,
                        minSilenceDuration = 0.5f,
                        minSpeechDuration = 0.25f,
                        windowSize = 512,
                        maxSpeechDuration = 25f,
                    ),
                    sampleRate = AudioMath.SAMPLE_RATE,
                    numThreads = 1,
                ),
            )
            val out = ArrayList<SampleRange>()
            try {
                fun drain() {
                    while (!vad.empty()) {
                        val seg = vad.front()
                        out += SampleRange(seg.start.toLong(), seg.start.toLong() + seg.samples.size)
                        vad.pop()
                    }
                }
                val window = 512
                val block = window * 64
                var pos = 0L
                while (pos < source.totalSamples) {
                    currentCoroutineContext().ensureActive()
                    val data = source.read(pos, block)
                    // Silero VAD は windowSize 単位で受け取る
                    var i = 0
                    while (i + window <= data.size) {
                        vad.acceptWaveform(data.copyOfRange(i, i + window))
                        i += window
                    }
                    drain()
                    pos += (data.size / window) * window
                    onProgress((pos.toFloat() / source.totalSamples).coerceIn(0f, 1f))
                    if (data.size < window) break
                }
                vad.flush()
                drain()
            } finally {
                vad.release()
            }
            return out
        }
    }

    val recognizerAdapter: Recognizer = Recognizer { samples, sampleRate, _, _ ->
        val rec = recognizer ?: createRecognizer().also { recognizer = it }
        val stream = rec.createStream()
        try {
            stream.acceptWaveform(samples, sampleRate)
            rec.decode(stream)
            val r = rec.getResult(stream)
            val words = if (r.tokens.isNotEmpty() && r.timestamps.size == r.tokens.size) {
                r.tokens.indices.map { i ->
                    val s = r.timestamps[i].toDouble()
                    val e = if (i + 1 < r.timestamps.size) r.timestamps[i + 1].toDouble() else s + 0.2
                    Word(r.tokens[i], s, e)
                }
            } else {
                emptyList()
            }
            RecognizedText(r.text.trim(), words)
        } finally {
            stream.release()
        }
    }

    private fun createRecognizer(): OfflineRecognizer {
        val missing = paths.missingAsr().filter { it != paths.vad }
        if (missing.isNotEmpty()) throw ModelsMissingException(missing.map(paths::relative))
        val config = OfflineRecognizerConfig(
            modelConfig = OfflineModelConfig(
                senseVoice = OfflineSenseVoiceModelConfig(
                    model = paths.senseVoiceModel.absolutePath,
                    language = "ja",
                    useInverseTextNormalization = true,
                ),
                tokens = paths.senseVoiceTokens.absolutePath,
                numThreads = threads,
                debug = false,
                provider = "cpu",
            ),
        )
        return OfflineRecognizer(config = config)
    }

    val diarizer: Diarizer = object : Diarizer {
        override suspend fun diarize(source: PcmSource, numSpeakers: Int?, onProgress: (Float) -> Unit): List<SpeakerTurn> {
            val missing = paths.missingDiarization()
            if (missing.isNotEmpty()) throw ModelsMissingException(missing.map(paths::relative))
            val config = OfflineSpeakerDiarizationConfig(
                segmentation = OfflineSpeakerSegmentationModelConfig(
                    pyannote = OfflineSpeakerSegmentationPyannoteModelConfig(model = paths.segmentation.absolutePath),
                    numThreads = threads,
                ),
                embedding = SpeakerEmbeddingExtractorConfig(model = paths.embedding.absolutePath, numThreads = threads),
                clustering = FastClusteringConfig(numClusters = numSpeakers ?: -1, threshold = 0.5f),
                minDurationOn = 0.2f,
                minDurationOff = 0.5f,
            )
            val sd = OfflineSpeakerDiarization(config = config)
            try {
                // 全体を一度にメモリへ載せる（1時間 ≒ 230MB の FloatArray）。largeHeap 前提。
                val samples = (source as? FilePcmSource)?.readAll() ?: source.read(0, source.totalSamples.toInt())
                currentCoroutineContext().ensureActive()
                val segments = sd.processWithCallback(samples, { done, total, _ ->
                    onProgress(if (total > 0) done.toFloat() / total else 0f)
                    0
                })
                return segments.map { SpeakerTurn(it.start.toDouble(), it.end.toDouble(), it.speaker) }
            } finally {
                sd.release()
            }
        }
    }

    override fun close() {
        recognizer?.release()
        recognizer = null
    }
}
