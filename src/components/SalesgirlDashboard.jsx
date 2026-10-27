
/* eslint-disable no-unused-vars */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useNavigate } from "react-router-dom";

import {
  onAuthStateChanged,
  signOut,
} from "firebase/auth";

import {
  addDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";

import { getUserProfile } from "../utils/auth";
import ResponsiveLayout from "./ResponsiveLayout";

import {
  playOnPageOpen,
  stopAllAudio,
} from "./AudioManager";

import { auth, db } from "../Firebase/firebase.utils";

import "./dashboard.css";

import Containers from "../assets/oil_containers.jpg";
import OilTurning from "../assets/palm_oil_turning.jpg";

const LOCATION_PERMISSION_KEY =
  "afubiaLocationPermissionExplained";

const LAGOS_TIME_ZONE = "Africa/Lagos";

const STAFF_START_HOUR = 8;
const STAFF_END_HOUR = 18;

/*
 * BUSINESS HOURS
 *
 * Nigeria time: 8:00 AM to before 6:00 PM.
 */
function getLagosTimeParts() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LAGOS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  return Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
}

function isWithinStaffHours() {
  const { hour } = getLagosTimeParts();
  const currentHour = Number(hour);

  return (
    currentHour >= STAFF_START_HOUR &&
    currentHour < STAFF_END_HOUR
  );
}

/*
 * ADMIN DETECTION
 */
function isAdminProfile(user, profile) {
  const role = String(
    profile?.role ||
      profile?.userRole ||
      user?.role ||
      ""
  )
    .trim()
    .toLowerCase();

  const adminRoles = [
    "admin",
    "administrator",
    "superadmin",
    "super_admin",
  ];

  return (
    adminRoles.includes(role) ||
    String(user?.email || "")
      .trim()
      .toLowerCase() ===
      "chukwuamakanwachukwu@outlook.com"
  );
}

/*
 * NORMALIZE STAFF BRANCHES
 */
function normalizeBranch(value) {
  const branch = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (["kara", "kara shop"].includes(branch)) {
    return {
      branchId: "kara",
      branchName: "Kara Shop",
    };
  }

  if (["ogidan", "ogidan shop"].includes(branch)) {
    return {
      branchId: "ogidan",
      branchName: "Ogidan Shop",
    };
  }

  return {
    branchId: "",
    branchName: "",
  };
}

/*
 * DISPLAY NAME
 *
 * Always use the profile belonging to the authenticated UID.
 * Do not use a shared localStorage display-name key.
 */
function getDisplayName(user, profile) {
  return (
    String(profile?.displayName || "").trim() ||
    String(profile?.fullName || "").trim() ||
    String(profile?.name || "").trim() ||
    String(user?.displayName || "").trim() ||
    String(user?.email || "").split("@")[0] ||
    "Afubia User"
  );
}

/*
 * RECORD STAFF SIGN-OUT
 *
 * The Firestore rules must permit these fields:
 *
 * userId
 * staffId
 * staffName
 * branchId
 * branchName
 * eventType
 * timestamp
 * locationLatitude (optional)
 * locationLongitude (optional)
 * locationAccuracy (optional)
 */
async function recordStaffSignOut(
  user,
  profile,
  locationDetails,
  displayName
) {
  if (
    !user?.uid ||
    !profile ||
    isAdminProfile(user, profile)
  ) {
    return;
  }

  const rawBranch =
    profile.branchId ||
    profile.branch ||
    profile.branchName ||
    "";

  const { branchId, branchName } =
    normalizeBranch(rawBranch);

  if (!branchId) {
    throw new Error(
      "Your staff profile has no valid branch assignment. Please contact the admin."
    );
  }

  const attendanceRecord = {
    userId: user.uid,

    staffId: String(
      profile.staffId ||
        profile.employeeId ||
        user.uid
    ),

    staffName:
      String(profile.displayName || "").trim() ||
      String(profile.fullName || "").trim() ||
      String(profile.name || "").trim() ||
      String(displayName || "").trim() ||
      String(user.displayName || "").trim() ||
      "Staff member",

    branchId,
    branchName,

    eventType: "sign_out",

    timestamp: serverTimestamp(),
  };

  /*
   * Location is optional.
   * Include coordinates only when valid.
   */
  if (locationDetails) {
    const latitude = Number(
      locationDetails.latitude
    );

    const longitude = Number(
      locationDetails.longitude
    );

    const accuracy =
      locationDetails.accuracy == null
        ? null
        : Number(locationDetails.accuracy);

    const validCoordinates =
      Number.isFinite(latitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      Number.isFinite(longitude) &&
      longitude >= -180 &&
      longitude <= 180;

    if (validCoordinates) {
      attendanceRecord.locationLatitude = latitude;
      attendanceRecord.locationLongitude = longitude;

      if (
        accuracy !== null &&
        Number.isFinite(accuracy) &&
        accuracy >= 0
      ) {
        attendanceRecord.locationAccuracy = accuracy;
      }
    }
  }

  await addDoc(
    collection(db, "staffAttendance"),
    attendanceRecord
  );
}

const SalesgirlDashboard = () => {
  const navigate = useNavigate();

  const [currentUser, setCurrentUser] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [staffProfile, setStaffProfile] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [, setLocationStatus] = useState(
    "Location sharing has not started."
  );

  const [locationSharing, setLocationSharing] =
    useState(false);

  const [workingHoursAllowed, setWorkingHoursAllowed] =
    useState(false);

  const [locationDetails, setLocationDetails] =
    useState(null);

  const signingOutRef = useRef(false);
  const profileRequestIdRef = useRef(0);

  /*
   * AUTHENTICATION AND PROFILE
   */
  useEffect(() => {
    let mounted = true;

    const unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        const requestId =
          ++profileRequestIdRef.current;

        if (!mounted) return;

        setCurrentUser(user);
        setDisplayName("");
        setStaffProfile(null);
        setIsAdmin(false);
        setLocationSharing(false);
        setLocationDetails(null);
        setWorkingHoursAllowed(false);

        if (!user) {
          setLocationStatus(
            "Please sign in to continue."
          );

          return;
        }

        signingOutRef.current = false;

        try {
          const profile = await getUserProfile(user);

          /*
           * Ignore stale profile requests if the account
           * changes while Firestore is being queried.
           */
          if (
            !mounted ||
            requestId !== profileRequestIdRef.current
          ) {
            return;
          }

          const safeProfile = profile || {};

          const admin = isAdminProfile(
            user,
            safeProfile
          );

          const resolvedName = getDisplayName(
            user,
            safeProfile
          );

          setStaffProfile(safeProfile);
          setIsAdmin(admin);
          setDisplayName(resolvedName);

          if (admin) {
            setWorkingHoursAllowed(true);
            setLocationStatus(
              "Admin account signed in."
            );

            return;
          }

          setWorkingHoursAllowed(
            isWithinStaffHours()
          );

          const rawBranch =
            safeProfile.branchId ||
            safeProfile.branch ||
            safeProfile.branchName ||
            "";

          const { branchId } =
            normalizeBranch(rawBranch);

          if (!branchId) {
            setLocationStatus(
              "Your profile has no assigned branch. Please contact the admin."
            );
          } else {
            setLocationStatus(
              "Ready to check location-sharing status."
            );
          }
        } catch (error) {
          console.error(
            "Could not load the authenticated user's profile:",
            error
          );

          if (
            !mounted ||
            requestId !== profileRequestIdRef.current
          ) {
            return;
          }

          /*
           * Do not use another account's cached name.
           */
          setDisplayName(getDisplayName(user, {}));
          setStaffProfile(null);
          setIsAdmin(isAdminProfile(user, {}));
          setWorkingHoursAllowed(false);

          setLocationStatus(
            "Could not load your staff profile. Check your connection or contact the admin."
          );
        }
      }
    );

    return () => {
      mounted = false;
      profileRequestIdRef.current += 1;
      unsubscribe();
    };
  }, []);

  /*
   * REFRESH STAFF WORKING HOURS WHEN THE TAB
   * RETURNS TO THE FOREGROUND.
   */
  useEffect(() => {
    const refreshWorkingHours = () => {
      if (!currentUser || isAdmin) {
        return;
      }

      setWorkingHoursAllowed(
        isWithinStaffHours()
      );
    };

    window.addEventListener(
      "focus",
      refreshWorkingHours
    );

    return () => {
      window.removeEventListener(
        "focus",
        refreshWorkingHours
      );
    };
  }, [currentUser, isAdmin]);

  /*
   * LISTEN FOR LOCATION TRACKER STATUS
   *
   * StaffLocationTracker manages location tracking
   * across the dashboard, sales, and conversion pages.
   */
  useEffect(() => {
    const handleLocationStatus = (event) => {
      const detail = event?.detail || {};

      setLocationSharing(
        Boolean(detail.sharing)
      );

      setLocationStatus(
        detail.status ||
          "Location tracking status is unavailable."
      );

      setLocationDetails(
        detail.details || null
      );
    };

    window.addEventListener(
      "afubia:location-status",
      handleLocationStatus
    );

    return () => {
      window.removeEventListener(
        "afubia:location-status",
        handleLocationStatus
      );
    };
  }, []);

  /*
   * DASHBOARD AUDIO
   */
  useEffect(() => {
    let cleanup;

    try {
      cleanup = playOnPageOpen(
        "dashboard"
      );
    } catch (error) {
      console.warn(
        "Dashboard audio warning:",
        error
      );
    }

    return () => {
      if (typeof cleanup === "function") {
        cleanup();
      }

      stopAllAudio();
    };
  }, []);

  /*
   * ENABLE LOCATION SHARING
   */
  const handleEnableLocationSharing =
    useCallback(() => {
      try {
        window.localStorage.setItem(
          LOCATION_PERMISSION_KEY,
          "yes"
        );
      } catch {
        // Browser storage is optional.
      }

      setLocationStatus(
        "Starting location sharing…"
      );

      window.dispatchEvent(
        new Event(
          "afubia:location-consent-changed"
        )
      );
    }, []);

  /*
   * SIGN OUT AND RECORD ATTENDANCE
   *
   * Firebase sign-out must still happen if the
   * attendance write fails.
   */
  const signOutStaff = useCallback(async () => {
    if (
      !currentUser ||
      !staffProfile ||
      signingOutRef.current ||
      isAdmin
    ) {
      return;
    }

    signingOutRef.current = true;

    try {
      try {
        await recordStaffSignOut(
          currentUser,
          staffProfile,
          locationDetails,
          displayName
        );

        console.info(
          "Staff sign-out attendance saved."
        );
      } catch (attendanceError) {
        console.error(
          "Could not save staff sign-out attendance:",
          attendanceError?.code ||
            attendanceError?.message ||
            attendanceError
        );
      }

      stopAllAudio();

      await signOut(auth);

      try {
        window.sessionStorage.removeItem(
          "afubiaActiveAttendanceId"
        );
        window.sessionStorage.removeItem(
          "afubiaActiveAttendanceUserId"
        );
        window.sessionStorage.removeItem(
          "afubiaSalespersonId"
        );

        window.localStorage.removeItem(
          `afubiaUserDisplayName_${currentUser.uid}`
        );
      } catch {
        // Storage cleanup is optional.
      }

      setLocationSharing(false);
      setLocationDetails(null);

      navigate("/login", {
        replace: true,
      });
    } catch (error) {
      console.error(
        "Staff sign-out failed:",
        error
      );

      signingOutRef.current = false;

      alert(
        "We could not complete sign-out. Please check your connection and try again."
      );
    }
  }, [
    currentUser,
    staffProfile,
    isAdmin,
    locationDetails,
    displayName,
    navigate,
  ]);

  /*
   * DASHBOARD ACTIONS
   */
  const handleTurnOil = useCallback(() => {
    if (
      !isAdmin &&
      !isWithinStaffHours()
    ) {
      setWorkingHoursAllowed(false);

      alert(
        "Your staff working hours have ended. You can use this feature between 8:00 AM and 6:00 PM Nigeria time."
      );

      return;
    }

    stopAllAudio();
    navigate("/conversion");
  }, [isAdmin, navigate]);

  const handleRecordSale = useCallback(() => {
    if (
      !isAdmin &&
      !isWithinStaffHours()
    ) {
      setWorkingHoursAllowed(false);

      alert(
        "Your staff working hours have ended. You can use this feature between 8:00 AM and 6:00 PM Nigeria time."
      );

      return;
    }

    stopAllAudio();
    navigate("/sales");
  }, [isAdmin, navigate]);

  /*
   * DASHBOARD UI
   */
  return (
    <ResponsiveLayout>
      <div className="dashboard-container">
        <div className="dashboard-heading">
          <span className="dashboard-eyebrow">
            AFUBIA FARMS
          </span>

          {currentUser && displayName && (
            <div
              className="dashboard-welcome-user"
              aria-label={`Logged in as ${displayName}`}
            >
              Welcome,{ " "}
              <strong>{displayName}</strong> 👋
            </div>
          )}

          <h2 className="dashboard-title">
            Wetin you wan do today?
          </h2>

          <p className="dashboard-subtitle">
            Pick wetin you wan do below to arrange
            today palm oil work.
          </p>

          {!isAdmin && (
            <div
              className={`staff-location-status${locationSharing ? " is-active" : ""}`}
              role="status"
              aria-live="polite"
            >
              <span className="staff-records-icon" aria-hidden="true">✓</span>
              <div className="staff-records-copy">
                <strong>Your records and attendance are being recorded</strong>
                <p>
                  Your work records and attendance are saved to support accurate
                  shop operations. Location access is used for attendance
                  verification only when permission has been granted.
                </p>

                {!locationSharing &&
                  workingHoursAllowed &&
                  staffProfile && (
                    <button
                      type="button"
                      className="dashboard-location-enable"
                      onClick={handleEnableLocationSharing}
                    >
                      Enable location for attendance verification
                    </button>
                  )}
              </div>
            </div>
          )}
        </div>

        {!isAdmin && (
          <button
            type="button"
            className="dashboard-signout-button"
            onClick={signOutStaff}
            disabled={
              !currentUser ||
              !staffProfile
            }
          >
            Sign out and record attendance
          </button>
        )}

        {!isAdmin &&
          !workingHoursAllowed &&
          staffProfile && (
            <p
              className="dashboard-hours-notice"
              role="status"
            >
              Staff sales and oil-turning actions
              are available from 8:00 AM to 6:00 PM
              Nigeria time.
            </p>
          )}

        <div className="dashboard-actions">
          <button
            type="button"
            onClick={handleTurnOil}
            className="dashboard-action dashboard-action-conversion"
            aria-label="Turn palm oil"
            disabled={
              !isAdmin &&
              !workingHoursAllowed
            }
          >
            <div className="action-icon">
              <img
                src={OilTurning}
                alt="Palm oil turning"
              />
            </div>

            <div className="action-content">
              <strong>Turn Oil</strong>
              <span>
                Record oil wey you turn
              </span>
            </div>

            <div
              className="action-arrow"
              aria-hidden="true"
            >
              →
            </div>
          </button>

          <button
            type="button"
            onClick={handleRecordSale}
            className="dashboard-action dashboard-action-sales"
            aria-label="Record today's market"
            disabled={
              !isAdmin &&
              !workingHoursAllowed
            }
          >
            <div className="action-icon">
              <img
                src={Containers}
                alt="Palm oil containers"
              />
            </div>

            <div className="action-content">
              <strong>
                Record today's market
              </strong>
              <span>
                Record market wey customer buy
              </span>
            </div>

            <div
              className="action-arrow"
              aria-hidden="true"
            >
              →
            </div>
          </button>
        </div>
      </div>
    </ResponsiveLayout>
  );
};

export default SalesgirlDashboard;
