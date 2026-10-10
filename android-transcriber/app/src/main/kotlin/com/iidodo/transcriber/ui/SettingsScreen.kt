package com.iidodo.transcriber.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.iidodo.transcriber.App
import com.iidodo.transcriber.core.Glossary
import com.iidodo.transcriber.engine.ModelPaths
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(onBack: () -> Unit) {
    val ctx = LocalContext.current
    val app = App.instance
    val scope = rememberCoroutineScope()
    val paths = remember { ModelPaths(app.storage.modelsDir) }
    var refresh by remember { mutableIntStateOf(0) }
    val missingAsr = remember(refresh) { paths.missingAsr().map(paths::relative) }
    val missingDia = remember(refresh) { paths.missingDiarization().map(paths::relative) }
    var glossary by remember { mutableStateOf(runCatching { app.storage.glossaryFile.readText() }.getOrDefault(GLOSSARY_TEMPLATE)) }
    var status by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }

    val importGlossary = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            val text = withContext(Dispatchers.IO) { runCatching { ctx.contentResolver.openInputStream(uri)!!.use { it.readBytes().toString(Charsets.UTF_8) } }.getOrNull() }
            if (text == null) { status = "読み込めませんでした"; return@launch }
            val csv = if (text.trimStart().startsWith("[")) runCatching { Glossary.fromJson(text).toCsv() }.getOrNull() else text
            if (csv == null) status = "辞書の形式が不正です（CSV または JSON）" else { glossary = csv; status = "取り込みました（保存で確定）" }
        }
    }
    val exportGlossary = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) { uri ->
        if (uri != null) scope.launch {
            withContext(Dispatchers.IO) { ctx.contentResolver.openOutputStream(uri)?.use { it.write(glossary.toByteArray(Charsets.UTF_8)) } }
            status = "書き出しました"
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text("設定") }, navigationIcon = {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "戻る") }
        })
    }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("プライバシー", style = MaterialTheme.typography.titleMedium)
            Text("このアプリはインターネット通信の権限を持ちません。音声と文字起こしは端末内にだけ保存され、バックアップにも含まれません。")
            HorizontalDivider()

            Text("モデル", style = MaterialTheme.typography.titleMedium)
            Text(if (missingAsr.isEmpty()) "文字起こし用モデル: 配置済み" else "文字起こし用モデル: 未配置 ${missingAsr.joinToString()}")
            Text(if (missingDia.isEmpty()) "話者分離用モデル: 配置済み" else "話者分離用モデル: 未配置 ${missingDia.joinToString()}（話者分離を使う場合のみ必要）")
            Text("置き場所: ${app.storage.modelsDir.absolutePath}", style = MaterialTheme.typography.bodySmall)
            Text(ModelPaths.layoutHelp, style = MaterialTheme.typography.bodySmall)
            OutlinedButton(onClick = { refresh++ }) { Text("再確認") }
            HorizontalDivider()

            Text("用語辞書（CSV）", style = MaterialTheme.typography.titleMedium)
            Text("形式: canonical,variants,use_prompt 。variants は「|」区切りの表記ゆれ。文字起こし後に canonical へ置換します。", style = MaterialTheme.typography.bodySmall)
            OutlinedTextField(glossary, { glossary = it }, modifier = Modifier.fillMaxWidth().heightIn(min = 160.dp))
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {
                    scope.launch {
                        withContext(Dispatchers.IO) { app.storage.glossaryFile.writeText(glossary) }
                        status = "保存しました（${Glossary.fromCsv(glossary).entries.size} 件）"
                    }
                }) { Text("保存") }
                OutlinedButton(onClick = { importGlossary.launch(arrayOf("text/*", "application/json", "*/*")) }) { Text("CSV/JSON を取り込む") }
                OutlinedButton(onClick = { exportGlossary.launch("glossary.csv") }) { Text("CSV を書き出す") }
            }
            status?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
            HorizontalDivider()

            Text("データの削除", style = MaterialTheme.typography.titleMedium)
            Text("すべての音声・文字起こし・修正履歴・作業ファイルを削除します（用語辞書は残ります）。")
            Button(
                onClick = { confirmDelete = true },
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
            ) { Text("すべて削除") }
        }
    }

    if (confirmDelete) {
        ConfirmDialog(
            "すべて削除しますか？", "元に戻せません。音声ファイル・文字起こし・修正履歴をすべて消去します。", "削除する",
            onDismiss = { confirmDelete = false },
            onConfirm = {
                confirmDelete = false
                scope.launch {
                    withContext(Dispatchers.IO) { Actions.deleteAll(ctx) }
                    status = "すべて削除しました"
                }
            },
        )
    }
}

private const val GLOSSARY_TEMPLATE = "canonical,variants,use_prompt\n広島市,ひろしま市|広島氏,true\n"
