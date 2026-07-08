import PropTypes from "prop-types";

// One line-icon language for every control in the app, replacing the mix of
// emoji and bare unicode glyphs (📍 ⬠ 📏 💾 📂 👁 🚫 ☰ ▲ ▼ ✕) that used to
// render inconsistently across operating systems and fonts.
const PATHS = {
  point: (
    <>
      <path d="M12 21.5s7-6.85 7-12.5a7 7 0 1 0-14 0c0 5.65 7 12.5 7 12.5Z" />
      <circle cx="12" cy="9" r="2.4" />
    </>
  ),
  line: (
    <>
      <circle cx="5.5" cy="18.5" r="1.8" />
      <path d="m7 17 10-10" />
      <circle cx="18.5" cy="5.5" r="1.8" />
    </>
  ),
  polygon: <path d="m12 3 8 5.8-3 9.7H7L4 8.8Z" />,
  save: (
    <>
      <path d="M12 3v11m0 0-4-4m4 4 4-4" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </>
  ),
  upload: (
    <>
      <path d="M12 20V9m0 0-4 4m4-4 4 4" />
      <path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.7C11 5.6 11.5 5.5 12 5.5c6.5 0 10 6.5 10 6.5a15.6 15.6 0 0 1-3.4 4.2M6.6 6.7A15.7 15.7 0 0 0 2 12s3.5 6.5 10 6.5c1.3 0 2.5-.25 3.6-.7" />
      <path d="M9.9 9.9a2.6 2.6 0 0 0 3.6 3.6" />
    </>
  ),
  drag: (
    <>
      <path d="M5 8h14" />
      <path d="M5 12h14" />
      <path d="M5 16h14" />
    </>
  ),
  zoomTo: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 7v6M7 10h6" />
      <path d="m19 19-4.3-4.3" />
    </>
  ),
  chevronUp: <path d="m6 15 6-6 6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  arrowUp: <path d="M12 19V6m0 0-5 5m5-5 5 5" />,
  arrowDown: <path d="M12 5v13m0 0 5-5m-5 5-5-5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />
};

export default function Icon({ name, size = 18, className }) {
  const path = PATHS[name];
  if (!path) return null;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {path}
    </svg>
  );
}

Icon.propTypes = {
  name: PropTypes.oneOf(Object.keys(PATHS)).isRequired,
  size: PropTypes.number,
  className: PropTypes.string
};
