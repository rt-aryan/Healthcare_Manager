import { useEffect, useState } from "react";
import api from "../../api/client";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function AdminPortal() {
  const [doctors, setDoctors] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [tab, setTab] = useState("doctors");
  const [newDoctor, setNewDoctor] = useState({
    email: "", password: "", name: "", specialisation: "", slotDurationMinutes: 30,
  });
  const [leaveForm, setLeaveForm] = useState({}); // doctorId -> date
  const [message, setMessage] = useState("");

  async function loadDoctors() {
    const { data } = await api.get("/admin/doctors");
    setDoctors(data);
  }
  async function loadAppointments() {
    const { data } = await api.get("/admin/appointments");
    setAppointments(data);
  }
  useEffect(() => { loadDoctors(); loadAppointments(); }, []);

  async function createDoctor(e) {
    e.preventDefault();
    await api.post("/admin/doctors", {
      ...newDoctor,
      slotDurationMinutes: Number(newDoctor.slotDurationMinutes),
      workingHours: [
        { dayOfWeek: 1, startTime: "09:00", endTime: "17:00" },
        { dayOfWeek: 2, startTime: "09:00", endTime: "17:00" },
        { dayOfWeek: 3, startTime: "09:00", endTime: "17:00" },
        { dayOfWeek: 4, startTime: "09:00", endTime: "17:00" },
        { dayOfWeek: 5, startTime: "09:00", endTime: "13:00" },
      ],
    });
    setNewDoctor({ email: "", password: "", name: "", specialisation: "", slotDurationMinutes: 30 });
    loadDoctors();
  }

  async function markLeave(doctorId) {
    const date = leaveForm[doctorId];
    if (!date) return;
    const { data } = await api.post(`/admin/doctors/${doctorId}/leave`, { date });
    setMessage(`Leave recorded. ${data.affectedAppointments} affected appointment(s) cancelled and patients notified.`);
    loadDoctors();
    loadAppointments();
  }

  return (
    <div>
      <h2>Admin dashboard</h2>
      <div className="tabs">
        <button className={tab === "doctors" ? "primary" : "secondary"} onClick={() => setTab("doctors")}>Doctors</button>
        <button className={tab === "appointments" ? "primary" : "secondary"} onClick={() => setTab("appointments")}>All appointments</button>
      </div>

      {message && <p className="muted card">{message}</p>}

      {tab === "doctors" && (
        <>
          <div className="card">
            <h3>Add a doctor</h3>
            <form onSubmit={createDoctor}>
              <label>Name</label>
              <input required value={newDoctor.name} onChange={(e) => setNewDoctor({ ...newDoctor, name: e.target.value })} />
              <label>Email</label>
              <input required type="email" value={newDoctor.email} onChange={(e) => setNewDoctor({ ...newDoctor, email: e.target.value })} />
              <label>Temporary password</label>
              <input required type="password" value={newDoctor.password} onChange={(e) => setNewDoctor({ ...newDoctor, password: e.target.value })} />
              <label>Specialisation</label>
              <input required value={newDoctor.specialisation} onChange={(e) => setNewDoctor({ ...newDoctor, specialisation: e.target.value })} />
              <label>Slot duration (minutes)</label>
              <input required type="number" value={newDoctor.slotDurationMinutes} onChange={(e) => setNewDoctor({ ...newDoctor, slotDurationMinutes: e.target.value })} />
              <p className="muted">Default working hours Mon–Fri 9am–5pm (Fri until 1pm) are applied; edit later via the API.</p>
              <button className="primary" type="submit">Create doctor</button>
            </form>
          </div>

          {doctors.map((d) => (
            <div className="card" key={d.id}>
              <h3>{d.user.name} — {d.specialisation}</h3>
              <p className="muted">{d.user.email} · {d.slotDurationMinutes} min slots</p>
              <p><strong>Leave days:</strong> {d.leaveDays.length ? d.leaveDays.map((l) => l.date.slice(0, 10)).join(", ") : "None"}</p>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <label>Mark on leave</label>
                  <input type="date" value={leaveForm[d.id] || ""} onChange={(e) => setLeaveForm({ ...leaveForm, [d.id]: e.target.value })} />
                </div>
                <button className="secondary" onClick={() => markLeave(d.id)}>Mark leave</button>
              </div>
            </div>
          ))}
        </>
      )}

      {tab === "appointments" && (
        <div className="card">
          <table>
            <thead><tr><th>Patient</th><th>Doctor</th><th>When</th><th>Status</th></tr></thead>
            <tbody>
              {appointments.map((a) => (
                <tr key={a.id}>
                  <td>{a.patient.user.name}</td>
                  <td>{a.doctor.user.name}</td>
                  <td>{new Date(a.slotStart).toLocaleString()}</td>
                  <td>{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
