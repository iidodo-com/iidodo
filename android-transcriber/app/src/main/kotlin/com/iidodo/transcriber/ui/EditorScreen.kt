package com.iidodo.transcriber.ui

import android.media.MediaPlayer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import com.iidodo.transcriber.core.ExportFormat
import com.iidodo.transcriber.core.Granularity
import com.iidodo.transcriber.data.EditEntity
import com.iidodo.transcriber.data.SegmentEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private fun speakerLabel(id: Int?, names: Map<Int, String>): String =
    if (id == null) "—" else names[id]?.takeIf { it.isNotBlank() } ?: "話者${id + 1}"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditorScreen(jobId: Long, onBack: () -> Unit) {
    val ctx = LocalContext.current
    val app = App.instance
    val dao = app.db.dao()
    val scope = rememberCoroutineScope()
    val job by dao.observeJob(jobId).collectAsStateWithLifecycle(null)
    val segments by dao.observeSegments(jobId).collectAsStateWithLifecycle(emptyList())
    val speakerRows by dao.observeSpeakers(jobId).collectAsStateWithLifecycle(emptyList())
    val edits by dao.observeEdits(jobId).collectAsStateWithLifecycle(emptyList())
    val names = remember(speakerRows) { speakerRows.associate { it.speakerId to it.name } }

    // --- 再生 ---
    val player = remember { MediaPlayer() }
    var ready by remember { mutableStateOf(false) }
    var playing by remember { mutableStateOf(false) }
    var posMs by remember { mutableIntStateOf(0) }
    var durMs by remember { mutableIntStateOf(1) }
    DisposableEffect(Unit) { onDispose { runCatching { player.release() } } }
    LaunchedEffect(job?.audioPath) {
        val path = job?.audioPath ?: return@LaunchedEffect
        runCatching {
            player.reset(); player.setDataSource(path); player.prepare()
            durMs = player.duration.coerceAtLeast(1); ready = true
            player.setOnCompletionListener { playing = false }
        }
    }
    LaunchedEffect(ready) {
        while (true) { if (ready && playing) posMs = player.currentPosition; delay(150) }
    }
    fun seekTo(sec: Double, play: Boolean = true) {
        if (!ready) return
        player.seekTo((sec * 1000).toInt()); posMs = (sec * 1000).toInt()
        if (play) { player.start(); playing = true }
    }
    val currentIdx = segments.indexOfLast { it.start * 1000 <= posMs }
    val listState = rememberLazyListState()
    var follow by remember { mutableStateOf(true) }
    LaunchedEffect(currentIdx, playing) { if (playing && follow && currentIdx >= 0) listState.animateScrollToItem(currentIdx) }

    // --- ダイアログ状態 ---
    var menu by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<SegmentEntity?>(null) }
    var assigning by remember { mutableStateOf<SegmentEntity?>(null) }
    var showSpeakers by remember { mutableStateOf(false) }
    var showHistory by remember { mutableStateOf(false) }
    var showExport by remember { mutableStateOf(false) }
    var showReprocess by remember { mutableStateOf(false) }
    var showInfo by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var pendingExport by remember { mutableStateOf<Pair<ExportFormat, Granularity>?>(null) }

    val saver = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { uri ->
        val j = job; val spec = pendingExport
        if (uri != null && j != null && spec != null) {
            scope.launch {
                val ok = withContext(Dispatchers.IO) {
                    runCatching {
                        val bytes = Actions.export(app, j, spec.first, spec.second)
                        ctx.contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }
                    }.isSuccess
                }
                message = if (ok) "保存しました" else "保存に失敗しました"
            }
        }
        pendingExport = null
    }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(job?.title ?: "", maxLines = 1) },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "戻る") } },
            actions = {
                IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "メニュー") }
                DropdownMenu(menu, { menu = false }) {
                    DropdownMenuItem({ Text("話者名の一括変更") }, onClick = { menu = false; showSpeakers = true })
                    DropdownMenuItem({ Text("書き出し…") }, onClick = { menu = false; showExport = true })
                    DropdownMenuItem({ Text("会議情報の編集") }, onClick = { menu = false; showInfo = true })
                    DropdownMenuItem({ Text("用語辞書を再適用") }, onClick = {
                        menu = false
                        scope.launch {
                            val n = withContext(Dispatchers.IO) { Actions.reapplyGlossary(ctx, jobId) }
                            message = "${n} 件に辞書を再適用しました（手修正済みは対象外）"
                        }
                    })
                    DropdownMenuItem({ Text("修正履歴") }, onClick = { menu = false; showHistory = true })
                    DropdownMenuItem({ Text("再処理（話者分離の切替など）") }, onClick = { menu = false; showReprocess = true })
                }
            },
        )
    }, bottomBar = {
        Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant).padding(horizontal = 8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = {
                    if (!ready) return@IconButton
                    if (playing) { player.pause(); playing = false } else { player.start(); playing = true }
                }) { Icon(if (playing) Icons.Default.Pause else Icons.Default.PlayArrow, "再生/一時停止") }
                Slider(
                    value = posMs.toFloat(), onValueChange = { posMs = it.toInt(); if (ready) player.seekTo(it.toInt()) },
                    valueRange = 0f..durMs.toFloat(), modifier = Modifier.weight(1f),
                )
                Text("${mmss(posMs / 1000.0)} / ${mmss(durMs / 1000.0)}", style = MaterialTheme.typography.labelSmall)
            }
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 12.dp, bottom = 4.dp)) {
                FilterChip(selected = follow, onClick = { follow = !follow }, label = { Text("再生に追従") })
                message?.let { Text("  $it", style = MaterialTheme.typography.labelMedium) }
            }
        }
    }) { pad ->
        if (segments.isEmpty()) {
            Text("文字起こし結果がありません（無音、または未処理）", Modifier.padding(pad).padding(16.dp))
        }
        LazyColumn(state = listState, modifier = Modifier.padding(pad).fillMaxSize()) {
            itemsIndexed(segments, key = { _, s -> s.idx }) { i, s ->
                val highlighted = i == currentIdx
                Row(
                    Modifier.fillMaxWidth()
                        .background(if (highlighted) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface)
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                ) {
                    Column(Modifier.width(76.dp)) {
                        Text(
                            mmss(s.start), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge,
                            modifier = Modifier.clickable { seekTo(s.start) },
                        )
                        Text(
                            speakerLabel(s.speakerId, names), style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.clickable { assigning = s },
                        )
                    }
                    Text(
                        s.text.ifBlank { "（空）" }, Modifier.weight(1f).clickable { editing = s },
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }
                HorizontalDivider()
            }
        }
    }

    // --- 本文の修正 ---
    editing?.let { seg ->
        var text by remember(seg.idx) { mutableStateOf(seg.text) }
        AlertDialog(
            onDismissRequest = { editing = null },
            title = { Text("テキストの修正  ${mmss(seg.start)}") },
            text = { OutlinedTextField(text, { text = it }, modifier = Modifier.fillMaxWidth()) },
            confirmButton = {
                TextButton(onClick = {
                    editing = null
                    if (text != seg.text) scope.launch { withContext(Dispatchers.IO) { dao.editText(jobId, seg.idx, seg.text, text, System.currentTimeMillis()) } }
                }) { Text("保存") }
            },
            dismissButton = {
                TextButton(onClick = {
                    seekTo(seg.start); editing = null
                }) { Text("この位置を再生") }
            },
        )
    }

    // --- 区間の話者を変更 ---
    assigning?.let { seg ->
        val ids = (segments.mapNotNull { it.speakerId } + (0..(segments.mapNotNull { it.speakerId }.maxOrNull() ?: -1) + 1)).distinct().sorted()
        AlertDialog(
            onDismissRequest = { assigning = null },
            title = { Text("この発言の話者") },
            text = {
                Column {
                    (listOf<Int?>(null) + ids).forEach { id ->
                        Row(Modifier.fillMaxWidth().clickable {
                            assigning = null
                            scope.launch {
                                withContext(Dispatchers.IO) {
                                    dao.updateSegmentSpeaker(jobId, seg.idx, id)
                                    dao.insertEdit(EditEntity(jobId = jobId, at = System.currentTimeMillis(), kind = "SPEAKER_ASSIGN",
                                        segmentIdx = seg.idx, oldValue = speakerLabel(seg.speakerId, names), newValue = speakerLabel(id, names)))
                                }
                            }
                        }, verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = id == seg.speakerId, onClick = null)
                            Text(speakerLabel(id, names), Modifier.padding(8.dp))
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { assigning = null }) { Text("閉じる") } },
        )
    }

    // --- 話者名の一括変更 ---
    if (showSpeakers) {
        val ids = segments.mapNotNull { it.speakerId }.distinct().sorted()
        val fields = remember(ids, names) { ids.associateWith { mutableStateOf(names[it] ?: "") } }
        AlertDialog(
            onDismissRequest = { showSpeakers = false },
            title = { Text("話者名の一括変更") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (ids.isEmpty()) Text("話者が割り当てられていません。「再処理」で話者分離を有効にできます。")
                    ids.forEach { id ->
                        val st = fields.getValue(id)
                        OutlinedTextField(st.value, { st.value = it }, label = { Text("話者${id + 1}") }, singleLine = true)
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    showSpeakers = false
                    scope.launch {
                        withContext(Dispatchers.IO) {
                            val now = System.currentTimeMillis()
                            ids.forEach { id ->
                                val new = fields.getValue(id).value.trim()
                                val old = names[id] ?: ""
                                if (new != old) dao.renameSpeaker(jobId, id, old.ifEmpty { "話者${id + 1}" }, new, now)
                            }
                        }
                    }
                }) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { showSpeakers = false }) { Text("キャンセル") } },
        )
    }

    // --- 修正履歴 ---
    if (showHistory) {
        val fmt = remember { SimpleDateFormat("MM/dd HH:mm", Locale.JAPAN) }
        AlertDialog(
            onDismissRequest = { showHistory = false },
            title = { Text("修正履歴") },
            text = {
                LazyColumn {
                    if (edits.isEmpty()) item { Text("まだ修正はありません") }
                    itemsIndexed(edits) { _, e ->
                        Column(Modifier.padding(vertical = 6.dp)) {
                            Text("${fmt.format(Date(e.at))}  ${kindLabel(e.kind)}", style = MaterialTheme.typography.labelMedium)
                            Text("前: ${e.oldValue}", style = MaterialTheme.typography.bodySmall)
                            Text("後: ${e.newValue}", style = MaterialTheme.typography.bodySmall)
                        }
                        HorizontalDivider()
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showHistory = false }) { Text("閉じる") } },
        )
    }

    // --- 書き出し ---
    if (showExport) {
        var fmt by remember { mutableStateOf(ExportFormat.DOCX) }
        var gran by remember { mutableStateOf(Granularity.SEGMENT) }
        AlertDialog(
            onDismissRequest = { showExport = false },
            title = { Text("書き出し") },
            text = {
                Column {
                    ExportFormat.entries.forEach { f ->
                        Row(Modifier.fillMaxWidth().clickable { fmt = f }, verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = fmt == f, onClick = { fmt = f }); Text(".${f.extension}")
                        }
                    }
                    if (fmt == ExportFormat.SRT || fmt == ExportFormat.VTT) {
                        Text("タイムスタンプ", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 8.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = gran == Granularity.SEGMENT, onClick = { gran = Granularity.SEGMENT }); Text("セグメント")
                            RadioButton(selected = gran == Granularity.WORD, onClick = { gran = Granularity.WORD }); Text("単語")
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    showExport = false
                    pendingExport = fmt to gran
                    saver.launch("${job?.title?.ifBlank { "議事録" } ?: "議事録"}.${fmt.extension}")
                }) { Text("保存先を選ぶ") }
            },
            dismissButton = { TextButton(onClick = { showExport = false }) { Text("キャンセル") } },
        )
    }

    // --- 会議情報 ---
    if (showInfo) {
        job?.let { j ->
            var title by remember { mutableStateOf(j.title) }
            var att by remember { mutableStateOf(j.attendees) }
            AlertDialog(
                onDismissRequest = { showInfo = false },
                title = { Text("会議情報") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(title, { title = it }, label = { Text("会議名") }, singleLine = true)
                        OutlinedTextField(att, { att = it }, label = { Text("出席者（読点区切り）") })
                    }
                },
                confirmButton = {
                    TextButton(onClick = {
                        showInfo = false
                        scope.launch { withContext(Dispatchers.IO) { dao.setInfo(jobId, title, att, j.meetingAt) } }
                    }) { Text("保存") }
                },
                dismissButton = { TextButton(onClick = { showInfo = false }) { Text("キャンセル") } },
            )
        }
    }

    // --- 再処理 ---
    if (showReprocess) {
        job?.let { j ->
            ReprocessDialog(
                j.diarize, j.numSpeakers,
                onDismiss = { showReprocess = false },
                onConfirm = { d, n ->
                    showReprocess = false
                    scope.launch { withContext(Dispatchers.IO) { Actions.reprocess(ctx, jobId, d, n) } }
                    onBack()
                },
            )
        }
    }
}

private fun kindLabel(kind: String) = when (kind) {
    "TEXT" -> "本文修正"
    "SPEAKER_NAME" -> "話者名"
    "SPEAKER_ASSIGN" -> "話者の付け替え"
    else -> kind
}

