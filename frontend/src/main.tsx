import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "leaflet/dist/leaflet.css";
import "./index.css";
import Home from "./pages/Home";
import Dna from "./pages/Dna";
import Compose from "./pages/Compose";
import TripPage from "./pages/Trip";
import Live from "./pages/Live";
import CapsulePage from "./pages/Capsule";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/dna" element={<Dna />} />
        <Route path="/compose" element={<Compose />} />
        <Route path="/trip/:id" element={<TripPage />} />
        <Route path="/trip/:id/live" element={<Live />} />
        <Route path="/trip/:id/capsule" element={<CapsulePage />} />
        <Route path="/share/:id" element={<TripPage readOnly />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
