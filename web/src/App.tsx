import { useEffect, useState } from 'react'
import Layout from './components/Layout'
import { LandingPage } from './pages/LandingPage'

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/')
  useEffect(() => {
    const handler = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])
  return hash
}

export default function App() {
  const route = useHashRoute()
  if (route === '#/landing') return <LandingPage />
  return <Layout />
}
