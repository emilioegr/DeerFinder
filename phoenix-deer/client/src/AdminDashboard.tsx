import { useState, useEffect } from "react";

interface Sighting {
  _id: string;
  lat: number;
  lng: number;
  description?: string;
  createdAt?: string;
}

interface ImportStats {
  totalSightings: number;
  todaySightings: number;
}

function formatDate(dateString?: string) {
  if (!dateString) return "Unknown";
  return new Date(dateString).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const buttonStyle = (color: string, disabled = false): React.CSSProperties => ({
  padding: "8px 14px",
  backgroundColor: disabled ? "#aaa" : color,
  color: "#fff",
  border: "none",
  borderRadius: "6px",
  cursor: disabled ? "not-allowed" : "pointer",
  fontWeight: 500,
  fontSize: "13px",
});

export default function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [sightings, setSightings] = useState<Sighting[]>([]);
  const [stats, setStats] = useState<ImportStats | null>(null);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchSightings = () => {
    fetch("/api/sightings")
      .then((res) => res.json())
      .then((data: Sighting[]) => setSightings(data))
      .catch((err) => console.error("Failed to fetch sightings:", err));
  };

  const fetchStats = () => {
    fetch("/api/import-stats")
      .then((res) => res.json())
      .then((data) => setStats({ totalSightings: data.totalSightings, todaySightings: data.todaySightings }))
      .catch((err) => console.error("Failed to fetch stats:", err));
  };

  useEffect(() => {
    fetchSightings();
    fetchStats();
  }, []);

  const handleLogout = () => {
    fetch("/api/admin/logout", { method: "POST" }).then(() => onLogout());
  };

  const handleImportGarmin = () => {
    setImporting(true);
    setImportStatus(null);
    fetch("/api/import-garmin", { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setImportStatus(`Imported ${data.inserted} new, ${data.skipped} already existed (${data.total} total)`);
          fetchSightings();
          fetchStats();
        } else {
          setImportStatus(`Error: ${data.error}`);
        }
      })
      .catch(() => setImportStatus("Import failed"))
      .finally(() => setImporting(false));
  };

  const handleUploadGpx = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // allow re-selecting the same file later

    setImporting(true);
    setImportStatus(null);
    const formData = new FormData();
    formData.append("gpxFile", file);

    fetch("/api/import-gpx", { method: "POST", body: formData })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setImportStatus(`Imported ${data.inserted} new, ${data.skipped} already existed (${data.total} total)`);
          fetchSightings();
          fetchStats();
        } else {
          setImportStatus(`Error: ${data.error}`);
        }
      })
      .catch(() => setImportStatus("Upload failed"))
      .finally(() => setImporting(false));
  };

  const startEdit = (sighting: Sighting) => {
    setEditingId(sighting._id);
    setEditValue(sighting.description || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };

  const saveEdit = (id: string) => {
    setSavingId(id);
    fetch(`/api/sightings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: editValue }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok) {
          setSightings((prev) => prev.map((s) => (s._id === id ? data : s)));
          setEditingId(null);
        } else {
          alert(data.error || "Failed to save");
        }
      })
      .catch(() => alert("Failed to save"))
      .finally(() => setSavingId(null));
  };

  const deleteSighting = (id: string) => {
    if (!window.confirm("Delete this sighting? This can't be undone.")) return;
    setDeletingId(id);
    fetch(`/api/sightings/${id}`, { method: "DELETE" })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok) {
          setSightings((prev) => prev.filter((s) => s._id !== id));
          fetchStats();
        } else {
          alert(data.error || "Failed to delete");
        }
      })
      .catch(() => alert("Failed to delete"))
      .finally(() => setDeletingId(null));
  };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: "900px", margin: "0 auto", padding: "24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h1 style={{ fontSize: "20px", margin: 0 }}>Admin</h1>
        <button onClick={handleLogout} style={buttonStyle("#646cff")}>Log out</button>
      </div>

      {stats && (
        <div style={{ display: "flex", gap: "16px", marginBottom: "20px" }}>
          <div style={{ padding: "12px 16px", background: "#f4f4f8", borderRadius: "8px" }}>
            <div style={{ fontSize: "22px", fontWeight: 600 }}>{stats.totalSightings}</div>
            <div style={{ fontSize: "12px", color: "#666" }}>Total sightings</div>
          </div>
          <div style={{ padding: "12px 16px", background: "#f4f4f8", borderRadius: "8px" }}>
            <div style={{ fontSize: "22px", fontWeight: 600 }}>{stats.todaySightings}</div>
            <div style={{ fontSize: "12px", color: "#666" }}>Today</div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px", flexWrap: "wrap" }}>
        <button onClick={handleImportGarmin} disabled={importing} style={buttonStyle("#2e7d32", importing)}>
          {importing ? "Importing…" : "Import Garmin"}
        </button>
        <label style={{ ...buttonStyle("#2e7d32", importing), display: "inline-block" }}>
          {importing ? "Importing…" : "Upload GPX file"}
          <input type="file" accept=".gpx" onChange={handleUploadGpx} disabled={importing} style={{ display: "none" }} />
        </label>
      </div>
      {importStatus && (
        <div style={{ fontSize: "13px", color: "#333", marginBottom: "20px" }}>{importStatus}</div>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #eee" }}>
            <th style={{ padding: "8px 6px" }}>Date</th>
            <th style={{ padding: "8px 6px" }}>Description</th>
            <th style={{ padding: "8px 6px" }}>Coordinates</th>
            <th style={{ padding: "8px 6px" }}></th>
          </tr>
        </thead>
        <tbody>
          {sightings.map((s) => (
            <tr key={s._id} style={{ borderBottom: "1px solid #f0f0f0" }}>
              <td style={{ padding: "8px 6px", whiteSpace: "nowrap", color: "#666" }}>{formatDate(s.createdAt)}</td>
              <td style={{ padding: "8px 6px" }}>
                {editingId === s._id ? (
                  <input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    autoFocus
                    style={{ width: "100%", padding: "4px 6px", borderRadius: "4px", border: "1px solid #ccc" }}
                  />
                ) : (
                  s.description || <span style={{ color: "#999" }}>—</span>
                )}
              </td>
              <td style={{ padding: "8px 6px", whiteSpace: "nowrap", color: "#666", fontSize: "12px" }}>
                {s.lat.toFixed(5)}, {s.lng.toFixed(5)}
              </td>
              <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>
                {editingId === s._id ? (
                  <>
                    <button
                      onClick={() => saveEdit(s._id)}
                      disabled={savingId === s._id}
                      style={{ ...buttonStyle("#2e7d32", savingId === s._id), marginRight: "6px" }}
                    >
                      {savingId === s._id ? "Saving…" : "Save"}
                    </button>
                    <button onClick={cancelEdit} style={buttonStyle("#888")}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => startEdit(s)} style={{ ...buttonStyle("#646cff"), marginRight: "6px" }}>
                      Edit
                    </button>
                    <button
                      onClick={() => deleteSighting(s._id)}
                      disabled={deletingId === s._id}
                      style={buttonStyle("#c62828", deletingId === s._id)}
                    >
                      {deletingId === s._id ? "Deleting…" : "Delete"}
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sightings.length === 0 && (
        <div style={{ color: "#999", padding: "20px 0", textAlign: "center" }}>No sightings yet.</div>
      )}
    </div>
  );
}
