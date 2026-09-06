import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone es para la imagen Docker (Linux). En Windows el trazado crea
  // symlinks que requieren permisos elevados, así que ahí se omite.
  output: process.platform === "win32" ? undefined : "standalone",
  // El paquete `postgres` usa APIs de Node que no deben empaquetarse en el bundle.
  serverExternalPackages: ["postgres"],
  // Verificación de propiedad del dominio para Google (Search Console →
  // verificación de la app OAuth): Google pide servir `/google<token>.html`
  // en la raíz, sin redirecciones ni login. El rewrite es interno (el
  // cliente ve 200 en esa URL) y el handler solo responde si el nombre
  // coincide con GOOGLE_SITE_VERIFICATION (runtime, sin rebuild).
  async rewrites() {
    return [
      {
        source: "/:file(google[A-Za-z0-9_-]+\\.html)",
        destination: "/api/site-verification/google/:file",
      },
    ];
  },
};

export default nextConfig;
