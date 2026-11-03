import { useEffect, useState } from 'react'
import { PackagePlus, Sparkles } from 'lucide-react'
import { api, ksh, when } from '../api.js'
import { Alert, Button, Card, PageHeader, StockBadge } from '../components/ui.jsx'

export default function LowStock({ navigate }) {
  const [items, setItems] = useState(null)
  const [history, setHistory] = useState([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

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


  return (
    <>
      <PageHeader
        title="Restocking"
        subtitle="Products at or below their reorder level, with suggested order quantities."
        action={<Button onClick={() => navigate('assistant')}><Sparkles size={16} /> Get AI restock plan</Button>}
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-500">{when(r.created_at)}</td>
                  <td className="px-5 py-3 font-medium text-slate-800">{r.product_name}</td>
                  <td className="px-5 py-3 text-right">{r.quantity}</td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr><td colSpan={3} className="px-5 py-6 text-center text-slate-500">No restocks recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
