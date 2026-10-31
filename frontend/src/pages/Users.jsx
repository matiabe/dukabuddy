import { useEffect, useState } from 'react'
import { KeyRound, Plus, X } from 'lucide-react'
import { api, when } from '../api.js'
import { useAuth } from '../auth.jsx'
import { Alert, Button, Card, Field, PageHeader, inputClass } from '../components/ui.jsx'

const EMPTY = { name: '', username: '', password: '', role: 'staff' }
const ROLE_INFO = {
  staff: 'New Sale, Sales History, Products, Customers, receiving stock. No buying prices, profits, reports or settings.',
  owner: 'Everything, including profits, reports, prices, product import, settings and staff accounts.',
}

export default function Users() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = () => api.users().then(setUsers).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const run = async (fn, message) => {
    setError('')
    setSuccess('')
    try {
      await fn()
      setSuccess(message)
      load()
      return true
    } catch (err) {
      setError(err.message)
      return false
    }
  }

  const add = async (e) => {
    e.preventDefault()
    if (await run(() => api.addUser(form), `Account created for ${form.name}. They log in as "${form.username.toLowerCase()}".`)) {
      setForm(EMPTY)
      setShowForm(false)
    }
  }

  const resetPassword = (u) => {
    const password = window.prompt(`New password for ${u.name} (at least 6 characters):`)
    if (password) run(() => api.updateUser(u.id, { password }), `Password changed for ${u.name}. Give them the new password.`)
  }

  const toggle = (u) => {
    if (u.active && !window.confirm(`Switch off ${u.name}'s account? They are logged out and can't log in until you switch it back on.`)) return
    run(() => api.updateUser(u.id, { active: !u.active }), `${u.name}'s account is now ${u.active ? 'off' : 'on'}.`)
  }

  const changeRole = (u, role) => run(() => api.updateUser(u.id, { role }), `${u.name} is now ${role === 'owner' ? 'an owner' : 'staff'}.`)

  return (
    <>
      <PageHeader
        title="Staff accounts"
        subtitle="Everyone logs in with their own account, so you can see who served each sale."
        action={
          <Button onClick={() => setShowForm(!showForm)}>
            {showForm ? <><X size={16} /> Cancel</> : <><Plus size={16} /> Add staff</>}
          </Button>
        }
      />
      <div className="mb-4 space-y-2">
        <Alert>{error}</Alert>
        <Alert type="success">{success}</Alert>
      </div>

      {showForm && (
        <Card className="mb-6 p-5">
          <form onSubmit={add} className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Kevin Otieno" required />
            </Field>
            <Field label="Username (used to log in)">
              <input className={inputClass} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="e.g. kevin" autoCapitalize="none" required />
            </Field>
            <Field label="Password (at least 6 characters)">
              <input className={inputClass} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={6} autoComplete="new-password" required />
            </Field>
            <Field label="Role">
              <select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="staff">Staff</option>
                <option value="owner">Owner</option>
              </select>
            </Field>
            <p className="text-xs text-slate-500 sm:col-span-2">{ROLE_INFO[form.role]}</p>
            <div className="sm:col-span-2"><Button type="submit">Create account</Button></div>
          </form>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Username</th>
                <th className="px-5 py-3">Role</th>
                <th className="px-5 py-3">Last login</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id} className={u.active ? '' : 'bg-slate-50 text-slate-400'}>
                  <td className="px-5 py-3 font-medium text-slate-800">{u.name}{u.id === me.id && <span className="ml-1 text-xs text-slate-400">(you)</span>}</td>
                  <td className="px-5 py-3 font-mono text-xs">{u.username}</td>
                  <td className="px-5 py-3">
                    <select className="rounded border border-slate-200 bg-white px-2 py-1 text-sm" value={u.role} onChange={(e) => changeRole(u, e.target.value)} disabled={u.id === me.id}>
                      <option value="staff">Staff</option>
                      <option value="owner">Owner</option>
                    </select>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-500">{when(u.last_login_at)}</td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                      {u.active ? 'Active' : 'Switched off'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right">
                    {u.id !== me.id && (
                      <button onClick={() => resetPassword(u)} className="mr-4 inline-flex items-center gap-1 text-sm font-medium text-emerald-600 hover:underline">
                        <KeyRound size={14} /> Reset password
                      </button>
                    )}
                    {u.id !== me.id && (
                      <button onClick={() => toggle(u)} className="text-sm font-medium text-slate-600 hover:underline">
                        {u.active ? 'Switch off' : 'Switch on'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
