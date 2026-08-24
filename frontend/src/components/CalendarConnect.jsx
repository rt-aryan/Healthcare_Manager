import api from "../api/client";

export default function CalendarConnect() {
  async function connect() {
    const { data } = await api.get("/calendar/oauth/start");
    window.location.href = data.url;
  }
  return (
    <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span className="muted">Connect Google Calendar to auto-sync your appointments.</span>
      <button className="secondary" onClick={connect}>Connect Google Calendar</button>
    </div>
  );
}
