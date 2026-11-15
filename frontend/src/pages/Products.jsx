import { useEffect, useState } from 'react'
import { FileSpreadsheet, Plus, Search, Trash2, X } from 'lucide-react'
import { api, ksh, when } from '../api.js'
import { Alert, Button, Card, Field, PageHeader, StarRating, StockBadge, inputClass } from '../components/ui.jsx'
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
  const [reviewing, setReviewing] = useState(null)

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
                <th className="px-5 py-3">Rating</th>
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
                  <td className="whitespace-nowrap px-5 py-3">
                    <button onClick={() => setReviewing(p)} className="inline-flex items-center gap-1.5 rounded-lg px-1 py-0.5 hover:bg-slate-100"
                      title={p.review_count ? 'See and add reviews' : 'Rate this product'}>
                      <StarRating value={p.avg_rating || 0} size={14} />
                      <span className="text-xs text-slate-500">
                        {p.review_count ? `${p.avg_rating} (${p.review_count})` : 'Rate'}
                      </span>
                    </button>
                  </td>
                  <td className="px-5 py-3"><StockBadge product={p} /></td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => restock(p)} className="text-sm font-medium text-emerald-600 hover:underline">Restock</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={12} className="px-5 py-6 text-center text-slate-500">No products found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {reviewing && <ReviewsModal product={reviewing} onClose={() => setReviewing(null)} onChange={load} />}
    </>
  )
}

function ReviewsModal({ product, onClose, onChange }) {
  const [data, setData] = useState(null)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () =>
    api.reviews(product.id).then((d) => {
      setData(d)
      setRating(d.mine?.rating || 0)
      setComment(d.mine?.comment || '')
    }).catch((e) => setError(e.message))
  useEffect(() => { load() }, [product.id])

  const save = async (e) => {
    e.preventDefault()
    if (!rating) return setError('Tap a star to choose your rating.')
    setError('')
    setSaving(true)
    try {
      await api.saveReview(product.id, rating, comment)
      await load()
      onChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (r) => {
    if (!window.confirm(r.mine ? 'Delete your review?' : `Delete ${r.user_name}'s review?`)) return
    try {
      await api.deleteReview(r.id)
      await load()
      onChange()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-3">
          <div>
            <p className="font-semibold text-slate-900">{product.name}</p>
            {data && (
              <p className="mt-0.5 flex items-center gap-2 text-sm text-slate-500">
                <StarRating value={data.avg_rating || 0} size={14} />
                {data.review_count ? `${data.avg_rating} from ${data.review_count} review${data.review_count > 1 ? 's' : ''}` : 'No reviews yet'}
              </p>
            )}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
        </div>

        <form onSubmit={save} className="space-y-3 border-b border-slate-100 px-5 py-4">
          <p className="text-sm font-medium text-slate-700">{data?.mine ? 'Your review' : 'Rate this product'}</p>
          <StarRating value={rating} onChange={setRating} size={28} />
          <textarea className={inputClass} rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder="Comment (optional), e.g. customers love the battery life" />
          <Alert>{error}</Alert>
          <Button type="submit" disabled={saving || !data}>{saving ? 'Saving…' : data?.mine ? 'Update review' : 'Save review'}</Button>
        </form>

        <div className="flex-1 divide-y divide-slate-100 overflow-y-auto">
          {data?.reviews.map((r) => (
            <div key={r.id} className="flex items-start justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <StarRating value={r.rating} size={13} />
                  <span className="text-sm font-medium text-slate-800">{r.mine ? 'You' : r.user_name}</span>
                  <span className="text-xs text-slate-400">{when(r.updated_at)}</span>
                </div>
                {r.comment && <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-600">{r.comment}</p>}
              </div>
              {r.can_delete && (
                <button onClick={() => remove(r)} className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Delete review">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
          {data && data.reviews.length === 0 && (
            <p className="px-5 py-6 text-center text-sm text-slate-500">Be the first to rate this product.</p>
          )}
        </div>
      </div>
    </div>
  )
}
