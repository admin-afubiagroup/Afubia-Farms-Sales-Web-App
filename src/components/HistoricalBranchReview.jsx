import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "../Firebase/firebase.utils";

const SOURCES = [
  { collection: "sales", label: "Sale" },
  { collection: "conversions", label: "Oil conversion" },
  { collection: "materials", label: "Material purchase" },
  { collection: "expenses", label: "Expense" },
  { collection: "shopOpeningStock", label: "Shop opening stock" },
];

const normalizeBranch = (record) => {
  const raw = String(record?.branchId || record?.branch || record?.branchName || record?.shopName || "")
    .trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (["kara", "kara-shop"].includes(raw)) return "kara";
  if (["ogidan", "ogidan-shop"].includes(raw)) return "ogidan";
  return "";
};

const recordLabel = (record, source) =>
  record.productName || record.product || record.material || record.description ||
  record.activity || record.recordType || source.label;

export default function HistoricalBranchReview() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const unsubscribers = [];
    let live = true;
    const bySource = new Map();

    SOURCES.forEach((source) => {
      const unsubscribe = onSnapshot(
        collection(db, source.collection),
        (snapshot) => {
          bySource.set(source.collection, snapshot.docs.map((item) => ({
            ...item.data(),
            id: item.id,
            _collection: source.collection,
            _sourceLabel: source.label,
          })));
          if (live) {
            setRecords(Array.from(bySource.values()).flat());
            setLoading(false);
            setError("");
          }
        },
        (listenerError) => {
          console.error(`Could not load ${source.collection} for branch review:`, listenerError);
          if (live) {
            setError("Some records could not be loaded. Check administrator permissions and try again.");
            setLoading(false);
          }
        }
      );
      unsubscribers.push(unsubscribe);
    });

    return () => {
      live = false;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  const unresolved = useMemo(() => records
    .filter((record) => !normalizeBranch(record))
    .sort((a, b) => String(b.recordDate || b.dateTime || "").localeCompare(String(a.recordDate || a.dateTime || ""))), [records]);

  const assignBranch = async (record, branchId) => {
    if (!branchId || !["kara", "ogidan"].includes(branchId)) return;
    const confirmed = window.confirm(
      `Confirm that this ${record._sourceLabel.toLowerCase()} belongs to ${branchId === "kara" ? "Kara Shop" : "Ogidan Shop"}? Review the original evidence before continuing.`
    );
    if (!confirmed) return;

    setSavingId(`${record._collection}:${record.id}`);
    setError("");
    setNotice("");
    try {
      await updateDoc(doc(db, record._collection, record.id), {
        branchId,
        branchName: branchId === "kara" ? "Kara Shop" : "Ogidan Shop",
        branchReviewStatus: "confirmed",
        branchReviewedAt: serverTimestamp(),
        branchReviewedBy: auth.currentUser?.uid || "",
      });
      setNotice("Branch assignment saved. The original transaction details were preserved.");
    } catch (saveError) {
      console.error("Could not resolve historical branch:", saveError);
      setError("The branch could not be saved. Check your connection and Firestore permissions.");
    } finally {
      setSavingId("");
    }
  };

  return (
    <section className="historical-branch-review" aria-label="Historical records needing branch review">
      <div className="historical-review-intro">
        <strong>{loading ? "Checking historical records…" : `${unresolved.length} record${unresolved.length === 1 ? "" : "s"} need branch review`}</strong>
        <p>Records without reliable branch information stay unassigned until an administrator checks the evidence. They are not automatically allocated to either shop.</p>
      </div>
      {error && <p className="historical-review-message error" role="alert">{error}</p>}
      {notice && <p className="historical-review-message success" role="status">{notice}</p>}
      {!loading && unresolved.length === 0 && <p className="historical-review-empty">No unresolved historical branch records were found.</p>}
      {unresolved.length > 0 && (
        <div className="historical-review-list">
          {unresolved.map((record) => {
            const key = `${record._collection}:${record.id}`;
            return (
              <article className="historical-review-item" key={key}>
                <div className="historical-review-record">
                  <span>{record._sourceLabel}</span>
                  <strong>{recordLabel(record, { label: record._sourceLabel })}</strong>
                  <small>{record.recordDate || record.dateTime || record.date || "Date not recorded"} · Ref: {record.id}</small>
                </div>
                <div className="historical-review-actions">
                  <label htmlFor={`branch-review-${key}`}>Assign after review</label>
                  <select
                    id={`branch-review-${key}`}
                    defaultValue=""
                    disabled={savingId === key}
                    onChange={(event) => {
                      const nextBranch = event.target.value;
                      event.target.value = "";
                      if (nextBranch) assignBranch(record, nextBranch);
                    }}
                  >
                    <option value="">Choose branch…</option>
                    <option value="kara">Kara Shop</option>
                    <option value="ogidan">Ogidan Shop</option>
                  </select>
                  {savingId === key && <small>Saving…</small>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
