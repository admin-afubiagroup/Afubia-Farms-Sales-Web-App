import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../Firebase/firebase.utils";

import ResponsiveLayout from "./ResponsiveLayout";

import {
  playOnPageOpen,
  playAudio,
  speakAudio,
  stopAllAudio,
} from "./AudioManager";

import { saveConversion } from "../Firebase/businessFirestore";
import "./conversion.css";

const NOMINAL_KEG_CAPACITY_LITRES = 30;
const USABLE_LITRES_PER_KEG = 27;

const getNigeriaDateTime = () => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const values = {};

  parts.forEach((part) => {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  });

  const recordDate =
    `${values.year}-${values.month}-${values.day}`;

  const recordTime =
    `${values.hour}:${values.minute}:${values.second}`;

  return {
    recordDate,
    recordTime,
    dateTime: `${recordDate} ${recordTime}`,
  };
};

const playSafely = async (audioPath) => {
  try {
    await playAudio(audioPath);
  } catch (error) {
    console.warn(`Could not play ${audioPath}:`, error);
  }
};

const speakSafely = async (value) => {
  try {
    await speakAudio(String(value));
  } catch (error) {
    console.warn("Speech audio failed:", error);
  }
};

const normalizeBranchId = (value) => {
  const text = String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (["kara", "kara-shop"].includes(text)) return "kara";
  if (["ogidan", "ogidan-shop"].includes(text)) return "ogidan";
  return "";
};

const ConversionForm = ({ source = "salesgirl" }) => {
  const [currentBranchId, setCurrentBranchId] = useState("");
  const [isAdminSession, setIsAdminSession] = useState(false);
  const [kegs, setKegs] = useState(0);
  const [bottles75cl, setBottles75cl] = useState(0);
  const [bottles1L, setBottles1L] = useState(0);
  const [jerrycans5L, setJerrycans5L] = useState(0);

  const [notification, setNotification] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        if (mounted) { setCurrentBranchId(""); setIsAdminSession(false); }
        return;
      }
      try {
        const snapshot = await getDoc(doc(db, "users", user.uid));
        const profile = snapshot.exists() ? snapshot.data() : {};
        const role = String(profile.role || profile.userRole || "").toLowerCase();
        const admin = ["admin", "administrator", "superadmin", "super_admin"].includes(role) ||
          String(user.email || "").trim().toLowerCase() === "chukwuamakanwachukwu@outlook.com";
        const branch = admin
          ? ""
          : normalizeBranchId(profile.branchId || profile.branch || profile.branchName);
        if (mounted) { setIsAdminSession(admin); setCurrentBranchId(branch); }
      } catch (error) {
        console.error("Could not resolve conversion branch:", error);
        if (mounted) { setCurrentBranchId(""); setIsAdminSession(false); }
      }
    });
    const cleanup = playOnPageOpen("turn_oil");
    return () => {
      mounted = false;
      unsubscribeAuth();
      if (typeof cleanup === "function") cleanup();
      stopAllAudio();
    };
  }, []);

  const kegAmount = Math.max(0, Number(kegs) || 0);
  const bottle75Amount = Math.max(0, Number(bottles75cl) || 0);
  const bottle1LAmount = Math.max(0, Number(bottles1L) || 0);
  const jerrycan5Amount = Math.max(0, Number(jerrycans5L) || 0);

  const summary = useMemo(() => {
    const litresProduced = kegAmount * USABLE_LITRES_PER_KEG;
    const litresFrom75cl = bottle75Amount * 0.75;
    const litresFrom1L = bottle1LAmount;
    const litresFrom5L = jerrycan5Amount * 5;

    const litresUsed =
      litresFrom75cl + litresFrom1L + litresFrom5L;

    return {
      litresProduced,
      litresFrom75cl,
      litresFrom1L,
      litresFrom5L,
      litresUsed,
      litresRemaining: Math.max(0, litresProduced - litresUsed),
    };
  }, [
    kegAmount,
    bottle75Amount,
    bottle1LAmount,
    jerrycan5Amount,
  ]);

  const {
    litresProduced,
    litresFrom75cl,
    litresFrom1L,
    litresFrom5L,
    litresUsed,
    litresRemaining,
  } = summary;

  const showNotification = (type, message, detail = "") => {
    setNotification({ type, message, detail });
  };

  const resetForm = () => {
    setKegs(0);
    setBottles75cl(0);
    setBottles1L(0);
    setJerrycans5L(0);
  };

  const showValidationError = async (type, message, detail = "") => {
    await playSafely("conversion_error");
    showNotification(type, message, detail);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (saving) return;

    setNotification(null);

    if (!Number.isInteger(kegAmount) || kegAmount <= 0) {
      await showValidationError(
        "warning",
        "Abeg enter how many keg you turn.",
        "The number of kegs must be a whole number greater than zero."
      );
      return;
    }

    if (
      !Number.isInteger(bottle75Amount) ||
      !Number.isInteger(bottle1LAmount) ||
      !Number.isInteger(jerrycan5Amount)
    ) {
      await showValidationError(
        "warning",
        "Check the container quantities.",
        "Bottle and jerrycan quantities must be whole numbers."
      );
      return;
    }

    if (litresUsed <= 0) {
      await showValidationError(
        "warning",
        "Abeg enter the containers you fill.",
        "Enter at least one 75cl bottle, 1L bottle or 5L jerrycan."
      );
      return;
    }

    if (litresUsed > litresProduced + 0.000001) {
      await showValidationError(
        "error",
        "The litres no balance.",
        `You entered ${litresUsed.toLocaleString()}L of containers, but ${kegAmount} keg provides only ${litresProduced.toLocaleString()}L of usable oil.`
      );
      return;
    }

    setSaving(true);
    stopAllAudio();

    try {
      const { recordDate, recordTime, dateTime } =
        getNigeriaDateTime();

      const recordSource =
        String(source).toLowerCase() === "admin"
          ? "admin"
          : "salesgirl";

      if (!currentBranchId) {
        throw new Error(isAdminSession
          ? "Choose Kara Shop or Ogidan Shop before saving this conversion."
          : "Your account has no valid assigned shop. Contact the administrator.");
      }

      const conversionData = {
        branchId: currentBranchId,
        recordType: "conversion",
        source: recordSource,
        activity: "Palm oil conversion / turning",

        // New records from this form belong to shop stock.
        stockLocation: "shop",
        location: "shop",
        saleLocation: "shop",
        affectsShopStock: true,
        affectsFarmStock: false,
        affectsStock: true,
        affectsProfit: false,

        recordDate,
        recordTime,
        dateTime,
        createdAtClient: new Date().toISOString(),

        // Keg capacity and usable oil must remain separate.
        kegCount: kegAmount,
        kegs: kegAmount,
        nominalKegCapacityLitres: NOMINAL_KEG_CAPACITY_LITRES,
        usableLitresPerKeg: USABLE_LITRES_PER_KEG,
        litresPerKeg: USABLE_LITRES_PER_KEG,

        litresProduced,
        totalLitres: litresProduced,
        oilProducedLitres: litresProduced,

        // Exact output counts.
        bottles75cl: bottle75Amount,
        bottles75clProduced: bottle75Amount,
        total75clBottles: bottle75Amount,
        litresFrom75cl,

        bottles1L: bottle1LAmount,
        bottles1LProduced: bottle1LAmount,
        total1LBottles: bottle1LAmount,
        litresFrom1L,

        jerrycans5L: jerrycan5Amount,
        jerrycans5LProduced: jerrycan5Amount,
        total5LJerrycans: jerrycan5Amount,
        litresFrom5L,

        // Loose oil remaining is separate from packaged oil.
        litresUsed,
        oilUsedLitres: litresUsed,
        litresRemaining,
        oilRemainingLitres: litresRemaining,

        description:
          `${kegAmount} nominal 30L keg(s), ` +
          `${litresProduced}L usable oil, turned into ` +
          `${bottle75Amount} 75cl bottle(s), ` +
          `${bottle1LAmount} 1L bottle(s) and ` +
          `${jerrycan5Amount} 5L jerrycan(s); ` +
          `${litresRemaining}L left loose.`,
      };

      await saveConversion(conversionData);
      void speakSafely(`Oil don turn and save. You turn ${kegAmount} keg into ${bottle75Amount} seventy five c l bottles, ${bottle1LAmount} one litre bottles, and ${jerrycan5Amount} five litre jerrycans.`);

      showNotification(
        "success",
        "Oil don turn successfully!",
        `${kegAmount} keg • ${litresProduced}L usable oil • ` +
          `${litresUsed}L packaged • ${litresRemaining}L remaining loose.`
      );

      resetForm();
    } catch (error) {
      console.error("Conversion save error:", error);

      await playSafely("conversion_error");

      showNotification(
        "error",
        "Oil record no enter yet.",
        error?.message ||
          "Abeg check your connection and try again."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveLayout>
      {notification && (
        <div
          className={`conversion-notification conversion-notification-${notification.type}`}
          role="alert"
        >
          <div className="conversion-notification-icon">
            {notification.type === "success"
              ? "✓"
              : notification.type === "warning"
                ? "!"
                : "×"}
          </div>

          <div className="conversion-notification-content">
            <strong>{notification.message}</strong>
            {notification.detail && <span>{notification.detail}</span>}
          </div>

          <button
            type="button"
            className="conversion-notification-close"
            onClick={() => setNotification(null)}
            aria-label="Close notification"
          >
            ×
          </button>

          <div className="conversion-notification-progress" />
        </div>
      )}

      <div className="conversion-container">
        {isAdminSession && (
          <div className="branch-choice-panel" role="group" aria-labelledby="conversion-branch-label">
            <label id="conversion-branch-label" htmlFor="conversion-branch-choice">Shop for this conversion</label>
            <select
              id="conversion-branch-choice"
              value={currentBranchId}
              onChange={(event) => {
                const nextBranch = normalizeBranchId(event.target.value);
                setCurrentBranchId(nextBranch);
              }}
              required
            >
              <option value="">Choose a shop before recording</option>
              <option value="kara">Kara Shop</option>
              <option value="ogidan">Ogidan Shop</option>
            </select>
            <small>The conversion will be recorded under your administrator account and the selected shop.</small>
          </div>
        )}
        <div className="conversion-heading">
          <span className="conversion-eyebrow">PALM OIL TRANSFER</span>
          <h2 className="conversion-title">Turn Palm Oil</h2>
          <p className="conversion-description">
            Record the kegs turned and the containers filled.
            Each nominal 30L keg provides 27L of usable oil.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="conversion-form">
          <div className="form-group">
            <label htmlFor="kegs">
              <span>How many kegs you turn?</span>
              <small>30L nominal capacity • 27L usable oil per keg</small>
            </label>

            <input
              id="kegs"
              type="number"
              step="1"
              min="1"
              value={kegs}
              onChange={(event) =>
                setKegs(Math.max(0, parseInt(event.target.value, 10) || 0))
              }
              className="conversion-input"
              placeholder="e.g. 2"
              disabled={saving}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="bottles75cl">
              <span>How many 75cl bottles you fill?</span>
              <small>0.75 litre each</small>
            </label>

            <input
              id="bottles75cl"
              type="number"
              step="1"
              min="0"
              value={bottles75cl}
              onChange={(event) =>
                setBottles75cl(
                  Math.max(0, parseInt(event.target.value, 10) || 0)
                )
              }
              className="conversion-input"
              placeholder="e.g. 20"
              disabled={saving}
            />
          </div>

          <div className="form-group">
            <label htmlFor="bottles1L">
              <span>How many 1-litre bottles you fill?</span>
              <small>1 litre each</small>
            </label>

            <input
              id="bottles1L"
              type="number"
              step="1"
              min="0"
              value={bottles1L}
              onChange={(event) =>
                setBottles1L(
                  Math.max(0, parseInt(event.target.value, 10) || 0)
                )
              }
              className="conversion-input"
              placeholder="e.g. 10"
              disabled={saving}
            />
          </div>

          <div className="form-group">
            <label htmlFor="jerrycans5L">
              <span>How many 5-litre jerrycans you fill?</span>
              <small>5 litres each</small>
            </label>

            <input
              id="jerrycans5L"
              type="number"
              step="1"
              min="0"
              value={jerrycans5L}
              onChange={(event) =>
                setJerrycans5L(
                  Math.max(0, parseInt(event.target.value, 10) || 0)
                )
              }
              className="conversion-input"
              placeholder="e.g. 2"
              disabled={saving}
            />
          </div>

          <div className="conversion-summary">
            <div className="conversion-summary-header">
              <h3>Conversion Summary</h3>
              <p>Calculated using 27 usable litres per keg.</p>
            </div>

            <div className="conversion-summary-row">
              <span>Nominal capacity of kegs</span>
              <strong>
                {(kegAmount * NOMINAL_KEG_CAPACITY_LITRES).toLocaleString()} L
              </strong>
            </div>

            <div className="conversion-summary-row">
              <span>Usable oil available</span>
              <strong>{litresProduced.toLocaleString()} L</strong>
            </div>

            <div className="conversion-summary-row">
              <span>Oil in 75cl bottles</span>
              <strong>{litresFrom75cl.toLocaleString()} L</strong>
            </div>

            <div className="conversion-summary-row">
              <span>Oil in 1L bottles</span>
              <strong>{litresFrom1L.toLocaleString()} L</strong>
            </div>

            <div className="conversion-summary-row">
              <span>Oil in 5L jerrycans</span>
              <strong>{litresFrom5L.toLocaleString()} L</strong>
            </div>

            <div className="conversion-summary-row">
              <span>Total oil packaged</span>
              <strong>{litresUsed.toLocaleString()} L</strong>
            </div>

            <div className="conversion-summary-row conversion-summary-remaining">
              <span>Remaining loose oil</span>
              <strong>{litresRemaining.toLocaleString()} L</strong>
            </div>
          </div>

          {litresUsed > litresProduced && (
            <div
              className="conversion-notification conversion-notification-error"
              role="alert"
            >
              <div className="conversion-notification-icon">!</div>
              <div className="conversion-notification-content">
                <strong>Container quantities exceed available oil</strong>
                <span>
                  Reduce the container counts before saving this conversion.
                </span>
              </div>
            </div>
          )}

          <button
            type="submit"
            className="conversion-button"
            disabled={saving || kegAmount <= 0 || litresUsed <= 0 || litresUsed > litresProduced}
          >
            <span>{saving ? "..." : "✓"}</span>
            <span>{saving ? "Saving record..." : "Enter today's record"}</span>
          </button>
        </form>
      </div>
    </ResponsiveLayout>
  );
};

export default ConversionForm;