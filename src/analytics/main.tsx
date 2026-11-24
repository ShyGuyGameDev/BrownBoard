import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { installTokens } from '../design/tokens'
import { initialTheme } from '../lib/theme'
import { AnalyticsPage } from './analytics-page'
import './analytics.css'

installTokens()
document.documentElement.dataset.theme = initialTheme()

// No <Analytics /> here: viewing this page shouldn't add to the numbers it shows.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <AnalyticsPage />
    </QueryClientProvider>
  </StrictMode>,
)
