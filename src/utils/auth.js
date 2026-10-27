
import {
  doc,
  getDoc,
} from "firebase/firestore";

import {
  auth,
  db,
} from "../Firebase/firebase.utils";

/* =========================================================
   ADMIN CONFIGURATION
========================================================= */

export const ADMIN_EMAILS = [
  "chukwuamakanwachukwu@outlook.com",
];

export const ADMIN_ROLES = [
  "admin",
  "administrator",
  "superadmin",
  "super_admin",
];

/* =========================================================
   NORMALIZATION HELPERS
========================================================= */

const normalizeEmail = (email) =>
  String(email ?? "").trim().toLowerCase();

const normalizeRole = (role) =>
  String(role ?? "").trim().toLowerCase();

const cleanString = (value) =>
  String(value ?? "").trim();

export const normalizeBranchId = (value) => {
  const branch = cleanString(value)
    .toLowerCase()
    .replace(/[_\s]+/g, "-");

  if (["ogidan", "ogidan-shop"].includes(branch)) {
    return "ogidan";
  }

  if (["kara", "kara-shop"].includes(branch)) {
    return "kara";
  }

  return "";
};

/* =========================================================
   ADMIN EMAIL CHECK
========================================================= */

export const isAdminEmail = (user) => {
  if (!user?.email) return false;

  return ADMIN_EMAILS.includes(
    normalizeEmail(user.email)
  );
};

/* =========================================================
   PROFILE ROLE HELPERS
========================================================= */

export const getProfileRole = (profile) =>
  normalizeRole(profile?.role || profile?.userRole);

export const hasAdminRole = (profile) => {
  if (!profile || profile.active === false) {
    return false;
  }

  return ADMIN_ROLES.includes(getProfileRole(profile));
};

/* =========================================================
   GET USER PROFILE
========================================================= */

export const getUserProfile = async (user) => {
  if (!user?.uid) return null;

  const profileRef = doc(db, "users", user.uid);
  const snapshot = await getDoc(profileRef);

  if (!snapshot.exists()) return null;

  return {
    uid: snapshot.id,
    ...snapshot.data(),
  };
};

/* =========================================================
   ACCOUNT STATUS
========================================================= */

export const isAccountActive = (profile) =>
  Boolean(profile) && profile.active !== false;

/* =========================================================
   GET USER ROLE
========================================================= */

export const getUserRole = async (user) => {
  if (!user?.uid) return null;

  try {
    const profile = await getUserProfile(user);

    // Do not grant access based on email or role
    // when the saved account is explicitly inactive.
    if (profile && profile.active === false) {
      return null;
    }

    // The configured administrator email is retained
    // for initial account setup. Firestore rules must
    // still authorize database operations separately.
    if (isAdminEmail(user)) {
      return "admin";
    }

    if (!profile) {
      return null;
    }

    const role = getProfileRole(profile);

    return role || null;
  } catch (error) {
    console.error("Could not determine user role:", error);
    return null;
  }
};

/* =========================================================
   CHECK ADMINISTRATOR
========================================================= */

export const isAdminUser = async (user) => {
  if (!user?.uid) return false;

  try {
    const profile = await getUserProfile(user);

    // An existing inactive profile always denies access,
    // including for the configured administrator email.
    if (profile && profile.active === false) {
      return false;
    }

    if (isAdminEmail(user)) {
      return true;
    }

    return hasAdminRole(profile);
  } catch (error) {
    console.error("Admin permission check failed:", error);
    return false;
  }
};

/* =========================================================
   GET DISPLAY NAME
========================================================= */

export const getUserDisplayName = async (user) => {
  if (!user) return "";

  const authName = cleanString(user.displayName);

  if (authName) return authName;

  try {
    const profile = await getUserProfile(user);

    return cleanString(
      profile?.displayName ||
      profile?.fullName ||
      profile?.name
    );
  } catch (error) {
    console.warn("Could not retrieve display name:", error);
    return "";
  }
};

/* =========================================================
   GET ASSIGNED BRANCH
========================================================= */

export const getUserBranch = async (user) => {
  if (!user?.uid) return "";

  try {
    const profile = await getUserProfile(user);

    if (!profile || profile.active === false) {
      return "";
    }

    return normalizeBranchId(
      profile.branchId ||
      profile.branch ||
      profile.branchName
    );
  } catch (error) {
    console.error("Could not retrieve assigned branch:", error);
    return "";
  }
};

/* =========================================================
   GET CURRENT USER
========================================================= */

export const getCurrentUser = () =>
  auth.currentUser || null;

/* =========================================================
   GET COMPLETE USER INFORMATION
========================================================= */

export const getUserInformation = async (user) => {
  if (!user?.uid) {
    return {
      user: null,
      profile: null,
      role: null,
      isAdmin: false,
      active: false,
      branchId: "",
      displayName: "",
    };
  }

  try {
    const profile = await getUserProfile(user);
    const active = isAccountActive(profile);

    if (!active) {
      return {
        user,
        profile,
        role: null,
        isAdmin: false,
        active: false,
        branchId: "",
        displayName: "",
      };
    }

    const admin = isAdminEmail(user) || hasAdminRole(profile);

    const role = admin
      ? "admin"
      : getProfileRole(profile) || null;

    return {
      user,
      profile,
      role,
      isAdmin: admin,
      active,
      branchId: normalizeBranchId(
        profile?.branchId ||
        profile?.branch ||
        profile?.branchName
      ),
      displayName:
        cleanString(user.displayName) ||
        cleanString(profile?.displayName) ||
        cleanString(profile?.fullName) ||
        cleanString(profile?.name),
    };
  } catch (error) {
    console.error("Could not retrieve user information:", error);

    return {
      user,
      profile: null,
      role: null,
      isAdmin: false,
      active: false,
      branchId: "",
      displayName: "",
    };
  }
};
