import { StrictMode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// The home page ships prerendered (Task 1.5): hydrateRoot attaches onto the
// static markup instead of wiping and re-rendering it, so JS-off visitors
// keep the full listing and JS-on visitors see no content flash.
hydrateRoot(document.getElementById('root')!, (
  <StrictMode>
    <App />
  </StrictMode>
))
