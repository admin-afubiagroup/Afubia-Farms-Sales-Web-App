import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  collection,
  doc,
  onSnapshot,
} from "firebase/firestore";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

import oilContainers from "../assets/oil_containers.jpg";
import oilTurning from "../assets/palm_oil_turning.jpg";

import ResponsiveLayout from "../components/ResponsiveLayout";
import { db } from "../Firebase/firebase.utils";

import "./Reports.css";

/* =========================================================
   CONSTANTS
========================================================= */

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
  const data = record?.rawData || record || {};
  const id = normalizeBranchId(
    data.branchId || data.branch || data.branchName || data.shopName
  );
  // Records without a confirmed shop stay in the review queue and are not
  // included in All Shops totals until an administrator resolves them.
  if (branchFilter === "all") return Boolean(id);
  return id === branchFilter;
}

const COLLECTIONS = {
  sales: "sales",
  conversions: "conversions",
  settings: "settings",
};

const REPORT_FILTERS = {
  TODAY: "today",
  WEEK: "week",
  SEVEN_DAYS: "7days",
  MONTH: "month",
  YEAR: "year",
  ALL: "all",
};

const CHART_COLORS = [
  "#0f7a4a",
  "#1e4e8c",
  "#d69e2e",
  "#2f8f83",
  "#075e42",
  "#426b98",
  "#6b8e23",
];

/* =========================================================
   NUMBER HELPERS
========================================================= */

const toNumber = (value) => {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const cleaned = value
      .replace(/[₦,\s]/g, "")
      .trim();

    if (!cleaned) {
      return 0;
    }

    const number = Number(cleaned);

    return Number.isFinite(number) ? number : 0;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
};

const firstPositiveNumber = (...values) => {
  for (const value of values) {
    const number = toNumber(value);

    if (number > 0) {
      return number;
    }
  }

  return 0;
};

const formatNumber = (
  value,
  maximumFractionDigits = 2
) => {
  return new Intl.NumberFormat("en-NG", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(toNumber(value));
};

const formatNaira = (value) => {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNumber(value));
};

/* =========================================================
   STRING HELPERS
========================================================= */

const normalizeText = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const containsAny = (text, values) =>
  values.some((value) =>
    text.includes(value)
  );

/* =========================================================
   FIRESTORE DATE HELPERS
========================================================= */

const timestampToDate = (value) => {
  if (!value) {
    return null;
  }

  if (
    typeof value.toDate === "function"
  ) {
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
    typeof value.seconds === "number"
  ) {
    const milliseconds =
      value.seconds * 1000 +
      Math.floor(
        (value.nanoseconds || 0) / 1000000
      );

    const date = new Date(milliseconds);

    return Number.isNaN(date.getTime())
      ? null
      : date;
  }

  if (typeof value === "number") {
    const date = new Date(value);

    return Number.isNaN(date.getTime())
      ? null
      : date;
  }

  return null;
};

/* =========================================================
   STRING DATE PARSER
========================================================= */

const parseDateString = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  if (!text) {
    return null;
  }

  /*
    YYYY-MM-DD
    YYYY-MM-DD HH:mm:ss
    YYYY-MM-DDTHH:mm:ss
  */

  const isoMatch = text.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T,\s]+(.+))?$/
  );

  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const time = isoMatch[4] || "00:00:00";

    const date = new Date(
      `${year}-${String(month).padStart(
        2,
        "0"
      )}-${String(day).padStart(
        2,
        "0"
      )}T${time}`
    );

    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  /*
    DD/MM/YYYY
    DD-MM-YYYY
    DD/MM/YYYY HH:mm:ss
  */

  const dmyMatch = text.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[,\s]+(.+))?$/
  );

  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]);
    const year = Number(dmyMatch[3]);
    const time = dmyMatch[4] || "00:00:00";

    const date = new Date(
      `${year}-${String(month).padStart(
        2,
        "0"
      )}-${String(day).padStart(
        2,
        "0"
      )}T${time}`
    );

    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  const nativeDate = new Date(text);

  if (!Number.isNaN(nativeDate.getTime())) {
    return nativeDate;
  }

  return null;
};

/* =========================================================
   RECORD DATE
========================================================= */

const getRecordDate = (record) => {
  if (!record) {
    return null;
  }

  const recordDate =
    record.recordDate ??
    record.record_date ??
    record.dateOfRecord ??
    record.date_of_record;

  const recordTime =
    record.recordTime ??
    record.record_time ??
    record.salesTime ??
    record.saleTime;

  /*
    Current Afubia Farms format:
      recordDate = "2026-09-28"
      recordTime = "12:30:00"
  */

  if (recordDate) {
    const timestampDate =
      timestampToDate(recordDate);

    if (timestampDate) {
      return timestampDate;
    }

    if (
      recordTime &&
      typeof recordDate === "string"
    ) {
      const combined =
        `${recordDate} ${recordTime}`;

      const parsed =
        parseDateString(combined);

      if (parsed) {
        return parsed;
      }
    }

    if (
      typeof recordDate === "string"
    ) {
      const parsed =
        parseDateString(recordDate);

      if (parsed) {
        return parsed;
      }
    }
  }

  const possibleDates = [
    record.dateTime,
    record.datetime,
    record.recordedAt,
    record.soldAt,
    record.createdAt,
    record.timestamp,
    record.createdAtClient,
    record.Sales_Date,
    record.salesDate,
    record.saleDate,
    record.date,
  ];

  for (const value of possibleDates) {
    const timestampDate =
      timestampToDate(value);

    if (timestampDate) {
      return timestampDate;
    }

    if (typeof value === "string") {
      const parsed =
        parseDateString(value);

      if (parsed) {
        return parsed;
      }
    }
  }

  return null;
};

/* =========================================================
   DATE KEY
========================================================= */

const getDateKey = (date) => {
  if (!date) {
    return null;
  }

  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          NIGERIA_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }
    ).formatToParts(date);

  const values = {};

  parts.forEach((part) => {
    if (part.type !== "literal") {
      values[part.type] =
        part.value;
    }
  });

  if (
    !values.year ||
    !values.month ||
    !values.day
  ) {
    return null;
  }

  return `${values.year}-${values.month}-${values.day}`;
};

/* =========================================================
   RECORD DATE KEY
========================================================= */

const getRecordDateKey = (record) => {
  if (!record) {
    return null;
  }

  const storedDate =
    record.recordDate ??
    record.record_date ??
    record.dateOfRecord ??
    record.date_of_record;

  /*
    businessFirestore stores recordDate as
    YYYY-MM-DD in Africa/Lagos.
  */

  if (
    typeof storedDate === "string"
  ) {
    const cleanDate =
      storedDate.trim();

    const match =
      cleanDate.match(
        /^(\d{4})-(\d{1,2})-(\d{1,2})$/
      );

    if (match) {
      const year = Number(
        match[1]
      );

      const month = Number(
        match[2]
      );

      const day = Number(
        match[3]
      );

      const checkDate = new Date(
        Date.UTC(
          year,
          month - 1,
          day
        )
      );

      if (
        checkDate.getUTCFullYear() ===
          year &&
        checkDate.getUTCMonth() ===
          month - 1 &&
        checkDate.getUTCDate() ===
          day
      ) {
        return `${year}-${String(
          month
        ).padStart(
          2,
          "0"
        )}-${String(day).padStart(
          2,
          "0"
        )}`;
      }
    }
  }

  const date =
    record.date ||
    getRecordDate(record);

  return getDateKey(date);
};

/* =========================================================
   DATE FORMATTERS
========================================================= */

const formatDate = (date) => {
  if (!date) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat(
    "en-NG",
    {
      dateStyle: "medium",
      timeZone:
        NIGERIA_TIME_ZONE,
    }
  ).format(date);
};

const formatDateTime = (date) => {
  if (!date) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat(
    "en-NG",
    {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone:
        NIGERIA_TIME_ZONE,
    }
  ).format(date);
};

const formatShortDate = (
  dateKey
) => {
  if (!dateKey) {
    return "";
  }

  const [
    year,
    month,
    day,
  ] = dateKey
    .split("-")
    .map(Number);

  const date = new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      12,
      0,
      0
    )
  );

  return new Intl.DateTimeFormat(
    "en-NG",
    {
      day: "2-digit",
      month: "short",
      timeZone: "UTC",
    }
  ).format(date);
};

const dateKeyToNumber = (
  dateKey
) => {
  if (!dateKey) {
    return 0;
  }

  return Number(
    dateKey.replaceAll("-", "")
  );
};

/* =========================================================
   CURRENT NIGERIA DATE
========================================================= */

const getCurrentNigeriaDateKey =
  () => getDateKey(new Date());

/* =========================================================
   FILTER HELPERS
========================================================= */

const getFilterStartDateKey = (
  filter
) => {
  const todayKey =
    getCurrentNigeriaDateKey();

  if (!todayKey) {
    return null;
  }

  if (
    filter ===
    REPORT_FILTERS.ALL
  ) {
    return null;
  }

  if (
    filter ===
    REPORT_FILTERS.TODAY
  ) {
    return todayKey;
  }

  const [
    year,
    month,
    day,
  ] = todayKey
    .split("-")
    .map(Number);

  if (filter === REPORT_FILTERS.WEEK) {
    const date = new Date(Date.UTC(year, month - 1, day));
    const daysSinceMonday = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - daysSinceMonday);
    return [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, "0"),
      String(date.getUTCDate()).padStart(2, "0"),
    ].join("-");
  }

  if (
    filter ===
    REPORT_FILTERS.SEVEN_DAYS
  ) {
    const date = new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );

    date.setUTCDate(
      date.getUTCDate() - 6
    );

    return [
      date.getUTCFullYear(),
      String(
        date.getUTCMonth() + 1
      ).padStart(2, "0"),
      String(
        date.getUTCDate()
      ).padStart(2, "0"),
    ].join("-");
  }

  if (
    filter ===
    REPORT_FILTERS.MONTH
  ) {
    return `${year}-${String(
      month
    ).padStart(
      2,
      "0"
    )}-01`;
  }

  if (
    filter ===
    REPORT_FILTERS.YEAR
  ) {
    return `${year}-01-01`;
  }

  return null;
};

const isDateKeyInFilter = (
  recordDateKey,
  filter
) => {
  if (!recordDateKey) {
    return false;
  }

  if (
    filter ===
    REPORT_FILTERS.ALL
  ) {
    return true;
  }

  const startDateKey =
    getFilterStartDateKey(
      filter
    );

  const todayKey =
    getCurrentNigeriaDateKey();

  if (
    !startDateKey ||
    !todayKey
  ) {
    return false;
  }

  const recordNumber =
    dateKeyToNumber(
      recordDateKey
    );

  const startNumber =
    dateKeyToNumber(
      startDateKey
    );

  const todayNumber =
    dateKeyToNumber(
      todayKey
    );

  return (
    recordNumber >=
      startNumber &&
    recordNumber <=
      todayNumber
  );
};

/* =========================================================
   PRODUCT HELPERS
========================================================= */

const getSaleProductName = (
  data
) => {
  return (
    data?.productName ||
    data?.Product_Name ||
    data?.product ||
    data?.name ||
    "Unknown Product"
  );
};

const getSaleProductCategory = (
  data
) => {
  return (
    data?.productCategory ||
    data?.category ||
    data?.Category ||
    data?.product_category ||
    ""
  );
};

const getSaleProductType = (
  data
) => {
  return (
    data?.productType ||
    data?.Product_Type ||
    data?.product_type ||
    data?.size ||
    ""
  );
};

const getSaleProductText = (
  data
) => {
  return normalizeText(
    [
      getSaleProductName(data),
      getSaleProductCategory(data),
      getSaleProductType(data),
      data?.unit,
      data?.stockUnit,
    ].join(" ")
  );
};

/* =========================================================
   PRODUCT CATEGORY DETECTION
========================================================= */

const isHoneySale = (
  data
) => {
  const text =
    getSaleProductText(data);

  return (
    text.includes("honey")
  );
};

const isKuliKuliSale = (
  data
) => {
  const text =
    getSaleProductText(data);

  return (
    text.includes("kuli") ||
    text.includes("kulikuli")
  );
};

const isPalmOilSale = (
  data
) => {
  if (isHoneySale(data)) {
    return false;
  }

  if (isKuliKuliSale(data)) {
    return false;
  }

  const category =
    normalizeText(
      getSaleProductCategory(data)
    );

  const productType =
    normalizeText(
      getSaleProductType(data)
    );

  const name =
    normalizeText(
      getSaleProductName(data)
    );

  if (
    category === "palm oil" ||
    category.includes("palm oil")
  ) {
    return true;
  }

  if (
    name.includes("palm oil")
  ) {
    return true;
  }

  /*
    Legacy records may only contain
    productType such as 75cl, 1L, 5L
    without a category.
  */

  if (
    containsAny(
      productType,
      [
        "75cl",
        "1l",
        "5l",
        "30l",
        "keg",
      ]
    ) &&
    !name.includes("honey")
  ) {
    return true;
  }

  return false;
};

const isOilSale = (
  data
) => {
  if (data?.affectsOilStock === false) {
    return false;
  }

  if (isHoneySale(data)) {
    return false;
  }

  if (
    data?.affectsOilStock === true
  ) {
    return true;
  }

  return (
    isPalmOilSale(data) ||
    isKuliKuliSale(data)
  );
};

/* =========================================================
   VOLUME DETECTION
========================================================= */

const inferVolumePerUnitLitres = (
  data
) => {
  /*
    Prefer explicit saved values.
  */

  const explicitVolume =
    firstPositiveNumber(
      data?.volumePerUnitLitres,
      data?.volume_per_unit_litres,
      data?.productVolumeLitres,
      data?.product_volume_litres,
      data?.containerVolumeLitres,
      data?.container_volume_litres,
      data?.bottleSizeLitres,
      data?.bottle_size_litres
    );

  if (explicitVolume > 0) {
    return explicitVolume;
  }

  /*
    Keg sales may have an editable
    actual volume.
  */

  const actualKegVolume =
    firstPositiveNumber(
      data?.kegVolumeLitres,
      data?.keg_volume_litres,
      data?.actualKegVolumeLitres,
      data?.actual_keg_volume_litres
    );

  if (
    actualKegVolume > 0
  ) {
    return actualKegVolume;
  }

  const text =
    getSaleProductText(data);

  if (
    text.includes("75cl") ||
    text.includes("0.75")
  ) {
    return 0.75;
  }

  if (
    text.includes("5l") ||
    text.includes("5 l") ||
    text.includes("5 litre") ||
    text.includes("5 litres") ||
    text.includes("jerrycan")
  ) {
    return 5;
  }

  if (
    text.includes("1l") ||
    text.includes("1 l") ||
    text.includes("1 litre") ||
    text.includes("1 litres")
  ) {
    return 1;
  }

  if (
    text.includes("keg") ||
    text.includes("30l") ||
    text.includes("30 l")
  ) {
    return 30;
  }

  return 0;
};

/* =========================================================
   QUANTITY
========================================================= */

const getSaleQuantity = (
  data
) => {
  return firstPositiveNumber(
    data?.quantity,
    data?.QuantitySold,
    data?.quantitySold,
    data?.quantity_sold,
    data?.unitsSold,
    data?.units
  );
};

/* =========================================================
   OIL LITRES SOLD
========================================================= */

const getOilLitresSold = (
  data
) => {
  /*
    Honey is never oil stock.
  */

  if (isHoneySale(data)) {
    return 0;
  }

  /*
    Explicitly saved stock flag wins.
  */

  if (
    data?.affectsOilStock === false
  ) {
    return 0;
  }

  /*
    New SalesForm/businessFirestore records
    should save oilLitresSold.
  */

  const explicitOilLitres =
    firstPositiveNumber(
      data?.oilLitresSold,
      data?.oil_litres_sold,
      data?.oilStockLitres,
      data?.oil_stock_litres
    );

  if (
    explicitOilLitres > 0
  ) {
    return explicitOilLitres;
  }

  /*
    Existing records may only contain litresSold.
    Only use that for products that are actually oil.
  */

  if (isOilSale(data)) {
    const explicitLitres =
      firstPositiveNumber(
        data?.litresSold,
        data?.litres_sold,
        data?.totalLitresSold,
        data?.total_litres_sold
      );

    if (
      explicitLitres > 0
    ) {
      return explicitLitres;
    }

    const quantity =
      getSaleQuantity(data);

    const volume =
      inferVolumePerUnitLitres(
        data
      );

    return quantity * volume;
  }

  return 0;
};

/* =========================================================
   TRANSACTION STATUS GUARD
========================================================= */

const isExcludedTransactionData = (data) => {
  const status = String(
    data?.status ?? data?.saleStatus ?? data?.recordStatus ?? ""
  ).trim().toLowerCase().replace(/[\s-]+/g, "_");

  return [
    "cancelled", "canceled", "void", "deleted", "rejected",
    "pending", "draft", "failed", "processing", "unpaid",
  ].includes(status);
};

/* =========================================================
   NORMALIZE SALE
========================================================= */

const normalizeSale = (
  documentSnapshot
) => {
  const data =
    documentSnapshot.data();

  const date =
    getRecordDate(data);

  const dateKey =
    getRecordDateKey(data);

  const quantity =
    getSaleQuantity(data);

  const volumePerUnitLitres =
    inferVolumePerUnitLitres(
      data
    );

  const oilLitresSold =
    getOilLitresSold(data);

  const totalLitresSold =
    firstPositiveNumber(
      data?.litresSold,
      data?.litres_sold,
      data?.totalLitresSold,
      data?.total_litres_sold
    );

  /*
    For oil reports, use oilLitresSold.

    For Honey, litresSold can still be retained
    as packaging/product volume, but it must not
    enter the oil-stock calculation.
  */

  const productLitres =
    totalLitresSold > 0
      ? totalLitresSold
      : quantity *
        volumePerUnitLitres;

  const unitPrice =
    firstPositiveNumber(
      data?.sellingPrice,
      data?.selling_price,
      data?.unitPrice,
      data?.unit_price,
      data?.price
    );

  const explicitTotal =
    firstPositiveNumber(
      data?.totalAmount,
      data?.total_amount,
      data?.total,
      data?.amount,
      data?.saleAmount,
      data?.sale_amount,
      data?.revenue
    );

  const totalAmount =
    explicitTotal > 0
      ? explicitTotal
      : unitPrice * quantity;

  const honey =
    isHoneySale(data);

  const kuliKuli =
    isKuliKuliSale(data);

  const palmOil =
    isPalmOilSale(data);

  let productCategory =
    getSaleProductCategory(data);

  if (!productCategory) {
    if (honey) {
      productCategory = "Honey";
    } else if (kuliKuli) {
      productCategory = "Kuli-Kuli Oil";
    } else if (palmOil) {
      productCategory = "Palm Oil";
    } else {
      productCategory = "Other";
    }
  }

  return {
    id: documentSnapshot.id,

    type: "sale",

    rawData: data,

    date,

    dateKey,

    productName:
      getSaleProductName(data),

    productType:
      getSaleProductType(data) ||
      "Unknown",

    productCategory,

    quantity,

    volumePerUnitLitres,

    /*
      Product volume is useful for sales reporting.
    */
    litresSold: productLitres,

    /*
      This is the value that affects oil stock.
    */
    oilLitresSold,

    unitPrice,

    totalAmount,

    isHoney: honey,

    isKuliKuliOil: kuliKuli,

    isPalmOil: palmOil,

    affectsOilStock:
      isOilSale(data),

    affectsContainerStock:
      data?.affectsContainerStock !== false,

    userEmail:
      data?.userEmail ||
      data?.user_email ||
      data?.email ||
      "",
  };
};

/* =========================================================
   CONVERSION NORMALIZATION
========================================================= */

const normalizeConversion = (
  documentSnapshot
) => {
  const data =
    documentSnapshot.data();

  const date =
    getRecordDate(data);

  const dateKey =
    getRecordDateKey(data);

  const kegCount =
    firstPositiveNumber(
      data?.kegCount,
      data?.kegs,
      data?.keg_count
    );

  const bottles75cl =
    firstPositiveNumber(
      data?.bottles75cl,
      data?.bottles75Cl,
      data?.bottles_75cl,
      data?.bottles075cl
    );

  const bottles1L =
    firstPositiveNumber(
      data?.bottles1L,
      data?.bottles1l,
      data?.bottles_1l
    );

  const jerrycans5L =
    firstPositiveNumber(
      data?.jerrycans5L,
      data?.jerrycans5l,
      data?.jerrycans_5l
    );

  /*
    Prefer explicit litresProduced.

    Legacy records fall back to:
    kegCount × 30L.
  */

  const litresProduced =
    firstPositiveNumber(
      data?.litresProduced,
      data?.litres_produced,
      data?.totalLitres,
      data?.total_litres,
      data?.litres,
      kegCount * 30
    );

  /*
    Packaging volume.
  */

  const calculatedLitresUsed =
    bottles75cl * 0.75 +
    bottles1L +
    jerrycans5L * 5;

  const explicitLitresUsed =
    firstPositiveNumber(
      data?.litresUsed,
      data?.litres_used,
      data?.oilUsedLitres,
      data?.oil_used_litres
    );

  const litresUsed =
    explicitLitresUsed > 0
      ? explicitLitresUsed
      : calculatedLitresUsed;

  const explicitRemaining =
    data?.litresRemaining ??
    data?.litres_remaining ??
    data?.oilRemainingLitres ??
    data?.oil_remaining_litres;

  const litresRemaining =
    explicitRemaining !==
      undefined &&
    explicitRemaining !== null
      ? Math.max(
          toNumber(
            explicitRemaining
          ),
          0
        )
      : Math.max(
          litresProduced -
            litresUsed,
          0
        );

  return {
    id: documentSnapshot.id,

    type: "conversion",

    rawData: data,

    date,

    dateKey,

    kegCount,

    litresProduced,

    bottles75cl,

    bottles1L,

    jerrycans5L,

    litresFrom75cl:
      toNumber(
        data?.litresFrom75cl ??
          data?.litres_from_75cl ??
          bottles75cl * 0.75
      ),

    litresFrom1L:
      toNumber(
        data?.litresFrom1L ??
          data?.litres_from_1l ??
          bottles1L
      ),

    litresFrom5L:
      toNumber(
        data?.litresFrom5L ??
          data?.litres_from_5l ??
          jerrycans5L * 5
      ),

    litresUsed,

    litresRemaining,

    userEmail:
      data?.userEmail ||
      data?.user_email ||
      data?.email ||
      "",
  };
};

/* =========================================================
   COMPONENT
========================================================= */

const Reports = () => {
  const [sales, setSales] =
    useState([]);

  const [conversions, setConversions] =
    useState([]);

  const [
    openingStockLitres,
    setOpeningStockLitres,
  ] = useState(0);

  const [
    isLoading,
    setIsLoading,
  ] = useState(true);

  const [
    salesError,
    setSalesError,
  ] = useState("");

  const [
    conversionError,
    setConversionError,
  ] = useState("");

  const [
    settingsError,
    setSettingsError,
  ] = useState("");

  const [
    filter,
    setFilter,
  ] = useState(
    REPORT_FILTERS.WEEK
  );

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
      // The report remains usable when local storage is unavailable.
    }
  }, [branchFilter]);

  const [
    lastUpdated,
    setLastUpdated,
  ] = useState(null);

  const [
    currentTime,
    setCurrentTime,
  ] = useState(
    new Date()
  );

  const [
    exporting,
    setExporting,
  ] = useState(false);

  const [
    showAllDailyReports,
    setShowAllDailyReports,
  ] = useState(false);

  const [
    showAllProducts,
    setShowAllProducts,
  ] = useState(false);

  /* =========================================================
     LIVE CLOCK
  ========================================================= */

  useEffect(() => {
    const interval =
      setInterval(() => {
        setCurrentTime(
          new Date()
        );
      }, 60000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  /* =========================================================
     REAL-TIME FIRESTORE
  ========================================================= */

  useEffect(() => {
    let mounted = true;

    let salesReady = false;
    let conversionsReady = false;
    let settingsReady = false;

    const finishLoading = () => {
      if (
        mounted &&
        salesReady &&
        conversionsReady &&
        settingsReady
      ) {
        setIsLoading(false);
      }
    };

    const updateLastUpdated =
      () => {
        if (mounted) {
          setLastUpdated(
            new Date()
          );
        }
      };

    /*
      SALES
    */

    const unsubscribeSales =
      onSnapshot(
        collection(
          db,
          COLLECTIONS.sales
        ),
        (snapshot) => {
          if (!mounted) {
            return;
          }

          const records =
            snapshot.docs
              .filter((documentSnapshot) =>
                !isExcludedTransactionData(documentSnapshot.data())
              )
              .map(
                normalizeSale
              )
              .filter(
                (record) =>
                  record.dateKey
              )
              .sort(
                (a, b) =>
                  b.dateKey.localeCompare(
                    a.dateKey
                  ) ||
                  (
                    b.date?.getTime?.() ||
                    0
                  ) -
                    (
                      a.date?.getTime?.() ||
                      0
                    )
              );

          setSales(records);

          setSalesError("");

          updateLastUpdated();

          salesReady = true;

          finishLoading();
        },
        (error) => {
          console.error(
            "Reports sales listener error:",
            error
          );

          if (!mounted) {
            return;
          }

          setSalesError(
            error?.message ||
              "Unable to load sales."
          );

          salesReady = true;

          finishLoading();
        }
      );

    /*
      CONVERSIONS
    */

    const unsubscribeConversions =
      onSnapshot(
        collection(
          db,
          COLLECTIONS.conversions
        ),
        (snapshot) => {
          if (!mounted) {
            return;
          }

          const records =
            snapshot.docs
              .filter((documentSnapshot) =>
                !isExcludedTransactionData(documentSnapshot.data())
              )
              .map(
                normalizeConversion
              )
              .filter(
                (record) =>
                  record.dateKey
              )
              .sort(
                (a, b) =>
                  b.dateKey.localeCompare(
                    a.dateKey
                  ) ||
                  (
                    b.date?.getTime?.() ||
                    0
                  ) -
                    (
                      a.date?.getTime?.() ||
                      0
                    )
              );

          setConversions(records);

          setConversionError("");

          updateLastUpdated();

          conversionsReady = true;

          finishLoading();
        },
        (error) => {
          console.error(
            "Reports conversion listener error:",
            error
          );

          if (!mounted) {
            return;
          }

          setConversionError(
            error?.message ||
              "Unable to load oil turning records."
          );

          conversionsReady = true;

          finishLoading();
        }
      );

    /*
      BUSINESS SETTINGS

      Supports:
      settings/business
      and legacy/direct settings documents.
    */

    const unsubscribeSettings =
      onSnapshot(
        doc(
          db,
          COLLECTIONS.settings,
          "business"
        ),
        (snapshot) => {
          if (!mounted) {
            return;
          }

          if (snapshot.exists()) {
            const data =
              snapshot.data();

            const stock =
              firstPositiveNumber(
                data?.openingStockLitres,
                data?.opening_stock_litres,
                data?.openingStock,
                data?.opening_stock
              );

            setOpeningStockLitres(
              stock
            );
          }

          setSettingsError("");

          settingsReady = true;

          updateLastUpdated();

          finishLoading();
        },
        (error) => {
          console.warn(
            "Business settings listener warning:",
            error
          );

          if (!mounted) {
            return;
          }

          /*
            Settings are optional for older
            installations. Do not prevent the
            entire report from loading.
          */

          setOpeningStockLitres(0);

          setSettingsError(
            error?.message || ""
          );

          settingsReady = true;

          finishLoading();
        }
      );

    /*
      Safety timeout.
    */

    const loadingTimeout =
      setTimeout(() => {
        if (mounted) {
          setIsLoading(false);
        }
      }, 8000);

    return () => {
      mounted = false;

      unsubscribeSales();
      unsubscribeConversions();
      unsubscribeSettings();

      clearTimeout(
        loadingTimeout
      );
    };
  }, []);

  /* =========================================================
     FILTERED SALES
  ========================================================= */

  const filteredSales =
    useMemo(() => {
      return sales.filter(
        (sale) =>
          matchesBranch(sale, branchFilter) &&
          isDateKeyInFilter(
            sale.dateKey,
            filter
          )
      );
    }, [
      sales,
      filter,
      branchFilter,
    ]);

  /* =========================================================
     FILTERED CONVERSIONS
  ========================================================= */

  const filteredConversions =
    useMemo(() => {
      return conversions.filter(
        (conversion) =>
          matchesBranch(conversion, branchFilter) &&
          isDateKeyInFilter(
            conversion.dateKey,
            filter
          )
      );
    }, [
      conversions,
      filter,
      branchFilter,
    ]);

  /* =========================================================
     KPI CALCULATIONS
  ========================================================= */

  const kpis =
    useMemo(() => {
      /*
        Revenue includes every product sold:
        Palm Oil + Kuli-Kuli Oil + Honey.
      */

      const revenue =
        filteredSales.reduce(
          (sum, sale) =>
            sum +
            toNumber(
              sale.totalAmount
            ),
          0
        );

      /*
        Product litres include Honey and other
        products where volume exists.
      */

      const litresSold =
        filteredSales.reduce(
          (sum, sale) =>
            sum +
            toNumber(
              sale.litresSold
            ),
          0
        );

      /*
        Oil litres are ONLY the litres that
        actually affect oil stock.
      */

      const oilLitresSold =
        filteredSales.reduce(
          (sum, sale) =>
            sum +
            toNumber(
              sale.oilLitresSold
            ),
          0
        );

      const palmOilLitresSold =
        filteredSales
          .filter(
            (sale) =>
              sale.isPalmOil
          )
          .reduce(
            (sum, sale) =>
              sum +
              toNumber(
                sale.oilLitresSold
              ),
            0
          );

      const kuliKuliLitresSold =
        filteredSales
          .filter(
            (sale) =>
              sale.isKuliKuliOil
          )
          .reduce(
            (sum, sale) =>
              sum +
              toNumber(
                sale.oilLitresSold
              ),
            0
          );

      const honeyLitresSold =
        filteredSales
          .filter(
            (sale) =>
              sale.isHoney
          )
          .reduce(
            (sum, sale) =>
              sum +
              toNumber(
                sale.litresSold
              ),
            0
          );

      const unitsSold =
        filteredSales.reduce(
          (sum, sale) =>
            sum +
            toNumber(
              sale.quantity
            ),
          0
        );

      const litresProduced =
        filteredConversions.reduce(
          (sum, conversion) =>
            sum +
            toNumber(
              conversion.litresProduced
            ),
          0
        );

      const litresPackaged =
        filteredConversions.reduce(
          (sum, conversion) =>
            sum +
            toNumber(
              conversion.litresUsed
            ),
          0
        );

      const conversionCount =
        filteredConversions.length;

      const salesCount =
        filteredSales.length;

      /*
        ALL-TIME PALM OIL STOCK

        Important:
        Packaging does not destroy oil.

        Therefore:
          Opening stock
          + oil turned
          - Palm Oil sold

        gives the physical Palm Oil balance.

        We intentionally DO NOT subtract
        litresPackaged here because packaging
        only moves oil from bulk to containers.

        Honey is excluded.

        Kuli-Kuli is also excluded from Palm Oil
        because it is a separate oil product.
      */

      // Farm stock is a separate inventory from each shop's stock.
      // New shop conversions/sales must not be counted as farm movements.
      const farmConversions = conversions.filter((conversion) => {
        const raw = conversion.rawData || {};
        const location = String(
          raw.stockLocation || raw.location || raw.saleLocation || ""
        ).trim().toLowerCase();

        return (
          raw.affectsFarmStock !== false &&
          !raw.affectsShopStock &&
          !raw.isShopSale &&
          !["shop", "store", "shop stock", "shop inventory", "retail shop"].includes(location)
        );
      });

      const farmSales = sales.filter((sale) => {
        const raw = sale.rawData || {};
        const location = String(
          raw.saleLocation || raw.stockLocation || raw.location || ""
        ).trim().toLowerCase();

        return (
          raw.affectsFarmStock !== false &&
          !raw.isShopSale &&
          !["shop", "store", "shop stock", "shop inventory", "retail shop"].includes(location)
        );
      });

      const allTimeProduced =
        farmConversions.reduce(
          (sum, conversion) =>
            sum +
            toNumber(
              conversion.litresProduced
            ),
          0
        );

      const allTimePalmOilSold =
        farmSales
          .filter((sale) => sale.isPalmOil)
          .reduce(
            (sum, sale) =>
              sum + toNumber(sale.oilLitresSold),
            0
          );

      const allTimeKuliKuliSold =
        farmSales
          .filter((sale) => sale.isKuliKuliOil)
          .reduce(
            (sum, sale) =>
              sum + toNumber(sale.oilLitresSold),
            0
          );

      const totalOilSold =
        farmSales.reduce(
          (sum, sale) =>
            sum + toNumber(sale.oilLitresSold),
          0
        );

      const currentPalmOilBalance =
        Math.max(
          openingStockLitres +
            allTimeProduced -
            allTimePalmOilSold,
          0
        );

      const averageSaleValue =
        salesCount > 0
          ? revenue /
            salesCount
          : 0;

      const conversionEfficiency =
        litresProduced > 0
          ? (
              litresPackaged /
              litresProduced
            ) *
            100
          : 0;

      const salesProductionRatio =
        litresProduced > 0
          ? (
              palmOilLitresSold /
              litresProduced
            ) *
            100
          : 0;

      return {
        revenue,

        litresSold,

        oilLitresSold,

        palmOilLitresSold,

        kuliKuliLitresSold,

        honeyLitresSold,

        unitsSold,

        litresProduced,

        litresPackaged,

        conversionCount,

        salesCount,

        openingStockLitres,

        currentPalmOilBalance,

        allTimeProduced,

        allTimePalmOilSold,

        allTimeKuliKuliSold,

        totalOilSold,

        averageSaleValue,

        conversionEfficiency,

        salesProductionRatio,
      };
    }, [
      filteredSales,
      filteredConversions,
      sales,
      conversions,
      openingStockLitres,
    ]);

  /* =========================================================
     DAILY REPORTS
  ========================================================= */

  const dailyReports =
    useMemo(() => {
      const grouped =
        new Map();

      const ensureDay = (
        dateKey,
        date
      ) => {
        if (
          !grouped.has(dateKey)
        ) {
          grouped.set(
            dateKey,
            {
              dateKey,

              date,

              revenue: 0,

              litresSold: 0,

              oilLitresSold: 0,

              palmOilLitresSold: 0,

              kuliKuliLitresSold: 0,

              honeyLitresSold: 0,

              unitsSold: 0,

              salesTransactions: 0,

              litresProduced: 0,

              litresPackaged: 0,

              conversions: 0,

              bottles75cl: 0,

              bottles1L: 0,

              jerrycans5L: 0,

              kegCount: 0,

              endingConversionBalance: 0,

              latestConversionDate:
                null,
            }
          );
        }

        return grouped.get(
          dateKey
        );
      };

      /*
        SALES
      */

      filteredSales.forEach(
        (sale) => {
          if (!sale.dateKey) {
            return;
          }

          const day =
            ensureDay(
              sale.dateKey,
              sale.date
            );

          day.revenue +=
            toNumber(
              sale.totalAmount
            );

          day.litresSold +=
            toNumber(
              sale.litresSold
            );

          day.oilLitresSold +=
            toNumber(
              sale.oilLitresSold
            );

          if (
            sale.isPalmOil
          ) {
            day.palmOilLitresSold +=
              toNumber(
                sale.oilLitresSold
              );
          }

          if (
            sale.isKuliKuliOil
          ) {
            day.kuliKuliLitresSold +=
              toNumber(
                sale.oilLitresSold
              );
          }

          if (
            sale.isHoney
          ) {
            day.honeyLitresSold +=
              toNumber(
                sale.litresSold
              );
          }

          day.unitsSold +=
            toNumber(
              sale.quantity
            );

          day.salesTransactions +=
            1;
        }
      );

      /*
        CONVERSIONS
      */

      filteredConversions.forEach(
        (conversion) => {
          if (!conversion.dateKey) {
            return;
          }

          const day =
            ensureDay(
              conversion.dateKey,
              conversion.date
            );

          day.litresProduced +=
            toNumber(
              conversion.litresProduced
            );

          day.litresPackaged +=
            toNumber(
              conversion.litresUsed
            );

          day.bottles75cl +=
            toNumber(
              conversion.bottles75cl
            );

          day.bottles1L +=
            toNumber(
              conversion.bottles1L
            );

          day.jerrycans5L +=
            toNumber(
              conversion.jerrycans5L
            );

          day.kegCount +=
            toNumber(
              conversion.kegCount
            );

          day.conversions +=
            1;

          if (
            !day.latestConversionDate ||
            (
              conversion.date &&
              conversion.date.getTime() >
                day.latestConversionDate.getTime()
            )
          ) {
            day.latestConversionDate =
              conversion.date;

            day.endingConversionBalance =
              toNumber(
                conversion.litresRemaining
              );
          }
        }
      );

      return Array.from(
        grouped.values()
      )
        .sort(
          (a, b) =>
            b.dateKey.localeCompare(
              a.dateKey
            )
        )
        .map((day) => ({
          ...day,

          netOilMovement:
            day.litresProduced -
            day.litresPackaged,

          formattedDate:
            formatDate(
              day.date
            ),

          chartDate:
            formatShortDate(
              day.dateKey
            ),
        }));
    }, [
      filteredSales,
      filteredConversions,
    ]);

  /* =========================================================
     DAILY REPORT DISPLAY
  ========================================================= */

  const visibleDailyReports =
    useMemo(() => {
      return showAllDailyReports
        ? dailyReports
        : dailyReports.slice(
            0,
            2
          );
    }, [
      dailyReports,
      showAllDailyReports,
    ]);

  const hiddenDailyReportCount =
    Math.max(
      dailyReports.length - 2,
      0
    );

  useEffect(() => {
    if (
      dailyReports.length <= 2 &&
      showAllDailyReports
    ) {
      setShowAllDailyReports(
        false
      );
    }
  }, [
    dailyReports.length,
    showAllDailyReports,
  ]);

  /* =========================================================
     PRODUCT SUMMARY
  ========================================================= */

  const productSummary =
    useMemo(() => {
      const grouped =
        new Map();

      filteredSales.forEach(
        (sale) => {
          const key =
            sale.productName ||
            sale.productType ||
            "Unknown";

          if (
            !grouped.has(key)
          ) {
            grouped.set(
              key,
              {
                productType:
                  sale.productType,

                productName:
                  sale.productName,

                productCategory:
                  sale.productCategory,

                quantity: 0,

                litres: 0,

                oilLitres: 0,

                revenue: 0,

                transactions: 0,
              }
            );
          }

          const product =
            grouped.get(key);

          product.quantity +=
            toNumber(
              sale.quantity
            );

          product.litres +=
            toNumber(
              sale.litresSold
            );

          product.oilLitres +=
            toNumber(
              sale.oilLitresSold
            );

          product.revenue +=
            toNumber(
              sale.totalAmount
            );

          product.transactions +=
            1;
        }
      );

      return Array.from(
        grouped.values()
      ).sort(
        (a, b) =>
          b.revenue -
          a.revenue
      );
    }, [
      filteredSales,
    ]);

  /* =========================================================
     PRODUCT SUMMARY DISPLAY
  ========================================================= */

  const visibleProductSummary = useMemo(() => {
    return showAllProducts
      ? productSummary
      : productSummary.slice(0, 2);
  }, [productSummary, showAllProducts]);

  const hiddenProductCount = Math.max(
    productSummary.length - 2,
    0
  );

  useEffect(() => {
    if (
      productSummary.length <= 2 &&
      showAllProducts
    ) {
      setShowAllProducts(false);
    }
  }, [productSummary.length, showAllProducts]);

  /* =========================================================
     CATEGORY SUMMARY
  ========================================================= */

  const categorySummary =
    useMemo(() => {
      const grouped =
        new Map();

      filteredSales.forEach(
        (sale) => {
          const category =
            sale.productCategory ||
            "Other";

          if (
            !grouped.has(
              category
            )
          ) {
            grouped.set(
              category,
              {
                category,

                quantity: 0,

                litres: 0,

                oilLitres: 0,

                revenue: 0,

                transactions: 0,
              }
            );
          }

          const item =
            grouped.get(
              category
            );

          item.quantity +=
            toNumber(
              sale.quantity
            );

          item.litres +=
            toNumber(
              sale.litresSold
            );

          item.oilLitres +=
            toNumber(
              sale.oilLitresSold
            );

          item.revenue +=
            toNumber(
              sale.totalAmount
            );

          item.transactions +=
            1;
        }
      );

      return Array.from(
        grouped.values()
      ).sort(
        (a, b) =>
          b.revenue -
          a.revenue
      );
    }, [
      filteredSales,
    ]);

  /* =========================================================
     CHART DATA
  ========================================================= */

  const revenueChartData =
    useMemo(() => {
      return dailyReports
        .slice()
        .reverse()
        .map((day) => ({
          date:
            day.chartDate,

          revenue:
            day.revenue,

          litresSold:
            day.litresSold,

          palmOilSold:
            day.palmOilLitresSold,

          kuliKuliSold:
            day.kuliKuliLitresSold,

          litresProduced:
            day.litresProduced,
        }));
    }, [
      dailyReports,
    ]);

  const oilMovementChartData =
    useMemo(() => {
      return dailyReports
        .slice()
        .reverse()
        .map((day) => ({
          date:
            day.chartDate,

          produced:
            day.litresProduced,

          packaged:
            day.litresPackaged,

          palmOilSold:
            day.palmOilLitresSold,

          kuliKuliSold:
            day.kuliKuliLitresSold,
        }));
    }, [
      dailyReports,
    ]);

  const conversionChartData =
    useMemo(() => {
      return dailyReports
        .slice()
        .reverse()
        .map((day) => ({
          date:
            day.chartDate,

          "75cl":
            day.bottles75cl,

          "1L":
            day.bottles1L,

          "5L":
            day.jerrycans5L,
        }));
    }, [
      dailyReports,
    ]);

  const productPieData =
    useMemo(() => {
      return productSummary.map(
        (product) => ({
          name:
            product.productName,

          value:
            product.revenue,
        })
      );
    }, [
      productSummary,
    ]);

  const categoryPieData =
    useMemo(() => {
      return categorySummary.map(
        (item) => ({
          name:
            item.category,

          value:
            item.revenue,
        })
      );
    }, [
      categorySummary,
    ]);

  /* =========================================================
     RANGE LABEL
  ========================================================= */

  const rangeLabel =
    useMemo(() => {
      switch (filter) {
        case REPORT_FILTERS.TODAY:
          return "Today";

        case REPORT_FILTERS.WEEK:
          return "This Week";

        case REPORT_FILTERS.SEVEN_DAYS:
          return "Last 7 Days";

        case REPORT_FILTERS.MONTH:
          return "This Month";

        case REPORT_FILTERS.YEAR:
          return "This Year";

        case REPORT_FILTERS.ALL:
          return "All Time";

        default:
          return "Report";
      }
    }, [
      filter,
    ]);

  /* =========================================================
     CSV HELPERS
  ========================================================= */

  const escapeCsvValue = (
    value
  ) => {
    const stringValue =
      value === null ||
      value === undefined
        ? ""
        : String(value);

    return `"${stringValue.replace(
      /"/g,
      '""'
    )}"`;
  };

  /* =========================================================
     CSV EXPORT
  ========================================================= */

  const exportCsv =
    useCallback(() => {
      try {
        setExporting(true);

        const rows = [];

        rows.push([
          "AFUBIA FARMS - PALM OIL SALES REPORT",
        ]);

        rows.push([
          "Report Period",
          rangeLabel,
        ]);

        rows.push([
          "Generated",
          formatDateTime(
            new Date()
          ),
        ]);

        rows.push([]);

        /*
          SUMMARY
        */

        rows.push([
          "SUMMARY",
        ]);

        rows.push([
          "Revenue",
          formatNaira(
            kpis.revenue
          ),
        ]);

        rows.push([
          "Units Sold",
          kpis.unitsSold,
        ]);

        rows.push([
          "Product Litres Sold",
          formatNumber(
            kpis.litresSold
          ),
        ]);

        rows.push([
          "Palm Oil Sold (L)",
          formatNumber(
            kpis.palmOilLitresSold
          ),
        ]);

        rows.push([
          "Kuli-Kuli Oil Sold (L)",
          formatNumber(
            kpis.kuliKuliLitresSold
          ),
        ]);

        rows.push([
          "Honey Sold (L)",
          formatNumber(
            kpis.honeyLitresSold
          ),
        ]);

        rows.push([
          "Oil Turned / Produced (L)",
          formatNumber(
            kpis.litresProduced
          ),
        ]);

        rows.push([
          "Oil Packaged (L)",
          formatNumber(
            kpis.litresPackaged
          ),
        ]);

        rows.push([
          "Opening Palm Oil Stock (L)",
          formatNumber(
            kpis.openingStockLitres
          ),
        ]);

        rows.push([
          "Current Palm Oil Balance (L)",
          formatNumber(
            kpis.currentPalmOilBalance
          ),
        ]);

        rows.push([
          "Sales Transactions",
          kpis.salesCount,
        ]);

        rows.push([
          "Oil Turning Records",
          kpis.conversionCount,
        ]);

        rows.push([]);

        /*
          DAILY REPORT
        */

        rows.push([
          "DAILY REPORT",
        ]);

        rows.push([
          "Date",
          "Revenue",
          "Product Litres Sold",
          "Oil Litres Sold",
          "Palm Oil Sold (L)",
          "Kuli-Kuli Oil Sold (L)",
          "Honey Sold (L)",
          "Units Sold",
          "Oil Turned (L)",
          "Oil Packaged (L)",
          "Remaining From Latest Turn (L)",
          "Sales Transactions",
          "Oil Turning Records",
          "75cl Bottles",
          "1L Bottles",
          "5L Jerrycans",
          "Kegs",
        ]);

        dailyReports.forEach(
          (day) => {
            rows.push([
              day.formattedDate,

              formatNaira(
                day.revenue
              ),

              formatNumber(
                day.litresSold
              ),

              formatNumber(
                day.oilLitresSold
              ),

              formatNumber(
                day.palmOilLitresSold
              ),

              formatNumber(
                day.kuliKuliLitresSold
              ),

              formatNumber(
                day.honeyLitresSold
              ),

              day.unitsSold,

              formatNumber(
                day.litresProduced
              ),

              formatNumber(
                day.litresPackaged
              ),

              formatNumber(
                day.endingConversionBalance
              ),

              day.salesTransactions,

              day.conversions,

              day.bottles75cl,

              day.bottles1L,

              day.jerrycans5L,

              day.kegCount,
            ]);
          }
        );

        rows.push([]);

        /*
          PRODUCT SUMMARY
        */

        rows.push([
          "PRODUCT SUMMARY",
        ]);

        rows.push([
          "Product",
          "Category",
          "Quantity Sold",
          "Product Litres",
          "Oil Litres",
          "Revenue",
          "Transactions",
        ]);

        productSummary.forEach(
          (product) => {
            rows.push([
              product.productName,

              product.productCategory,

              product.quantity,

              formatNumber(
                product.litres
              ),

              formatNumber(
                product.oilLitres
              ),

              formatNaira(
                product.revenue
              ),

              product.transactions,
            ]);
          }
        );

        rows.push([]);

        /*
          CATEGORY SUMMARY
        */

        rows.push([
          "CATEGORY SUMMARY",
        ]);

        rows.push([
          "Category",
          "Quantity Sold",
          "Product Litres",
          "Oil Litres",
          "Revenue",
          "Transactions",
        ]);

        categorySummary.forEach(
          (item) => {
            rows.push([
              item.category,

              item.quantity,

              formatNumber(
                item.litres
              ),

              formatNumber(
                item.oilLitres
              ),

              formatNaira(
                item.revenue
              ),

              item.transactions,
            ]);
          }
        );

        const csv =
          rows
            .map(
              (row) =>
                row
                  .map(
                    escapeCsvValue
                  )
                  .join(",")
            )
            .join("\n");

        const blob =
          new Blob(
            [
              "\ufeff" +
                csv,
            ],
            {
              type:
                "text/csv;charset=utf-8;",
            }
          );

        const url =
          URL.createObjectURL(
            blob
          );

        const link =
          document.createElement(
            "a"
          );

        link.href = url;

        link.download =
          `Afubia-Farms-Report-${getCurrentNigeriaDateKey()}.csv`;

        document.body.appendChild(
          link
        );

        link.click();

        document.body.removeChild(
          link
        );

        URL.revokeObjectURL(
          url
        );
      } catch (error) {
        console.error(
          "CSV export error:",
          error
        );
      } finally {
        setTimeout(() => {
          setExporting(false);
        }, 500);
      }
    }, [
      dailyReports,
      kpis,
      productSummary,
      categorySummary,
      rangeLabel,
    ]);

  /* =========================================================
     PRINT
  ========================================================= */

  const printReport =
    useCallback(() => {
      window.print();
    }, []);

  /* =========================================================
     TOTAL RECORDS
  ========================================================= */

  const totalRecords =
    filteredSales.length +
    filteredConversions.length;

  /* =========================================================
     UI
  ========================================================= */

  return (
    <ResponsiveLayout>
      <main className="reports-page">

        {/* =================================================
            HEADER
        ================================================= */}

        <header className="reports-header">

          <div>
            <p className="reports-eyebrow">
              AFUBIA FARMS • LIVE BUSINESS REPORT
            </p>

            <h1>
              Reports & Analytics
            </h1>

            <p className="reports-description">
              Track sales, oil turning,
              packaging, revenue and
              current stock from your
              Firestore records in real
              time.
            </p>
          </div>

          <div className="reports-live-box">

            <span className="reports-live-status">
              <span className="live-dot" />
              Live Sync
            </span>

            <span className="reports-live-time">
              Updated:{" "}
              {formatDateTime(
                lastUpdated
              )}
            </span>

            <span className="reports-live-time">
              Current:{" "}
              {formatDateTime(
                currentTime
              )}
            </span>

          </div>

        </header>

        {/* =================================================
            ERRORS
        ================================================= */}

        {(salesError ||
          conversionError ||
          settingsError) && (
          <div className="reports-error">

            <strong>
              Some report information
              could not be loaded.
            </strong>

            {salesError && (
              <span>
                Sales:{" "}
                {salesError}
              </span>
            )}

            {conversionError && (
              <span>
                Oil turning:{" "}
                {conversionError}
              </span>
            )}

            {settingsError && (
              <span>
                Opening stock settings:
                settings could not be
                loaded. Current balance
                is being calculated from
                recorded oil turning and
                sales.
              </span>
            )}

          </div>
        )}

        {/* =================================================
            FILTERS
        ================================================= */}

        {branchFilter === "all" && [...sales, ...conversions].some((record) => !normalizeBranchId(
          record?.rawData?.branchId || record?.branchId || record?.branch || record?.branchName || record?.shopName
        )) && (
          <div className="reports-branch-review-note" role="status">
            Some historical records have no confirmed branch and are excluded from All Shops totals until reviewed in Admin Dashboard → Historical Branch Review.
          </div>
        )}

        <section className="reports-controls">

          <div className="reports-filter">
            <span className="filter-label">Branch</span>
            <select
              aria-label="Filter reports by branch"
              value={branchFilter}
              onChange={(event) => setBranchFilter(event.target.value)}
            >
              <option value="kara">Kara Shop</option>
              <option value="ogidan">Ogidan Shop</option>
              <option value="all">All branches (combined)</option>
            </select>
          </div>

          <div className="reports-filter">

            <span className="filter-label">
              Report period
            </span>

            <div className="filter-buttons">

              {[
                [
                  REPORT_FILTERS.TODAY,
                  "Today",
                ],
                [
                  REPORT_FILTERS.WEEK,
                  "This Week",
                ],
                [
                  REPORT_FILTERS.SEVEN_DAYS,
                  "Last 7 Days",
                ],
                [
                  REPORT_FILTERS.MONTH,
                  "This Month",
                ],
                [
                  REPORT_FILTERS.YEAR,
                  "This Year",
                ],
                [
                  REPORT_FILTERS.ALL,
                  "All Time",
                ],
              ].map(
                ([
                  value,
                  label,
                ]) => (
                  <button
                    key={value}
                    type="button"
                    className={
                      filter ===
                      value
                        ? "active"
                        : ""
                    }
                    onClick={() =>
                      setFilter(
                        value
                      )
                    }
                    aria-pressed={
                      filter ===
                      value
                    }
                  >
                    {label}
                  </button>
                )
              )}

            </div>

          </div>

          <div className="reports-data-status">

            <span>
              {rangeLabel}
            </span>

            <strong>
              {totalRecords}{" "}
              {totalRecords ===
              1
                ? "record"
                : "records"}
            </strong>

          </div>

        </section>

        {/* =================================================
            LOADING
        ================================================= */}

        {isLoading && (
          <div className="reports-loading">

            <div className="reports-spinner" />

            <p>
              Loading live reports...
            </p>

          </div>
        )}

        {/* =================================================
            KPI CARDS
        ================================================= */}

        <section className="reports-kpi-grid">

          {/* REVENUE */}

          <article className="report-kpi revenue">

            <div className="report-kpi-icon">
              ₦
            </div>

            <div>

              <span>
                Revenue
              </span>

              <strong>
                {formatNaira(
                  kpis.revenue
                )}
              </strong>

              <small>
                {kpis.salesCount}{" "}
                {kpis.salesCount ===
                1
                  ? "sale"
                  : "sales"}
              </small>

            </div>

          </article>

          {/* OIL TURNED */}

          <article className="report-kpi">

            <div className="report-kpi-icon image-icon">

              <img
                className="oilContainers"
                src={oilTurning}
                alt="Palm oil turning"
              />

            </div>

            <div>

              <span>
                Oil Turned
              </span>

              <strong>
                {formatNumber(
                  kpis.litresProduced
                )}{" "}
                L
              </strong>

              <small>
                {kpis.conversionCount}{" "}
                oil-turning records
              </small>

            </div>

          </article>

          {/* OIL PACKAGED */}

          <article className="report-kpi">

            <div className="report-kpi-icon image-icon">

              <img
                className="oilContainers"
                src={oilContainers}
                alt="Palm oil containers"
              />

            </div>

            <div>

              <span>
                Oil Packaged
              </span>

              <strong>
                {formatNumber(
                  kpis.litresPackaged
                )}{" "}
                L
              </strong>

              <small>
                Bottled /
                jerrycanned
              </small>

            </div>

          </article>

          {/* PALM OIL SOLD */}

          <article className="report-kpi">

            <div className="report-kpi-icon">
              📈
            </div>

            <div>

              <span>
                Palm Oil Sold
              </span>

              <strong>
                {formatNumber(
                  kpis.palmOilLitresSold
                )}{" "}
                L
              </strong>

              <small>
                Actual palm oil
                stock deduction
              </small>

            </div>

          </article>

          {/* CURRENT STOCK */}

          <article className="report-kpi profit">

            <div className="report-kpi-icon image-icon">

              <img
                className="oilContainers"
                src={oilContainers}
                alt="Current palm oil balance"
              />

            </div>

            <div>

              <span>
                Farm Palm Oil Balance
              </span>

              <strong>
                {formatNumber(
                  kpis.currentPalmOilBalance
                )}{" "}
                L
              </strong>

              <small>
                Farm opening + farm oil turned − farm sales. Shop stock is tracked separately by branch.
              </small>

            </div>

          </article>

          {/* EFFICIENCY */}

          <article className="report-kpi">

            <div className="report-kpi-icon">
              %
            </div>

            <div>

              <span>
                Packaging Efficiency
              </span>

              <strong>
                {formatNumber(
                  kpis.conversionEfficiency
                )}%
              </strong>

              <small>
                Packaged ÷ oil turned
              </small>

            </div>

          </article>

        </section>

        {/* =================================================
            STOCK BREAKDOWN
        ================================================= */}

        <section className="financial-overview">

          <div>

            <span>
              Opening Palm Oil
            </span>

            <strong>
              {formatNumber(
                kpis.openingStockLitres
              )}{" "}
              L
            </strong>

          </div>

          <div>

            <span>
              Palm Oil Sold
            </span>

            <strong>
              {formatNumber(
                kpis.allTimePalmOilSold
              )}{" "}
              L
            </strong>

          </div>

          <div>

            <span>
              Kuli-Kuli Oil Sold
            </span>

            <strong>
              {formatNumber(
                kpis.allTimeKuliKuliSold
              )}{" "}
              L
            </strong>

          </div>

          <div>

            <span>
              Current Balance
            </span>

            <strong>
              {formatNumber(
                kpis.currentPalmOilBalance
              )}{" "}
              L
            </strong>

          </div>

        </section>

        {/* =================================================
            DAILY BUSINESS SUMMARY
        ================================================= */}

        <section className="report-section daily-reports-section">

          <div className="report-section-header">

            <div>

              <span className="section-eyebrow">
                GROUPED REPORT
              </span>

              <h2>
                Daily Business Summary
              </h2>

              <p>
                Sales and oil-turning
                records are grouped by
                date so your report remains
                easy to read as the database
                grows.
              </p>

            </div>

            <div className="report-section-header-right">

              <span className="report-section-stat">
                {dailyReports.length}{" "}
                {dailyReports.length ===
                1
                  ? "day"
                  : "days"}
              </span>

            </div>

          </div>

          {dailyReports.length ===
          0 ? (

            <div className="empty-state">

              <div>
                📊
              </div>

              <h3>
                No records for this
                period
              </h3>

              <p>
                Sales and oil-turning
                records will appear here
                when they are added to
                Firestore.
              </p>

            </div>

          ) : (

            <>

              <div className="daily-report-grid">

                {visibleDailyReports.map(
                  (day) => (

                    <article
                      className="daily-report-card"
                      key={
                        day.dateKey
                      }
                    >

                      <div className="daily-report-header">

                        <div>

                          <span>
                            {
                              day.formattedDate
                            }
                          </span>

                          <small>
                            {
                              day.salesTransactions
                            }{" "}
                            {day.salesTransactions ===
                            1
                              ? "sale"
                              : "sales"}

                            {" • "}

                            {
                              day.conversions
                            }{" "}
                            {day.conversions ===
                            1
                              ? "oil turning"
                              : "oil turning records"}
                          </small>

                        </div>

                        <strong>
                          {formatNaira(
                            day.revenue
                          )}
                        </strong>

                      </div>

                      <div className="daily-report-metrics">

                        <div>

                          <span>
                            Oil Turned
                          </span>

                          <strong>
                            {formatNumber(
                              day.litresProduced
                            )}{" "}
                            L
                          </strong>

                        </div>

                        <div>

                          <span>
                            Packaged
                          </span>

                          <strong>
                            {formatNumber(
                              day.litresPackaged
                            )}{" "}
                            L
                          </strong>

                        </div>

                        <div>

                          <span>
                            Palm Oil Sold
                          </span>

                          <strong>
                            {formatNumber(
                              day.palmOilLitresSold
                            )}{" "}
                            L
                          </strong>

                        </div>

                        <div>

                          <span>
                            Kuli-Kuli
                          </span>

                          <strong>
                            {formatNumber(
                              day.kuliKuliLitresSold
                            )}{" "}
                            L
                          </strong>

                        </div>

                        <div>

                          <span>
                            Units
                          </span>

                          <strong>
                            {formatNumber(
                              day.unitsSold
                            )}
                          </strong>

                        </div>

                      </div>

                      <div className="daily-report-footer">

                        <span>
                          75cl:{" "}
                          {formatNumber(
                            day.bottles75cl
                          )}
                        </span>

                        <span>
                          1L:{" "}
                          {formatNumber(
                            day.bottles1L
                          )}
                        </span>

                        <span>
                          5L:{" "}
                          {formatNumber(
                            day.jerrycans5L
                          )}
                        </span>

                        <span>
                          Kegs:{" "}
                          {formatNumber(
                            day.kegCount
                          )}
                        </span>

                      </div>

                    </article>
                  )
                )}

              </div>

              {hiddenDailyReportCount >
                0 && (

                <div className="daily-reports-toggle">

                  <div className="daily-reports-toggle-info">

                    <div className="daily-reports-toggle-icon">
                      {showAllDailyReports
                        ? "↑"
                        : "↓"}
                    </div>

                    <div>

                      <strong>
                        {showAllDailyReports
                          ? "Showing all daily reports"
                          : `${hiddenDailyReportCount} more ${
                              hiddenDailyReportCount ===
                              1
                                ? "report"
                                : "reports"
                            } available`}
                      </strong>

                      <span>
                        {showAllDailyReports
                          ? "Collapse the report history."
                          : "Open the complete daily report history."}
                      </span>

                    </div>

                  </div>

                  <button
                    type="button"
                    className="daily-reports-toggle-button"
                    onClick={() =>
                      setShowAllDailyReports(
                        (previous) =>
                          !previous
                      )
                    }
                    aria-expanded={
                      showAllDailyReports
                    }
                  >

                    <span>
                      {showAllDailyReports
                        ? "Show less"
                        : "Show more"}
                    </span>

                    <span
                      className={`toggle-arrow ${
                        showAllDailyReports
                          ? "is-open"
                          : ""
                      }`}
                      aria-hidden="true"
                    >
                      ↓
                    </span>

                  </button>

                </div>
              )}

            </>
          )}

        </section>

        {/* =================================================
            CHARTS
        ================================================= */}

        <section className="reports-chart-grid">

          {/* REVENUE */}

          <article className="report-chart-card">

            <div className="chart-header">

              <div>

                <span className="section-eyebrow">
                  REVENUE
                </span>

                <h3>
                  Daily Revenue
                </h3>

              </div>

            </div>

            <div className="chart-container">

              {revenueChartData.length ===
              0 ? (

                <div className="empty-chart">
                  No revenue data
                </div>

              ) : (

                <ResponsiveContainer
                  width="100%"
                  height="100%"
                >

                  <LineChart
                    data={
                      revenueChartData
                    }
                  >

                    <CartesianGrid
                      strokeDasharray="3 3"
                    />

                    <XAxis
                      dataKey="date"
                    />

                    <YAxis
                      tickFormatter={(
                        value
                      ) =>
                        `₦${Number(
                          value
                        ).toLocaleString(
                          "en-NG"
                        )}`
                      }
                    />

                    <Tooltip
                      formatter={(
                        value
                      ) =>
                        formatNaira(
                          value
                        )
                      }
                    />

                    <Line
                      type="monotone"
                      dataKey="revenue"
                      name="Revenue"
                      stroke="#0f7a4a"
                      strokeWidth={3}
                      dot={{
                        r: 4,
                      }}
                    />

                  </LineChart>

                </ResponsiveContainer>
              )}

            </div>

          </article>

          {/* OIL MOVEMENT */}

          <article className="report-chart-card">

            <div className="chart-header">

              <div>

                <span className="section-eyebrow">
                  OIL MOVEMENT
                </span>

                <h3>
                  Turned vs Packaged vs Sold
                </h3>

              </div>

            </div>

            <div className="chart-container">

              {oilMovementChartData.length ===
              0 ? (

                <div className="empty-chart">
                  No oil movement data
                </div>

              ) : (

                <ResponsiveContainer
                  width="100%"
                  height="100%"
                >

                  <BarChart
                    data={
                      oilMovementChartData
                    }
                  >

                    <CartesianGrid
                      strokeDasharray="3 3"
                    />

                    <XAxis
                      dataKey="date"
                    />

                    <YAxis />

                    <Tooltip
                      formatter={(
                        value
                      ) =>
                        `${formatNumber(
                          value
                        )} L`
                      }
                    />

                    <Legend />

                    <Bar
                      dataKey="produced"
                      name="Oil Turned"
                      fill="#0f7a4a"
                      radius={[
                        5,
                        5,
                        0,
                        0,
                      ]}
                    />

                    <Bar
                      dataKey="packaged"
                      name="Packaged"
                      fill="#d69e2e"
                      radius={[
                        5,
                        5,
                        0,
                        0,
                      ]}
                    />

                    <Bar
                      dataKey="palmOilSold"
                      name="Palm Oil Sold"
                      fill="#1e4e8c"
                      radius={[
                        5,
                        5,
                        0,
                        0,
                      ]}
                    />

                    <Bar
                      dataKey="kuliKuliSold"
                      name="Kuli-Kuli Sold"
                      fill="#2f8f83"
                      radius={[
                        5,
                        5,
                        0,
                        0,
                      ]}
                    />

                  </BarChart>

                </ResponsiveContainer>
              )}

            </div>

          </article>

          {/* CONTAINERS */}

          <article className="report-chart-card">

            <div className="chart-header">

              <div>

                <span className="section-eyebrow">
                  PACKAGING
                </span>

                <h3>
                  Containers Produced
                </h3>

              </div>

            </div>

            <div className="chart-container">

              {conversionChartData.length ===
              0 ? (

                <div className="empty-chart">
                  No conversion data
                </div>

              ) : (

                <ResponsiveContainer
                  width="100%"
                  height="100%"
                >

                  <BarChart
                    data={
                      conversionChartData
                    }
                  >

                    <CartesianGrid
                      strokeDasharray="3 3"
                    />

                    <XAxis
                      dataKey="date"
                    />

                    <YAxis />

                    <Tooltip />

                    <Legend />

                    <Bar
                      dataKey="75cl"
                      name="75cl Bottles"
                      fill="#116b48"
                    />

                    <Bar
                      dataKey="1L"
                      name="1L Bottles"
                      fill="#d69e2e"
                    />

                    <Bar
                      dataKey="5L"
                      name="5L Jerrycans"
                      fill="#1e4e8c"
                    />

                  </BarChart>

                </ResponsiveContainer>
              )}

            </div>

          </article>

          {/* PRODUCT PIE */}

          <article className="report-chart-card">

            <div className="chart-header">

              <div>

                <span className="section-eyebrow">
                  SALES MIX
                </span>

                <h3>
                  Revenue by Product
                </h3>

              </div>

            </div>

            <div className="pie-chart-container">

              {productPieData.length ===
              0 ? (

                <div className="empty-chart">
                  No product sales
                </div>

              ) : (

                <ResponsiveContainer
                  width="100%"
                  height="100%"
                >

                  <PieChart>

                    <Pie
                      data={
                        productPieData
                      }
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={105}
                      innerRadius={55}
                      paddingAngle={3}
                    >

                      {productPieData.map(
                        (
                          _,
                          index
                        ) => (
                          <Cell
                            key={`product-cell-${index}`}
                            fill={
                              CHART_COLORS[
                                index %
                                  CHART_COLORS.length
                              ]
                            }
                          />
                        )
                      )}

                    </Pie>

                    <Tooltip
                      formatter={(
                        value
                      ) =>
                        formatNaira(
                          value
                        )
                      }
                    />

                    <Legend />

                  </PieChart>

                </ResponsiveContainer>
              )}

            </div>

          </article>

          {/* CATEGORY PIE */}

          <article className="report-chart-card">

            <div className="chart-header">

              <div>

                <span className="section-eyebrow">
                  CATEGORY MIX
                </span>

                <h3>
                  Revenue by Category
                </h3>

              </div>

            </div>

            <div className="pie-chart-container">

              {categoryPieData.length ===
              0 ? (

                <div className="empty-chart">
                  No category sales
                </div>

              ) : (

                <ResponsiveContainer
                  width="100%"
                  height="100%"
                >

                  <PieChart>

                    <Pie
                      data={
                        categoryPieData
                      }
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={105}
                      innerRadius={55}
                      paddingAngle={3}
                    >

                      {categoryPieData.map(
                        (
                          _,
                          index
                        ) => (
                          <Cell
                            key={`category-cell-${index}`}
                            fill={
                              CHART_COLORS[
                                index %
                                  CHART_COLORS.length
                              ]
                            }
                          />
                        )
                      )}

                    </Pie>

                    <Tooltip
                      formatter={(
                        value
                      ) =>
                        formatNaira(
                          value
                        )
                      }
                    />

                    <Legend />

                  </PieChart>

                </ResponsiveContainer>
              )}

            </div>

          </article>

        </section>

        {/* =================================================
            PRODUCT SUMMARY
        ================================================= */}

        <section className="report-section">

          <div className="report-section-header">

            <div>

              <span className="section-eyebrow">
                PRODUCT PERFORMANCE
              </span>

              <h2>
                Sales by Product
              </h2>

              <p>
                Product totals are
                calculated from sales
                records in the selected
                period.
              </p>

            </div>

          </div>

          {productSummary.length ===
          0 ? (

            <div className="empty-state">

              <div>
                🧾
              </div>

              <h3>
                No sales yet
              </h3>

              <p>
                Product performance will
                appear here after sales
                are recorded.
              </p>

            </div>

          ) : (

            <>

              <div className="product-summary-grid">

                {visibleProductSummary.map(
                  (product) => (

                    <article
                      className="product-summary-card"
                      key={
                        `${product.productName}-${product.productType}`
                      }
                    >

                      <div className="product-summary-top">

                        <div>

                          <span>
                            {
                              product.productCategory
                            }
                          </span>

                          <strong>
                            {
                              product.productName
                            }
                          </strong>

                        </div>

                        <strong>
                          {formatNaira(
                            product.revenue
                          )}
                        </strong>

                      </div>

                      <div className="product-summary-values">

                        <div>

                          <span>
                            Units
                          </span>

                          <strong>
                            {formatNumber(
                              product.quantity
                            )}
                          </strong>

                        </div>

                        <div>

                          <span>
                            Litres
                          </span>

                          <strong>
                            {formatNumber(
                              product.litres
                            )}{" "}
                            L
                          </strong>

                        </div>

                        <div>

                          <span>
                            Oil Stock
                          </span>

                          <strong>
                            {formatNumber(
                              product.oilLitres
                            )}{" "}
                            L
                          </strong>

                        </div>

                        <div>

                          <span>
                            Transactions
                          </span>

                          <strong>
                            {
                              product.transactions
                            }
                          </strong>

                        </div>

                      </div>

                    </article>
                  )
                )}

              </div>

              {hiddenProductCount > 0 && (

                <div className="daily-reports-toggle">

                  <div className="daily-reports-toggle-info">

                    <div className="daily-reports-toggle-icon">
                      {showAllProducts ? "↑" : "↓"}
                    </div>

                    <div>

                      <strong>
                        {showAllProducts
                          ? "Showing all products"
                          : `${hiddenProductCount} more ${
                              hiddenProductCount === 1
                                ? "product"
                                : "products"
                            } available`}
                      </strong>

                      <span>
                        {showAllProducts
                          ? "Collapse the product list."
                          : "Expand to see all products."}
                      </span>

                    </div>

                  </div>

                  <button
                    type="button"
                    className="daily-reports-toggle-button"
                    onClick={() =>
                      setShowAllProducts(
                        (previous) => !previous
                      )
                    }
                    aria-expanded={showAllProducts}
                  >

                    <span>
                      {showAllProducts
                        ? "Show less"
                        : "Show more"}
                    </span>

                    <span
                      className={`toggle-arrow ${
                        showAllProducts
                          ? "is-open"
                          : ""
                      }`}
                      aria-hidden="true"
                    >
                      ↓
                    </span>

                  </button>

                </div>
              )}

            </>
          )}

        </section>

        {/* =================================================
            FINANCIAL OVERVIEW
        ================================================= */}

        <section className="financial-overview">

          <div>

            <span>
              Average Sale
            </span>

            <strong>
              {formatNaira(
                kpis.averageSaleValue
              )}
            </strong>

          </div>

          <div>

            <span>
              Palm Oil / Production
            </span>

            <strong>
              {formatNumber(
                kpis.salesProductionRatio
              )}%
            </strong>

          </div>

          <div>

            <span>
              Palm Oil Balance
            </span>

            <strong>
              {formatNumber(
                kpis.currentPalmOilBalance
              )}{" "}
              L
            </strong>

          </div>

          <div>

            <span>
              Last Sync
            </span>

            <strong>
              {formatDateTime(
                lastUpdated
              )}
            </strong>

          </div>

        </section>

        {/* =================================================
            EXPORT
        ================================================= */}

        <section className="report-export">

          <div>

            <span className="section-eyebrow">
              REPORT EXPORT
            </span>

            <h2>
              Save or Print Report
            </h2>

            <p>
              Export the grouped report
              instead of creating
              thousands of individual
              transaction rows.
            </p>

          </div>

          <div className="export-buttons">

            <button
              type="button"
              className="export-button"
              onClick={
                exportCsv
              }
              disabled={
                exporting
              }
            >
              {exporting
                ? "Preparing..."
                : "Export CSV"}
            </button>

            <button
              type="button"
              className="export-button"
              onClick={
                printReport
              }
            >
              Print Report
            </button>

          </div>

        </section>

        {/* =================================================
            SYNC FOOTER
        ================================================= */}

        <footer className="reports-sync-footer">

          <div className="sync-indicator">

            <span className="live-dot" />

            <span>
              Live Firestore
              synchronization active
            </span>

          </div>

          <div className="sync-counts">

            <span>
              Sales:{" "}
              <strong>
                {sales.length}
              </strong>
            </span>

            <span>
              Oil Turning:{" "}
              <strong>
                {conversions.length}
              </strong>
            </span>

            <span>
              Report Days:{" "}
              <strong>
                {dailyReports.length}
              </strong>
            </span>

          </div>

        </footer>

      </main>
    </ResponsiveLayout>
  );
};

export default Reports;
