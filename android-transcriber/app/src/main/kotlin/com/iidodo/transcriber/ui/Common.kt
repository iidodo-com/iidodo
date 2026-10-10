package com.iidodo.transcriber.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.iidodo.transcriber.core.TimeFormat

fun mmss(sec: Double): String = TimeFormat.hms(sec).removePrefix("00:")

/** 会議情報と話者分離オプションの入力ダイアログ。 */
@Composable
fun NewJobDialog(
    initialTitle: String,
    confirmLabel: String = "文字起こしを開始",
    onDismiss: () -> Unit,
    onConfirm: (NewJobInput) -> Unit,
) {
    var title by remember { mutableStateOf(initialTitle) }
    var attendees by remember { mutableStateOf("") }
    var diarize by remember { mutableStateOf(false) }
    var n by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("会議の情報") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(title, { title = it }, label = { Text("会議名") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(attendees, { attendees = it }, label = { Text("出席者（読点区切り）") }, modifier = Modifier.fillMaxWidth())
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Switch(diarize, { diarize = it })
                    Text("話者を分離する（時間がかかります）")
                }
                if (diarize) {
                    OutlinedTextField(
                        n, { n = it.filter(Char::isDigit).take(2) },
                        label = { Text("話者数（空欄なら自動推定）") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(NewJobInput(title, attendees, diarize, n.toIntOrNull()?.takeIf { it > 0 })) }) { Text(confirmLabel) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("キャンセル") } },
    )
}

@Composable
fun ConfirmDialog(title: String, message: String, confirmLabel: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(confirmLabel) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("キャンセル") } },
    )
}
