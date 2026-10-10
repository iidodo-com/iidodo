package com.iidodo.warikan

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.RadioGroup
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.widget.doAfterTextChanged
import com.google.android.material.textfield.TextInputEditText
import java.text.NumberFormat
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private var people = 2
    private lateinit var inputTotal: TextInputEditText
    private lateinit var textPeople: TextView
    private lateinit var textPerPerson: TextView
    private lateinit var textDetail: TextView
    private lateinit var groupUnit: RadioGroup
    private val fmt = NumberFormat.getIntegerInstance(Locale.JAPAN)
    private var shareText = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        inputTotal = findViewById(R.id.inputTotal)
        textPeople = findViewById(R.id.textPeople)
        textPerPerson = findViewById(R.id.textPerPerson)
        textDetail = findViewById(R.id.textDetail)
        groupUnit = findViewById(R.id.groupUnit)

        people = savedInstanceState?.getInt("people") ?: 2

        inputTotal.doAfterTextChanged { update() }
        groupUnit.setOnCheckedChangeListener { _, _ -> update() }
        findViewById<Button>(R.id.btnMinus).setOnClickListener {
            if (people > 1) { people--; update() }
        }
        findViewById<Button>(R.id.btnPlus).setOnClickListener {
            if (people < 99) { people++; update() }
        }
        findViewById<Button>(R.id.btnClear).setOnClickListener {
            inputTotal.setText("")
            people = 2
            update()
        }
        findViewById<Button>(R.id.btnShare).setOnClickListener {
            if (shareText.isNotEmpty()) {
                startActivity(
                    Intent.createChooser(
                        Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, shareText)
                        },
                        null,
                    ),
                )
            }
        }
        update()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putInt("people", people)
    }

    private fun selectedUnit(): Int = when (groupUnit.checkedRadioButtonId) {
        R.id.unit1 -> 1
        R.id.unit10 -> 10
        R.id.unit500 -> 500
        else -> 100
    }

    private fun update() {
        textPeople.text = people.toString()
        val total = inputTotal.text?.toString()?.toLongOrNull()
        if (total == null || total <= 0) {
            textPerPerson.text = "—"
            textDetail.text = ""
            shareText = ""
            return
        }
        val r = calcSplit(total, people, selectedUnit())
        textPerPerson.text = "${fmt.format(r.perPerson)}円"
        textDetail.text = buildString {
            append("合計 ${fmt.format(total)}円 ÷ ${people}人\n")
            append("集金額 ${fmt.format(r.collected)}円")
            if (r.surplus > 0) append("（幹事の余り ${fmt.format(r.surplus)}円）")
        }
        shareText = "合計${fmt.format(total)}円を${people}人で割り勘：" +
            "一人${fmt.format(r.perPerson)}円でお願いします！"
    }
}
