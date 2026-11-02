async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  return handle(res)
}

// A 401 means the session ended (logged out, password changed, account switched off): go back to the login screen
async function handle(res) {
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && data.login_required) window.dispatchEvent(new Event('dukabuddy:logged-out'))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

async function upload(path, file) {
  const form = new FormData()
  form.append('file', file)
  return handle(await fetch(`/api${path}`, { method: 'POST', body: form }))
}

export const api = {
  me: () => request('/auth/me'),
  login: (username, password) => request('/auth/login', { method: 'POST', body: { username, password } }),
  setup: (owner) => request('/auth/setup', { method: 'POST', body: owner }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  changePassword: (current_password, new_password) =>
    request('/auth/password', { method: 'POST', body: { current_password, new_password } }),
  users: () => request('/users'),
  addUser: (u) => request('/users', { method: 'POST', body: u }),
  updateUser: (id, u) => request(`/users/${id}`, { method: 'PUT', body: u }),
  dashboard: () => request('/dashboard'),
  overview: (from, to) => request(`/overview?from=${from}&to=${to}`),
  products: () => request('/products'),
  addProduct: (p) => request('/products', { method: 'POST', body: p }),
  importProducts: (file, commit) => upload(`/products/import${commit ? '?commit=1' : ''}`, file),
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
  removeSale: (id, reason) => request(`/transactions/${id}`, { method: 'DELETE', body: { reason } }),
  removedSales: () => request('/transactions/removed'),
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
  smsStatus: () => request('/sms/status'),
  smsLog: () => request('/sms/log'),
  testSms: () => request('/sms/test', { method: 'POST' }),
  smsSummaryNow: () => request('/sms/summary', { method: 'POST' }),
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
