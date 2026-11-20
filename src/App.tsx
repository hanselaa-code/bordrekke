import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { HomeView } from './views/HomeView';
import { HostView } from './views/HostView';
import { PlayerView } from './views/PlayerView';

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomeView />} />
        <Route path="/host/:roomId" element={<HostView />} />
        <Route path="/play/:roomId" element={<PlayerView />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}

export default App;
