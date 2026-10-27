import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../Firebase/firebase.utils";
import "./StockTracker.css";
import { balance as computeInventory, materialKey } from '../../functions/inventory';
import bottle75Image from '../assets/75clcontainer.jpg';
import bottle1LImage from '../assets/1lcontainer.jpg';
import jerrycan5LImage from '../assets/5lcontainer.jpg';
import palmOilImage from '../assets/oil_containers.jpg';

const SHOPS = [
  { id: "kara", name: "Kara Shop" },
  { id: "ogidan", name: "Ogidan Shop" },
];

const CONTAINER_TYPES = [
  { key: "75cl", label: "75cl bottles", unit: "bottles", icon: "🧴", image: bottle75Image },
  { key: "1L", label: "1L bottles", unit: "bottles", icon: "🧴", image: bottle1LImage },
  { key: "5L", label: "5L jerrycans", unit: "jerrycans", icon: "🛢️", image: jerrycan5LImage },
];

const normalize = (value) => String(value ?? "").trim().toLowerCase();
const toNumber = (...values) => {
  for (const value of values) {
    const number = Number(value);
    if (value !== "" && value != null && Number.isFinite(number) && number > 0) return number;
  }
  return 0;
};
const formatNumber = (value) => new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value) || 0);
const formatCurrency = (value) => new Intl.NumberFormat("en-NG", {
  style: "currency", currency: "NGN", maximumFractionDigits: 2,
}).format(Number(value) || 0);

const timestamp = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object" && value.seconds != null) return Number(value.seconds) * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};
const recordDate = (record) => record?.recordDate || record?.date || record?.saleDate ||
  record?.salesDate || record?.purchaseDate || record?.recordedAt || record?.createdAt ||
  record?.timestamp || record?.dateTime || record?.soldAt || null;
const formatDate = (value) => {
  const time = timestamp(value);
  return time ? new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos", day: "2-digit", month: "short", year: "numeric",
  }).format(new Date(time)) : "Date not recorded";
};
const statusText = (record) => normalize(record?.status || record?.paymentStatus || record?.transactionStatus);
const isCancelled = (record) => ["cancelled", "canceled", "void", "voided", "deleted", "rejected"].includes(statusText(record));

const normalizeShop = (value) => {
  const shop = normalize(value).replace(/[\s_]+/g, "-");
  if (["kara", "kara-shop"].includes(shop)) return "kara";
  if (["ogidan", "ogidan-shop"].includes(shop)) return "ogidan";
  return "";
};
const getShopId = (record) => normalizeShop(
  record?.branchId || record?.branch || record?.branchName || record?.shopId || record?.shopName ||
  record?.storeId || record?.storeName
);

const getContainerType = record => materialKey(record) || 'other';
const materialQuantity = (record) => toNumber(
  record?.purchasedQuantity, record?.quantityPurchased, record?.quantityBought,
  record?.unitsPurchased, record?.numberPurchased, record?.quantity, record?.qty
);
const materialCost = (record) => toNumber(
  record?.totalCost, record?.cost, record?.totalAmount, record?.amountPaid, record?.purchaseCost, record?.price
);
const isPurchasedMaterial = (record) => {
  if (!record || isCancelled(record) || record.affectsStock === false || record.isPurchased === false) return false;
  return !["pending", "unpaid", "awaiting payment", "not purchased", "rejected"].includes(statusText(record));
};

export default function StockTracker() {
  const [materials, setMaterials] = useState([]);
  const [, setSales] = useState([]);
  const [conversions, setConversions] = useState([]);
  const [openingStock, setOpeningStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState(
    typeof window !== "undefined" && "Notification" in window ? window.Notification.permission : "unsupported"
  );

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setIsAdmin(false);
      return undefined;
    }
    return onSnapshot(doc(db, "users", user.uid), (snapshot) => {
      const profile = snapshot.exists() ? snapshot.data() : {};
      const role = normalize(profile.role || profile.userRole);
      const email = normalize(user.email);
      setIsAdmin(
        ["admin", "administrator", "superadmin", "super admin", "super-admin"].includes(role) ||
        email === "chukwuamakanwachukwu@outlook.com"
      );
    }, (listenerError) => {
      console.error("Could not check stock tracker permissions:", listenerError);
      setIsAdmin(false);
    });
  }, []);

  useEffect(() => {
    let materialsLoaded = false;
    let salesLoaded = false;
    let active = true;
    const unsubscribeMaterials = onSnapshot(collection(db, "materials"), (snapshot) => {
      if (!active) return;
      setMaterials(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      materialsLoaded = true;
      if (salesLoaded) setLoading(false);
    }, (listenerError) => {
      console.error("Materials listener error:", listenerError);
      if (active) { setError("Could not load material purchases. Check your connection and access permissions."); setLoading(false); }
    });
    const unsubscribeSales = onSnapshot(collection(db, "sales"), (snapshot) => {
      if (!active) return;
      setSales(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      salesLoaded = true;
      if (materialsLoaded) setLoading(false);
    }, (listenerError) => {
      console.error("Shop sales listener error:", listenerError);
      if (active) { setError("Could not load shop sales. Check your connection and access permissions."); setLoading(false); }
    });
    const unsubscribeConversions = onSnapshot(collection(db, 'conversions'), snapshot => {
      setConversions(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => setError('Could not verify oil-turning consumption. Check your connection and permissions.'));
    const unsubscribeOpeningStock = onSnapshot(collection(db, 'shopOpeningStock'), snapshot => {
      setOpeningStock(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => setError('Could not load opening shop stock. Check your connection and permissions.'));
    return () => {
      active = false;
      unsubscribeMaterials();
      unsubscribeSales();
      unsubscribeConversions();
      unsubscribeOpeningStock();
    };
  }, []);

  const purchasedMaterials = useMemo(() => materials.filter(isPurchasedMaterial), [materials]);

  const shopData = useMemo(() => Object.fromEntries(SHOPS.map((shop) => {
    const purchases = purchasedMaterials.filter((material) => getShopId(material) === shop.id);
    const openings = openingStock.filter((record) => getShopId(record) === shop.id && !isCancelled(record));
    const stock = CONTAINER_TYPES.map((type) => {
      const matchingPurchases = purchases.filter((material) => getContainerType(material) === type.key);
      const openingQty = openings.filter((record) => {
        const text = normalize([record.stockContainerType, record.stockUnit, record.unit, record.size, record.productName, record.product, record.productType].join(' ')).replace(/\s/g, '');
        const key = /75cl|750ml/.test(text) ? '75cl' : /5l|5litre|5liter/.test(text) ? '5L' : /1l|1litre|1liter/.test(text) ? '1L' : '';
        return key === type.key && !/keg/.test(text);
      }).reduce((sum, record) => sum + toNumber(record.quantityBottles, record.bottles, record.quantity), 0);
      const purchased = matchingPurchases.reduce((sum, item) => sum + materialQuantity(item), 0) + openingQty;
      const remaining = computeInventory({ materials: purchases, shopOpeningStock: openings, conversions: conversions.filter(r => getShopId(r) === shop.id) }).materials[type.key];
      const used = purchased - remaining;
      return {
        ...type,
        purchased: Number(purchased.toFixed(2)),
        used: Number(used.toFixed(2)),
        remaining: Number((purchased - used).toFixed(2)),
        totalCost: matchingPurchases.reduce((sum, item) => sum + materialCost(item), 0),
      };
    });
    return [shop.id, { shop, purchases, openings, stock }];
  })), [purchasedMaterials, conversions, openingStock]);

  const unassignedPurchases = useMemo(() => purchasedMaterials.filter((material) =>
    !getShopId(material) && CONTAINER_TYPES.some((type) => getContainerType(material) === type.key)
  ), [purchasedMaterials]);

  useEffect(() => {
    if (!isAdmin || loading || notificationPermission !== "granted" || typeof window === "undefined" || !("Notification" in window)) return;
    SHOPS.forEach((shop) => {
      (shopData[shop.id]?.stock || []).forEach((item) => {
        const key = `shop-material-low-${shop.id}-${item.key}`;
        if (item.purchased > 0 && item.remaining <= 30) {
          let alreadyNotified = false;
          try { alreadyNotified = window.localStorage.getItem(key) === "notified-low"; } catch { /* Optional notification state storage. */ }
          if (!alreadyNotified) {
            try {
              new window.Notification("Low shop material stock", {
                body: `${shop.name}: ${item.label} has ${formatNumber(item.remaining)} ${item.unit} remaining.`,
                tag: key,
              });
              window.localStorage.setItem(key, "notified-low");
            } catch (notificationError) {
              console.warn("Could not show low-stock notification:", notificationError);
            }
          }
        } else {
          try { window.localStorage.removeItem(key); } catch { /* Optional notification state storage. */ }
        }
      });
    });
  }, [shopData, isAdmin, loading, notificationPermission]);

  const enableNotifications = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }
    try {
      const permission = await window.Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission === "granted") {
        new window.Notification("Shop stock alerts enabled", {
          body: "You will be notified when a shop has 30 or fewer containers of a type remaining.",
        });
      }
    } catch (notificationError) {
      console.warn("Could not request browser notification permission:", notificationError);
    }
  };

  if (loading) {
    return <div className="stock-container"><div className="stock-loading"><div className="stock-spinner" /><h2>Loading Shop Stock</h2><p>Connecting to shop material purchases and sales…</p></div></div>;
  }

  return (
    <div className="stock-container">
      <header className="stock-header">
        <div>
          <span className="stock-eyebrow">SHOP INVENTORY</span>
          <h1>Shop Materials Stock Tracker</h1>
          <p>Track packaging purchases, containers consumed when oil is turned, costs, dates, and remaining balances. Selling a filled bottle does not consume another empty container.</p>
        </div>
        <div className="stock-status"><span className="stock-live-dot" />Live shop records</div>
      </header>

      {error && <div className="stock-warning" role="alert">{error}</div>}

      <section className="stock-section">
        <div className="stock-section-header">
          <div><span className="stock-eyebrow">SHOP MATERIALS</span><h2>Packaging Stock by Shop</h2><p>Purchases increase empty containers; recorded oil turning consumes them in the matching shop.</p></div>
          {isAdmin && (
            <button type="button" className="stock-status" onClick={enableNotifications} disabled={notificationPermission === "unsupported" || notificationPermission === "denied"}>
              {notificationPermission === "granted" ? "Browser alerts enabled" : notificationPermission === "denied" ? "Allow alerts in browser settings" : notificationPermission === "unsupported" ? "Browser alerts unavailable" : "Enable low-stock alerts"}
            </button>
          )}
        </div>

        {SHOPS.map((shop) => {
          const data = shopData[shop.id] || { purchases: [], stock: [], openings: [] };
          return (
            <div key={shop.id} style={{ marginBottom: 28 }}>
              <div className="stock-section-header"><div><h3>{shop.name}</h3><p>{data.purchases.length} purchased material records · {data.openings.length} opening stock records</p></div></div>
              <div className="stock-list">
                {data.stock.map((item) => (
                  <article className="stock-item" key={`${shop.id}-${item.key}`}>
                    <div className="stock-material-icon stock-product-image"><img src={item.image || palmOilImage} alt={item.label} loading="lazy" /></div>
                    <div className="stock-item-details">
                      <h3>{item.label}</h3>
                      <div className="stock-meta">
                        <span>Purchased: {formatNumber(item.purchased)}</span>
                        <span>Used in oil turning: {formatNumber(item.used)}</span>
                        <span>Purchase cost: {formatCurrency(item.totalCost)}</span>
                      </div>
                    </div>
                    <div className="stock-item-cost"><span>Remaining</span><strong>{formatNumber(item.remaining)}</strong></div>
                  </article>
                ))}
              </div>

              <h4 style={{ marginTop: 16 }}>Purchase history — {shop.name}</h4>
              {data.purchases.length === 0 ? (
                <div className="stock-empty"><p>No purchased packaging materials recorded for this shop yet. Save the purchase in Materials Management and select this shop.</p></div>
              ) : (
                <div className="stock-list">
                  {data.purchases.slice().sort((a, b) => timestamp(recordDate(b)) - timestamp(recordDate(a))).map((material) => (
                    <article className="stock-item" key={material.id}>
                      <div className="stock-material-icon stock-product-image"><img src={getContainerType(material) === "75cl" ? bottle75Image : getContainerType(material) === "1L" ? bottle1LImage : getContainerType(material) === "5L" ? jerrycan5LImage : palmOilImage} alt={material.materialName || material.name || "Oil product"} loading="lazy" /></div>
                      <div className="stock-item-details">
                        <h3>{material.materialName || material.name || material.material || "Unnamed material"}</h3>
                        <div className="stock-meta">
                          <span>Quantity: {formatNumber(materialQuantity(material))}</span>
                          <span>Date: {formatDate(recordDate(material))}</span>
                          <span>Status: {material.status || "Purchased"}</span>
                        </div>
                      </div>
                      <div className="stock-item-cost"><span>Purchase cost</span><strong>{formatCurrency(materialCost(material))}</strong></div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {isAdmin && unassignedPurchases.length > 0 && (
          <div className="stock-warning" role="status"><strong>Admin review required:</strong> {unassignedPurchases.length} packaging purchase record(s) have no recognised shop. They have not been added to either shop's balance.</div>
        )}
        <p className="stock-note">Low-stock alerts trigger at 30 or fewer remaining containers for each shop and material. Browser notifications require permission and this page to remain open.</p>
      </section>

      <footer className="stock-footer">Shop inventory • Live Firestore records</footer>
    </div>
  );
}
