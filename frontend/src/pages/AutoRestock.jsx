import { useEffect, useState } from 'react'
import { Bot, CheckCircle2, PackageCheck, Play, SearchCheck, XCircle } from 'lucide-react'
import { api, ksh, when } from '../api.js'
import { Alert, Button, Card, PageHeader } from '../components/ui.jsx'

const STATUS = {
  pending_review: ['Needs review', 'bg-violet-100 text-violet-700'],
  ordered: ['Ordered', 'bg-blue-100 text-blue-700'],
  received: ['Received', 'bg-emerald-100 text-emerald-700'],
  cancelled: ['Cancelled', 'bg-slate-100 text-slate-500'],
}
const REC_STYLES = {
  Restock: 'bg-emerald-100 text-emerald-800',
  'Not yet': 'bg-blue-100 text-blue-700',
  Wait: 'bg-slate-100 text-slate-600',
  'Do not restock': 'bg-red-100 text-red-700',
}

export default function AutoRestock({ navigate }) {
  const [orders, setOrders] = useState([])
  const [counts, setCounts] = useState({})
  const [tab, setTab] = useState('')
  const [lastRun, setLastRun] = useState(null)
  const [settings, setSettings] = useState(null)
  const [newProducts, setNewProducts] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = () => {
    api.purchaseOrders(tab).then((d) => { setOrders(d.orders); setCounts(d.counts) }).catch((e) => setError(e.message))
    api.automationStatus().then((d) => setLastRun(d.last_run)).catch(() => {})
  }
  useEffect(load, [tab])
  useEffect(() => { api.settings().then((d) => setSettings(d.settings)).catch(() => {}) }, [])

  const flash = (msg) => { setError(''); setSuccess(msg) }
  const fail = (e) => { setSuccess(''); setError(e.message) }

  const runNow = async () => {
    setBusy(true)
    try {
      const r = await api.runAutomation()
      flash(`Checks complete: ${r.orders_created} order(s) placed automatically, ${r.needs_review} need your review, ${r.alerts} email alert(s).` +
        (r.monthly_report ? ` Monthly report for ${r.monthly_report} sent.` : ''))
      load()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const verifyNew = async () => {
    setBusy(true)
    try { setNewProducts(await api.newProducts()) } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const act = async (o, action) => {
    let body
    if (action === 'approve') {
      const q = window.prompt(`Approve order for ${o.product_name}. Quantity to order:`, o.quantity)
      if (!q) return
      body = { quantity: q }
    }
    if (action === 'cancel' && !window.confirm(`Cancel ${o.po_no} for ${o.product_name}?`)) return
    try {
      await api.poAction(o.id, action, body)
      flash({ approve: `${o.po_no} approved and marked as ordered.`, receive: `${o.po_no} received - stock of ${o.product_name} updated.`, cancel: `${o.po_no} cancelled.` }[action])
      load()
    } catch (e) { fail(e) }
  }

  const orderNew = async (p) => {
    const q = window.prompt(`Order how many units of ${p.name}?`, p.suggested_qty || p.reorder_level)
    if (!q) return
    try {
      await api.createPO(p.id, q, 'New product - verified by owner')
      flash(`Order created for ${p.name}.`)
      load()
      verifyNew()
    } catch (e) { fail(e) }
  }

  const summary = lastRun && JSON.parse(lastRun.summary)

  return (
    <>
      <PageHeader
        title="Auto Restock"
        subtitle="NyamsComm checks stock automatically and prepares purchase orders. You receive deliveries here."
        action={<Button onClick={runNow} disabled={busy}><Play size={16} /> Run checks now</Button>}
      />
      <div className="mb-4 space-y-2">
        <Alert>{error}</Alert>
        <Alert type="success">{success}</Alert>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900"><Bot size={18} className="text-emerald-600" /> How it works</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li>• Runs automatically in the background (and when you click <b>Run checks now</b>).</li>
            <li>• Products at or below reorder level get a purchase order sized for ~2 weeks of sales.</li>
            <li>• Established products: {settings?.auto_restock ? <b>ordered automatically</b> : <b>sent to you for review</b>}.</li>
            <li>• New products (under {settings?.new_product_days ?? 14} days): always <b>need your review</b>.</li>
            <li>• Dead stock is never re-ordered. All alerts go to your email.</li>
          </ul>
          <button onClick={() => navigate('alerts')} className="mt-3 text-sm font-medium text-emerald-600 hover:underline">Change settings →</button>
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold text-slate-900">Last automatic check</h2>
          {lastRun ? (
            <div className="mt-3 space-y-1 text-sm text-slate-600">
              <p>{when(lastRun.created_at)} <span className="text-xs text-slate-400">({lastRun.trigger})</span></p>
              <p>Orders placed: <b>{summary.orders_created}</b> · Needs review: <b>{summary.needs_review}</b></p>
              <p>Email alerts: <b>{summary.alerts}</b>{summary.monthly_report && <> · Monthly report: <b>{summary.monthly_report}</b></>}</p>
            </div>
          ) : <p className="mt-3 text-sm text-slate-500">Not run yet - it starts shortly after the server starts.</p>}
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold text-slate-900">Orders</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {Object.entries(STATUS).map(([k, [label, cls]]) => (
              <div key={k} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>
                <b>{counts[k] || 0}</b>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* New product verification */}
      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="font-semibold text-slate-900">New product check</h2>
            <p className="text-xs text-slate-400">New products aren't restocked automatically. Run this to see whether each one needs restocking, based on its early sales.</p>
          </div>
          <Button variant="ghost" onClick={verifyNew} disabled={busy}><SearchCheck size={16} /> Verify new products</Button>
        </div>
        {newProducts === null ? (
          <p className="px-5 py-6 text-sm text-slate-500">Click <b>Verify new products</b> to analyse them.</p>
        ) : newProducts.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">No new products right now.</p>
        ) : (
          <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
            {newProducts.map((p) => (
              <div key={p.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-400">In store {p.days_in_store} day(s) · {p.category}</p>
                  </div>
                  <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${REC_STYLES[p.recommendation]}`}>{p.recommendation}</span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs">
                  <dt className="text-slate-500">In stock</dt><dd className="text-right font-medium">{p.quantity} (reorder at {p.reorder_level})</dd>
                  <dt className="text-slate-500">Sold since added</dt><dd className="text-right font-medium">{p.units_sold} units</dd>
                  <dt className="text-slate-500">Sales rate</dt><dd className="text-right font-medium">{p.daily_rate}/day</dd>
                  <dt className="text-slate-500">Stock lasts</dt><dd className="text-right font-medium">{p.days_of_cover ? `${p.days_of_cover} days` : '—'}</dd>
                </dl>
                <p className="mt-3 text-sm text-slate-600">{p.detail}</p>
                {p.open_order ? (
                  <p className="mt-3 text-xs font-medium text-violet-700">Open order: {p.open_order.quantity} units ({STATUS[p.open_order.status][0]})</p>
                ) : p.recommendation === 'Restock' ? (
                  <Button className="mt-3 w-full" onClick={() => orderNew(p)}>Order {p.suggested_qty} units · {ksh(p.suggested_cost)}</Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Purchase orders */}
      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-900">Purchase orders</h2>
          <div className="flex rounded-lg border border-slate-200 p-0.5">
            {[['', 'All'], ...Object.entries(STATUS).map(([k, [l]]) => [k, l])].map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${tab === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Est. cost</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold">{o.po_no}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{when(o.created_at)}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{o.product_name}</p>
                    <p className="text-xs text-slate-400">Now in stock: {o.current_stock} · reorder at {o.reorder_level}</p>
                  </td>
                  <td className="px-4 py-3 text-right">{o.quantity}</td>
                  <td className="px-4 py-3 text-right">{ksh(o.total_cost)}</td>
                  <td className="px-4 py-3"><span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS[o.status][1]}`}>{STATUS[o.status][0]}</span></td>
                  <td className="max-w-64 px-4 py-3 text-xs text-slate-500">{o.reason} <span className="text-slate-400">({o.source})</span></td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {o.status === 'pending_review' && (
                      <button onClick={() => act(o, 'approve')} className="mr-3 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"><CheckCircle2 size={14} /> Approve</button>
                    )}
                    {o.status === 'ordered' && (
                      <button onClick={() => act(o, 'receive')} className="mr-3 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"><PackageCheck size={14} /> Received</button>
                    )}
                    {['pending_review', 'ordered'].includes(o.status) && (
                      <button onClick={() => act(o, 'cancel')} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-red-600"><XCircle size={14} /> Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && <tr><td colSpan={8} className="px-5 py-6 text-center text-slate-500">No purchase orders.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
