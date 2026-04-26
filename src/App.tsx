import { Routes, Route } from "react-router-dom";
import { HomePage } from "./components/HomePage";
import { RoomPage } from "./components/RoomPage";

function App() {
  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
      </Routes>
    </div>
  );
}

export default App;
