/* eslint-disable no-useless-assignment */
import {
  doc,
  getDoc,
} from "firebase/firestore";

import {
  auth,
  db,
} from "../Firebase/firebase.utils";

/* =========================================================
   ADMIN EMAILS
========================================================= */

export const ADMIN_EMAILS = [
  "chukwuamakanwachukwu@outlook.com",
];

/* =========================================================
   ADMIN ROLES
========================================================= */

export const ADMIN_ROLES = [
  "admin",
  "administrator",
  "superadmin",
  "super_admin",
];

/* =========================================================
   NORMALIZE EMAIL
========================================================= */

const normalizeEmail = (
  email
) => {
  return String(
    email || ""
  )
    .trim()
    .toLowerCase();
};

/* =========================================================
   NORMALIZE ROLE
========================================================= */

const normalizeRole = (
  role
) => {
  return String(
    role || ""
  )
    .trim()
    .toLowerCase();
};

/* =========================================================
   CHECK ADMIN EMAIL
========================================================= */

export const isAdminEmail = (
  user
) => {
  if (!user?.email) {
    return false;
  }

  const email =
    normalizeEmail(
      user.email
    );

  return ADMIN_EMAILS.includes(
    email
  );
};

/* =========================================================
   CHECK ADMIN ROLE
========================================================= */

export const hasAdminRole = (
  profile
) => {
  if (!profile) {
    return false;
  }

  /*
   * Explicit isAdmin flag has priority.
   */

  if (
    profile.isAdmin === true
  ) {
    return true;
  }

  /*
   * Support both the current `role`
   * field and the older `userRole`
   * field.
   */

  const role =
    normalizeRole(
      profile.role ??
        profile.userRole
    );

  return ADMIN_ROLES.includes(
    role
  );
};

/* =========================================================
   GET USER PROFILE
========================================================= */

export const getUserProfile =
  async (
    user
  ) => {
    if (!user?.uid) {
      return null;
    }

    try {
      const userRef =
        doc(
          db,
          "users",
          user.uid
        );

      const snapshot =
        await getDoc(
          userRef
        );

      if (
        !snapshot.exists()
      ) {
        return null;
      }

      return {
        uid:
          user.uid,

        ...snapshot.data(),
      };
    } catch (error) {
      console.error(
        "Could not read user profile:",
        error
      );

      throw error;
    }
  };

/* =========================================================
   GET USER DISPLAY NAME
========================================================= */

/*
 * Display-name priority:
 *
 * 1. Firebase Auth displayName
 * 2. Firestore users/{uid}.displayName
 * 3. Empty string
 *
 * IMPORTANT:
 *
 * We intentionally DO NOT use:
 *
 * user.email.split("@")[0]
 *
 * because that is not the user's actual
 * full name.
 */

export const getUserDisplayName =
  async (
    user
  ) => {
    if (!user) {
      return "";
    }

    /* -----------------------------------------------
       FIREBASE AUTH NAME
    ----------------------------------------------- */

    const firebaseDisplayName =
      String(
        user.displayName || ""
      ).trim();

    if (
      firebaseDisplayName
    ) {
      return firebaseDisplayName;
    }

    /* -----------------------------------------------
       FIRESTORE NAME
    ----------------------------------------------- */

    try {
      const profile =
        await getUserProfile(
          user
        );

      const firestoreDisplayName =
        String(
          profile?.displayName ||
            ""
        ).trim();

      if (
        firestoreDisplayName
      ) {
        return firestoreDisplayName;
      }
    } catch (error) {
      /*
       * Display-name retrieval should not
       * prevent the application from loading.
       */

      console.warn(
        "Could not retrieve saved display name:",
        error
      );
    }

    /* -----------------------------------------------
       NO NAME AVAILABLE
    ----------------------------------------------- */

    return "";
  };

/* =========================================================
   GET USER ROLE
========================================================= */

export const getUserRole =
  async (
    user
  ) => {
    if (!user) {
      return null;
    }

    /* -----------------------------------------------
       ADMIN EMAIL
    ----------------------------------------------- */

    /*
     * The configured administrator email is
     * always considered an administrator.
     *
     * This also allows the primary admin account
     * to bootstrap correctly even if its Firestore
     * profile has not been created yet.
     */

    if (
      isAdminEmail(user)
    ) {
      return "admin";
    }

    /* -----------------------------------------------
       FIRESTORE PROFILE
    ----------------------------------------------- */

    try {
      const profile =
        await getUserProfile(
          user
        );

      /*
       * No profile means we cannot safely
       * determine a role yet.
       */

      if (!profile) {
        return null;
      }

      const role =
        normalizeRole(
          profile.role ??
            profile.userRole
        );

      /* ---------------------------------------------
         ADMIN ROLE
      --------------------------------------------- */

      if (
        ADMIN_ROLES.includes(
          role
        )
      ) {
        return "admin";
      }

      /* ---------------------------------------------
         OTHER VALID ROLE
      --------------------------------------------- */

      if (role) {
        return role;
      }

      /* ---------------------------------------------
         DEFAULT SALES GIRL
      --------------------------------------------- */

      return "salesgirl";
    } catch (error) {
      console.error(
        "Could not determine user role:",
        error
      );

      return null;
    }
  };

/* =========================================================
   IS ADMIN USER
========================================================= */

export const isAdminUser =
  async (
    user
  ) => {
    if (!user) {
      return false;
    }

    /* -----------------------------------------------
       ADMIN EMAIL
    ----------------------------------------------- */

    /*
     * Check the configured admin email first.
     */

    if (
      isAdminEmail(user)
    ) {
      return true;
    }

    /* -----------------------------------------------
       FIRESTORE ADMIN ROLE
    ----------------------------------------------- */

    try {
      const profile =
        await getUserProfile(
          user
        );

      if (!profile) {
        return false;
      }

      return hasAdminRole(
        profile
      );
    } catch (error) {
      console.error(
        "Admin user check failed:",
        error
      );

      return false;
    }
  };

/* =========================================================
   CURRENT USER
========================================================= */

export const getCurrentUser =
  () => {
    return (
      auth.currentUser ||
      null
    );
  };

/* =========================================================
   GET USER INFORMATION
========================================================= */

/*
 * This helper is useful for Login,
 * dashboards and other components that
 * need all user information together.
 *
 * It does not invent a display name.
 */

export const getUserInformation =
  async (
    user
  ) => {
    if (!user) {
      return {
        user: null,
        profile: null,
        role: null,
        isAdmin: false,
        displayName: "",
      };
    }

    let profile = null;

    try {
      profile =
        await getUserProfile(
          user
        );
    } catch (error) {
      console.warn(
        "Could not retrieve user information:",
        error
      );
    }

    const admin =
      isAdminEmail(user)
        ? true
        : hasAdminRole(
            profile
          );

    let role =
      null;

    if (admin) {
      role = "admin";
    } else {
      const profileRole =
        normalizeRole(
          profile?.role ??
            profile?.userRole
        );

      role =
        profileRole ||
        "salesgirl";
    }

    const firebaseDisplayName =
      String(
        user.displayName || ""
      ).trim();

    const firestoreDisplayName =
      String(
        profile?.displayName ||
          ""
      ).trim();

    const displayName =
      firebaseDisplayName ||
      firestoreDisplayName ||
      "";

    return {
      user,
      profile,
      role,
      isAdmin: admin,
      displayName,
    };
  };