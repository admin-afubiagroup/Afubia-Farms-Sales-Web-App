
/* =========================================================
   AFUBIA FARMS
   PRODUCT CATALOGUE

   All sellable products and their default prices live here.

   Item codes are permanent business identifiers.
   Do not reuse an item code for a different product.

   Prices can later be moved to Firestore so an admin can
   change them without editing application code.
========================================================= */

export const PRODUCTS = [
  {
    id: "palm-oil-75cl",
    itemCode: "AF-001",
    name: "75cl Palm Oil",
    productName: "75cl Palm Oil",
    category: "Palm Oil",
    productType: "75cl",
    size: "75cl",
    sizeLitres: 0.75,
    unit: "bottle",
    price: 1500,
    audio: "75clbottle2",
    affectsOilStock: true,
    affectsContainerStock: true,
  },

  {
    id: "palm-oil-1l",
    itemCode: "AF-002",
    name: "1L Palm Oil",
    productName: "1-Litre Palm Oil",
    category: "Palm Oil",
    productType: "1L",
    size: "1L",
    sizeLitres: 1,
    unit: "bottle",
    price: 3000,
    audio: "1Lbottle2",
    affectsOilStock: true,
    affectsContainerStock: true,
  },

  {
    id: "palm-oil-5l",
    itemCode: "AF-003",
    name: "5L Palm Oil",
    productName: "5-Litres Palm Oil",
    category: "Palm Oil",
    productType: "5L",
    size: "5L",
    sizeLitres: 5,
    unit: "jerrycan",
    price: 15000,
    audio: "5ljerrycan2",
    affectsOilStock: true,
    affectsContainerStock: true,
  },

  {
    id: "palm-oil-30l-keg",
    itemCode: "AF-004",
    name: "30L Palm Oil Keg",
    productName: "30-Litres Palm Oil Keg",
    category: "Palm Oil",
    productType: "30L_Keg",
    size: "30L Keg",
    sizeLitres: 30,
    unit: "keg",
    price: 54000,
    audio: "kegs",
    affectsOilStock: true,
    affectsContainerStock: true,
  },

  {
    id: "honey-75cl",
    itemCode: "AF-005",
    name: "75cl Honey",
    productName: "Original Honey",
    category: "Honey",
    productType: "Honey_75cl",
    size: "75cl",
    sizeLitres: 0.75,
    unit: "bottle",
    price: 10000,
    audio: "75clbottle2",
    affectsOilStock: false,
    affectsContainerStock: false,
  },

  {
    id: "kuli-kuli-oil-5l",
    itemCode: "AF-006",
    name: "5L Kuli-Kuli Oil",
    productName: "5-Litres Kuli-Kuli Oil",
    category: "Kuli-Kuli Oil",
    productType: "KuliKuli_5L",
    size: "5L",
    sizeLitres: 5,
    unit: "jerrycan",
    price: 20000,
    audio: "5ljerrycan2",
    affectsOilStock: false,
    affectsContainerStock: false,
  },
];

/* =========================================================
   FIND PRODUCT BY ID
========================================================= */

export const getProductById = (id) => {
  return PRODUCTS.find(
    (product) => product.id === id
  );
};

/* =========================================================
   FIND PRODUCT BY TYPE
========================================================= */

export const getProductByType = (productType) => {
  return PRODUCTS.find(
    (product) =>
      product.productType === productType
  );
};

/* =========================================================
   FIND PRODUCT BY ITEM CODE
========================================================= */

export const getProductByCode = (itemCode) => {
  if (
    typeof itemCode !== "string" ||
    !itemCode.trim()
  ) {
    return undefined;
  }

  const normalizedCode = itemCode
    .trim()
    .toUpperCase();

  return PRODUCTS.find(
    (product) =>
      product.itemCode.toUpperCase() ===
      normalizedCode
  );
};

/* =========================================================
   CHECK ITEM CODE UNIQUENESS
========================================================= */

export const hasUniqueProductCodes = (
  products = PRODUCTS
) => {
  const codes = products.map((product) =>
    String(product.itemCode || "")
      .trim()
      .toUpperCase()
  );

  return (
    codes.every(Boolean) &&
    new Set(codes).size === codes.length
  );
};

/* =========================================================
   FORMAT PRICE
========================================================= */

export const formatProductPrice = (price) => {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(price);
};

export default PRODUCTS;
