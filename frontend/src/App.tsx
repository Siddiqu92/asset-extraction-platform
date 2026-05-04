import React from 'react';
import './App.css';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Navbar } from './components/Navbar';
import { UploadPage } from './pages/UploadPage';
import { AssetsPage } from './pages/AssetsPage';
import { ReviewPage } from './pages/ReviewPage';

function App() {
  return (
    <div className="App">
      <Navbar />
      <Toaster
        position="top-right"
        toastOptions={{
          style: { background: '#111827', color: '#e5e7eb', border: '1px solid #1f2937' },
        }}
      />
      <Routes>
        <Route path="/" element={<Navigate to="/upload" replace />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/assets" element={<AssetsPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="*" element={<Navigate to="/upload" replace />} />
      </Routes>
    </div>
  );
}

export default App;
