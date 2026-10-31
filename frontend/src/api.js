async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export const api = {
  dashboard: () => request('/dashboard'),
  products: () => request('/products'),
  addProduct: (p) => request('/products', { method: 'POST', body: p }),
  restock: (id, quantity, unit_cost) =>
    request(`/products/${id}/restock`, { method: 'POST', body: { quantity, unit_cost } }),
  restocks: () => request('/restocks'),
  sales: () => request('/sales'),
  checkout: (sale) => request('/transactions', { method: 'POST', body: sale }),
  transactions: (filters = {}) => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString()
    return request(`/transactions${qs ? `?${qs}` : ''}`)
  },
  transaction: (id) => request(`/transactions/${id}`),
  customers: () => request('/customers'),
  customer: (id) => request(`/customers/${id}`),
  addCustomer: (c) => request('/customers', { method: 'POST', body: c }),
  awardBonus: (id, points, reason) => request(`/customers/${id}/bonus`, { method: 'POST', body: { points, reason } }),
  loyaltyRules: () => request('/loyalty/rules'),
  performance: (days) => request(`/performance${days ? `?days=${days}` : ''}`),
  settings: () => request('/settings'),
  saveSettings: (s) => request('/settings', { method: 'PUT', body: s }),
  purchaseOrders: (status) => request(`/purchase-orders${status ? `?status=${status}` : ''}`),
  createPO: (product_id, quantity, reason) => request('/purchase-orders', { method: 'POST', body: { product_id, quantity, reason } }),
  poAction: (id, action, body) => request(`/purchase-orders/${id}/${action}`, { method: 'POST', body: body || {} }),
  newProducts: () => request('/automation/new-products'),
  runAutomation: () => request('/automation/run', { method: 'POST' }),
  automationStatus: () => request('/automation/status'),
  alerts: () => request('/alerts'),
  alert: (id) => request(`/alerts/${id}`),
  testEmail: () => request('/alerts/test', { method: 'POST' }),
  reportTypes: () => request('/reports/types'),
  monthlyReports: () => request('/reports/monthly'),
  sendMonthly: (month) => request('/reports/monthly/send', { method: 'POST', body: { month } }),
  ask: (question) => request('/assistant', { method: 'POST', body: { question } }),
}

// "2026-10-31 15:24:09" -> "31 Oct, 15:24" ("Today, 15:24" for today)
export const when = (ts) => {
  if (!ts) return 'Never'
  const d = new Date(ts.replace(' ', 'T'))
  const time = d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (d.toDateString() === new Date().toDateString()) return `Today, ${time}`
  return `${d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}, ${time}`
}

// Local date as YYYY-MM-DD, optionally offset by N days
export const isoDate = (offsetDays = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const ksh = (n) =>
  `KSh ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
