import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import ShopStock from "./components/ShopStock";
import Login from "./components/Login";

import SalesgirlDashboard from "./components/SalesgirlDashboard";
import AdminDashboard from "./components/AdminDashboard";

import SalesForm from "./components/SalesForm";
import ConversionForm from "./components/ConversionForm";

import MaterialsForm from "./components/MaterialsForm";
import StockTracker from "./components/StockTracker";
import ProfitAnalysis from "./components/ProfitAnalysis";

import ProtectedRoute from "./components/ProtectedRoute";
import Reports from "./components/Reports";
import ProductManagement from "./components/ProductManagement";
import StaffLocationTracker from "./components/StaffLocationTracker";
import ResponsiveLayout from './components/ResponsiveLayout';
import FirstRunGuide from './components/FirstRunGuide';

function App() {
  return (
    <Router>
      <StaffLocationTracker />
      <FirstRunGuide />
      <Routes>

        {/* =====================================================
            LOGIN
        ===================================================== */}

        <Route
          path="/login"
          element={<Login />}
        />

        {/* =====================================================
            SALESGIRL DASHBOARD
        ===================================================== */}

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <SalesgirlDashboard />
            </ProtectedRoute>
          }
        />

        {/* =====================================================
            SALES
        ===================================================== */}

        <Route
          path="/sales"
          element={
            <ProtectedRoute>
              <SalesForm />
            </ProtectedRoute>
          }
        />

        {/* =====================================================
            CONVERSION
        ===================================================== */}

        <Route
          path="/conversion"
          element={
            <ProtectedRoute>
              <ConversionForm />
            </ProtectedRoute>
          }
        />

        {/* =====================================================
            ADMIN DASHBOARD
        ===================================================== */}

        <Route
          path="/admin"
          element={
            <ProtectedRoute adminOnly>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />

        {/* =====================================================
            ADMIN REPORTS
        ===================================================== */}

        <Route
          path="/admin/products"
          element={<ProtectedRoute adminOnly><ProductManagement /></ProtectedRoute>}
        />

        <Route
          path="/admin/shop-stock"
          element={
            <ProtectedRoute adminOnly>
              <ResponsiveLayout><ShopStock /></ResponsiveLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/reports"
          element={
            <ProtectedRoute adminOnly>
              <Reports />
            </ProtectedRoute>
          }
        />

        {/* =====================================================
            ADMIN MATERIALS
        ===================================================== */}

        <Route
          path="/admin/materials"
          element={
            <ProtectedRoute adminOnly>
              <ResponsiveLayout><MaterialsForm /></ResponsiveLayout>
            </ProtectedRoute>
          }
        />

        {/* =====================================================
            ADMIN STOCK
        ===================================================== */}

        <Route
          path="/admin/stock"
          element={
            <ProtectedRoute adminOnly>
              <ResponsiveLayout><StockTracker /></ResponsiveLayout>
            </ProtectedRoute>
          }
        />

        {/* =====================================================
            ADMIN PROFIT
        ===================================================== */}

        <Route
          path="/admin/profit"
          element={
            <ProtectedRoute adminOnly>
              <ProfitAnalysis />
            </ProtectedRoute>
          }
        />

        {/* =====================================================
            DEFAULT ROUTE
        ===================================================== */}

        <Route
          path="/"
          element={
            <Navigate
              to="/login"
              replace
            />
          }
        />

        {/* =====================================================
            UNKNOWN ROUTES
        ===================================================== */}

        <Route
          path="*"
          element={
            <Navigate
              to="/login"
              replace
            />
          }
        />

      </Routes>
    </Router>
  );
}

export default App;
