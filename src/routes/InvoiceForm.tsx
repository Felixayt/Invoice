import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabaseClient'
import type { Client, Invoice } from '../lib/types'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export function InvoiceForm() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [clients, setClients] = useState<Client[] | null>(null)
  const [clientId, setClientId] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!session) return
    supabase
      .from('clients')
      .select('*')
      .order('name', { ascending: true })
      .returns<Client[]>()
      .then(({ data }) => setClients(data ?? []))
  }, [session])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!session) return

    const amountValue = Number(amount)
    if (!clientId) {
      setError('Select a client.')
      return
    }
    if (!description.trim()) {
      setError('Enter a description.')
      return
    }
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setError('Amount must be greater than zero.')
      return
    }
    if (!dueDate || dueDate < todayStr()) {
      setError('Due date cannot be in the past.')
      return
    }

    setLoading(true)
    setError(null)

    const { data: invoice, error: insertError } = await supabase
      .from('invoices')
      .insert({
        owner_id: session.user.id,
        client_id: clientId,
        description: description.trim(),
        amount: amountValue,
        due_date: dueDate,
      })
      .select()
      .single<Invoice>()

    if (insertError || !invoice) {
      setLoading(false)
      setError('Could not schedule reminders. Please try again.')
      return
    }

    const immediate = dueDate <= todayStr()
    if (immediate) {
      // Due date is today: BR-002 sends the pre-due reminder immediately
      // instead of waiting for the daily cron to catch it a day early.
      await supabase.functions.invoke('send-reminders', {
        body: { invoice_id: invoice.id },
      })
    }

    setLoading(false)
    navigate('/', { state: { reminderConfirmation: true, dueDate, immediate } })
  }

  if (clients !== null && clients.length === 0) {
    return (
      <div className="empty-state">
        <p>You need a client before you can create an invoice.</p>
        <Link to="/clients/new" className="btn-primary">
          Add a client
        </Link>
      </div>
    )
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <h1>New invoice</h1>
      {error && <p className="error-message">{error}</p>}
      <div className="form-field">
        <label htmlFor="client">Client</label>
        <select
          id="client"
          required
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          disabled={loading || clients === null}
        >
          <option value="" disabled>
            {clients === null ? 'Loading clients…' : 'Select a client'}
          </option>
          {clients?.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </div>
      <div className="form-field">
        <label htmlFor="description">Description</label>
        <textarea
          id="description"
          required
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={loading}
        />
      </div>
      <div className="form-field">
        <label htmlFor="amount">Amount</label>
        <input
          id="amount"
          type="number"
          step="0.01"
          min="0.01"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={loading}
        />
      </div>
      <div className="form-field">
        <label htmlFor="dueDate">Due date</label>
        <input
          id="dueDate"
          type="date"
          required
          min={todayStr()}
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          disabled={loading}
        />
      </div>
      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? 'Saving…' : 'Save invoice'}
      </button>
    </form>
  )
}
