import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import './devboard.css'
import { installTokens } from './design/tokens'
import { initialTheme } from './lib/theme'

installTokens()
document.documentElement.dataset.theme = initialTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
