import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources } from '../shared/i18n'
import { queries } from './lib/sync'
import { App } from './App'
import './styles.css'

void i18next
  .use(initReactI18next)
  .init({
    resources,
    lng: 'zh',
    fallbackLng: 'en',
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  .then(() => {
    createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <QueryClientProvider client={queries}>
          <App />
        </QueryClientProvider>
      </React.StrictMode>,
    )
  })
