package com.iidodo.warikan

import android.os.Bundle
import android.view.inputmethod.EditorInfo
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.ListView
import androidx.appcompat.app.AppCompatActivity

class ShoppingActivity : AppCompatActivity() {

    private lateinit var store: ShoppingStore
    private lateinit var items: MutableList<ShopItem>
    private lateinit var adapter: ArrayAdapter<String>
    private lateinit var list: ListView
    private lateinit var input: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_shopping)

        store = ShoppingStore(this)
        items = store.load()
        list = findViewById(R.id.listItems)
        input = findViewById(R.id.inputItem)

        adapter = ArrayAdapter(this, android.R.layout.simple_list_item_multiple_choice, mutableListOf())
        list.adapter = adapter
        list.choiceMode = ListView.CHOICE_MODE_MULTIPLE
        list.emptyView = findViewById(R.id.textEmpty)

        list.setOnItemClickListener { _, _, pos, _ ->
            items[pos].checked = list.isItemChecked(pos)
            store.save(items)
        }
        list.setOnItemLongClickListener { _, _, pos, _ ->
            items.removeAt(pos)
            store.save(items)
            refresh()
            true
        }

        findViewById<Button>(R.id.btnAdd).setOnClickListener { add() }
        input.setOnEditorActionListener { _, id, _ ->
            if (id == EditorInfo.IME_ACTION_DONE) { add(); true } else false
        }
        findViewById<Button>(R.id.btnClearChecked).setOnClickListener {
            items.removeAll { it.checked }
            store.save(items)
            refresh()
        }
        refresh()
    }

    private fun add() {
        val name = input.text.toString().trim()
        if (name.isEmpty()) return
        items.add(ShopItem(name))
        input.setText("")
        store.save(items)
        refresh()
    }

    private fun refresh() {
        adapter.clear()
        adapter.addAll(items.map { it.name })
        items.forEachIndexed { i, it -> list.setItemChecked(i, it.checked) }
    }
}
