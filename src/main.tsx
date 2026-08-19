import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/app.css'

const saved = localStorage.getItem('mg-theme')
if (saved === 'apple' || saved === 'paper' || saved === 'obsidian' || saved === 'x' || saved === 'meta') {
  document.documentElement.dataset.theme = saved
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
