import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './ui/ErrorBoundary'

// A lazy chunk that 404s usually means the site was redeployed while this tab was open:
// reload once to pick up the new build instead of crashing.
window.addEventListener('vite:preloadError', (e) => {
  try {
    if (sessionStorage.getItem('sft:reloaded-for-chunk')) return
    sessionStorage.setItem('sft:reloaded-for-chunk', '1')
  } catch {
    return
  }
  e.preventDefault()
  location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary page>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
