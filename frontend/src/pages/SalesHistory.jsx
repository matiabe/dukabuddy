import { useEffect, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { api, isoDate, ksh, when } from '../api.js'
import ReceiptModal from '../components/Receipt.jsx'
import { Alert, Button, Card, PageHeader, inputClass } from '../components/ui.jsx'

const inlineInput = inputClass.replace('w-full', 'w-auto')

const RANGES = [
  { id: 'today', label: 'Today', from: () => isoDate(0) },
  { id: '7d', label: '7 days', from: () => isoDate(-6) },
  { id: '30d', label: '30 days', from: () => isoDate(-29) },
  { id: 'all', label: 'All time', from: () => '' },
]

export default function SalesHistory({ navigate }) {
  const [range, setRange] = useState('7d')
  const [from, setFrom] = useState(isoDate(-6))
  const [to, setTo] = useState('')
  const [payment, setPayment] = useState('')
  const [q, setQ] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => {
      api.transactions({ from, to, payment, q }).then(setData).catch((e) => setError(e.message))
    }, 250) // debounce search typing
    return () => clearTimeout(t)
  }, [from, to, payment, q])

  const pickRange = (r) => {
    setRange(r.id)
    setFrom(r.from())
    setTo('')
  }

  const s = data?.summary
  const tiles = s && [
    ['Sales', s.count.toLocaleString(), `${s.items} items sold`],
    ['Revenue', ksh(s.revenue), s.discounts ? `after ${ksh(s.discounts)} points discounts` : 'net of discounts'],
    ['Gross profit', ksh(s.profit), s.revenue ? `${Math.round((s.profit / s.revenue) * 100)}% margin` : '—'],
    ['Average sale', ksh(Math.round(s.avg_sale)), 'per receipt'],
    ['Loyalty sales', s.loyalty_sales, s.count ? `${Math.round((s.loyalty_sales / s.count) * 100)}% of receipts` : '—'],
  ]

  return (
    <>
      <PageHeader
        title="Sales History"
        subtitle="Every receipt, with totals for the selected period."
        action={<Button onClick={() => navigate('sales')}><Plus size={16} /> New sale</Button>}
      />

      {/* Filters: one row */}
      <Card className="mb-6 flex flex-wrap items-center gap-2 p-3">
        <div className="flex rounded-lg border border-slate-200 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => pickRange(r)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${range === r.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <input type="date" aria-label="From date" className={inlineInput} value={from} onChange={(e) => { setFrom(e.target.value); setRange('custom') }} />
        <span className="text-xs text-slate-400">to</span>
        <input type="date" aria-label="To date" className={inlineInput} value={to} onChange={(e) => { setTo(e.target.value); setRange('custom') }} />
        <select aria-label="Payment method" className={inlineInput} value={payment} onChange={(e) => setPayment(e.target.value)}>
          <option value="">All payments</option>
          {(data?.payment_methods || []).map((m) => <option key={m}>{m}</option>)}
        </select>
        <div className="relative min-w-48 flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputClass} pl-9`} placeholder="Receipt no., customer or product…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </Card>

      <Alert>{error}</Alert>
      {!data && !error && <p className="text-slate-500">Loading…</p>}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {tiles.map(([label, value, sub]) => (
              <Card key={label} className="p-4">
                <p className="text-xs font-medium text-slate-500">{label}</p>
                <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
                <p className="text-xs text-slate-400">{sub}</p>
              </Card>
            ))}
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-3">
            <Card className="p-5 xl:col-span-2">
              <h2 className="font-semibold text-slate-900">Daily revenue</h2>
              <p className="mb-4 text-xs text-slate-400">KSh per day · hover a day for details</p>
              <DailyChart days={data.daily} />
            </Card>
            <Card className="p-5">
              <h2 className="mb-3 font-semibold text-slate-900">By payment method</h2>
              {data.payments.length === 0 && <p className="text-sm text-slate-500">No sales.</p>}
              <ul className="space-y-2">
                {data.payments.map((p) => (
                  <li key={p.method} className="flex justify-between text-sm">
                    <span className="text-slate-700">{p.method} <span className="text-xs text-slate-400">· {p.count} sales</span></span>
                    <span className="font-semibold">{ksh(p.revenue)}</span>
                  </li>
                ))}
              </ul>
              <h2 className="mb-3 mt-6 font-semibold text-slate-900">Top products</h2>
              {data.top_products.length === 0 && <p className="text-sm text-slate-500">No sales.</p>}
              <ul className="space-y-2">
                {data.top_products.map((p, i) => (
                  <li key={p.name} className="flex justify-between gap-2 text-sm">
                    <span className="truncate text-slate-700">{i + 1}. {p.name}</span>
                    <span className="whitespace-nowrap text-slate-500">{p.units} units</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card className="mt-6">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold text-slate-900">Receipts</h2>
              <p className="text-xs text-slate-400">
                {data.transactions.length < s.count ? `Showing latest ${data.transactions.length} of ${s.count}` : `${s.count} receipts`} · click a row to view the receipt
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Receipt</th>
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3">Items</th>
                    <th className="px-5 py-3">Customer</th>
                    <th className="px-5 py-3">Payment</th>
                    <th className="px-5 py-3 text-right">Discount</th>
                    <th className="px-5 py-3 text-right">Total</th>
                    <th className="px-5 py-3 text-right">Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.transactions.map((t) => (
                    <tr key={t.id} onClick={() => setReceipt(t)} className="cursor-pointer hover:bg-slate-50">
                      <td className="whitespace-nowrap px-5 py-3 font-mono text-xs font-semibold text-slate-700">{t.receipt_no}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-slate-500">{when(t.created_at)}</td>
                      <td className="max-w-64 px-5 py-3">
                        <p className="truncate text-slate-800">{t.items.map((i) => `${i.quantity}× ${i.product_name}`).join(', ')}</p>
                        <p className="text-xs text-slate-400">{t.items_count} item(s)</p>
                      </td>
                      <td className="px-5 py-3 text-slate-500">
                        {t.customer_name || 'Walk-in'}
                        {t.points_earned > 0 && <span className="ml-1 text-xs text-emerald-700">+{t.points_earned} pts</span>}
                      </td>
                      <td className="px-5 py-3 text-slate-500">{t.payment_method}</td>
                      <td className="px-5 py-3 text-right text-slate-500">{t.discount ? ksh(t.discount) : '—'}</td>
                      <td className="px-5 py-3 text-right font-semibold">{ksh(t.total)}</td>
                      <td className="px-5 py-3 text-right text-slate-600">{ksh(t.profit)}</td>
                    </tr>
                  ))}
                  {data.transactions.length === 0 && (
                    <tr><td colSpan={8} className="px-5 py-6 text-center text-slate-500">No sales match these filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <ReceiptModal tx={receipt} onClose={() => setReceipt(null)} />
    </>
  )
}

// Fill in days with no sales so gaps show as zero rather than disappearing
function fillDays(days) {
  if (days.length < 2) return days
  const byDay = Object.fromEntries(days.map((d) => [d.day, d]))
  const out = []
  const end = new Date(`${days[days.length - 1].day}T00:00`)
  for (let d = new Date(`${days[0].day}T00:00`); d <= end; d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    out.push(byDay[key] || { day: key, count: 0, revenue: 0 })
  }
  return out
}

function DailyChart({ days: raw }) {
  const [hover, setHover] = useState(null)
  const days = fillDays(raw)
  if (days.length === 0) return <p className="py-10 text-center text-sm text-slate-500">No sales in this period.</p>
  const max = Math.max(...days.map((d) => d.revenue), 1)
  const peak = days.reduce((a, b) => (b.revenue > a.revenue ? b : a))
  const label = (day) => new Date(`${day}T00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })
  const every = Math.ceil(days.length / 10) // thin out x-axis labels

  return (
    <div>
      <div className="relative flex h-48 items-end gap-0.5 border-b border-slate-200">
        {/* recessive gridline at the max */}
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-slate-100" />
        {days.map((d) => (
          <div
            key={d.day}
            tabIndex={0}
            role="img"
            aria-label={`${label(d.day)}: ${ksh(d.revenue)} from ${d.count} sales`}
            onMouseEnter={() => setHover(d)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(d)}
            onBlur={() => setHover(null)}
            className="group relative flex h-full flex-1 items-end justify-center outline-none"
          >
            <div
              className={`w-full max-w-6 rounded-t-[4px] transition-colors ${hover && hover.day !== d.day ? 'bg-emerald-600/40' : 'bg-emerald-600'}`}
              style={{ height: d.revenue ? `${Math.max((d.revenue / max) * 100, 1.5)}%` : '0' }}
            />
            {d === peak && !hover && (
              <span className="absolute -translate-y-1 whitespace-nowrap text-[10px] font-medium text-slate-600" style={{ bottom: `${(d.revenue / max) * 100}%` }}>
                {ksh(d.revenue)}
              </span>
            )}
            {hover?.day === d.day && (
              <div className="absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg">
                <p className="font-semibold">{label(d.day)}</p>
                <p>{ksh(d.revenue)} · {d.count} sales</p>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-0.5">
        {days.map((d, i) => (
          <span key={d.day} className="flex-1 truncate text-center text-[10px] text-slate-400">
            {i % every === 0 ? label(d.day) : ''}
          </span>
        ))}
      </div>
    </div>
  )
}
