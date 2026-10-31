import { useEffect, useState } from 'react'
import { BellRing, Bot, FileBarChart, History, LayoutDashboard, Menu, Package, RefreshCcw, ShoppingCart, Store, TrendingUp, TriangleAlert, Users, X } from 'lucide-react'
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

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, page: Dashboard, section: 'Shop' },
  { id: 'sales', label: 'New Sale', icon: ShoppingCart, page: Sales, section: 'Shop' },
  { id: 'history', label: 'Sales History', icon: History, page: SalesHistory, section: 'Shop' },
  { id: 'products', label: 'Products', icon: Package, page: Products, section: 'Shop' },
  { id: 'customers', label: 'Customers', icon: Users, page: Customers, section: 'Shop' },
  { id: 'lowstock', label: 'Restocking', icon: TriangleAlert, page: LowStock, section: 'Stock' },
  { id: 'autorestock', label: 'Auto Restock', icon: RefreshCcw, page: AutoRestock, section: 'Stock' },
  { id: 'performance', label: 'Performance', icon: TrendingUp, page: Performance, section: 'Insights' },
  { id: 'reports', label: 'Reports', icon: FileBarChart, page: Reports, section: 'Insights' },
  { id: 'assistant', label: 'AI Assistant', icon: Bot, page: Assistant, section: 'Insights' },
  { id: 'alerts', label: 'Alerts & Settings', icon: BellRing, page: Alerts, section: 'System' },
]

export default function App() {
  const fromHash = () => (NAV.some((n) => n.id === location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard')
  const [active, setActive] = useState(fromHash)
  useEffect(() => {
    const onHash = () => setActive(fromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const [open, setOpen] = useState(false)
  const Page = NAV.find((n) => n.id === active).page

  const go = (id) => {
    location.hash = id
    setActive(id)
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
        <nav className="space-y-0.5 overflow-y-auto px-3 pb-12" style={{ maxHeight: 'calc(100vh - 6rem)' }}>
          {NAV.map(({ id, label, icon: Icon, section }, i) => (
            <div key={id}>
            {section !== NAV[i - 1]?.section && (
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
        <div className="absolute bottom-0 w-full p-4 text-xs text-slate-500">Mama Wanjiku's Duka · Nairobi</div>
      </aside>

      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <Page navigate={go} />
      </main>
    </div>
  )
}

function Brand({ dark }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-white">
        <Store size={20} />
      </div>
      <div>
        <div className={`text-lg font-bold leading-tight ${dark ? 'text-white' : 'text-slate-900'}`}>DukaBuddy</div>
        <div className="text-xs text-slate-400">Smart shop assistant</div>
      </div>
    </div>
  )
}
