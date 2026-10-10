package com.iidodo.warikan

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class ShopItem(val name: String, var checked: Boolean = false)

/** 買い物リストを SharedPreferences に JSON で保存する。 */
class ShoppingStore(context: Context) {
    private val prefs = context.getSharedPreferences("shopping", Context.MODE_PRIVATE)

    fun load(): MutableList<ShopItem> {
        val json = prefs.getString("items", null) ?: return mutableListOf()
        return try {
            val arr = JSONArray(json)
            MutableList(arr.length()) {
                val o = arr.getJSONObject(it)
                ShopItem(o.getString("name"), o.optBoolean("checked"))
            }
        } catch (e: Exception) {
            mutableListOf()
        }
    }

    fun save(items: List<ShopItem>) {
        val arr = JSONArray()
        items.forEach {
            arr.put(JSONObject().put("name", it.name).put("checked", it.checked))
        }
        prefs.edit().putString("items", arr.toString()).apply()
    }
}
