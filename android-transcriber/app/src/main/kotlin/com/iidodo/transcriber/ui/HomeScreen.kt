package com.iidodo.transcriber.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.iidodo.transcriber.App
import com.iidodo.transcriber.audio.RecPhase
import com.iidodo.transcriber.audio.RecordingController
import com.iidodo.transcriber.data.JobEntity
import com.iidodo.transcriber.data.JobStatus
import com.iidodo.transcriber.work.TranscribeService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(onRecord: () -> Unit, onOpen: (Long) -> Unit, onSettings: () -> Unit) {
    val ctx = LocalContext.current
    val app = App.instance
    val scope = rememberCoroutineScope()
    val jobs by app.db.dao().observeJobs().collectAsStateWithLifecycle(emptyList())
    val active by TranscribeService.active.collectAsStateWithLifecycle()
    val rec by RecordingController.state.collectAsStateWithLifecycle()
    var picked by remember { mutableStateOf<Uri?>(null) }
    var busy by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<JobEntity?>(null) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> picked = uri }
    val notif = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("議事録ボイス") },
                actions = { IconButton(onClick = onSettings) { Icon(Icons.Default.Settings, "設定") } },
            )
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            if (rec.phase != RecPhase.IDLE) {
                TextButton(onClick = onRecord, modifier = Modifier.fillMaxWidth()) { Text("● 録音中 ${mmss(rec.elapsedMs / 1000.0)} — 録音画面へ") }
            }
            Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(onClick = {
                    notif.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                    onRecord()
                }, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.Mic, null); Text(" 録音")
                }
                OutlinedButton(onClick = {
                    notif.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                    picker.launch(arrayOf("audio/*", "video/*"))
                }, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.FolderOpen, null); Text(" ファイル取込")
                }
            }
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 16.dp))
            if (jobs.isEmpty()) {
                Text(
                    "録音するか、音声ファイルを取り込むと、端末内だけで文字起こしします。",
                    modifier = Modifier.padding(16.dp), style = MaterialTheme.typography.bodyMedium,
                )
            }
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(jobs, key = { it.id }) { job ->
                    JobCard(job, running = active == job.id, onOpen = { onOpen(job.id) },
                        onResume = { TranscribeService.start(ctx, job.id) },
                        onCancel = { TranscribeService.cancel(ctx) },
                        onDelete = { deleting = job })
                }
            }
        }
    }

    picked?.let { uri ->
        NewJobDialog(
            initialTitle = "",
            onDismiss = { picked = null },
            onConfirm = { input ->
                picked = null
                busy = true
                scope.launch {
                    withContext(Dispatchers.IO) { runCatching { Actions.importUri(ctx, uri, input) } }
                    busy = false
                }
            },
        )
    }
    deleting?.let { job ->
        ConfirmDialog(
            "削除しますか？", "「${job.title}」の音声・文字起こし・修正履歴を端末から完全に削除します。", "削除",
            onDismiss = { deleting = null },
            onConfirm = {
                deleting = null
                scope.launch { withContext(Dispatchers.IO) { Actions.deleteJob(ctx, job.id) } }
            },
        )
    }
}

@Composable
private fun JobCard(job: JobEntity, running: Boolean, onOpen: () -> Unit, onResume: () -> Unit, onCancel: () -> Unit, onDelete: () -> Unit) {
    val date = SimpleDateFormat("yyyy/MM/dd HH:mm", Locale.JAPAN).format(Date(job.createdAt))
    Card(Modifier.fillMaxWidth().clickable(enabled = job.status == JobStatus.DONE, onClick = onOpen)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(job.title, style = MaterialTheme.typography.titleMedium)
            Text(
                buildString {
                    append(date)
                    if (job.durationSec > 0) append("  音声 ${mmss(job.durationSec)}")
                },
                style = MaterialTheme.typography.bodySmall,
            )
            when {
                running || job.status == JobStatus.RUNNING -> {
                    Text("${job.stage}  ${(job.progress * 100).toInt()}%", style = MaterialTheme.typography.bodyMedium)
                    LinearProgressIndicator(progress = { job.progress }, modifier = Modifier.fillMaxWidth())
                }
                job.status == JobStatus.DONE -> {
                    val speed = if (job.processingMs > 0 && job.durationSec > 0) {
                        // 実測: 音声の長さ ÷ 処理に要した合計時間（再開した場合は累計）
                        "  処理 ${mmss(job.processingMs / 1000.0)}（音声の %.1f 倍速）".format(Locale.JAPAN, job.durationSec * 1000 / job.processingMs)
                    } else ""
                    Text("完了$speed", style = MaterialTheme.typography.bodyMedium)
                }
                job.status == JobStatus.FAILED -> Text("失敗: ${job.error ?: ""}", color = MaterialTheme.colorScheme.error)
                job.status == JobStatus.CANCELED -> Text("中断（途中から再開できます） ${(job.progress * 100).toInt()}%")
                else -> Text("待機中")
            }
            Spacer(Modifier.height(2.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (job.status == JobStatus.DONE) TextButton(onClick = onOpen) { Text("開く") }
                if (running) TextButton(onClick = onCancel) { Text("中止") }
                else if (job.status != JobStatus.DONE) TextButton(onClick = onResume) { Text("再開") }
                TextButton(onClick = onDelete, enabled = !running) { Text("削除") }
            }
        }
    }
}
