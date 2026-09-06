import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Filet de sécurité défensif, pas une correction de faille — voir docs/architecture/xss-policy.md
//
// `'unsafe-inline'` dans `script-src` est requis : Next.js injecte des scripts inline
// (self.__next_f / self.__next_r) dont dépend l'hydratation de tout composant client ;
// sans lui, une CSP `script-src 'self'` rend toute page blanche (« Expected a request ID
// … self.__next_r »). La variante stricte à nonce (proxy.ts + rendu dynamique) est le
// durcissement de long terme ; la protection XSS principale reste la règle ESLint
// `react/no-danger` (ARCHI-9), la CSP n'est qu'un filet.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
