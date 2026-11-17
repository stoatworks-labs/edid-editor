import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
// Vendored from stoatworks-backend/theme by scripts/sync-theme.sh; loaded first so styles.css layers over it.
import './stoatworks-theme.css'
import './styles.css'
import { registerServiceWorker } from './register-sw.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerServiceWorker()
