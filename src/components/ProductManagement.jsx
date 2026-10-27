
import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { db } from "../Firebase/firebase.utils";
import ResponsiveLayout from "./ResponsiveLayout";
import "./ProductManagement.css";
import oilContainers from "../assets/oil_containers.jpg";
import honey from "../assets/honey.jpg";
import PRODUCTS from "../data/products";
import kulikuli from "../assets/kuliKuli.jpg";

/* =========================================================
   PRODUCT PHOTOGRAPHS

   These are representative online product images.
   You can enter your own image URL for any product.
========================================================= */

const CATEGORY_IMAGES = {
  "Palm Oil":
    oilContainers,

  "Kuli-Kuli Oil":
    kulikuli,

  Honey:
    honey,

  Other:
    "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=80",
};

const CATEGORY_ICONS = {
  "Palm Oil": <img src={oilContainers} />,
  "Kuli-Kuli Oil": <img src={kulikuli} />,
  Honey: <img src={honey} />,
  Other: "📦",
};

const DEFAULT_FORM = {
  openingStockKara: '0', openingStockOgidan: '0',
  name: "",
  itemCode: "",
  category: "Palm Oil",
  size: "75cl",
  sizeLitres: "0.75",
  unit: "bottle",
  price: "",
  description: "",
  imageUrl: CATEGORY_IMAGES["Palm Oil"],
  active: true,
};

const CATEGORY_OPTIONS = [
  "Palm Oil",
  "Kuli-Kuli Oil",
  "Honey",
  "Other",
];

const CATEGORY_DEFAULTS = {
  "Palm Oil": {
    size: "75cl",
    sizeLitres: "0.75",
    unit: "bottle",
  },

  "Kuli-Kuli Oil": {
    size: "5L",
    sizeLitres: "5",
    unit: "jerrycan",
  },

  Honey: {
    size: "75cl",
    sizeLitres: "0.75",
    unit: "bottle",
  },

  Other: {
    size: "",
    sizeLitres: "0",
    unit: "piece",
  },
};

/* =========================================================
   HELPERS
========================================================= */

const formatNaira = (value) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);

const getProductImage = (product) =>
  product?.imageUrl ||
  CATEGORY_IMAGES[product?.category] ||
  CATEGORY_IMAGES.Other;

const normalizeCode = (value) => String(value || "").trim().toUpperCase();

const findCatalogueMatch = (product = {}) => PRODUCTS.find((item) =>
  String(item.category || "").toLowerCase() === String(product.category || "").toLowerCase() &&
  String(item.size || item.sizeLabel || "").toLowerCase() === String(product.size || "").toLowerCase() &&
  (String(item.name || "").toLowerCase() === String(product.name || "").toLowerCase() ||
   (String(product.category || "").toLowerCase() === "honey" && String(product.size || "").toLowerCase() === "75cl"))
);

const generateItemCode = (products, preferredCode = "") => {
  const used = new Set(products.map((item) => normalizeCode(item.itemCode || item.productCode)).filter(Boolean));
  const preferred = normalizeCode(preferredCode);
  if (preferred && !used.has(preferred)) return preferred;
  let sequence = 1;
  let next = "";
  do {
    next = `AF-${String(sequence).padStart(3, "0")}`;
    sequence += 1;
  } while (used.has(next) || PRODUCTS.some((item) => normalizeCode(item.itemCode) === next));
  return next;
};

const ProductManagement = () => {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(DEFAULT_FORM);

  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [showInactive, setShowInactive] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmProduct, setConfirmProduct] = useState(null);

  /* =======================================================
     FIRESTORE PRODUCTS SUBSCRIPTION
  ======================================================= */

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "products"),

      (snapshot) => {
        const records = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));

        records.sort((a, b) =>
          String(a.name || "").localeCompare(
            String(b.name || "")
          )
        );

        setProducts(records);
        setLoading(false);
        setError("");
      },

      (err) => {
        console.error(
          "Products subscription failed:",
          err
        );

        setError(
          "Unable to load products. Check your internet connection and Firestore permissions."
        );

        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  /* =======================================================
     PRODUCT COUNTS AND FILTERING
  ======================================================= */

  const activeProducts = products.filter(
    (product) => product.active !== false
  );

  const displayedProducts = products.filter((product) => {
    const searchableText = [
      product.name,
      product.itemCode,
      product.category,
      product.size,
      product.description,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const matchesSearch = searchableText.includes(
      search.toLowerCase().trim()
    );

    const matchesCategory =
      categoryFilter === "All" ||
      product.category === categoryFilter;

    const matchesStatus =
      showInactive || product.active !== false;

    return (
      matchesSearch &&
      matchesCategory &&
      matchesStatus
    );
  });

  /* =======================================================
     FORM HELPERS
  ======================================================= */

  const updateField = (field, value) => {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));
  };

  const handleCategoryChange = (category) => {
    const defaults =
      CATEGORY_DEFAULTS[category] ||
      CATEGORY_DEFAULTS.Other;

    setForm((previous) => ({
      ...previous,
      category,
      ...defaults,
      imageUrl: CATEGORY_IMAGES[category] ||
        CATEGORY_IMAGES.Other,
    }));
  };

  const resetForm = () => {
    setForm(DEFAULT_FORM);
    setEditingId(null);
    setError("");
  };

  const handleEdit = (product) => {
    const catalogueMatch = findCatalogueMatch(product);
    setForm({
      name: product.name || "",
      itemCode: product.itemCode || catalogueMatch?.itemCode || "",
      category: product.category || "Other",
      size: product.size || "",
      sizeLitres: String(product.sizeLitres ?? "0"),
      openingStockKara: String(product.openingStockByBranch?.kara ?? 0),
      openingStockOgidan: String(product.openingStockByBranch?.ogidan ?? 0),
      unit: product.unit || "piece",
      price: String(product.price ?? ""),
      description: product.description || "",
      imageUrl: getProductImage(product),
      active: product.active !== false,
    });

    setEditingId(product.id);
    setError("");
    setSuccess("");

    document
      .querySelector(".pm-form-section")
      ?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
  };

  /* =======================================================
     SAVE PRODUCT
  ======================================================= */

  const handleSubmit = async (event) => {
    event.preventDefault();

    setError("");
    setSuccess("");

    const name = form.name.trim();
    const size = form.size.trim();
    const unit = form.unit.trim();
    const price = Number(form.price);
    const sizeLitres = Number(form.sizeLitres);

    if (!name || !size || !unit) {
      setError(
        "Please provide the product name, size and unit."
      );
      return;
    }

    if (
      form.price === "" ||
      !Number.isFinite(price) ||
      price < 0
    ) {
      setError("Enter a valid selling price.");
      return;
    }

    if (
      form.sizeLitres === "" ||
      !Number.isFinite(sizeLitres) ||
      sizeLitres < 0
    ) {
      setError("Enter a valid size in litres.");
      return;
    }

    if (form.imageUrl.trim()) {
      try {
        const imageUrl = new URL(form.imageUrl.trim(), window.location.origin);

        if (!["http:", "https:"].includes(imageUrl.protocol)) {
          setError("The product image must use an HTTP or HTTPS URL.");
          return;
        }
      } catch {
        setError("Enter a valid product image URL.");
        return;
      }
    }

    const duplicate = products.some(
      (product) =>
        product.id !== editingId &&
        product.active !== false &&
        String(product.name || "")
          .trim()
          .toLowerCase() === name.toLowerCase() &&
        String(product.size || "")
          .trim()
          .toLowerCase() === size.toLowerCase()
    );

    if (duplicate) {
      setError(
        "An active product with this name and size already exists."
      );
      return;
    }

    const stockType =
      form.category === "Palm Oil"
        ? "palmOil"
        : form.category === "Kuli-Kuli Oil"
          ? "kuliKuli"
          : form.category === "Honey"
            ? "honey"
            : "other";

    const existingProduct = products.find((product) => product.id === editingId);
    const catalogueMatch = findCatalogueMatch({ name, category: form.category, size });
    const availableProducts = products.filter((product) => product.id !== editingId);
    const itemCode = existingProduct?.itemCode || generateItemCode(
      availableProducts,
      form.itemCode || catalogueMatch?.itemCode || ""
    );
    const normalizedItemCode = normalizeCode(itemCode);
    const duplicateCode = products.some((product) =>
      product.id !== editingId && normalizeCode(product.itemCode) === normalizedItemCode
    );
    if (duplicateCode) {
      setError(`Item code ${normalizedItemCode} is already used. Please review the catalogue before saving.`);
      return;
    }

    const productData = {
      openingStockByBranch: { kara: Math.max(0, Number(form.openingStockKara) || 0), ogidan: Math.max(0, Number(form.openingStockOgidan) || 0) },
      itemCode: normalizedItemCode,
      productCode: normalizedItemCode,
      name,
      productName: name,

      category: form.category,

      type: `${form.category.replace(
        /[^a-zA-Z0-9]/g,
        ""
      )}_${size.replace(/[^a-zA-Z0-9]/g, "")}`,

      size,
      sizeLitres,
      unit,
      price,

      description: form.description.trim(),

      imageUrl:
        form.imageUrl.trim() ||
        CATEGORY_IMAGES[form.category] ||
        CATEGORY_IMAGES.Other,

      stockType,

      // Only Palm Oil affects Palm Oil stock.
      affectsOilStock: stockType === "palmOil",
      affectsContainerStock: stockType === "palmOil",

      active: form.active,
      updatedAt: serverTimestamp(),
    };

    try {
      setSaving(true);

      if (editingId) {
        await updateDoc(
          doc(db, "products", editingId),
          productData
        );

        setSuccess("Product updated successfully.");
      } else {
        await addDoc(
          collection(db, "products"),
          {
            ...productData,
            createdAt: serverTimestamp(),
          }
        );

        setSuccess("Product added successfully.");
      }

      setForm(DEFAULT_FORM);
      setEditingId(null);

    } catch (err) {
      console.error("Unable to save product:", err);

      setError(
        "The product could not be saved. Check your Firestore rules and try again."
      );
    } finally {
      setSaving(false);
    }
  };

  const assignMissingItemCode = async (product) => {
    if (product.itemCode || product.productCode) return;
    const catalogueMatch = findCatalogueMatch(product);
    const availableProducts = products.filter((item) => item.id !== product.id);
    const code = generateItemCode(availableProducts, catalogueMatch?.itemCode || "");
    const duplicate = availableProducts.some((item) => normalizeCode(item.itemCode || item.productCode) === normalizeCode(code));
    if (duplicate) {
      setError(`Could not assign ${code}: that item code is already in use.`);
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await updateDoc(doc(db, "products", product.id), {
        itemCode: code,
        productCode: code,
        updatedAt: serverTimestamp(),
      });
      setSuccess(`Item code ${code} was saved for ${product.name}.`);
    } catch (err) {
      console.error("Unable to assign missing product code:", err);
      setError("The item code could not be saved. Check Firestore permissions and try again.");
    } finally {
      setSaving(false);
    }
  };

  /* =======================================================
     ARCHIVE OR RESTORE PRODUCT

     Archived products are hidden from new sales but
     their existing sales records are preserved.
  ======================================================= */

  const toggleProductStatus = async (product) => {
    setError("");
    setSuccess("");

    try {
      await updateDoc(
        doc(db, "products", product.id),
        {
          active: product.active === false,
          updatedAt: serverTimestamp(),
        }
      );

      setSuccess(
        product.active === false
          ? `${product.name} is now available again.`
          : `${product.name} has been removed from the active catalogue.`
      );

      setConfirmProduct(null);

    } catch (err) {
      console.error(
        "Unable to update product status:",
        err
      );

      setError(
        "Unable to change product availability. Please try again."
      );
    }
  };

  /* =======================================================
     UI
  ======================================================= */

  return (
    <ResponsiveLayout>
      <main className="pm-page">

        {/* PAGE HEADER */}

        <header className="pm-header">
          <div className="pm-header-copy">
            <span className="pm-eyebrow">
              AFUBIA FARMS · ADMIN
            </span>

            <h1>Product Management</h1>

            <p>
              Manage your catalogue, update prices and keep
              your products ready for sale.
            </p>
          </div>

          <div className="pm-header-count">
            <span>Active products</span>
            <strong>{activeProducts.length}</strong>
            <small>Available in your catalogue</small>
          </div>
        </header>

        {/* ALERTS */}

        {error && (
          <div
            className="pm-alert pm-alert-error"
            role="alert"
          >
            <span className="pm-alert-icon">!</span>
            <span>{error}</span>

            <button
              type="button"
              onClick={() => setError("")}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        {success && (
          <div
            className="pm-alert pm-alert-success"
            role="status"
          >
            <span className="pm-alert-icon">✓</span>
            <span>{success}</span>

            <button
              type="button"
              onClick={() => setSuccess("")}
              aria-label="Dismiss success message"
            >
              ×
            </button>
          </div>
        )}

        {/* ADD / EDIT PRODUCT */}

        <section className="pm-form-section">
          <div className="pm-section-heading">
            <div>
              <span className="pm-kicker">
                {editingId ? "EDIT PRODUCT" : "PRODUCT SETUP"}
              </span>

              <h2>
                {editingId
                  ? "Update product details"
                  : "Add a new product"}
              </h2>

              <p>
                Add product information, a selling price and
                a product photograph.
              </p>
            </div>

            {editingId && (
              <button
                type="button"
                className="pm-button pm-button-light"
                onClick={resetForm}
              >
                Cancel edit
              </button>
            )}
          </div>

          <form
            className="pm-form"
            onSubmit={handleSubmit}
          >
            <div className="pm-field">
              <label htmlFor="pm-name">
                Product name
              </label>

              <input
                id="pm-name"
                value={form.name}
                onChange={(event) =>
                  updateField("name", event.target.value)
                }
                placeholder="e.g. Afubia Pure Honey"
                required
              />
            </div>

            <div className="pm-field">
              <label htmlFor="pm-item-code">Item code</label>
              <input
                id="pm-item-code"
                value={form.itemCode || (editingId ? "Assigned when saved" : "Generated when saved")}
                readOnly
                aria-describedby="pm-item-code-help"
              />
              <small id="pm-item-code-help">Codes follow the Afubia catalogue convention and are checked for duplicates.</small>
            </div>

            <div className="pm-field">
              <label htmlFor="pm-category">
                Product category
              </label>

              <select
                id="pm-category"
                value={form.category}
                onChange={(event) =>
                  handleCategoryChange(event.target.value)
                }
              >
                {CATEGORY_OPTIONS.map((category) => (
                  <option
                    key={category}
                    value={category}
                  >
                    {category}
                  </option>
                ))}
              </select>
            </div>

            {form.category === 'Other' && <>
              <div className="pm-field"><label htmlFor="pm-opening-kara">Kara opening units</label><input id="pm-opening-kara" type="number" min="0" step="1" value={form.openingStockKara} onChange={e => updateField('openingStockKara', e.target.value)} /><small>Cumulative units introduced, not the remaining balance. Sales are deducted automatically.</small></div>
              <div className="pm-field"><label htmlFor="pm-opening-ogidan">Ogidan opening units</label><input id="pm-opening-ogidan" type="number" min="0" step="1" value={form.openingStockOgidan} onChange={e => updateField('openingStockOgidan', e.target.value)} /><small>Increase this total when more units arrive. Keep historical sales intact.</small></div>
            </>}
            <div className="pm-field">
              <label htmlFor="pm-size">
                Product size
              </label>

              <input
                id="pm-size"
                value={form.size}
                onChange={(event) =>
                  updateField("size", event.target.value)
                }
                placeholder="e.g. 75cl, 1L or 5L"
                required
              />
            </div>

            <div className="pm-field">
              <label htmlFor="pm-litres">
                Size in litres
              </label>

              <input
                id="pm-litres"
                type="number"
                min="0"
                step="0.01"
                value={form.sizeLitres}
                onChange={(event) =>
                  updateField(
                    "sizeLitres",
                    event.target.value
                  )
                }
                required
              />

              <small>
                Enter 0 for products not measured in litres.
              </small>
            </div>

            <div className="pm-field">
              <label htmlFor="pm-unit">
                Selling unit
              </label>

              <select
                id="pm-unit"
                value={form.unit}
                onChange={(event) =>
                  updateField("unit", event.target.value)
                }
              >
                <option value="bottle">Bottle</option>
                <option value="jerrycan">Jerrycan</option>
                <option value="keg">Keg</option>
                <option value="litre">Litre</option>
                <option value="piece">Piece</option>
                <option value="pack">Pack</option>
              </select>
            </div>

            <div className="pm-field">
              <label htmlFor="pm-price">
                Selling price (₦)
              </label>

              <input
                id="pm-price"
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(event) =>
                  updateField("price", event.target.value)
                }
                placeholder="e.g. 10000"
                required
              />
            </div>

            <div className="pm-field pm-field-wide">
              <label htmlFor="pm-image">
                Product image URL
              </label>

              <input
                id="pm-image"
                type="text"
                inputMode="url"
                value={form.imageUrl}
                onChange={(event) =>
                  updateField("imageUrl", event.target.value)
                }
                placeholder=<img src={honey} />
              />

              <small>
                A category photo is provided automatically.
                Paste another image URL to use your own product
                photograph.
              </small>
            </div>

            <div className="pm-image-preview-section">
              <span className="pm-preview-label">
                PRODUCT IMAGE PREVIEW
              </span>

              <div className="pm-image-preview">
                <img
                  src={
                    form.imageUrl ||
                    CATEGORY_IMAGES[form.category] ||
                    CATEGORY_IMAGES.Other
                  }
                  alt={`${form.name || form.category} preview`}
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                    event.currentTarget.nextElementSibling.style.display =
                      "grid";
                  }}
                />

                <div
                  className="pm-image-fallback"
                  style={{ display: "none" }}
                >
                  <span>
                    {CATEGORY_ICONS[form.category] || "📦"}
                  </span>
                  <small>Image unavailable</small>
                </div>
              </div>
            </div>

            <div className="pm-field pm-field-wide">
              <label htmlFor="pm-description">
                Product description
              </label>

              <textarea
                id="pm-description"
                value={form.description}
                onChange={(event) =>
                  updateField(
                    "description",
                    event.target.value
                  )
                }
                placeholder="Describe the product (optional)"
                rows={3}
              />
            </div>

            <div className="pm-form-footer">
              <div className="pm-form-note">
                <span>ⓘ</span>
                <p>
                  Product category controls which stock balance
                  the sale belongs to.
                </p>
              </div>

              <button
                type="submit"
                className="pm-button pm-button-primary"
                disabled={saving}
              >
                {saving
                  ? "Saving product..."
                  : editingId
                    ? "Save changes"
                    : "+ Add product"}
              </button>
            </div>
          </form>
        </section>

        {/* PRODUCT CATALOGUE */}

        <section className="pm-catalogue-section">
          <div className="pm-section-heading">
            <div>
              <span className="pm-kicker">
                YOUR INVENTORY CATALOGUE
              </span>

              <h2>Products</h2>

              <p>
                Edit details or remove products from future
                sales without deleting their history.
              </p>
            </div>

            <span className="pm-total-count">
              {displayedProducts.length} shown
            </span>
          </div>

          {/* SEARCH AND FILTERS */}

          <div className="pm-toolbar">
            <div className="pm-search">
              <span aria-hidden="true">⌕</span>

              <input
                type="search"
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder="Search your products..."
                aria-label="Search products"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(event) =>
                setCategoryFilter(event.target.value)
              }
              aria-label="Filter by category"
            >
              <option value="All">All categories</option>

              {CATEGORY_OPTIONS.map((category) => (
                <option
                  key={category}
                  value={category}
                >
                  {category}
                </option>
              ))}
            </select>

            <label className="pm-checkbox">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(event) =>
                  setShowInactive(event.target.checked)
                }
              />

              <span>Show inactive</span>
            </label>
          </div>

          {/* PRODUCT LIST */}

          {loading ? (
            <div className="pm-empty">
              <span className="pm-loading-spinner" />
              <h3>Loading your catalogue</h3>
              <p>Please wait while your products load.</p>
            </div>
          ) : displayedProducts.length === 0 ? (
            <div className="pm-empty">
              <span className="pm-empty-icon">📦</span>
              <h3>No products found</h3>
              <p>
                Try another search or add a product using the
                form above.
              </p>
            </div>
          ) : (
            <div className="pm-product-grid">
              {displayedProducts.map((product) => (
                <article
                  className={`pm-product-card ${
                    product.active === false
                      ? "pm-product-inactive"
                      : ""
                  }`}
                  key={product.id}
                >
                  <div className="pm-product-image-wrap">
                    <img
                      className="pm-product-image"
                      src={getProductImage(product)}
                      alt={product.name || product.category}
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                        event.currentTarget.nextElementSibling.style.display =
                          "grid";
                      }}
                    />

                    <div
                      className="pm-image-fallback"
                      style={{ display: "none" }}
                    >
                      <span>
                        {CATEGORY_ICONS[product.category] || "📦"}
                      </span>
                      <small>Image unavailable</small>
                    </div>

                    <span
                      className={`pm-status ${
                        product.active === false
                          ? "pm-status-inactive"
                          : "pm-status-active"
                      }`}
                    >
                      <span className="pm-status-dot" />
                      {product.active === false
                        ? "Inactive"
                        : "Active"}
                    </span>

                    <span className="pm-product-size-badge">
                      {product.size || "No size"}
                    </span>
                  </div>

                  <div className="pm-product-content">
                    <span className="pm-product-category">
                      {product.category || "Other"}
                    </span>

                    <h3>{product.name}</h3>
                    <p className="pm-product-code">Item code: <strong>{product.itemCode || findCatalogueMatch(product)?.itemCode || "Needs review"}</strong></p>

                    <p className="pm-product-unit">
                      Sold per {product.unit || "unit"}
                    </p>

                    {product.description && (
                      <p className="pm-product-description">
                        {product.description}
                      </p>
                    )}

                    <div className="pm-product-price-row">
                      <span>Selling price</span>
                      <strong>
                        {formatNaira(product.price)}
                      </strong>
                    </div>

                    <div className="pm-product-actions">
                      {!product.itemCode && !product.productCode && (
                        <button
                          type="button"
                          className="pm-button pm-button-light"
                          onClick={() => assignMissingItemCode(product)}
                          disabled={saving}
                        >
                          Save code {findCatalogueMatch(product)?.itemCode || "AF-…"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="pm-button pm-button-light"
                        onClick={() => handleEdit(product)}
                      >
                        <span>✎</span> Edit
                      </button>

                      <button
                        type="button"
                        className={`pm-button ${
                          product.active === false
                            ? "pm-button-primary"
                            : "pm-button-danger"
                        }`}
                        onClick={() =>
                          setConfirmProduct(product)
                        }
                      >
                        {product.active === false
                          ? "↻ Restore"
                          : "Remove"}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* REMOVE / RESTORE CONFIRMATION */}

        {confirmProduct && (
          <div
            className="pm-modal-backdrop"
            role="presentation"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                setConfirmProduct(null);
              }
            }}
          >
            <section
              className="pm-confirm-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pm-confirm-title"
            >
              <span className="pm-confirm-icon">
                {confirmProduct.active === false
                  ? "↩️"
                  : "⚠️"}
              </span>

              <h2 id="pm-confirm-title">
                {confirmProduct.active === false
                  ? "Restore this product?"
                  : "Remove this product?"}
              </h2>

              <p>
                {confirmProduct.active === false
                  ? `${confirmProduct.name} will become available for new sales again.`
                  : `${confirmProduct.name} will be hidden from new sales. Existing sales history will be preserved.`}
              </p>

              <div className="pm-modal-actions">
                <button
                  type="button"
                  className="pm-button pm-button-light"
                  onClick={() => setConfirmProduct(null)}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className={`pm-button ${
                    confirmProduct.active === false
                      ? "pm-button-primary"
                      : "pm-button-danger"
                  }`}
                  onClick={() =>
                    toggleProductStatus(confirmProduct)
                  }
                >
                  {confirmProduct.active === false
                    ? "Restore product"
                    : "Remove product"}
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    </ResponsiveLayout>
  );
};

export default ProductManagement;
