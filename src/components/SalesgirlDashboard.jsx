import {
  useEffect,
  useState,
} from "react";

import {
  useNavigate,
} from "react-router-dom";

import {
  onAuthStateChanged,
} from "firebase/auth";

import {
  getUserProfile,
} from "../utils/auth";

import ResponsiveLayout from "./ResponsiveLayout";

import {
  playOnPageOpen,
  stopAllAudio,
} from "./AudioManager";

import {
  auth,
} from "../Firebase/firebase.utils";

import "./dashboard.css";

import Containers from "../assets/oil_containers.jpg";
import OilTurning from "../assets/palm_oil_turning.jpg";

/* =========================================================
   CONSTANTS
========================================================= */

const DISPLAY_NAME_STORAGE_KEY =
  "afubiaUserDisplayName";

/* =========================================================
   SALES GIRL DASHBOARD
========================================================= */

const SalesgirlDashboard =
  () => {
    const navigate =
      useNavigate();

    const [
      currentUser,
      setCurrentUser,
    ] = useState(null);

    const [
      displayName,
      setDisplayName,
    ] = useState("");

    /* =======================================================
       AUTHENTICATION
    ======================================================= */

    useEffect(() => {
      let mounted = true;

      const unsubscribe =
        onAuthStateChanged(
          auth,
          async (user) => {
            if (!mounted) {
              return;
            }

            setCurrentUser(
              user
            );

            if (!user) {
              setDisplayName(
                ""
              );

              return;
            }

            try {
              /* ---------------------------------------------
                 GET FIREBASE PROFILE
              --------------------------------------------- */

              const profile =
                await getUserProfile(
                  user
                );

              if (!mounted) {
                return;
              }

              /* ---------------------------------------------
                 GET FULL NAME
              --------------------------------------------- */

              const firebaseName =
                user.displayName
                  ?.trim() || "";

              const firestoreName =
                profile?.displayName
                  ?.trim() || "";

              const storedName =
                window.localStorage.getItem(
                  DISPLAY_NAME_STORAGE_KEY
                )?.trim() || "";

              /*
               * IMPORTANT:
               *
               * We DO NOT use the email address
               * to create a name.
               */

              const resolvedName =
                firebaseName ||
                firestoreName ||
                storedName ||
                "";

              setDisplayName(
                resolvedName
              );

              if (
                resolvedName
              ) {
                window.localStorage.setItem(
                  DISPLAY_NAME_STORAGE_KEY,
                  resolvedName
                );
              }
            } catch (error) {
              console.error(
                "Could not load user name:",
                error
              );
            }
          }
        );

      return () => {
        mounted = false;
        unsubscribe();
      };
    }, []);

    /* =======================================================
       AUDIO
    ======================================================= */

    useEffect(() => {
      let cleanup;

      try {
        cleanup =
          playOnPageOpen(
            "/dashboard.m4a"
          );
      } catch (error) {
        console.warn(
          "Dashboard audio warning:",
          error
        );
      }

      return () => {
        if (
          typeof cleanup ===
          "function"
        ) {
          cleanup();
        }

        stopAllAudio();
      };
    }, []);

    /* =======================================================
       TURN OIL
    ======================================================= */

    const handleTurnOil =
      () => {
        stopAllAudio();

        navigate(
          "/conversion"
        );
      };

    /* =======================================================
       RECORD SALE
    ======================================================= */

    const handleRecordSale =
      () => {
        stopAllAudio();

        navigate(
          "/sales"
        );
      };

    /* =======================================================
       UI
    ======================================================= */

    return (
      <ResponsiveLayout>

        <div className="dashboard-container">

          <div className="dashboard-heading">

            <span className="dashboard-eyebrow">
              AFUBIA FARMS
            </span>

            {/* =================================================
                FULL NAME
            ================================================= */}

            {currentUser &&
              displayName && (
                <div
                  className="dashboard-welcome-user"
                  aria-label={`Logged in as ${displayName}`}
                >
                  Welcome,{" "}
                  <strong>
                    {displayName}
                  </strong>{" "}
                  👋
                </div>
              )}

            <h2 className="dashboard-title">
              Wetin you wan do today?
            </h2>

            <p className="dashboard-subtitle">
              Pick wetin you wan do below
              to arrange today palm oil
              work.
            </p>

          </div>

          {/* =================================================
              ACTIONS
          ================================================= */}

          <div className="dashboard-actions">

            {/* =================================================
                TURN OIL
            ================================================= */}

            <button
              type="button"
              onClick={
                handleTurnOil
              }
              className="dashboard-action dashboard-action-conversion"
              aria-label="Turn palm oil"
            >

              <div className="action-icon">

                <img
                  src={OilTurning}
                  alt="Palm oil turning"
                />

              </div>

              <div className="action-content">

                <strong>
                  Turn Oil
                </strong>

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

            {/* =================================================
                RECORD SALE
            ================================================= */}

            <button
              type="button"
              onClick={
                handleRecordSale
              }
              className="dashboard-action dashboard-action-sales"
              aria-label="Record today's market"
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
                  Record market wey customer
                  buy
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