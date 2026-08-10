import { useState, useEffect } from "react";

export default function AdminLogin() {
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/admin/me")
      .then((res) => res.json())
      .then((data) => setIsAdmin(!!data.isAdmin))
      .catch(() => setIsAdmin(false))
      .finally(() => setChecking(false));
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok) {
          window.location.href = "/";
        } else {
          setError(data.error || "Login failed");
        }
      })
      .catch(() => setError("Login failed"))
      .finally(() => setSubmitting(false));
  };

  const handleLogout = () => {
    fetch("/api/admin/logout", { method: "POST" }).then(() => setIsAdmin(false));
  };

  const containerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    width: "100%",
    fontFamily: "system-ui, sans-serif",
  };

  if (checking) {
    return <div style={containerStyle} />;
  }

  if (isAdmin) {
    return (
      <div style={containerStyle}>
        <div style={{ textAlign: "center" }}>
          <p>You're logged in as admin.</p>
          <button
            onClick={handleLogout}
            style={{
              padding: "10px 16px",
              backgroundColor: "#2e7d32",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Log out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <form
        onSubmit={handleLogin}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          width: "260px",
        }}
      >
        <h2 style={{ margin: "0 0 8px", fontSize: "18px" }}>Admin login</h2>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          style={{
            padding: "10px",
            borderRadius: "8px",
            border: "1px solid #ccc",
            fontSize: "14px",
          }}
        />
        {error && <div style={{ color: "#c62828", fontSize: "13px" }}>{error}</div>}
        <button
          type="submit"
          disabled={submitting}
          style={{
            padding: "10px 16px",
            backgroundColor: submitting ? "#aaa" : "#646cff",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            cursor: submitting ? "not-allowed" : "pointer",
            fontWeight: 500,
          }}
        >
          {submitting ? "Logging in…" : "Log in"}
        </button>
      </form>
    </div>
  );
}
