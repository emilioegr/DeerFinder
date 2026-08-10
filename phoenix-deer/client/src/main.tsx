import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AdminLogin from './AdminLogin';
import './index.css';
import 'leaflet/dist/leaflet.css';   // ✅ Leaflet styles

// No router library - this app is two pages, so a plain pathname check is
// enough. /admin isn't linked from anywhere in the public UI.
const page = window.location.pathname === '/admin' ? <AdminLogin /> : <App />;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {page}
  </React.StrictMode>
);
