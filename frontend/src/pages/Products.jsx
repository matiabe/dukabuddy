import { useEffect, useState } from 'react'
import { FileSpreadsheet, Plus, Search, X } from 'lucide-react'
import { api, ksh, when } from '../api.js'
import { Alert, Button, Card, Field, PageHeader, StockBadge, inputClass } from '../components/ui.jsx'
import ImportProducts from '../components/ImportProducts.jsx'
import { useAuth } from '../auth.jsx'

const EMPTY = { name: '', category: '', selling_price: '', quantity: '', reorder_level: '' }

export default function Products() {
  const { isOwner } = useAuth()
  const [products, setProducts] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => api.products().then(setProducts).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setSaving(true)
    try {
      const p = await api.addProduct(form)
      setSuccess(`Added ${p.name}.`)
      setForm(EMPTY)
      setShowForm(false)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const restock = async (p) => {
    const qty = window.prompt(`How many units of "${p.name}" did you buy?`, p.suggested_order || '')
    if (!qty) return
    try {
      await api.restock(p.id, qty)
      setSuccess(`Restocked ${p.name} with ${qty} units.`)
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const filtered = products.filter((p) =>
    `${p.name} ${p.category}`.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <>
      <PageHeader
        title="Products"
        subtitle={`${products.length} products in stock list`}
        action={isOwner && (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setShowImport(!showImport); setShowForm(false) }}>
              {showImport ? <><X size={16} /> Close import</> : <><FileSpreadsheet size={16} /> Import from Excel</>}
            </Button>
            <Button onClick={() => { setShowForm(!showForm); setShowImport(false) }}>
              {showForm ? <><X size={16} /> Cancel</> : <><Plus size={16} /> Add product</>}
            </Button>
          </div>
        )}
      />

      <div className="mb-4 space-y-2">
        <Alert>{error}</Alert>
        <Alert type="success">{success}</Alert>
      </div>

      {showImport && (
        <ImportProducts onDone={(msg) => { setSuccess(msg); setError(''); setShowImport(false); load() }} />
      )}

      {showForm && (
        <Card className="mb-6 p-5">
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Product name">
              <input className={inputClass} value={form.name} onChange={set('name')} placeholder="e.g. Samsung Galaxy A15 128GB" required />
            </Field>
            <Field label="Category">
              <input className={inputClass} value={form.category} onChange={set('category')} placeholder="e.g. Phones" />
            </Field>
            <Field label="Selling price (KSh)">
              <input type="number" min="0" step="0.01" className={inputClass} value={form.selling_price} onChange={set('selling_price')} required />
            </Field>
            <Field label="Quantity in stock">
              <input type="number" min="0" className={inputClass} value={form.quantity} onChange={set('quantity')} required />
            </Field>
            <Field label="Reorder level">
              <input type="number" min="0" className={inputClass} value={form.reorder_level} onChange={set('reorder_level')} required />
            </Field>
            <div className="sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save product'}</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <div className="border-b border-slate-100 p-4">
          <div className="relative max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className={`${inputClass} pl-9`} placeholder="Search products…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Product</th>
                <th className="px-5 py-3">Category</th>
                <th className="px-5 py-3 text-right">Selling</th>
                <th className="px-5 py-3 text-right">Stock</th>
                <th className="px-5 py-3 text-right">Reorder at</th>
                <th className="px-5 py-3 text-right">Sales</th>
                <th className="px-5 py-3 text-right">Units sold</th>
                <th className="px-5 py-3">Last sold</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((p) => (
                <tr key={p.id} className={p.low_stock ? 'bg-amber-50/40' : ''}>
                  <td className="px-5 py-3 font-medium text-slate-800">{p.name}</td>
                  <td className="px-5 py-3 text-slate-500">{p.category}</td>
                  <td className="px-5 py-3 text-right">{ksh(p.selling_price)}</td>
                  <td className="px-5 py-3 text-right font-semibold">{p.quantity}</td>
                  <td className="px-5 py-3 text-right text-slate-500">{p.reorder_level}</td>
                  <td className="px-5 py-3 text-right">{p.sales_count}</td>
                  <td className="px-5 py-3 text-right">{p.units_sold}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-500">{when(p.last_sold_at)}</td>
                  <td className="px-5 py-3"><StockBadge product={p} /></td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => restock(p)} className="text-sm font-medium text-emerald-600 hover:underline">Restock</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={11} className="px-5 py-6 text-center text-slate-500">No products found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
