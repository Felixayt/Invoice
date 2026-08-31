import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabaseClient'
import type { Client } from '../lib/types'

export function Clients() {
  const { session } = useAuth()
  const [clients, setClients] = useState<Client[] | null>(null)
  const [error, setError] = useState(false)

  const loadClients = useCallback(async () => {
    if (!session) return
    setError(false)
    setClients(null)

    const { data, error: fetchError } = await supabase
      .from('clients')
      .select('*')
      .order('name', { ascending: true })
      .returns<Client[]>()

    if (fetchError) {
      setError(true)
      return
    }

    setClients(data)
  }, [session])

  useEffect(() => {
    loadClients()
  }, [loadClients])

  return (
    <div>
      <div className="page-header">
        <h1>Clients</h1>
        <Link to="/clients/new" className="btn-primary">
          Add client
        </Link>
      </div>

      {error && (
        <div>
          <p className="error-message">Could not load clients.</p>
          <button type="button" className="btn-secondary" onClick={loadClients}>
            Retry
          </button>
        </div>
      )}

      {!error && clients === null && (
        <>
          <div className="skeleton-row" />
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </>
      )}

      {!error && clients !== null && clients.length === 0 && (
        <div className="empty-state">
          <p>No clients yet.</p>
          <Link to="/clients/new" className="btn-primary">
            Add your first client
          </Link>
        </div>
      )}

      {!error && clients !== null && clients.length > 0 && (
        <ul className="client-list">
          {clients.map((client) => (
            <li key={client.id} className="client-row">
              <span>
                <strong>{client.name}</strong>
                <br />
                <span style={{ color: 'var(--color-muted)' }}>
                  {client.email}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
