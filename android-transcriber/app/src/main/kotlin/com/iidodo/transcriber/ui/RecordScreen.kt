package com.iidodo.transcriber.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.iidodo.transcriber.App
import com.iidodo.transcriber.audio.RecPhase
import com.iidodo.transcriber.audio.RecordingController
import com.iidodo.transcriber.work.RecordingService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecordScreen(onBack: () -> Unit) {
    val ctx = LocalContext.current
    val state by RecordingController.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }
    var finished by remember { mutableStateOf<File?>(null) }

    fun startRecording() {
        runCatching {
            RecordingService.start(ctx)
            val f = File(App.instance.storage.workDir, "recording.tmp.wav")
            RecordingController.start(f)
        }.onFailure { error = "録音を開始できませんでした"; RecordingService.stop(ctx) }
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startRecording() else error = "マイクの許可が必要です"
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text("録音") }, navigationIcon = {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "戻る") }
        })
    }) { pad ->
        Column(
            Modifier.padding(pad).fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(mmss(state.elapsedMs / 1000.0), style = MaterialTheme.typography.displayMedium)
            LinearProgressIndicator(progress = { state.level }, modifier = Modifier.fillMaxWidth().height(12.dp))
            Text(
                when (state.phase) {
                    RecPhase.IDLE -> "待機中"
                    RecPhase.RECORDING -> "録音中（画面を消しても続きます）"
                    RecPhase.PAUSED -> "一時停止中"
                },
            )
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                when (state.phase) {
                    RecPhase.IDLE -> Button(onClick = {
                        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startRecording()
                        else permission.launch(Manifest.permission.RECORD_AUDIO)
                    }) { Icon(Icons.Default.Mic, null); Text(" 録音開始") }
                    RecPhase.RECORDING -> OutlinedButton(onClick = { RecordingController.pause() }) { Icon(Icons.Default.Pause, null); Text(" 一時停止") }
                    RecPhase.PAUSED -> OutlinedButton(onClick = { RecordingController.resume() }) { Icon(Icons.Default.PlayArrow, null); Text(" 再開") }
                }
                if (state.phase != RecPhase.IDLE) {
                    Button(onClick = {
                        scope.launch {
                            val f = withContext(Dispatchers.IO) { RecordingController.stop() }
                            RecordingService.stop(ctx)
                            finished = f
                        }
                    }) { Icon(Icons.Default.Stop, null); Text(" 停止して保存") }
                }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }

    finished?.let { wav ->
        NewJobDialog(
            initialTitle = "",
            onDismiss = {
                // 破棄: 一時ファイルを消す
                wav.delete(); finished = null
            },
            onConfirm = { input ->
                finished = null
                scope.launch { withContext(Dispatchers.IO) { runCatching { Actions.importRecording(ctx, wav, input) } } }
                onBack()
            },
        )
    }
}
