import {
  useEffect,
  useState,
} from "react";

import {
  onAuthStateChanged,
} from "firebase/auth";

import { auth } from "../Firebase/firebase.utils";

import {
  getUserProfile,
} from "../utils/auth";

import { speak } from "./VoiceAssistant";

import {
  saveMaterial,
} from "../Firebase/businessFirestore";

import "./MaterialsForm.css";

const MaterialsForm = () => {
  // =========================================================
  // FORM STATE
  // =========================================================

  const [material, setMaterial] =
    useState("");
  const [inventoryType, setInventoryType] = useState('');

  const [quantity, setQuantity] =
    useState("");

  const [cost, setCost] =
    useState("");

  const [status, setStatus] =
    useState("Purchased");

  // =========================================================
  // AUTHENTICATED USER
  // =========================================================

  const [currentUser, setCurrentUser] =
    useState(null);

  const [displayName, setDisplayName] =
    useState("");
  const [isAdminSession, setIsAdminSession] = useState(false);
  const [currentBranchId, setCurrentBranchId] = useState("");

  // =========================================================
  // UI STATE
  // =========================================================

  const [loading, setLoading] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [error, setError] =
    useState("");

  // =========================================================
  // LOAD CURRENT USER
  // =========================================================

  useEffect(() => {
    let mounted = true;

    const unsubscribe =
      onAuthStateChanged(
        auth,
        async (user) => {
          if (!mounted) {
            return;
          }

          setCurrentUser(user);

          if (!user) {
            setDisplayName("");
            setIsAdminSession(false);
            setCurrentBranchId("");
            return;
          }

          /*
           * DISPLAY NAME PRIORITY
           *
           * 1. Firebase Auth displayName
           * 2. Firestore users/{uid}.displayName
           * 3. Previously saved local display name
           *
           * IMPORTANT:
           *
           * We intentionally DO NOT use:
           *
           * user.email.split("@")[0]
           *
           * because the email prefix is not necessarily
           * the user's real name.
           */

          const firebaseName =
            String(
              user.displayName || ""
            ).trim();

          let firestoreName = "";

          try {
            const profile = await getUserProfile(user);
            firestoreName = String(profile?.displayName || "").trim();
            const role = String(profile?.role || profile?.userRole || "").toLowerCase();
            const admin = ["admin", "administrator", "superadmin", "super_admin"].includes(role) ||
              String(user.email || "").trim().toLowerCase() === "chukwuamakanwachukwu@outlook.com";
            const branch = admin
              ? ""
              : String(profile?.branchId || profile?.branch || profile?.branchName || "").trim().toLowerCase();
            const normalizedBranch = ["kara", "kara-shop"].includes(branch.replace(/[_\s]+/g, "-"))
              ? "kara"
              : ["ogidan", "ogidan-shop"].includes(branch.replace(/[_\s]+/g, "-"))
                ? "ogidan"
                : "";
            if (mounted) {
              setIsAdminSession(admin);
              setCurrentBranchId(normalizedBranch);
            }
          } catch (profileError) {
            console.warn(
              "Could not load user profile for materials:",
              profileError
            );
          }

          // Never use a shared browser-storage name for identity: it can
          // leak another account's display name on a shared shop device.
          const resolvedName = firebaseName || firestoreName || "";

          if (!mounted) {
            return;
          }

          setDisplayName(
            resolvedName
          );

        }
      );

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  // =========================================================
  // CLEAR MESSAGES
  // =========================================================

  const clearMessages = () => {
    setMessage("");
    setError("");
  };

  // =========================================================
  // SUBMIT MATERIAL
  // =========================================================

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (loading) {
      return;
    }

    clearMessages();

    // =======================================================
    // AUTHENTICATION CHECK
    // =======================================================

    if (!currentUser) {
      setError(
        "You must be logged in before saving a material."
      );

      speak(
        "Abeg login first before you save material."
      );

      return;
    }

    if (isAdminSession && !currentBranchId) {
      setError("Choose Kara Shop or Ogidan Shop before saving this material.");
      return;
    }

    // =======================================================
    // CLEAN INPUTS
    // =======================================================

    const cleanMaterial =
      material.trim();

    const numericQuantity =
      Number(quantity);

    const numericCost =
      Number(cost);

    // =======================================================
    // VALIDATION - MATERIAL
    // =======================================================

    if (!cleanMaterial) {
      setError(
        "Please enter the material name."
      );

      speak(
        "Abeg enter the material name."
      );

      return;
    }

    // =======================================================
    // VALIDATION - QUANTITY
    // =======================================================

    if (
      quantity === "" ||
      !Number.isFinite(
        numericQuantity
      ) ||
      numericQuantity <= 0
    ) {
      setError(
        "Please enter a quantity greater than zero."
      );

      speak(
        "Abeg enter the correct quantity."
      );

      return;
    }

    // =======================================================
    // VALIDATION - WHOLE NUMBER
    // =======================================================

    if (
      !Number.isInteger(
        numericQuantity
      )
    ) {
      setError(
        "Quantity must be a whole number."
      );

      speak(
        "The quantity suppose be a whole number."
      );

      return;
    }

    // =======================================================
    // VALIDATION - COST
    // =======================================================

    if (
      cost === "" ||
      !Number.isFinite(
        numericCost
      ) ||
      numericCost < 0
    ) {
      setError(
        "Please enter a valid cost."
      );

      speak(
        "Abeg enter the correct cost."
      );

      return;
    }

    // =======================================================
    // PURCHASE STATUS
    // =======================================================

    const isPurchased =
      status === "Purchased";

    // =======================================================
    // START SAVING
    // =======================================================

    setLoading(true);

    try {
      // =====================================================
      // UNIT COST
      // =====================================================

      const unitCost =
        numericQuantity > 0
          ? numericCost /
            numericQuantity
          : 0;

      // =====================================================
      // MATERIAL TYPE
      // =====================================================

      const materialType =
        cleanMaterial.toLowerCase();

      // =====================================================
      // RESOLVE USER DISPLAY NAME
      // =====================================================

      /*
       * Re-check the profile at save time.
       *
       * This prevents the material record from being
       * saved with a stale or incorrect display name.
       */

      let firestoreDisplayName = "";

      try {
        const profile =
          await getUserProfile(
            currentUser
          );

        firestoreDisplayName =
          String(
            profile?.displayName ||
              ""
          ).trim();
      } catch (profileError) {
        console.warn(
          "Could not retrieve user profile before material save:",
          profileError
        );
      }

      const firebaseDisplayName =
        String(
          currentUser.displayName ||
            ""
        ).trim();

      const resolvedDisplayName =
        firebaseDisplayName ||
        firestoreDisplayName ||
        displayName ||
        "";

      // =====================================================
      // FIRESTORE MATERIAL DATA
      // =====================================================
      //
      // Do NOT create recordDate or recordTime here.
      //
      // saveMaterial() / businessFirestore.js handles
      // the official Africa/Lagos business date/time.
      //
      // =====================================================

      const materialData = {
        ...(currentBranchId ? {
          branchId: currentBranchId,
          branchName: currentBranchId === "kara" ? "Kara Shop" : "Ogidan Shop",
        } : {}),
        // ---------------------------------------------------
        // BASIC INFORMATION
        // ---------------------------------------------------

        materialName:
          cleanMaterial,

        name:
          cleanMaterial,

        material:
          cleanMaterial,

        materialType,

        recordType:
          "material",

        activity:
          "Material purchase",

        // ---------------------------------------------------
        // USER / AUDIT INFORMATION
        // ---------------------------------------------------

        createdBy:
          currentUser.uid,

        userId:
          currentUser.uid,

        uid:
          currentUser.uid,

        createdByEmail:
          currentUser.email || "",

        userEmail:
          currentUser.email || "",

        createdByDisplayName:
          resolvedDisplayName,

        userDisplayName:
          resolvedDisplayName,

        displayName:
          resolvedDisplayName,

        // ---------------------------------------------------
        // QUANTITY
        // ---------------------------------------------------

        quantity:
          numericQuantity,

        purchasedQuantity:
          isPurchased
            ? numericQuantity
            : 0,

        remainingQuantity:
          isPurchased
            ? numericQuantity
            : 0,

        originalQuantity:
          isPurchased
            ? numericQuantity
            : 0,

        inventoryType,
        unit:
          "items",

        // ---------------------------------------------------
        // COST
        // ---------------------------------------------------

        totalCost:
          numericCost,

        cost:
          numericCost,

        unitCost,

        // ---------------------------------------------------
        // STATUS
        // ---------------------------------------------------

        status,

        isPurchased,

        // ---------------------------------------------------
        // SOURCE
        // ---------------------------------------------------

        source:
          "admin-materials",

        // ---------------------------------------------------
        // REPORTING
        // ---------------------------------------------------

        expenseType:
          "business-material",

        /*
         * Purchased materials count as business
         * expenses.
         *
         * Pending materials do not count yet.
         */

        affectsProfit:
          isPurchased,

        /*
         * Only purchased materials enter physical stock.
         */

        affectsStock:
          isPurchased,

        // ---------------------------------------------------
        // DESCRIPTION
        // ---------------------------------------------------

        description:
          isPurchased
            ? `${numericQuantity.toLocaleString()} ${cleanMaterial} purchased for ₦${numericCost.toLocaleString()}.`
            : `${numericQuantity.toLocaleString()} ${cleanMaterial} pending purchase at ₦${numericCost.toLocaleString()}.`,
      };

      // =====================================================
      // DEBUG
      // =====================================================

      console.log(
        "Saving material record:",
        materialData
      );

      // =====================================================
      // SAVE TO FIRESTORE
      // =====================================================

      const materialRef =
        await saveMaterial(
          materialData
        );

      console.log(
        "Material saved successfully:",
        materialRef
      );

      // =====================================================
      // SUCCESS MESSAGE
      // =====================================================

      if (isPurchased) {
        setMessage(
          "Material saved successfully. It has been added to stock and will be included in Profit Analysis and Reports."
        );

        speak(
          "Done! The material don enter the business record."
        );
      } else {
        setMessage(
          "Pending material saved successfully. It has been recorded but will not increase stock or profit expenses yet."
        );

        speak(
          "Done! The pending material don enter the record."
        );
      }

      // =====================================================
      // RESET FORM
      // =====================================================

      setMaterial("");
      setQuantity("");
      setCost("");
      setStatus("Purchased");
    } catch (firebaseError) {
      console.error(
        "Materials Firestore error:",
        firebaseError
      );

      // =====================================================
      // FRIENDLY ERROR
      // =====================================================

      let friendlyError =
        "Unable to save the material. Please check your connection and try again.";

      const errorCode =
        firebaseError?.code || "";

      const errorMessage =
        firebaseError?.message || "";

      if (
        errorCode ===
          "permission-denied" ||
        errorCode ===
          "firestore/permission-denied" ||
        errorMessage
          .toLowerCase()
          .includes(
            "missing or insufficient permissions"
          )
      ) {
        friendlyError =
          "You do not have permission to save materials. Please check your administrator access and Firestore rules.";
      } else if (
        errorCode ===
        "unavailable"
      ) {
        friendlyError =
          "Firebase is temporarily unavailable. Please check your internet connection and try again.";
      } else if (
        errorMessage
          .toLowerCase()
          .includes(
            "logged in"
          )
      ) {
        friendlyError =
          "Your login session is not ready yet. Please wait a moment and try again.";
      }

      setError(
        friendlyError
      );

      speak(
        "Something no work while saving the material."
      );
    } finally {
      setLoading(false);
    }
  };

  // =========================================================
  // UI
  // =========================================================

  return (
    <div className="materials-container">

      {/* =====================================================
          HEADER
      ===================================================== */}

      <div className="materials-header">

        <div>

          <span className="materials-eyebrow">
            AFUBIA FARMS • INVENTORY
          </span>

          <h1>
            Materials Management
          </h1>

          <p>
            Record materials purchased or
            materials still pending for the
            palm oil business.
          </p>

          {/* LOGGED-IN USER */}

          {currentUser && (
            <div
              className="materials-user"
              style={{
                marginTop: "10px",
                color: "#075e42",
                fontSize: "14px",
                fontWeight: "600",
              }}
            >
              Logged in as{" "}
              <strong>
                {displayName ||
                  "Afubia User"}
              </strong>
            </div>
          )}

        </div>

        <div className="materials-live">

          <span className="materials-live-dot"></span>

          <span>
            LIVE • FIRESTORE
          </span>

        </div>

      </div>

      {/* =====================================================
          SUCCESS MESSAGE
      ===================================================== */}

      {message && (
        <div className="materials-message success">

          <div>

            <strong>
              Material Saved
            </strong>

            <p>
              {message}
            </p>

          </div>

          <button
            type="button"
            onClick={() =>
              setMessage("")
            }
            aria-label="Close success message"
          >
            ×
          </button>

        </div>
      )}

      {/* =====================================================
          ERROR MESSAGE
      ===================================================== */}

      {error && (
        <div className="materials-message error">

          <div>

            <strong>
              Unable to Save
            </strong>

            <p>
              {error}
            </p>

          </div>

          <button
            type="button"
            onClick={() =>
              setError("")
            }
            aria-label="Close error message"
          >
            ×
          </button>

        </div>
      )}

      {/* =====================================================
          FORM
      ===================================================== */}

      <form
        onSubmit={handleSubmit}
      >

        {/* ===================================================
            FORM HEADER
        =================================================== */}

        {isAdminSession && (
          <div className="branch-choice-panel materials-branch-choice" role="group" aria-labelledby="materials-branch-label">
            <label id="materials-branch-label" htmlFor="materials-branch-choice">Shop for this purchase</label>
            <select
              id="materials-branch-choice"
              value={currentBranchId}
              onChange={(event) => {
                const nextBranch = event.target.value;
                setCurrentBranchId(nextBranch);
              }}
              required
            >
              <option value="">Choose a shop before recording</option>
              <option value="kara">Kara Shop</option>
              <option value="ogidan">Ogidan Shop</option>
            </select>
            <small>The purchase will be recorded against the selected shop.</small>
          </div>
        )}

        <div className="materials-form-header">

          <div>

            <span>
              BUSINESS EXPENSES
            </span>

            <h2>
              Add Material
            </h2>

          </div>

          <div className="materials-form-icon">
            📦
          </div>

        </div>

        {/* ===================================================
            MATERIAL
        =================================================== */}

        <div className="materials-field">
          <label htmlFor="inventory-type">Inventory classification</label>
          <select id="inventory-type" value={inventoryType} onChange={e => setInventoryType(e.target.value)}>
            <option value="">Other material / expense</option>
            <option value="kegs">Unturned palm oil kegs (27 usable litres each)</option>
            <option value="75cl">Empty 75cl containers</option>
            <option value="1L">Empty 1L containers</option>
            <option value="5L">Empty 5L jerrycans</option>
          </select>
          <small>Choose the exact stock type so oil turning can verify available materials.</small>
        </div>
        <div className="materials-field">

          <label htmlFor="material">
            Material
          </label>

          <input
            id="material"
            type="text"
            value={material}
            onChange={(e) =>
              setMaterial(
                e.target.value
              )
            }
            placeholder="e.g. Bottles"
            autoComplete="off"
            disabled={loading}
            required
          />

          <small>
            Enter the material or item purchased.
          </small>

        </div>

        {/* ===================================================
            QUANTITY
        =================================================== */}

        <div className="materials-field">

          <label htmlFor="quantity">
            Quantity
          </label>

          <input
            id="quantity"
            type="number"
            min="1"
            step="1"
            value={quantity}
            onChange={(e) =>
              setQuantity(
                e.target.value
              )
            }
            placeholder="e.g. 100"
            disabled={loading}
            required
          />

          <small>
            Enter the number of items.
          </small>

        </div>

        {/* ===================================================
            COST
        =================================================== */}

        <div className="materials-field">

          <label htmlFor="cost">
            Cost (₦)
          </label>

          <div className="materials-input-money">

            <span>
              ₦
            </span>

            <input
              id="cost"
              type="number"
              min="0"
              step="0.01"
              value={cost}
              onChange={(e) =>
                setCost(
                  e.target.value
                )
              }
              placeholder="e.g. 25000"
              disabled={loading}
              required
            />

          </div>

          <small>
            Enter the total amount spent.
          </small>

        </div>

        {/* ===================================================
            STATUS
        =================================================== */}

        <div className="materials-field">

          <label htmlFor="status">
            Status
          </label>

          <select
            id="status"
            value={status}
            onChange={(e) =>
              setStatus(
                e.target.value
              )
            }
            disabled={loading}
          >

            <option value="Purchased">
              Purchased
            </option>

            <option value="Pending">
              Pending
            </option>

          </select>

          <small>
            Purchased materials increase stock
            and count as expenses. Pending
            materials are recorded but do not
            affect stock or profit yet.
          </small>

        </div>

        {/* ===================================================
            PURCHASE SUMMARY
        =================================================== */}

        {material.trim() &&
          quantity &&
          cost !== "" && (
            <div className="materials-summary">

              <div>

                <span>
                  Material
                </span>

                <strong>
                  {material.trim()}
                </strong>

              </div>

              <div>

                <span>
                  Quantity
                </span>

                <strong>
                  {Number(
                    quantity
                  ).toLocaleString()}{" "}
                  items
                </strong>

              </div>

              <div>

                <span>
                  Total spent
                </span>

                <strong>
                  ₦
                  {Number(
                    cost
                  ).toLocaleString()}
                </strong>

              </div>

              <div>

                <span>
                  Cost per item
                </span>

                <strong>
                  ₦
                  {(
                    Number(cost) /
                    Math.max(
                      1,
                      Number(quantity)
                    )
                  ).toLocaleString(
                    undefined,
                    {
                      maximumFractionDigits: 2,
                    }
                  )}
                </strong>

              </div>

            </div>
          )}

        {/* ===================================================
            FIRESTORE INFORMATION
        =================================================== */}

        <div className="materials-submit-area">

          <div className="materials-sync-info">

            <span className="sync-dot"></span>

            <span>
              Data is saved directly to Firestore
            </span>

          </div>

          {/* =================================================
              SUBMIT BUTTON
          ================================================= */}

          <button
            type="submit"
            disabled={
              loading ||
              !currentUser
            }
          >

            {loading ? (
              <>
                <span className="button-spinner"></span>

                Saving...
              </>
            ) : (
              <>
                Save Material

                <span>
                  →
                </span>
              </>
            )}

          </button>

        </div>

      </form>

    </div>
  );
};

export default MaterialsForm;
