import { useEffect, useMemo, useState } from 'react'
import { Boxes, PackageX, RefreshCw, Search, ShoppingBag, Wallet } from 'lucide-react'
import { api, isoDate, ksh } from '../api.js'
import { useAuth } from '../auth.jsx'
import { Alert, Button, Card, Field, PageHeader, inputClass } from '../components/ui.jsx'

const monthStart = () => `${isoDate(0).slice(0, 8)}01`
const PRESETS = [
  { label: 'Today', from: () => isoDate(0), to: () => isoDate(0) },
  { label: 'Yesterday', from: () => isoDate(-1), to: () => isoDate(-1) },
  { label: 'Last 7 days', from: () => isoDate(-6), to: () => isoDate(0) },
  { label: 'This month', from: monthStart, to: () => isoDate(0) },
]
const nice = (d) => new Date(`${d}T00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })

// Shop overview for everyone: what was sold (and for how much) in a period, and the stock on hand now.
export default function Overview({ navigate }) {
  const { shopName, isOwner } = useAuth()
  const [from, setFrom] = useState(isoDate(0))
  const [to, setTo] = useState(isoDate(0))
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [stockQuery, setStockQuery] = useState('')
  const [stockFilter, setStockFilter] = useState('all')

  const load = () => {
    if (!from || !to || to < from) return
    setError('')
    api.overview(from, to).then(setData).catch((e) => setError(e.message))
  }
  useEffect(load, [from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  const stockItems = useMemo(() => {
    if (!data) return []
    const q = stockQuery.toLowerCase()
    return data.stock.items.filter((p) =>
      `${p.name} ${p.category}`.toLowerCase().includes(q)
      && (stockFilter === 'all' || (stockFilter === 'in' ? p.quantity > 0 : p.quantity === 0)))
  }, [data, stockQuery, stockFilter])

  const s = data?.sales
  const st = data?.stock
  const periodLabel = data && (from === to ? (from === data.period.today ? 'Today' : nice(from)) : `${nice(from)} – ${nice(to)}`)
  const cards = data && [
    { label: `Sales · ${periodLabel}`, value: ksh(s.revenue), sub: `${s.count} receipt(s) · ${s.items} item(s) sold`, icon: Wallet, color: 'bg-emerald-100 text-emerald-600' },
    { label: 'Items sold', value: s.items.toLocaleString(), sub: `${data.sold_items.length} different product(s)`, icon: ShoppingBag, color: 'bg-sky-100 text-sky-600' },
    {
      label: 'Stock value now', value: ksh(st.retail_value),
      sub: `${st.units.toLocaleString()} units · at selling price${isOwner ? ` · cost ${ksh(st.stock_cost_value)}` : ''}`,
      icon: Boxes, color: 'bg-violet-100 text-violet-600',
    },
    { label: 'Out of stock', value: st.out_of_stock, sub: `${st.low} at or below reorder level · ${st.products} products`, icon: PackageX, color: 'bg-amber-100 text-amber-600' },
  ]
  const stockTotal = stockItems.reduce((n, p) => n + p.value, 0)
  const stockUnits = stockItems.reduce((n, p) => n + p.quantity, 0)

  return (
    <>
      <PageHeader
        title={shopName}
        subtitle="Sales and stock at a glance"
        action={<Button variant="ghost" onClick={load}><RefreshCw size={16} /> Refresh</Button>}
      />

      <Card className="mb-6 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => { setFrom(p.from()); setTo(p.to()) }}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium ${from === p.from() && to === p.to() ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="From"><input type="date" className={inputClass} value={from} max={isoDate(0)} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><input type="date" className={inputClass} value={to} max={isoDate(0)} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
        </div>
        {to < from && <p className="mt-2 text-xs text-red-600">"To" must be on or after "From".</p>}
      </Card>

      <Alert>{error}</Alert>
      {!data && !error && <p className="text-slate-500">Loading…</p>}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map(({ label, value, sub, icon: Icon, color }) => (
              <Card key={label} className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-500">{label}</p>
                    <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
                    <p className="mt-1 text-xs text-slate-400">{sub}</p>
                  </div>
                  <div className={`shrink-0 rounded-xl p-2.5 ${color}`}><Icon size={22} /></div>
                </div>
              </Card>
            ))}
          </div>

          {(s.price_cuts > 0 || s.points_discounts > 0) && (
            <p className="mt-3 text-sm text-slate-500">
              Marked price of goods sold: {ksh(s.marked)}
              {s.price_cuts > 0 && <> · agreed price reductions: <b className="text-amber-700">−{ksh(s.price_cuts)}</b></>}
              {s.points_discounts > 0 && <> · loyalty points used: −{ksh(s.points_discounts)}</>}
            </p>
          )}

          <div className="mt-6 grid gap-6 xl:grid-cols-5">
            <Card className="xl:col-span-3">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <h2 className="font-semibold text-slate-900">What was sold · {periodLabel}</h2>
                <button onClick={() => navigate('history')} className="text-sm font-medium text-emerald-600 hover:underline">Receipts →</button>
              </div>
              {data.sold_items.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">Nothing sold in this period.</p>
              ) : (
                <div className="max-h-[28rem] overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                      <tr><th className="px-5 py-2">Product</th><th className="px-3 py-2 text-right">Qty</th><th className="px-5 py-2 text-right">Amount</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.sold_items.map((r) => (
                        <tr key={r.id}>
                          <td className="px-5 py-2.5">
                            <p className="font-medium text-slate-800">{r.name}</p>
                            <p className="text-xs text-slate-400">{r.category} · {r.stock_left} left</p>
                          </td>
                          <td className="px-3 py-2.5 text-right">{r.quantity}</td>
                          <td className="px-5 py-2.5 text-right font-semibold">{ksh(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="sticky bottom-0 bg-slate-50 font-bold text-slate-900">
                      <tr><td className="px-5 py-2.5">Total</td><td className="px-3 py-2.5 text-right">{s.items}</td><td className="px-5 py-2.5 text-right">{ksh(s.revenue)}</td></tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Card>

            <div className="space-y-6 xl:col-span-2">
              <Breakdown title="By payment method" rows={s.by_payment.map((r) => [r.method, r.count, r.amount])} />
              <Breakdown title="By staff" rows={s.by_staff.map((r) => [r.name, r.count, r.amount])} />
            </div>
          </div>

          <Card className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="font-semibold text-slate-900">Current stock</h2>
                <p className="text-xs text-slate-400">{stockItems.length} product(s) · {stockUnits.toLocaleString()} units · {ksh(stockTotal)} at selling price</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <select className={`${inputClass} w-auto`} value={stockFilter} onChange={(e) => setStockFilter(e.target.value)}>
                  <option value="all">All products</option>
                  <option value="in">In stock</option>
                  <option value="out">Out of stock</option>
                </select>
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input className={`${inputClass} pl-9`} placeholder="Search stock…" value={stockQuery} onChange={(e) => setStockQuery(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-2">Product</th><th className="px-3 py-2 text-right">Qty</th>
                    <th className="hidden px-3 py-2 text-right sm:table-cell">Price</th><th className="px-5 py-2 text-right">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stockItems.map((p) => (
                    <tr key={p.id}>
                      <td className="px-5 py-2.5">
                        <p className="font-medium text-slate-800">{p.name}</p>
                        <p className="text-xs text-slate-400">{p.category}<span className="sm:hidden"> · {ksh(p.selling_price)} each</span></p>
                      </td>
                      <td className={`px-3 py-2.5 text-right font-medium ${p.quantity === 0 ? 'text-red-600' : p.low ? 'text-amber-600' : ''}`}>{p.quantity}</td>
                      <td className="hidden px-3 py-2.5 text-right text-slate-600 sm:table-cell">{ksh(p.selling_price)}</td>
                      <td className="px-5 py-2.5 text-right font-semibold">{ksh(p.value)}</td>
                    </tr>
                  ))}
                  {stockItems.length === 0 && <tr><td colSpan={4} className="px-5 py-6 text-center text-slate-500">No products match.</td></tr>}
                </tbody>
                <tfoot className="sticky bottom-0 bg-slate-50 font-bold text-slate-900">
                  <tr>
                    <td className="px-5 py-2.5">Total</td><td className="px-3 py-2.5 text-right">{stockUnits.toLocaleString()}</td>
                    <td className="hidden sm:table-cell" /><td className="px-5 py-2.5 text-right">{ksh(stockTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  )
}

function Breakdown({ title, rows }) {
  return (
    <Card>
      <h2 className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-900">{title}</h2>
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-500">No sales.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map(([name, count, amount]) => (
            <li key={name} className="flex items-center justify-between px-5 py-2.5 text-sm">
              <span className="font-medium text-slate-800">{name} <span className="text-xs font-normal text-slate-400">· {count} sale(s)</span></span>
              <span className="font-semibold">{ksh(amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
