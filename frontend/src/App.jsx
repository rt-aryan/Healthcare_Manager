import { Routes, Route, Navigate, Link } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import PatientPortal from "./pages/patient/PatientPortal";
import DoctorPortal from "./pages/doctor/DoctorPortal";
import AdminPortal from "./pages/admin/AdminPortal";

function Protected({ role, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return children;
}

function TopBar() {
  const { user, logout } = useAuth();
  return (
    <div className="topbar">
      <Link to="/">🏥 Clinic Appointment Manager</Link>
      <div className="nav-links">
        {user && <span>{user.name} ({user.role})</span>}
        {user && <button onClick={logout}>Log out</button>}
      </div>
    </div>
  );
}

function Home() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "ADMIN") return <Navigate to="/admin" replace />;
  if (user.role === "DOCTOR") return <Navigate to="/doctor" replace />;
  return <Navigate to="/patient" replace />;
}

export default function App() {
  return (
    <div className="app-shell">
      <TopBar />
      <div className="container">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/calendar-connected" element={<p>Google Calendar connected! You can close this tab and return to the app.</p>} />
          <Route path="/patient" element={<Protected role="PATIENT"><PatientPortal /></Protected>} />
          <Route path="/doctor" element={<Protected role="DOCTOR"><DoctorPortal /></Protected>} />
          <Route path="/admin" element={<Protected role="ADMIN"><AdminPortal /></Protected>} />
        </Routes>
      </div>
    </div>
  );
}
