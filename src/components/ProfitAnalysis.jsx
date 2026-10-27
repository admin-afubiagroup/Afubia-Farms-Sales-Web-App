
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";

import { db } from "../Firebase/firebase.utils";
import ResponsiveLayout from "./ResponsiveLayout";
import oilContainers from "../assets/oil_containers.jpg";

import "./ProfitAnalysis.css";

const NIGERIA_TIME_ZONE = "Africa/Lagos";

function normalizeBranchId(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");

  if (text === "kara" || text === "kara-shop") return "kara";
  if (text === "ogidan" || text === "ogidan-shop") return "ogidan";
  return "";
}

function matchesBranch(record, branchFilter) {
  const id = normalizeBranchId(
    record?.branchId ||
    record?.branch ||
    record?.branchName ||
    record?.shopName
  );
  // Unresolved historical records are excluded until branch review is complete.
  if (branchFilter === "all") return Boolean(id);
  return id === branchFilter;
}

/* =========================================================
   GENERAL HELPERS
========================================================= */

const getNumber = (value) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
};

const parseDateValue = (value) => {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value?.toDate === "function") {
    try {
      const date = value.toDate();
      return date instanceof Date && !Number.isNaN(date.getTime())
        ? date
        : null;
    } catch {
      return null;
    }
  }

  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) return null;

    const date = new Date(trimmed);

    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
};

const getDate = (record) => {
  if (!record) return null;

  const possibleDates = [
    record.dateTime,
    record.timestamp,
    record.recordDate,
    record.recordTime,
    record.saleDate,
    record.expenseDate,
    record.conversionDate,
    record.createdAt,
    record.updatedAt,
    record.Sales_Date,
    record.DateOfRecord,
    record.date,
  ];

  for (const value of possibleDates) {
    const parsed = parseDateValue(value);

    if (parsed) {
      return parsed;
    }
  }

  return null;
};

const getDateKey = (value) => {
  const date =
    value instanceof Date
      ? value
      : parseDateValue(value);

  if (!date) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NIGERIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const part = (type) =>
    parts.find((item) => item.type === type)?.value || "";

  return `${part("year")}-${part("month")}-${part("day")}`;
};

const getTodayKey = () => getDateKey(new Date());

const formatDate = (value) => {
  const date =
    value instanceof Date
      ? value
      : parseDateValue(value);

  if (!date) return "Date unavailable";

  return new Intl.DateTimeFormat("en-NG", {
    timeZone: NIGERIA_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
};

const formatDateTime = (record) => {
  const date = getDate(record);

  if (!date) return "Date unavailable";

  return new Intl.DateTimeFormat("en-NG", {
    timeZone: NIGERIA_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
};

const formatNaira = (value) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(getNumber(value));

const formatNumber = (value) =>
  new Intl.NumberFormat("en-NG", {
    maximumFractionDigits: 2,
  }).format(getNumber(value));

/* =========================================================
   SALES HELPERS
========================================================= */

const getSaleQuantity = (sale) => {
  const possibleQuantities = [
    sale?.quantitySold,
    sale?.quantity,
    sale?.unitsSold,
    sale?.totalQuantity,
    sale?.productQuantity,
    sale?.quantityInLitres,
    sale?.litresSold,
    sale?.litersSold,
    sale?.numberOfItems,
  ];

  for (const value of possibleQuantities) {
    if (value !== undefined && value !== null && value !== "") {
      return getNumber(value);
    }
  }

  return 0;
};

const isExcludedRecord = (record) => {
  const status = String(
    record?.status ?? record?.saleStatus ?? record?.recordStatus ?? ""
  ).trim().toLowerCase().replace(/[\s-]+/g, "_");

  return [
    "cancelled", "canceled", "void", "deleted", "rejected",
    "pending", "draft", "failed", "processing", "unpaid",
  ].includes(status);
};

const getSaleAmount = (sale) => {
  if (!sale || isExcludedRecord(sale)) return 0;

  // Only fields representing a transaction total belong here. `price` is
  // often the per-unit price, so multiplying it by quantity is safer when a
  // saved total is absent.
  const possibleAmounts = [
    sale?.totalAmount,
    sale?.totalPrice,
    sale?.amountPaid,
    sale?.saleAmount,
    sale?.totalSales,
    sale?.revenue,
    sale?.total,
    sale?.amount,
    sale?.sellingPriceTotal,
  ];

  for (const value of possibleAmounts) {
    if (value !== undefined && value !== null && value !== "") {
      const amount = getNumber(value);
      if (amount !== 0) return amount;
    }
  }

  const quantity = getSaleQuantity(sale);
  const unitPrice = getNumber(
    sale?.unitPrice ??
      sale?.sellingPrice ??
      sale?.pricePerUnit ??
      sale?.sellingPricePerUnit ??
      sale?.price
  );

  return quantity * unitPrice;
};

const getProductName = (sale) =>
  sale?.productName ||
  sale?.product ||
  sale?.productType ||
  sale?.itemName ||
  sale?.item ||
  sale?.name ||
  sale?.Product_Type ||
  "Palm Oil";

/* =========================================================
   EXPENSE AND MATERIAL HELPERS
========================================================= */

const getMaterialName = (material) =>
  material?.materialName ||
  material?.productName ||
  material?.itemName ||
  material?.material ||
  material?.product ||
  material?.name ||
  material?.description ||
  "Material Purchase";

const getExpenseAmount = (expense) => {
  if (!expense || isExcludedRecord(expense)) return 0;

  // Do not mistake `price` (a common unit-cost field) for the full expense.
  const possibleAmounts = [
    expense?.expenseAmount,
    expense?.totalAmount,
    expense?.amountPaid,
    expense?.totalCost,
    expense?.purchaseAmount,
    expense?.cost,
    expense?.total,
    expense?.amount,
  ];

  for (const value of possibleAmounts) {
    if (value !== undefined && value !== null && value !== "") {
      const amount = getNumber(value);
      if (amount !== 0) return amount;
    }
  }

  const quantity = getNumber(
    expense?.quantity ?? expense?.quantityPurchased
  );
  const unitCost = getNumber(
    expense?.unitCost ??
      expense?.unitPrice ??
      expense?.costPrice ??
      expense?.pricePerUnit ??
      expense?.price
  );

  return quantity * unitCost;
};

const isMaterialExpense = (material) => {
  if (material?.affectsProfit === false) {
    return false;
  }

  return !isExcludedRecord(material);
};

const getExpenseName = (expense) =>
  expense?.expenseName ||
  expense?.description ||
  expense?.name ||
  expense?.title ||
  expense?.itemName ||
  expense?.category ||
  expense?.expenseType ||
  "Business Expense";

/* =========================================================
   OIL CONVERSION HELPERS
========================================================= */

const getOilLitresTurned = (conversion) => {
  const possibleAmounts = [
    conversion?.litresTurned,
    conversion?.litersTurned,
    conversion?.totalLitres,
    conversion?.totalLiters,
    conversion?.litresUsed,
    conversion?.litersUsed,
    conversion?.oilLitres,
    conversion?.oilLiters,
    conversion?.quantityInLitres,
    conversion?.quantityInLiters,
    conversion?.totalQuantityLitres,
    conversion?.litres,
    conversion?.liters,
    conversion?.quantity,
    conversion?.totalQuantity,
  ];

  for (const value of possibleAmounts) {
    if (value !== undefined && value !== null && value !== "") {
      return getNumber(value);
    }
  }

  return 0;
};

/* =========================================================
   FIRESTORE HELPERS
========================================================= */

const mapSnapshot = (snapshot) =>
  snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));

/* =========================================================
   PERIOD HELPERS
========================================================= */

const getNigeriaTodayParts = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NIGERIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const part = (type) =>
    parts.find((item) => item.type === type)?.value || "";

  return {
    year: Number(part("year")),
    month: Number(part("month")),
    day: Number(part("day")),
  };
};

const getPeriodStartKey = (period) => {
  const { year, month, day } = getNigeriaTodayParts();

  const today = new Date(Date.UTC(year, month - 1, day));
  let startDate = new Date(today);

  if (period === "week") {
    const dayOfWeek = today.getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;

    startDate.setUTCDate(
      today.getUTCDate() - daysSinceMonday
    );
  } else if (period === "month") {
    startDate = new Date(Date.UTC(year, month - 1, 1));
  } else if (period === "year") {
    startDate = new Date(Date.UTC(year, 0, 1));
  }

  return [
    startDate.getUTCFullYear(),
    String(startDate.getUTCMonth() + 1).padStart(2, "0"),
    String(startDate.getUTCDate()).padStart(2, "0"),
  ].join("-");
};

const isDateInPeriod = (date, period) => {
  if (!date) return false;

  const dateKey = getDateKey(date);
  const todayKey = getTodayKey();
  const startKey = getPeriodStartKey(period);

  if (!dateKey || !startKey) return false;

  return dateKey >= startKey && dateKey <= todayKey;
};

/* =========================================================
   EXPANDABLE LIST BUTTON
========================================================= */

const ExpandListButton = ({
  expanded,
  count,
  itemLabel,
  onClick,
}) => {
  if (count <= 2) return null;

  return (
    <button
      type="button"
      className="profit-expand-button"
      onClick={onClick}
      aria-expanded={expanded}
    >
      <span>
        {expanded
          ? "Show less"
          : `Show all ${count} ${itemLabel}`}
      </span>

      <span
        className={`profit-expand-arrow ${
          expanded ? "expanded" : ""
        }`}
        aria-hidden="true"
      >
        ▾
      </span>
    </button>
  );
};

/* =========================================================
   PROFIT ANALYSIS PAGE
========================================================= */

const ProfitAnalysis = () => {
  const [sales, setSales] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [otherExpenses, setOtherExpenses] = useState([]);
  const [conversions, setConversions] = useState([]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState("today");
  const [branchFilter, setBranchFilter] = useState(() => {
    try {
      return (
        window.sessionStorage.getItem("afubiaReportBranchFilter") ||
        window.sessionStorage.getItem("afubiaBranchId") ||
        "kara"
      );
    } catch {
      return "kara";
    }
  });

  useEffect(() => {
    try {
      window.sessionStorage.setItem("afubiaReportBranchFilter", branchFilter);
    } catch {
      // Keep filtering in memory if storage is unavailable.
    }
  }, [branchFilter]);

  /* Each expandable list has its own independent state. */
  const [expandedLists, setExpandedLists] = useState({
    products: false,
    sales: false,
    expenses: false,
  });

  const toggleList = (listName) => {
    setExpandedLists((previous) => ({
      ...previous,
      [listName]: !previous[listName],
    }));
  };

  const periodLabel =
    {
      today: "Today",
      week: "This Week",
      month: "This Month",
      year: "This Year",
    }[selectedPeriod] || "Today";

  /* =======================================================
     REAL-TIME FIRESTORE DATA
  ======================================================= */

  useEffect(() => {
    let isMounted = true;

    const loadedSources = new Set();
    const unsubscribers = [];

    const markLoaded = (source) => {
      if (!isMounted) return;

      loadedSources.add(source);

      if (loadedSources.size >= 4) {
        setIsLoading(false);
      }
    };

    const handleError = (source, message) => {
      if (!isMounted) return;

      console.error(
        `Profit Analysis: ${source} listener failed:`,
        message
      );

      if (source === "sales" || source === "materials") {
        setError(
          `${source === "sales" ? "Sales" : "Materials"} data could not be loaded. Please check your connection and permissions.`
        );
      }

      markLoaded(source);
    };

    const subscribe = (
      collectionName,
      source,
      setter,
      required = true
    ) => {
      try {
        const unsubscribe = onSnapshot(
          collection(db, collectionName),
          (snapshot) => {
            if (!isMounted) return;

            setter(mapSnapshot(snapshot));
            markLoaded(source);
          },
          (listenerError) => {
            if (!isMounted) return;

            if (!required && source === "expenses") {
              setOtherExpenses([]);
              markLoaded(source);
              return;
            }

            handleError(source, listenerError);
          }
        );

        unsubscribers.push(unsubscribe);
      } catch (listenerError) {
        if (!isMounted) return;

        if (!required && source === "expenses") {
          setOtherExpenses([]);
          markLoaded(source);
          return;
        }

        handleError(source, listenerError);
      }
    };

    subscribe("sales", "sales", setSales);
    subscribe("materials", "materials", setMaterials);
    subscribe(
      "expenses",
      "expenses",
      setOtherExpenses,
      false
    );
    subscribe(
      "conversions",
      "conversions",
      setConversions,
      false
    );

    /*
      Do not leave the page loading indefinitely if a source
      cannot complete its initial subscription.
    */
    const loadingTimeout = setTimeout(() => {
      if (isMounted) {
        setIsLoading(false);
      }
    }, 8000);

    return () => {
      isMounted = false;
      clearTimeout(loadingTimeout);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  /* =======================================================
     ALL BUSINESS EXPENSES
  ======================================================= */

  const allExpenses = useMemo(() => {
    const materialExpenses = materials
      .filter((record) => matchesBranch(record, branchFilter))
      .filter(isMaterialExpense)
      .map((material) => ({
        ...material,
        expenseType: "Material Purchase",
        expenseName: getMaterialName(material),
        expenseAmount: getExpenseAmount(material),
      }));

    const businessExpenses = otherExpenses
      .filter((record) => matchesBranch(record, branchFilter))
      .filter(
        (expense) => expense?.affectsProfit !== false && !isExcludedRecord(expense)
      )
      .map((expense) => ({
        ...expense,
        expenseType:
          expense?.category ||
          expense?.expenseType ||
          "Other Expense",
        expenseName: getExpenseName(expense),
        expenseAmount: getExpenseAmount(expense),
      }));

    return [...materialExpenses, ...businessExpenses];
  }, [materials, otherExpenses, branchFilter]);

  /* =======================================================
     CURRENT PERIOD ANALYSIS
  ======================================================= */

  const periodAnalysis = useMemo(() => {
    const filteredSales = sales.filter((sale) =>
      matchesBranch(sale, branchFilter) &&
      !isExcludedRecord(sale) &&
      isDateInPeriod(getDate(sale), selectedPeriod)
    );

    const expenseRecords = allExpenses.filter((expense) =>
      isDateInPeriod(getDate(expense), selectedPeriod)
    );

    const filteredConversions = conversions.filter((conversion) =>
      matchesBranch(conversion, branchFilter) &&
      !isExcludedRecord(conversion) &&
      isDateInPeriod(getDate(conversion), selectedPeriod)
    );

    const revenue = filteredSales.reduce(
      (total, sale) => total + getSaleAmount(sale),
      0
    );

    const expenseTotal = expenseRecords.reduce(
      (total, expense) =>
        total + getNumber(expense.expenseAmount),
      0
    );

    const profit = revenue - expenseTotal;

    const quantitySold = filteredSales.reduce(
      (total, sale) => total + getSaleQuantity(sale),
      0
    );

    const litresTurned = filteredConversions.reduce(
      (total, conversion) =>
        total + getOilLitresTurned(conversion),
      0
    );

    const profitMargin =
      revenue > 0 ? (profit / revenue) * 100 : 0;

    return {
      sales: filteredSales,
      expenseRecords,
      conversions: filteredConversions,
      revenue,
      expenses: expenseTotal,
      profit,
      quantitySold,
      litresTurned,
      salesCount: filteredSales.length,
      expenseCount: expenseRecords.length,
      profitMargin,
    };
  }, [
    sales,
    allExpenses,
    conversions,
    selectedPeriod,
    branchFilter,
  ]);

  /* =======================================================
     PRODUCT ANALYSIS
  ======================================================= */

  const productAnalysis = useMemo(() => {
    const products = {};

    periodAnalysis.sales.forEach((sale) => {
      const name = getProductName(sale);

      if (!products[name]) {
        products[name] = {
          name,
          quantity: 0,
          revenue: 0,
          transactions: 0,
        };
      }

      products[name].quantity += getSaleQuantity(sale);
      products[name].revenue += getSaleAmount(sale);
      products[name].transactions += 1;
    });

    return Object.values(products).sort(
      (a, b) => b.revenue - a.revenue
    );
  }, [periodAnalysis.sales]);

  /* =======================================================
     DAILY PERFORMANCE
  ======================================================= */

  const dailyAnalysis = useMemo(() => {
    const days = {};

    const addDay = (dateKey) => {
      if (!days[dateKey]) {
        days[dateKey] = {
          dateKey,
          revenue: 0,
          expenses: 0,
          profit: 0,
          salesCount: 0,
          quantitySold: 0,
        };
      }

      return days[dateKey];
    };

    sales
      .filter((sale) => matchesBranch(sale, branchFilter) && !isExcludedRecord(sale))
      .forEach((sale) => {
      const dateKey = getDateKey(getDate(sale));

      if (!dateKey) return;

      const day = addDay(dateKey);

      day.revenue += getSaleAmount(sale);
      day.quantitySold += getSaleQuantity(sale);
      day.salesCount += 1;
    });

    allExpenses
      .filter((expense) => matchesBranch(expense, branchFilter))
      .forEach((expense) => {
      const dateKey = getDateKey(getDate(expense));

      if (!dateKey) return;

      const day = addDay(dateKey);

      day.expenses += getNumber(expense.expenseAmount);
    });

    return Object.values(days)
      .map((day) => ({
        ...day,
        profit: day.revenue - day.expenses,
      }))
      .sort((a, b) =>
        b.dateKey.localeCompare(a.dateKey)
      );
  }, [sales, allExpenses, branchFilter]);

  /* =======================================================
     RECENT SALES
  ======================================================= */

  const recentSales = useMemo(
    () =>
      [...periodAnalysis.sales]
        .sort(
          (a, b) =>
            (getDate(b)?.getTime() || 0) -
            (getDate(a)?.getTime() || 0)
        )
        .slice(0, 5),
    [periodAnalysis.sales]
  );

  /* =======================================================
     RECENT EXPENSES
  ======================================================= */

  const recentExpenses = useMemo(
    () =>
      [...periodAnalysis.expenseRecords]
        .sort(
          (a, b) =>
            (getDate(b)?.getTime() || 0) -
            (getDate(a)?.getTime() || 0)
        )
        .slice(0, 5),
    [periodAnalysis.expenseRecords]
  );

  /* =======================================================
     LOADING
  ======================================================= */

  if (isLoading) {
    return (
      <ResponsiveLayout>
        <div className="profit-loading">
          <div className="profit-spinner" />

          <span className="profit-loading-label">
            AFUBIA FARMS
          </span>

          <h2>Loading Profit Analysis</h2>

          <p>
            Getting your latest sales, expenses and
            production records...
          </p>
        </div>
      </ResponsiveLayout>
    );
  }

  /* =======================================================
     PAGE
  ======================================================= */

  return (
    <ResponsiveLayout>
      <div className="profit-container">
        {/* HEADER */}

        <header className="profit-header">
          <div>
            <span className="profit-eyebrow">
              AFUBIA FARMS • BUSINESS PERFORMANCE
            </span>

            <h1>Profit Analysis</h1>

            <p>
              See how much the business sold, spent and made.
            </p>
          </div>

          <div className="profit-live">
            <span className="profit-live-dot" />

            <div>
              <strong>LIVE DATA</strong>
              <small>Firestore synchronized</small>
            </div>
          </div>
        </header>

        {/* ERROR / DATA NOTICE */}

        {error && (
          <div className="profit-error">
            <strong>Data notice</strong>

            <span>{error}</span>

            <button
              type="button"
              onClick={() => setError("")}
              aria-label="Close data notice"
            >
              ×
            </button>
          </div>
        )}

        {branchFilter === "all" && [...sales, ...materials, ...otherExpenses, ...conversions].some((record) => !normalizeBranchId(
          record?.branchId || record?.branch || record?.branchName || record?.shopName
        )) && (
          <div className="profit-branch-review-note" role="status">
            Historical records without a confirmed shop are excluded from combined profit figures until an administrator reviews their branch.
          </div>
        )}

        {/* PERIOD SELECTOR */}

        <section className="period-selector">
          <div>
            <span className="section-label">
              VIEW BUSINESS PERFORMANCE
            </span>

            <h2>{periodLabel}</h2>
          </div>

          <div className="profit-branch-filter">
            <label htmlFor="profit-branch-filter">Branch</label>
            <select
              id="profit-branch-filter"
              value={branchFilter}
              onChange={(event) => setBranchFilter(event.target.value)}
            >
              <option value="kara">Kara Shop</option>
              <option value="ogidan">Ogidan Shop</option>
              <option value="all">All branches (combined)</option>
            </select>
          </div>

          <div className="period-buttons">
            {[
              ["today", "Today"],
              ["week", "This Week"],
              ["month", "This Month"],
              ["year", "This Year"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={
                  selectedPeriod === value ? "active" : ""
                }
                onClick={() => {
                  setSelectedPeriod(value);

                  setExpandedLists({
                    products: false,
                    sales: false,
                    expenses: false,
                  });
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* MAIN FINANCIAL SUMMARY */}

        <section className="financial-cards">
          <div className="financial-card sales-card">
            <div className="financial-card-heading">
              <span>SALES</span>
              <div className="financial-icon">₦</div>
            </div>

            <strong>
              {formatNaira(periodAnalysis.revenue)}
            </strong>

            <p>Money generated from recorded sales.</p>

            <small>
              {formatNumber(periodAnalysis.salesCount)} sales
              recorded
            </small>
          </div>

          <div className="financial-card expense-card">
            <div className="financial-card-heading">
              <span>EXPENSES</span>
              <div className="financial-icon">−</div>
            </div>

            <strong>
              {formatNaira(periodAnalysis.expenses)}
            </strong>

            <p>Materials and other recorded business costs.</p>

            <small>
              {formatNumber(periodAnalysis.expenseCount)}{" "}
              expense records
            </small>
          </div>

          <div
            className={`financial-card ${
              periodAnalysis.profit >= 0
                ? "profit-card-positive"
                : "profit-card-negative"
            }`}
          >
            <div className="financial-card-heading">
              <span>ESTIMATED PROFIT</span>

              <div className="financial-icon">
                {periodAnalysis.profit >= 0 ? "✓" : "!"}
              </div>
            </div>

            <strong>
              {formatNaira(periodAnalysis.profit)}
            </strong>

            <p>Sales minus recorded business expenses.</p>

            <small>
              {periodAnalysis.profitMargin.toFixed(1)}% of
              sales
            </small>
          </div>
        </section>

        {/* SIMPLE PERIOD OVERVIEW */}

        <section className="overview-grid">
          <div className="overview-card">
            <span>UNITS SOLD</span>

            <strong>
              {formatNumber(periodAnalysis.quantitySold)}
            </strong>

            <small>
              Products sold during {periodLabel.toLowerCase()}
            </small>
          </div>

          <div className="overview-card">
            <span>OIL TURNED</span>

            <strong>
              {periodAnalysis.litresTurned.toLocaleString(
                "en-NG",
                { maximumFractionDigits: 2 }
              )}{" "}
              L
            </strong>

            <small>Production recorded</small>
          </div>

          <div className="overview-card">
            <span>PROFIT MARGIN</span>

            <strong>
              {periodAnalysis.profitMargin.toFixed(1)}%
            </strong>

            <small>
              Estimated profit as a percentage of sales
            </small>
          </div>

          <div className="overview-card">
            <span>SALES TRANSACTIONS</span>

            <strong>
              {formatNumber(periodAnalysis.salesCount)}
            </strong>

            <small>
              Recorded during {periodLabel.toLowerCase()}
            </small>
          </div>
        </section>

        {/* PROFIT EXPLANATION */}

        <section className="profit-explanation">
          <div className="explanation-icon">=</div>

          <div>
            <span className="section-label">
              HOW ESTIMATED PROFIT IS CALCULATED
            </span>

            <h2>
              {formatNaira(periodAnalysis.revenue)} sales −{" "}
              {formatNaira(periodAnalysis.expenses)} expenses
              {" = "}
              <strong>
                {formatNaira(periodAnalysis.profit)}
              </strong>
            </h2>

            <p>
              Estimated profit is the money from recorded sales
              after subtracting recorded business expenses for{" "}
              {periodLabel.toLowerCase()}.
            </p>
          </div>
        </section>

        {/* PRODUCT SALES */}

        <section className="profit-section">
          <div className="section-heading">
            <div>
              <span className="section-label">
                SALES ANALYSIS
              </span>

              <h2>What did we sell?</h2>

              <p>
                Sales grouped by product for{" "}
                {periodLabel.toLowerCase()}.
              </p>
            </div>
          </div>

          {productAnalysis.length === 0 ? (
            <div className="profit-empty">
              No sales recorded for this period.
            </div>
          ) : (
            <>
              <div className="product-analysis-list">
                {(expandedLists.products
                  ? productAnalysis
                  : productAnalysis.slice(0, 2)
                ).map((product) => (
                  <div
                    className="product-analysis-row"
                    key={product.name}
                  >
                    <div className="product-analysis-left">
                      <div className="product-analysis-image">
                        <img
                          src={oilContainers}
                          alt="Palm oil containers"
                        />
                      </div>

                      <div>
                        <strong>{product.name}</strong>

                        <span>
                          {formatNumber(product.quantity)} units
                          {" • "}
                          {product.transactions} transaction
                          {product.transactions !== 1
                            ? "s"
                            : ""}
                        </span>
                      </div>
                    </div>

                    <strong className="product-analysis-money">
                      {formatNaira(product.revenue)}
                    </strong>
                  </div>
                ))}
              </div>

              <ExpandListButton
                expanded={Boolean(expandedLists.products)}
                count={productAnalysis.length}
                itemLabel="products"
                onClick={() => toggleList("products")}
              />
            </>
          )}
        </section>

        {/* DAILY PERFORMANCE */}

        <section className="profit-section">
          <div className="section-heading">
            <div>
              <span className="section-label">
                DAILY PERFORMANCE
              </span>

              <h2>Sales and Profit by Day</h2>

              <p>
                A simple daily view of sales, expenses and
                estimated profit.
              </p>
            </div>
          </div>

          {dailyAnalysis.length === 0 ? (
            <div className="profit-empty">
              No dated sales or expense records are available.
            </div>
          ) : (
            <div className="daily-table-wrapper">
              <table className="daily-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Sales</th>
                    <th>Expenses</th>
                    <th>Estimated Profit</th>
                    <th>Transactions</th>
                  </tr>
                </thead>

                <tbody>
                  {dailyAnalysis.slice(0, 31).map((day) => (
                    <tr key={day.dateKey}>
                      <td>
                        <strong>{formatDate(day.dateKey)}</strong>
                      </td>

                      <td>{formatNaira(day.revenue)}</td>

                      <td>{formatNaira(day.expenses)}</td>

                      <td>
                        <strong
                          className={
                            day.profit >= 0
                              ? "text-profit"
                              : "text-loss"
                          }
                        >
                          {formatNaira(day.profit)}
                        </strong>
                      </td>

                      <td>{day.salesCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* RECENT ACTIVITY */}

        <section className="activity-columns">
          {/* RECENT SALES */}

          <div className="profit-section">
            <div className="section-heading compact">
              <div>
                <span className="section-label">
                  RECENT SALES
                </span>

                <h2>Latest Sales</h2>
              </div>
            </div>

            {recentSales.length === 0 ? (
              <div className="profit-empty">
                No sales for this period.
              </div>
            ) : (
              <>
                <div className="simple-list">
                  {(expandedLists.sales
                    ? recentSales
                    : recentSales.slice(0, 2)
                  ).map((sale) => (
                    <div
                      className="simple-list-row"
                      key={sale.id}
                    >
                      <div>
                        <strong>
                          {getProductName(sale)}
                        </strong>

                        <span>{formatDateTime(sale)}</span>
                      </div>

                      <strong className="sale-money">
                        {formatNaira(getSaleAmount(sale))}
                      </strong>
                    </div>
                  ))}
                </div>

                <ExpandListButton
                  expanded={Boolean(expandedLists.sales)}
                  count={recentSales.length}
                  itemLabel="sales"
                  onClick={() => toggleList("sales")}
                />
              </>
            )}
          </div>

          {/* RECENT EXPENSES */}

          <div className="profit-section">
            <div className="section-heading compact">
              <div>
                <span className="section-label">
                  RECENT EXPENSES
                </span>

                <h2>Where Money Was Spent</h2>
              </div>
            </div>

            {recentExpenses.length === 0 ? (
              <div className="profit-empty">
                No expenses for this period.
              </div>
            ) : (
              <>
                <div className="simple-list">
                  {(expandedLists.expenses
                    ? recentExpenses
                    : recentExpenses.slice(0, 2)
                  ).map((expense) => (
                    <div
                      className="simple-list-row"
                      key={`${expense.expenseType}-${expense.id}`}
                    >
                      <div>
                        <strong>{expense.expenseName}</strong>

                        <span>
                          {expense.expenseType}
                          {" • "}
                          {formatDateTime(expense)}
                        </span>
                      </div>

                      <strong className="expense-money">
                        {formatNaira(expense.expenseAmount)}
                      </strong>
                    </div>
                  ))}
                </div>

                <ExpandListButton
                  expanded={Boolean(expandedLists.expenses)}
                  count={recentExpenses.length}
                  itemLabel="expenses"
                  onClick={() => toggleList("expenses")}
                />
              </>
            )}
          </div>
        </section>

        {/* PERIOD SUMMARY */}

        <section className="period-summary">
          <div className="period-summary-header">
            <div>
              <span className="section-label">
                BUSINESS SUMMARY
              </span>

              <h2>Financial Performance</h2>

              <p>
                Select a period to see estimated profit.
              </p>
            </div>
          </div>

          <div className="period-summary-grid">
            <PeriodSummary
              label="TODAY"
              period="today"
              sales={sales}
              expenses={allExpenses}
              onClick={() => setSelectedPeriod("today")}
              selected={selectedPeriod === "today"}
            />

            <PeriodSummary
              label="THIS WEEK"
              period="week"
              sales={sales}
              expenses={allExpenses}
              onClick={() => setSelectedPeriod("week")}
              selected={selectedPeriod === "week"}
            />

            <PeriodSummary
              label="THIS MONTH"
              period="month"
              sales={sales}
              expenses={allExpenses}
              onClick={() => setSelectedPeriod("month")}
              selected={selectedPeriod === "month"}
            />

            <PeriodSummary
              label="THIS YEAR"
              period="year"
              sales={sales}
              expenses={allExpenses}
              onClick={() => setSelectedPeriod("year")}
              selected={selectedPeriod === "year"}
            />
          </div>
        </section>

        {/* SIMPLE EXPLANATION */}

        <section className="profit-note">
          <div className="note-icon">₦</div>

          <div>
            <strong>How to understand this page</strong>

            <p>
              <strong>Sales</strong> is the money generated from
              recorded sales.
            </p>

            <p>
              <strong>Expenses</strong> includes purchased
              materials and other recorded business expenses.
            </p>

            <p>
              <strong>Estimated Profit</strong> is calculated as{" "}
              <strong>Sales − Recorded Expenses</strong>.
            </p>

            <p>
              <strong>Oil turning</strong> is shown as production
              activity. It does not automatically reduce profit
              because turning oil is a production activity rather
              than a separate expense.
            </p>

            <p>
              Salaries, transportation, electricity, fuel,
              repairs and other costs should be entered as
              business expenses so they can be included in the
              analysis.
            </p>
          </div>
        </section>

        {/* FOOTER */}

        <footer className="profit-footer">
          <span className="profit-live-dot" />

          <span>Live Firestore data</span>
          <span>•</span>
          <span>{sales.length} sales</span>
          <span>•</span>
          <span>{materials.length} materials</span>
          <span>•</span>
          <span>{conversions.length} oil turning records</span>
        </footer>
      </div>
    </ResponsiveLayout>
  );
};

/* =========================================================
   PERIOD SUMMARY CARD
========================================================= */

const PeriodSummary = ({
  label,
  period,
  sales,
  expenses,
  onClick,
  selected,
}) => {
  const startKey = getPeriodStartKey(period);
  const todayKey = getTodayKey();

  const revenue = sales
    .filter((sale) => {
      const key = getDateKey(getDate(sale));

      return key && startKey && key >= startKey && key <= todayKey;
    })
    .reduce(
      (total, sale) => total + getSaleAmount(sale),
      0
    );

  const totalExpenses = expenses
    .filter((expense) => {
      const key = getDateKey(getDate(expense));

      return key && startKey && key >= startKey && key <= todayKey;
    })
    .reduce(
      (total, expense) =>
        total + getNumber(expense.expenseAmount),
      0
    );

  const profit = revenue - totalExpenses;

  return (
    <div
      className={`period-summary-card ${
        selected ? "selected" : ""
      }`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (
          event.key === "Enter" ||
          event.key === " "
        ) {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <span>{label}</span>

      <strong
        className={
          profit >= 0 ? "text-profit" : "text-loss"
        }
      >
        {formatNaira(profit)}
      </strong>

      <small>Estimated profit</small>
    </div>
  );
};

export default ProfitAnalysis;
