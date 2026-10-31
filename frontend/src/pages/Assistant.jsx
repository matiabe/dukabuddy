import { useState } from 'react'
import { Bot, Send } from 'lucide-react'
import { api } from '../api.js'
import { Button, Card, PageHeader, inputClass } from '../components/ui.jsx'

const SUGGESTIONS = [
  'What should I restock this week?',
  'Which products are selling fastest?',
  'How much money do I need to restock low items?',
  'Which customers should I reward or win back?',
]

// Minimal markdown: **bold** and "- " bullet lines
function Markdown({ text }) {
  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {text.split('\n').map((line, i) => {
        const bullet = /^\s*[-*•]\s+/.test(line)
        const content = line.replace(/^\s*[-*•]\s+/, '').replace(/^#+\s*/, '')
        const parts = content.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
          part.startsWith('**') && part.endsWith('**') ? <strong key={j}>{part.slice(2, -2)}</strong> : part,
        )
        if (!line.trim()) return <div key={i} className="h-1" />
        return bullet ? (
          <div key={i} className="flex gap-2 pl-1"><span className="text-emerald-600">•</span><span>{parts}</span></div>
        ) : (
          <p key={i}>{parts}</p>
        )
      })}
    </div>
  )
}

export default function Assistant() {
  const [messages, setMessages] = useState([
    { role: 'assistant', text: "Habari! I'm the NyamsComm assistant. I analyse your phones, electronics and accessories stock and sales. Ask me what to restock." },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const ask = async (question) => {
    if (!question.trim() || loading) return
    setMessages((m) => [...m, { role: 'user', text: question }])
    setInput('')
    setLoading(true)
    try {
      const res = await api.ask(question)
      setMessages((m) => [...m, { role: 'assistant', text: res.answer, source: res.source, note: res.note }])
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: `Sorry, something went wrong: ${err.message}` }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <PageHeader title="AI Assistant" subtitle="Restock advice based on your real inventory and sales." />
      <Card className="flex h-[calc(100vh-12rem)] min-h-[28rem] flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : ''}`}>
              {m.role === 'assistant' && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><Bot size={18} /></div>
              )}
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${m.role === 'user' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                {m.role === 'user' ? <p className="text-sm">{m.text}</p> : <Markdown text={m.text} />}
                {m.source && (
                  <p className="mt-2 text-[11px] text-slate-400">
                    {m.source === 'claude' ? '✨ Powered by Claude' : 'Rule-based analysis'}{m.note ? ` · ${m.note}` : ''}
                  </p>
                )}
              </div>
            </div>
          ))}
          {loading && <p className="pl-11 text-sm text-slate-400">Analysing your stock…</p>}
        </div>

        <div className="border-t border-slate-100 p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => ask(s)} disabled={loading} className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-emerald-400 hover:text-emerald-700">
                {s}
              </button>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); ask(input) }} className="flex gap-2">
            <input className={inputClass} placeholder="Ask about your stock…" value={input} onChange={(e) => setInput(e.target.value)} />
            <Button type="submit" disabled={loading || !input.trim()}><Send size={16} /></Button>
          </form>
        </div>
      </Card>
    </>
  )
}
