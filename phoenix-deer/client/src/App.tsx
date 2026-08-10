import React, { useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// 🦌 Deer icon
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

// 🔢 Cluster icon (number of sightings)
function createClusterIcon(count: number) {
  return new L.DivIcon({
    html: `<div style="
      background:#ff5722;
      color:white;
      font-weight:bold;
      border-radius:50%;
      width:40px;
      height:40px;
      display:flex;
      align-items:center;
      justify-content:center;
      border:2px solid white;
      box-shadow:0 0 4px rgba(0,0,0,0.4);
    ">${count}</div>`,
    className: "",
    iconSize: [40, 40],
  });
}

// Haversine formula to calculate distance in meters
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000; // meters
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface Sighting {
  _id?: string;
  lat: number;
  lng: number;
  description?: string;
  createdAt?: string;
}

type DateFilter = "today" | "month" | "year" | "all";

function formatDate(dateString?: string) {
  if (!dateString) return "Unknown";
  return new Date(dateString).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function App() {
  const [markers, setMarkers] = useState<Sighting[]>([]);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  const [isAdmin, setIsAdmin] = useState(false);

  const fetchSightings = () => {
    fetch("/api/sightings")
      .then((res) => res.json())
      .then((data: Sighting[]) => setMarkers(data))
      .catch((err) => console.error("Failed to fetch sightings:", err));
  };

  useEffect(() => {
    fetchSightings();
    fetch("/api/admin/me")
      .then((res) => res.json())
      .then((data) => setIsAdmin(!!data.isAdmin))
      .catch(() => setIsAdmin(false));
  }, []);

  const handleImportGarmin = () => {
    setImporting(true);
    setImportStatus(null);
    fetch("/api/import-garmin", { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setImportStatus(`Imported ${data.inserted} new, ${data.skipped} already existed (${data.total} total)`);
          fetchSightings();
        } else {
          setImportStatus(`Error: ${data.error}`);
        }
      })
      .catch(() => setImportStatus("Import failed"))
      .finally(() => setImporting(false));
  };

  // ✅ Add new marker on map click
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

        fetch("/api/sightings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newSighting),
        })
          .then((res) => res.json())
          .then((saved: Sighting) => setMarkers((prev) => [...prev, saved]))
          .catch((err) => console.error("Failed to save sighting:", err));
      },
    });
    return null;
  }

  // ✅ "Found a deer here!" button
  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }
    navigator.geolocation.getCurrentPosition((position) => {
      const { latitude, longitude } = position.coords;

      const newSighting = {
        lat: latitude,
        lng: longitude,
        description: "You spotted a deer here!",
      };

      fetch("/api/sightings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSighting),
      })
        .then((res) => res.json())
        .then((saved: Sighting) => setMarkers((prev) => [...prev, saved]))
        .catch((err) => console.error("Failed to save sighting:", err));
    });
  };

  // ✅ Group sightings within 10 meters
  function groupSightings(sightings: Sighting[]) {
    const groups: { lat: number; lng: number; items: Sighting[] }[] = [];

    sightings.forEach((s) => {
      let found = false;
      for (const g of groups) {
        if (getDistance(s.lat, s.lng, g.lat, g.lng) < 100) {
          g.items.push(s);
          found = true;
          break;
        }
      }
      if (!found) {
        groups.push({ lat: s.lat, lng: s.lng, items: [s] });
      }
    });

    return groups;
  }

  const filteredMarkers = markers.filter((s) => {
    if (dateFilter === "all" || !s.createdAt) return true;
    const d = new Date(s.createdAt);
    const now = new Date();
    if (dateFilter === "today") return d.toDateString() === now.toDateString();
    if (dateFilter === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    return d.getFullYear() === now.getFullYear();
  });

  const grouped = groupSightings(filteredMarkers);

  return (
    <div style={{ height: "100%", width: "100%" }}>
      {/* 📍 Locate button */}
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

      {/* 🗂 Import Garmin button - admin only */}
      {isAdmin && (
        <button
          onClick={handleImportGarmin}
          disabled={importing}
          style={{
            position: "absolute",
            bottom: 40,
            left: 170,
            zIndex: 1000,
            padding: "10px 16px",
            backgroundColor: importing ? "#aaa" : "#2e7d32",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            cursor: importing ? "not-allowed" : "pointer",
            fontWeight: 500,
          }}
        >
          {importing ? "Importing…" : "Import Garmin"}
        </button>
      )}

      {/* Import status message */}
      {importStatus && (
        <div
          style={{
            position: "absolute",
            bottom: 90,
            left: 20,
            zIndex: 1000,
            padding: "8px 14px",
            backgroundColor: "rgba(0,0,0,0.75)",
            color: "#fff",
            borderRadius: "6px",
            fontSize: "13px",
            maxWidth: "320px",
          }}
        >
          {importStatus}
        </div>
      )}

      {/* 📅 Date filter */}
      <div
        style={{
          position: "absolute",
          top: 20,
          right: 20,
          zIndex: 1000,
          backgroundColor: "rgba(255,255,255,0.95)",
          borderRadius: "10px",
          padding: "8px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          display: "flex",
          gap: "6px",
        }}
      >
        {(["today", "month", "year", "all"] as DateFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setDateFilter(f)}
            style={{
              padding: "6px 12px",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: 500,
              fontSize: "13px",
              backgroundColor: dateFilter === f ? "#646cff" : "#eee",
              color: dateFilter === f ? "#fff" : "#333",
              transition: "background 0.15s",
            }}
          >
            {f === "today" ? "Today" : f === "month" ? "This Month" : f === "year" ? "This Year" : "All"}
          </button>
        ))}
      </div>

      {/* Attribution */}
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

      {/* 🗺 Map */}
      <MapContainer center={[53.356, -6.329]} zoom={15} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />

        {/* Render groups */}
          {grouped.map((g, idx) =>
            g.items.length === 1 ? (
              <Marker
                key={g.items[0]._id || idx}
                position={[g.lat, g.lng]}
                icon={deerIcon}
              >
                <Tooltip direction="top" offset={[0, -38]}>
                  <span>Seen: {formatDate(g.items[0].createdAt)}</span>
                </Tooltip>
                <Popup>
                  <div>
                    <strong>{g.items[0].description}</strong>
                    <br />
                    {formatDate(g.items[0].createdAt)}
                  </div>
                </Popup>
              </Marker>
            ) : (
              <Marker
                key={idx}
                position={[g.lat, g.lng]}
                icon={createClusterIcon(g.items.length)}
              >
                <Tooltip direction="top" offset={[0, -22]}>
                  <div>
                    <strong>{g.items.length} sightings nearby</strong>
                    <br />
                    {[...new Set(g.items.map((s) => formatDate(s.createdAt)))]
                      .sort()
                      .map((d) => <div key={d}>{d}</div>)}
                  </div>
                </Tooltip>
                <Popup>
                  <div>
                    <strong>{g.items.length} deer sightings nearby</strong>
                    <br />
                    {[...new Set(g.items.map((s) => formatDate(s.createdAt)))]
                      .sort()
                      .map((d) => <div key={d}>{d}</div>)}
                  </div>
                </Popup>
              </Marker>
            )
          )}


        <AddMarkerOnClick />
      </MapContainer>
    </div>
  );
}
