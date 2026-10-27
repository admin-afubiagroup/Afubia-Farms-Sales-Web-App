
/* eslint-disable no-unused-vars */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";

import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "./firebase.utils";
import { balance, assertAvailable } from './inventoryValidation.js';

/* =========================================================
   COLLECTIONS AND BRANCHES
========================================================= */

export const COLLECTIONS = {
  sales: "sales",
  conversions: "conversions",
  materials: "materials",
  shopOpeningStock: "shopOpeningStock",
  users: "users",
  settings: "settings",
};

export const BRANCHES = {
  OGIDAN: {
    id: "ogidan",
    name: "Ogidan Shop",
  },
  KARA: {
    id: "kara",
    name: "Kara Shop",
  },
};

export const NOMINAL_KEG_CAPACITY_LITRES = 30;
export const USABLE_LITRES_PER_KEG = 27;

const TIME_ZONE = "Africa/Lagos";

/* =========================================================
   GENERAL HELPERS
========================================================= */

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const number = Number(
    String(value).replace(/[₦,\s]/g, "").trim()
  );

  return Number.isFinite(number) ? number : 0;
};

const cleanString = (value) => String(value ?? "").trim();

export const normalizeBranchId = (value) => {
  const branch = cleanString(value)
    .toLowerCase()
    .replace(/[_\s]+/g, "-");

  if (["ogidan", "ogidan-shop"].includes(branch)) {
    return BRANCHES.OGIDAN.id;
  }

  if (["kara", "kara-shop"].includes(branch)) {
    return BRANCHES.KARA.id;
  }

  return "";
};

export const getBranchName = (branchId) => {
  const normalizedId = normalizeBranchId(branchId);

  if (normalizedId === BRANCHES.OGIDAN.id) {
    return BRANCHES.OGIDAN.name;
  }

  if (normalizedId === BRANCHES.KARA.id) {
    return BRANCHES.KARA.name;
  }

  return "Unassigned";
};

const getNigeriaDateTime = () => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
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

const getCurrentUser = () => {
  if (!auth.currentUser) {
    const error = new Error(
      "You must be logged in before saving a business record."
    );

    error.code = "auth/not-authenticated";
    throw error;
  }

  return auth.currentUser;
};

const getUserProfile = async (user) => {
  const userRef = doc(db, COLLECTIONS.users, user.uid);
  const snapshot = await getDoc(userRef);

  return snapshot.exists() ? snapshot.data() : {};
};

const isAdministrator = (profile) => {
  const role = cleanString(
    profile.role || profile.userRole
  ).toLowerCase();

  return [
    "admin",
    "administrator",
    "superadmin",
    "super_admin",
  ].includes(role);
};

const normalizeCategory = (
  category,
  productName,
  productType
) => {
  const value = [
    category,
    productName,
    productType,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    value.includes("honey") ||
    value.includes("sweetener")
  ) {
    return "Honey";
  }

  if (
    value.includes("kuli") ||
    value.includes("groundnut oil")
  ) {
    return "Kuli-Kuli Oil";
  }

  if (
    value.includes("palm oil") ||
    value.includes("red oil")
  ) {
    return "Palm Oil";
  }

  return cleanString(category) || "Other";
};

const normalizeLocation = (value, fallback = "farm") => {
  const location = cleanString(value).toLowerCase();

  if (
    [
      "shop",
      "store",
      "retail-shop",
      "shop stock",
      "shop inventory",
    ].includes(location)
  ) {
    return "shop";
  }

  if (location === "farm") {
    return "farm";
  }

  return fallback;
};

/* =========================================================
   SAVE RECORD WITH USER AND BRANCH INFORMATION
========================================================= */

const addRecord = async (collectionName, data) => {
  const user = getCurrentUser();
  const currentDateTime = getNigeriaDateTime();
  const profile = await getUserProfile(user);

  if (profile.active === false) {
    const error = new Error(
      "Your account is inactive. Please contact the administrator."
    );

    error.code = "account/inactive";
    throw error;
  }

  const admin =
    isAdministrator(profile) ||
    String(user.email || "").trim().toLowerCase() ===
      "chukwuamakanwachukwu@outlook.com";

  /*
   * Salespeople use their assigned profile branch.
   * Administrators may specify a branch in the record options.
   */
  const requestedBranch = admin
    ? data.branchId || data.branch || data.branchName
    : profile.branchId || profile.branch || profile.branchName;

  const branchId = normalizeBranchId(requestedBranch);

  /*
   * If an administrator supplies a branch, reject invalid values
   * rather than silently assigning the record to an unknown branch.
   *
   * For a salesperson without a configured branch, retain an
   * explicit Unassigned marker until their profile is configured.
   */
  if (!branchId) {
    throw new Error(
      admin
        ? "Choose Kara Shop or Ogidan Shop on the admin dashboard before saving this record."
        : "Your staff account has no valid assigned branch. Ask the administrator to assign Kara Shop or Ogidan Shop."
    );
  }

  const recordData = {
    ...data,

    userId: user.uid,
    userEmail: user.email || "",
    userDisplayName:
      profile.displayName || user.displayName || "",
    userRole: admin
      ? (profile.role || profile.userRole || "admin")
      : (profile.role || profile.userRole || "salesgirl"),
    source: admin ? "admin" : (data.source || "salesgirl"),
    recordedByUid: user.uid,
    recordedByName: profile.displayName || user.displayName || "",
    createdBy: user.uid,
    createdByName: profile.displayName || user.displayName || "",

    staffId:
      profile.staffId || profile.employeeId || "",
    staffName:
      profile.displayName || user.displayName || "",

    branchId,
    branchName: getBranchName(branchId),

    recordDate:
      data.recordDate || currentDateTime.recordDate,
    recordTime:
      data.recordTime || currentDateTime.recordTime,
    dateTime:
      data.dateTime || currentDateTime.dateTime,

    recordedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    timestamp: serverTimestamp(),

    createdAtClient:
      data.createdAtClient || new Date().toISOString(),
  };

  // Sales and oil-turning records are written directly to Firestore so the
  // app does not depend on a deployed Cloud Function (which requires Blaze).
  // Inventory is checked against this shop's current records before writing.
  // Firestore rules still enforce authentication, role, branch, and staff hours.
  if ([COLLECTIONS.sales, COLLECTIONS.conversions].includes(collectionName)) {
    const inventoryCollections = [
      COLLECTIONS.sales,
      COLLECTIONS.conversions,
      COLLECTIONS.materials,
      COLLECTIONS.shopOpeningStock,
    ];
    const inventoryRecords = {};

    await Promise.all(inventoryCollections.map(async (name) => {
      const recordsQuery = query(
        collection(db, name),
        where('branchId', '==', branchId),
      );
      const snapshot = await getDocs(recordsQuery);
      inventoryRecords[name] = snapshot.docs.map((item) => item.data());
    }));

    const stockBalance = balance({
      sales: inventoryRecords[COLLECTIONS.sales] || [],
      conversions: inventoryRecords[COLLECTIONS.conversions] || [],
      materials: inventoryRecords[COLLECTIONS.materials] || [],
      shopOpeningStock: inventoryRecords[COLLECTIONS.shopOpeningStock] || [],
    });
    assertAvailable(collectionName, recordData, stockBalance);
  }

  // Opening stock and purchased materials affect inventory and must remain
  // administrator-only. Firestore rules independently enforce this restriction.
  if ([COLLECTIONS.materials, COLLECTIONS.shopOpeningStock].includes(collectionName) && !admin) {
    throw new Error('Only an administrator can record purchased materials or shop opening stock.');
  }

  const recordRef = doc(collection(db, collectionName));
  const batch = writeBatch(db);
  batch.set(recordRef, recordData);

  // The activity feed is written in the same atomic batch as the business
  // record, so the admin never receives an alert for a failed save.
  if ([COLLECTIONS.sales, COLLECTIONS.conversions].includes(collectionName)) {
    const notificationRef = doc(collection(db, 'branchNotifications'));
    const isSale = collectionName === COLLECTIONS.sales;
    batch.set(notificationRef, {
      type: isSale ? 'sale_recorded' : 'oil_turned',
      recordId: recordRef.id,
      recordCollection: collectionName,
      userId: user.uid,
      staffId: recordData.staffId || '',
      staffName: recordData.staffName || recordData.userDisplayName || user.email || 'Salesperson',
      branchId,
      branchName: getBranchName(branchId),
      productName: recordData.productName || recordData.product || recordData.activity || (isSale ? 'Product' : 'Oil turning'),
      totalAmount: toNumber(recordData.totalAmount ?? recordData.total ?? recordData.amount),
      quantity: toNumber(recordData.quantitySold ?? recordData.quantity ?? recordData.kegCount),
      read: false,
      createdAt: serverTimestamp(),
      createdAtClient: new Date().toISOString(),
    });
  }

  await batch.commit();
  return { id: recordRef.id, ...recordData };
};

// ShopStock uses this wrapper so branch/staff metadata and timestamps are
// consistently added before the administrator-only Firestore write.
export const saveShopOpeningStockRecord = (data) =>
  addRecord(COLLECTIONS.shopOpeningStock, data);

/* =========================================================
   USER PROFILE
========================================================= */

export const createOrUpdateUserProfile = async (
  user,
  role = "salesgirl",
  extra = {}
) => {
  if (!user?.uid) {
    throw new Error("No authenticated Firebase user found.");
  }

  const userRef = doc(db, COLLECTIONS.users, user.uid);
  const existingSnapshot = await getDoc(userRef);

  const existingData = existingSnapshot.exists()
    ? existingSnapshot.data()
    : {};

  const requestedBranch =
    extra.branchId ??
    extra.branch ??
    extra.branchName ??
    existingData.branchId ??
    existingData.branch ??
    existingData.branchName ??
    "";

  const branchId = normalizeBranchId(requestedBranch);

  if (requestedBranch && !branchId) {
    throw new Error(
      "Invalid branch. Choose Ogidan Shop or Kara Shop."
    );
  }

  const profileData = {
    uid: user.uid,

    email:
      extra.email ||
      user.email ||
      existingData.email ||
      "",

    displayName:
      extra.displayName !== undefined
        ? extra.displayName
        : user.displayName ||
          existingData.displayName ||
          "",

    role:
      existingData.role ||
      existingData.userRole ||
      role ||
      "salesgirl",

    active:
      extra.active !== undefined
        ? Boolean(extra.active)
        : existingData.active !== undefined
          ? Boolean(existingData.active)
          : true,

    branchId,
    branchName: getBranchName(branchId),

    staffId:
      extra.staffId ??
      existingData.staffId ??
      existingData.employeeId ??
      "",

    updatedAt: serverTimestamp(),
  };

  if (!existingSnapshot.exists()) {
    profileData.createdAt = serverTimestamp();
  }

  await setDoc(userRef, profileData, { merge: true });

  return userRef;
};

/* =========================================================
   SAVE SHOP OPENING STOCK
========================================================= */

export const saveShopOpeningStock = async (options = {}) => {
  const {
    productId = "",
    productName = "",
    product = productName,
    productType = "",
    category = "",
    productCategory = category,
    size = "",
    unit = "",
    stockUnit = "",
    quantity = 0,
    quantityLitres,
    quantityBottles,
    quantityKegs,
    kegCount,
    bottles75cl,
    bottles1L,
    jerrycans5L,
    stockContainerType = "",
    notes = "",
    description = "",
    recordDate,
    recordTime,
    dateTime,
    branchId,
    branch,
    branchName,
  } = options;

  const cleanName = cleanString(productName || product);

  if (!cleanName) {
    throw new Error(
      "A product name is required for opening stock."
    );
  }

  const normalizedCategory = normalizeCategory(
    category || productCategory,
    cleanName,
    productType
  );

  const normalizedUnit = cleanString(
    stockUnit || unit
  ).toLowerCase();

  const numericQuantity = toNumber(quantity);
  const numericLitres = toNumber(quantityLitres);
  const numericBottles = toNumber(quantityBottles);
  const numericKegs = toNumber(quantityKegs ?? kegCount);

  const isHoney = normalizedCategory === "Honey";
  const isPalmOil = normalizedCategory === "Palm Oil";

  if (
    numericQuantity < 0 ||
    numericLitres < 0 ||
    numericBottles < 0 ||
    numericKegs < 0
  ) {
    throw new Error(
      "Opening stock quantities cannot be negative."
    );
  }

  const isKegStock =
    normalizedUnit.includes("keg") ||
    cleanString(stockContainerType).toLowerCase() === "keg" ||
    numericKegs > 0;

  const normalizedStockUnit = isKegStock
    ? "kegs"
    : isHoney
      ? "bottles"
      : normalizedUnit.includes("75cl")
        ? "75cl bottles"
        : normalizedUnit.includes("1l") ||
            normalizedUnit.includes("1 litre")
          ? "1L bottles"
          : normalizedUnit.includes("5l") ||
              normalizedUnit.includes("jerrycan")
            ? "5L jerrycans"
            : "litres";

  if (isKegStock && !isPalmOil) {
    throw new Error(
      "Unturned keg stock is only supported for Palm Oil."
    );
  }

  if (
    isKegStock &&
    numericKegs <= 0 &&
    numericQuantity <= 0
  ) {
    throw new Error("Enter a keg quantity greater than zero.");
  }

  if (
    !isKegStock &&
    numericQuantity <= 0 &&
    numericLitres <= 0 &&
    numericBottles <= 0
  ) {
    throw new Error(
      "Opening stock quantity must be greater than zero."
    );
  }

  const finalKegCount = isKegStock
    ? numericKegs || numericQuantity
    : 0;

  const finalQuantityLitres = isKegStock
    ? 0
    : isHoney
      ? 0
      : numericLitres > 0
        ? numericLitres
        : normalizedStockUnit === "75cl bottles"
          ? numericQuantity * 0.75
          : normalizedStockUnit === "1L bottles"
            ? numericQuantity
            : normalizedStockUnit === "5L jerrycans"
              ? numericQuantity * 5
              : numericQuantity;

  const finalQuantityBottles = isHoney
    ? numericBottles || numericQuantity
    : 0;

  const record = {
    recordType: "opening_stock",
    transactionType: "opening_stock",

    branchId,
    branch,
    branchName,

    productId,
    product: cleanName,
    productName: cleanName,
    productType: productType || normalizedCategory,
    category: normalizedCategory,
    productCategory: normalizedCategory,
    stockCategory: normalizedCategory,
    size,

    unit: normalizedStockUnit,
    stockUnit: normalizedStockUnit,

    stockContainerType:
      stockContainerType ||
      (isKegStock
        ? "keg"
        : normalizedStockUnit === "75cl bottles"
          ? "75cl"
          : normalizedStockUnit === "1L bottles"
            ? "1L"
            : normalizedStockUnit === "5L jerrycans"
              ? "5L"
              : normalizedStockUnit),

    quantity: isKegStock
      ? finalKegCount
      : isHoney
        ? finalQuantityBottles
        : numericQuantity,

    quantityKegs: finalKegCount,
    kegCount: finalKegCount,

    nominalKegCapacityLitres: isKegStock
      ? NOMINAL_KEG_CAPACITY_LITRES
      : 0,

    usableLitresPerKeg: isKegStock
      ? USABLE_LITRES_PER_KEG
      : 0,

    potentialUsableLitres: isKegStock
      ? finalKegCount * USABLE_LITRES_PER_KEG
      : 0,

    quantityLitres: finalQuantityLitres,
    litres: finalQuantityLitres,

    quantityBottles: finalQuantityBottles,
    bottles: finalQuantityBottles,

    bottles75cl: toNumber(bottles75cl),
    bottles1L: toNumber(bottles1L),
    jerrycans5L: toNumber(jerrycans5L),

    notes,
    description:
      description || notes || "Shop opening stock",

    stockLocation: "shop",
    saleLocation: "shop",
    location: "shop",
    isShopSale: false,

    affectsShopStock: true,
    affectsFarmStock: false,
    affectsStock: true,
    affectsSales: false,
    affectsProfit: false,

    recordDate,
    recordTime,
    dateTime,
    status: "completed",
  };

  return addRecord(
    COLLECTIONS.shopOpeningStock,
    record
  );
};

/* =========================================================
   SAVE SALE
========================================================= */

export const saveSale = async (options = {}) => {
  const {
    productType = "",
    product = productType,
    productName = product,
    productId = "",
    name = productName,
    category = "",
    productCategory = category,
    stockCategory = category,

    quantitySold = 0,
    quantity = quantitySold,

    unitPrice = 0,
    price = unitPrice,

    totalAmount,
    total,
    amount,

    litresSold = 0,
    litersSold,
    quantityLitres,
    quantityBottles,

    bottleSizeLitres = 0,
    productVolumeLitres,
    containerVolumeLitres,

    palmOilLitresSold,
    oilLitresSold,
    kuliKuliLitresSold,
    kuliKuliOilLitresSold,

    honeyBottlesSold,
    honeyQuantitySold,
    bottlesSold,

    bottles75clSold,
    bottles1LSold,
    jerrycans5LSold,
    containerCountSold,
    containerSizeLitres,
    stockContainerType,

    source = "salesgirl",
    recordType = "sale",
    paymentMethod = "",
    customerName = "",
    description = "",

    affectsStock = true,
    affectsProfit = true,
    affectsOilStock,
    affectsKuliKuliStock,
    affectsHoneyStock,
    affectsContainerStock,

    saleLocation = "farm",
    stockLocation,
    location,
    storeLocation,
    isShopSale,

    status = "completed",
    recordDate,
    recordTime,
    dateTime,

    ...extraFields
  } = options;

  const cleanName = cleanString(
    productName || product || name || productType
  );

  if (!cleanName) {
    throw new Error("Product name is required.");
  }

  const numericQuantity = toNumber(
    quantitySold ?? quantity
  );

  const numericUnitPrice = toNumber(
    unitPrice ?? price
  );

  if (numericQuantity <= 0) {
    throw new Error(
      "Sale quantity must be greater than zero."
    );
  }

  const normalizedCategory = normalizeCategory(
    category || productCategory || stockCategory,
    cleanName,
    productType
  );

  const normalizedLocation = normalizeLocation(
    stockLocation || saleLocation || location || storeLocation,
    "farm"
  );

  const shopSale =
    isShopSale === true ||
    normalizedLocation === "shop";

  const volume = toNumber(
    productVolumeLitres ??
      containerVolumeLitres ??
      bottleSizeLitres ??
      containerSizeLitres
  );

  const explicitTotal = toNumber(
    totalAmount ?? total ?? amount
  );

  const numericTotal =
    explicitTotal > 0
      ? explicitTotal
      : numericQuantity * numericUnitPrice;

  const isPalmOil = normalizedCategory === "Palm Oil";
  const isKuliKuli =
    normalizedCategory === "Kuli-Kuli Oil";
  const isHoney = normalizedCategory === "Honey";

  const palmLitres =
    toNumber(palmOilLitresSold ?? oilLitresSold) ||
    (isPalmOil ? numericQuantity * volume : 0);

  const kuliLitres =
    toNumber(
      kuliKuliLitresSold ?? kuliKuliOilLitresSold
    ) ||
    (isKuliKuli ? numericQuantity * volume : 0);

  const honeyBottles =
    toNumber(
      honeyBottlesSold ??
        honeyQuantitySold ??
        bottlesSold ??
        quantityBottles
    ) ||
    (isHoney ? numericQuantity : 0);

  const totalOilLitres =
    toNumber(litresSold ?? litersSold ?? quantityLitres) ||
    palmLitres + kuliLitres;

  const normalizedSource =
    String(source).toLowerCase() === "admin"
      ? "admin"
      : "salesgirl";

  return addRecord(COLLECTIONS.sales, {
    ...extraFields,

    recordType,
    status,
    source: normalizedSource,

    productId,
    product: cleanName,
    productName: cleanName,
    name: cleanName,
    productType: cleanString(productType || cleanName),

    category: normalizedCategory,
    productCategory: normalizedCategory,
    stockCategory: normalizedCategory,

    quantitySold: numericQuantity,
    quantity: numericQuantity,

    unitPrice: numericUnitPrice,
    price: numericUnitPrice,
    sellingPrice: numericUnitPrice,

    totalAmount: numericTotal,
    total: numericTotal,
    amount: numericTotal,
    revenue: numericTotal,

    productVolumeLitres: volume,
    containerVolumeLitres: volume,
    bottleSizeLitres: volume,

    containerSizeLitres:
      toNumber(containerSizeLitres) || volume,

    // Exact packaged-unit quantities for inventory deductions.
    stockContainerType: cleanString(stockContainerType),

    containerCountSold:
      toNumber(containerCountSold) || numericQuantity,

    bottles75clSold: toNumber(bottles75clSold),
    bottles1LSold: toNumber(bottles1LSold),
    jerrycans5LSold: toNumber(jerrycans5LSold),

    litresSold: totalOilLitres,
    litersSold: totalOilLitres,
    quantityLitres: totalOilLitres,
    quantityLiters: totalOilLitres,
    totalLitres: totalOilLitres,
    totalLiters: totalOilLitres,

    palmOilLitresSold: palmLitres,
    oilLitresSold: palmLitres,

    kuliKuliLitresSold: kuliLitres,
    kuliKuliOilLitresSold: kuliLitres,

    honeyBottlesSold: honeyBottles,
    honeyQuantitySold: honeyBottles,
    bottlesSold: honeyBottles,
    quantityBottles: honeyBottles,
    bottleQuantity: honeyBottles,
    bottles: honeyBottles,

    saleLocation: normalizedLocation,
    stockLocation: normalizedLocation,
    location: normalizedLocation,
    storeLocation: normalizedLocation,
    isShopSale: shopSale,

    affectsStock: Boolean(affectsStock),
    affectsProfit: Boolean(affectsProfit),

    affectsOilStock:
      affectsOilStock !== undefined
        ? Boolean(affectsOilStock)
        : isPalmOil,

    affectsKuliKuliStock:
      affectsKuliKuliStock !== undefined
        ? Boolean(affectsKuliKuliStock)
        : isKuliKuli,

    affectsHoneyStock:
      affectsHoneyStock !== undefined
        ? Boolean(affectsHoneyStock)
        : isHoney,

    affectsContainerStock:
      affectsContainerStock !== undefined
        ? Boolean(affectsContainerStock)
        : isPalmOil,

    paymentMethod: cleanString(paymentMethod),
    customerName: cleanString(customerName),

    description:
      description ||
      `Sale of ${numericQuantity} ${cleanName}`,

    recordDate,
    recordTime,
    dateTime,
  });
};

export const saveShopSale = async (options = {}) =>
  saveSale({
    ...options,
    saleLocation: "shop",
    stockLocation: "shop",
    location: "shop",
    storeLocation: "shop",
    isShopSale: true,
  });

/* =========================================================
   SAVE CONVERSION
========================================================= */

export const saveConversion = async (options = {}) => {
  const {
    kegCount,
    kegs,

    nominalKegCapacityLitres = NOMINAL_KEG_CAPACITY_LITRES,
    usableLitresPerKeg = USABLE_LITRES_PER_KEG,
    litresPerKeg,

    litresProduced,
    totalLitres,

    bottles75cl = 0,
    bottles75clProduced,

    bottles1L = 0,
    bottles1LProduced,

    jerrycans5L = 0,
    jerrycans5LProduced,

    litresFrom75cl,
    litresFrom1L,
    litresFrom5L,

    litresUsed,
    litresRemaining,
    oilProducedLitres,
    oilUsedLitres,
    oilRemainingLitres,

    recordType = "conversion",
    source = "salesgirl",
    activity = "Palm oil conversion / turning",
    description = "",

    stockLocation,
    location,
    saleLocation,

    affectsShopStock,
    affectsFarmStock,
    affectsStock = true,
    affectsProfit = false,

    recordDate,
    recordTime,
    dateTime,

    ...extraFields
  } = options;

  const numericKegs = toNumber(kegCount ?? kegs);

  const numeric75cl = toNumber(
    bottles75clProduced ?? bottles75cl
  );

  const numeric1L = toNumber(
    bottles1LProduced ?? bottles1L
  );

  const numeric5L = toNumber(
    jerrycans5LProduced ?? jerrycans5L
  );

  if (numericKegs <= 0) {
    throw new Error(
      "Conversion keg quantity must be greater than zero."
    );
  }

  // Preserve the existing business rule: 27 usable litres per keg.
  const numericProduced =
    numericKegs * USABLE_LITRES_PER_KEG;

  const numericFrom75cl = numeric75cl * 0.75;
  const numericFrom1L = numeric1L;
  const numericFrom5L = numeric5L * 5;

  const computedUsed =
    numericFrom75cl +
    numericFrom1L +
    numericFrom5L;

  const numericUsed =
    litresUsed !== undefined && litresUsed !== null
      ? toNumber(litresUsed)
      : computedUsed;

  if (numericUsed <= 0) {
    throw new Error(
      "Record at least one filled container."
    );
  }

  if (numericUsed > numericProduced + 0.000001) {
    throw new Error(
      `Containers require ${numericUsed}L, but the kegs provide ${numericProduced}L of usable oil.`
    );
  }

  const numericRemaining = Math.max(
    0,
    numericProduced - numericUsed
  );

  const normalizedLocation = normalizeLocation(
    stockLocation || location || saleLocation,
    "unspecified"
  );

  const finalSource =
    String(source).toLowerCase() === "admin"
      ? "admin"
      : "salesgirl";

  return addRecord(COLLECTIONS.conversions, {
    ...extraFields,

    recordType,
    source: finalSource,
    activity,

    description:
      description ||
      `${numericKegs} keg(s) turned into ${numeric75cl} 75cl bottles, ${numeric1L} 1L bottles and ${numeric5L} 5L jerrycans.`,

    kegCount: numericKegs,
    kegs: numericKegs,

    nominalKegCapacityLitres:
      NOMINAL_KEG_CAPACITY_LITRES,

    usableLitresPerKeg: USABLE_LITRES_PER_KEG,
    litresPerKeg: USABLE_LITRES_PER_KEG,

    litresProduced: numericProduced,
    totalLitres: numericProduced,
    oilProducedLitres: numericProduced,

    bottles75cl: numeric75cl,
    bottles75clProduced: numeric75cl,
    total75clBottles: numeric75cl,
    litresFrom75cl: numericFrom75cl,

    bottles1L: numeric1L,
    bottles1LProduced: numeric1L,
    total1LBottles: numeric1L,
    litresFrom1L: numericFrom1L,

    jerrycans5L: numeric5L,
    jerrycans5LProduced: numeric5L,
    total5LJerrycans: numeric5L,
    litresFrom5L: numericFrom5L,

    litresUsed: numericUsed,
    oilUsedLitres: numericUsed,

    litresRemaining: numericRemaining,
    oilRemainingLitres: numericRemaining,

    stockLocation: normalizedLocation,
    location: normalizedLocation,
    saleLocation: normalizedLocation,

    affectsShopStock:
      affectsShopStock !== undefined
        ? Boolean(affectsShopStock)
        : normalizedLocation === "shop",

    affectsFarmStock:
      affectsFarmStock !== undefined
        ? Boolean(affectsFarmStock)
        : normalizedLocation === "farm",

    affectsStock: Boolean(affectsStock),
    affectsProfit: Boolean(affectsProfit),

    recordDate,
    recordTime,
    dateTime,
  });
};

/* =========================================================
   SAVE MATERIAL
========================================================= */

export const saveMaterial = async (options = {}) => {
  const {
    materialName = "",
    name = materialName,
    materialType = "",

    quantity = 0,
    purchasedQuantity = quantity,
    remainingQuantity = purchasedQuantity,

    unit = "items",
    unitCost = 0,
    totalCost = 0,
    cost = totalCost,

    status = "Purchased",
    source = "admin-materials",
    recordType = "material",
    expenseType = "business-material",

    affectsProfit = true,
    affectsStock = true,
    description = "",

    ...extraFields
  } = options;

  const cleanName = cleanString(materialName || name);

  if (!cleanName) {
    throw new Error("Material name is required.");
  }

  const numericPurchased = toNumber(purchasedQuantity);
  const numericQuantity = toNumber(quantity);
  const numericTotalCost = toNumber(totalCost ?? cost);

  const finalQuantity =
    numericPurchased > 0
      ? numericPurchased
      : numericQuantity;

  if (finalQuantity <= 0) {
    throw new Error(
      "Material quantity must be greater than zero."
    );
  }

  if (numericTotalCost < 0) {
    throw new Error("Material cost cannot be negative.");
  }

  return addRecord(COLLECTIONS.materials, {
    ...extraFields,

    materialName: cleanName,
    name: cleanName,
    material: cleanName,
    materialType: materialType || cleanName,

    quantity: finalQuantity,
    purchasedQuantity: finalQuantity,
    remainingQuantity: toNumber(remainingQuantity),
    originalQuantity: finalQuantity,

    unit,
    unitCost: toNumber(unitCost),

    totalCost: numericTotalCost,
    cost: numericTotalCost,

    status,
    source,
    recordType,
    expenseType,

    affectsProfit: Boolean(affectsProfit),
    affectsStock: Boolean(affectsStock),

    description:
      description || `Purchase of ${cleanName}`,
  });
};

/* =========================================================
   BUSINESS SETTINGS
========================================================= */

export const saveBusinessSettings = async ({
  openingStockLitres = 0,
  monthlyProfitTarget = 0,
  dailySalesTarget = 0,
}) => {
  const user = getCurrentUser();
  const settingsRef = doc(db, COLLECTIONS.settings, "business");

  await setDoc(
    settingsRef,
    {
      openingStockLitres: toNumber(openingStockLitres),
      monthlyProfitTarget: toNumber(monthlyProfitTarget),
      dailySalesTarget: toNumber(dailySalesTarget),

      updatedBy: user.uid,
      updatedByEmail: user.email || "",
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return settingsRef;
};

export const subscribeToBusinessSettings = (
  callback,
  onError
) => {
  const settingsRef = doc(
    db,
    COLLECTIONS.settings,
    "business"
  );

  return onSnapshot(
    settingsRef,
    (snapshot) => {
      callback(
        snapshot.exists()
          ? { id: snapshot.id, ...snapshot.data() }
          : {
              openingStockLitres: 0,
              monthlyProfitTarget: 0,
              dailySalesTarget: 0,
            }
      );
    },
    (error) => {
      console.error(
        "Business settings listener error:",
        error
      );

      if (typeof onError === "function") {
        onError(error);
      }
    }
  );
};

/* =========================================================
   USER PROFILE SYNC
========================================================= */

export const startUserProfileSync = (
  defaultRole = "salesgirl"
) =>
  onAuthStateChanged(auth, async (user) => {
    if (!user?.uid) {
      return;
    }

    try {
      const userRef = doc(
        db,
        COLLECTIONS.users,
        user.uid
      );

      const snapshot = await getDoc(userRef);

      // Never overwrite an existing staff/admin assignment.
      if (snapshot.exists()) {
        return;
      }

      await createOrUpdateUserProfile(
        user,
        defaultRole,
        {
          active: true,
          email: user.email || "",
          displayName: user.displayName || "",
        }
      );
    } catch (error) {
      console.error(
        "User profile sync error:",
        error
      );
    }
  });
