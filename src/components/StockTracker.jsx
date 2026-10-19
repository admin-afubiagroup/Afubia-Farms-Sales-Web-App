/* eslint-disable no-unused-vars */

import { useEffect, useMemo, useState } from "react";

import {
  collection,
  doc,
  onSnapshot,
} from "firebase/firestore";

import { db } from "../Firebase/firebase.utils";

import oilTurning from "../assets/palm_oil_turning.jpg";
import kuliKuli from "../assets/kuliKuli.jpg";
import oilContainers from "../assets/oil_containers.jpg";
import honey from "../assets/honey.jpg";
import fiveL from "../assets/5lcontainer.jpg";
import seventyFL from "../assets/75clcontainer.jpg";

import "./StockTracker.css";

const NIGERIA_TIME_ZONE = "Africa/Lagos";

const COLLECTIONS = {
  materials: "materials",
  sales: "sales",
  conversions: "conversions",
  settings: "settings",
  stockTransfers: "stockTransfers",
};

/* =========================================================
   REUSABLE PRODUCT IMAGE
========================================================= */

function StockImage({
  src,
  alt,
  fallback = "📦",
  className = "",
}) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [src]);

  return (
    <div className={`stock-image-frame ${className}`}>
      {!imageFailed && src ? (
        <img
          src={src}
          alt={alt || "Afubia Farms product"}
          loading="lazy"
          decoding="async"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span
          className="stock-image-fallback"
          role="img"
          aria-label={alt || "Product image unavailable"}
        >
          {fallback}
        </span>
      )}
    </div>
  );
}

/* =========================================================
   GENERAL HELPERS
========================================================= */

const normalizeText = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const toNumber = (...values) => {
  for (const value of values) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      continue;
    }

    const number = Number(value);

    if (Number.isFinite(number)) {
      return number;
    }
  }

  return 0;
};

/*
 * Selects the first valid positive number.
 * This is appropriate for quantities recorded as purchases
 * and sales, which should be positive.
 */
const positiveNumber = (...values) => {
  for (const value of values) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      continue;
    }

    const number = Number(value);

    if (Number.isFinite(number) && number > 0) {
      return number;
    }
  }

  return 0;
};

const formatNumber = (value, maximumFractionDigits = 2) =>
  new Intl.NumberFormat("en-NG", {
    maximumFractionDigits,
  }).format(Number(value) || 0);

const formatCurrency = (value) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);

const formatLitres = (value) =>
  `${formatNumber(value)} L`;

const getTimestamp = (value) => {
  if (!value) return 0;

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value.toDate === "function") {
    return value.toDate().getTime();
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number") {
    return value;
  }

  if (
    typeof value === "object" &&
    value.seconds != null
  ) {
    return Number(value.seconds) * 1000;
  }

  const parsed = new Date(value).getTime();

  return Number.isFinite(parsed) ? parsed : 0;
};

const getRecordDate = (record) =>
  record?.recordDate ||
  record?.transferDate ||
  record?.date ||
  record?.saleDate ||
  record?.salesDate ||
  record?.purchaseDate ||
  record?.recordedAt ||
  record?.createdAt ||
  record?.timestamp ||
  record?.dateTime ||
  record?.soldAt ||
  record?.created_at ||
  record?.updatedAt ||
  null;

const formatDate = (value) => {
  const timestamp = getTimestamp(value);

  if (!timestamp) return "Date not recorded";

  return new Intl.DateTimeFormat("en-NG", {
    timeZone: NIGERIA_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(timestamp));
};

const getStatus = (record) =>
  normalizeText(
    record?.status ||
      record?.paymentStatus ||
      record?.transactionStatus ||
      ""
  );

const isCancelledRecord = (record) => {
  const status = getStatus(record);

  return [
    "cancelled",
    "canceled",
    "rejected",
    "void",
    "voided",
    "deleted",
  ].includes(status);
};

/* =========================================================
   FARM / SHOP LOCATION HELPERS

   Shop stock and farm stock are independent.

   Shop sales must never reduce farm stock.

   Older sales with no location are treated as farm sales,
   unless they explicitly opt out of farm stock.
========================================================= */

const getRecordLocation = (record) =>
  normalizeText(
    record?.saleLocation ||
      record?.stockLocation ||
      record?.inventoryLocation ||
      record?.location ||
      record?.soldFrom ||
      record?.stockSource ||
      ""
  );

const isShopSale = (sale) => {
  const location = getRecordLocation(sale);

  return (
    sale?.isShopSale === true ||
    [
      "shop",
      "store",
      "shop stock",
      "shop inventory",
      "store shop",
      "retail shop",
    ].includes(location)
  );
};

const isFarmSale = (sale) => {
  if (isCancelledRecord(sale)) return false;

  if (isShopSale(sale)) return false;

  if (sale?.affectsFarmStock === false) return false;

  return true;
};

/* =========================================================
   FARM-TO-SHOP TRANSFERS
========================================================= */

const isFarmToShopTransfer = (transfer) => {
  const from = normalizeText(
    transfer?.fromLocation ||
      transfer?.sourceLocation ||
      transfer?.from ||
      "farm"
  );

  const to = normalizeText(
    transfer?.toLocation ||
      transfer?.destinationLocation ||
      transfer?.to ||
      "shop"
  );

  return (
    ["farm", "farm stock"].includes(from) &&
    ["shop", "shop stock", "shop inventory"].includes(to)
  );
};

const isValidTransfer = (transfer) => {
  if (isCancelledRecord(transfer)) return false;

  if (transfer?.affectsFarmStock === false) return false;

  if (transfer?.affectsShopStock === false) return false;

  if (transfer?.isFarmToShopTransfer === false) {
    return false;
  }

  if (transfer?.recordType) {
    const recordType = normalizeText(transfer.recordType);

    if (
      !recordType.includes("transfer") &&
      recordType !== "stock movement"
    ) {
      return false;
    }
  }

  return isFarmToShopTransfer(transfer);
};

/* =========================================================
   MATERIAL HELPERS
========================================================= */

const getMaterialName = (material) =>
  material?.materialName ||
  material?.name ||
  material?.material ||
  material?.description ||
  material?.productName ||
  material?.itemName ||
  material?.stockName ||
  material?.title ||
  material?.product ||
  "";

const getMaterialText = (material) => {
  const product =
    material?.product &&
    typeof material.product === "object"
      ? material.product
      : {};

  return normalizeText(
    [
      getMaterialName(material),
      material?.category,
      material?.productType,
      material?.product_type,
      material?.Product_Type,
      material?.type,
      material?.unit,
      material?.stockUnit,
      material?.measurementUnit,
      product?.name,
      product?.productName,
      product?.type,
      product?.unit,
    ].join(" ")
  );
};

const getMaterialQuantity = (material) =>
  positiveNumber(
    material?.purchasedQuantity,
    material?.quantityPurchased,
    material?.quantityBought,
    material?.unitsPurchased,
    material?.numberPurchased,
    material?.quantity,
    material?.qty,
    material?.amount
  );

const getMaterialCost = (material) =>
  positiveNumber(
    material?.totalCost,
    material?.cost,
    material?.totalAmount,
    material?.amountPaid,
    material?.purchaseCost,
    material?.price
  );

const isMaterialPurchased = (material) => {
  if (isCancelledRecord(material)) return false;

  const status = getStatus(material);

  return ![
    "pending",
    "unpaid",
    "awaiting payment",
    "not purchased",
    "rejected",
  ].includes(status);
};

const getMaterialUnit = (material) =>
  normalizeText(
    material?.unit ||
      material?.stockUnit ||
      material?.measurementUnit ||
      material?.purchaseUnit ||
      ""
  );

/* =========================================================
   PRODUCT CLASSIFICATION

   Product identity takes priority over container size.
   For example, Kuli-Kuli oil in a 75cl container is still
   Kuli-Kuli oil, not a palm-oil sale.
========================================================= */

const getRecordProductText = (record) => {
  const product =
    record?.product &&
    typeof record.product === "object"
      ? record.product
      : record?.productDetails ||
        record?.productInfo ||
        record?.selectedProduct ||
        record?.item ||
        {};

  return normalizeText(
    [
      record?.productName,
      record?.product_name,
      record?.ProductName,
      typeof record?.product === "string"
        ? record.product
        : "",
      record?.name,
      record?.itemName,
      record?.description,
      record?.category,
      record?.productCategory,
      record?.product_category,
      record?.productType,
      record?.product_type,
      record?.Product_Type,
      record?.stockCategory,
      record?.stockType,
      record?.type,
      record?.unit,
      record?.stockUnit,
      record?.measurementUnit,
      record?.size,
      product?.productName,
      product?.name,
      product?.title,
      product?.category,
      product?.productCategory,
      product?.productType,
      product?.product_type,
      product?.type,
      product?.unit,
      product?.stockUnit,
      product?.size,
    ].join(" ")
  );
};

const isHoneyProduct = (record) =>
  getRecordProductText(record).includes("honey");

const isKuliKuliProduct = (record) => {
  const text = getRecordProductText(record);

  return (
    text.includes("kuli kuli") ||
    text.includes("kulikuli")
  );
};

const isPalmOilProduct = (record) => {
  if (isHoneyProduct(record)) return false;

  if (isKuliKuliProduct(record)) return false;

  const text = getRecordProductText(record);

  if (
    text.includes("palm oil") ||
    text.includes("palmoil") ||
    text.includes("red oil") ||
    text.includes("redoil")
  ) {
    return true;
  }

  return [
    "75cl",
    "750ml",
    "0.75l",
    "1l",
    "5l",
    "30l",
    "keg",
    "jerrycan",
  ].some((item) => text.includes(item));
};

const getProductCategory = (record) => {
  if (isHoneyProduct(record)) return "honey";

  if (isKuliKuliProduct(record)) return "kuliKuli";

  if (isPalmOilProduct(record)) return "palmOil";

  return "other";
};

/* =========================================================
   MATERIAL CATEGORY
========================================================= */

const getMaterialType = (material) => {
  const text = getMaterialText(material);

  if (isHoneyProduct(material)) return "honey";

  if (isKuliKuliProduct(material)) return "kuliKuli";

  if (
    text.includes("75cl") ||
    text.includes("0.75l") ||
    text.includes("750ml")
  ) {
    return "75cl";
  }

  if (
    text.includes("5l") ||
    text.includes("5 l") ||
    text.includes("5 litre") ||
    text.includes("5 liter") ||
    text.includes("jerrycan")
  ) {
    return "5L";
  }

  if (
    text.includes("1l") ||
    text.includes("1 l") ||
    text.includes("1 litre") ||
    text.includes("1 liter")
  ) {
    return "1L";
  }

  return "other";
};

/* =========================================================
   MATERIAL QUANTITY CONVERSION
========================================================= */

const getKuliKuliPurchaseLitres = (material) => {
  const quantity = getMaterialQuantity(material);

  const explicitLitres = positiveNumber(
    material?.kuliKuliLitresPurchased,
    material?.kuliKuliOilLitresPurchased,
    material?.litresPurchased,
    material?.litersPurchased,
    material?.litres,
    material?.liters,
    material?.quantityLitres,
    material?.quantityInLitres,
    material?.totalLitres,
    material?.oilLitres
  );

  if (explicitLitres > 0) return explicitLitres;

  const unit = getMaterialUnit(material);
  const text = getMaterialText(material);

  if (
    ["litre", "litres", "liter", "liters", "l"].includes(unit)
  ) {
    return quantity;
  }

  if (
    text.includes("5l") ||
    text.includes("5 l") ||
    text.includes("5 litre") ||
    text.includes("5 liter") ||
    text.includes("jerrycan")
  ) {
    return quantity * 5;
  }

  if (
    text.includes("75cl") ||
    text.includes("750ml") ||
    text.includes("0.75l")
  ) {
    return quantity * 0.75;
  }

  if (
    text.includes("1l") ||
    text.includes("1 l") ||
    text.includes("1 litre") ||
    text.includes("1 liter")
  ) {
    return quantity;
  }

  /*
   * If no container size is recorded for a Kuli-Kuli
   * oil purchase, preserve the recorded quantity as litres.
   */
  return quantity;
};

const getHoneyPurchaseBottles = (material) => {
  const explicitBottles = positiveNumber(
    material?.honeyBottlesPurchased,
    material?.bottlesPurchased,
    material?.quantityBottles,
    material?.numberOfBottles,
    material?.bottleCount,
    material?.unitsPurchased
  );

  if (explicitBottles > 0) return explicitBottles;

  const unit = getMaterialUnit(material);

  if (
    [
      "bottle",
      "bottles",
      "piece",
      "pieces",
      "unit",
      "units",
    ].includes(unit)
  ) {
    return getMaterialQuantity(material);
  }

  /*
   * Legacy material records may have no unit field.
   * Their recorded quantity is retained as bottle count.
   */
  if (!unit) return getMaterialQuantity(material);

  return 0;
};

/* =========================================================
   SALES HELPERS
========================================================= */

const getSaleProduct = (sale) =>
  sale?.product &&
  typeof sale.product === "object"
    ? sale.product
    : sale?.productDetails ||
      sale?.productInfo ||
      sale?.selectedProduct ||
      sale?.item ||
      {};

const getSaleProductName = (sale) => {
  const product = getSaleProduct(sale);

  return (
    sale?.productName ||
    sale?.product_name ||
    sale?.ProductName ||
    sale?.itemName ||
    sale?.name ||
    sale?.description ||
    (typeof sale?.product === "string" ? sale.product : "") ||
    product?.productName ||
    product?.name ||
    product?.title ||
    ""
  );
};

const getSaleProductText = (sale) =>
  normalizeText(
    `${getRecordProductText(sale)} ${getSaleProductName(sale)}`
  );

const getSaleQuantity = (sale) =>
  positiveNumber(
    sale?.quantitySold,
    sale?.QuantitySold,
    sale?.Quantity_Sold,
    sale?.quantity_sold,
    sale?.soldQuantity,
    sale?.unitsSold,
    sale?.quantity,
    sale?.qty,
    sale?.units,
    sale?.amount
  );

const getSaleUnit = (sale) =>
  normalizeText(
    sale?.unit ||
      sale?.stockUnit ||
      sale?.measurementUnit ||
      sale?.saleUnit ||
      sale?.quantityUnit ||
      ""
  );

const getSaleVolumePerUnitLitres = (sale) => {
  const product = getSaleProduct(sale);

  const explicitVolume = positiveNumber(
    sale?.volumePerUnitLitres,
    sale?.volume_per_unit_litres,
    sale?.productVolumeLitres,
    sale?.product_volume_litres,
    sale?.containerVolumeLitres,
    sale?.container_volume_litres,
    sale?.bottleSizeLitres,
    sale?.bottle_size_litres,
    product?.volumePerUnitLitres,
    product?.volumeLitres
  );

  if (explicitVolume > 0) return explicitVolume;

  const text = getSaleProductText(sale);

  if (
    text.includes("75cl") ||
    text.includes("750ml") ||
    text.includes("0.75l")
  ) {
    return 0.75;
  }

  if (
    text.includes("50cl") ||
    text.includes("500ml") ||
    text.includes("0.5l")
  ) {
    return 0.5;
  }

  if (
    text.includes("25cl") ||
    text.includes("250ml") ||
    text.includes("0.25l")
  ) {
    return 0.25;
  }

  if (
    text.includes("5l") ||
    text.includes("5 l") ||
    text.includes("5 litre") ||
    text.includes("5 liter") ||
    text.includes("jerrycan")
  ) {
    return 5;
  }

  if (
    text.includes("1l") ||
    text.includes("1 l") ||
    text.includes("1 litre") ||
    text.includes("1 liter")
  ) {
    return 1;
  }

  if (
    text.includes("30l") ||
    text.includes("30 l") ||
    text.includes("keg")
  ) {
    return 30;
  }

  return 0;
};

/* =========================================================
   KULI-KULI SALES — LITRES
========================================================= */

const getKuliKuliLitresSold = (sale) => {
  if (getProductCategory(sale) !== "kuliKuli") {
    return 0;
  }

  if (!isFarmSale(sale)) return 0;

  if (sale?.affectsKuliKuliStock === false) {
    return 0;
  }

  const explicitLitres = positiveNumber(
    sale?.kuliKuliLitresSold,
    sale?.kuliKuliOilLitresSold,
    sale?.kuliKuliOilLitres,
    sale?.kuliKuliLitres,
    sale?.kuliKuliQuantityLitres,
    sale?.litresSold,
    sale?.litres_sold,
    sale?.totalLitresSold,
    sale?.total_litres_sold,
    sale?.quantityLitres,
    sale?.quantityInLitres
  );

  if (explicitLitres > 0) return explicitLitres;

  const quantity = getSaleQuantity(sale);

  if (quantity <= 0) return 0;

  const unit = getSaleUnit(sale);

  if (
    ["litre", "litres", "liter", "liters", "l"].includes(unit)
  ) {
    return quantity;
  }

  const volume = getSaleVolumePerUnitLitres(sale);

  if (volume > 0) return quantity * volume;

  /*
   * Preserve the existing app's legacy convention:
   * Kuli-Kuli sale quantity without a container size is
   * treated as litres.
   */
  return quantity;
};

/* =========================================================
   HONEY SALES — BOTTLES
========================================================= */

const getHoneyBottlesSold = (sale) => {
  if (getProductCategory(sale) !== "honey") return 0;

  if (!isFarmSale(sale)) return 0;

  if (sale?.affectsHoneyStock === false) return 0;

  const explicitBottles = positiveNumber(
    sale?.honeyBottlesSold,
    sale?.honeyQuantitySold,
    sale?.bottlesSold,
    sale?.bottleCountSold,
    sale?.quantityBottles,
    sale?.numberOfBottlesSold
  );

  if (explicitBottles > 0) return explicitBottles;

  const unit = getSaleUnit(sale);

  /*
   * Generic quantities are only interpreted as bottles
   * when the sale uses a bottle, piece, or unit measure.
   */
  if (
    [
      "bottle",
      "bottles",
      "piece",
      "pieces",
      "unit",
      "units",
    ].includes(unit)
  ) {
    return getSaleQuantity(sale);
  }

  /*
   * Support older honey sales where no unit was saved.
   */
  if (!unit) return getSaleQuantity(sale);

  return 0;
};

/* =========================================================
   PALM-OIL SALES — LITRES
========================================================= */

const saleAffectsOilStock = (sale) => {
  if (!isFarmSale(sale)) return false;

  if (sale?.affectsOilStock === false) return false;

  if (
    isHoneyProduct(sale) ||
    isKuliKuliProduct(sale)
  ) {
    return false;
  }

  if (sale?.affectsOilStock === true) return true;

  return isPalmOilProduct(sale);
};

const getSaleLitres = (sale) => {
  if (!saleAffectsOilStock(sale)) return 0;

  const explicitOilLitres = positiveNumber(
    sale?.palmOilLitresSold,
    sale?.palmOilQuantityLitres,
    sale?.oilLitresSold,
    sale?.oil_litres_sold,
    sale?.oilVolumeSold,
    sale?.oil_volume_sold,
    sale?.litresSold,
    sale?.litres_sold,
    sale?.totalLitresSold,
    sale?.total_litres_sold,
    sale?.totalLitres,
    sale?.litres
  );

  if (explicitOilLitres > 0) return explicitOilLitres;

  const quantity = getSaleQuantity(sale);

  if (quantity <= 0) return 0;

  const unit = getSaleUnit(sale);

  if (
    ["litre", "litres", "liter", "liters", "l"].includes(unit)
  ) {
    return quantity;
  }

  const volume = getSaleVolumePerUnitLitres(sale);

  return volume > 0 ? quantity * volume : 0;
};

/* =========================================================
   TRANSFER PRODUCT CLASSIFICATION
========================================================= */

const getTransferProductText = (transfer) =>
  normalizeText(
    [
      getRecordProductText(transfer),
      transfer?.productName,
      transfer?.materialName,
      transfer?.stockName,
      transfer?.itemName,
      transfer?.productType,
      transfer?.category,
      transfer?.stockCategory,
      transfer?.stockUnit,
      transfer?.unit,
    ].join(" ")
  );

const getTransferQuantity = (transfer) =>
  positiveNumber(
    transfer?.transferQuantity,
    transfer?.quantityTransferred,
    transfer?.quantity,
    transfer?.qty,
    transfer?.units,
    transfer?.quantityBottles,
    transfer?.quantityLitres,
    transfer?.litresTransferred
  );

const getTransferCategory = (transfer) => {
  const explicitCategory = normalizeText(
    transfer?.productCategory ||
      transfer?.stockCategory ||
      transfer?.productType ||
      transfer?.category ||
      ""
  );

  const text = getTransferProductText(transfer);

  if (
    explicitCategory.includes("honey") ||
    text.includes("honey")
  ) {
    return "honey";
  }

  if (
    explicitCategory.includes("kuli") ||
    text.includes("kuli kuli") ||
    text.includes("kulikuli")
  ) {
    return "kuliKuli";
  }

  if (
    explicitCategory.includes("palm") ||
    explicitCategory.includes("oil") ||
    text.includes("palm oil") ||
    text.includes("palmoil") ||
    text.includes("red oil") ||
    text.includes("redoil")
  ) {
    return "palmOil";
  }

  return getProductCategory(transfer);
};

const getTransferLitres = (transfer, category) => {
  const explicitLitres = positiveNumber(
    transfer?.quantityLitres,
    transfer?.litresTransferred,
    transfer?.transferLitres,
    transfer?.transferQuantityLitres,
    transfer?.kuliKuliLitres,
    transfer?.kuliKuliLitresTransferred,
    transfer?.kuliKuliOilLitres,
    transfer?.oilLitres,
    transfer?.litres,
    transfer?.totalLitres
  );

  if (explicitLitres > 0) return explicitLitres;

  const quantity = getTransferQuantity(transfer);

  if (quantity <= 0) return 0;

  const unit = normalizeText(
    transfer?.stockUnit ||
      transfer?.unit ||
      transfer?.measurementUnit ||
      ""
  );

  if (
    ["litre", "litres", "liter", "liters", "l"].includes(unit)
  ) {
    return quantity;
  }

  const volume = getSaleVolumePerUnitLitres(transfer);

  if (volume > 0) return quantity * volume;

  /*
   * Keep the legacy transfer convention for oil products
   * when no unit or container size was recorded.
   */
  if (
    category === "palmOil" ||
    category === "kuliKuli"
  ) {
    return quantity;
  }

  return 0;
};

const getTransferHoneyBottles = (transfer) => {
  const explicitBottles = positiveNumber(
    transfer?.quantityBottles,
    transfer?.bottlesTransferred,
    transfer?.honeyBottlesTransferred,
    transfer?.bottleCount
  );

  if (explicitBottles > 0) return explicitBottles;

  const unit = normalizeText(
    transfer?.unit ||
      transfer?.stockUnit ||
      transfer?.measurementUnit ||
      ""
  );

  if (
    [
      "bottle",
      "bottles",
      "piece",
      "pieces",
      "unit",
      "units",
    ].includes(unit)
  ) {
    return getTransferQuantity(transfer);
  }

  if (!unit) return getTransferQuantity(transfer);

  return 0;
};

/* =========================================================
   PALM-OIL CONTAINER STOCK
========================================================= */

const saleAffectsContainerStock = (sale) => {
  if (!isFarmSale(sale)) return false;

  if (sale?.affectsContainerStock === false) return false;

  if (
    isHoneyProduct(sale) ||
    isKuliKuliProduct(sale)
  ) {
    return false;
  }

  const text = getSaleProductText(sale);

  return (
    text.includes("75cl") ||
    text.includes("750ml") ||
    text.includes("1l") ||
    text.includes("5l") ||
    text.includes("jerrycan")
  );
};

const getContainerTypeFromSale = (sale) => {
  const text = getSaleProductText(sale);

  if (
    text.includes("75cl") ||
    text.includes("750ml")
  ) {
    return "75cl";
  }

  if (
    text.includes("5l") ||
    text.includes("5 l") ||
    text.includes("jerrycan")
  ) {
    return "5L";
  }

  if (
    text.includes("1l") ||
    text.includes("1 l")
  ) {
    return "1L";
  }

  return "other";
};

/* =========================================================
   COMPONENT
========================================================= */

export default function StockTracker() {
  const [materials, setMaterials] = useState([]);
  const [sales, setSales] = useState([]);
  const [conversions, setConversions] = useState([]);
  const [stockTransfers, setStockTransfers] = useState([]);

  const [openingStockLitres, setOpeningStockLitres] =
    useState(0);

  const [openingKuliKuliLitres, setOpeningKuliKuliLitres] =
    useState(0);

  const [openingHoneyBottles, setOpeningHoneyBottles] =
    useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [liveMessage, setLiveMessage] = useState("");

  /* =======================================================
     FIRESTORE LISTENERS
  ======================================================= */

  useEffect(() => {
    let materialsLoaded = false;
    let salesLoaded = false;
    let conversionsLoaded = false;
    let settingsLoaded = false;
    let transfersLoaded = false;
    let active = true;

    const unsubscribers = [];

    const updateLoading = () => {
      if (
        active &&
        materialsLoaded &&
        salesLoaded &&
        conversionsLoaded &&
        settingsLoaded &&
        transfersLoaded
      ) {
        setLoading(false);
      }
    };

    const handleListenerError = (source, listenerError) => {
      console.error(
        `Afubia Farms StockTracker ${source} listener error:`,
        listenerError
      );

      if (!active) return;

      setError(
        `Unable to load ${source} data. Check your connection and Firestore permissions.`
      );

      setLoading(false);
    };

    const materialsUnsubscribe = onSnapshot(
      collection(db, COLLECTIONS.materials),
      (snapshot) => {
        if (!active) return;

        setMaterials(
          snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          }))
        );

        materialsLoaded = true;
        updateLoading();
      },
      (listenerError) =>
        handleListenerError("materials", listenerError)
    );

    unsubscribers.push(materialsUnsubscribe);

    const salesUnsubscribe = onSnapshot(
      collection(db, COLLECTIONS.sales),
      (snapshot) => {
        if (!active) return;

        setSales(
          snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          }))
        );

        salesLoaded = true;
        updateLoading();
      },
      (listenerError) =>
        handleListenerError("sales", listenerError)
    );

    unsubscribers.push(salesUnsubscribe);

    const conversionsUnsubscribe = onSnapshot(
      collection(db, COLLECTIONS.conversions),
      (snapshot) => {
        if (!active) return;

        setConversions(
          snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          }))
        );

        conversionsLoaded = true;
        updateLoading();
      },
      (listenerError) =>
        handleListenerError("conversions", listenerError)
    );

    unsubscribers.push(conversionsUnsubscribe);

    const transfersUnsubscribe = onSnapshot(
      collection(db, COLLECTIONS.stockTransfers),
      (snapshot) => {
        if (!active) return;

        setStockTransfers(
          snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          }))
        );

        transfersLoaded = true;
        updateLoading();
      },
      (listenerError) =>
        handleListenerError("stock transfers", listenerError)
    );

    unsubscribers.push(transfersUnsubscribe);

    const settingsUnsubscribe = onSnapshot(
      doc(db, COLLECTIONS.settings, "business"),
      (snapshot) => {
        if (!active) return;

        const settings = snapshot.exists()
          ? snapshot.data()
          : {};

        setOpeningStockLitres(
          positiveNumber(
            settings?.openingStockLitres,
            settings?.openingOilStockLitres,
            settings?.openingStock,
            settings?.initialStockLitres
          )
        );

        setOpeningKuliKuliLitres(
          positiveNumber(
            settings?.openingKuliKuliLitres,
            settings?.openingKuliKuliOilLitres,
            settings?.initialKuliKuliLitres
          )
        );

        setOpeningHoneyBottles(
          positiveNumber(
            settings?.openingHoneyBottles,
            settings?.initialHoneyBottles,
            settings?.openingHoneyStock
          )
        );

        settingsLoaded = true;
        updateLoading();
      },
      (listenerError) =>
        handleListenerError("settings", listenerError)
    );

    unsubscribers.push(settingsUnsubscribe);

    return () => {
      active = false;

      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  /* =======================================================
     VALID RECORDS

     Exclude cancelled sales and transfers before performing
     stock calculations.
  ======================================================= */

  const purchasedMaterials = useMemo(
    () => materials.filter(isMaterialPurchased),
    [materials]
  );

  const farmSales = useMemo(
    () => sales.filter(isFarmSale),
    [sales]
  );

  const validTransfers = useMemo(
    () => stockTransfers.filter(isValidTransfer),
    [stockTransfers]
  );

  const validConversions = useMemo(
    () =>
      conversions.filter((conversion) => {
        if (isCancelledRecord(conversion)) return false;

        if (conversion?.affectsStock === false) return false;

        if (conversion?.affectsOilStock === false) return false;

        return true;
      }),
    [conversions]
  );

  /* =======================================================
     VALID FARM-TO-SHOP TRANSFERS
  ======================================================= */

  const palmOilTransferred = useMemo(
    () =>
      validTransfers.reduce((total, transfer) => {
        if (getTransferCategory(transfer) !== "palmOil") {
          return total;
        }

        return (
          total + getTransferLitres(transfer, "palmOil")
        );
      }, 0),
    [validTransfers]
  );

  const kuliKuliTransferred = useMemo(
    () =>
      validTransfers.reduce((total, transfer) => {
        if (getTransferCategory(transfer) !== "kuliKuli") {
          return total;
        }

        return (
          total + getTransferLitres(transfer, "kuliKuli")
        );
      }, 0),
    [validTransfers]
  );

  const honeyTransferred = useMemo(
    () =>
      validTransfers.reduce((total, transfer) => {
        if (getTransferCategory(transfer) !== "honey") {
          return total;
        }

        return total + getTransferHoneyBottles(transfer);
      }, 0),
    [validTransfers]
  );

  /* =======================================================
     PURCHASED MATERIALS AND COST
  ======================================================= */

  const totalMaterialCost = useMemo(
    () =>
      purchasedMaterials.reduce(
        (total, material) =>
          total + getMaterialCost(material),
        0
      ),
    [purchasedMaterials]
  );

  /* =======================================================
     FARM PALM-OIL PRODUCTION

     Production is counted once from valid conversion records.
  ======================================================= */

  const totalOilProduced = useMemo(
    () =>
      validConversions.reduce((total, conversion) => {
        const litres = positiveNumber(
          conversion?.litresProduced,
          conversion?.totalLitresProduced,
          conversion?.oilLitresProduced,
          conversion?.producedLitres,
          conversion?.litres,
          conversion?.litresTurned
        );

        return total + litres;
      }, 0),
    [validConversions]
  );

  /* =======================================================
     FARM PALM-OIL SALES
  ======================================================= */

  const totalOilSold = useMemo(
    () =>
      farmSales.reduce(
        (total, sale) => total + getSaleLitres(sale),
        0
      ),
    [farmSales]
  );

  /*
   * IMPORTANT:
   * Do not clamp the balance to zero.
   *
   * A negative balance reveals overselling, missing opening
   * stock, a missing conversion, or an incorrect transfer.
   */
  const currentOilBalance = useMemo(
    () =>
      openingStockLitres +
      totalOilProduced -
      totalOilSold -
      palmOilTransferred,
    [
      openingStockLitres,
      totalOilProduced,
      totalOilSold,
      palmOilTransferred,
    ]
  );

  /* =======================================================
     FARM KULI-KULI OIL STOCK

     Opening stock + purchases - farm sales - transfers.
  ======================================================= */

  const kuliKuliStock = useMemo(() => {
    const purchasedLitres = purchasedMaterials.reduce(
      (total, material) => {
        if (getMaterialType(material) !== "kuliKuli") {
          return total;
        }

        return (
          total + getKuliKuliPurchaseLitres(material)
        );
      },
      0
    );

    const soldLitres = farmSales.reduce(
      (total, sale) =>
        total + getKuliKuliLitresSold(sale),
      0
    );

    const availableLitres =
      openingKuliKuliLitres +
      purchasedLitres -
      soldLitres -
      kuliKuliTransferred;

    return {
      openingLitres: openingKuliKuliLitres,
      purchasedLitres,
      soldLitres,
      transferredLitres: kuliKuliTransferred,
      availableLitres,
    };
  }, [
    openingKuliKuliLitres,
    purchasedMaterials,
    farmSales,
    kuliKuliTransferred,
  ]);

  /* =======================================================
     FARM HONEY STOCK

     Opening bottles + purchases - farm sales - transfers.
  ======================================================= */

  const honeyStock = useMemo(() => {
    const purchasedBottles = purchasedMaterials.reduce(
      (total, material) => {
        if (getMaterialType(material) !== "honey") {
          return total;
        }

        return total + getHoneyPurchaseBottles(material);
      },
      0
    );

    const soldBottles = farmSales.reduce(
      (total, sale) =>
        total + getHoneyBottlesSold(sale),
      0
    );

    const availableBottles =
      openingHoneyBottles +
      purchasedBottles -
      soldBottles -
      honeyTransferred;

    return {
      openingBottles: openingHoneyBottles,
      purchasedBottles,
      soldBottles,
      transferredBottles: honeyTransferred,
      availableBottles,
    };
  }, [
    openingHoneyBottles,
    purchasedMaterials,
    farmSales,
    honeyTransferred,
  ]);

  /* =======================================================
     PALM-OIL PACKAGING BALANCES

     Packaging is separate from the oil inside it.

     Only farm sales deduct containers from farm packaging
     stock. Shop sales do not reduce this balance.
  ======================================================= */

  const containerStock = useMemo(() => {
    const containerTypes = [
      {
        key: "75cl",
        label: "75cl Bottles",
        image: seventyFL,
      },
      {
        key: "1L",
        label: "1L Bottles",
        image: seventyFL,
      },
      {
        key: "5L",
        label: "5L Jerrycans",
        image: fiveL,
      },
    ];

    return containerTypes.map((container) => {
      const purchased = purchasedMaterials.reduce(
        (total, material) => {
          if (getMaterialType(material) !== container.key) {
            return total;
          }

          return total + getMaterialQuantity(material);
        },
        0
      );

      const used = farmSales.reduce((total, sale) => {
        if (!saleAffectsContainerStock(sale)) {
          return total;
        }

        if (
          getContainerTypeFromSale(sale) !== container.key
        ) {
          return total;
        }

        return total + getSaleQuantity(sale);
      }, 0);

      return {
        ...container,
        purchased,
        used,
        remaining: purchased - used,
      };
    });
  }, [purchasedMaterials, farmSales]);

  /* =======================================================
     RECENT MATERIAL PURCHASES
  ======================================================= */

  const recentMaterials = useMemo(
    () =>
      [...materials].sort(
        (a, b) =>
          getTimestamp(getRecordDate(b)) -
          getTimestamp(getRecordDate(a))
      ),
    [materials]
  );

  /* =======================================================
     STOCK WARNINGS
  ======================================================= */

  const stockWarnings = useMemo(() => {
    const warnings = [];

    if (currentOilBalance < 0) {
      warnings.push(
        `Farm palm oil is short by ${formatLitres(
          Math.abs(currentOilBalance)
        )}.`
      );
    }

    if (kuliKuliStock.availableLitres < 0) {
      warnings.push(
        `Farm Kuli-Kuli oil is short by ${formatLitres(
          Math.abs(kuliKuliStock.availableLitres)
        )}.`
      );
    }

    if (honeyStock.availableBottles < 0) {
      warnings.push(
        `Farm honey is short by ${formatNumber(
          Math.abs(honeyStock.availableBottles)
        )} bottles.`
      );
    }

    containerStock.forEach((container) => {
      if (container.remaining < 0) {
        warnings.push(
          `${container.label} are short by ${formatNumber(
            Math.abs(container.remaining)
          )}.`
        );
      }
    });

    return warnings;
  }, [
    currentOilBalance,
    kuliKuliStock.availableLitres,
    honeyStock.availableBottles,
    containerStock,
  ]);

  /* =======================================================
     ACCESSIBLE LIVE SUMMARY
  ======================================================= */

  useEffect(() => {
    if (loading) return;

    setLiveMessage(
      [
        `Farm palm oil available: ${formatNumber(
          currentOilBalance
        )} litres.`,
        `Farm Kuli-Kuli oil available: ${formatNumber(
          kuliKuliStock.availableLitres
        )} litres.`,
        `Farm Kuli-Kuli oil sold: ${formatNumber(
          kuliKuliStock.soldLitres
        )} litres.`,
        `Farm honey available: ${formatNumber(
          honeyStock.availableBottles
        )} bottles.`,
        `Valid transfers to shop: ${validTransfers.length}.`,
        `Stock warnings: ${stockWarnings.length}.`,
      ].join(" ")
    );
  }, [
    loading,
    currentOilBalance,
    kuliKuliStock.availableLitres,
    kuliKuliStock.soldLitres,
    honeyStock.availableBottles,
    validTransfers.length,
    stockWarnings.length,
  ]);

  /* =======================================================
     LOADING STATE
  ======================================================= */

  if (loading) {
    return (
      <div className="stock-container">
        <div className="stock-loading">
          <div className="stock-spinner" />

          <h2>Loading Stock Tracker</h2>

          <p>
            Connecting to Afubia Farms stock records...
          </p>
        </div>
      </div>
    );
  }

  /* =======================================================
     MAIN UI
  ======================================================= */

  return (
    <div className="stock-container">
      <header className="stock-header">
        <div>
          <span className="stock-eyebrow">
            AFUBIA FARMS
          </span>

          <h1>Farm Stock Tracker</h1>

          <p>
            Monitor farm palm oil, Kuli-Kuli oil, original
            honey, packaging, material purchases and stock
            transfers to the shop.
          </p>
        </div>

        <div className="stock-status">
          <span className="stock-live-dot" />
          Live Firestore Data
        </div>
      </header>

      {error && (
        <div className="stock-error" role="alert">
          <strong>Data loading issue</strong>
          <p>{error}</p>
        </div>
      )}

      <div
        className="stock-live-message"
        role="status"
        aria-live="polite"
      >
        {liveMessage}
      </div>

      {/* STOCK WARNING */}

      {stockWarnings.length > 0 && (
        <section
          className="stock-error"
          role="alert"
          aria-live="polite"
        >
          <strong>Stock balance warning</strong>

          <p>
            One or more stock balances are negative. Review
            the records below to identify missing stock,
            overselling, or incorrect transfers.
          </p>

          <ul>
            {stockWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      )}

      {/* FARM STOCK SUMMARY */}

      <section className="stock-summary">
        <article className="stock-summary-card">
          <div className="stock-material-icon">
            <StockImage
              src={oilContainers}
              alt="Palm oil containers"
              fallback="🛢️"
            />
          </div>

          <div>
            <span className="stock-eyebrow">
              FARM PALM OIL
            </span>

            <h2>Oil Available</h2>

            <strong>{formatLitres(currentOilBalance)}</strong>

            <p>
              Opening stock + oil turned − farm sales − shop
              transfers
            </p>
          </div>
        </article>

        <article className="stock-summary-card">
          <div className="stock-material-icon">
            <StockImage
              src={kuliKuli}
              alt="Kuli-Kuli oil"
              fallback="🫙"
            />
          </div>

          <div>
            <span className="stock-eyebrow">
              FARM KULI-KULI OIL
            </span>

            <h2>Kuli-Kuli Oil Available</h2>

            <strong>
              {formatLitres(kuliKuliStock.availableLitres)}
            </strong>

            <p>
              Opening + purchases − farm sales − shop
              transfers
            </p>
          </div>
        </article>

        <article className="stock-summary-card">
          <div className="stock-material-icon">
            <StockImage
              src={honey}
              alt="Original honey"
              fallback="🍯"
            />
          </div>

          <div>
            <span className="stock-eyebrow">
              FARM HONEY
            </span>

            <h2>Original Honey Available</h2>

            <strong>
              {formatNumber(honeyStock.availableBottles)}{" "}
              {honeyStock.availableBottles === 1
                ? "bottle"
                : "bottles"}
            </strong>

            <p>
              Opening + purchases − farm sales − shop
              transfers
            </p>
          </div>
        </article>

        <article className="stock-summary-card">
          <div className="stock-material-icon">
            <StockImage
              src={oilTurning}
              alt="Palm oil production"
              fallback="🏭"
            />
          </div>

          <div>
            <span className="stock-eyebrow">
              PRODUCTION
            </span>

            <h2>Oil Turned</h2>

            <strong>{formatLitres(totalOilProduced)}</strong>

            <p>Recorded palm-oil turning</p>
          </div>
        </article>

        <article className="stock-summary-card">
          <div className="stock-material-icon stock-emoji-icon">
            💰
          </div>

          <div>
            <span className="stock-eyebrow">
              PURCHASES
            </span>

            <h2>Material Cost</h2>

            <strong>{formatCurrency(totalMaterialCost)}</strong>

            <p>Total recorded purchased materials</p>
          </div>
        </article>
      </section>

      {/* FARM-TO-SHOP TRANSFERS */}

      <section className="stock-section">
        <div className="stock-section-header">
          <div>
            <span className="stock-eyebrow">
              FARM TO SHOP
            </span>

            <h2>Stock Transferred to Shop</h2>

            <p>
              Transfers reduce farm stock but are not counted
              as purchases, production or sales.
            </p>
          </div>

          <span className="stock-status">
            {validTransfers.length} transfers
          </span>
        </div>

        <div className="stock-list">
          <article className="stock-item">
            <div className="stock-material-icon">
              <StockImage
                src={oilContainers}
                alt="Palm oil"
                fallback="🛢️"
              />
            </div>

            <div className="stock-item-details">
              <h3>Palm Oil Transferred</h3>

              <div className="stock-meta">
                <span>Farm → Shop</span>
                <span>Not recorded as a sale</span>
              </div>
            </div>

            <div className="stock-item-cost">
              <span>Total transferred</span>

              <strong>
                {formatLitres(palmOilTransferred)}
              </strong>
            </div>
          </article>

          <article className="stock-item">
            <div className="stock-material-icon">
              <StockImage
                src={kuliKuli}
                alt="Kuli-Kuli oil"
                fallback="🫙"
              />
            </div>

            <div className="stock-item-details">
              <h3>Kuli-Kuli Oil Transferred</h3>

              <div className="stock-meta">
                <span>Farm → Shop</span>
                <span>Measured in litres</span>
              </div>
            </div>

            <div className="stock-item-cost">
              <span>Total transferred</span>

              <strong>
                {formatLitres(kuliKuliTransferred)}
              </strong>
            </div>
          </article>

          <article className="stock-item">
            <div className="stock-material-icon">
              <StockImage
                src={honey}
                alt="Honey"
                fallback="🍯"
              />
            </div>

            <div className="stock-item-details">
              <h3>Honey Transferred</h3>

              <div className="stock-meta">
                <span>Farm → Shop</span>
                <span>Measured in bottles</span>
              </div>
            </div>

            <div className="stock-item-cost">
              <span>Total transferred</span>

              <strong>
                {formatNumber(honeyTransferred)} bottles
              </strong>
            </div>
          </article>
        </div>
      </section>

      {/* INDEPENDENT FARM PRODUCT BALANCES */}

      <section className="stock-section">
        <div className="stock-section-header">
          <div>
            <span className="stock-eyebrow">
              FARM PRODUCT MOVEMENT
            </span>

            <h2>Independent Farm Product Balances</h2>

            <p>
              Only farm sales reduce these balances. Shop
              sales are excluded.
            </p>
          </div>
        </div>

        <div className="stock-list">
          {/* PALM OIL */}

          <article className="stock-item">
            <div className="stock-material-icon">
              <StockImage
                src={oilContainers}
                alt="Palm oil"
                fallback="🛢️"
              />
            </div>

            <div className="stock-item-details">
              <h3>Palm Oil</h3>

              <div className="stock-meta">
                <span>
                  Opening: {formatLitres(openingStockLitres)}
                </span>

                <span>
                  Turned: {formatLitres(totalOilProduced)}
                </span>

                <span>
                  Farm sales: {formatLitres(totalOilSold)}
                </span>

                <span>
                  Transferred: {formatLitres(palmOilTransferred)}
                </span>
              </div>
            </div>

            <div className="stock-item-cost">
              <span>Farm available</span>

              <strong>{formatLitres(currentOilBalance)}</strong>
            </div>
          </article>

          {/* KULI-KULI OIL */}

          <article className="stock-item">
            <div className="stock-material-icon">
              <StockImage
                src={kuliKuli}
                alt="Kuli-Kuli oil"
                fallback="🫙"
              />
            </div>

            <div className="stock-item-details">
              <h3>Kuli-Kuli Oil</h3>

              <div className="stock-meta">
                <span>
                  Opening:{" "}
                  {formatLitres(kuliKuliStock.openingLitres)}
                </span>

                <span>
                  Purchased:{" "}
                  {formatLitres(kuliKuliStock.purchasedLitres)}
                </span>

                <span>
                  Farm sales:{" "}
                  {formatLitres(kuliKuliStock.soldLitres)}
                </span>

                <span>
                  Transferred:{" "}
                  {formatLitres(kuliKuliStock.transferredLitres)}
                </span>
              </div>
            </div>

            <div className="stock-item-cost">
              <span>Farm available</span>

              <strong>
                {formatLitres(kuliKuliStock.availableLitres)}
              </strong>
            </div>
          </article>

          {/* HONEY */}

          <article className="stock-item">
            <div className="stock-material-icon">
              <StockImage
                src={honey}
                alt="Original honey"
                fallback="🍯"
              />
            </div>

            <div className="stock-item-details">
              <h3>Original Honey</h3>

              <div className="stock-meta">
                <span>
                  Opening:{" "}
                  {formatNumber(honeyStock.openingBottles)} bottles
                </span>

                <span>
                  Purchased:{" "}
                  {formatNumber(honeyStock.purchasedBottles)} bottles
                </span>

                <span>
                  Farm sales:{" "}
                  {formatNumber(honeyStock.soldBottles)} bottles
                </span>

                <span>
                  Transferred:{" "}
                  {formatNumber(honeyStock.transferredBottles)} bottles
                </span>
              </div>
            </div>

            <div className="stock-item-cost">
              <span>Farm available</span>

              <strong>
                {formatNumber(honeyStock.availableBottles)} bottles
              </strong>
            </div>
          </article>
        </div>
      </section>

      {/* PALM-OIL PACKAGING BALANCES */}

      <section className="stock-section">
        <div className="stock-section-header">
          <div>
            <span className="stock-eyebrow">
              PACKAGING
            </span>

            <h2>Palm Oil Container Balance</h2>

            <p>
              Tracks 75cl bottles, 1L bottles and 5L
              jerrycans separately from honey and Kuli-Kuli oil.
            </p>
          </div>
        </div>

        <div className="stock-list">
          {containerStock.map((container) => (
            <article
              className="stock-item"
              key={container.key}
            >
              <div className="stock-material-icon">
                <StockImage
                  src={
                    container.key === "5L"
                      ? fiveL
                      : container.key === "75cl"
                        ? seventyFL
                        : oilContainers
                  }
                  alt={container.label}
                  fallback="🧴"
                />
              </div>

              <div className="stock-item-details">
                <h3>{container.label}</h3>

                <div className="stock-meta">
                  <span>
                    Purchased:{" "}
                    {formatNumber(container.purchased)}
                  </span>

                  <span>
                    Used by farm sales:{" "}
                    {formatNumber(container.used)}
                  </span>
                </div>
              </div>

              <div className="stock-item-cost">
                <span>Remaining</span>

                <strong>
                  {formatNumber(container.remaining)}
                </strong>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* MATERIAL PURCHASE HISTORY */}

      <section className="stock-section">
        <div className="stock-section-header">
          <div>
            <span className="stock-eyebrow">
              PURCHASE HISTORY
            </span>

            <h2>Recent Material Records</h2>

            <p>
              Recent records from the existing Firestore
              materials collection.
            </p>
          </div>

          <span className="stock-status">
            {recentMaterials.length} records
          </span>
        </div>

        {recentMaterials.length === 0 ? (
          <div className="stock-empty">
            <div>📦</div>

            <h3>No material records yet</h3>

            <p>
              Purchased materials will appear here when they
              are saved in Afubia Farms.
            </p>
          </div>
        ) : (
          <div className="stock-list">
            {recentMaterials.map((material) => {
              const type = getMaterialType(material);

              let displayedQuantity =
                getMaterialQuantity(material);

              let displayedUnit = "units";

              if (type === "kuliKuli") {
                displayedQuantity =
                  getKuliKuliPurchaseLitres(material);

                displayedUnit = "L";
              } else if (type === "honey") {
                displayedQuantity =
                  getHoneyPurchaseBottles(material);

                displayedUnit = "bottles";
              } else if (type === "75cl") {
                displayedUnit = "75cl bottles";
              } else if (type === "1L") {
                displayedUnit = "1L bottles";
              } else if (type === "5L") {
                displayedUnit = "5L jerrycans";
              }

              let materialImage = null;
              let materialImageAlt = "Material";
              let materialFallback = "📦";

              if (type === "honey") {
                materialImage = honey;
                materialImageAlt = "Honey";
                materialFallback = "🍯";
              } else if (type === "kuliKuli") {
                materialImage = kuliKuli;
                materialImageAlt = "Kuli-Kuli oil";
                materialFallback = "🫙";
              } else if (
                ["75cl", "1L", "5L"].includes(type)
              ) {
                materialImage =
                  type === "5L" ? fiveL : seventyFL;

                materialImageAlt = "Palm oil containers";
                materialFallback = "🧴";
              }

              return (
                <article
                  className="stock-item"
                  key={material.id}
                >
                  <div className="stock-material-icon">
                    <StockImage
                      src={materialImage}
                      alt={materialImageAlt}
                      fallback={materialFallback}
                    />
                  </div>

                  <div className="stock-item-details">
                    <h3>
                      {getMaterialName(material) ||
                        "Unnamed Material"}
                    </h3>

                    <div className="stock-meta">
                      <span>
                        Quantity:{" "}
                        {formatNumber(displayedQuantity)}{" "}
                        {displayedUnit}
                      </span>

                      <span className="stock-date">
                        {formatDate(getRecordDate(material))}
                      </span>

                      <span>
                        Status:{" "}
                        {getStatus(material) || "Recorded"}
                      </span>
                    </div>
                  </div>

                  <div className="stock-item-cost">
                    <span>Recorded Cost</span>

                    <strong>
                      {formatCurrency(getMaterialCost(material))}
                    </strong>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* DATABASE ACTIVITY */}

      <section className="stock-section">
        <div className="stock-section-header">
          <div>
            <span className="stock-eyebrow">
              DATABASE ACTIVITY
            </span>

            <h2>Stock Data Summary</h2>

            <p>
              Overview of records used by the farm stock
              calculations.
            </p>
          </div>
        </div>

        <div className="stock-summary">
          <article className="stock-summary-card">
            <div className="stock-material-icon stock-emoji-icon">
              📦
            </div>

            <div>
              <h2>Materials</h2>

              <strong>{materials.length}</strong>

              <p>Firestore material records</p>
            </div>
          </article>

          <article className="stock-summary-card">
            <div className="stock-material-icon stock-emoji-icon">
              🧾
            </div>

            <div>
              <h2>Sales</h2>

              <strong>{sales.length}</strong>

              <p>All farm and shop sales records</p>
            </div>
          </article>

          <article className="stock-summary-card">
            <div className="stock-material-icon">
              <StockImage
                src={oilTurning}
                alt="Palm oil turning"
                fallback="🏭"
              />
            </div>

            <div>
              <h2>Oil Turning</h2>

              <strong>{conversions.length}</strong>

              <p>Firestore oil-turning records</p>
            </div>
          </article>

          <article className="stock-summary-card">
            <div className="stock-material-icon stock-emoji-icon">
              🔄
            </div>

            <div>
              <h2>Stock Transfers</h2>

              <strong>{validTransfers.length}</strong>

              <p>Valid farm-to-shop transfers</p>
            </div>
          </article>
        </div>
      </section>

      <footer className="stock-footer">
        © 2026 Afubia Farms • Palm Oil Sales System
      </footer>
    </div>
  );
}