import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SettingsProvider } from './context/SettingsContext';
import HomePage from './routes/HomePage';
import CategoryPage from './routes/CategoryPage';
import RecordingPage from './routes/RecordingPage';

export default function App() {
  return (
    <SettingsProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/c/:categoryId" element={<CategoryPage />} />
          <Route path="/record" element={<RecordingPage />} />
        </Routes>
      </BrowserRouter>
    </SettingsProvider>
  );
}
