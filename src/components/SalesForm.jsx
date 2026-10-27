
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

import ResponsiveLayout from "./ResponsiveLayout";
import StockIssueReporter from "./StockIssueReporter";

import {
  playOnPageOpen,
  playAudio,
  speakAudio,
  stopAllAudio,
} from "./AudioManager";

import { saveSale } from "../Firebase/businessFirestore";
import { auth, db } from "../Firebase/firebase.utils";

import {
  formatProductPrice,
} from "../data/products";

import "./Sales.css";
import { balance as computeInventory, pack as inventoryPack } from '../../functions/inventory';

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
   PRODUCT ITEM CODES

   Existing Firestore product documents should contain an
   itemCode, for example AF-001.

   The fallback mappings below support the six product types
   in the catalogue previously supplied for Afubia Farms.

   For other products, the code must be assigned in
   Firestore Product Management. We deliberately do not
   invent a code for an unknown product.
========================================================= */

const PRODUCT_CODE_FALLBACKS = [
  {
    itemCode: "AF-001",
    ids: ["palm-oil-75cl"],
    types: ["75cl"],
    names: ["75cl palm oil"],
  },
  {
    itemCode: "AF-002",
    ids: ["palm-oil-1l"],
    types: ["1l"],
    names: ["1l palm oil", "1-litre palm oil"],
  },
  {
    itemCode: "AF-003",
    ids: ["palm-oil-5l"],
    types: ["5l"],
    names: ["5l palm oil", "5-litres palm oil"],
  },
  {
    itemCode: "AF-004",
    ids: ["palm-oil-30l-keg"],
    types: ["30l keg"],
    names: [
      "30l palm oil keg",
      "30-litres palm oil keg",
    ],
  },
  {
    itemCode: "AF-005",
    ids: ["honey-75cl"],
    types: ["honey 75cl"],
    names: ["75cl honey", "original honey"],
  },
  {
    itemCode: "AF-006",
    ids: ["kuli-kuli-oil-5l"],
    types: ["kuli kuli 5l"],
    names: [
      "5l kuli kuli oil",
      "5-litres kuli kuli oil",
    ],
  },
];

const normalizeProductIdentity = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const getProductCode = (product) => {
  if (!product) return "";

  /*
   * Prefer the actual code stored with the Firestore product.
   */
  const storedCode =
    product.itemCode ??
    product.productCode ??
    product.item_code ??
    "";

  if (
    typeof storedCode === "string" &&
    storedCode.trim()
  ) {
    return storedCode.trim().toUpperCase();
  }

  /*
   * Backward compatibility for the six known catalogue
   * products when their Firestore documents do not yet
   * contain itemCode.
   */
  const productId = normalizeProductIdentity(
    product.id
  );

  const productType = normalizeProductIdentity(
    product.productType
  );

  const productName = normalizeProductIdentity(
    product.productName ||
    product.name
  );

  const match = PRODUCT_CODE_FALLBACKS.find(
    (entry) =>
      entry.ids.some(
        (id) =>
          normalizeProductIdentity(id) === productId
      ) ||
      entry.types.some(
        (type) =>
          normalizeProductIdentity(type) === productType
      ) ||
      entry.names.some(
        (name) =>
          normalizeProductIdentity(name) === productName
      )
  );

  return match?.itemCode || "";
};

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
   PRODUCT CATEGORY HELPERS
========================================================= */

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

/* =========================================================
   COMPONENT
========================================================= */

function normalizeBranchId(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");

  if (text === "kara" || text === "kara-shop") return "kara";
  if (text === "ogidan" || text === "ogidan-shop") return "ogidan";
  return "";
}

const SalesForm = () => {
  const [currentBranchId, setCurrentBranchId] = useState("");
  const [isAdminSession, setIsAdminSession] = useState(false);
  const [currentUserProfile, setCurrentUserProfile] = useState({});
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState("");

  const [shopOpeningStock, setShopOpeningStock] = useState([]);
  const [shopSales, setShopSales] = useState([]);
  const [shopConversions, setShopConversions] = useState([]);
  const [shopMaterials, setShopMaterials] = useState([]);
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
     RESOLVE THE AUTHENTICATED USER'S BRANCH
  ======================================================= */

  useEffect(() => {
    let mounted = true;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        if (mounted) {
          setCurrentBranchId("");
          setIsAdminSession(false);
          setCurrentUserProfile({});
        }
        return;
      }

      try {
        const profileSnapshot = await getDoc(doc(db, "users", user.uid));
        const profile = profileSnapshot.exists() ? profileSnapshot.data() : {};
        const role = String(profile.role || profile.userRole || "").toLowerCase();
        const admin = ["admin", "administrator", "superadmin", "super_admin"].includes(role) ||
          String(user.email || "").trim().toLowerCase() === "chukwuamakanwachukwu@outlook.com";
        const profileBranch = normalizeBranchId(
          profile.branchId || profile.branch || profile.branchName
        );

        let resolvedBranch = profileBranch;
        if (admin) {
          // Do not inherit the dashboard filter as a transaction decision.
          resolvedBranch = "";
        }

        if (mounted) {
          setIsAdminSession(admin);
          setCurrentUserProfile(profile);
          setCurrentBranchId(resolvedBranch);
          if (resolvedBranch) window.sessionStorage.setItem("afubiaBranchId", resolvedBranch);
        }
      } catch (error) {
        console.error("Could not resolve the sales branch:", error);
        if (mounted) setCurrentBranchId("");
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

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

    if (!currentBranchId) {
      setShopOpeningStock([]);
      setShopSales([]);
      setShopStockError(
        "Your account has no selected branch. Sign in again or ask the administrator to assign a branch."
      );
      setShopStockLoading(false);
      return undefined;
    }

    let openingStockLoaded = false;
    let salesLoaded = false;
    let conversionsLoaded = false;
    let materialsLoaded = false;
    let hasStockError = false;

    const updateLoadingState = () => {
      if (openingStockLoaded && salesLoaded && conversionsLoaded && materialsLoaded) {
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
      query(
        collection(db, "shopOpeningStock"),
        where("branchId", "==", currentBranchId)
      ),
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
      query(
        collection(db, "sales"),
        where("branchId", "==", currentBranchId)
      ),
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

    const unsubscribeConversions = onSnapshot(query(collection(db, 'conversions'), where('branchId', '==', currentBranchId)), snapshot => {
      setShopConversions(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
      conversionsLoaded = true; updateLoadingState();
    }, error => { conversionsLoaded = true; handleStockError(error, 'conversions'); });
    const unsubscribeMaterials = onSnapshot(query(collection(db, 'materials'), where('branchId', '==', currentBranchId)), snapshot => {
      setShopMaterials(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
      materialsLoaded = true; updateLoadingState();
    }, error => { materialsLoaded = true; handleStockError(error, 'materials'); });

    return () => {
      unsubscribeOpeningStock();
      unsubscribeSales();
      unsubscribeConversions();
      unsubscribeMaterials();
    };
  }, [currentBranchId]);

  /* =======================================================
     PAGE AUDIO
  ======================================================= */

  useEffect(() => {
    let cleanup;

    try {
      cleanup = playOnPageOpen("sellpage");
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
    return computeInventory({ shopOpeningStock, sales: shopSales, conversions: shopConversions }).stock;
  }, [shopOpeningStock, shopSales, shopConversions]);

  /* =======================================================
     SELECTED PRODUCT
  ======================================================= */

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === item),
    [products, item]
  );

  const selectedItemCode = useMemo(
    () => getProductCode(selectedProduct),
    [selectedProduct]
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
    Boolean(selectedProduct);

  const selectedAvailableStock = selectedStockIsTracked
    ? Math.max(0, selectedCategory === 'Other'
        ? (Number(selectedProduct.openingStockByBranch?.[currentBranchId]) || 0) + (computeInventory({ shopOpeningStock, sales: shopSales, conversions: shopConversions }).generic[selectedProduct.id] || 0)
        : selectedIsKeg && selectedCategory === 'Palm Oil'
        ? computeInventory({ shopOpeningStock, sales: shopSales, conversions: shopConversions, materials: shopMaterials }).materials.kegs * (getProductVolume(selectedProduct) || 30)
        : selectedCategory === 'Palm Oil' && inventoryPack(selectedProduct || {})
        ? Math.min(shopStockBalances[selectedCategory], computeInventory({ shopOpeningStock, sales: shopSales, conversions: shopConversions }).packaged[inventoryPack(selectedProduct)] * ({ '75cl': .75, '1L': 1, '5L': 5 }[inventoryPack(selectedProduct)]))
        : shopStockBalances[selectedCategory])
    : null;

  const selectedStockUnit = selectedIsHoney || selectedCategory === 'Other'
    ? (selectedIsHoney ? 'bottle(s)' : 'item(s)')
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

  const selectedStockDeduction = selectedIsHoney || selectedCategory === 'Other'
    ? numericQuantity
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

    /*
     * Do not save an item without a verified code.
     * This prevents new unidentifiable sales while
     * allowing the form to work with existing products
     * that match the known fallback catalogue.
     */
    if (!selectedItemCode) {
      setNotification({
        type: "error",
        text:
          "This product has no item code. Ask the administrator to assign a unique item code in Product Management before selling it.",
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

      const profileRole = String(
        currentUserProfile.role || currentUserProfile.userRole || "salesgirl"
      ).toLowerCase();
      const userRole = ["admin", "administrator", "superadmin", "super_admin"].includes(profileRole)
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
         BRANCH INFORMATION

         This reads the branch only if an existing login
         flow has saved it. It does not establish branch
         authentication or enforce branch permissions.
      ----------------------------------------------- */

      const branchId = currentBranchId;

      const salespersonId = String(
        currentUserProfile.staffId || currentUserProfile.employeeId || ""
      ).trim();

      if (!branchId) {
        throw new Error(
          "No branch is assigned to this session. Please sign in again before recording a sale."
        );
      }

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

        /*
         * Branch metadata is included when available.
         * The login and Firestore security layers must
         * validate the branch independently.
         */
        ...(branchId ? { branchId } : {}),
        ...(salespersonId ? { salespersonId } : {}),

        // Shop stock tracking
        isShopSale: true,
        stockLocation: "shop",
        saleLocation: "shop",
        location: "shop",
        storeLocation: "shop",

        // Product identity
        productId: selectedProduct.id,
        itemCode: selectedItemCode,
        productCode: selectedItemCode,

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
         * These include Palm Oil OR Kuli-Kuli Oil,
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

        description: `${selectedItemCode} - ${productName} sale`,
      };

      console.log("Saving sale record:", saleData);

      /*
       * Save the sale using the existing Firestore helper.
       */
      await saveSale(saleData);

      setNotification({
        type: "success",
        text:
          `${selectedItemCode} — ${productName} sale saved successfully. ` +
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

      await safeAudio("selly");
      await safeSpeak(numericQuantity);

      if (selectedProduct.audio) {
        await safeAudio(selectedProduct.audio);
      }

      await safeAudio("for");
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

      await safeAudio("conversion_error");

    } finally {
      setSubmitting(false);
    }
  };

  /* =========================================================
     PRODUCT OPTIONS

     Show the item code, product name, price, and stock
     availability in the selector.

     Existing products without a code will be displayed
     as "CODE NOT ASSIGNED" and cannot be sold until
     their code is assigned.
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

        const itemCode = getProductCode(product);

        const codeLabel = itemCode
          ? itemCode
          : "CODE NOT ASSIGNED";

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
            disabled={finished || !itemCode}
          >
            {codeLabel} | {getProductName(product)} —{" "}
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
        {isAdminSession && (
          <div className="branch-choice-panel" role="group" aria-labelledby="sale-branch-label">
            <label id="sale-branch-label" htmlFor="sale-branch-choice">Shop for this sale</label>
            <select
              id="sale-branch-choice"
              value={currentBranchId}
              onChange={(event) => {
                const nextBranch = normalizeBranchId(event.target.value);
                setCurrentBranchId(nextBranch);
              }}
              required
            >
              <option value="">Choose a shop before recording</option>
              <option value="kara">Kara Shop</option>
              <option value="ogidan">Ogidan Shop</option>
            </select>
            <small>The sale will be recorded under your administrator account and the selected shop.</small>
          </div>
        )}

        <div className="sales-header">
          <span className="sales-eyebrow">
            AFUBIA FARMS
          </span>

          <h1>Record Today's Sale</h1>

          <p>
            Enter the product and quantity sold today.
          </p>
        </div>

        <StockIssueReporter />

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
                  {otherProducts.map((product) => {
                    const itemCode = getProductCode(product);

                    return (
                      <option
                        key={product.id}
                        value={product.id}
                        disabled={!itemCode}
                      >
                        {itemCode || "CODE NOT ASSIGNED"} |{" "}
                        {getProductName(product)} —{" "}
                        {formatProductPrice(
                          getProductPrice(product)
                        )}
                      </option>
                    );
                  })}
                </optgroup>
              )}
            </select>

            {selectedProduct && (
              <small className="sales-item-code">
                Item Code:{" "}
                <strong>
                  {selectedItemCode || "Not assigned"}
                </strong>
              </small>
            )}

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
                !selectedItemCode ||
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
                <span>Item Code</span>
                <strong>
                  {selectedItemCode || "Not assigned"}
                </strong>
              </div>

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
              (Boolean(selectedProduct) && !selectedItemCode) ||
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
