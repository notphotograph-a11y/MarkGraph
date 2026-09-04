import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/app.css'
import { registerSW } from 'virtual:pwa-register'

// F24.3/F24.5：注册应用壳 SW；autoUpdate——新版本后台预缓存，接管后自动刷新一次
registerSW({ immediate: true })

const saved = localStorage.getItem('mg-theme')
if (saved === 'apple' || saved === 'paper' || saved === 'obsidian' || saved === 'x' || saved === 'meta') {
  document.documentElement.dataset.theme = saved
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
