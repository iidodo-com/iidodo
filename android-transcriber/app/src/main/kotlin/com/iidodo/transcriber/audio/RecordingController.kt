package com.iidodo.transcriber.audio

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import com.iidodo.transcriber.core.AudioMath
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

enum class RecPhase { IDLE, RECORDING, PAUSED }

data class RecState(val phase: RecPhase = RecPhase.IDLE, val elapsedMs: Long = 0, val level: Float = 0f)

/**
 * 16kHz モノラル 16bit の WAV へ録音する。一時停止中は AudioRecord を止める（マイク使用中表示も消える）。
 * 録音ファイルはそのまま再生・認識の入力になる（先頭 44 バイトが WAV ヘッダ）。
 * フォアグラウンドサービス（RecordingService）の起動は呼び出し側で行う。
 */
object RecordingController {
    private val _state = MutableStateFlow(RecState())
    val state: StateFlow<RecState> = _state.asStateFlow()

    private val lock = Object()
    private var thread: Thread? = null
    private var record: AudioRecord? = null
    private var target: File? = null

    @Volatile private var running = false
    @Volatile private var paused = false

    /** 録音開始。RECORD_AUDIO 権限が付与済みであること。 */
    @SuppressLint("MissingPermission")
    fun start(file: File) {
        synchronized(lock) {
            check(!running) { "already recording" }
            val sr = AudioMath.SAMPLE_RATE
            val minBuf = AudioRecord.getMinBufferSize(sr, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            check(minBuf > 0) { "AudioRecord not supported" }
            val rec = AudioRecord(
                MediaRecorder.AudioSource.MIC, sr, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuf, sr), // 約 0.5 秒
            )
            check(rec.state == AudioRecord.STATE_INITIALIZED) { "AudioRecord init failed" }
            record = rec
            target = file
            running = true
            paused = false
            rec.startRecording()
            _state.value = RecState(RecPhase.RECORDING)
            thread = Thread({ loop(rec, file) }, "recorder").also { it.start() }
        }
    }

    fun pause() {
        synchronized(lock) {
            if (!running || paused) return
            paused = true
            runCatching { record?.stop() }
            _state.update { it.copy(phase = RecPhase.PAUSED, level = 0f) }
        }
    }

    fun resume() {
        synchronized(lock) {
            if (!running || !paused) return
            runCatching { record?.startRecording() }
            paused = false
            _state.update { it.copy(phase = RecPhase.RECORDING) }
        }
    }

    /** 停止して WAV を確定する。 @return 録音ファイル（録音していなければ null）。 */
    fun stop(): File? {
        val t: Thread?
        val f: File?
        synchronized(lock) {
            if (!running) return null
            running = false
            t = thread
            f = target
        }
        t?.join(3000)
        synchronized(lock) {
            runCatching { record?.stop() }
            record?.release()
            record = null
            thread = null
            _state.value = RecState()
        }
        return f
    }

    private fun loop(rec: AudioRecord, file: File) {
        val sr = AudioMath.SAMPLE_RATE
        val buf = ShortArray(sr / 10) // 100ms
        val bytes = ByteBuffer.allocate(buf.size * 2).order(ByteOrder.LITTLE_ENDIAN)
        var written = 0L
        RandomAccessFile(file, "rw").use { out ->
            out.setLength(0)
            out.write(wavHeader(0))
            while (running) {
                if (paused) { Thread.sleep(50); continue }
                val n = rec.read(buf, 0, buf.size)
                if (n <= 0) { if (paused) continue else { Thread.sleep(10); continue } }
                bytes.clear()
                for (i in 0 until n) bytes.putShort(buf[i])
                out.write(bytes.array(), 0, n * 2)
                written += n
                val level = AudioMath.meterLevel(AudioMath.pcm16ToFloat(buf, n))
                _state.update { it.copy(elapsedMs = written * 1000 / sr, level = level) }
            }
            out.seek(0)
            out.write(wavHeader(written * 2))
        }
    }

    private fun wavHeader(dataBytes: Long): ByteArray {
        val sr = AudioMath.SAMPLE_RATE
        val b = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        b.put("RIFF".toByteArray()).putInt((36 + dataBytes).toInt()).put("WAVE".toByteArray())
        b.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(1).putInt(sr).putInt(sr * 2).putShort(2).putShort(16)
        b.put("data".toByteArray()).putInt(dataBytes.toInt())
        return b.array()
    }
}
