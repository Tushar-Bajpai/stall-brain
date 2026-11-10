import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from './utils/firebase'
import { setActiveUser } from './utils/userScope'
import HomePage from './pages/HomePage'
import LandingPage from './pages/LandingPage'
import ProfilePage from './pages/ProfilePage'
import ForecastPage from './pages/ForecastPage'
import MarketPage from './pages/MarketPage'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'

// FIX-13 (Phase 0): declared at module scope on purpose. Defining it inside the
// App component body made every App re-render create a *new* component type,
// which unmounted and remounted all route children (flicker + lost state).
function RequireAuth({ authReady, isLoggedIn, children }) {
  if (!authReady) return null
  if (!isLoggedIn) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  const location = useLocation()
  const [authReady, setAuthReady] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsLoggedIn(Boolean(user))
      // FIX-3 (Phase 0): all per-user localStorage scoping keys off this id.
      setActiveUser(user?.uid ?? null)
      setAuthReady(true)
    })

    return () => unsubscribe()
  }, [])

  return (
    <div className="relative min-h-screen bg-(--color-bg-base) text-(--color-text-primary)">
      <div className="app-background" />
      <div className="app-grid" />
      <div className="relative z-10 min-h-screen">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            <Routes location={location}>
              <Route path="/" element={<LandingPage />} />
              <Route path="/home" element={<HomePage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              {/* FIX-11 (Phase 0): /setup removed — was a dead redirect to
                  /profile with an unreachable SetupPage behind it. */}
              <Route
                path="/profile"
                element={
                  <RequireAuth authReady={authReady} isLoggedIn={isLoggedIn}>
                    <ProfilePage />
                  </RequireAuth>
                }
              />
              <Route
                path="/forecast"
                element={
                  <RequireAuth authReady={authReady} isLoggedIn={isLoggedIn}>
                    <ForecastPage />
                  </RequireAuth>
                }
              />
              {/* Phase 2: vendor network board — same auth gate as the rest
                  of the app surface. */}
              <Route
                path="/market"
                element={
                  <RequireAuth authReady={authReady} isLoggedIn={isLoggedIn}>
                    <MarketPage />
                  </RequireAuth>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
