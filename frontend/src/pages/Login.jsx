import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", password: "", name: "", role: "PATIENT" });
  const [error, setError] = useState("");

  function routeForRole(role) {
    if (role === "ADMIN") return "/admin";
    if (role === "DOCTOR") return "/doctor";
    return "/patient";
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      const user = mode === "login" ? await login(form.email, form.password) : await register(form);
      navigate(routeForRole(user.role));
    } catch (err) {
      setError(err.response?.data?.error?.formErrors?.join(", ") || err.response?.data?.error || "Something went wrong");
    }
  }

  return (
    <div className="auth-box card">
      <h2>Clinic Appointment Manager</h2>
      <div className="tabs">
        <button className={mode === "login" ? "primary" : "secondary"} onClick={() => setMode("login")}>Log in</button>
        <button className={mode === "register" ? "primary" : "secondary"} onClick={() => setMode("register")}>Register (Patient)</button>
      </div>
      <form onSubmit={handleSubmit}>
        {mode === "register" && (
          <>
            <label>Full name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </>
        )}
        <label>Email</label>
        <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <label>Password</label>
        <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        {error && <p className="error-text">{error}</p>}
        <button className="primary" type="submit" style={{ width: "100%" }}>
          {mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>
      <p className="muted" style={{ marginTop: 16 }}>
        Demo accounts (after running the seed script): admin@clinic.com / dr.smith@clinic.com / patient@example.com — all use password <code>Password123!</code>
      </p>
    </div>
  );
}
