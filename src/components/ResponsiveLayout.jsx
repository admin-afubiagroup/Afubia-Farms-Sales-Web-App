
import { useEffect } from "react";
import "./layout.css";
import { stopAllAudio } from "./AudioManager";

const ResponsiveLayout = ({ children }) => {

  useEffect(() => {

    // Stop all audio when leaving the page
    return () => {
      stopAllAudio();
    };

  }, []);

  return (
    <div className="layout">

      <header className="layout-header">

        <div className="header-content">

          <div className="brand-mark">
            AF
          </div>

          <div className="brand-text">

            <h1>
              Afubia Farms
            </h1>

            <span>
              Palm Oil Sales
            </span>

          </div>

        </div>

      </header>


      <main className="layout-main">

        <div className="layout-card">
          {children}
        </div>

      </main>


      <footer className="layout-footer">

        <span>
          © 2026 Afubia Farms
        </span>

        <span>
          •
        </span>

        <span>
          Palm Oil Sales System
        </span>

      </footer>

    </div>
  );
};

export default ResponsiveLayout;

