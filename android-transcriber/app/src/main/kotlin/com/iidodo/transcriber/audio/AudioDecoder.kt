package com.iidodo.transcriber.audio

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import com.iidodo.transcriber.core.AudioMath
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import java.io.BufferedOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * mp3 / m4a / wav / mp4 などを端末のコーデックで復号し、16kHz モノラル 16bit LE の生 PCM ファイルに書き出す。
 * 対応形式は端末の MediaCodec に依存する（ffmpeg は同梱しない）。
 */
object AudioDecoder {
    class UnsupportedAudioException(message: String) : Exception(message)

    /** @return 出力音声の長さ（秒）。 */
    suspend fun decodeToPcm16k(input: File, output: File, onProgress: (Float) -> Unit = {}): Double {
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        try {
            extractor.setDataSource(input.absolutePath)
            val trackIndex = (0 until extractor.trackCount).firstOrNull {
                extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            } ?: throw UnsupportedAudioException("no audio track")
            extractor.selectTrack(trackIndex)
            val format = extractor.getTrackFormat(trackIndex)
            val mime = format.getString(MediaFormat.KEY_MIME)!!
            val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L

            codec = MediaCodec.createDecoderByType(mime)
            codec.configure(format, null, null, 0)
            codec.start()

            var inRate = format.getIntegerOrDefault(MediaFormat.KEY_SAMPLE_RATE, 44100)
            var channels = format.getIntegerOrDefault(MediaFormat.KEY_CHANNEL_COUNT, 1)
            var floatPcm = false
            val resampler = LinearResampler()
            var outSamples = 0L

            BufferedOutputStream(output.outputStream(), 256 * 1024).use { out ->
                val info = MediaCodec.BufferInfo()
                var inputDone = false
                var outputDone = false
                val chunk = ByteArray(64 * 1024)
                var chunkLen = 0
                fun emit(v: Short) {
                    chunk[chunkLen++] = (v.toInt() and 0xFF).toByte()
                    chunk[chunkLen++] = (v.toInt() shr 8).toByte()
                    if (chunkLen == chunk.size) { out.write(chunk, 0, chunkLen); chunkLen = 0 }
                    outSamples++
                }
                while (!outputDone) {
                    currentCoroutineContext().ensureActive()
                    if (!inputDone) {
                        val i = codec.dequeueInputBuffer(10_000)
                        if (i >= 0) {
                            val buf = codec.getInputBuffer(i)!!
                            val n = extractor.readSampleData(buf, 0)
                            if (n < 0) {
                                codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                inputDone = true
                            } else {
                                codec.queueInputBuffer(i, 0, n, extractor.sampleTime, 0)
                                if (durationUs > 0) onProgress((extractor.sampleTime.toFloat() / durationUs).coerceIn(0f, 1f))
                                extractor.advance()
                            }
                        }
                    }
                    val o = codec.dequeueOutputBuffer(info, 10_000)
                    when {
                        o >= 0 -> {
                            val buf = codec.getOutputBuffer(o)!!.order(ByteOrder.LITTLE_ENDIAN)
                            buf.position(info.offset); buf.limit(info.offset + info.size)
                            val bytesPerSample = if (floatPcm) 4 else 2
                            val frames = info.size / (bytesPerSample * channels)
                            repeat(frames) {
                                var sum = 0f
                                repeat(channels) {
                                    sum += if (floatPcm) buf.float else buf.short / 32768f
                                }
                                resampler.push(sum / channels, inRate) { s ->
                                    emit((s.coerceIn(-1f, 1f) * 32767f).toInt().toShort())
                                }
                            }
                            codec.releaseOutputBuffer(o, false)
                            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                        }
                        o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            val f = codec.outputFormat
                            inRate = f.getIntegerOrDefault(MediaFormat.KEY_SAMPLE_RATE, inRate)
                            channels = f.getIntegerOrDefault(MediaFormat.KEY_CHANNEL_COUNT, channels)
                            floatPcm = f.getIntegerOrDefault(MediaFormat.KEY_PCM_ENCODING, 2) == 4 // ENCODING_PCM_FLOAT
                        }
                    }
                }
                if (chunkLen > 0) out.write(chunk, 0, chunkLen)
            }
            onProgress(1f)
            return outSamples.toDouble() / AudioMath.SAMPLE_RATE
        } finally {
            runCatching { codec?.stop() }
            runCatching { codec?.release() }
            extractor.release()
        }
    }

    private fun MediaFormat.getIntegerOrDefault(key: String, default: Int) =
        if (containsKey(key)) getInteger(key) else default

    /** ストリーミング線形補間リサンプラ（入力レート可変 → 16kHz）。音声認識用途なので簡易で十分。 */
    internal class LinearResampler(private val outRate: Int = AudioMath.SAMPLE_RATE) {
        private var prev = 0f
        private var pos = 0.0 // 入力サンプル上の次の出力位置（prev を 0 とする）
        private var first = true

        inline fun push(x: Float, inRate: Int, emit: (Float) -> Unit) {
            if (inRate == outRate) { emit(x); return }
            if (first) { prev = x; first = false; pos = 0.0 }
            val step = inRate.toDouble() / outRate
            // prev(位置0) と x(位置1) の間にある出力点を出す
            while (pos < 1.0) {
                emit((prev + (x - prev) * pos).toFloat())
                pos += step
            }
            pos -= 1.0
            prev = x
        }
    }
}
