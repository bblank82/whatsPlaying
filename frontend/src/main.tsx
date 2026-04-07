import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installDemoMock } from './demo/mockApi.ts'

if (new URLSearchParams(window.location.search).has('demo')) {
  installDemoMock();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
