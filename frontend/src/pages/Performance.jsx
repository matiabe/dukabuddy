import { useEffect, useState } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { api, ksh, when } from '../api.js'
import { Alert, Card, PageHeader } from '../components/ui.jsx'

export const CLASS_STYLES = {
  'Top performer': 'bg-emerald-100 text-emerald-800',
  Steady: 'bg-blue-100 text-blue-700',
  New: 'bg-violet-100 text-violet-700',
  'Slow mover': 'bg-amber-100 text-amber-800',
  'Dead stock': 'bg-red-100 text-red-700',
  'No stock, no sales': 'bg-slate-100 text-slate-600',
}
const CLASS_HELP = {
  'Top performer': 'Top 20% of products by revenue',
  Steady: 'Selling at a healthy rate',
  New: 'Recently added - needs owner verification before restocking',
  'Slow mover': 'Too much stock for how fast it sells',
  'Dead stock': 'In stock but no sale for a long time',
  'No stock, no sales': 'Out of stock and not selling',
}

export function ClassBadge({ value }) {
  return <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${CLASS_STYLES[value]}`}>{value}</span>
}

export default function Performance({ navigate }) {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    api.performance(days).then(setData).catch((e) => setError(e.message))
  }, [days])

  const rows = data?.products.filter((p) => !filter || p.classification === filter) || []

  return (
    <>
      <PageHeader
        title="Product Performance"
        subtitle={data ? `Ranked best to worst by revenue · ${data.window.start} to ${data.window.end}` : 'Tracked automatically from your sales'}
        action={
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            {[7, 30, 90].map((d) => (
              <button key={d} onClick={() => setDays(d)} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${days === d ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                {d} days
              </button>
            ))}
          </div>
        }
      />
      <Alert>{error}</Alert>
      {!data && !error && <p className="text-slate-500">Loading…</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {Object.keys(CLASS_STYLES).map((cls) => [cls, data.summary[cls] || 0]).map(([cls, n]) => (
              <button
                key={cls}
                onClick={() => setFilter(filter === cls ? '' : cls)}
                title={CLASS_HELP[cls]}
                className={`flex flex-col items-start rounded-2xl border bg-white p-4 text-left shadow-sm transition ${filter === cls ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <ClassBadge value={cls} />
                <p className="mt-2 text-2xl font-bold text-slate-900">{n}</p>
                <p className="text-xs text-slate-400">{CLASS_HELP[cls]}</p>
              </button>
            ))}
          </div>

          {(data.dead_stock_value > 0 || data.slow_stock_value > 0) && (
            <Card className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-amber-200 bg-amber-50/60 p-4 text-sm">
              <span className="flex items-center gap-2 font-medium text-amber-900"><TrendingDown size={16} /> Money tied up in stock that isn't moving:</span>
              <span>Dead stock <b>{ksh(data.dead_stock_value)}</b></span>
              <span>Slow movers <b>{ksh(data.slow_stock_value)}</b></span>
              <span className="text-xs text-amber-800">Tip: discount or bundle these, and avoid re-ordering. Dead stock is never auto-reordered.</span>
            </Card>
          )}

          <Card className="mt-6">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="flex items-center gap-2 font-semibold text-slate-900"><TrendingUp size={18} className="text-emerald-600" /> Ranking {filter && <span className="text-sm font-normal text-slate-500">· {filter} only</span>}</h2>
              <button onClick={() => navigate('reports')} className="text-sm font-medium text-emerald-600 hover:underline">Download report →</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3">#</th>
                    <th className="whitespace-nowrap px-4 py-3">Product</th>
                    <th className="whitespace-nowrap px-4 py-3">Class</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Units sold</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Revenue</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">In stock</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Days of stock</th>
                    <th className="whitespace-nowrap px-4 py-3">Last sold</th>
                    <th className="whitespace-nowrap px-4 py-3">Insight</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3 font-semibold text-slate-400">{p.rank}</td>
                      <td className="min-w-52 px-4 py-3">
                        <p className="font-medium text-slate-800">{p.name}</p>
                        <p className="text-xs text-slate-400">{p.category} · in store {p.days_in_store} days</p>
                      </td>
                      <td className="px-4 py-3"><ClassBadge value={p.classification} /></td>
                      <td className="px-4 py-3 text-right">{p.units}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold">{ksh(p.revenue)}</td>
                      <td className="px-4 py-3 text-right">{p.quantity}</td>
                      <td className="px-4 py-3 text-right text-slate-500">{p.days_of_cover ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{when(p.last_sold_at)}</td>
                      <td className="min-w-56 px-4 py-3 text-xs text-slate-500">{p.insight}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  )
}
