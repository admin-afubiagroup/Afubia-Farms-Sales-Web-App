/* =========================================================
   AFUBIA FARMS
   PRODUCT CATALOGUE

   All sellable products and their default prices live here.

   IMPORTANT:
   Prices can later be moved to Firestore so an admin can
   change them without editing application code.
========================================================= */

export const PRODUCTS = [
  {
    id: "palm-oil-75cl",
    name: "75cl Palm Oil",
    productName: "75cl Palm Oil",
    category: "Palm Oil",
    productType: "75cl",
    size: "75cl",
    sizeLitres: 0.75,
    unit: "bottle",
    price: 1500,
    audio: "/75clbottle2.m4a",
    affectsOilStock: true,
    affectsContainerStock: true,
  },

  {
    id: "palm-oil-1l",
    name: "1L Palm Oil",
    productName: "1-Litre Palm Oil",
    category: "Palm Oil",
    productType: "1L",
    size: "1L",
    sizeLitres: 1,
    unit: "bottle",
    price: 3000,
    audio: "/1Lbottle2.m4a",
    affectsOilStock: true,
    affectsContainerStock: true,
  },

  {
    id: "palm-oil-5l",
    name: "5L Palm Oil",
    productName: "5-Litres Palm Oil",
    category: "Palm Oil",
    productType: "5L",
    size: "5L",
    sizeLitres: 5,
    unit: "jerrycan",
    price: 15000,
    audio: "/5ljerrycan2.m4a",
    affectsOilStock: true,
    affectsContainerStock: true,
  },

  {
    id: "palm-oil-30l-keg",
    name: "30L Palm Oil Keg",
    productName: "30-Litres Palm Oil Keg",
    category: "Palm Oil",
    productType: "30L_Keg",
    size: "30L Keg",
    sizeLitres: 30,
    unit: "keg",
    price: 54000,
    audio: "/kegs.m4a",
    affectsOilStock: true,
    affectsContainerStock: true,
  },

  {
    id: "honey-75cl",
    name: "75cl Honey",
    productName: "Original Honey",
    category: "Honey",
    productType: "Honey_75cl",
    size: "75cl",
    sizeLitres: 0.75,
    unit: "bottle",
    price: 10000,
    audio: "/75clbottle2.m4a",
    affectsOilStock: false,
    affectsContainerStock: false,
  },

  {
    id: "kuli-kuli-oil-5l",
    name: "5L Kuli-Kuli Oil",
    productName: "5-Litres Kuli-Kuli Oil",
    category: "Kuli-Kuli Oil",
    productType: "KuliKuli_5L",
    size: "5L",
    sizeLitres: 5,
    unit: "jerrycan",
    price: 20000,
    audio: "/5ljerrycan2.m4a",
    affectsOilStock: false,
    affectsContainerStock: false,
  },
];

/* =========================================================
   FIND PRODUCT
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