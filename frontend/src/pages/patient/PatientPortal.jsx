import { useState } from "react";
import BookAppointment from "./BookAppointment";
import MyAppointments from "./MyAppointments";
import CalendarConnect from "../../components/CalendarConnect";

export default function PatientPortal() {
  const [tab, setTab] = useState("book");
  return (
    <div>
      <div className="tabs">
        <button className={tab === "book" ? "primary" : "secondary"} onClick={() => setTab("book")}>Book appointment</button>
        <button className={tab === "mine" ? "primary" : "secondary"} onClick={() => setTab("mine")}>My appointments</button>
      </div>
      <CalendarConnect />
      {tab === "book" ? <BookAppointment /> : <MyAppointments />}
    </div>
  );
}
