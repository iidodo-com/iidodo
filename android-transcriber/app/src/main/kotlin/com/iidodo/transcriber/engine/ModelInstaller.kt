package com.iidodo.transcriber.engine

import android.content.Context
import java.io.File

/** APK の assets/models に同梱されたモデルを、アプリ専用領域(modelsDir)へ展開する。既にあれば何もしない。 */
object ModelInstaller {
    @Synchronized
    fun ensure(context: Context, modelsDir: File): Int {
        var copied = 0
        fun walk(assetPath: String, dest: File) {
            val children = context.assets.list(assetPath).orEmpty()
            if (children.isEmpty()) {
                // ファイル
                val size = runCatching { context.assets.openFd(assetPath).use { it.length } }.getOrDefault(-1L)
                if (dest.isFile && (size < 0 || dest.length() == size)) return
                dest.parentFile?.mkdirs()
                val tmp = File(dest.path + ".part")
                context.assets.open(assetPath).use { i -> tmp.outputStream().use { i.copyTo(it, 256 * 1024) } }
                tmp.renameTo(dest)
                copied++
            } else {
                children.forEach { walk("$assetPath/$it", File(dest, it)) }
            }
        }
        runCatching { walk("models", modelsDir) }
        return copied
    }
}
