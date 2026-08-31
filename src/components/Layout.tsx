import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabaseClient'

export function Layout({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <Link to="/" className="brand">
          Nudge
        </Link>
        {session && (
          <div className="links">
            <Link to="/">Dashboard</Link>
            <Link to="/clients">Clients</Link>
            <Link to="/invoices/new">New invoice</Link>
            <button type="button" className="btn-secondary" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        )}
      </nav>
      <main className="app-main">{children}</main>
    </div>
  )
}
