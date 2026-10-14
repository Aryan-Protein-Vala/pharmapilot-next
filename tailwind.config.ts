import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        navy: {
          900: "#0F172A", // Executive Deep Navy
          800: "#1E293B",
          700: "#334155",
          600: "#475569",
        },
        teal: {
          900: "#134E4A",
          800: "#115E59",
          700: "#0F766E",
          600: "#0D9488", // Clinical Teal Accent
          500: "#14B8A6",
          400: "#2DD4BF",
          100: "#CCFBF1",
          50: "#F0FDFA",
        },
        clinical: {
          bg: "#F8FAFC",
          card: "#FFFFFF",
          border: "#E2E8F0",
          borderStrong: "#CBD5E1",
          text: "#0F172A",
          textMuted: "#64748B",
        },
        alert: {
          amber: "#D97706",
          amberBg: "#FEF3C7",
          amberText: "#92400E",
          red: "#DC2626",
          redBg: "#FEE2E2",
          redText: "#991B1B",
          green: "#059669",
          greenBg: "#ECFDF5",
          greenText: "#065F46",
        }
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
