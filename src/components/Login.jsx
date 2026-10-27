
import { useEffect, useState } from "react";
import {
  sendSignInLinkToEmail,
  signInWithEmailAndPassword,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut,
  setPersistence,
  browserSessionPersistence,
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";

import ResponsiveLayout from "./ResponsiveLayout";
import { auth, db } from "../Firebase/firebase.utils";
import { createOrUpdateUserProfile } from "../Firebase/businessFirestore";
import { isAdminUser } from "../utils/auth";
import { speak } from "./VoiceAssistant";
import "./Login.css";

const STAFF_ACCOUNTS = {
  kara: {
    branchId: "kara",
    branchName: "Kara Shop",
    displayName: "Etima Emmanuel",
    staffId: "KARA-SALESREP-001",
    email: "chukwuamaka.nwachukwu@gmail.com",
  },
  ogidan: {
    branchId: "ogidan",
    branchName: "Ogidan Shop",
    displayName: "Mary Eke",
    staffId: "OGIDAN-SALESREP-001",
    email: "daniel.chiemela@afubiagroup.com",
  },
};

const ADMIN_EMAIL_KEY = "afubiaAdminEmail";

const ALLOWED_STAFF_ROLES = [
  "salesgirl",
  "salesperson",
  "sales_rep",
];

function getStaffLocation() {
  return new Promise((resolve) => {
    const unavailable = {
      locationLatitude: null,
      locationLongitude: null,
      locationAccuracy: null,
    };

    if (
      typeof navigator === "undefined" ||
      !navigator.geolocation
    ) {
      resolve(unavailable);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;

        resolve({
          locationLatitude: Number.isFinite(latitude)
            ? latitude
            : null,
          locationLongitude: Number.isFinite(longitude)
            ? longitude
            : null,
          locationAccuracy: Number.isFinite(accuracy)
            ? accuracy
            : null,
        });
      },
      (error) => {
        console.warn("Staff location unavailable:", error.message);
        resolve(unavailable);
      },
      {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 30000,
      }
    );
  });
}

/**
 * Keep this document aligned with firestore.rules. The timestamp must use
 * serverTimestamp() so Firestore can validate it against request.time.
 * Location is optional when browser permission or GPS is unavailable.
 */
async function recordStaffAttendance(user, account) {
  const location = await getStaffLocation();

  const attendanceRecord = {
    userId: user.uid,
    staffId: account.staffId,
    staffName: account.displayName,
    branchId: account.branchId,
    branchName: account.branchName,
    eventType: "sign_in",
    timestamp: serverTimestamp(),
  };

  if (Number.isFinite(location.locationLatitude)) {
    attendanceRecord.locationLatitude = location.locationLatitude;
  }

  if (Number.isFinite(location.locationLongitude)) {
    attendanceRecord.locationLongitude = location.locationLongitude;
  }

  if (Number.isFinite(location.locationAccuracy)) {
    attendanceRecord.locationAccuracy = location.locationAccuracy;
  }

  const attendanceRef = await addDoc(
    collection(db, "staffAttendance"),
    attendanceRecord
  );

  console.info("Staff attendance recorded:", attendanceRef.id);
  return attendanceRef.id;
}

function getErrorMessage(error, account) {
  if (
    error?.code === "auth/invalid-credential" ||
    error?.code === "auth/wrong-password" ||
    error?.code === "auth/user-not-found"
  ) {
    return `Firebase could not authenticate ${account.email}. Check the staff account password.`;
  }

  if (error?.code === "auth/invalid-email") {
    return `The configured staff email is invalid: ${account.email}`;
  }

  if (error?.code === "auth/user-disabled") {
    return "This Firebase Authentication account is disabled.";
  }

  if (error?.code === "auth/too-many-requests") {
    return "Firebase has temporarily limited sign-in attempts. Please wait and try again.";
  }

  if (error?.code === "auth/network-request-failed") {
    return "Network error. Check your internet connection and try again.";
  }

  if (
    error?.code === "permission-denied" ||
    error?.code === "firestore/permission-denied"
  ) {
    return "Firestore rejected the sign-in attendance record. Confirm the published staffAttendance rule matches firestore.rules, then verify this user's staffId, branchId, branchName, role, and active status in Firestore.";
  }

  return error?.message || "Unable to sign in. Please try again.";
}

export default function Login() {
  const navigate = useNavigate();

  const [loginMode, setLoginMode] = useState("staff");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("error");

  const selectedAccount = selectedBranch
    ? STAFF_ACCOUNTS[selectedBranch]
    : null;

  // Complete the existing administrator email-link flow.
  useEffect(() => {
    let cancelled = false;

    async function completeEmailLinkLogin() {
      if (!isSignInWithEmailLink(auth, window.location.href)) {
        return;
      }

      setLoading(true);
      setMessage("Verifying your admin sign-in link...");
      setMessageType("info");

      try {
        const savedEmail =
          window.localStorage.getItem(ADMIN_EMAIL_KEY);

        const email =
          savedEmail ||
          window.prompt(
            "Enter the admin email address used to request this link:"
          );

        if (!email?.trim()) {
          throw new Error("An admin email address is required.");
        }

        // Use tab-scoped persistence so signing in as another employee in
        // a different tab cannot replace this tab's authenticated user.
        await setPersistence(auth, browserSessionPersistence);
        const result = await signInWithEmailLink(
          auth,
          email.trim(),
          window.location.href
        );

        const user = result.user;
        const admin = await isAdminUser(user);

        if (!admin) {
          await signOut(auth);
          throw new Error(
            "This account does not have administrator access."
          );
        }

        await createOrUpdateUserProfile(user, "admin", {
          displayName: user.displayName || "",
          email: user.email || email.trim(),
          active: true,
        });

        window.localStorage.removeItem(ADMIN_EMAIL_KEY);

        window.history.replaceState(
          {},
          document.title,
          window.location.pathname
        );

        if (!cancelled) {
          navigate("/admin", { replace: true });
        }
      } catch (error) {
        console.error("Admin email-link sign-in failed:", {
          code: error?.code || "no-error-code",
          message: error?.message || "Unknown error",
        });

        if (!cancelled) {
          setMessage(
            error?.message || "Unable to complete admin sign-in."
          );
          setMessageType("error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void completeEmailLinkLogin();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  function handleBranchSelect(branchKey) {
    const account = STAFF_ACCOUNTS[branchKey];
    if (!account) return;

    setSelectedBranch(branchKey);
    setPassword("");
    setShowPassword(false);
    setMessage("");
    setMessageType("error");

    speak(
      `You selected ${account.branchName}. Welcome ${account.displayName}.`
    );
  }

  function handleLoginModeChange(mode) {
    setLoginMode(mode);
    setPassword("");
    setShowPassword(false);
    setMessage("");
    setMessageType("error");
  }

  async function handleStaffLogin(event) {
    event.preventDefault();

    if (loading) return;

    if (!selectedAccount) {
      setMessage("Please select your shop and name first.");
      setMessageType("error");
      return;
    }

    if (!password) {
      setMessage("Please enter your staff password.");
      setMessageType("error");
      return;
    }

    setLoading(true);
    setMessage("");

    let signedInUser = null;
    let attendanceSaved = false;

    try {
      console.info("[Staff login] Authenticating account.");

      // Firebase's default local persistence synchronizes one account across
      // every tab on this origin. Session persistence keeps each tab independent.
      await setPersistence(auth, browserSessionPersistence);
      const result = await signInWithEmailAndPassword(
        auth,
        selectedAccount.email.trim(),
        password
      );

      signedInUser = result.user;

      console.info("[Staff login] Loading staff profile.");

      const profileRef = doc(db, "users", signedInUser.uid);
      const profileSnapshot = await getDoc(profileRef);

      if (!profileSnapshot.exists()) {
        throw new Error(
          `The authenticated account has no users/${signedInUser.uid} profile. Ask the administrator to create it.`
        );
      }

      const profile = profileSnapshot.data();
      const role = String(profile.role || profile.userRole || "")
        .trim()
        .toLowerCase();

      const profileBranch = String(
        profile.branchId || profile.branch || ""
      )
        .trim()
        .toLowerCase();

      if (profile.active !== true) {
        throw new Error(
          "This staff account is inactive. Contact the administrator."
        );
      }

      const profileBranchName = String(profile.branchName || "").trim();

      if (
        profile.staffId !== selectedAccount.staffId ||
        profileBranch !== selectedAccount.branchId ||
        !ALLOWED_STAFF_ROLES.includes(role) ||
        profileBranchName !== selectedAccount.branchName
      ) {
        throw new Error(
          `The profile does not match ${selectedAccount.branchName}. Verify staffId, branchId, branchName, role, and active in the users/${signedInUser.uid} document.`
        );
      }

      // Do not rewrite the protected profile fields during login.
      // Use the validated Firestore profile values for attendance.
      const resolvedName =
        String(profile.displayName || profile.fullName || "").trim() ||
        selectedAccount.displayName;

      console.info("[Staff login] Recording sign-in attendance.");

      const attendanceId = await recordStaffAttendance(
        signedInUser,
        {
          ...selectedAccount,
          staffId: String(profile.staffId),
          branchId: profileBranch,
          branchName: profileBranchName || selectedAccount.branchName,
          displayName: resolvedName,
        }
      );

      attendanceSaved = true;

      // Cache per user, never under a shared global name key.
      try {
        window.localStorage.setItem(
          `afubiaUserDisplayName_${signedInUser.uid}`,
          resolvedName
        );
        window.sessionStorage.setItem(
          "afubiaActiveAttendanceId",
          attendanceId
        );
        window.sessionStorage.setItem(
          "afubiaActiveAttendanceUserId",
          signedInUser.uid
        );
        window.sessionStorage.setItem(
          "afubiaBranchId",
          selectedAccount.branchId
        );
        window.sessionStorage.setItem(
          "afubiaSalespersonId",
          selectedAccount.staffId
        );
      } catch (storageError) {
        console.warn(
          "Could not cache staff session details:",
          storageError?.message
        );
      }

      navigate("/dashboard", { replace: true });
    } catch (error) {
      console.error("Staff login failure details:", {
        stage: attendanceSaved
          ? "after-attendance"
          : "authentication-profile-or-attendance",
        code: error?.code || "no-error-code",
        message: error?.message || "No error message",
        email: selectedAccount.email,
        branch: selectedAccount.branchId,
        projectId: auth.app.options.projectId,
      });

      // If attendance failed, do not leave the user in a partial session.
      if (signedInUser && !attendanceSaved) {
        try {
          await signOut(auth);
        } catch (signOutError) {
          console.error(
            "Cleanup sign-out failed:",
            signOutError?.code || signOutError?.message
          );
        }
      }

      setMessage(getErrorMessage(error, selectedAccount));
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminLogin(event) {
    event.preventDefault();

    if (loading) return;

    setMessage("");

    const email = adminEmail.trim();

    if (!email) {
      setMessage("Please enter your administrator email.");
      setMessageType("error");
      return;
    }

    setLoading(true);

    try {
      const actionCodeSettings = {
        url: `${window.location.origin}/login`,
        handleCodeInApp: true,
      };

      await sendSignInLinkToEmail(auth, email, actionCodeSettings);
      window.localStorage.setItem(ADMIN_EMAIL_KEY, email);

      setMessage(
        "Admin sign-in link sent. Open your email and click the link to continue."
      );
      setMessageType("success");
    } catch (error) {
      console.error("Admin email-link request failed:", {
        code: error?.code || "no-error-code",
        message: error?.message || "Unknown error",
      });

      setMessage(
        error?.code === "auth/unauthorized-continue-uri"
          ? "This website URL is not authorized in Firebase Authentication settings."
          : error?.message || "Unable to send the admin sign-in link."
      );
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ResponsiveLayout>
      <main className="login-page">
        <aside className="login-story" aria-label="Afubia Farms workspace">
          <span className="login-story-kicker">FROM THE FARM. FOR THE EVERYDAY.</span>
          <h2>Good business.<br />Clear records.<br /><em>Every day.</em></h2>
          <p>Your shops, sales and stock. One simple workspace to keep everything growing.</p>
          <div className="login-story-art" aria-hidden="true"><span>AF</span><div className="login-story-ring" /></div>
          <div className="login-story-footer"><span>AFUBIA FARMS</span><span>Kara · Ogidan</span></div>
        </aside>
        <section className="login-card">
          <div className="login-brand">
            <div className="login-logo">AF</div>
            <p className="login-brand-name">AFUBIA FARMS</p>
            <h1>Palm Oil Sales</h1>
            <p className="login-subtitle">
              Welcome back. Sign in to continue.
            </p>
          </div>

          <div className="login-mode-switch">
            <button
              type="button"
              className={loginMode === "staff" ? "active" : ""}
              aria-pressed={loginMode === "staff"}
              onClick={() => handleLoginModeChange("staff")}
              disabled={loading}
            >
              Salesperson
            </button>

            <button
              type="button"
              className={loginMode === "admin" ? "active" : ""}
              aria-pressed={loginMode === "admin"}
              onClick={() => handleLoginModeChange("admin")}
              disabled={loading}
            >
              Administrator
            </button>
          </div>

          {loginMode === "staff" ? (
            <form className="login-form" onSubmit={handleStaffLogin}>
              <div className="login-step-heading">
                <h2>Choose your shop</h2>
                <p>Select your shop and name to continue.</p>
              </div>

              <div className="login-branch-options">
                {Object.entries(STAFF_ACCOUNTS).map(
                  ([branchKey, account]) => (
                    <button
                      key={branchKey}
                      type="button"
                      className={`login-branch-button ${
                        selectedBranch === branchKey ? "active" : ""
                      }`}
                      aria-pressed={selectedBranch === branchKey}
                      onClick={() => handleBranchSelect(branchKey)}
                      disabled={loading}
                    >
                      <span className="login-branch-icon">
                        <span aria-hidden="true">🏪</span>
                      </span>

                      <span className="login-branch-copy">
                        <strong>{account.branchName}</strong>
                        <small>{account.displayName}</small>
                      </span>

                      {selectedBranch === branchKey && (
                        <span
                          className="login-account-check"
                          aria-label="Selected"
                        >
                          ✓
                        </span>
                      )}
                    </button>
                  )
                )}
              </div>

              {selectedAccount && (
                <>
                  <div className="login-selected-account">
                    <div className="login-avatar" aria-hidden="true">
                      {selectedAccount.displayName
                        .split(" ")
                        .map((part) => part[0])
                        .join("")
                        .slice(0, 2)}
                    </div>

                    <div className="login-selected-account-info">
                      <span>Signing in as</span>
                      <strong>{selectedAccount.displayName}</strong>
                      <small>{selectedAccount.staffId}</small>
                      <small>{selectedAccount.branchName}</small>
                    </div>
                  </div>

                  <label className="login-field-label" htmlFor="staff-email">
                    Staff email
                  </label>
                  <input
                    id="staff-email"
                    type="email"
                    name="username"
                    value={selectedAccount.email}
                    autoComplete="username"
                    readOnly
                    disabled={loading}
                  />
                </>
              )}

              <label className="login-field-label" htmlFor="staff-password">
                Password
              </label>

              <div className="login-password-wrapper">
                <input
                  id="staff-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={
                    selectedAccount
                      ? "Enter or select your saved password"
                      : "Select your shop first"
                  }
                  disabled={!selectedAccount || loading}
                  required
                />

                <button
                  type="button"
                  className="login-password-toggle"
                  onClick={() =>
                    setShowPassword((current) => !current)
                  }
                  disabled={!selectedAccount || loading}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>

              <p className="login-security-note">
                If your saved password does not appear, select the
                browser's saved login or type your password.
              </p>

              {message && (
                <div className={`login-message ${messageType}`} role="alert">
                  {message}
                </div>
              )}

              <button
                type="submit"
                className="login-submit"
                disabled={loading || !selectedAccount}
              >
                {loading ? (
                  <>
                    <span className="login-spinner" />
                    Signing in...
                  </>
                ) : (
                  "Sign In to Shop"
                )}
              </button>
            </form>
          ) : (
            <form className="login-form" onSubmit={handleAdminLogin}>
              <div className="login-admin-intro">
                <h2>Administrator access</h2>
                <p>
                  Enter your authorized admin email to receive a secure
                  sign-in link.
                </p>
              </div>

              <label className="login-field-label" htmlFor="admin-email">
                Administrator email
              </label>

              <input
                id="admin-email"
                type="email"
                name="email"
                value={adminEmail}
                onChange={(event) => setAdminEmail(event.target.value)}
                placeholder="Enter your admin email"
                autoComplete="email"
                required
                disabled={loading}
              />

              {message && (
                <div className={`login-message ${messageType}`} role="status">
                  {message}
                </div>
              )}

              <button
                type="submit"
                className="login-submit"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="login-spinner" />
                    Sending link...
                  </>
                ) : (
                  "Send Secure Sign-In Link"
                )}
              </button>
            </form>
          )}

          <footer className="login-footer">
            <p>© 2026 Afubia Farms • Palm Oil Sales System</p>
          </footer>
        </section>
      </main>
    </ResponsiveLayout>
  );
}
