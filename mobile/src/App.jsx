import React, { useState, useEffect } from 'react'
import Auth from './components/Auth'
import Home from './components/Home'
import { AuthProvider } from './context/AuthContext'

function App() {
  const [currentUser, setCurrentUser] = useState(null)

  useEffect(() => {
    const user = localStorage.getItem('user')
    const token = localStorage.getItem('token')
    if (user && token) {
      setCurrentUser(JSON.parse(user))
    }
  }, [])

  const handleLogin = (user, token) => {
    setCurrentUser(user)
    localStorage.setItem('user', JSON.stringify(user))
    localStorage.setItem('token', token)
  }

  const handleLogout = () => {
    setCurrentUser(null)
    localStorage.removeItem('user')
    localStorage.removeItem('token')
  }

  return (
    <AuthProvider value={{ currentUser, onLogin: handleLogin, onLogout: handleLogout }}>
      <div className="App">
        {!currentUser ? (
          <Auth />
        ) : (
          <Home onLogout={handleLogout} />
        )}
      </div>
    </AuthProvider>
  )
}

export default App