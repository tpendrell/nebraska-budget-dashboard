import React from 'react'
import ReactDOM from 'react-dom/client'
import NebraskaBudgetDashboard from './NebraskaPublicBudgetDashboard'

// This connects your React code to the <div id="root"></div> in your index.html
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <NebraskaBudgetDashboard />
  </React.StrictMode>,
)

