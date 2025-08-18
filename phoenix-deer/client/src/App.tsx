import React, { useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Deer icon
const deerIcon = new L.Icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/128/2267/2267459.png",
  iconSize: [45, 45],
  iconAnchor: [17, 35],
  popupAnchor: [0, -35],
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  shadowSize: [41, 41],
  shadowAnchor: [14, 41],
});

interface Sighting {
  _id?: string;
  lat: number;
  lng: number;
  description?: string;
  createdAt?: string;
}

export default function App() {
  const [markers, setMarkers] = useState<Sighting[]>([]);

  // Fetch sightings from backend on load
  useEffect(() => {
    fetch("http://localhost:5050/api/sightings")
      .then(res => res.json())
      .then((data: Sighting[]) => setMarkers(data))
      .catch(err => console.error("Failed to fetch sightings:", err));
  }, []);

  function AddMarkerOnClick() {
    useMapEvents({
      click(e) {
        const desc = prompt("Add a description for this deer sighting:", "🦌 Deer spotted here!");
        if (!desc) return;

        const newSighting = {
          lat: e.latlng.lat,
          lng: e.latlng.lng,
          description: desc,
        };

        // Save to backend
        fetch("http://localhost:5050/api/sightings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newSighting),
        })
          .then(res => res.json())
          .then((saved: Sighting) => setMarkers(prev => [...prev, saved]))
          .catch(err => console.error("Failed to save sighting:", err));
      },
    });
    return null;
  }

  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }
    navigator.geolocation.getCurrentPosition(position => {
      const { latitude, longitude } = position.coords;

      const newSighting = {
        lat: latitude,
        lng: longitude,
        description: "You spotted a deer here!",
      };

      fetch("http://localhost:5050/api/sightings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSighting),
      })
        .then(res => res.json())
        .then((saved: Sighting) => setMarkers(prev => [...prev, saved]))
        .catch(err => console.error("Failed to save sighting:", err));
    });
  };
  
  return (
    <div style={{ height: "100%", width: "100%" }}>
      <button
        onClick={handleLocateMe}
        style={{
          position: "absolute",
          bottom: 40,
          left: 20,
          zIndex: 1000,
          padding: "10px 16px",
          backgroundColor: "#646cff",
          color: "#fff",
          border: "none",
          borderRadius: "8px",
          cursor: "pointer",
          fontWeight: 500,
        }}
      >
        Found a deer here!
      </button>
      <div
    style={{
      position: "absolute",
      bottom: 0,
      left: 0,
      padding: "6px 10px",
      fontSize: "12px",
      backgroundColor: "rgba(255, 255, 255, 0.8)",
      borderTopRightRadius: "6px",
      zIndex: 1000,
    }}
  >
    <a
      href="https://www.flaticon.com/free-icons/deer"
      title="deer icons"
      style={{ color: "#333", textDecoration: "none" }}
      target="_blank"
      rel="noopener noreferrer"
    >
      Deer icons created by max.icons - Flaticon
    </a>
  </div>
      <MapContainer center={[53.356, -6.329]} zoom={15} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />
        {markers.map((m, idx) => (
          <Marker key={m._id || idx} position={[m.lat, m.lng]} icon={deerIcon}>
            <Popup>
              <div>
                <strong>{m.description}</strong>
                <br />
                Last seen: {m.createdAt ? new Date(m.createdAt).toLocaleString() : "Unknown"}
              </div>
            </Popup>
          </Marker>
        ))}
        <AddMarkerOnClick />
      </MapContainer>
    </div>
  );
}
