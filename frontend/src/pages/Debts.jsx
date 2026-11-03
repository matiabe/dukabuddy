import { useEffect, useState } from 'react'
import { ArrowLeft, Minus, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { api, isoDate, ksh, when } from '../api.js'
import { Alert, Button, Card, Field, PageHeader, inputClass } from '../components/ui.jsx'

const TABS = {
  debtor: {
    label: 'Debtors',
    title: 'Customers who owe us',
    who: 'Customer',
    owedLabel: 'Customers owe us',
    addLabel: 'Add debtor',
    placeholder: 'e.g. Grace Njeri',
    notePlaceholder: 'e.g. Took Tecno Spark 20, will pay end month',
  },
  creditor: {
    label: 'Creditors',
    title: 'Suppliers we owe',
    who: 'Supplier',
    owedLabel: 'We owe suppliers',
    addLabel: 'Add creditor',
    placeholder: 'e.g. Phone World Distributors',
    notePlaceholder: 'e.g. 20 earbuds delivered on credit, invoice #4471',
  },
}

// "2026-11-03" -> overdue / due soon badge
function DueBadge({ due, balance }) {
  if (!due || balance <= 0) return null
  const today = isoDate()
  if (due < today) return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Overdue</span>
  if (due <= isoDate(7)) return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Due soon</span>
  return null
}

const emptyForm = { name: '', phone: '', amount: '', note: '', due_date: '' }

export default function Debts() {
  const [kind, setKind] = useState('debtor')
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState('')
  const [showCleared, setShowCleared] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = () => api.debts().then(setData).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const tab = TABS[kind]
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    try {
      const d = await api.addDebt({ ...form, kind })
      setSuccess(`Recorded ${d.name}: ${ksh(d.balance)}.`)
      setForm(emptyForm)
      setShowForm(false)
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  if (selected) return <DebtDetail id={selected} onBack={() => { setSelected(null); load() }} />

  const rows = (data?.debts || [])
    .filter((d) => d.kind === kind)
    .filter((d) => showCleared || d.balance > 0)
    .filter((d) => `${d.name} ${d.phone || ''} ${d.note || ''}`.toLowerCase().includes(query.toLowerCase()))
  const cleared = (data?.debts || []).filter((d) => d.kind === kind && d.balance <= 0).length

  return (
    <>
      <PageHeader
        title="Debtors & Creditors"
        subtitle="Money customers owe the shop, and money the shop owes suppliers"
        action={
          <Button onClick={() => { setShowForm(!showForm); setError('') }}>
            {showForm ? <><X size={16} /> Cancel</> : <><Plus size={16} /> {tab.addLabel}</>}
          </Button>
        }
      />

      {data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          {Object.entries(TABS).map(([k, t]) => (
            <button key={k} onClick={() => { setKind(k); setShowForm(false) }} className="text-left">
              <Card className={`p-4 transition ${kind === k ? 'ring-2 ring-emerald-500' : 'hover:border-slate-300'}`}>
                <p className="text-xs font-medium text-slate-500">{t.owedLabel} ({t.label})</p>
                <p className={`mt-1 text-2xl font-bold ${k === 'debtor' ? 'text-emerald-700' : 'text-red-600'}`}>{ksh(data.totals[k].owed)}</p>
                <p className="text-xs text-slate-400">{data.totals[k].open} unpaid {data.totals[k].open === 1 ? 'record' : 'records'}</p>
              </Card>
            </button>
          ))}
        </div>
      )}

      <div className="mb-4 space-y-2">
        <Alert>{error}</Alert>
        <Alert type="success">{success}</Alert>
      </div>

      {showForm && (
        <Card className="mb-6 p-5">
          <h2 className="mb-4 font-semibold text-slate-900">{tab.addLabel}: {tab.title.toLowerCase()}</h2>
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={`${tab.who} name`}>
              <input className={inputClass} value={form.name} onChange={set('name')} placeholder={tab.placeholder} required autoFocus />
            </Field>
            <Field label="Phone (optional)">
              <input className={inputClass} value={form.phone} onChange={set('phone')} placeholder="0712 345 678" />
            </Field>
            <Field label={kind === 'debtor' ? 'Amount they owe (KSh)' : 'Amount we owe (KSh)'}>
              <input type="number" min="1" step="any" className={inputClass} value={form.amount} onChange={set('amount')} required />
            </Field>
            <Field label="Due date (optional)">
              <input type="date" className={inputClass} value={form.due_date} onChange={set('due_date')} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="What is it for? (optional)">
                <input className={inputClass} value={form.note} onChange={set('note')} placeholder={tab.notePlaceholder} />
              </Field>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <Button type="submit">Save</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <h2 className="font-semibold text-slate-900">{tab.title}</h2>
          <div className="relative ml-auto w-full max-w-xs">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className={`${inputClass} pl-9`} placeholder="Search name, phone, note…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {cleared > 0 && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={showCleared} onChange={(e) => setShowCleared(e.target.checked)} />
              Show cleared ({cleared})
            </label>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">{tab.who}</th>
                <th className="px-5 py-3">For</th>
                <th className="px-5 py-3">Due</th>
                <th className="px-5 py-3">Last update</th>
                <th className="px-5 py-3 text-right">Paid so far</th>
                <th className="px-5 py-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((d) => (
                <tr key={d.id} onClick={() => setSelected(d.id)} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-800">{d.name}</p>
                    {d.phone && <p className="text-xs text-slate-400">{d.phone}</p>}
                  </td>
                  <td className="max-w-xs truncate px-5 py-3 text-slate-600">{d.note || '—'}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-500">
                    {d.due_date || '—'} <DueBadge due={d.due_date} balance={d.balance} />
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-500">{when(d.last_activity || d.updated_at)}</td>
                  <td className="px-5 py-3 text-right text-slate-600">{ksh(d.total_paid)}</td>
                  <td className="px-5 py-3 text-right font-semibold">
                    {d.balance > 0 ? ksh(d.balance) : <span className="text-emerald-700">Cleared</span>}
                  </td>
                </tr>
              ))}
              {data && rows.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-6 text-center text-slate-500">
                  {query ? 'Nothing matches your search.' : kind === 'debtor' ? 'No customer owes the shop money.' : 'The shop owes no supplier money.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

const ENTRY_LABELS = { add: 'Owed more', payment: 'Payment', adjust: 'Amount corrected' }

function DebtDetail({ id, onBack }) {
  const [data, setData] = useState(null)
  const [action, setAction] = useState('payment')
  const [entry, setEntry] = useState({ amount: '', note: '' })
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = () => api.debt(id).then(setData).catch((e) => setError(e.message))
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <p className="text-slate-500">{error || 'Loading…'}</p>
  const d = data.debt
  const tab = TABS[d.kind]

  const record = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    try {
      const updated = await api.debtEntry(id, action, entry.amount, entry.note)
      setSuccess(updated.balance > 0 ? `Saved. New balance: ${ksh(updated.balance)}.` : 'Saved. This record is now fully cleared.')
      setEntry({ amount: '', note: '' })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const saveEdit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await api.editDebt(id, editing)
      setEditing(null)
      setSuccess('Details updated.')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const remove = async () => {
    if (!confirm(`Delete the record for ${d.name}? Its history will be deleted too.`)) return
    try {
      await api.deleteDebt(id)
      onBack()
    } catch (err) {
      setError(err.message)
    }
  }

  const actions = [
    ['payment', <><Minus size={14} /> {d.kind === 'debtor' ? 'They paid' : 'We paid'}</>],
    ['add', <><Plus size={14} /> {d.kind === 'debtor' ? 'They owe more' : 'We owe more'}</>],
    ['adjust', <><Pencil size={14} /> Correct amount</>],
  ]

  return (
    <>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft size={16} /> All debtors & creditors
      </button>

      <div className="mb-6 flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{tab.who} · {d.kind === 'debtor' ? 'owes us' : 'we owe'}</p>
          <h1 className="text-2xl font-bold text-slate-900">{d.name}</h1>
          <p className="text-sm text-slate-500">
            {[d.phone, d.due_date && `due ${d.due_date}`, `added by ${d.created_by || '—'} ${when(d.created_at)}`].filter(Boolean).join(' · ')}
          </p>
          {d.note && <p className="mt-1 text-sm text-slate-700">{d.note}</p>}
        </div>
        <Card className="p-4 text-right">
          <p className="text-xs font-medium text-slate-500">Balance</p>
          <p className={`text-2xl font-bold ${d.balance <= 0 ? 'text-emerald-700' : d.kind === 'debtor' ? 'text-slate-900' : 'text-red-600'}`}>
            {d.balance > 0 ? ksh(d.balance) : 'Cleared'}
          </p>
          <p className="text-xs text-slate-400">paid so far {ksh(d.total_paid)}</p>
        </Card>
      </div>

      <div className="mb-4 space-y-2">
        <Alert>{error}</Alert>
        <Alert type="success">{success}</Alert>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="p-5">
          <h2 className="mb-3 font-semibold text-slate-900">Update amount</h2>
          <div className="mb-4 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
            {actions.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setAction(key)}
                className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold ${action === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                {label}
              </button>
            ))}
          </div>
          <form onSubmit={record} className="space-y-3">
            <Field label={action === 'adjust' ? 'Correct balance (KSh)' : action === 'payment' ? 'Amount paid (KSh)' : 'Extra amount owed (KSh)'}>
              <input type="number" min={action === 'adjust' ? 0 : 1} step="any" className={inputClass} value={entry.amount}
                onChange={(e) => setEntry({ ...entry, amount: e.target.value })} required />
            </Field>
            {action === 'payment' && d.balance > 0 && (
              <button type="button" onClick={() => setEntry({ ...entry, amount: d.balance })} className="rounded-full border border-slate-200 px-3 py-1 text-xs hover:border-emerald-400">
                Paid in full ({ksh(d.balance)})
              </button>
            )}
            <Field label={action === 'adjust' ? 'Why is it being corrected?' : 'Note (optional)'}>
              <input className={inputClass} value={entry.note} onChange={(e) => setEntry({ ...entry, note: e.target.value })}
                placeholder={action === 'payment' ? 'e.g. M-Pesa QJK4X1, cash' : action === 'add' ? 'e.g. Took 2 chargers' : 'e.g. Agreed discount with supplier'}
                required={action === 'adjust'} />
            </Field>
            <Button type="submit" className="w-full">Save</Button>
          </form>
        </Card>

        <Card className="p-5 xl:col-span-2">
          <h2 className="mb-3 font-semibold text-slate-900">History</h2>
          <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto pr-1">
            {data.entries.map((e) => (
              <li key={e.id} className="flex justify-between gap-3 py-2 text-sm">
                <span>
                  <span className="font-medium text-slate-700">{ENTRY_LABELS[e.type]}</span>
                  {e.note && <span className="text-slate-600"> · {e.note}</span>}
                  <span className="block text-xs text-slate-400">{e.user_name || '—'} · {when(e.created_at)}</span>
                </span>
                <span className="text-right">
                  <span className={`font-semibold ${e.amount < 0 ? 'text-emerald-700' : 'text-slate-900'}`}>
                    {e.amount > 0 ? '+' : e.amount < 0 ? '−' : ''}{ksh(Math.abs(e.amount))}
                  </span>
                  <span className="block text-xs text-slate-400">balance {ksh(e.balance_after)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-6 p-5">
        {editing ? (
          <form onSubmit={saveEdit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <Field label={`${tab.who} name`}><input className={inputClass} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required /></Field>
            <Field label="Phone"><input className={inputClass} value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
            <Field label="Due date"><input type="date" className={inputClass} value={editing.due_date} onChange={(e) => setEditing({ ...editing, due_date: e.target.value })} /></Field>
            <Field label="What is it for?"><input className={inputClass} value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} /></Field>
            <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
              <Button type="submit">Save details</Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setEditing({ name: d.name, phone: d.phone || '', due_date: d.due_date || '', note: d.note || '' })}>
              <Pencil size={16} /> Edit details
            </Button>
            {d.balance <= 0 && (
              <Button variant="danger" onClick={remove}><Trash2 size={16} /> Delete record</Button>
            )}
          </div>
        )}
      </Card>
    </>
  )
}
