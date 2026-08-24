import { useEffect, useState } from "react";
import api from "../../api/client";

export default function BookAppointment() {
  const [specialisation, setSpecialisation] = useState("");
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [held, setHeld] = useState(null); // { appointmentId, holdExpiresAt }
  const [symptoms, setSymptoms] = useState("");
  const [error, setError] = useState("");
  const [confirmedInfo, setConfirmedInfo] = useState(null);
  const [loading, setLoading] = useState(false);

  async function searchDoctors() {
    const { data } = await api.get("/doctors/search", { params: { specialisation } });
    setDoctors(data);
  }

  useEffect(() => { searchDoctors(); }, []);

  async function loadSlots(doctor) {
    setSelectedDoctor(doctor);
    setSelectedSlot(null);
    setHeld(null);
    setError("");
    const { data } = await api.get(`/patients/doctors/${doctor.id}/slots`, { params: { date } });
    setSlots(data);
  }

  async function holdSlot(slot) {
    setError("");
    setSelectedSlot(slot);
    try {
      const { data } = await api.post("/patients/appointments/hold", {
        doctorId: selectedDoctor.id,
        slotStart: slot.start,
        slotEnd: slot.end,
      });
      setHeld(data);
    } catch (err) {
      setError(err.response?.data?.error || "Could not hold this slot");
      setSelectedSlot(null);
    }
  }

  async function confirmBooking(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post(`/patients/appointments/${held.appointmentId}/confirm`, { symptoms });
      setConfirmedInfo(data);
      setHeld(null);
      setSelectedSlot(null);
      setSymptoms("");
      loadSlots(selectedDoctor);
    } catch (err) {
      setError(err.response?.data?.error || "Could not confirm booking — the hold may have expired, please pick a slot again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>Book an appointment</h2>

      <div className="card">
        <label>Search by specialisation</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={specialisation} onChange={(e) => setSpecialisation(e.target.value)} placeholder="e.g. General Medicine" />
          <button className="secondary" onClick={searchDoctors}>Search</button>
        </div>
        <table>
          <thead><tr><th>Doctor</th><th>Specialisation</th><th></th></tr></thead>
          <tbody>
            {doctors.map((d) => (
              <tr key={d.id}>
                <td>{d.user.name}</td>
                <td>{d.specialisation}</td>
                <td><button className="secondary" onClick={() => loadSlots(d)}>View slots</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedDoctor && (
        <div className="card">
          <h3>Available slots — Dr. {selectedDoctor.user.name}</h3>
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="secondary" style={{ marginTop: 8 }} onClick={() => loadSlots(selectedDoctor)}>Refresh</button>

          <div className="slot-grid">
            {slots.length === 0 && <p className="muted">No slots available (doctor may be on leave or fully booked).</p>}
            {slots.map((s) => (
              <button
                key={s.start}
                className={`slot-btn ${selectedSlot?.start === s.start ? "selected" : ""}`}
                onClick={() => holdSlot(s)}
              >
                {new Date(s.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </button>
            ))}
          </div>

          {error && <p className="error-text">{error}</p>}

          {held && (
            <form onSubmit={confirmBooking} style={{ marginTop: 16 }}>
              <p className="muted">
                Slot held until {new Date(held.holdExpiresAt).toLocaleTimeString()} — complete the symptom form
                to confirm ({held.holdMinutes} min hold).
              </p>
              <label>Describe your symptoms</label>
              <textarea rows={4} value={symptoms} onChange={(e) => setSymptoms(e.target.value)} required />
              <button className="primary" type="submit" disabled={loading}>
                {loading ? "Confirming..." : "Confirm booking"}
              </button>
            </form>
          )}
        </div>
      )}

      {confirmedInfo && (
        <div className="card">
          <h3>✅ Booking confirmed</h3>
          <p>Appointment with Dr. {confirmedInfo.appointment.doctor.user.name} on{" "}
            {new Date(confirmedInfo.appointment.slotStart).toLocaleString()}</p>
          <p>
            AI-assessed urgency:{" "}
            <span className={`badge ${confirmedInfo.symptomForm.llmUrgency?.toLowerCase()}`}>
              {confirmedInfo.symptomForm.llmUrgency}
            </span>
          </p>
          <p className="muted">Confirmation emails and calendar invites have been queued for you and the doctor.</p>
        </div>
      )}
    </div>
  );
}
