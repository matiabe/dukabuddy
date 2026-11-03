import { useEffect, useState } from 'react'
import { ArrowLeft, Gift, Plus, Search, X } from 'lucide-react'
import { api, ksh, when } from '../api.js'
import { useAuth } from '../auth.jsx'
import { Alert, Button, Card, Field, PageHeader, StatusBadge, TierBadge, inputClass } from '../components/ui.jsx'

export default function Customers() {
  const [customers, setCustomers] = useState([])
  const [rules, setRules] = useState(null)
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = () => api.customers().then(setCustomers).catch((e) => setError(e.message))
  useEffect(() => {
    load()
    api.loyaltyRules().then(setRules).catch(() => {})
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    try {
      const c = await api.addCustomer(form)
      setSuccess(`Registered ${c.name} (${c.phone}) on the loyalty programme.`)
      setForm({ name: '', phone: '' })
      setShowForm(false)
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  if (selected) return <CustomerDetail id={selected} onBack={() => { setSelected(null); load() }} />

  const filtered = customers.filter((c) => `${c.name} ${c.phone}`.toLowerCase().includes(query.toLowerCase()))

  return (
    <>
      <PageHeader
        title="Customers & Loyalty"
        subtitle={`${customers.length} loyalty members · ${customers.reduce((n, c) => n + c.points, 0).toLocaleString()} points outstanding`}
        action={
          <Button onClick={() => setShowForm(!showForm)}>
            {showForm ? <><X size={16} /> Cancel</> : <><Plus size={16} /> Add customer</>}
          </Button>
        }
      />

      <div className="mb-4 space-y-2">
        <Alert>{error}</Alert>
        <Alert type="success">{success}</Alert>
      </div>

      {rules && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {rules.tiers.map((t) => (
            <Card key={t.name} className="p-4">
              <div className="flex items-center justify-between">
                <TierBadge tier={t.name} />
                <span className="text-xs font-semibold text-slate-500">{t.multiplier}× points</span>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {t.min_spend === 0 ? 'All new members' : `Spent ${ksh(t.min_spend)}+`}
              </p>
            </Card>
          ))}
          <p className="text-xs text-slate-500 sm:col-span-3">
            Customers earn 1 point per {ksh(rules.points_per_ksh)} spent (× tier multiplier). 1 point = {ksh(rules.point_value_ksh)} off a purchase.
            Customers who haven't visited in {rules.at_risk_days}+ days are marked <b>At risk</b>.
          </p>
        </div>
      )}

      {showForm && (
        <Card className="mb-6 p-5">
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3 sm:items-end">
            <Field label="Customer name">
              <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Grace Njeri" required />
            </Field>
            <Field label="Phone number">
              <input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0712 345 678" required />
            </Field>
            <Button type="submit">Register customer</Button>
          </form>
        </Card>
      )}

      <Card>
        <div className="border-b border-slate-100 p-4">
          <div className="relative max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className={`${inputClass} pl-9`} placeholder="Search by name or phone…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Customer</th>
                <th className="px-5 py-3">Tier</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Visits</th>
                <th className="px-5 py-3 text-right">Total spent</th>
                <th className="px-5 py-3">Last visit</th>
                <th className="px-5 py-3 text-right">Points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((c) => (
                <tr key={c.id} onClick={() => setSelected(c.id)} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-800">{c.name}</p>
                    <p className="text-xs text-slate-400">{c.phone}</p>
                  </td>
                  <td className="px-5 py-3"><TierBadge tier={c.tier} /></td>
                  <td className="px-5 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-5 py-3 text-right">{c.visits}</td>
                  <td className="px-5 py-3 text-right font-semibold">{ksh(c.total_spent)}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-500">{when(c.last_visit)}</td>
                  <td className="px-5 py-3 text-right font-semibold text-emerald-700">{c.points}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-6 text-center text-slate-500">No customers found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

function CustomerDetail({ id, onBack }) {
  const [data, setData] = useState(null)
  const { isOwner } = useAuth()
  const [bonus, setBonus] = useState({ points: '', reason: 'Loyalty bonus' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = () => api.customer(id).then(setData).catch((e) => setError(e.message))
  useEffect(() => { load() }, [id])

  const award = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    try {
      const c = await api.awardBonus(id, bonus.points, bonus.reason)
      setSuccess(`Awarded ${bonus.points} bonus points. ${c.name} now has ${c.points} points.`)
      setBonus({ points: '', reason: 'Loyalty bonus' })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  if (!data) return <p className="text-slate-500">{error || 'Loading…'}</p>
  const c = data.customer
  const maxCat = Math.max(...data.categories.map((x) => x.spent), 1)

  const stats = [
    ['Visits', c.visits, `${c.visits_30d} in last 30 days`],
    ['Total spent', ksh(c.total_spent), `${c.items_bought} items bought`],
    ['Last visit', c.days_since_visit === null ? 'Never' : c.days_since_visit === 0 ? 'Today' : `${c.days_since_visit} days ago`, data.favourite_day ? `Usually shops on ${data.favourite_day}` : ''],
    ['Points', c.points, `worth ${ksh(c.points_value)}`],
  ]

  return (
    <>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft size={16} /> All customers
      </button>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-lg font-bold text-white">
          {c.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{c.name}</h1>
          <p className="text-sm text-slate-500">{c.phone} · member since {when(c.created_at)}</p>
        </div>
        <div className="flex gap-2"><TierBadge tier={c.tier} /><StatusBadge status={c.status} /></div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {stats.map(([label, value, sub]) => (
          <Card key={label} className="p-4">
            <p className="text-xs font-medium text-slate-500">{label}</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
            <p className="text-xs text-slate-400">{sub}</p>
          </Card>
        ))}
      </div>

      {c.next_tier && (
        <Card className="mt-4 p-4">
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">Progress to <b>{c.next_tier.name}</b> ({c.multiplier}× → higher points rate)</span>
            <span className="font-medium">{ksh(c.next_tier.remaining)} to go</span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, (c.total_spent / c.next_tier.min_spend) * 100)}%` }} />
          </div>
        </Card>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        {isOwner && <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-900"><Gift size={18} className="text-emerald-600" /> Award bonus points</h2>
          <form onSubmit={award} className="space-y-3">
            <Field label="Points">
              <input type="number" min="1" className={inputClass} value={bonus.points} onChange={(e) => setBonus({ ...bonus, points: e.target.value })} required />
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {[20, 50, 100].map((n) => (
                <button type="button" key={n} onClick={() => setBonus({ ...bonus, points: n })} className="rounded-full border border-slate-200 px-3 py-1 text-xs hover:border-emerald-400">+{n}</button>
              ))}
            </div>
            <Field label="Reason">
              <select className={inputClass} value={bonus.reason} onChange={(e) => setBonus({ ...bonus, reason: e.target.value })}>
                {['Loyalty bonus', 'Customer of the month', 'Birthday gift', 'Welcome back offer', 'Referral reward'].map((r) => <option key={r}>{r}</option>)}
              </select>
            </Field>
            <Alert>{error}</Alert>
            <Alert type="success">{success}</Alert>
            <Button type="submit" className="w-full"><Gift size={16} /> Award points</Button>
          </form>
        </Card>}

        <Card className="p-5">
          <h2 className="mb-3 font-semibold text-slate-900">Favourite products</h2>
          {data.favourites.length === 0 ? <p className="text-sm text-slate-500">No purchases yet.</p> : (
            <ul className="space-y-2">
              {data.favourites.map((f) => (
                <li key={f.id} className="flex justify-between text-sm">
                  <span className="text-slate-700">{f.name}</span>
                  <span className="text-slate-500">{f.units} units · {f.times_bought}×</span>
                </li>
              ))}
            </ul>
          )}
          {data.categories.length > 0 && (
            <>
              <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-900">Spending by category</h3>
              <div className="space-y-2">
                {data.categories.map((cat) => (
                  <div key={cat.category}>
                    <div className="flex justify-between text-xs"><span className="text-slate-600">{cat.category}</span><span className="font-medium">{ksh(cat.spent)}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${(cat.spent / maxCat) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 font-semibold text-slate-900">Points history</h2>
          {data.ledger.length === 0 ? <p className="text-sm text-slate-500">No points yet.</p> : (
            <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {data.ledger.map((l) => (
                <li key={l.id} className="flex justify-between text-sm">
                  <span>
                    <span className="text-slate-700">{l.type === 'earn' ? 'Earned' : l.type === 'redeem' ? 'Redeemed' : 'Bonus'}</span>
                    <span className="block text-xs text-slate-400">{l.reason} · {when(l.created_at)}</span>
                  </span>
                  <span className={`font-semibold ${l.points < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{l.points > 0 ? '+' : ''}{l.points}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold text-slate-900">Purchase history</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Receipt</th>
                <th className="px-5 py-3">Items</th>
                <th className="px-5 py-3 text-right">Discount</th>
                <th className="px-5 py-3 text-right">Paid</th>
                <th className="px-5 py-3 text-right">Points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.purchases.map((s) => (
                <tr key={s.id}>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-500">{when(s.created_at)}</td>
                  <td className="whitespace-nowrap px-5 py-3 font-mono text-xs">{s.receipt_no}</td>
                  <td className="px-5 py-3 text-slate-800">{s.items.map((i) => `${i.quantity}× ${i.product_name}`).join(', ')}</td>
                  <td className="px-5 py-3 text-right text-slate-500">{s.discount ? ksh(s.discount) : '—'}</td>
                  <td className="px-5 py-3 text-right font-semibold">{ksh(s.total)}</td>
                  <td className="px-5 py-3 text-right text-emerald-700">+{s.points_earned}</td>
                </tr>
              ))}
              {data.purchases.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-6 text-center text-slate-500">No purchases yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
