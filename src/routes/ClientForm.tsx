import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabaseClient'

export function ClientForm() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!session) return

    if (!name.trim() || !email.trim()) {
      setError('Name and email are required.')
      return
    }

    setLoading(true)
    setError(null)

    const { error: insertError } = await supabase.from('clients').insert({
      owner_id: session.user.id,
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim() || null,
    })

    setLoading(false)

    if (insertError) {
      if (insertError.code === '23505') {
        setError('You already have a client with that email.')
      } else {
        setError('Could not save client. Please try again.')
      }
      return
    }

    navigate('/clients')
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <h1>Add client</h1>
      {error && <p className="error-message">{error}</p>}
      <div className="form-field">
        <label htmlFor="name">Name</label>
        <input
          id="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={loading}
        />
      </div>
      <div className="form-field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
        />
      </div>
      <div className="form-field">
        <label htmlFor="phone">Phone</label>
        <input
          id="phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={loading}
        />
      </div>
      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? 'Saving…' : 'Save client'}
      </button>
    </form>
  )
}
