import { useEffect, useRef, useState } from "react";

import {
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  updateProfile,
} from "firebase/auth";

import { useNavigate } from "react-router-dom";

import { auth } from "../Firebase/firebase.utils";

import {
  getUserProfile,
  isAdminUser,
} from "../utils/auth";

import {
  createOrUpdateUserProfile,
} from "../Firebase/businessFirestore";

import { speak } from "./VoiceAssistant";
import "./Login.css";
import ResponsiveLayout from "./ResponsiveLayout";

/* =========================================================
   LOCAL STORAGE KEYS
========================================================= */

const EMAIL_STORAGE_KEY = "emailForSignIn";
const ROLE_STORAGE_KEY = "afubiaUserRole";
const DISPLAY_NAME_STORAGE_KEY = "afubiaUserDisplayName";

const getEmailNameKey = (email) =>
  `afubiaUserDisplayName:${String(email || "")
    .trim()
    .toLowerCase()}`;

const ADMIN_ROLES = [
  "admin",
  "administrator",
  "superadmin",
  "super_admin",
];

/* =========================================================
   HELPERS
========================================================= */

const cleanString = (value) =>
  String(value ?? "").trim();

const getProfileName = (profile) =>
  cleanString(
    profile?.displayName ||
      profile?.fullName ||
      profile?.name
  );

const getProfileRole = (profile) =>
  cleanString(
    profile?.role || profile?.userRole
  ).toLowerCase();

const isAdminRole = (role) =>
  ADMIN_ROLES.includes(cleanString(role).toLowerCase());

const getCachedName = (email) =>
  cleanString(
    window.localStorage.getItem(getEmailNameKey(email))
  );

const syncFirebaseDisplayName = async (user, displayName) => {
  const name = cleanString(displayName);

  if (!user || !name || user.displayName === name) {
    return;
  }

  try {
    await updateProfile(user, { displayName: name });
  } catch (error) {
    // Authentication display-name syncing is supplementary.
    // Firestore remains the main profile data source.
    console.warn(
      "Firebase display-name sync failed:",
      error?.code || error?.message || error
    );
  }
};

const rememberUser = (email, name, role) => {
  const cleanEmail = cleanString(email).toLowerCase();
  const cleanName = cleanString(name);

  if (cleanEmail && cleanName) {
    window.localStorage.setItem(
      getEmailNameKey(cleanEmail),
      cleanName
    );

    // Retained for compatibility with existing app components.
    window.localStorage.setItem(
      DISPLAY_NAME_STORAGE_KEY,
      cleanName
    );
  }

  if (role) {
    window.localStorage.setItem(ROLE_STORAGE_KEY, role);
  }
};

const getFriendlyLoginError = (error) => {
  const message = cleanString(error?.message).toLowerCase();

  switch (error?.code) {
    case "auth/invalid-action-code":
    case "auth/expired-action-code":
      return "This login link is invalid or has expired. Please request a new one.";

    case "auth/invalid-email":
      return "The email address is not valid.";

    case "auth/network-request-failed":
      return "Network problem. Please check your internet connection.";

    case "auth/user-disabled":
      return "This account has been disabled. Please contact the administrator.";

    case "auth/unauthorized-continue-uri":
      return "This login address is not authorized in Firebase. Check your Firebase Authorized Domains.";

    case "auth/operation-not-allowed":
      return "Email-link login is not enabled in Firebase Authentication.";

    case "auth/too-many-requests":
      return "Too many attempts. Please wait a little and try again.";

    case "permission-denied":
    case "firestore/permission-denied":
      return "Firestore denied access to your profile. Check the Firebase error details and your Firestore security rules.";

    default:
      break;
  }

  if (
    message.includes("missing or insufficient permissions")
  ) {
    return "Firestore denied access to your profile. Check your Firestore security rules.";
  }

  return error?.message || "Login failed. Please try again.";
};

/* =========================================================
   LOGIN COMPONENT
========================================================= */

const Login = () => {
  const navigate = useNavigate();

  const loginProcessingRef = useRef(false);

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info");
  const [needsFullName, setNeedsFullName] = useState(false);

  const showMessage = (text, type = "info") => {
    setMessage(text);
    setMessageType(type);
  };

  /* =========================================================
     SEND LOGIN LINK
  ========================================================= */

  const handleLogin = async (event) => {
    event.preventDefault();

    if (loading) return;

    const cleanEmail = cleanString(email).toLowerCase();

    if (!cleanEmail) {
      showMessage("Please enter your email address.", "warning");
      speak("Abeg put your email first.");
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(cleanEmail)) {
      showMessage("Please enter a valid email address.", "warning");
      speak("Abeg enter a correct email address.");
      return;
    }

    setLoading(true);
    showMessage("Sending your secure login link...", "info");

    try {
      const actionCodeSettings = {
        url: `${window.location.origin}/login`,
        handleCodeInApp: true,
      };

      await sendSignInLinkToEmail(
        auth,
        cleanEmail,
        actionCodeSettings
      );

      window.localStorage.setItem(
        EMAIL_STORAGE_KEY,
        cleanEmail
      );

      setEmail(cleanEmail);

      showMessage(
        "Login link sent. Check your email and click the newest link.",
        "success"
      );

      speak("We don send the login link go your email.");
    } catch (error) {
      console.error("Sending login link failed:", {
        code: error?.code,
        message: error?.message,
        error,
      });

      showMessage(getFriendlyLoginError(error), "error");
    } finally {
      setLoading(false);
    }
  };

  /* =========================================================
     COMPLETE EMAIL-LINK SIGN-IN
  ========================================================= */

  useEffect(() => {
    const completeSignIn = async () => {
      const currentUrl = window.location.href;

      if (!isSignInWithEmailLink(auth, currentUrl)) {
        return;
      }

      if (loginProcessingRef.current) {
        return;
      }

      loginProcessingRef.current = true;

      let storedEmail = window.localStorage.getItem(
        EMAIL_STORAGE_KEY
      );

      if (!storedEmail) {
        storedEmail = window.prompt(
          "Enter the email address you used to request this login link:"
        );
      }

      const cleanEmail = cleanString(storedEmail).toLowerCase();

      if (!cleanEmail) {
        loginProcessingRef.current = false;

        showMessage(
          "Your email is required to complete login.",
          "warning"
        );

        return;
      }

      setLoading(true);
      showMessage("Completing your login...", "info");

      try {
        /* -----------------------------------------------
           1. AUTHENTICATE
        ----------------------------------------------- */

        const result = await signInWithEmailLink(
          auth,
          cleanEmail,
          currentUrl
        );

        const user = result?.user;

        if (!user) {
          throw new Error(
            "Firebase did not return an authenticated user."
          );
        }

        const authenticatedEmail = cleanString(
          user.email || cleanEmail
        ).toLowerCase();

        window.localStorage.removeItem(EMAIL_STORAGE_KEY);

        console.log("Email-link sign-in succeeded:", {
          uid: user.uid,
          email: authenticatedEmail,
        });

        /* -----------------------------------------------
           2. LOAD EXISTING FIRESTORE PROFILE
        ----------------------------------------------- */

        const existingProfile = await getUserProfile(user);

        const profileName = getProfileName(existingProfile);
        const authName = cleanString(user.displayName);
        const cachedName = getCachedName(authenticatedEmail);

        /*
         * Use the permanent Firestore name first.
         * Firebase Auth and the email-specific browser
         * cache are fallbacks.
         */
        const savedName =
          profileName ||
          authName ||
          cachedName;

        /* -----------------------------------------------
           3. PRESERVE THE EXISTING ROLE
        ----------------------------------------------- */

        const existingRole = getProfileRole(existingProfile);

        const adminFromAuth = await isAdminUser(user);

        const admin =
          Boolean(adminFromAuth) ||
          isAdminRole(existingRole);

        const role = admin ? "admin" : "salesgirl";

        console.log("Login profile check:", {
          uid: user.uid,
          hasProfile: Boolean(existingProfile),
          hasSavedName: Boolean(savedName),
          existingRole: existingRole || "not set",
          selectedRole: role,
        });

        /* -----------------------------------------------
           4. ASK ONLY IF NO NAME EXISTS
        ----------------------------------------------- */

        if (!savedName) {
          setFullName("");
          setNeedsFullName(true);

          showMessage(
            "Welcome! Please enter your full name to complete your account setup.",
            "warning"
          );

          speak(
            "Abeg enter your full name to finish your account setup."
          );

          // The user remains signed in while completing setup.
          return;
        }

        /* -----------------------------------------------
           5. SAVE / UPDATE THE PROFILE
        ----------------------------------------------- */

        await createOrUpdateUserProfile(user, role, {
          active: existingProfile?.active ?? true,
          email: authenticatedEmail,
          displayName: savedName,
        });

        await syncFirebaseDisplayName(user, savedName);

        /* -----------------------------------------------
           6. REMEMBER THE NAME AND ROLE
        ----------------------------------------------- */

        rememberUser(authenticatedEmail, savedName, role);

        /* -----------------------------------------------
           7. CLEAN THE URL
        ----------------------------------------------- */

        window.history.replaceState(
          {},
          document.title,
          "/login"
        );

        setNeedsFullName(false);
        setFullName("");

        showMessage(`Welcome back, ${savedName}.`, "success");
        speak("Welcome back. You don enter the app.");

        /* -----------------------------------------------
           8. REDIRECT
        ----------------------------------------------- */

        const destination = admin ? "/admin" : "/dashboard";

        console.log("Redirecting to:", destination);

        navigate(destination, { replace: true });
      } catch (error) {
        console.error("Login completion failed:", {
          code: error?.code,
          message: error?.message,
          error,
        });

        showMessage(getFriendlyLoginError(error), "error");

        speak(
          "Login no work. Abeg check the error and try again."
        );

        loginProcessingRef.current = false;
      } finally {
        setLoading(false);
      }
    };

    completeSignIn();
  }, [navigate]);

  /* =========================================================
     SAVE NAME FOR A NEW USER
  ========================================================= */

  const handleSaveFullName = async (event) => {
    event.preventDefault();

    if (loading) return;

    const cleanName = cleanString(fullName);
    const user = auth.currentUser;

    if (cleanName.length < 3) {
      showMessage(
        "Please enter your complete name (at least 3 characters).",
        "warning"
      );
      return;
    }

    if (!user) {
      showMessage(
        "Your login session has expired. Please request a new login link.",
        "error"
      );
      return;
    }

    setLoading(true);
    showMessage("Saving your account details...", "info");

    try {
      const authenticatedEmail = cleanString(
        user.email
      ).toLowerCase();

      if (!authenticatedEmail) {
        throw new Error(
          "Your authenticated account has no email address."
        );
      }

      /* -----------------------------------------------
         1. CHECK THE PROFILE AGAIN
      ----------------------------------------------- */

      const existingProfile = await getUserProfile(user);

      const existingName =
        getProfileName(existingProfile) ||
        cleanString(user.displayName) ||
        getCachedName(authenticatedEmail);

      /*
       * If a name has already been saved, preserve it.
       * Otherwise, use the name the user just entered.
       */
      const nameToSave = existingName || cleanName;

      /* -----------------------------------------------
         2. DETERMINE THE ROLE
      ----------------------------------------------- */

      const existingRole = getProfileRole(existingProfile);

      const adminFromAuth = await isAdminUser(user);

      const admin =
        Boolean(adminFromAuth) ||
        isAdminRole(existingRole);

      const role = admin ? "admin" : "salesgirl";

      /* -----------------------------------------------
         3. SAVE THE FIRESTORE PROFILE
      ----------------------------------------------- */

      await createOrUpdateUserProfile(user, role, {
        active: existingProfile?.active ?? true,
        email: authenticatedEmail,
        displayName: nameToSave,
      });

      /* -----------------------------------------------
         4. SYNC AUTH AND LOCAL STORAGE
      ----------------------------------------------- */

      await syncFirebaseDisplayName(user, nameToSave);

      rememberUser(authenticatedEmail, nameToSave, role);

      /* -----------------------------------------------
         5. CLEAN THE URL AND FINISH
      ----------------------------------------------- */

      window.history.replaceState(
        {},
        document.title,
        "/login"
      );

      setNeedsFullName(false);
      setFullName("");

      showMessage(`Welcome, ${nameToSave}.`, "success");
      speak("Correct! Your account don ready.");

      const destination = admin ? "/admin" : "/dashboard";

      console.log("Redirecting to:", destination);

      navigate(destination, { replace: true });
    } catch (error) {
      console.error("Saving full name failed:", error);
      console.error("Firebase error code:", error?.code);
      console.error("Firebase error message:", error?.message);

      showMessage(
        `${getFriendlyLoginError(error)}${
          error?.code ? ` (${error.code})` : ""
        }`,
        "error"
      );
    } finally {
      setLoading(false);
    }
  };

  /* =========================================================
     UI
  ========================================================= */

  return (
    <ResponsiveLayout>
      <div className="login-page">
        <div className="login-card">
          <p className="login-eyebrow">AFUBIA FARMS</p>

          <h1>Palm Oil Sales</h1>

          <p className="login-description">
            Login to continue to your Afubia Farms workspace.
          </p>

          {needsFullName ? (
            <form onSubmit={handleSaveFullName}>
              <label htmlFor="fullName">Full Name</label>

              <input
                id="fullName"
                type="text"
                placeholder="Enter your full name"
                value={fullName}
                onChange={(event) =>
                  setFullName(event.target.value)
                }
                disabled={loading}
                required
                minLength={3}
                autoComplete="name"
                autoFocus
              />

              <button type="submit" disabled={loading}>
                {loading ? "Saving..." : "Continue"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin}>
              <label htmlFor="email">Email address</label>

              <input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                disabled={loading}
                required
                autoComplete="email"
                spellCheck="false"
              />

              <button type="submit" disabled={loading}>
                {loading ? "Please wait..." : "Send Login Link"}
              </button>
            </form>
          )}

          {message && (
            <p
              className={`login-message login-message-${messageType}`}
              role="status"
              aria-live="polite"
            >
              {message}
            </p>
          )}

          <p className="login-note">
            A secure login link will be sent to your email.
          </p>
        </div>
      </div>
    </ResponsiveLayout>
  );
};

export default Login;