// Configuración de FileNote (gratis: sin licencia ni cuenta).
module.exports = {
  // Web de la suite Razor y página de descarga de FileNote.
  siteUrl: 'https://razorweb.vercel.app',
  downloadsUrl: 'https://razorweb.vercel.app/filenote',
  // Releases públicas de GitHub: latest.yml (Windows) y latest-mac.yml (Mac).
  updatesUrl: 'https://github.com/Eva-one01/FileNote/releases/latest/download',
  // Mac sin firmar no puede instalar solo: se avisa y se abre la página de descarga.
  macAutoUpdate: false,
  // Informes de errores (Sentry → proyecto → Client Keys (DSN)). Vacío = sin informes.
  sentryDsn: '',
};
