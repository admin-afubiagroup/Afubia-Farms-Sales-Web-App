
import { useEffect, useState } from "react";

import { Navigate } from "react-router-dom";

import { onAuthStateChanged } from "firebase/auth";

import { auth } from "../Firebase/firebase.utils";

import { isAdminUser } from "../utils/auth";

const ProtectedRoute = ({
  children,
  adminOnly = false,
}) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminCheckLoading, setAdminCheckLoading] =
    useState(Boolean(adminOnly));

  useEffect(() => {
    let mounted = true;

    setUser(null);
    setIsAdmin(false);
    setLoading(true);
    setAdminCheckLoading(Boolean(adminOnly));

    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        if (!mounted) {
          return;
        }

        /* ===============================================
           USER IS NOT SIGNED IN
        =============================================== */

        if (!currentUser) {
          setUser(null);
          setIsAdmin(false);
          setAdminCheckLoading(false);
          setLoading(false);
          return;
        }

        /* ===============================================
           USER IS SIGNED IN
        =============================================== */

        setUser(currentUser);

        /* ===============================================
           STANDARD PROTECTED ROUTE
        =============================================== */

        if (!adminOnly) {
          setIsAdmin(false);
          setAdminCheckLoading(false);
          setLoading(false);
          return;
        }

        /* ===============================================
           ADMIN-ONLY ROUTE
        =============================================== */

        setAdminCheckLoading(true);

        try {
          const admin = await isAdminUser(currentUser);

          if (!mounted) {
            return;
          }

          console.log(
            "ProtectedRoute admin check:",
            {
              uid: currentUser.uid,
              email: currentUser.email,
              isAdmin: Boolean(admin),
            }
          );

          setIsAdmin(Boolean(admin));
        } catch (error) {
          console.error(
            "ProtectedRoute admin permission check failed:",
            error
          );

          if (!mounted) {
            return;
          }

          setIsAdmin(false);
        } finally {
          if (mounted) {
            setAdminCheckLoading(false);
            setLoading(false);
          }
        }
      }
    );

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [adminOnly]);

  /* =====================================================
     LOADING SCREEN
  ===================================================== */

  if (loading || adminCheckLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, #f4fbf7 0%, #eef5fb 100%)",
          fontFamily: "Inter, Arial, Helvetica, sans-serif",
          color: "#075e42",
        }}
      >
        <div
          style={{
            width: "46px",
            height: "46px",
            border: "4px solid #d8ebe2",
            borderTop: "4px solid #0f7a4a",
            borderRight: "4px solid #1e4e8c",
            borderRadius: "50%",
            animation: "afubiaSpin 0.9s linear infinite",
            marginBottom: "18px",
          }}
        />

        <h2
          style={{
            margin: 0,
            fontSize: "20px",
            fontWeight: "700",
          }}
        >
          Afubia Farms
        </h2>

        <p
          style={{
            marginTop: "8px",
            marginBottom: 0,
            color: "#64748b",
            fontSize: "14px",
          }}
        >
          {adminOnly
            ? "Checking your administrator access..."
            : "Checking your login..."}
        </p>

        <style>
          {`
            @keyframes afubiaSpin {
              from {
                transform: rotate(0deg);
              }

              to {
                transform: rotate(360deg);
              }
            }
          `}
        </style>
      </div>
    );
  }

  /* =====================================================
     REDIRECT IF NOT SIGNED IN
  ===================================================== */

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  /* =====================================================
     REDIRECT IF NOT AN ADMIN
  ===================================================== */

  if (adminOnly && !isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  /* =====================================================
     AUTHORIZED
  ===================================================== */

  return children;
};

export default ProtectedRoute;
