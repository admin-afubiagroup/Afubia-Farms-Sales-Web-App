
/* eslint-disable no-unused-vars */

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  collection,
  onSnapshot,
} from "firebase/firestore";

import ResponsiveLayout from "./ResponsiveLayout";

import {
  playOnPageOpen,
  playAudio,
  speakAudio,
  stopAllAudio,
} from "./AudioManager";

import { saveSale } from "../Firebase/businessFirestore";
import { db } from "../Firebase/firebase.utils";

import { formatProductPrice } from "../data/products";

import "./Sales.css";

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

  const cleaned = String(value)
    .replace(/[₦,\s]/g, "")
    .trim();

  const number = Number(cleaned);

  return Number.isFinite(number) ? number : 0;
};

const formatNaira = (value) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(toNumber(value));

const roundStock = (value) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const normalizeStockText = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

/* =========================================================
   AUDIO HELPERS

   Audio failures must never prevent a sale from saving.
========================================================= */

const safeAudio = async (src) => {
  if (!src) return;

  try {
    await playAudio(src);
  } catch (error) {
    console.warn(`Audio failed: ${src}`, error);
  }
};

const safeSpeak = async (value) => {
  try {
    await speakAudio(String(value));
  } catch (error) {
    console.warn("Speech audio failed:", error);
  }
};

/* =========================================================
   PRODUCT HELPERS
========================================================= */

const getProductName = (product) =>
  product?.productName ||
  product?.name ||
  "Product";

const getProductPrice = (product) =>
  toNumber(product?.price ?? product?.unitPrice);

const getProductVolume = (product) =>
  toNumber(
    product?.sizeLitres ??
    product?.productVolumeLitres ??
    product?.bottleSizeLitres ??
    product?.containerVolumeLitres
  );

const getCategory = (product) => {
  if (!product) return "Other";

  const category = normalizeStockText(
    product.category ||
    product.productCategory ||
    ""
  );

  const stockType = normalizeStockText(
    product.stockType || ""
  );

  const description = normalizeStockText([
    product.productName,
    product.name,
    product.productType,
    product.type,
    product.size,
    product.unit,
  ].filter(Boolean).join(" "));

  if (
    category.includes("honey") ||
    stockType.includes("honey") ||
    description.includes("honey") ||
    description.includes("sweetener")
  ) {
    return "Honey";
  }

  if (
    category.includes("kuli") ||
    category.includes("groundnut oil") ||
    stockType.includes("kuli") ||
    description.includes("kuli") ||
    description.includes("groundnut oil")
  ) {
    return "Kuli-Kuli Oil";
  }

  if (
    category.includes("palm") ||
    category.includes("red oil") ||
    stockType.includes("palm") ||
    product.affectsOilStock === true ||
    product.isOilProduct === true ||
    description.includes("palm oil") ||
    description.includes("red oil")
  ) {
    return "Palm Oil";
  }

  return product.category ||
    product.productCategory ||
    "Other";
};

const isKegProduct = (product) => {
  if (!product) return false;

  const productType = normalizeStockText(
    product.productType ||
    product.type ||
    ""
  );

  const unit = normalizeStockText(product.unit || "");
  const size = normalizeStockText(product.size || "");
  const name = normalizeStockText(getProductName(product));

  return (
    product.isKeg === true ||
    productType.includes("keg") ||
    unit.includes("keg") ||
    size.includes("keg") ||
    name.includes("keg")
  );
};

/* =========================================================
   SHOP STOCK HELPERS

   These categories must match the categories tracked by
   ShopStock.jsx:

   - Palm Oil: litres
   - Kuli-Kuli Oil: litres
   - Honey: bottles
========================================================= */

const TRACKED_CATEGORIES = [
  "Palm Oil",
  "Kuli-Kuli Oil",
  "Honey",
];

const getTrackedCategory = (record) => {
  if (!record) return "";

  const description = normalizeStockText([
    record.productType,
    record.product,
    record.productName,
    record.itemName,
    record.materialName,
    record.category,
    record.productCategory,
    record.stockCategory,
    record.stockType,
    record.item,
    record.name,
  ].filter(Boolean).join(" "));

  if (
    description.includes("honey") ||
    description.includes("sweetener")
  ) {
    return "Honey";
  }

  if (
    description.includes("kuli") ||
    description.includes("groundnut oil")
  ) {
    return "Kuli-Kuli Oil";
  }

  if (
    description.includes("palm oil") ||
    description.includes("red oil")
  ) {
    return "Palm Oil";
  }

  return "";
};

const isCancelledRecord = (record) => {
  const status = normalizeStockText(
    record?.status || record?.saleStatus || ""
  );

  return [
    "cancelled",
    "canceled",
    "void",
    "deleted",
  ].includes(status);
};

const isShopSaleRecord = (record) => {
  const location = normalizeStockText(
    record?.stockLocation ||
    record?.saleLocation ||
    record?.location ||
    record?.storeLocation ||
    ""
  );

  return (
    record?.isShopSale === true ||
    [
      "shop",
      "store",
      "shop stock",
      "shop inventory",
    ].includes(location)
  );
};

const getRecordUnit = (record) =>
  normalizeStockText(
    record?.stockUnit ||
    record?.unit ||
    record?.quantityUnit ||
    record?.productUnit ||
    record?.size ||
    ""
  );

const convertQuantityToLitres = (quantity, unit) => {
  const normalizedUnit = normalizeStockText(unit);

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
    normalizedUnit.includes("5 litre") ||
    normalizedUnit.includes("5 liter")
  ) {
    return quantity * 5;
  }

  if (
    normalizedUnit.includes("10l") ||
    normalizedUnit.includes("10 litre") ||
    normalizedUnit.includes("10 liter")
  ) {
    return quantity * 10;
  }

  if (
    normalizedUnit.includes("20l") ||
    normalizedUnit.includes("20 litre") ||
    normalizedUnit.includes("20 liter")
  ) {
    return quantity * 20;
  }

  return quantity;
};

/*
 * Reads the quantity added to the shop's opening stock.
 * Oil quantities are normalized to litres.
 * Honey quantities are normalized to bottles.
 */
const getOpeningStockQuantity = (record, category) => {
  if (category === "Honey") {
    const quantity =
      record?.quantityBottles ??
      record?.bottles ??
      record?.bottleQuantity ??
      record?.quantity ??
      record?.amount ??
      0;

    return Math.max(0, toNumber(quantity));
  }

  const explicitLitres =
    record?.quantityLitres ??
    record?.litres ??
    record?.liters;

  if (
    explicitLitres !== undefined &&
    explicitLitres !== null &&
    explicitLitres !== ""
  ) {
    return Math.max(0, toNumber(explicitLitres));
  }

  const quantity = toNumber(
    record?.quantity ??
    record?.amount ??
    record?.totalQuantity
  );

  return Math.max(
    0,
    convertQuantityToLitres(
      quantity,
      getRecordUnit(record)
    )
  );
};

/*
 * Reads a shop sale's stock deduction.
 *
 * Category-specific fields are checked first so that
 * Palm Oil and Kuli-Kuli Oil never deduct from each
 * other's balances.
 */
const getSaleStockQuantity = (record, category) => {
  if (category === "Honey") {
    const candidates = [
      record?.honeyBottlesSold,
      record?.honeyQuantitySold,
      record?.bottlesSold,
      record?.quantityBottles,
      record?.bottleQuantity,
      record?.bottles,
    ];

    const explicitQuantity = candidates.find(
      (value) =>
        value !== undefined &&
        value !== null &&
        value !== ""
    );

    if (explicitQuantity !== undefined) {
      return Math.max(0, toNumber(explicitQuantity));
    }

    const unit = getRecordUnit(record);

    if (
      unit.includes("bottle") ||
      unit.includes("piece") ||
      unit.includes("unit")
    ) {
      return Math.max(
        0,
        toNumber(record?.quantitySold ?? record?.quantity)
      );
    }

    return 0;
  }

  const categorySpecificFields =
    category === "Palm Oil"
      ? [
          record?.palmOilLitresSold,
          record?.oilLitresSold,
        ]
      : [
          record?.kuliKuliLitresSold,
          record?.kuliKuliOilLitresSold,
        ];

  const explicitCategoryQuantity =
    categorySpecificFields.find(
      (value) =>
        value !== undefined &&
        value !== null &&
        value !== "" &&
        toNumber(value) > 0
    );

  if (explicitCategoryQuantity !== undefined) {
    return Math.max(0, toNumber(explicitCategoryQuantity));
  }

  const genericLitres = [
    record?.litresSold,
    record?.litersSold,
    record?.quantityLitres,
    record?.quantityLiters,
    record?.totalLitres,
    record?.totalLiters,
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
};

/* =========================================================
   COMPONENT
========================================================= */

const SalesForm = () => {
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState("");

  const [shopOpeningStock, setShopOpeningStock] = useState([]);
  const [shopSales, setShopSales] = useState([]);
  const [shopStockLoading, setShopStockLoading] = useState(true);
  const [shopStockError, setShopStockError] = useState("");

  const [item, setItem] = useState("");
  const [quantity, setQuantity] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [kegVolume, setKegVolume] = useState("");

  const [notification, setNotification] = useState({
    type: "",
    text: "",
  });

  const [submitting, setSubmitting] = useState(false);

  /* =======================================================
     LOAD ACTIVE PRODUCTS FROM FIRESTORE
  ======================================================= */

  useEffect(() => {
    setProductsLoading(true);
    setProductsError("");

    const unsubscribe = onSnapshot(
      collection(db, "products"),
      (snapshot) => {
        const activeProducts = snapshot.docs
          .map((document) => ({
            id: document.id,
            ...document.data(),
          }))
          .filter((product) => product.active !== false)
          .sort((a, b) =>
            getProductName(a).localeCompare(getProductName(b))
          );

        setProducts(activeProducts);
        setProductsLoading(false);

        setItem((currentItem) => {
          if (
            currentItem &&
            !activeProducts.some(
              (product) => product.id === currentItem
            )
          ) {
            return "";
          }

          return currentItem;
        });
      },
      (error) => {
        console.error(
          "Could not load products from Firestore:",
          error
        );

        setProductsError(
          "Products could not be loaded. Check your internet connection and Firestore permissions."
        );

        setProductsLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  /* =======================================================
     LIVE SHOP STOCK LISTENERS

     ShopStock.jsx uses these same two collections.
     When a sale is saved, this listener recalculates the
     available balance automatically.
  ======================================================= */

  useEffect(() => {
    setShopStockLoading(true);
    setShopStockError("");

    let openingStockLoaded = false;
    let salesLoaded = false;
    let hasStockError = false;

    const updateLoadingState = () => {
      if (openingStockLoaded && salesLoaded) {
        setShopStockLoading(false);
      }
    };

    const handleStockError = (error, source) => {
      console.error(
        `Could not load ${source} for shop stock:`,
        error
      );

      hasStockError = true;

      setShopStockError(
        "Shop stock could not be verified. Check your connection and Firestore permissions before selling tracked products."
      );

      if (source === "opening stock") {
        openingStockLoaded = true;
      }

      if (source === "sales") {
        salesLoaded = true;
      }

      updateLoadingState();
    };

    const unsubscribeOpeningStock = onSnapshot(
      collection(db, "shopOpeningStock"),
      (snapshot) => {
        setShopOpeningStock(
          snapshot.docs.map((document) => ({
            id: document.id,
            ...document.data(),
          }))
        );

        openingStockLoaded = true;
        updateLoadingState();

        if (!hasStockError) {
          setShopStockError("");
        }
      },
      (error) => handleStockError(error, "opening stock")
    );

    const unsubscribeSales = onSnapshot(
      collection(db, "sales"),
      (snapshot) => {
        setShopSales(
          snapshot.docs.map((document) => ({
            id: document.id,
            ...document.data(),
          }))
        );

        salesLoaded = true;
        updateLoadingState();

        if (!hasStockError) {
          setShopStockError("");
        }
      },
      (error) => handleStockError(error, "sales")
    );

    return () => {
      unsubscribeOpeningStock();
      unsubscribeSales();
    };
  }, []);

  /* =======================================================
     PAGE AUDIO
  ======================================================= */

  useEffect(() => {
    let cleanup;

    try {
      cleanup = playOnPageOpen("/sellpage.m4a");
    } catch (error) {
      console.warn("Sales page audio warning:", error);
    }

    return () => {
      if (typeof cleanup === "function") {
        cleanup();
      }

      stopAllAudio();
    };
  }, []);

  /* =======================================================
     CALCULATE CURRENT SHOP STOCK

     Opening stock adds to the balance.
     Completed shop sales subtract from the balance.
     Cancelled sales are ignored.
  ======================================================= */

  const shopStockBalances = useMemo(() => {
    const balances = {
      "Palm Oil": 0,
      "Kuli-Kuli Oil": 0,
      Honey: 0,
    };

    shopOpeningStock.forEach((record) => {
      if (isCancelledRecord(record)) return;

      const category = getTrackedCategory(record);

      if (!TRACKED_CATEGORIES.includes(category)) return;

      balances[category] += getOpeningStockQuantity(
        record,
        category
      );
    });

    shopSales
      .filter(
        (sale) =>
          isShopSaleRecord(sale) &&
          !isCancelledRecord(sale)
      )
      .forEach((sale) => {
        const category = getTrackedCategory(sale);

        if (!TRACKED_CATEGORIES.includes(category)) return;

        balances[category] -= getSaleStockQuantity(
          sale,
          category
        );
      });

    Object.keys(balances).forEach((category) => {
      balances[category] = roundStock(
        Math.max(0, balances[category])
      );
    });

    return balances;
  }, [shopOpeningStock, shopSales]);

  /* =======================================================
     SELECTED PRODUCT
  ======================================================= */

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === item),
    [products, item]
  );

  const selectedIsKeg = useMemo(
    () => isKegProduct(selectedProduct),
    [selectedProduct]
  );

  const selectedCategory = getCategory(selectedProduct);

  const selectedIsPalmOil =
    selectedCategory === "Palm Oil";

  const selectedIsKuliKuli =
    selectedCategory === "Kuli-Kuli Oil";

  const selectedIsHoney =
    selectedCategory === "Honey";

  const selectedStockIsTracked =
    TRACKED_CATEGORIES.includes(selectedCategory);

  const selectedAvailableStock = selectedStockIsTracked
    ? shopStockBalances[selectedCategory]
    : null;

  const selectedStockUnit = selectedIsHoney
    ? "bottle(s)"
    : "L";

  /* =======================================================
     QUANTITY AND PRICE
  ======================================================= */

  const numericQuantity = toNumber(quantity);

  const defaultProductPrice = selectedProduct
    ? getProductPrice(selectedProduct)
    : 0;

  const numericSellingPrice = selectedProduct
    ? selectedIsKeg
      ? toNumber(sellingPrice)
      : defaultProductPrice
    : 0;

  /* =======================================================
     PRODUCT VOLUME
  ======================================================= */

  const defaultProductVolume = selectedProduct
    ? getProductVolume(selectedProduct)
    : 0;

  const numericKegVolume = selectedIsKeg
    ? toNumber(kegVolume)
    : defaultProductVolume;

  const productVolume = selectedIsKeg
    ? numericKegVolume
    : defaultProductVolume;

  /* =======================================================
     TOTAL AMOUNT
  ======================================================= */

  const totalAmount =
    numericQuantity * numericSellingPrice;

  /* =======================================================
     CATEGORY-SPECIFIC STOCK DEDUCTIONS
  ======================================================= */

  const palmOilLitresSold = selectedIsPalmOil
    ? numericQuantity * productVolume
    : 0;

  const kuliKuliLitresSold = selectedIsKuliKuli
    ? numericQuantity * productVolume
    : 0;

  const honeyBottlesSold = selectedIsHoney
    ? numericQuantity
    : 0;

  const trackedOilLitresSold =
    palmOilLitresSold + kuliKuliLitresSold;

  const selectedStockDeduction = selectedIsHoney
    ? honeyBottlesSold
    : trackedOilLitresSold;

  const selectedStockFinished =
    selectedStockIsTracked &&
    !shopStockLoading &&
    !shopStockError &&
    selectedAvailableStock <= 0;

  const selectedStockExceeded =
    selectedStockIsTracked &&
    selectedStockDeduction > selectedAvailableStock + 0.000001;

  const priceDifference =
    selectedProduct && selectedIsKeg
      ? numericSellingPrice - defaultProductPrice
      : 0;

  /* =======================================================
     PRODUCT CHANGE
  ======================================================= */

  const handleProductChange = (event) => {
    setItem(event.target.value);
    setQuantity("");
    setSellingPrice("");
    setKegVolume("");

    setNotification({
      type: "",
      text: "",
    });
  };

  /* =======================================================
     SUBMIT SALE
  ======================================================= */

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (submitting) return;

    setNotification({
      type: "",
      text: "",
    });

    if (productsLoading) {
      setNotification({
        type: "warning",
        text: "Please wait while the products are loading.",
      });
      return;
    }

    if (productsError) {
      setNotification({
        type: "error",
        text: "Products are unavailable. Reload the page or check your connection before recording a sale.",
      });
      return;
    }

    if (!selectedProduct) {
      setNotification({
        type: "error",
        text: "Please select an available product.",
      });
      return;
    }

    if (
      !Number.isFinite(numericQuantity) ||
      numericQuantity <= 0
    ) {
      setNotification({
        type: "error",
        text: "Please enter a valid quantity.",
      });
      return;
    }

    if (
      !Number.isFinite(numericSellingPrice) ||
      numericSellingPrice <= 0
    ) {
      setNotification({
        type: "error",
        text: "Please enter a valid selling price.",
      });
      return;
    }

    if (
      selectedIsKeg &&
      (
        !Number.isFinite(numericKegVolume) ||
        numericKegVolume <= 0
      )
    ) {
      setNotification({
        type: "error",
        text: "Please enter the actual keg volume in litres.",
      });
      return;
    }

    if (
      (selectedIsPalmOil || selectedIsKuliKuli) &&
      productVolume <= 0
    ) {
      setNotification({
        type: "error",
        text: "This oil product needs a valid volume in litres.",
      });
      return;
    }

    /* -----------------------------------------------
       VERIFY TRACKED SHOP STOCK BEFORE SAVING
    ----------------------------------------------- */

    if (selectedStockIsTracked) {
      if (shopStockLoading) {
        setNotification({
          type: "warning",
          text: "Please wait while the shop stock balance loads.",
        });
        return;
      }

      if (shopStockError) {
        setNotification({
          type: "error",
          text: shopStockError,
        });
        return;
      }

      if (selectedAvailableStock <= 0) {
        setNotification({
          type: "error",
          text: `${selectedCategory} is finished in the shop. Record more opening stock before selling it.`,
        });
        return;
      }

      if (
        selectedStockDeduction >
        selectedAvailableStock + 0.000001
      ) {
        setNotification({
          type: "error",
          text:
            `Insufficient ${selectedCategory} stock. ` +
            `Available: ${selectedAvailableStock.toLocaleString()} ${selectedStockUnit}. ` +
            `Required: ${selectedStockDeduction.toLocaleString()} ${selectedStockUnit}.`,
        });
        return;
      }
    }

    setSubmitting(true);

    try {
      stopAllAudio();

      /* -----------------------------------------------
         ROLE AND SOURCE
      ----------------------------------------------- */

      const storedRole = (
        localStorage.getItem("afubiaUserRole") || ""
      ).toLowerCase();

      const userRole =
        storedRole === "admin"
          ? "admin"
          : "salesgirl";

      /* -----------------------------------------------
         PRODUCT INFORMATION
      ----------------------------------------------- */

      const productName = getProductName(selectedProduct);

      const oilStockAffected = selectedIsPalmOil;
      const kuliKuliStockAffected = selectedIsKuliKuli;
      const honeyStockAffected = selectedIsHoney;
      const containerStockAffected = selectedIsPalmOil;

      /* -----------------------------------------------
         SHOP STOCK LOCATION

         ShopStock.jsx recognises these fields to identify
         a shop sale. Keep them on every sale from this form.
      ----------------------------------------------- */

      const saleData = {
        recordType: "sale",
        activity: "Product sale",
        source: userRole,
        userRole,
        status: "completed",

        // Shop stock tracking
        isShopSale: true,
        stockLocation: "shop",
        saleLocation: "shop",
        location: "shop",
        storeLocation: "shop",

        // Product identity
        productId: selectedProduct.id,
        productName,
        product: productName,
        name: productName,

        productType:
          selectedProduct.productType ||
          selectedProduct.type ||
          selectedProduct.size ||
          productName,

        category: selectedCategory,
        productCategory: selectedCategory,
        stockCategory: selectedCategory,

        size: selectedProduct.size || "",
        unit: selectedProduct.unit || "",

        stockUnit: selectedIsHoney
          ? "bottles"
          : selectedStockIsTracked
            ? "litres"
            : selectedProduct.stockUnit ||
              selectedProduct.unit ||
              "",

        stockType:
          selectedProduct.stockType ||
          (
            selectedIsPalmOil
              ? "palmOil"
              : selectedIsKuliKuli
                ? "kuliKuli"
                : selectedIsHoney
                  ? "honey"
                  : "none"
          ),

        // Quantity sold as product units
        quantitySold: numericQuantity,
        quantity: numericQuantity,

        // Price
        unitPrice: numericSellingPrice,
        price: numericSellingPrice,
        sellingPrice: numericSellingPrice,
        listedPrice: defaultProductPrice,

        priceDifference,
        marketPrice: defaultProductPrice,

        marketPriceMin:
          selectedProduct.marketPriceMin ?? null,

        marketPriceMax:
          selectedProduct.marketPriceMax ?? null,

        // Revenue
        totalAmount,
        total: totalAmount,
        amount: totalAmount,
        revenue: totalAmount,

        // Product volume
        productVolumeLitres: productVolume,
        containerVolumeLitres: productVolume,
        bottleSizeLitres: productVolume,

        /*
         * Shared oil volume fields.
         * These now include Palm Oil OR Kuli-Kuli Oil,
         * not Palm Oil alone.
         */
        litresSold: trackedOilLitresSold,
        litersSold: trackedOilLitresSold,
        quantityLitres: trackedOilLitresSold,
        quantityLiters: trackedOilLitresSold,
        totalLitres: trackedOilLitresSold,
        totalLiters: trackedOilLitresSold,

        // Palm Oil-specific quantity
        oilLitresSold: palmOilLitresSold,
        palmOilLitresSold,

        // Kuli-Kuli Oil-specific quantity
        kuliKuliLitresSold,
        kuliKuliOilLitresSold: kuliKuliLitresSold,

        // Honey-specific quantity
        honeyBottlesSold,
        honeyQuantitySold: honeyBottlesSold,
        bottlesSold: honeyBottlesSold,
        quantityBottles: honeyBottlesSold,
        bottleQuantity: honeyBottlesSold,
        bottles: honeyBottlesSold,

        // Stock flags
        affectsStock:
          oilStockAffected ||
          kuliKuliStockAffected ||
          honeyStockAffected,

        affectsProfit: true,

        affectsOilStock: oilStockAffected,
        affectsKuliKuliStock: kuliKuliStockAffected,
        affectsHoneyStock: honeyStockAffected,

        affectsContainerStock: containerStockAffected,

        description: `${productName} sale`,
      };

      console.log("Saving sale record:", saleData);

      /*
       * Save the sale.
       *
       * ShopStock.jsx listens to the sales collection.
       * Once this record is saved, its balance will update.
       */
      await saveSale(saleData);

      setNotification({
        type: "success",
        text:
          `${productName} sale saved successfully. ` +
          (
            selectedStockIsTracked
              ? `Stock deduction: ${selectedStockDeduction.toLocaleString()} ${selectedStockUnit}.`
              : ""
          ),
      });

      setItem("");
      setQuantity("");
      setSellingPrice("");
      setKegVolume("");

      /* -----------------------------------------------
         AUDIO AFTER SUCCESSFUL SAVE
      ----------------------------------------------- */

      await safeAudio("/selly.m4a");
      await safeSpeak(numericQuantity);

      if (selectedProduct.audio) {
        await safeAudio(selectedProduct.audio);
      }

      await safeAudio("/for.m4a");
      await safeSpeak(formatNaira(totalAmount));

    } catch (error) {
      console.error("Sale save error:", error);

      let message = "We could not save the sale.";

      if (
        error?.code === "permission-denied" ||
        error?.code === "firestore/permission-denied"
      ) {
        message =
          "You do not have permission to save this sale.";
      } else if (
        error?.code === "unavailable" ||
        error?.code === "firestore/unavailable"
      ) {
        message =
          "Internet connection problem. Please try again.";
      } else if (
        error?.code === "auth/not-authenticated"
      ) {
        message =
          "Please log in again before recording a sale.";
      } else if (error?.message) {
        message = error.message;
      }

      setNotification({
        type: "error",
        text: message,
      });

      await safeAudio("/conversion_error.m4a");

    } finally {
      setSubmitting(false);
    }
  };

  /* =========================================================
     PRODUCT OPTIONS

     Tracked products are disabled when their category has
     no available shop stock.
  ========================================================= */

  const renderProductOptions = (category) =>
    products
      .filter(
        (product) => getCategory(product) === category
      )
      .map((product) => {
        const tracked = TRACKED_CATEGORIES.includes(category);

        const available = tracked
          ? shopStockBalances[category]
          : null;

        const finished =
          tracked &&
          !shopStockLoading &&
          !shopStockError &&
          available <= 0;

        const stockLabel = !tracked
          ? ""
          : shopStockLoading
            ? " — Checking stock..."
            : shopStockError
              ? " — Stock unavailable"
              : finished
                ? " — FINISHED"
                : category === "Honey"
                  ? ` — ${available.toLocaleString()} bottle(s) available`
                  : ` — ${available.toLocaleString()} L available`;

        return (
          <option
            key={product.id}
            value={product.id}
            disabled={finished}
          >
            {getProductName(product)} —{" "}
            {formatProductPrice(getProductPrice(product))}
            {stockLabel}
          </option>
        );
      });

  const otherProducts = products.filter(
    (product) =>
      !TRACKED_CATEGORIES.includes(getCategory(product))
  );

  /* =========================================================
     UI
  ========================================================= */

  return (
    <ResponsiveLayout>
      <div className="sales-page">

        <div className="sales-header">
          <span className="sales-eyebrow">
            AFUBIA FARMS
          </span>

          <h1>Record Today's Sale</h1>

          <p>
            Enter the product and quantity sold today.
          </p>
        </div>

        {/* NOTIFICATIONS */}

        {notification.text && (
          <div
            className={`sales-notification sales-notification-${notification.type}`}
            role="alert"
          >
            <div className="sales-notification-icon">
              {notification.type === "success" && "✓"}
              {notification.type === "error" && "×"}
              {notification.type === "warning" && "!"}
            </div>

            <div className="sales-notification-content">
              <strong>
                {notification.type === "success"
                  ? "Sale recorded"
                  : notification.type === "warning"
                    ? "Please check"
                    : "Sale not saved"}
              </strong>

              <span>{notification.text}</span>
            </div>

            <button
              type="button"
              className="sales-notification-close"
              onClick={() =>
                setNotification({ type: "", text: "" })
              }
              aria-label="Close notification"
            >
              ×
            </button>

            <div className="sales-notification-progress" />
          </div>
        )}

        {/* PRODUCT LOADING */}

        {productsLoading && (
          <div
            className="sales-notification sales-notification-warning"
            role="status"
          >
            <div className="sales-notification-icon">…</div>

            <div className="sales-notification-content">
              <strong>Loading products</strong>
              <span>
                Please wait while the catalogue loads.
              </span>
            </div>
          </div>
        )}

        {/* PRODUCT ERROR */}

        {!productsLoading && productsError && (
          <div
            className="sales-notification sales-notification-error"
            role="alert"
          >
            <div className="sales-notification-icon">!</div>

            <div className="sales-notification-content">
              <strong>Catalogue unavailable</strong>
              <span>{productsError}</span>
            </div>
          </div>
        )}

        {/* STOCK LOADING */}

        {shopStockLoading && (
          <div
            className="sales-notification sales-notification-warning"
            role="status"
          >
            <div className="sales-notification-icon">…</div>

            <div className="sales-notification-content">
              <strong>Checking shop stock</strong>
              <span>
                Tracked products will be available for sale
                once the current stock balance has loaded.
              </span>
            </div>
          </div>
        )}

        {/* STOCK ERROR */}

        {!shopStockLoading && shopStockError && (
          <div
            className="sales-notification sales-notification-error"
            role="alert"
          >
            <div className="sales-notification-icon">!</div>

            <div className="sales-notification-content">
              <strong>Shop stock unavailable</strong>
              <span>{shopStockError}</span>
            </div>
          </div>
        )}

        {/* EMPTY CATALOGUE */}

        {!productsLoading &&
          !productsError &&
          products.length === 0 && (
            <div
              className="sales-notification sales-notification-warning"
              role="status"
            >
              <div className="sales-notification-icon">!</div>

              <div className="sales-notification-content">
                <strong>No products available</strong>
                <span>
                  Ask the administrator to add and activate
                  products in the product catalogue.
                </span>
              </div>
            </div>
          )}

        {/* CURRENT SHOP STOCK SUMMARY */}

        {!shopStockLoading && !shopStockError && (
          <div className="sales-preview sales-stock-summary">
            <div className="sales-preview-item">
              <span>Palm Oil Available</span>
              <strong>
                {shopStockBalances["Palm Oil"].toLocaleString()} L
              </strong>
            </div>

            <div className="sales-preview-item">
              <span>Kuli-Kuli Oil Available</span>
              <strong>
                {shopStockBalances["Kuli-Kuli Oil"].toLocaleString()} L
              </strong>
            </div>

            <div className="sales-preview-item">
              <span>Honey Available</span>
              <strong>
                {shopStockBalances.Honey.toLocaleString()} bottle(s)
              </strong>
            </div>
          </div>
        )}

        <form
          className="sales-form"
          onSubmit={handleSubmit}
        >

          {/* PRODUCT */}

          <div className="sales-field">
            <label htmlFor="product">
              Product
            </label>

            <select
              id="product"
              value={item}
              onChange={handleProductChange}
              disabled={
                submitting ||
                productsLoading ||
                Boolean(productsError) ||
                products.length === 0
              }
              required
            >
              <option value="">
                Select product
              </option>

              {products.some(
                (product) => getCategory(product) === "Palm Oil"
              ) && (
                <optgroup label="Palm Oil">
                  {renderProductOptions("Palm Oil")}
                </optgroup>
              )}

              {products.some(
                (product) =>
                  getCategory(product) === "Kuli-Kuli Oil"
              ) && (
                <optgroup label="Kuli-Kuli Oil">
                  {renderProductOptions("Kuli-Kuli Oil")}
                </optgroup>
              )}

              {products.some(
                (product) => getCategory(product) === "Honey"
              ) && (
                <optgroup label="Honey">
                  {renderProductOptions("Honey")}
                </optgroup>
              )}

              {otherProducts.length > 0 && (
                <optgroup label="Other Products">
                  {otherProducts.map((product) => (
                    <option
                      key={product.id}
                      value={product.id}
                    >
                      {getProductName(product)} —{" "}
                      {formatProductPrice(
                        getProductPrice(product)
                      )}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>

            {selectedProduct && selectedStockIsTracked && (
              <small>
                {shopStockLoading
                  ? "Checking current stock..."
                  : shopStockError
                    ? "Stock could not be verified."
                    : selectedStockFinished
                      ? "This product is FINISHED. Record more shop stock before selling."
                      : `Available in shop: ${selectedAvailableStock.toLocaleString()} ${selectedStockUnit}.`}
              </small>
            )}
          </div>

          {/* QUANTITY */}

          <div className="sales-field">
            <label htmlFor="quantity">
              Quantity
            </label>

            <input
              id="quantity"
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(event) =>
                setQuantity(event.target.value)
              }
              placeholder="Enter quantity"
              disabled={
                submitting ||
                !selectedProduct ||
                selectedStockFinished ||
                (selectedStockIsTracked &&
                  (shopStockLoading || Boolean(shopStockError)))
              }
              required
            />
          </div>

          {/* SELLING PRICE */}

          {selectedProduct && (
            <div className="sales-field">
              <label htmlFor="sellingPrice">
                Selling Price
              </label>

              <input
                id="sellingPrice"
                type="number"
                min="1"
                step="100"
                value={
                  selectedIsKeg
                    ? sellingPrice
                    : defaultProductPrice
                }
                onChange={(event) =>
                  setSellingPrice(event.target.value)
                }
                placeholder={formatNaira(defaultProductPrice)}
                disabled={submitting || !selectedIsKeg}
                readOnly={!selectedIsKeg}
                required
              />

              {selectedIsKeg && (
                <small>
                  Standard price:{" "}
                  {formatNaira(defaultProductPrice)}
                </small>
              )}
            </div>
          )}

          {/* KEG VOLUME */}

          {selectedProduct && selectedIsKeg && (
            <div className="sales-field">
              <label htmlFor="kegVolume">
                Actual Keg Volume (Litres)
              </label>

              <input
                id="kegVolume"
                type="number"
                min="0.1"
                step="0.1"
                value={kegVolume}
                onChange={(event) =>
                  setKegVolume(event.target.value)
                }
                placeholder="Enter actual keg volume"
                disabled={submitting}
                required
              />

              <small>
                Enter the actual litres sold from each keg.
              </small>
            </div>
          )}

          {/* STOCK VALIDATION MESSAGE */}

          {selectedProduct &&
            selectedStockIsTracked &&
            !shopStockLoading &&
            !shopStockError &&
            selectedStockDeduction > 0 &&
            selectedStockExceeded && (
              <div
                className="sales-notification sales-notification-error"
                role="alert"
              >
                <div className="sales-notification-icon">!</div>

                <div className="sales-notification-content">
                  <strong>Insufficient shop stock</strong>
                  <span>
                    You need{" "}
                    {selectedStockDeduction.toLocaleString()}{" "}
                    {selectedStockUnit}, but only{" "}
                    {selectedAvailableStock.toLocaleString()}{" "}
                    {selectedStockUnit} remain.
                  </span>
                </div>
              </div>
            )}

          {/* SALE PREVIEW */}

          {selectedProduct && (
            <div className="sales-preview">

              <div className="sales-preview-item">
                <span>Product</span>
                <strong>
                  {getProductName(selectedProduct)}
                </strong>
              </div>

              <div className="sales-preview-item">
                <span>Category</span>
                <strong>{selectedCategory}</strong>
              </div>

              <div className="sales-preview-item">
                <span>Unit Price</span>
                <strong>
                  {formatNaira(numericSellingPrice)}
                </strong>
              </div>

              <div className="sales-preview-item">
                <span>Quantity</span>
                <strong>{numericQuantity || 0}</strong>
              </div>

              {(selectedIsPalmOil || selectedIsKuliKuli) && (
                <div className="sales-preview-item">
                  <span>Volume per Unit</span>
                  <strong>
                    {productVolume > 0
                      ? `${productVolume.toLocaleString()} L`
                      : "—"}
                  </strong>
                </div>
              )}

              {selectedIsPalmOil && (
                <div className="sales-preview-item">
                  <span>Palm Oil Stock Deduction</span>
                  <strong>
                    {palmOilLitresSold.toLocaleString()} L
                  </strong>
                </div>
              )}

              {selectedIsKuliKuli && (
                <div className="sales-preview-item">
                  <span>Kuli-Kuli Stock Deduction</span>
                  <strong>
                    {kuliKuliLitresSold.toLocaleString()} L
                  </strong>
                </div>
              )}

              {selectedIsHoney && (
                <div className="sales-preview-item">
                  <span>Honey Stock Deduction</span>
                  <strong>
                    {honeyBottlesSold.toLocaleString()} bottle(s)
                  </strong>
                </div>
              )}

              {selectedStockIsTracked && (
                <div className="sales-preview-item">
                  <span>Stock Remaining After Sale</span>
                  <strong>
                    {Math.max(
                      0,
                      roundStock(
                        selectedAvailableStock -
                        selectedStockDeduction
                      )
                    ).toLocaleString()}{" "}
                    {selectedStockUnit}
                  </strong>
                </div>
              )}

              <div className="sales-preview-item sales-preview-total">
                <span>Total</span>
                <strong>
                  {formatNaira(totalAmount)}
                </strong>
              </div>

            </div>
          )}

          {/* SUBMIT */}

          <button
            type="submit"
            disabled={
              submitting ||
              productsLoading ||
              Boolean(productsError) ||
              products.length === 0 ||
              (
                selectedStockIsTracked &&
                (
                  shopStockLoading ||
                  Boolean(shopStockError) ||
                  selectedStockFinished ||
                  selectedStockExceeded
                )
              )
            }
            className="sales-submit"
          >
            <span>
              {submitting ? "…" : "✓"}
            </span>

            <span>
              {submitting
                ? "Saving Sale..."
                : selectedStockFinished
                  ? "Product Finished"
                  : "Save Today's Sale"}
            </span>
          </button>

        </form>
      </div>
    </ResponsiveLayout>
  );
};

export default SalesForm;
