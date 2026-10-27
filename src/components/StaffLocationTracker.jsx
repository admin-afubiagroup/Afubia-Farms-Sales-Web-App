
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "../Firebase/firebase.utils";

const TIME_ZONE = "Africa/Lagos";
const LOCATION_CONSENT_KEY = "afubiaLocationPermissionExplained";
const GEOAPIFY_API_KEY = import.meta.env.VITE_GEOAPIFY_API_KEY || "";
const LOCATION_SAVE_INTERVAL = 60 * 1000;
const ADDRESS_REFRESH_INTERVAL = 5 * 60 * 1000;
const MIN_MOVEMENT_METRES = 75;
const MIN_ADDRESS_MOVEMENT_METRES = 250;
const ADMIN_EMAIL = "chukwuamakanwachukwu@outlook.com";

const STAFF_ROLES = ["salesgirl", "salesperson", "sales_rep"];

function isWithinStaffHours() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const hour = Number(
    parts.find((part) => part.type === "hour")?.value
  );

  return Number.isFinite(hour) && hour >= 8 && hour < 18;
}

function normalizeBranch(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (text === "kara" || text === "kara shop") {
    return { branchId: "kara", branchName: "Kara Shop" };
  }

  if (text === "ogidan" || text === "ogidan shop") {
    return { branchId: "ogidan", branchName: "Ogidan Shop" };
  }

  return { branchId: "", branchName: "" };
}

function isAdminProfile(profile) {
  const role = String(profile?.role || profile?.userRole || "")
    .trim()
    .toLowerCase();

  return [
    "admin",
    "administrator",
    "superadmin",
    "super_admin",
  ].includes(role);
}

function isStaffProfile(profile) {
  const role = String(profile?.role || profile?.userRole || "")
    .trim()
    .toLowerCase();

  return STAFF_ROLES.includes(role);
}

function mapsUrl(latitude, longitude) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${latitude},${longitude}`
  )}`;
}

function distanceMetres(lat1, lon1, lat2, lon2) {
  const radians = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) *
      Math.cos(radians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return (
    2 *
    earthRadius *
    Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  );
}

async function reverseGeocode(latitude, longitude) {
  if (!GEOAPIFY_API_KEY) return "";

  const url = new URL("https://api.geoapify.com/v1/geocode/reverse");
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("apiKey", GEOAPIFY_API_KEY);

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(
      `Address lookup failed (HTTP ${response.status}).`
    );
  }

  const result = await response.json();
  const properties = result?.features?.[0]?.properties;

  return (
    properties?.formatted ||
    [
      properties?.name,
      properties?.street,
      properties?.suburb,
      properties?.district,
      properties?.city,
      properties?.state,
      properties?.country,
    ]
      .filter(Boolean)
      .join(", ")
  );
}

function publishLocationStatus(detail) {
  window.dispatchEvent(
    new CustomEvent("afubia:location-status", { detail })
  );
}

/**
 * Attendance rules only permit the documented attendance fields.
 * Do not add email, role, clientTimestamp, signOutReason, or
 * arbitrary GPS fields to this record unless the rules are changed.
 */
async function saveSignOutAttendance(user, profile, branch) {
  if (!branch.branchId) return;

  const attendanceRecord = {
    userId: user.uid,
    staffId: profile.staffId || profile.employeeId || "",
    staffName:
      profile.displayName ||
      profile.fullName ||
      user.displayName ||
      "Staff member",
    branchId: branch.branchId,
    branchName: branch.branchName,
    eventType: "sign_out",
    timestamp: serverTimestamp(),
  };

  await addDoc(
    collection(db, "staffAttendance"),
    attendanceRecord
  );
}

export default function StaffLocationTracker() {
  const navigate = useNavigate();

  useEffect(() => {
    let disposed = false;
    let activeUser = null;
    let activeProfile = null;
    let watchId = null;
    let saveIntervalId = null;
    let hoursIntervalId = null;
    let latestPosition = null;
    let saving = false;
    let signingOut = false;
    let lastSavedAt = 0;
    let lastSavedCoordinates = null;

    let lastAddressLookup = {
      latitude: null,
      longitude: null,
      address: "",
      time: 0,
    };

    const stopTracking = () => {
      if (watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
      }

      if (saveIntervalId !== null) {
        window.clearInterval(saveIntervalId);
      }

      if (hoursIntervalId !== null) {
        window.clearInterval(hoursIntervalId);
      }

      watchId = null;
      saveIntervalId = null;
      hoursIntervalId = null;
      latestPosition = null;
      saving = false;
    };

    const getCurrentBranch = () =>
      normalizeBranch(
        activeProfile?.branchId ||
          activeProfile?.branch ||
          activeProfile?.branchName ||
          activeProfile?.shopBranch
      );

    const recordSignOutAndExit = async () => {
      if (
        disposed ||
        signingOut ||
        !activeUser ||
        !activeProfile
      ) {
        return;
      }

      signingOut = true;

      const userToSignOut = activeUser;
      const profileToSignOut = activeProfile;
      const branch = normalizeBranch(
        profileToSignOut.branchId ||
          profileToSignOut.branch ||
          profileToSignOut.branchName ||
          profileToSignOut.shopBranch
      );

      stopTracking();

      try {
        await saveSignOutAttendance(
          userToSignOut,
          profileToSignOut,
          branch
        );
      } catch (error) {
        console.error(
          "Automatic sign-out attendance could not be saved:",
          error?.code || error?.message
        );
      }

      try {
        if (
          auth.currentUser?.uid === userToSignOut.uid
        ) {
          await signOut(auth);
        }
      } catch (error) {
        console.error(
          "Automatic staff sign-out failed:",
          error?.code || error?.message
        );
      } finally {
        try {
          const activeAttendanceUserId =
            window.sessionStorage.getItem(
              "afubiaActiveAttendanceUserId"
            );

          if (activeAttendanceUserId === userToSignOut.uid) {
            window.sessionStorage.removeItem(
              "afubiaActiveAttendanceId"
            );
            window.sessionStorage.removeItem(
              "afubiaActiveAttendanceUserId"
            );
            window.sessionStorage.removeItem(
              "afubiaSalespersonId"
            );
          }
        } catch {
          // Browser storage is optional.
        }

        publishLocationStatus({
          sharing: false,
          status:
            "Staff working hours have ended. You have been signed out.",
          details: null,
        });

        if (!disposed) {
          navigate("/login", { replace: true });
        }
      }
    };

    const saveLatestPosition = async () => {
      // Capture the position before any await. stopTracking() can
      // clear latestPosition while reverse geocoding is in progress.
      const position = latestPosition;

      if (
        disposed ||
        saving ||
        !position?.coords ||
        !activeUser ||
        !activeProfile ||
        !isWithinStaffHours()
      ) {
        return;
      }

      const userAtStart = activeUser;
      const coords = position.coords;

      if (
        !Number.isFinite(coords.latitude) ||
        !Number.isFinite(coords.longitude) ||
        coords.latitude < -90 ||
        coords.latitude > 90 ||
        coords.longitude < -180 ||
        coords.longitude > 180
      ) {
        console.warn("Skipping invalid GPS coordinates.");
        return;
      }

      const now = Date.now();

      const movedSinceSave = lastSavedCoordinates
        ? distanceMetres(
            lastSavedCoordinates.latitude,
            lastSavedCoordinates.longitude,
            coords.latitude,
            coords.longitude
          )
        : Infinity;

      if (
        lastSavedAt &&
        now - lastSavedAt < LOCATION_SAVE_INTERVAL &&
        movedSinceSave < MIN_MOVEMENT_METRES
      ) {
        return;
      }

      saving = true;

      try {
        const { branchId, branchName } = getCurrentBranch();

        if (!branchId) {
          publishLocationStatus({
            sharing: false,
            status:
              "Your staff profile has no valid branch assignment.",
            details: null,
          });
          return;
        }

        const movedForAddress =
          lastAddressLookup.latitude == null
            ? Infinity
            : distanceMetres(
                lastAddressLookup.latitude,
                lastAddressLookup.longitude,
                coords.latitude,
                coords.longitude
              );

        const addressRefreshDue =
          now - lastAddressLookup.time >=
          ADDRESS_REFRESH_INTERVAL;

        let locationAddress = lastAddressLookup.address;

        if (
          GEOAPIFY_API_KEY &&
          (!locationAddress ||
            addressRefreshDue ||
            movedForAddress >= MIN_ADDRESS_MOVEMENT_METRES)
        ) {
          try {
            const resolvedAddress = await reverseGeocode(
              coords.latitude,
              coords.longitude
            );

            if (resolvedAddress) {
              locationAddress = resolvedAddress;

              lastAddressLookup = {
                latitude: coords.latitude,
                longitude: coords.longitude,
                address: resolvedAddress,
                time: Date.now(),
              };
            }
          } catch (error) {
            console.warn(
              "Reverse geocoding unavailable:",
              error?.message
            );
          }
        }

        // The account could have changed while reverseGeocode awaited.
        if (
          disposed ||
          auth.currentUser?.uid !== userAtStart.uid ||
          activeUser?.uid !== userAtStart.uid
        ) {
          return;
        }

        const googleMapsUrl = mapsUrl(
          coords.latitude,
          coords.longitude
        );

        const positionTimestamp = Number(position.timestamp);
        const capturedAt = new Date(
          Number.isFinite(positionTimestamp) &&
            positionTimestamp > 0
            ? positionTimestamp
            : Date.now()
        ).toISOString();

        const locationData = {
          userId: userAtStart.uid,
          branchId,
          branchName,
          staffId:
            activeProfile.staffId ||
            activeProfile.employeeId ||
            userAtStart.email ||
            userAtStart.uid,
          staffName:
            activeProfile.displayName ||
            activeProfile.fullName ||
            userAtStart.displayName ||
            "Staff member",
          latitude: coords.latitude,
          longitude: coords.longitude,
          locationAddress: locationAddress || "",
          googleMapsUrl,
          updatedAt: serverTimestamp(),
          capturedAt,
        };

        // Omit optional numeric fields when GPS returns null.
        if (Number.isFinite(coords.accuracy) && coords.accuracy >= 0) {
          locationData.accuracy = coords.accuracy;
        }

        if (
          Number.isFinite(coords.heading) &&
          coords.heading >= 0
        ) {
          locationData.heading = coords.heading;
        }

        if (Number.isFinite(coords.speed) && coords.speed >= 0) {
          locationData.speed = coords.speed;
        }

        console.info("[Staff location] Saving current location.");

        await setDoc(
          doc(db, "staffLocations", userAtStart.uid),
          locationData,
          { merge: true }
        );

        lastSavedAt = Date.now();

        lastSavedCoordinates = {
          latitude: coords.latitude,
          longitude: coords.longitude,
        };

        publishLocationStatus({
          sharing: true,
          status: `Latest location saved. Reported GPS accuracy: approximately ${Math.round(
            Number.isFinite(coords.accuracy) ? coords.accuracy : 0
          )} metres.`,
          details: {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: Number.isFinite(coords.accuracy)
              ? coords.accuracy
              : null,
            address: locationAddress || "",
            mapsUrl: googleMapsUrl,
          },
        });
      } catch (error) {
        console.error("Could not save staff location:", {
          code: error?.code || "no-error-code",
          message: error?.message || "Unknown error",
        });

        publishLocationStatus({
          sharing: false,
          status:
            error?.code === "permission-denied"
              ? "Firestore rejected the location. Check the staff profile and staffLocations rules."
              : error?.message ||
                "Could not save the staff location.",
          details: null,
        });
      } finally {
        saving = false;
      }
    };

    const startTracking = () => {
      stopTracking();

      const currentUser = activeUser;
      const profile = activeProfile;

      if (
        disposed ||
        !currentUser ||
        !profile ||
        isAdminProfile(profile) ||
        String(currentUser.email || "").trim().toLowerCase() ===
          ADMIN_EMAIL.toLowerCase()
      ) {
        publishLocationStatus({
          sharing: false,
          status:
            "Location tracking is only active for signed-in staff.",
          details: null,
        });
        return;
      }

      if (profile.active !== true || !isStaffProfile(profile)) {
        publishLocationStatus({
          sharing: false,
          status:
            "This account is inactive or is not configured as staff. Contact the administrator.",
          details: null,
        });
        return;
      }

      if (!isWithinStaffHours()) {
        publishLocationStatus({
          sharing: false,
          status:
            "Staff working hours are 8:00 AM to before 6:00 PM Nigeria time.",
          details: null,
        });

        if (auth.currentUser?.uid === currentUser.uid) {
          void recordSignOutAndExit();
        }
        return;
      }

      const branch = getCurrentBranch();

      if (!branch.branchId) {
        publishLocationStatus({
          sharing: false,
          status:
            "Your staff profile has no valid branch assignment.",
          details: null,
        });
        return;
      }

      hoursIntervalId = window.setInterval(() => {
        if (!isWithinStaffHours()) {
          void recordSignOutAndExit();
        }
      }, 15000);

      let consent = "";

      try {
        consent =
          window.localStorage.getItem(LOCATION_CONSENT_KEY) || "";
      } catch {
        // Ask for consent in this session if storage is unavailable.
      }

      if (!consent) {
        const agreed = window.confirm(
          "Afubia Farms uses your device location during staff working hours so the administrator can monitor attendance and the latest reported location. Do you agree to share your location while using the staff app?"
        );

        consent = agreed ? "yes" : "no";

        try {
          window.localStorage.setItem(
            LOCATION_CONSENT_KEY,
            consent
          );
        } catch {
          // Continue using this session's decision.
        }
      }

      if (consent !== "yes") {
        publishLocationStatus({
          sharing: false,
          status:
            "Location sharing is off. You can enable it from the staff dashboard.",
          details: null,
        });
        return;
      }

      if (!navigator.geolocation) {
        publishLocationStatus({
          sharing: false,
          status: "This browser does not support geolocation.",
          details: null,
        });
        return;
      }

      publishLocationStatus({
        sharing: false,
        status:
          "Requesting your device location. Allow location access in your browser settings.",
        details: null,
      });

      watchId = navigator.geolocation.watchPosition(
        (position) => {
          if (disposed) return;
          latestPosition = position;
          void saveLatestPosition();
        },
        (error) => {
          let status =
            "Could not get your location. Check device location settings.";

          if (error.code === error.PERMISSION_DENIED) {
            status =
              "Location permission denied. Allow location access in your browser settings.";
          } else if (
            error.code === error.POSITION_UNAVAILABLE
          ) {
            status =
              "Your device could not determine its location. Check device location services.";
          } else if (error.code === error.TIMEOUT) {
            status =
              "Location request timed out. Check GPS and try again.";
          }

          publishLocationStatus({
            sharing: false,
            status,
            details: null,
          });
        },
        {
          enableHighAccuracy: true,
          maximumAge: 30000,
          timeout: 20000,
        }
      );

      saveIntervalId = window.setInterval(
        () => void saveLatestPosition(),
        LOCATION_SAVE_INTERVAL
      );
    };

    const onConsentChanged = () => {
      startTracking();
    };

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      stopTracking();

      activeUser = user;
      activeProfile = null;
      signingOut = false;
      lastSavedAt = 0;
      lastSavedCoordinates = null;

      lastAddressLookup = {
        latitude: null,
        longitude: null,
        address: "",
        time: 0,
      };

      if (!user) {
        publishLocationStatus({
          sharing: false,
          status: "Location tracking is not active.",
          details: null,
        });
        return;
      }

      try {
        console.info("[Staff location] Loading current user profile.");

        const profileSnapshot = await getDoc(
          doc(db, "users", user.uid)
        );

        if (disposed || auth.currentUser?.uid !== user.uid) {
          return;
        }

        if (!profileSnapshot.exists()) {
          publishLocationStatus({
            sharing: false,
            status:
              "Staff profile was not found. Contact the administrator.",
            details: null,
          });
          return;
        }

        activeProfile = profileSnapshot.data();

        if (activeProfile.active !== true) {
          await signOut(auth);

          if (!disposed) {
            navigate("/login", { replace: true });
          }
          return;
        }

        startTracking();
      } catch (error) {
        console.error(
          "Could not initialize staff location tracking:",
          {
            code: error?.code || "no-error-code",
            message: error?.message || "Unknown error",
          }
        );

        publishLocationStatus({
          sharing: false,
          status:
            error?.code === "permission-denied"
              ? "Firestore denied access to your staff profile. Check the users collection read rule."
              : "Could not load the staff profile or start location tracking.",
          details: null,
        });
      }
    });

    window.addEventListener(
      "afubia:location-consent-changed",
      onConsentChanged
    );

    return () => {
      disposed = true;
      stopTracking();

      window.removeEventListener(
        "afubia:location-consent-changed",
        onConsentChanged
      );

      unsubscribe();
    };
  }, [navigate]);

  return null;
}
