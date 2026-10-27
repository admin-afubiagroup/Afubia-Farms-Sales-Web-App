import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../Firebase/firebase.utils";
import "./staff-monitoring.css";

const TIME_ZONE = "Africa/Lagos";
const SHIFT_START_MINUTES = 8 * 60;

function toDate(value) {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value?.seconds === "number") {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function getRecordDate(record) {
  return toDate(
    record?.timestamp ??
      record?.createdAt ??
      record?.recordedAt ??
      record?.dateTime ??
      record?.loginTimestamp ??
      record?.signInTime
  );
}

function getLocationDate(record) {
  return toDate(
    record?.updatedAt ??
      record?.capturedAt ??
      record?.timestamp ??
      record?.createdAt ??
      record?.recordedAt
  );
}

function getLagosDateKey(date) {
  if (!date) return "";

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function getLagosMonthKey(date) {
  return getLagosDateKey(date).slice(0, 7);
}

function getLagosMinutes(date) {
  if (!date) return null;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return Number(values.hour) * 60 + Number(values.minute);
}

function formatDate(date) {
  if (!date) return "Date not recorded";

  return new Intl.DateTimeFormat("en-NG", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatTime(date) {
  if (!date) return "Time not recorded";

  return new Intl.DateTimeFormat("en-NG", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function getStaffName(record) {
  return (
    record?.staffName ||
    record?.displayName ||
    record?.fullName ||
    record?.employeeName ||
    record?.name ||
    "Unknown staff"
  );
}

function getStaffId(record) {
  return (
    record?.staffId ||
    record?.employeeId ||
    record?.staffCode ||
    record?.employeeCode ||
    record?.userCode ||
    "ID not recorded"
  );
}

function getStaffKey(record) {
  const userId = record?.userId || record?.uid || record?.userUid;

  if (userId) return `user:${String(userId).trim().toLowerCase()}`;

  const staffId =
    record?.staffId ||
    record?.employeeId ||
    record?.staffCode ||
    record?.employeeCode ||
    record?.userCode;

  if (staffId) return `id:${String(staffId).trim().toLowerCase()}`;

  return `name:${normalizeText(getStaffName(record))}`;
}

function getBranchName(record) {
  const branchFields = [
    record?.branchId,
    record?.branch,
    record?.branchName,
    record?.shop,
    record?.shopName,
    record?.assignedBranch,
    record?.workBranch,
    record?.locationBranch,
    record?.store,
  ];

  for (const value of branchFields) {
    const text = normalizeText(value);

    if (text.includes("kara")) return "Kara Shop";
    if (text.includes("ogidan")) return "Ogidan Shop";
  }

  const staffCode = [
    record?.staffId,
    record?.employeeId,
    record?.staffCode,
    record?.employeeCode,
    record?.userCode,
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  if (staffCode.includes("KARA")) return "Kara Shop";
  if (staffCode.includes("OGIDAN")) return "Ogidan Shop";

  return "Branch not assigned";
}

function getEventKind(record) {
  const value = normalizeText(
    record?.eventType ??
      record?.type ??
      record?.action ??
      record?.event ??
      record?.status
  ).replace(/[\s-]+/g, "_");

  if (
    ["sign_in", "signin", "login", "logged_in", "check_in", "checkin"].includes(
      value
    )
  ) {
    return "sign_in";
  }

  if (
    [
      "sign_out",
      "signout",
      "logout",
      "logged_out",
      "check_out",
      "checkout",
    ].includes(value)
  ) {
    return "sign_out";
  }

  return "other";
}

function getEventLabel(record) {
  const kind = getEventKind(record);

  if (kind === "sign_in") return "Sign-in";
  if (kind === "sign_out") return "Sign-out";

  return (
    record?.eventType ||
    record?.type ||
    record?.action ||
    record?.event ||
    "Attendance event"
  );
}

function getAttendanceReview(date) {
  if (!date) {
    return {
      label: "Time unavailable",
      description: "A valid sign-in time was not recorded.",
      className: "attendance-review-neutral",
      type: "neutral",
    };
  }

  const minutes = getLagosMinutes(date);

  if (minutes < 7 * 60) {
    return {
      label: "Very Early Arrival",
      description: "Arrived before 7:00 AM.",
      className: "attendance-review-excellent",
      type: "excellent",
    };
  }

  if (minutes <= 7 * 60 + 50) {
    return {
      label: "Early Shift Start",
      description: "Arrived between 7:00 AM and 7:50 AM.",
      className: "attendance-review-positive",
      type: "positive",
    };
  }

  if (minutes <= SHIFT_START_MINUTES) {
    return {
      label: "On Time",
      description: "Arrived between 7:51 AM and 8:00 AM.",
      className: "attendance-review-ontime",
      type: "ontime",
    };
  }

  return {
    label: "Late Arrival",
    description: "Arrived after 8:00 AM.",
    className: "attendance-review-late",
    type: "late",
  };
}

function getMapsUrl(record) {
  const latitude =
    record?.latitude ?? record?.locationLatitude ?? record?.lat;
  const longitude =
    record?.longitude ?? record?.locationLongitude ?? record?.lng;

  if (
    latitude == null ||
    longitude == null ||
    String(latitude).trim() === "" ||
    String(longitude).trim() === ""
  ) {
    return "";
  }

  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return "";

  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function getLocationDescription(record) {
  return (
    record?.locationAddress ||
    record?.address ||
    record?.locationName ||
    record?.location ||
    ""
  );
}

function getWeekStartKey(dateKey) {
  if (!dateKey) return "";

  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = date.getUTCDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  date.setUTCDate(date.getUTCDate() - daysSinceMonday);

  return date.toISOString().slice(0, 10);
}

function getWeekEndKey(dateKey) {
  if (!dateKey) return "";

  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = date.getUTCDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;

  date.setUTCDate(date.getUTCDate() + daysUntilSunday);

  return date.toISOString().slice(0, 10);
}

function isInSelectedPeriod(date, period, todayKey) {
  if (!date) return false;

  const dateKey = getLagosDateKey(date);

  if (period === "all") return true;
  if (period === "today") return dateKey === todayKey;

  if (period === "week") {
    return (
      dateKey >= getWeekStartKey(todayKey) &&
      dateKey <= getWeekEndKey(todayKey)
    );
  }

  if (period === "month") {
    return getLagosMonthKey(date) === todayKey.slice(0, 7);
  }

  if (period === "year") {
    return dateKey.slice(0, 4) === todayKey.slice(0, 4);
  }

  return true;
}

function StatCard({ label, value, detail, tone = "" }) {
  return (
    <article className={`staff-stat-card ${tone}`}>
      <span className="staff-stat-label">{label}</span>
      <strong className="staff-stat-value">{value}</strong>
      <span className="staff-stat-detail">{detail}</span>
    </article>
  );
}

export default function StaffMonitoringSection() {
  const [attendance, setAttendance] = useState([]);
  const [locations, setLocations] = useState([]);

  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [locationsLoading, setLocationsLoading] = useState(true);

  const [attendanceError, setAttendanceError] = useState("");
  const [locationsError, setLocationsError] = useState("");

  const [branchFilter, setBranchFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState("today");
  const [staffSearch, setStaffSearch] = useState("");

  // Real-time attendance listener.
  useEffect(() => {
    setAttendanceLoading(true);
    setAttendanceError("");

    const unsubscribe = onSnapshot(
      collection(db, "staffAttendance"),
      (snapshot) => {
        const nextRecords = snapshot.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        }));

        setAttendance(nextRecords);
        setAttendanceLoading(false);
        setAttendanceError("");
      },
      (error) => {
        console.error("Staff attendance listener failed:", error);
        setAttendanceError(
          "Attendance records could not be loaded. Check Firestore permissions and the browser console."
        );
        setAttendanceLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Real-time latest-location listener.
  useEffect(() => {
    setLocationsLoading(true);
    setLocationsError("");

    const unsubscribe = onSnapshot(
      collection(db, "staffLocations"),
      (snapshot) => {
        const nextRecords = snapshot.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        }));

        setLocations(nextRecords);
        setLocationsLoading(false);
        setLocationsError("");
      },
      (error) => {
        console.error("Staff location listener failed:", error);
        setLocationsError(
          "Staff locations could not be loaded. Check Firestore permissions and the browser console."
        );
        setLocationsLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const todayKey = getLagosDateKey(new Date());

  // Normalize the attendance records once per data/filter change.
  const filteredAttendance = useMemo(() => {
    return attendance
      .map((record) => {
        const date = getRecordDate(record);

        return {
          ...record,
          _date: date,
          _dateKey: getLagosDateKey(date),
          _kind: getEventKind(record),
          _staffKey: getStaffKey(record),
          _branch: getBranchName(record),
        };
      })
      .filter((record) => record._date)
      .filter((record) =>
        isInSelectedPeriod(record._date, periodFilter, todayKey)
      )
      .filter(
        (record) =>
          branchFilter === "all" || record._branch === branchFilter
      )
      .filter((record) => {
        const search = staffSearch.trim().toLowerCase();
        if (!search) return true;

        return [
          getStaffName(record),
          getStaffId(record),
          record?.email,
          record?.userId,
        ].some((value) => String(value || "").toLowerCase().includes(search));
      })
      .sort((a, b) => b._date.getTime() - a._date.getTime());
  }, [attendance, branchFilter, periodFilter, todayKey, staffSearch]);

  // The first sign-in for each staff member on each day determines the review.
  const dailySignIns = useMemo(() => {
    const firstSignIns = new Map();

    filteredAttendance
      .filter((record) => record._kind === "sign_in")
      .slice()
      .sort((a, b) => a._date.getTime() - b._date.getTime())
      .forEach((record) => {
        const key = `${record._staffKey}|${record._dateKey}`;

        if (!firstSignIns.has(key)) {
          firstSignIns.set(key, {
            ...record,
            _review: getAttendanceReview(record._date),
          });
        }
      });

    return Array.from(firstSignIns.values());
  }, [filteredAttendance]);

  const dailyReviewMap = useMemo(() => {
    const result = new Map();

    dailySignIns.forEach((record) => {
      result.set(
        `${record._staffKey}|${record._dateKey}`,
        record._review
      );
    });

    return result;
  }, [dailySignIns]);

  // Cards are calculated from the same filtered records shown in the table.
  const summary = useMemo(() => {
    const signIns = filteredAttendance.filter(
      (record) => record._kind === "sign_in"
    );
    const signOuts = filteredAttendance.filter(
      (record) => record._kind === "sign_out"
    );

    const early = dailySignIns.filter(
      (record) =>
        record._review.type === "excellent" ||
        record._review.type === "positive"
    ).length;

    const onTime = dailySignIns.filter(
      (record) => record._review.type === "ontime"
    ).length;

    const late = dailySignIns.filter(
      (record) => record._review.type === "late"
    ).length;

    const daysWithSignIn = new Set(
      dailySignIns.map((record) => record._dateKey)
    ).size;

    return {
      totalSignIns: signIns.length,
      early,
      onTime,
      late,
      daysWithSignIn,
      signOuts: signOuts.length,
    };
  }, [filteredAttendance, dailySignIns]);

  const latestLocations = useMemo(() => {
    const byStaff = new Map();

    locations
      .map((record) => ({
        ...record,
        _date: getLocationDate(record),
        _staffKey: getStaffKey(record),
        _branch: getBranchName(record),
      }))
      .filter((record) => record._date)
      .filter((record) => isInSelectedPeriod(record._date, periodFilter, todayKey))
      .filter(
        (record) =>
          branchFilter === "all" || record._branch === branchFilter
      )
      .sort((a, b) => b._date.getTime() - a._date.getTime())
      .forEach((record) => {
        if (!byStaff.has(record._staffKey)) {
          byStaff.set(record._staffKey, record);
        }
      });

    return Array.from(byStaff.values());
  }, [locations, branchFilter, periodFilter, todayKey]);

  const handleExportAttendance = () => {
    const headers = [
      "Date",
      "Time",
      "Staff name",
      "Staff ID",
      "Email",
      "Branch",
      "Event",
      "Location",
      "Latitude",
      "Longitude",
      "GPS accuracy (m)",
      "Punctuality review",
    ];

    const csvCell = (value) =>
      `"${String(value ?? "").replace(/"/g, '""')}"`;

    const rows = filteredAttendance.map((record) => {
      const reviewKey = `${record._staffKey}|${record._dateKey}`;
      const review =
        record._kind === "sign_in"
          ? dailyReviewMap.get(reviewKey)
          : null;

      return [
        formatDate(record._date),
        formatTime(record._date),
        getStaffName(record),
        getStaffId(record),
        record.email || "",
        record._branch,
        getEventLabel(record),
        getLocationDescription(record),
        record.latitude ?? record.locationLatitude ?? "",
        record.longitude ?? record.locationLongitude ?? "",
        record.accuracy ?? record.locationAccuracy ?? "",
        review?.label || "",
      ].map(csvCell).join(",");
    });

    const csv = [headers.map(csvCell).join(","), ...rows].join("\r\n");
    const blob = new Blob(["\ufeff", csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const branchLabel = branchFilter === "all" ? "all-branches" : branchFilter.toLowerCase().replace(/\s+/g, "-");
    const dateLabel = todayKey;
    link.href = url;
    link.download = `afubia-attendance-${branchLabel}-${dateLabel}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const periodLabel = {
    today: "Today",
    week: "This week",
    month: "This month",
    year: "This year",
    all: "All time",
  }[periodFilter];

  return (
    <section className="staff-monitoring">
      <header className="staff-monitoring-header">
        <div>
          <span className="staff-monitoring-eyebrow">
            AFUBIA FARMS · ADMIN
          </span>
          <h2>Staff Monitoring</h2>
          <p>
            Review attendance, punctuality and the latest reported staff
            locations.
          </p>
        </div>

        <div className="staff-live-indicator">
          <span className="staff-live-dot" />
          Live Firestore updates
        </div>
      </header>

      <div className="staff-monitoring-filters">
        <label>
          <span>Branch</span>
          <select
            value={branchFilter}
            onChange={(event) => setBranchFilter(event.target.value)}
          >
            <option value="all">All branches</option>
            <option value="Kara Shop">Kara Shop</option>
            <option value="Ogidan Shop">Ogidan Shop</option>
          </select>
        </label>

        <label>
          <span>Attendance period</span>
          <select
            value={periodFilter}
            onChange={(event) => setPeriodFilter(event.target.value)}
          >
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="year">This year</option>
            <option value="all">All time</option>
          </select>
        </label>

        <label>
          <span>Individual staff report</span>
          <input
            type="search"
            value={staffSearch}
            onChange={(event) => setStaffSearch(event.target.value)}
            placeholder="Search name, staff ID or email"
          />
        </label>

        <button
          type="button"
          className="staff-export-button"
          onClick={handleExportAttendance}
          disabled={filteredAttendance.length === 0}
        >
          Export attendance CSV
        </button>
      </div>

      {attendanceError && (
        <div className="staff-alert staff-alert-error" role="alert">
          {attendanceError}
        </div>
      )}

      <div className="staff-section-heading">
        <div>
          <h3>Attendance summary</h3>
          <p>
            {periodLabel} · {branchFilter === "all" ? "All branches" : branchFilter}
          </p>
        </div>

        <span className="staff-record-count">
          {attendanceLoading
            ? "Loading records…"
            : `${filteredAttendance.length} attendance record${
                filteredAttendance.length === 1 ? "" : "s"
              }`}
        </span>
      </div>

      <div className="staff-attendance-summary">
        <StatCard
          label="Total sign-ins"
          value={attendanceLoading ? "—" : summary.totalSignIns}
          detail="Sign-in events in the selected period"
        />

        <StatCard
          label="Early arrivals"
          value={attendanceLoading ? "—" : summary.early}
          detail="Before 7:51 AM"
          tone="attendance-card-positive"
        />

        <StatCard
          label="On time"
          value={attendanceLoading ? "—" : summary.onTime}
          detail="7:51 AM–8:00 AM"
          tone="attendance-card-ontime"
        />

        <StatCard
          label="Late arrivals"
          value={attendanceLoading ? "—" : summary.late}
          detail="After 8:00 AM"
          tone="attendance-card-late"
        />

        <StatCard
          label="Days with sign-in"
          value={attendanceLoading ? "—" : summary.daysWithSignIn}
          detail="Distinct dates with a sign-in"
        />

        <StatCard
          label="Total sign-outs"
          value={attendanceLoading ? "—" : summary.signOuts}
          detail="Sign-out events in the selected period"
        />
      </div>

      <div className="staff-monitoring-panel">
        <div className="staff-section-heading">
          <div>
            <h3>Attendance records</h3>
            <p>
              Punctuality is based on each staff member’s first sign-in
              of the day.
            </p>
          </div>
        </div>

        {attendanceLoading ? (
          <div className="staff-empty-state">Loading attendance records…</div>
        ) : filteredAttendance.length === 0 ? (
          <div className="staff-empty-state">
            <strong>No attendance records found</strong>
            <span>
              Try another period or branch. If records should be here,
              verify that they are being saved in the staffAttendance
              Firestore collection.
            </span>
          </div>
        ) : (
          <div className="staff-table-wrap">
            <table className="staff-attendance-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Staff</th>
                  <th>Branch</th>
                  <th>Event</th>
                  <th>Punctuality review</th>
                  <th>Recorded location</th>
                </tr>
              </thead>

              <tbody>
                {filteredAttendance.map((record) => {
                  const reviewKey = `${record._staffKey}|${record._dateKey}`;
                  const review =
                    record._kind === "sign_in"
                      ? dailyReviewMap.get(reviewKey)
                      : null;

                  const mapUrl = getMapsUrl(record);
                  const locationText = getLocationDescription(record);

                  return (
                    <tr key={record.id}>
                      <td>{formatDate(record._date)}</td>
                      <td className="staff-time-cell">
                        {formatTime(record._date)}
                      </td>

                      <td>
                        <div className="staff-identity">
                          <strong>{getStaffName(record)}</strong>
                          <span>{getStaffId(record)}</span>
                        </div>
                      </td>

                      <td>
                        <span className="staff-branch-badge">
                          {record._branch}
                        </span>
                      </td>

                      <td>
                        <span
                          className={`staff-event-badge staff-event-${record._kind}`}
                        >
                          {getEventLabel(record)}
                        </span>
                      </td>

                      <td>
                        {review ? (
                          <div
                            className={`attendance-review ${review.className}`}
                          >
                            <strong>{review.label}</strong>
                            <span>{review.description}</span>
                          </div>
                        ) : record._kind === "sign_out" ? (
                          <span className="staff-muted">Not applicable</span>
                        ) : (
                          <span className="staff-muted">
                            No review available
                          </span>
                        )}
                      </td>

                      <td>
                        <div className="staff-location-cell">
                          {locationText && <span>{locationText}</span>}
                          {mapUrl ? (
                            <a
                              href={mapUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View map
                            </a>
                          ) : (
                            !locationText && (
                              <span className="staff-muted">
                                No location attached
                              </span>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="staff-monitoring-panel">
        <div className="staff-section-heading">
          <div>
            <h3>Latest staff locations</h3>
            <p>
              Most recent location report for each staff member, where
              location records are available.
            </p>
          </div>

          <span className="staff-record-count">
            {locationsLoading
              ? "Loading locations…"
              : `${latestLocations.length} staff location${
                  latestLocations.length === 1 ? "" : "s"
                }`}
          </span>
        </div>

        {locationsError && (
          <div className="staff-alert staff-alert-error" role="alert">
            {locationsError}
          </div>
        )}

        {locationsLoading ? (
          <div className="staff-empty-state">Loading staff locations…</div>
        ) : latestLocations.length === 0 ? (
          <div className="staff-empty-state">
            <strong>No staff location reports found</strong>
            <span>
              This section updates when documents are added or changed in
              the staffLocations collection.
            </span>
          </div>
        ) : (
          <div className="staff-locations-grid">
            {latestLocations.map((record) => {
              const mapUrl = getMapsUrl(record);
              const locationText = getLocationDescription(record);
              const accuracy =
                record?.accuracy != null &&
                String(record.accuracy).trim() !== ""
                  ? `${record.accuracy} m`
                  : "";

              return (
                <article
                  className="staff-location-card"
                  key={record.id}
                >
                  <div className="staff-location-card-top">
                    <div className="staff-location-avatar">
                      {getStaffName(record).charAt(0).toUpperCase()}
                    </div>

                    <div className="staff-identity">
                      <strong>{getStaffName(record)}</strong>
                      <span>{getStaffId(record)}</span>
                    </div>
                  </div>

                  <div className="staff-location-meta">
                    <span>Branch</span>
                    <strong>{record._branch}</strong>
                  </div>

                  <div className="staff-location-meta">
                    <span>Last reported</span>
                    <strong>
                      {formatDate(record._date)} · {formatTime(record._date)}
                    </strong>
                  </div>

                  {locationText && (
                    <div className="staff-location-address">
                      {locationText}
                    </div>
                  )}

                  {accuracy && (
                    <div className="staff-location-meta">
                      <span>GPS accuracy</span>
                      <strong>{accuracy}</strong>
                    </div>
                  )}

                  {mapUrl ? (
                    <a
                      className="staff-map-link"
                      href={mapUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open in Google Maps ↗
                    </a>
                  ) : (
                    <span className="staff-muted">
                      Coordinates not available
                    </span>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}