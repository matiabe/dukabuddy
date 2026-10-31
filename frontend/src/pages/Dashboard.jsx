import { useEffect, useState } from 'react'
import { Boxes, Package, Receipt, RefreshCw, TriangleAlert, Wallet } from 'lucide-react'
import { api, ksh, when } from '../api.js'
import { Alert, Button, Card, PageHeader, StatusBadge, StockBadge, TierBadge } from '../components/ui.jsx'

export default function Dashboard({ navigate }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const load = () => {
    setError('')
    api.dashboard().then(setData).catch((e) => setError(e.message))
  }
  useEffect(load, [])

  const stats = data && [
    { label: 'Total Products', value: data.total_products, sub: 'items in catalogue', icon: Package, color: 'bg-blue-100 text-blue-600' },
    { label: "Today's Sales", value: ksh(data.today_sales), sub: `${data.today_transactions} sales · ${data.today_items} items`, icon: Wallet, color: 'bg-emerald-100 text-emerald-600' },
    { label: 'Inventory Value', value: ksh(data.inventory_value), sub: `Retail value ${ksh(data.inventory_retail_value)}`, icon: Boxes, color: 'bg-violet-100 text-violet-600' },
    { label: 'Total Sales', value: data.total_sales_count, sub: `${data.total_items_sold} items · ${ksh(data.total_revenue)} all time`, icon: Receipt, color: 'bg-sky-100 text-sky-600' },
    { label: 'Need Restocking', value: data.low_stock_count, sub: `≈ ${ksh(data.restock_budget)} to restock`, icon: TriangleAlert, color: 'bg-amber-100 text-amber-600' },
  ]

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={new Date().toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        action={<Button variant="ghost" onClick={load}><RefreshCw size={16} /> Refresh</Button>}
      />
      <Alert>{error && `Could not load dashboard: ${error}. Is the backend running?`}</Alert>

      {!data && !error && <p className="text-slate-500">Loading…</p>}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {stats.map(({ label, value, sub, icon: Icon, color }) => (
              <Card key={label} className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-500">{label}</p>
                    <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
                    <p className="mt-1 text-xs text-slate-400">{sub}</p>
                  </div>
                  <div className={`rounded-xl p-2.5 ${color}`}><Icon size={22} /></div>
                </div>
              </Card>
            ))}
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <Card>
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <h2 className="font-semibold text-slate-900">Low-stock products</h2>
                <button onClick={() => navigate('lowstock')} className="text-sm font-medium text-emerald-600 hover:underline">
                  View restock list →
                </button>
              </div>
              {data.low_stock.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">All products are well stocked. 🎉</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.low_stock.map((p) => (
                    <li key={p.id} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <p className="text-sm font-medium text-slate-800">{p.name}</p>
                        <p className="text-xs text-slate-400">{p.quantity} left · reorder at {p.reorder_level}</p>
                      </div>
                      <StockBadge product={p} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <h2 className="font-semibold text-slate-900">Recent sales</h2>
                <button onClick={() => navigate('history')} className="text-sm font-medium text-emerald-600 hover:underline">
                  All sales →
                </button>
              </div>
              {data.recent_sales.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">No sales recorded yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.recent_sales.map((s) => (
                    <li key={s.id} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <p className="max-w-64 truncate text-sm font-medium text-slate-800">{s.items.map((i) => `${i.quantity}× ${i.product_name}`).join(', ')}</p>
                        <p className="text-xs text-slate-400">{s.receipt_no} · {s.customer_name || 'Walk-in'} · {s.payment_method} · {when(s.created_at)}</p>
                      </div>
                      <span className="text-sm font-semibold text-slate-900">{ksh(s.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="font-semibold text-slate-900">Best sellers</h2>
              </div>
              {data.top_sellers.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">No sales recorded yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.top_sellers.map((t, i) => (
                    <li key={t.id} className="flex items-center gap-4 px-5 py-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-xs font-bold text-emerald-700">{i + 1}</span>
                      <span className="flex-1 text-sm font-medium text-slate-800">{t.name}</span>
                      <span className="text-xs text-slate-500">{t.sales_count} sales</span>
                      <span className="w-20 text-right text-sm font-semibold">{t.units_sold} units</span>
                      <span className="w-28 text-right text-sm text-slate-600">{ksh(t.revenue)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <h2 className="font-semibold text-slate-900">Top loyal customers</h2>
                  <p className="text-xs text-slate-400">
                    {data.total_customers} members · {data.points_outstanding.toLocaleString()} points outstanding
                    {data.at_risk_customers > 0 && <span className="text-red-500"> · {data.at_risk_customers} at risk</span>}
                  </p>
                </div>
                <button onClick={() => navigate('customers')} className="text-sm font-medium text-emerald-600 hover:underline">
                  View customers →
                </button>
              </div>
              {data.top_customers.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">No loyalty customers yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.top_customers.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-800">{c.name}</p>
                        <p className="text-xs text-slate-400">{c.visits} visits · {c.points} pts</p>
                      </div>
                      <StatusBadge status={c.status} />
                      <TierBadge tier={c.tier} />
                      <span className="w-24 text-right text-sm font-semibold">{ksh(c.total_spent)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  )
}
