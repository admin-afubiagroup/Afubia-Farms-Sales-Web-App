
/* =========================================================
   AFUBIA FARMS — SHOP STOCK TRACKER

   CALCULATION:
   Remaining shop stock = recorded opening stock - shop sales

   - Stock is entered directly for the selected shop in shopOpeningStock.
   - Each branch has its own balance; no farm-transfer workflow is used.
   - Opening stock is inventory, not sales or business income.
   - Palm Oil and Kuli-Kuli Oil are measured in litres.
   - Honey is measured in bottles.
   - Uses Africa/Lagos for dates.
   ========================================================= */

import { useEffect, useMemo, useState } from "react";

import {
  collection,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { auth, db } from "../Firebase/firebase.utils";

import oilTurning from "../assets/oil_containers.jpg";
import kuliKuli from "../assets/kuliKuli.jpg";
import honey from "../assets/honey.jpg";

import "./ShopStock.css";
import { saveShopOpeningStockRecord } from '../Firebase/businessFirestore';
import { balance as computeInventory } from '../Firebase/inventoryValidation.js';

/* =========================================================
   CONSTANTS
   ========================================================= */

const COLLECTIONS = {
  sales: "sales",
  shopOpeningStock: "shopOpeningStock",
};

const PRODUCTS = {
  PALM_OIL: "palm_oil",
  KULI_KULI: "kuli_kuli",
  HONEY: "honey",
};

const PRODUCT_DETAILS = {
  [PRODUCTS.PALM_OIL]: {
    name: "Palm Oil",
    image: oilTurning,
    unit: "litres",
    shortUnit: "L",
    description: "Palm oil available in the shop",
  },

  [PRODUCTS.KULI_KULI]: {
    name: "Kuli-Kuli Oil",
    image: kuliKuli,
    unit: "litres",
    shortUnit: "L",
    description: "Kuli-Kuli oil available in the shop",
  },

  [PRODUCTS.HONEY]: {
    name: "Honey",
    image: honey,
    unit: "bottles",
    shortUnit: "bottles",
    description: "Honey bottles available in the shop",
  },
};

const NIGERIA_TIME_ZONE = "Africa/Lagos";

/* =========================================================
   GENERAL HELPERS
   ========================================================= */

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const number = Number(
    String(value).replace(/[₦,\s]/g, "").trim()
  );

  return Number.isFinite(number) ? number : 0;
}

function roundNumber(value, decimals = 2) {
  const factor = 10 ** decimals;

  return (
    Math.round(
      (toNumber(value) + Number.EPSILON) * factor
    ) / factor
  );
}

function formatQuantity(value, decimals = 2) {
  return roundNumber(value, decimals).toLocaleString("en-NG", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function getNigeriaDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: NIGERIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function getDateInNigeria(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: NIGERIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function getRecordDate(record) {
  const possibleDates = [
    record?.saleDate,
    record?.recordDate,
    record?.date,
  ];

  for (const value of possibleDates) {
    if (!value) continue;

    if (typeof value === "string") {
      const match = value.match(/^(\d{4}-\d{2}-\d{2})/);

      if (match) return match[1];

      const parsed = new Date(value);

      if (!Number.isNaN(parsed.getTime())) {
        return getDateInNigeria(parsed);
      }
    }

    if (typeof value?.toDate === "function") {
      return getDateInNigeria(value.toDate());
    }

    if (value instanceof Date) {
      return getDateInNigeria(value);
    }

    if (typeof value === "number") {
      return getDateInNigeria(new Date(value));
    }
  }

  for (const value of [record?.timestamp, record?.createdAt]) {
    if (typeof value?.toDate === "function") {
      return getDateInNigeria(value.toDate());
    }
  }

  return "";
}

function formatDate(dateString) {
  if (!dateString) return "Date unavailable";

  const date = new Date(`${dateString}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return new Intl.DateTimeFormat("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: NIGERIA_TIME_ZONE,
  }).format(date);
}

function getText(record, keys) {
  for (const key of keys) {
    const value = record?.[key];

    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      return String(value).trim();
    }
  }

  return "";
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function isCancelled(record) {
  const status = normalizeText(
    getText(record, ["status", "saleStatus"])
  );

  return [
    "cancelled",
    "canceled",
    "void",
    "deleted",
  ].includes(status);
}

/* =========================================================
   PRODUCT IDENTIFICATION

   Do not rely on productType alone. It may contain a size
   such as "75cl", while another field identifies the product.
   ========================================================= */

function getProductType(record) {
  const values = [
    record?.productType,
    record?.product,
    record?.productName,
    record?.itemName,
    record?.materialName,
    record?.category,
    record?.productCategory,
    record?.stockCategory,
    record?.stockType,
    record?.item,
    record?.name,
  ]
    .filter(Boolean)
    .map(normalizeText);

  const combined = values.join(" ");

  if (
    combined.includes("kuli kuli") ||
    combined.includes("groundnut oil")
  ) {
    return PRODUCTS.KULI_KULI;
  }

  if (
    combined.includes("honey") ||
    combined.includes("sweetener")
  ) {
    return PRODUCTS.HONEY;
  }

  if (
    combined.includes("palm oil") ||
    combined.includes("red oil") ||
    combined.includes("palm")
  ) {
    return PRODUCTS.PALM_OIL;
  }

  return "";
}

/* =========================================================
   SHOP SALE IDENTIFICATION
   ========================================================= */

function getLocation(record) {
  return normalizeText(
    getText(record, [
      "stockLocation",
      "saleLocation",
      "location",
      "storeLocation",
    ])
  );
}

function isShopSale(record) {
  const location = getLocation(record);

  return (
    record?.isShopSale === true ||
    location === "shop" ||
    location === "store" ||
    location === "shop stock" ||
    location === "shop inventory"
  );
}

/* =========================================================
   QUANTITY AND UNIT HELPERS
   ========================================================= */

function getQuantity(record) {
  return Math.max(
    0,
    toNumber(
      record?.quantity ??
      record?.amount ??
      record?.totalQuantity
    )
  );
}

function getRecordUnit(record) {
  return normalizeText(
    getText(record, [
      "stockUnit",
      "unit",
      "quantityUnit",
      "productUnit",
      "size",
      "productType",
    ])
  );
}

function convertQuantityToLitres(quantity, unit) {
  const normalizedUnit = normalizeText(unit).replace(/\s/g, "");

  if (
    normalizedUnit.includes("75cl") ||
    normalizedUnit.includes("750ml")
  ) {
    return quantity * 0.75;
  }

  if (
    normalizedUnit.includes("50cl") ||
    normalizedUnit.includes("500ml")
  ) {
    return quantity * 0.5;
  }

  if (
    normalizedUnit.includes("25cl") ||
    normalizedUnit.includes("250ml")
  ) {
    return quantity * 0.25;
  }

  if (
    normalizedUnit.includes("5l") ||
    normalizedUnit.includes("5litre") ||
    normalizedUnit.includes("5liter")
  ) {
    return quantity * 5;
  }

  if (
    normalizedUnit.includes("10l") ||
    normalizedUnit.includes("10litre") ||
    normalizedUnit.includes("10liter")
  ) {
    return quantity * 10;
  }

  if (
    normalizedUnit.includes("20l") ||
    normalizedUnit.includes("20litre") ||
    normalizedUnit.includes("20liter")
  ) {
    return quantity * 20;
  }

  return quantity;
}

/* =========================================================
   OPENING STOCK QUANTITY

   Honey is counted in bottles.
   Both oils are converted to litres.
   ========================================================= */

function getOpeningQuantity(record) {
  const productType = getProductType(record);

  if (productType === PRODUCTS.HONEY) {
    const explicitBottles = [
      record?.quantityBottles,
      record?.bottles,
      record?.bottleQuantity,
    ].find(
      (value) =>
        value !== undefined &&
        value !== null &&
        value !== ""
    );

    return Math.max(
      0,
      toNumber(
        explicitBottles !== undefined
          ? explicitBottles
          : getQuantity(record)
      )
    );
  }

  const explicitLitres = [
    record?.quantityLitres,
    record?.litres,
    record?.liters,
  ].find(
    (value) =>
      value !== undefined &&
      value !== null &&
      value !== "" &&
      toNumber(value) > 0
  );

  if (explicitLitres !== undefined) {
    return Math.max(0, toNumber(explicitLitres));
  }

  return Math.max(
    0,
    convertQuantityToLitres(
      getQuantity(record),
      getRecordUnit(record)
    )
  );
}

/* =========================================================
   OIL SALE QUANTITIES

   Category-specific fields take priority over generic fields.
   This is important when the same sale document contains
   quantities for more than one oil product.
   ========================================================= */

function getSaleLitres(record, productType) {
  const categorySpecificFields =
    productType === PRODUCTS.PALM_OIL
      ? [
          record?.palmOilLitresSold,
          record?.oilLitresSold,
        ]
      : [
          record?.kuliKuliLitresSold,
          record?.kuliKuliOilLitresSold,
          record?.kuliKuliOilLitres,
          record?.kuliKuliLitres,
        ];

  const categoryQuantity = categorySpecificFields.find(
    (value) =>
      value !== undefined &&
      value !== null &&
      value !== "" &&
      toNumber(value) > 0
  );

  if (categoryQuantity !== undefined) {
    return Math.max(0, toNumber(categoryQuantity));
  }

  const genericLitres = [
    record?.litresSold,
    record?.litersSold,
    record?.totalLitresSold,
    record?.totalLitres,
    record?.totalLiters,
    record?.quantityLitres,
    record?.quantityLiters,
  ].find(
    (value) =>
      value !== undefined &&
      value !== null &&
      value !== "" &&
      toNumber(value) > 0
  );

  if (genericLitres !== undefined) {
    return Math.max(0, toNumber(genericLitres));
  }

  const quantity = toNumber(
    record?.quantitySold ??
    record?.quantity ??
    record?.amount ??
    record?.totalQuantity
  );

  return Math.max(
    0,
    convertQuantityToLitres(quantity, getRecordUnit(record))
  );
}

/* =========================================================
   HONEY SALE QUANTITY
   ========================================================= */

function getHoneySaleBottles(record) {
  const explicitBottles = [
    record?.honeyBottlesSold,
    record?.honeyQuantitySold,
    record?.bottlesSold,
    record?.quantityBottles,
    record?.bottleQuantity,
    record?.bottles,
  ].find(
    (value) =>
      value !== undefined &&
      value !== null &&
      value !== "" &&
      toNumber(value) > 0
  );

  if (explicitBottles !== undefined) {
    return Math.max(0, toNumber(explicitBottles));
  }

  const unit = getRecordUnit(record);

  if (
    unit.includes("bottle") ||
    unit.includes("piece") ||
    unit.includes("unit")
  ) {
    return Math.max(
      0,
      toNumber(
        record?.quantitySold ??
        record?.quantity ??
        record?.amount
      )
    );
  }

  return 0;
}

function getSaleQuantityForProduct(record, productType) {
  if (productType === PRODUCTS.HONEY) {
    return getHoneySaleBottles(record);
  }

  return getSaleLitres(record, productType);
}

function normalizeBranchId(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");

  if (text === "kara" || text === "kara-shop") return "kara";
  if (text === "ogidan" || text === "ogidan-shop") return "ogidan";
  return "";
}

/* =========================================================
   COMPONENT
   ========================================================= */

export default function ShopStock() {
  const [sales, setSales] = useState([]);
  const [openingStockRecords, setOpeningStockRecords] = useState([]);
  const [conversionRecords, setConversionRecords] = useState([]);

  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState([]);

  const [selectedProduct, setSelectedProduct] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState(() => {
    try {
      const saved = window.sessionStorage.getItem("afubiaBranchId");
      return saved === "ogidan" ? "ogidan" : "kara";
    } catch {
      return "kara";
    }
  });

  useEffect(() => {
    try {
      window.sessionStorage.setItem("afubiaBranchId", branchFilter);
      window.sessionStorage.setItem("afubiaReportBranchFilter", branchFilter);
    } catch {
      // Keep the selected branch in component state if storage is unavailable.
    }
  }, [branchFilter]);

  const [showAllTransactions, setShowAllTransactions] = useState(false);

  const [openingForm, setOpeningForm] = useState({
    productType: PRODUCTS.PALM_OIL,
    quantity: "",
    unit: "litres",
    cost: "",
    notes: "",
  });

  const [savingOpeningStock, setSavingOpeningStock] = useState(false);
  const [openingMessage, setOpeningMessage] = useState("");
  const [openingError, setOpeningError] = useState("");

  /* =======================================================
     FIRESTORE SUBSCRIPTIONS
     ======================================================= */

  useEffect(() => {
    let active = true;
    let loadedCount = 0;

    const loadedSources = new Set();

    const reportLoaded = (label) => {
      if (loadedSources.has(label)) return;

      loadedSources.add(label);
      loadedCount += 1;

      if (active && loadedCount >= 3) {
        setLoading(false);
      }
    };

    const reportError = (label, error) => {
      console.error(`${label} subscription error:`, error);

      if (active) {
        setErrors((previous) => [
          ...previous.filter((item) => item.label !== label),
          {
            label,
            message:
              error?.code === "permission-denied"
                ? `Permission denied while loading ${label.toLowerCase()}. Check your Firestore rules.`
                : `Unable to load ${label.toLowerCase()}. Check your connection and Firestore permissions.`,
          },
        ]);
      }

      reportLoaded(label);
    };

    const subscribe = (collectionName, setter, label) =>
      onSnapshot(
        query(
          collection(db, collectionName),
          where("branchId", "==", branchFilter)
        ),
        (snapshot) => {
          if (active) {
            setter(
              snapshot.docs.map((document) => ({
                id: document.id,
                ...document.data(),
              }))
            );

            setErrors((previous) =>
              previous.filter((item) => item.label !== label)
            );
          }

          reportLoaded(label);
        },
        (error) => reportError(label, error)
      );

    const unsubscribeSales = subscribe(
      COLLECTIONS.sales,
      setSales,
      "Sales"
    );

    const unsubscribeOpening = subscribe(
      COLLECTIONS.shopOpeningStock,
      setOpeningStockRecords,
      "Opening stock"
    );
    const unsubscribeConversions = subscribe('conversions', setConversionRecords, 'Conversions');
    return () => {
      active = false;
      unsubscribeSales();
      unsubscribeConversions();
      unsubscribeOpening();
    };
  }, [branchFilter]);

  /* =======================================================
     VALID OPENING STOCK
     ======================================================= */

  const validOpeningStock = useMemo(
    () =>
      openingStockRecords.filter(
        (record) =>
          (normalizeBranchId(record.branchId || record.branchName) === branchFilter) &&
          !isCancelled(record) &&
          Boolean(getProductType(record)) &&
          getOpeningQuantity(record) > 0
      ),
    [openingStockRecords, branchFilter]
  );

  /* =======================================================
     VALID SHOP SALES

     Only completed, recognized shop sales count.
     Kuli-Kuli records marked affectsKuliKuliStock === false
     are excluded from the Kuli-Kuli stock deduction.
     ======================================================= */

  const shopSales = useMemo(
    () =>
      sales.filter((sale) => {
        if (normalizeBranchId(sale.branchId || sale.branchName) !== branchFilter) {
          return false;
        }

        if (!isShopSale(sale) || isCancelled(sale)) {
          return false;
        }

        const productType = getProductType(sale);

        if (!productType) return false;

        if (
          productType === PRODUCTS.KULI_KULI &&
          sale.affectsKuliKuliStock === false
        ) {
          return false;
        }

        return getSaleQuantityForProduct(sale, productType) > 0;
      }),
    [sales, branchFilter]
  );

  /* =======================================================
     STOCK CALCULATION

     Remaining stock = opening stock entered for this branch - shop sales.

     Each product has its own balance and unit. No farm-transfer records
     participate in the shop stock calculation.
     ======================================================= */

  const productBalances = useMemo(() => {
    const current = computeInventory({ shopOpeningStock: validOpeningStock, sales: shopSales, conversions: conversionRecords.filter(r => r.branchId === branchFilter) });
    const added = computeInventory({ shopOpeningStock: validOpeningStock, conversions: conversionRecords.filter(r => r.branchId === branchFilter) });
    return Object.fromEntries(Object.entries(PRODUCT_DETAILS).map(([key, detail]) => [key, { opening: added.stock[detail.name], remaining: current.stock[detail.name], sold: added.stock[detail.name] - current.stock[detail.name], unit: detail.unit }]));
  }, [validOpeningStock, shopSales, conversionRecords, branchFilter]);

  const totalOpeningEntries = validOpeningStock.length;

  const totalShopSales = shopSales.length;

  const productsWithNegativeBalance = Object.entries(productBalances)
    .filter(([, balance]) => balance.remaining < 0);

  /* =======================================================
     OPENING STOCK SUMMARY
     ======================================================= */

  const openingQuantitySummary = [
    {
      label: "Palm Oil",
      value: productBalances[PRODUCTS.PALM_OIL].opening,
      unit: "L",
    },
    {
      label: "Kuli-Kuli Oil",
      value: productBalances[PRODUCTS.KULI_KULI].opening,
      unit: "L",
    },
    {
      label: "Honey",
      value: productBalances[PRODUCTS.HONEY].opening,
      unit: "bottles",
    },
  ];

  /* =======================================================
     TRANSACTION HISTORY
     ======================================================= */

  const transactions = useMemo(() => {
    const openingRows = validOpeningStock.map((record) => ({
      id: `opening-${record.id}`,
      sourceId: record.id,
      type: "opening",
      productType: getProductType(record),
      date: getRecordDate(record),
      customer: "Opening shop stock",
      quantity: getOpeningQuantity(record),
      notes: getText(record, ["notes", "description", "remarks"]),
    }));

    const saleRows = shopSales.map((sale) => {
      const productType = getProductType(sale);

      return {
        id: `sale-${sale.id}`,
        sourceId: sale.id,
        type: "sale",
        productType,
        date: getRecordDate(sale),
        customer:
          getText(sale, [
            "customerName",
            "customer",
            "buyerName",
            "buyer",
          ]) || "Walk-in Customer",
        quantity: getSaleQuantityForProduct(sale, productType),
        notes: getText(sale, ["notes", "description", "remarks"]),
      };
    });

    return [...openingRows, ...saleRows].sort((a, b) => {
      if (a.date !== b.date) {
        return b.date.localeCompare(a.date);
      }

      return b.id.localeCompare(a.id);
    });
  }, [validOpeningStock, shopSales]);

  /* =======================================================
     HISTORY FILTERS
     ======================================================= */

  const filteredTransactions = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const today = getNigeriaDate();

    return transactions.filter((transaction) => {
      const productMatches =
        selectedProduct === "all" ||
        transaction.productType === selectedProduct;

      const dateMatches =
        dateFilter === "all" ||
        (dateFilter === "today" && transaction.date === today);

      const productName =
        PRODUCT_DETAILS[transaction.productType]?.name || "";

      const searchMatches =
        !search ||
        productName.toLowerCase().includes(search) ||
        transaction.customer.toLowerCase().includes(search) ||
        transaction.notes.toLowerCase().includes(search) ||
        transaction.type.toLowerCase().includes(search);

      return productMatches && dateMatches && searchMatches;
    });
  }, [transactions, selectedProduct, searchTerm, dateFilter]);

  const visibleTransactions = useMemo(
    () =>
      showAllTransactions
        ? filteredTransactions
        : filteredTransactions.slice(0, 3),
    [filteredTransactions, showAllTransactions]
  );

  /* =======================================================
     OPENING STOCK FORM
     ======================================================= */

  function handleOpeningFormChange(event) {
    const { name, value } = event.target;

    setOpeningForm((previous) => {
      const next = {
        ...previous,
        [name]: value,
      };

      if (
        name === "productType" &&
        value === PRODUCTS.HONEY
      ) {
        next.unit = "bottles";
      } else if (
        name === "productType" &&
        previous.productType === PRODUCTS.HONEY
      ) {
        next.unit = "litres";
      }

      return next;
    });

    setOpeningMessage("");
    setOpeningError("");
  }

  function getOpeningQuantityToAdd() {
    const quantity = Math.max(0, toNumber(openingForm.quantity));

    if (openingForm.productType === PRODUCTS.HONEY) {
      return roundNumber(quantity);
    }

    if (openingForm.unit === "75cl") {
      return roundNumber(quantity * 0.75);
    }

    if (openingForm.unit === "5L") {
      return roundNumber(quantity * 5);
    }

    return roundNumber(quantity);
  }

  async function handleOpeningStockSubmit(event) {
    event.preventDefault();

    setOpeningMessage("");
    setOpeningError("");

    const user = auth.currentUser;

    if (!user) {
      setOpeningError(
        "You must be signed in to record opening shop stock."
      );
      return;
    }

    const quantity = toNumber(openingForm.quantity);
    const productType = openingForm.productType;
    const productDetails = PRODUCT_DETAILS[productType];

    if (!Number.isFinite(quantity) || quantity <= 0) {
      setOpeningError("Enter a quantity greater than zero.");
      return;
    }

    if (!productDetails) {
      setOpeningError("Please select a valid product.");
      return;
    }

    const quantityToAdd = getOpeningQuantityToAdd();

    if (quantityToAdd <= 0) {
      setOpeningError("The stock quantity must be greater than zero.");
      return;
    }

    setSavingOpeningStock(true);

    try {
      const now = new Date();
      const recordDate = getNigeriaDate();
      const isHoney = productType === PRODUCTS.HONEY;

      const payload = {
        recordType: "opening_stock",
        transactionType: "opening_stock",
        branchId: branchFilter,
        branchName: branchFilter === "kara" ? "Kara Shop" : "Ogidan Shop",

        productType,
        product: productDetails.name,
        productName: productDetails.name,
        category: productType,
        productCategory: productType,
        stockCategory: productType,

        quantity,
        cost: Math.max(0, toNumber(openingForm.cost)),
        purchaseCost: Math.max(0, toNumber(openingForm.cost)),
        amountPaid: Math.max(0, toNumber(openingForm.cost)),
        unit: openingForm.unit,
        quantityUnit: openingForm.unit,
        stockUnit: isHoney ? "bottles" : "litres",

        quantityLitres: isHoney ? 0 : quantityToAdd,
        litres: isHoney ? 0 : quantityToAdd,

        quantityBottles: isHoney ? quantityToAdd : 0,
        bottles: isHoney ? quantityToAdd : 0,

        notes: openingForm.notes.trim(),

        stockLocation: "shop",
        saleLocation: "shop",
        location: "shop",

        isShopSale: false,
        affectsShopStock: true,
        affectsFarmStock: false,
        affectsSales: false,
        affectsProfit: false,

        recordDate,
        date: recordDate,

        recordTime: new Intl.DateTimeFormat("en-NG", {
          timeZone: NIGERIA_TIME_ZONE,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        }).format(now),

        dateTime: now.toISOString(),
        status: "completed",
        userId: user.uid,
        createdAt: serverTimestamp(),
      };

      // Opening stock is saved separately, never in sales.
      await saveShopOpeningStockRecord(payload);

      setOpeningMessage(
        `${productDetails.name} shop stock entry recorded successfully.`
      );

      setOpeningForm((previous) => ({
        ...previous,
        quantity: "",
        cost: "",
        notes: "",
      }));
    } catch (error) {
      console.error("Unable to record opening shop stock:", error);

      setOpeningError(
        error?.code === "permission-denied"
          ? "Permission denied. Check your Firestore rules for shopOpeningStock."
          : error?.message ||
            "Unable to record opening shop stock. Please try again."
      );
    } finally {
      setSavingOpeningStock(false);
    }
  }

  /* =======================================================
     RENDER
     ======================================================= */

  return (
    <main className="shop-stock-page">
      <header className="shop-stock-header">
        <div>
          <p className="shop-stock-eyebrow">AFUBIA FARMS</p>

          <h1>Shop Stock</h1>

          <p className="shop-stock-subtitle">
            See how much stock you started with, how much was sold,
            and what remains in the shop.
          </p>
        </div>

        <label className="shop-stock-branch-picker shop-stock-header-branch">
          Branch
          <select
            value={branchFilter}
            onChange={(event) => setBranchFilter(event.target.value)}
          >
            <option value="kara">Kara Shop</option>
            <option value="ogidan">Ogidan Shop</option>
          </select>
        </label>

        <div className="shop-stock-header-badge">
          <span className="shop-stock-status-dot" />
          Live Stock
        </div>
      </header>

      {errors.map((item) => (
        <div
          className="shop-stock-alert shop-stock-alert-error"
          key={item.label}
          role="alert"
        >
          {item.message}
        </div>
      ))}

      {loading ? (
        <section className="shop-stock-loading">
          <div className="shop-stock-spinner" />
          <p>Loading shop stock...</p>
        </section>
      ) : (
        <>
          {/* SUMMARY */}

          <section className="shop-stock-summary">
            <article className="shop-stock-summary-card">
              <span className="shop-stock-summary-icon">🏁</span>

              <div>
                <p>Opening Entries</p>
                <h2>{totalOpeningEntries}</h2>
                <span>Stock records entered</span>
              </div>
            </article>

            <article className="shop-stock-summary-card">
              <span className="shop-stock-summary-icon">📦</span>

              <div>
                <p>Opening Stock</p>

                <div className="shop-stock-opening-summary">
                  {openingQuantitySummary.map((item) => (
                    <span key={item.label}>
                      <strong>{item.label}:</strong>{" "}
                      {formatQuantity(item.value)} {item.unit}
                      <br />
                    </span>
                  ))}
                </div>

                <span>Each product uses its own unit</span>
              </div>
            </article>

            <article className="shop-stock-summary-card">
              <span className="shop-stock-summary-icon">🏪</span>
              <div>
                <p>Stock Entries</p>
                <h2>{totalOpeningEntries}</h2>
                <span>Stock entered directly for this branch</span>
              </div>
            </article>

            <article className="shop-stock-summary-card">
              <span className="shop-stock-summary-icon">🧾</span>

              <div>
                <p>Shop Sales Counted</p>
                <h2>{totalShopSales}</h2>
                <span>Qualifying shop sale records</span>
              </div>
            </article>

            <article className="shop-stock-summary-card">
              <span className="shop-stock-summary-icon">🧮</span>

              <div>
                <p>Products Tracked</p>
                <h2>3</h2>
                <span>Palm Oil, Kuli-Kuli Oil and Honey</span>
              </div>
            </article>
          </section>

          {/* EXPLAIN THE CALCULATION */}

          <section className="shop-stock-section">
            <div className="shop-stock-section-heading">
              <div>
                <p className="shop-stock-eyebrow">HOW STOCK IS CALCULATED</p>
                <h2>Understand Your Stock Balance</h2>
              </div>
            </div>

            <div className="shop-stock-calculation-note">
              <div className="shop-stock-calculation-icon">🧮</div>

              <div>
                <h3>Opening Stock − Shop Sales = Remaining Stock</h3>

                <p>
                  Enter the quantity currently available in the selected shop as
                  opening stock. Qualifying sales for that same branch reduce the
                  balance. Each shop is calculated independently.
                </p>

                <p>
                  <strong>Important:</strong> Opening stock is inventory, not a
                  sale or business income.
                </p>
              </div>
            </div>

            {productsWithNegativeBalance.length > 0 && (
              <div
                className="shop-stock-alert shop-stock-alert-error"
                role="alert"
              >
                <strong>Stock balance needs attention.</strong>{" "}
                {productsWithNegativeBalance.map(([productType], index) => (
                  <span key={productType}>
                    {index > 0 ? ", " : ""}
                    {PRODUCT_DETAILS[productType].name}
                  </span>
                ))}{" "}
                has sales greater than its recorded opening stock.
                Check the opening quantity and shop sales.
              </div>
            )}
          </section>

          {/* CURRENT SHOP BALANCES */}

          <section className="shop-stock-section">
            <div className="shop-stock-section-heading">
              <div>
                <p className="shop-stock-eyebrow">CURRENT BALANCES</p>
                <h2>Available Shop Stock</h2>
              </div>

              <span className="shop-stock-muted">
                Opening stock − shop sales
              </span>
            </div>

            <div className="shop-stock-product-grid">
              {Object.entries(PRODUCT_DETAILS).map(
                ([productType, product]) => {
                  const balance = productBalances[productType];
                  const isNegative = balance.remaining < 0;
                  const isOut = balance.remaining === 0;

                  return (
                    <article
                      className={`shop-stock-product-card ${
                        isNegative || isOut ? "shop-stock-product-low" : ""
                      }`}
                      key={productType}
                    >
                      <div className="shop-stock-product-image-wrap">
                        <img
                          src={product.image}
                          alt={product.name}
                          className="shop-stock-product-image"
                        />

                        <span
                          className={`shop-stock-stock-badge ${
                            isNegative || isOut
                              ? "shop-stock-stock-badge-low"
                              : "shop-stock-stock-badge-ok"
                          }`}
                        >
                          {isNegative
                            ? "Check balance"
                            : isOut
                              ? "No stock remaining"
                              : "Stock available"}
                        </span>
                      </div>

                      <div className="shop-stock-product-content">
                        <h3>{product.name}</h3>

                        <p className="shop-stock-product-description">
                          {product.description}
                        </p>

                        <div className="shop-stock-balance">
                          <strong>
                            {formatQuantity(balance.remaining)}
                          </strong>

                          <span>{product.unit} remaining</span>
                        </div>

                        <div className="shop-stock-product-breakdown">
                          <div>
                            <span>Opening stock</span>
                            <strong>
                              {formatQuantity(balance.opening)}{" "}
                              {product.shortUnit}
                            </strong>
                          </div>

                          <div>
                            <span>Shop sales</span>
                            <strong>
                              {formatQuantity(balance.sold)}{" "}
                              {product.shortUnit}
                            </strong>
                          </div>

                          <div className="shop-stock-calculation-result">
                            <span>Calculation</span>
                            <strong>
                              {formatQuantity(balance.opening)} −{" "}
                              {formatQuantity(balance.sold)} ={" "}
                              {formatQuantity(balance.remaining)}
                            </strong>
                          </div>
                        </div>

                        {isNegative && (
                          <p className="shop-stock-product-warning">
                            Recorded sales exceed the entered opening stock by{" "}
                            {formatQuantity(Math.abs(balance.remaining))}{" "}
                            {product.unit}. Please check the records.
                          </p>
                        )}

                        {balance.opening === 0 && balance.sold === 0 && (
                          <p className="shop-stock-product-hint">
                            No opening stock or qualifying shop sales have been
                            recorded for this product.
                          </p>
                        )}
                      </div>
                    </article>
                  );
                }
              )}
            </div>

            <p className="shop-stock-footnote">
              These figures use recorded opening stock minus qualifying shop sales.
              Palm Oil and Kuli-Kuli Oil are counted in litres;
              Honey is counted in bottles. Opening stock does not create
              a sale or increase recorded business income.
            </p>
          </section>

          {/* RECORD OPENING SHOP STOCK */}

          <section className="shop-stock-section">
            <div className="shop-stock-section-heading">
              <div>
                <p className="shop-stock-eyebrow">INITIAL INVENTORY</p>
                <h2>Record Shop Stock Entry</h2>
                <p className="shop-stock-muted">
                  Record the starting stock or additional stock purchased/received by this shop. Enter the quantity, date is recorded automatically, and cost when applicable.
                </p>
              </div>
            </div>

            <form
              className="shop-stock-sale-form"
              onSubmit={handleOpeningStockSubmit}
            >
              <div className="shop-stock-form-grid">
                <div className="shop-stock-form-group">
                  <label htmlFor="opening-stock-product">Product</label>

                  <select
                    id="opening-stock-product"
                    name="productType"
                    value={openingForm.productType}
                    onChange={handleOpeningFormChange}
                    required
                  >
                    <option value={PRODUCTS.PALM_OIL}>Palm Oil</option>
                    <option value={PRODUCTS.KULI_KULI}>Kuli-Kuli Oil</option>
                    <option value={PRODUCTS.HONEY}>Honey</option>
                  </select>
                </div>

                <div className="shop-stock-form-group">
                  <label htmlFor="opening-stock-unit">Unit</label>

                  <select
                    id="opening-stock-unit"
                    name="unit"
                    value={
                      openingForm.productType === PRODUCTS.HONEY
                        ? "bottles"
                        : openingForm.unit
                    }
                    onChange={handleOpeningFormChange}
                    disabled={
                      openingForm.productType === PRODUCTS.HONEY
                    }
                  >
                    {openingForm.productType === PRODUCTS.HONEY ? (
                      <option value="bottles">Bottles</option>
                    ) : (
                      <>
                        <option value="litres">Litres</option>
                        <option value="75cl">75cl bottles</option>
                        <option value="1L">1-litre bottles</option>
                        <option value="5L">5-litre jerrycans</option>
                      </>
                    )}
                  </select>
                </div>

                <div className="shop-stock-form-group">
                  <label htmlFor="opening-stock-quantity">
                    Opening Quantity
                  </label>

                  <input
                    id="opening-stock-quantity"
                    name="quantity"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={openingForm.quantity}
                    onChange={handleOpeningFormChange}
                    placeholder="Enter quantity added"
                    required
                  />

                  <span className="shop-stock-field-hint">
                    {openingForm.productType === PRODUCTS.HONEY
                      ? "Enter the number of honey bottles."
                      : openingForm.unit === "75cl"
                        ? "Each 75cl bottle adds 0.75 litres."
                        : openingForm.unit === "5L"
                          ? "Each keg adds 5 litres."
                          : "Enter the total number of litres."}
                  </span>
                </div>

                <div className="shop-stock-form-group">
                  <label htmlFor="opening-stock-cost">Purchase / Stock Cost (₦)</label>
                  <input
                    id="opening-stock-cost"
                    name="cost"
                    type="number"
                    min="0"
                    step="0.01"
                    value={openingForm.cost}
                    onChange={handleOpeningFormChange}
                    placeholder="Enter amount paid (if applicable)"
                  />
                  <span className="shop-stock-field-hint">
                    Record the amount paid for this stock entry. Leave blank if it was not a purchase.
                  </span>
                </div>

                <div className="shop-stock-form-group shop-stock-form-full">
                  <label htmlFor="opening-stock-notes">
                    Notes (optional)
                  </label>

                  <textarea
                    id="opening-stock-notes"
                    name="notes"
                    value={openingForm.notes}
                    onChange={handleOpeningFormChange}
                    placeholder="For example, stock counted when shop tracking began"
                    rows="3"
                  />
                </div>
              </div>

              <div className="shop-stock-sale-preview">
                <div>
                  <span>Current recorded balance</span>

                  <strong>
                    {formatQuantity(
                      productBalances[openingForm.productType].remaining
                    )}{" "}
                    {PRODUCT_DETAILS[openingForm.productType].unit}
                  </strong>
                </div>

                <div>
                  <span>Quantity being recorded</span>

                  <strong>
                    {formatQuantity(getOpeningQuantityToAdd())}{" "}
                    {PRODUCT_DETAILS[openingForm.productType].unit}
                  </strong>
                </div>

                <div>
                  <span>Balance after this entry</span>

                  <strong>
                    {formatQuantity(
                      productBalances[openingForm.productType].remaining +
                      getOpeningQuantityToAdd()
                    )}{" "}
                    {PRODUCT_DETAILS[openingForm.productType].unit}
                  </strong>
                </div>
              </div>

              <p className="shop-stock-footnote">
                This entry adds to the selected product's recorded opening
                stock. It is saved separately and will not appear as a sale
                or business income.
              </p>

              {openingMessage && (
                <div
                  className="shop-stock-alert shop-stock-alert-success"
                  role="status"
                >
                  {openingMessage}
                </div>
              )}

              {openingError && (
                <div
                  className="shop-stock-alert shop-stock-alert-error"
                  role="alert"
                >
                  {openingError}
                </div>
              )}

              <button
                className="shop-stock-submit-button"
                type="submit"
                disabled={savingOpeningStock}
              >
                {savingOpeningStock
                  ? "Saving Opening Stock..."
                  : "Record Shop Stock"}
              </button>
            </form>
          </section>

          {/* SHOP STOCK HISTORY */}

          <section className="shop-stock-section">
            <div className="shop-stock-section-heading">
              <div>
                <p className="shop-stock-eyebrow">ACTIVITY LOG</p>
                <h2>Shop Stock History</h2>
              </div>

              <span className="shop-stock-muted">
                {filteredTransactions.length}{" "}
                {filteredTransactions.length === 1 ? "record" : "records"}
              </span>
            </div>

            <div className="shop-stock-filters">
              <div className="shop-stock-form-group">
                <label htmlFor="shop-stock-search">Search history</label>

                <input
                  id="shop-stock-search"
                  type="search"
                  value={searchTerm}
                  onChange={(event) => {
                    setSearchTerm(event.target.value);
                    setShowAllTransactions(false);
                  }}
                  placeholder="Search product, customer or notes"
                />
              </div>

              <div className="shop-stock-form-group">
                <label htmlFor="shop-stock-product-filter">Product</label>

                <select
                  id="shop-stock-product-filter"
                  value={selectedProduct}
                  onChange={(event) => {
                    setSelectedProduct(event.target.value);
                    setShowAllTransactions(false);
                  }}
                >
                  <option value="all">All products</option>
                  <option value={PRODUCTS.PALM_OIL}>Palm Oil</option>
                  <option value={PRODUCTS.KULI_KULI}>Kuli-Kuli Oil</option>
                  <option value={PRODUCTS.HONEY}>Honey</option>
                </select>
              </div>

              <div className="shop-stock-form-group">
                <label htmlFor="shop-stock-date-filter">Date</label>

                <select
                  id="shop-stock-date-filter"
                  value={dateFilter}
                  onChange={(event) => {
                    setDateFilter(event.target.value);
                    setShowAllTransactions(false);
                  }}
                >
                  <option value="all">All dates</option>
                  <option value="today">Today</option>
                </select>
              </div>
            </div>

            {filteredTransactions.length === 0 ? (
              <div className="shop-stock-empty">
                <span className="shop-stock-empty-icon">📋</span>

                <h3>No shop stock records found</h3>

                <p>
                  Opening stock entries and qualifying sales will appear here
                  when they are recorded.
                </p>
              </div>
            ) : (
              <>
                <div className="shop-stock-table-wrap">
                  <table className="shop-stock-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Transaction</th>
                        <th>Product</th>
                        <th>Quantity</th>
                        <th>Customer / Source</th>
                        <th>Notes</th>
                      </tr>
                    </thead>

                    <tbody>
                      {visibleTransactions.map((transaction) => {
                        const product =
                          PRODUCT_DETAILS[transaction.productType];

                        const isIncoming = transaction.type === "opening";
                        const transactionLabel = transaction.type === "opening"
                          ? "Opening stock"
                          : "Shop sale";

                        return (
                          <tr key={transaction.id}>
                            <td>{formatDate(transaction.date)}</td>

                            <td>
                              <span
                                className={`shop-stock-transaction-badge ${
                                  isIncoming
                                    ? "shop-stock-opening-badge"
                                    : "shop-stock-sale-badge"
                                }`}
                              >
                                {transactionLabel}
                              </span>
                            </td>

                            <td>{product?.name || "Unknown product"}</td>

                            <td>
                              <strong
                                className={
                                  isIncoming
                                    ? "shop-stock-quantity-in"
                                    : "shop-stock-quantity-out"
                                }
                              >
                                {isIncoming ? "+" : "−"}
                                {formatQuantity(transaction.quantity)}{" "}
                                {product?.unit || ""}
                              </strong>
                            </td>

                            <td>{transaction.customer}</td>

                            <td>{transaction.notes || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {filteredTransactions.length > 3 && (
                  <div className="shop-stock-history-controls">
                    <span className="shop-stock-history-count">
                      Showing {visibleTransactions.length} of{" "}
                      {filteredTransactions.length} records
                    </span>

                    <button
                      type="button"
                      className="shop-stock-history-toggle"
                      onClick={() =>
                        setShowAllTransactions((previous) => !previous)
                      }
                      aria-expanded={showAllTransactions}
                      aria-label={
                        showAllTransactions
                          ? "Show fewer shop stock records"
                          : "Show all shop stock records"
                      }
                    >
                      <span>
                        {showAllTransactions
                          ? "Show less"
                          : "Show all records"}
                      </span>

                      <span
                        className={`shop-stock-history-arrow ${
                          showAllTransactions ? "is-expanded" : ""
                        }`}
                        aria-hidden="true"
                      >
                        ▼
                      </span>
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}

      <footer className="shop-stock-footer">
        © 2026 Afubia Farms • Palm Oil Sales System
      </footer>
    </main>
  );
}
