/* eslint-disable no-unused-vars */

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import oilContainers from "../assets/palm_oil_turning.jpg";

import { useNavigate } from "react-router-dom";

import {
  collection,
  onSnapshot,
} from "firebase/firestore";

import { onAuthStateChanged } from "firebase/auth";

import ResponsiveLayout from "./ResponsiveLayout";

import {
  auth,
  db,
} from "../Firebase/firebase.utils";

import {
  getUserInformation,
  isAdminUser,
} from "../utils/auth";

import "./admin-dashboard.css";

const NIGERIA_TIME_ZONE = "Africa/Lagos";

/* =========================================================
   NUMBER HELPERS
========================================================= */

const toNumber = (value) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const number = Number(
      value.replace(/[₦,\s]/g, "").trim()
    );

    return Number.isFinite(number) ? number : 0;
  }

  return 0;
};

const normalizeText = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

/* =========================================================
   DATE HELPERS
========================================================= */

const parseDate = (value) => {
  if (!value) return null;

  if (typeof value?.toDate === "function") {
    const date = value.toDate();

    return Number.isNaN(date.getTime())
      ? null
      : date;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value;
  }

  if (
    typeof value === "object" &&
    value.seconds !== undefined
  ) {
    const date = new Date(
      Number(value.seconds) * 1000
    );

    return Number.isNaN(date.getTime())
      ? null
      : date;
  }

  if (typeof value === "number") {
    const milliseconds =
      value < 10000000000
        ? value * 1000
        : value;

    const date = new Date(milliseconds);

    return Number.isNaN(date.getTime())
      ? null
      : date;
  }

  if (typeof value === "string") {
    const text = value.trim();

    if (!text) return null;

    const date = new Date(text);

    if (!Number.isNaN(date.getTime())) {
      return date;
    }

    const match = text.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})/
    );

    if (match) {
      const [, year, month, day] = match;

      const localDate = new Date(
        Number(year),
        Number(month) - 1,
        Number(day)
      );

      if (!Number.isNaN(localDate.getTime())) {
        return localDate;
      }
    }
  }

  return null;
};

const getRecordDate = (record) => {
  if (!record) return null;

  if (record.recordDate && record.recordTime) {
    const combined = new Date(
      `${record.recordDate}T${record.recordTime}`
    );

    if (!Number.isNaN(combined.getTime())) {
      return combined;
    }
  }

  const possibleDates = [
    record.dateTime,
    record.recordedAt,
    record.createdAt,
    record.timestamp,
    record.transferDate,
    record.recordDate,
    record.saleDate,
    record.salesDate,
    record.conversionDate,
    record.materialDate,
    record.dateOfRecord,
    record.DateOfRecord,
    record.date,
    record.Date,
    record.sales_date,
    record.Sales_Date,
  ];

  for (const value of possibleDates) {
    const date = parseDate(value);

    if (date) return date;
  }

  return null;
};

const getNigeriaDateKey = (date) => {
  if (!date) return null;

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NIGERIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

const isToday = (date) => {
  if (!date) return false;

  return (
    getNigeriaDateKey(date) ===
    getNigeriaDateKey(new Date())
  );
};

/* =========================================================
   SALES AMOUNT
========================================================= */

const getSaleAmount = (sale) => {
  if (!sale) return 0;

  const possibleAmounts = [
    sale.totalAmount,
    sale.total,
    sale.revenue,
    sale.amount,
  ];

  for (const value of possibleAmounts) {
    const amount = toNumber(value);

    if (amount !== 0) return amount;
  }

  const quantity = toNumber(
    sale.quantitySold ??
      sale.quantity ??
      sale.QuantitySold
  );

  const unitPrice = toNumber(
    sale.unitPrice ??
      sale.price ??
      sale.sellingPrice ??
      sale.selling_price
  );

  return quantity * unitPrice;
};

/* =========================================================
   MATERIAL COST
========================================================= */

const getMaterialCost = (material) => {
  if (!material) return 0;

  if (material.affectsProfit === false) return 0;
  if (material.isPurchased === false) return 0;

  const status = normalizeText(material.status);

  if (
    status &&
    ![
      "purchased",
      "paid",
      "received",
      "completed",
      "approved",
      "bought",
    ].includes(status)
  ) {
    return 0;
  }

  const possibleAmounts = [
    material.totalCost,
    material.totalAmount,
  ];

  for (const value of possibleAmounts) {
    const amount = toNumber(value);

    if (amount !== 0) return amount;
  }

  const quantity = toNumber(
    material.quantity ??
      material.quantityPurchased
  );

  const unitCost = toNumber(
    material.unitCost ??
      material.price ??
      material.costPerUnit
  );

  return quantity * unitCost;
};

/* =========================================================
   OTHER EXPENSES
========================================================= */

const getExpenseAmount = (expense) => {
  if (!expense) return 0;

  if (expense.affectsProfit === false) return 0;

  const amount = toNumber(
    expense.totalAmount ??
      expense.total ??
      expense.amount ??
      expense.expenseAmount ??
      expense.cost
  );

  if (amount !== 0) return amount;

  return (
    toNumber(expense.quantity) *
    toNumber(
      expense.unitCost ??
        expense.unitPrice ??
        expense.price
    )
  );
};

/* =========================================================
   CONVERSION LITRES
========================================================= */

const getConversionLitres = (conversion) => {
  if (!conversion) return 0;

  const possibleLitres = [
    conversion.litresProduced,
    conversion.totalLitres,
    conversion.litres,
  ];

  for (const value of possibleLitres) {
    const litres = toNumber(value);

    if (litres > 0) return litres;
  }

  const kegs = toNumber(
    conversion.kegCount ?? conversion.kegs
  );

  const bottles75cl = toNumber(
    conversion.bottles75cl ??
      conversion.bottles75Cl ??
      conversion.bottles75CL
  );

  const bottles1L = toNumber(
    conversion.bottles1L ??
      conversion.bottles1l
  );

  const jerrycans5L = toNumber(
    conversion.jerrycans5L ??
      conversion.jerrycans5l ??
      conversion.jerrycans
  );

  return (
    kegs * 30 +
    bottles75cl * 0.75 +
    bottles1L +
    jerrycans5L * 5
  );
};

/* =========================================================
   SHOP STOCK HELPERS
========================================================= */

const getProductType = (record) => {
  const values = [
    record?.productType,
    record?.category,
    record?.product,
    record?.productName,
    record?.itemName,
    record?.name,
  ];

  const text = values
    .map(normalizeText)
    .filter(Boolean)
    .join(" ");

  if (
    text.includes("honey") ||
    text.includes("pure_honey")
  ) {
    return "honey";
  }

  if (
    text.includes("kuli_kuli") ||
    text.includes("kulikuli") ||
    text.includes("groundnut_oil")
  ) {
    return "kuli_kuli";
  }

  if (
    text.includes("palm_oil") ||
    text.includes("red_oil") ||
    text.includes("palm oil")
  ) {
    return "palm_oil";
  }

  return "";
};

const getTransferFrom = (transfer) =>
  normalizeText(
    transfer?.fromLocation ??
      transfer?.sourceLocation ??
      transfer?.transferFrom ??
      transfer?.from
  );

const getTransferTo = (transfer) =>
  normalizeText(
    transfer?.toLocation ??
      transfer?.destinationLocation ??
      transfer?.transferTo ??
      transfer?.to
  );

const isFarmToShopTransfer = (transfer) => {
  if (!transfer) return false;

  const from = getTransferFrom(transfer);
  const to = getTransferTo(transfer);

  const transferType = normalizeText(
    transfer.transferType ??
      transfer.transactionType ??
      transfer.recordType ??
      transfer.type
  );

  const explicitlyFarmToShop =
    from === "farm" &&
    to === "shop";

  const explicitlyTransfer =
    transferType.includes("transfer");

  const status = normalizeText(transfer.status);

  const cancelled = [
    "cancelled",
    "canceled",
    "rejected",
    "void",
  ].includes(status);

  return (
    explicitlyFarmToShop &&
    explicitlyTransfer &&
    !cancelled
  );
};

const getTransferQuantity = (transfer) => {
  const directLitres = toNumber(
    transfer.transferLitres ??
      transfer.quantityLitres ??
      transfer.litres ??
      transfer.liters ??
      transfer.volumeLitres
  );

  if (directLitres > 0) {
    return directLitres;
  }

  const quantity = toNumber(
    transfer.transferQuantity ??
      transfer.quantity ??
      transfer.amount ??
      transfer.totalQuantity
  );

  const unit = normalizeText(
    transfer.unit ??
      transfer.quantityUnit ??
      transfer.measurementUnit
  );

  if (unit === "litres" || unit === "liters" || unit === "l") {
    return quantity;
  }

  if (
    unit === "75cl" ||
    unit === "75_cl" ||
    unit === "bottle_75cl"
  ) {
    return quantity * 0.75;
  }

  if (
    unit === "5l" ||
    unit === "5_l" ||
    unit === "jerrycan_5l"
  ) {
    return quantity * 5;
  }

  if (unit === "keg" || unit === "kegs") {
    return quantity * 30;
  }

  return 0;
};

const getTransferHoneyBottles = (transfer) => {
  const explicitBottles = toNumber(
    transfer.transferBottles ??
      transfer.quantityBottles ??
      transfer.bottles ??
      transfer.bottlesTransferred
  );

  if (explicitBottles > 0) {
    return explicitBottles;
  }

  const quantity = toNumber(
    transfer.transferQuantity ??
      transfer.quantity ??
      transfer.amount ??
      transfer.totalQuantity
  );

  const unit = normalizeText(
    transfer.unit ??
      transfer.quantityUnit ??
      transfer.measurementUnit
  );

  if (
    unit === "carton" ||
    unit === "cartons"
  ) {
    const bottlesPerCarton = toNumber(
      transfer.bottlesPerCarton
    );

    return quantity * bottlesPerCarton;
  }

  if (
    unit === "bottle" ||
    unit === "bottles"
  ) {
    return quantity;
  }

  return 0;
};

const isShopSale = (sale) => {
  if (!sale) return false;

  const location = normalizeText(
    sale.saleLocation ??
      sale.stockLocation ??
      sale.location
  );

  const isMarkedShopSale =
    location === "shop" ||
    sale.isShopSale === true ||
    sale.affectsShopStock === true;

  const status = normalizeText(sale.status);

  const cancelled = [
    "cancelled",
    "canceled",
    "void",
    "rejected",
  ].includes(status);

  return isMarkedShopSale && !cancelled;
};

const getShopSaleLitres = (sale) => {
  const explicitLitres = toNumber(
    sale.litresSold ??
      sale.quantityLitres ??
      sale.quantitySoldLitres
  );

  if (explicitLitres > 0) {
    return explicitLitres;
  }

  const quantity = toNumber(
    sale.quantitySold ?? sale.quantity
  );

  const unit = normalizeText(
    sale.unit ??
      sale.quantityUnit ??
      sale.measurementUnit
  );

  if (
    unit === "litres" ||
    unit === "liters" ||
    unit === "l"
  ) {
    return quantity;
  }

  if (
    unit === "75cl" ||
    unit === "75_cl" ||
    unit === "bottle_75cl"
  ) {
    return quantity * 0.75;
  }

  if (
    unit === "5l" ||
    unit === "5_l" ||
    unit === "jerrycan_5l"
  ) {
    return quantity * 5;
  }

  if (unit === "keg" || unit === "kegs") {
    return quantity * 30;
  }

  return 0;
};

const getShopSaleHoneyBottles = (sale) => {
  const explicitBottles = toNumber(
    sale.bottlesSold ??
      sale.quantityBottles
  );

  if (explicitBottles > 0) {
    return explicitBottles;
  }

  const quantity = toNumber(
    sale.quantitySold ?? sale.quantity
  );

  const unit = normalizeText(
    sale.unit ??
      sale.quantityUnit ??
      sale.measurementUnit
  );

  if (
    unit === "bottle" ||
    unit === "bottles"
  ) {
    return quantity;
  }

  if (
    unit === "carton" ||
    unit === "cartons"
  ) {
    return (
      quantity *
      toNumber(sale.bottlesPerCarton)
    );
  }

  return 0;
};

/* =========================================================
   CURRENCY
========================================================= */

const formatCurrency = (value) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(toNumber(value));

const formatQuantity = (value) =>
  toNumber(value).toLocaleString("en-NG", {
    maximumFractionDigits: 2,
  });

/* =========================================================
   ADMIN DASHBOARD
========================================================= */

const AdminDashboard = () => {
  const navigate = useNavigate();

  /* =======================================================
     AUTH
  ======================================================= */

  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [displayName, setDisplayName] = useState("");

  /* =======================================================
     BUSINESS DATA
  ======================================================= */

  const [sales, setSales] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [conversions, setConversions] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [stockTransfers, setStockTransfers] = useState([]);

  const [loading, setLoading] = useState(true);

  /* =======================================================
     AUTHENTICATION
  ======================================================= */

  useEffect(() => {
    let isMounted = true;

    const unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        if (!isMounted) return;

        if (!user) {
          setCurrentUser(null);
          setIsAdmin(false);
          setDisplayName("");
          setAuthLoading(false);

          navigate("/login", { replace: true });
          return;
        }

        setCurrentUser(user);

        try {
          const admin = await isAdminUser(user);

          if (!isMounted) return;

          const userInformation =
            await getUserInformation(user);

          if (!isMounted) return;

          const resolvedName = String(
            userInformation?.displayName ||
              user.displayName ||
              ""
          ).trim();

          setDisplayName(resolvedName);
          setIsAdmin(Boolean(admin));
          setAuthLoading(false);

          if (!admin) {
            navigate("/dashboard", { replace: true });
          }
        } catch (error) {
          console.error(
            "Admin authentication failed:",
            error
          );

          if (!isMounted) return;

          setCurrentUser(null);
          setIsAdmin(false);
          setDisplayName("");
          setAuthLoading(false);

          navigate("/dashboard", { replace: true });
        }
      }
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [navigate]);

  /* =======================================================
     SALES
  ======================================================= */

  useEffect(() => {
    if (authLoading || !isAdmin) {
      return undefined;
    }

    const unsubscribe = onSnapshot(
      collection(db, "sales"),
      (snapshot) => {
        setSales(
          snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          }))
        );

        setLoading(false);
      },
      (error) => {
        console.error("Sales error:", error);
        setSales([]);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [authLoading, isAdmin]);

  /* =======================================================
     MATERIALS
  ======================================================= */

  useEffect(() => {
    if (authLoading || !isAdmin) {
      return undefined;
    }

    const unsubscribe = onSnapshot(
      collection(db, "materials"),
      (snapshot) => {
        setMaterials(
          snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          }))
        );
      },
      (error) => {
        console.error("Materials error:", error);
        setMaterials([]);
      }
    );

    return unsubscribe;
  }, [authLoading, isAdmin]);

  /* =======================================================
     CONVERSIONS
  ======================================================= */

  useEffect(() => {
    if (authLoading || !isAdmin) {
      return undefined;
    }

    const unsubscribe = onSnapshot(
      collection(db, "conversions"),
      (snapshot) => {
        setConversions(
          snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          }))
        );
      },
      (error) => {
        console.error("Conversions error:", error);
        setConversions([]);
      }
    );

    return unsubscribe;
  }, [authLoading, isAdmin]);

  /* =======================================================
     EXPENSES
  ======================================================= */

  useEffect(() => {
    if (authLoading || !isAdmin) {
      return undefined;
    }

    const unsubscribe = onSnapshot(
      collection(db, "expenses"),
      (snapshot) => {
        setExpenses(
          snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          }))
        );
      },
      (error) => {
        console.warn(
          "Expenses unavailable:",
          error
        );

        setExpenses([]);
      }
    );

    return unsubscribe;
  }, [authLoading, isAdmin]);

  /* =======================================================
     SHOP STOCK TRANSFERS
  ======================================================= */

  useEffect(() => {
    if (authLoading || !isAdmin) {
      return undefined;
    }

    const unsubscribe = onSnapshot(
      collection(db, "stockTransfers"),
      (snapshot) => {
        setStockTransfers(
          snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          }))
        );
      },
      (error) => {
        console.error(
          "Shop stock transfers error:",
          error
        );

        setStockTransfers([]);
      }
    );

    return unsubscribe;
  }, [authLoading, isAdmin]);

  /* =======================================================
     TODAY FILTERS
  ======================================================= */

  const todaySales = useMemo(
    () =>
      sales.filter((sale) =>
        isToday(getRecordDate(sale))
      ),
    [sales]
  );

  const todayMaterials = useMemo(
    () =>
      materials.filter(
        (material) =>
          isToday(getRecordDate(material)) &&
          getMaterialCost(material) > 0
      ),
    [materials]
  );

  const todayExpenses = useMemo(
    () =>
      expenses.filter((expense) =>
        isToday(getRecordDate(expense))
      ),
    [expenses]
  );

  const todayConversions = useMemo(
    () =>
      conversions.filter((conversion) =>
        isToday(getRecordDate(conversion))
      ),
    [conversions]
  );

  /* =======================================================
     TODAY SALES
  ======================================================= */

  const todaySalesAmount = useMemo(
    () =>
      todaySales.reduce(
        (total, sale) =>
          total + getSaleAmount(sale),
        0
      ),
    [todaySales]
  );

  /* =======================================================
     TODAY EXPENSES
  ======================================================= */

  const todayExpenseAmount = useMemo(
    () =>
      todayMaterials.reduce(
        (total, material) =>
          total + getMaterialCost(material),
        0
      ) +
      todayExpenses.reduce(
        (total, expense) =>
          total + getExpenseAmount(expense),
        0
      ),
    [todayMaterials, todayExpenses]
  );

  /* =======================================================
     TODAY PROFIT
  ======================================================= */

  const todayProfit =
    todaySalesAmount - todayExpenseAmount;

  /* =======================================================
     TODAY OIL
  ======================================================= */

  const todayOilTurned = useMemo(
    () =>
      todayConversions.reduce(
        (total, conversion) =>
          total + getConversionLitres(conversion),
        0
      ),
    [todayConversions]
  );

  /* =======================================================
     TOTAL SALES
  ======================================================= */

  const totalSales = useMemo(
    () =>
      sales.reduce(
        (total, sale) =>
          total + getSaleAmount(sale),
        0
      ),
    [sales]
  );

  /* =======================================================
     TOTAL EXPENSES
  ======================================================= */

  const totalExpenses = useMemo(
    () =>
      materials.reduce(
        (total, material) =>
          total + getMaterialCost(material),
        0
      ) +
      expenses.reduce(
        (total, expense) =>
          total + getExpenseAmount(expense),
        0
      ),
    [materials, expenses]
  );

  /* =======================================================
     TOTAL PROFIT
  ======================================================= */

  const totalProfit =
    totalSales - totalExpenses;

  /* =======================================================
     SHOP STOCK CALCULATION
  ======================================================= */

  const shopStockSummary = useMemo(() => {
    const balances = {
      palm_oil: 0,
      kuli_kuli: 0,
      honey: 0,
    };

    /* -------------------------------------------------------
       ADD COMPLETED FARM-TO-SHOP TRANSFERS
    ------------------------------------------------------- */

    stockTransfers.forEach((transfer) => {
      if (!isFarmToShopTransfer(transfer)) {
        return;
      }

      const productType = getProductType(transfer);

      if (!productType) return;

      if (productType === "honey") {
        balances.honey +=
          getTransferHoneyBottles(transfer);

        return;
      }

      if (
        productType === "palm_oil" ||
        productType === "kuli_kuli"
      ) {
        balances[productType] +=
          getTransferQuantity(transfer);
      }
    });

    /* -------------------------------------------------------
       SUBTRACT COMPLETED SHOP SALES
    ------------------------------------------------------- */

    sales.forEach((sale) => {
      if (!isShopSale(sale)) {
        return;
      }

      const productType = getProductType(sale);

      if (!productType) return;

      if (productType === "honey") {
        balances.honey -=
          getShopSaleHoneyBottles(sale);

        return;
      }

      if (
        productType === "palm_oil" ||
        productType === "kuli_kuli"
      ) {
        balances[productType] -=
          getShopSaleLitres(sale);
      }
    });

    return {
      palmOil: Math.max(0, balances.palm_oil),
      kuliKuli: Math.max(0, balances.kuli_kuli),
      honey: Math.max(0, balances.honey),
    };
  }, [stockTransfers, sales]);

  /* =======================================================
     LOADING SCREEN
  ======================================================= */

  if (authLoading) {
    return (
      <ResponsiveLayout>
        <div className="admin-dashboard">
          <div className="admin-loading-screen">
            <div className="admin-loading-spinner" />

            <h2>Loading dashboard...</h2>

            <p>Please wait.</p>
          </div>
        </div>
      </ResponsiveLayout>
    );
  }

  /* =======================================================
     BLOCK NON-ADMIN
  ======================================================= */

  if (!currentUser || !isAdmin) {
    return null;
  }

  const adminName =
    displayName || "Administrator";

  /* =======================================================
     DASHBOARD
  ======================================================= */

  return (
    <ResponsiveLayout>
      <div className="admin-dashboard">

        {/* HEADER */}

        <header className="admin-header">
          <div className="admin-header-content">
            <span className="admin-eyebrow">
              AFUBIA FARMS • ADMIN
            </span>

            <h1>Admin Dashboard</h1>

            <p>
              Simple overview of your palm oil business.
            </p>
          </div>

          <div className="admin-badge">
            <span>LOGGED IN AS</span>

            <strong>{adminName}</strong>
          </div>
        </header>

        {/* TODAY'S BUSINESS */}

        <section className="admin-section">
          <div className="admin-section-heading">
            <div>
              <span className="section-kicker">
                TODAY
              </span>

              <h2>Today's Business</h2>

              <p>
                Your business activity for today.
              </p>
            </div>

            <div className="live-indicator">
              <span />
              Live
            </div>
          </div>

          <div className="admin-grid">

            {/* SALES */}

            <div className="admin-card admin-stat-card">
              <div className="admin-card-icon">₦</div>

              <div className="admin-card-content">
                <span>SALES</span>

                <h3>
                  {formatCurrency(todaySalesAmount)}
                </h3>

                <p>
                  {todaySales.length} sale
                  {todaySales.length === 1 ? "" : "s"} today.
                </p>
              </div>
            </div>

            {/* EXPENSES */}

            <div className="admin-card admin-stat-card">
              <div className="admin-card-icon">📦</div>

              <div className="admin-card-content">
                <span>EXPENSES</span>

                <h3>
                  {formatCurrency(todayExpenseAmount)}
                </h3>

                <p>Money spent today.</p>
              </div>
            </div>

            {/* PROFIT */}

            <div className="admin-card admin-stat-card">
              <div className="admin-card-icon">₦</div>

              <div className="admin-card-content">
                <span>PROFIT</span>

                <h3>
                  {formatCurrency(todayProfit)}
                </h3>

                <p>Sales minus expenses.</p>
              </div>
            </div>

            {/* OIL TURNED */}

            <div className="admin-card admin-stat-card">
              <div className="admin-card-icon">
                <img className="admin-card-icon"
                  src={oilContainers}
                  alt="Palm oil containers"
                />
              </div>

              <div className="admin-card-content">
                <span>OIL TURNED</span>

                <h3>
                  {formatQuantity(todayOilTurned)} L
                </h3>

                <p>Oil turned today.</p>
              </div>
            </div>
          </div>
        </section>

        {/* OVERALL BUSINESS */}

        <section className="admin-section">
          <div className="admin-section-heading">
            <div>
              <span className="section-kicker">
                OVERALL
              </span>

              <h2>Business Summary</h2>

              <p>All recorded business activity.</p>
            </div>
          </div>

          <div className="admin-grid">

            {/* TOTAL SALES */}

            <div className="admin-card admin-stat-card">
              <div className="admin-card-icon">💵</div>

              <div className="admin-card-content">
                <span>TOTAL SALES</span>

                <h3>{formatCurrency(totalSales)}</h3>

                <p>All recorded sales.</p>
              </div>
            </div>

            {/* TOTAL EXPENSES */}

            <div className="admin-card admin-stat-card">
              <div className="admin-card-icon">📦</div>

              <div className="admin-card-content">
                <span>TOTAL EXPENSES</span>

                <h3>{formatCurrency(totalExpenses)}</h3>

                <p>All recorded expenses.</p>
              </div>
            </div>

            {/* TOTAL PROFIT */}

            <div className="admin-card admin-stat-card">
              <div className="admin-card-icon">₦</div>

              <div className="admin-card-content">
                <span>TOTAL PROFIT</span>

                <h3>{formatCurrency(totalProfit)}</h3>

                <p>Sales minus expenses.</p>
              </div>
            </div>
          </div>
        </section>

        {/* MANAGEMENT */}

        <section className="admin-section">
          <div className="admin-section-heading">
            <div>
              <span className="section-kicker">
                MANAGEMENT
              </span>

              <h2>Business Management</h2>

              <p>Open the section you need.</p>
            </div>
          </div>

          <div className="admin-grid">

            {/* PRODUCTS */}

            <button
              type="button"
              className="admin-card admin-management-card"
              onClick={() => navigate("/admin/products")}
            >
              <div className="admin-card-icon">🛍️</div>

              <div className="admin-card-content">
                <span>CATALOGUE</span>

                <h3>Manage Products</h3>

                <p>
                  Add products, update prices, and control
                  which products are available for sale.
                </p>
              </div>

              <strong className="admin-card-arrow">→</strong>
            </button>

            {/* SHOP STOCK */}

            <button
              type="button"
              className="admin-card admin-management-card"
              onClick={() => navigate("/admin/shop-stock")}
            >
              <div className="admin-card-icon">🏪</div>

              <div className="admin-card-content">
                <span>SHOP INVENTORY</span>

                <h3>Shop Stock</h3>

                <p>
                  Check shop balances, review transfers from
                  the farm, and view shop stock history.
                </p>
              </div>

              <strong className="admin-card-arrow">→</strong>
            </button>

            {/* REPORTS */}

            <button
              type="button"
              className="admin-card admin-management-card"
              onClick={() => navigate("/admin/reports")}
            >
              <div className="admin-card-icon">📈</div>

              <div className="admin-card-content">
                <span>REPORTS</span>

                <h3>Reports</h3>

                <p>
                  View sales, conversions, and business records.
                </p>
              </div>

              <strong className="admin-card-arrow">→</strong>
            </button>

            {/* PROFIT */}

            <button
              type="button"
              className="admin-card admin-management-card"
              onClick={() => navigate("/admin/profit")}
            >
              <div className="admin-card-icon">₦</div>

              <div className="admin-card-content">
                <span>FINANCE</span>

                <h3>Profit Analysis</h3>

                <p>
                  Understand your sales, expenses, and profit.
                </p>
              </div>

              <strong className="admin-card-arrow">→</strong>
            </button>

            {/* MATERIALS */}

            <button
              type="button"
              className="admin-card admin-management-card"
              onClick={() => navigate("/admin/materials")}
            >
              <div className="admin-card-icon">📦</div>

              <div className="admin-card-content">
                <span>PURCHASES</span>

                <h3>Materials</h3>

                <p>
                  Record materials bought for the business.
                </p>
              </div>

              <strong className="admin-card-arrow">→</strong>
            </button>

            {/* FARM STOCK */}

            <button
              type="button"
              className="admin-card admin-management-card"
              onClick={() => navigate("/admin/stock")}
            >
              <div className="admin-card-icon">📊</div>

              <div className="admin-card-content">
                <span>FARM INVENTORY</span>

                <h3>Stock Tracker</h3>

                <p>
                  See available farm oil and container stock.
                </p>
              </div>

              <strong className="admin-card-arrow">→</strong>
            </button>
          </div>
        </section>

        {/* QUICK ACTIONS */}

        <section className="admin-operations">
          <div className="operations-content">
            <span>QUICK ACTIONS</span>

            <h2>Daily Operations</h2>

            <p>
              Quickly record today's business activities.
            </p>
          </div>

          <div className="operations-buttons">
            <button
              type="button"
              onClick={() => navigate("/sales")}
            >
              Record Sale
            </button>

            <button
              type="button"
              onClick={() => navigate("/conversion")}
            >
              Turn Oil
            </button>
          </div>
        </section>

        {/* STATUS */}

        <div className="admin-footer-status">
          <span className="status-dot" />

          <span>Data updates automatically</span>

          {loading && (
            <span className="status-loading">
              Updating...
            </span>
          )}
        </div>
      </div>
    </ResponsiveLayout>
  );
};

export default AdminDashboard;
