import { useCallback, useEffect, useState } from 'react'
import { BellRing, Bot, FileBarChart, History, KeyRound, LayoutDashboard, LogOut, Menu, Package, RefreshCcw, ShoppingCart, Smartphone, TrendingUp, TriangleAlert, UserCog, Users, X } from 'lucide-react'
import Dashboard from './pages/Dashboard.jsx'
import Products from './pages/Products.jsx'
import Sales from './pages/Sales.jsx'
import LowStock from './pages/LowStock.jsx'
import Assistant from './pages/Assistant.jsx'
import Customers from './pages/Customers.jsx'
import SalesHistory from './pages/SalesHistory.jsx'
import Performance from './pages/Performance.jsx'
import AutoRestock from './pages/AutoRestock.jsx'
import Reports from './pages/Reports.jsx'
import Alerts from './pages/Alerts.jsx'
import UsersPage from './pages/Users.jsx'
import Login from './pages/Login.jsx'
import { api } from './api.js'
import { AuthContext } from './auth.jsx'
import { Alert, Button, Field, inputClass } from './components/ui.jsx'

// staff: true = staff can open it too (everything else is owner-only; the backend enforces the same rules)
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, page: Dashboard, section: 'Shop' },
  { id: 'sales', label: 'New Sale', icon: ShoppingCart, page: Sales, section: 'Shop', staff: true },
  { id: 'history', label: 'Sales History', icon: History, page: SalesHistory, section: 'Shop', staff: true },
  { id: 'products', label: 'Products', icon: Package, page: Products, section: 'Shop', staff: true },
  { id: 'customers', label: 'Customers', icon: Users, page: Customers, section: 'Shop', staff: true },
  { id: 'lowstock', label: 'Restocking', icon: TriangleAlert, page: LowStock, section: 'Stock' },
  { id: 'autorestock', label: 'Auto Restock', icon: RefreshCcw, page: AutoRestock, section: 'Stock' },
  { id: 'performance', label: 'Performance', icon: TrendingUp, page: Performance, section: 'Insights' },
  { id: 'reports', label: 'Reports', icon: FileBarChart, page: Reports, section: 'Insights' },
  { id: 'assistant', label: 'AI Assistant', icon: Bot, page: Assistant, section: 'Insights' },
  { id: 'alerts', label: 'Alerts & Settings', icon: BellRing, page: Alerts, section: 'System' },
  { id: 'users', label: 'Staff accounts', icon: UserCog, page: UsersPage, section: 'System' },
]

// Decides between first-time setup, the login screen and the app
export default function App() {
  const [state, setState] = useState(null) // { user, setup_required, shop_name }
  const [error, setError] = useState('')

  const refresh = useCallback(
    () => api.me().then((d) => { setState(d); setError('') }).catch(() => setError('Cannot reach the NyamsComm server. Check that it is running.')),
    [],
  )
  useEffect(() => {
    refresh()
    const onLoggedOut = () => setState((s) => (s ? { ...s, user: null } : s))
    window.addEventListener('dukabuddy:logged-out', onLoggedOut)
    return () => window.removeEventListener('dukabuddy:logged-out', onLoggedOut)
  }, [refresh])

  if (!state) return <p className="p-8 text-slate-500">{error || 'Loading…'}</p>
  if (!state.user) {
    return <Login setup={state.setup_required} shopName={state.shop_name} onLogin={(user) => setState({ ...state, user, setup_required: false })} />
  }
  const logout = async () => {
    await api.logout().catch(() => {})
    setState({ ...state, user: null })
  }
  const auth = { user: state.user, shopName: state.shop_name, isOwner: state.user.role === 'owner', refresh, logout }
  return (
    <AuthContext.Provider value={auth}>
      {/* key: switching user rebuilds the menu for their role */}
      <Shell key={auth.user.id} auth={auth} />
    </AuthContext.Provider>
  )
}

function Shell({ auth }) {
  const nav = NAV.filter((n) => auth.isOwner || n.staff)
  const home = auth.isOwner ? 'dashboard' : 'sales'
  const allowed = (id) => nav.some((n) => n.id === id)
  const fromHash = () => (allowed(location.hash.slice(1)) ? location.hash.slice(1) : home)
  const [active, setActive] = useState(fromHash)
  useEffect(() => {
    const onHash = () => setActive(fromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const Page = nav.find((n) => n.id === active).page

  const go = (id) => {
    const target = allowed(id) ? id : home
    location.hash = target
    setActive(target)
    setOpen(false)
  }

  return (
    <div className="min-h-screen lg:flex">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <Brand />
        <button onClick={() => setOpen(!open)} className="rounded-lg p-2 hover:bg-slate-100" aria-label="Toggle menu">
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>

      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 shrink-0 transform bg-slate-900 text-slate-300 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-6 pb-2 pt-6">
          <Brand dark />
        </div>
        <nav className="space-y-0.5 overflow-y-auto px-3 pb-4" style={{ maxHeight: 'calc(100vh - 13rem)' }}>
          {nav.map(({ id, label, icon: Icon, section }, i) => (
            <div key={id}>
            {section !== nav[i - 1]?.section && (
              <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{section}</p>
            )}
            <button
              onClick={() => go(id)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                active === id ? 'bg-emerald-600 text-white' : 'hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Icon size={18} />
              {label}
            </button>
            </div>
          ))}
        </nav>
        <div className="absolute bottom-0 w-full border-t border-slate-800 p-4 text-xs">
          <p className="font-medium text-slate-200">{auth.user.name}</p>
          <p className="text-slate-500">{auth.isOwner ? 'Owner' : 'Staff'}</p>
          <div className="mt-2 flex gap-4">
            <button onClick={() => setChangingPassword(true)} className="flex items-center gap-1 hover:text-white"><KeyRound size={14} /> Password</button>
            <button onClick={auth.logout} className="flex items-center gap-1 hover:text-white"><LogOut size={14} /> Log out</button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <Page navigate={go} />
      </main>
      {changingPassword && <ChangePassword onClose={() => setChangingPassword(false)} />}
    </div>
  )
}

function ChangePassword({ onClose }) {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    if (form.next !== form.confirm) return setError('The new passwords do not match.')
    try {
      await api.changePassword(form.current, form.next)
      setDone(true)
    } catch (err) {
      setError(err.message)
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">Change your password</h2>
        {done ? (
          <>
            <Alert type="success">Password changed. Your other devices have been logged out.</Alert>
            <Button type="button" className="w-full" onClick={onClose}>Close</Button>
          </>
        ) : (
          <>
            <Alert>{error}</Alert>
            <Field label="Current password"><input type="password" className={inputClass} value={form.current} onChange={set('current')} autoComplete="current-password" required autoFocus /></Field>
            <Field label="New password (at least 6 characters)"><input type="password" className={inputClass} value={form.next} onChange={set('next')} minLength={6} autoComplete="new-password" required /></Field>
            <Field label="Repeat new password"><input type="password" className={inputClass} value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required /></Field>
            <div className="flex gap-2">
              <Button type="submit" className="flex-1">Change password</Button>
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}

function Brand({ dark }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-white">
        <Smartphone size={20} />
      </div>
      <div>
        <div className={`text-lg font-bold leading-tight ${dark ? 'text-white' : 'text-slate-900'}`}>NyamsComm</div>
        <div className="text-xs text-slate-400">Electronics</div>
      </div>
    </div>
  )
}
