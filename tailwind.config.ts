import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Map to the CSS variables wired in layout.tsx via next/font.
        display: ['var(--font-dm-serif)', 'Georgia', 'serif'],
        body: ['var(--font-dm-sans)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        // Kid identity — KidSync's single chromatic affordance. Paper-tuned.
        // Users can override per-row via Kid.color; these are the defaults.
        kid: {
          ethan: "#8a6a1f",
          "ethan-bg": "#f6f1e3",
          "ethan-fg": "#5c4614",
          "ethan-light": "rgba(138, 106, 31, 0.10)",
          harrison: "#4a5a6a",
          "harrison-bg": "#eceef1",
          "harrison-fg": "#303d4a",
          "harrison-light": "rgba(74, 90, 106, 0.10)",
        },
        // Cerulean action — single chromatic anchor for interactive
        // primitives (today, primary CTA, active nav, focus, toggle on).
        action: {
          DEFAULT: "#0369a1",
          hover: "#075985",
          pressed: "#0c4a6e",
          fg: "#ffffff",
          bg: "#eff6fb",
        },
        // Custody parent tints — applied to full day-cell bg.
        custody: {
          "you-bg": "#e6ecf2",
          "you-line": "#93a4b3",
          "you-text": "#374a5d",
          "them-bg": "#faefd1",
          "them-line": "#c7b58c",
          "them-text": "#6b5a2c",
        },
        // Heavy border — calendar week dividers (neutral gray).
        "border-heavy": "#8e8e8c",
      },
      animation: {
        "slide-up": "slideUp 0.3s ease-out",
        "fade-in": "fadeIn 0.2s ease-out",
        "scale-in": "scaleIn 0.2s ease-out",
      },
      keyframes: {
        slideUp: {
          "0%": { transform: "translateY(12px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        scaleIn: {
          "0%": { transform: "scale(0.95)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
      borderRadius: {
        // Ink & Paper — hard edges by default. Avatars/circles still use "full".
        none: "0",
      },
    },
  },
  plugins: [],
};
export default config;
