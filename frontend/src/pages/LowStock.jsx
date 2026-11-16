import { useEffect, useState } from 'react'
import { PackagePlus, Pencil, Printer, Sparkles, Undo2, X } from 'lucide-react'
import { api, when } from '../api.js'
import { Alert, Button, Card, Field, inputClass, PageHeader, StockBadge } from '../components/ui.jsx'

export default function LowStock({ navigate }) {
  const [items, setItems] = useState(null)
  const [history, setHistory] = useState([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [editing, setEditing] = useState(null)

  const load = () => {
    api.dashboard().then((d) => setItems(d.low_stock)).catch((e) => setError(e.message))
    api.restocks().then(setHistory).catch((e) => setError(e.message))
  }
  useEffect(load, [])

  const restock = async (p) => {
    const qty = window.prompt(`How many units of "${p.name}" did you buy?`, p.suggested_order)
    if (!qty) return
    setError('')
    setSuccess('')
    try {
      const updated = await api.restock(p.id, qty)
      setSuccess(`Restocked ${p.name}: now ${updated.quantity} in stock.`)
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const undo = async (r) => {
    if (!window.confirm(`Undo this restock? ${r.quantity} units will be taken back off "${r.product_name}".`)) return
    setError('')
    setSuccess('')
    try {
      const res = await api.deleteRestock(r.id)
      setSuccess(`Restock undone: ${res.product.name} now has ${res.product.quantity} in stock.`)
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const onEdited = (res) => {
    setEditing(null)
    setError('')
    setSuccess(`Restock corrected: ${res.product.name} now has ${res.product.quantity} in stock.`)
    load()
  }

  const outOfStock = items?.filter((p) => p.quantity <= 0) ?? []
  const lowStock = items?.filter((p) => p.quantity > 0) ?? []

  return (
    <>
      <PrintSheet outOfStock={outOfStock} lowStock={lowStock} />
      <PageHeader
        title="Restocking"
        subtitle="Products at or below their reorder level, with suggested order quantities."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" disabled={!items?.length} onClick={() => window.print()}>
              <Printer size={16} /> Print list
            </Button>
            <Button onClick={() => navigate('assistant')}><Sparkles size={16} /> Get AI restock plan</Button>
          </div>
        }
      />
      <div className="mb-4 space-y-2">
        <Alert>{error}</Alert>
        <Alert type="success">{success}</Alert>
      </div>

      {items && items.length > 0 && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-2 p-4">
          <p className="text-sm text-slate-600">
            <span className="font-semibold text-slate-900">{items.length} products</span> need restocking
          </p>
        </Card>
      )}

      {items && items.length === 0 && (
        <Card className="mb-6 p-8 text-center text-slate-500">Everything is well stocked. 🎉</Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items?.map((p) => {
          const pct = Math.min(100, Math.round((p.quantity / Math.max(p.reorder_level, 1)) * 100))
          return (
            <Card key={p.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">{p.name}</p>
                  <p className="text-xs text-slate-400">{p.category}</p>
                </div>
                <StockBadge product={p} />
              </div>
              <div className="mt-4 flex items-end justify-between text-sm">
                <span><span className="text-2xl font-bold text-slate-900">{p.quantity}</span> <span className="text-slate-500">left</span></span>
                <span className="text-slate-500">Reorder at {p.reorder_level}</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-slate-100">
                <div className={`h-2 rounded-full ${p.quantity === 0 ? 'bg-red-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-y-1 text-xs">
                <dt className="text-slate-500">Sold (7 days)</dt><dd className="text-right font-medium">{p.units_sold_7d} units</dd>
                <dt className="text-slate-500">Last sold</dt><dd className="text-right font-medium">{when(p.last_sold_at)}</dd>
                <dt className="text-slate-500">Last restocked</dt><dd className="text-right font-medium">{when(p.last_restocked_at)}</dd>
                <dt className="text-slate-500">Suggested order</dt>
                <dd className="text-right font-semibold text-emerald-700">{p.suggested_order} units</dd>
              </dl>
              <Button className="mt-4 w-full" onClick={() => restock(p)}>
                <PackagePlus size={16} /> Mark as restocked
              </Button>
            </Card>
          )
        })}
      </div>

      <Card className="mt-6">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-900">Restock history</h2>
          <p className="text-xs text-slate-400">Every time you buy stock for the shop</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Product</th>
                <th className="px-5 py-3 text-right">Qty bought</th>
                <th className="px-5 py-3 text-right">Fix a mistake</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-500">{when(r.created_at)}</td>
                  <td className="px-5 py-3 font-medium text-slate-800">{r.product_name}</td>
                  <td className="px-5 py-3 text-right">{r.quantity}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-right">
                    <button onClick={() => setEditing(r)} title="Edit product or quantity"
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
                      <Pencil size={13} /> Edit
                    </button>
                    <button onClick={() => undo(r)} title="This restock never happened"
                      className="ml-1 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50">
                      <Undo2 size={13} /> Undo
                    </button>
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-6 text-center text-slate-500">No restocks recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      {editing && <EditRestockModal restock={editing} onClose={() => setEditing(null)} onSaved={onEdited} />}
    </>
  )
}

// Fix a restock entered against the wrong product or with the wrong quantity
function EditRestockModal({ restock, onClose, onSaved }) {
  const [products, setProducts] = useState([])
  const [productId, setProductId] = useState(String(restock.product_id))
  const [quantity, setQuantity] = useState(String(restock.quantity))
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { api.products().then(setProducts).catch((e) => setError(e.message)) }, [])

  const term = search.trim().toLowerCase()
  const shown = products.filter((p) => !term || p.name.toLowerCase().includes(term) || String(p.id) === productId)

  const save = async (e) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      onSaved(await api.editRestock(restock.id, Number(productId), Number(quantity)))
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={saving ? undefined : onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-3">
          <div>
            <p className="font-semibold text-slate-900">Edit restock</p>
            <p className="text-xs text-slate-500">
              Recorded {when(restock.created_at)}: {restock.quantity} × {restock.product_name}
            </p>
          </div>
          <button onClick={onClose} disabled={saving} className="rounded-lg p-1 hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
        </div>
        <form onSubmit={save} className="space-y-3 px-5 py-4">
          <Field label="Product">
            <input className={`${inputClass} mb-2`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products…" />
            <select className={inputClass} value={productId} onChange={(e) => setProductId(e.target.value)} required>
              {shown.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.quantity} in stock)</option>)}
            </select>
          </Field>
          <Field label="Quantity bought">
            <input type="number" min="1" step="1" className={inputClass} value={quantity}
              onChange={(e) => setQuantity(e.target.value)} required />
          </Field>
          <p className="text-xs text-slate-500">
            Stock is corrected automatically: the {restock.quantity} units come off {restock.product_name} and the new
            quantity is added to the product you choose.
          </p>
          <Alert>{error}</Alert>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving || !products.length}>{saving ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Shown only when printing (Print list button): out-of-stock and low-stock products as a shopping list.
function PrintSheet({ outOfStock, lowStock }) {
  const printed = new Date().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })
  return (
    <div className="print-sheet hidden text-sm text-black">
      <h1 className="text-xl font-bold">NyamsComm - Restock list</h1>
      <p className="mb-4 text-xs">Printed {printed} · {outOfStock.length} out of stock · {lowStock.length} low stock</p>
      <PrintTable title="Out of stock" products={outOfStock} />
      <PrintTable title="Low stock" products={lowStock} />
    </div>
  )
}

function PrintTable({ title, products }) {
  return (
    <section className="mb-6">
      <h2 className="mb-1 text-base font-bold">{title} ({products.length})</h2>
      {products.length === 0 ? (
        <p className="text-xs">None.</p>
      ) : (
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr>
              {['#', 'Product', 'Category', 'In stock', 'Reorder at', 'Sold (7 days)', 'Suggested order', 'Bought'].map((h) => (
                <th key={h} className="border border-black px-2 py-1">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products.map((p, i) => (
              <tr key={p.id} className="break-inside-avoid">
                <td className="border border-black px-2 py-1">{i + 1}</td>
                <td className="border border-black px-2 py-1 font-medium">{p.name}</td>
                <td className="border border-black px-2 py-1">{p.category}</td>
                <td className="border border-black px-2 py-1 text-right">{p.quantity}</td>
                <td className="border border-black px-2 py-1 text-right">{p.reorder_level}</td>
                <td className="border border-black px-2 py-1 text-right">{p.units_sold_7d}</td>
                <td className="border border-black px-2 py-1 text-right">{p.suggested_order}</td>
                <td className="w-20 border border-black px-2 py-1"></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
