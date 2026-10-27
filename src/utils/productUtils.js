/* =========================================================
   AFUBIA FARMS
   PRODUCT UTILITIES
========================================================= */

import PRODUCTS from "../data/products";

/* =========================================================
   NUMBER HELPER
========================================================= */

export const toNumber = (value) => {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }

  const cleaned = String(value)
    .replace(/[₦,\s]/g, "")
    .trim();

  const number = Number(cleaned);

  return Number.isFinite(number)
    ? number
    : 0;
};

/* =========================================================
   FIND PRODUCT FROM SALE
========================================================= */

export const findProductFromSale = (sale) => {
  if (!sale) {
    return null;
  }

  const productId =
    sale.productId;

  if (productId) {
    const byId = PRODUCTS.find(
      (product) =>
        product.id === productId
    );

    if (byId) {
      return byId;
    }
  }

  const productType =
    sale.productType;

  if (productType) {
    const byType = PRODUCTS.find(
      (product) =>
        product.productType ===
        productType
    );

    if (byType) {
      return byType;
    }
  }

  const productName = String(
    sale.productName ??
      sale.product ??
      ""
  ).toLowerCase();

  if (
    productName.includes("honey")
  ) {
    return PRODUCTS.find(
      (product) =>
        product.id === "honey-75cl"
    );
  }

  if (
    productName.includes("kuli")
  ) {
    return PRODUCTS.find(
      (product) =>
        product.id ===
        "kuli-kuli-oil-5l"
    );
  }

  if (
    productName.includes("30l") &&
    productName.includes("keg")
  ) {
    return PRODUCTS.find(
      (product) =>
        product.id ===
        "palm-oil-30l-keg"
    );
  }

  if (
    productName.includes("5l")
  ) {
    return PRODUCTS.find(
      (product) =>
        product.id ===
        "palm-oil-5l"
    );
  }

  if (
    productName.includes("1l")
  ) {
    return PRODUCTS.find(
      (product) =>
        product.id ===
        "palm-oil-1l"
    );
  }

  if (
    productName.includes("75cl")
  ) {
    return PRODUCTS.find(
      (product) =>
        product.id ===
        "palm-oil-75cl"
    );
  }

  return null;
};

/* =========================================================
   GET SALE QUANTITY
========================================================= */

export const getSaleQuantity = (
  sale
) => {
  return toNumber(
    sale?.quantity ??
      sale?.quantitySold ??
      sale?.QuantitySold ??
      sale?.Quantity_Sold ??
      sale?.quantity_sold
  );
};

/* =========================================================
   GET SALE LITRES

   Only Palm Oil sales affect Palm Oil stock.

   Honey and Kuli-Kuli Oil are deliberately excluded.
========================================================= */

export const getPalmOilLitresFromSale = (
  sale
) => {
  const product =
    findProductFromSale(sale);

  if (
    !product ||
    !product.affectsOilStock
  ) {
    return 0;
  }

  const storedLitres =
    sale?.litresSold ??
    sale?.totalLitres ??
    sale?.litres ??
    sale?.quantityLitres;

  if (
    storedLitres !== undefined &&
    storedLitres !== null &&
    storedLitres !== ""
  ) {
    return toNumber(
      storedLitres
    );
  }

  return (
    getSaleQuantity(sale) *
    toNumber(
      product.sizeLitres
    )
  );
};

/* =========================================================
   CHECK WHETHER SALE USES PALM OIL STOCK
========================================================= */

export const saleAffectsPalmOilStock = (
  sale
) => {
  const product =
    findProductFromSale(sale);

  return Boolean(
    product?.affectsOilStock
  );
};

/* =========================================================
   CHECK WHETHER SALE USES PACKAGING STOCK
========================================================= */

export const saleAffectsContainerStock = (
  sale
) => {
  const product =
    findProductFromSale(sale);

  return Boolean(
    product?.affectsContainerStock
  );
};

/* =========================================================
   PRODUCT CATEGORY
========================================================= */

export const getSaleCategory = (
  sale
) => {
  const product =
    findProductFromSale(sale);

  return (
    product?.category ||
    sale?.category ||
    "Other"
  );
};