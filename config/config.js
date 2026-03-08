/**
 * config.js
 *
 * Para usar la API oficial de Codeforces (submit sin Cloudflare):
 *   1. Ve a https://codeforces.com/settings/api
 *   2. Genera un API Key + Secret
 *   3. Ponlos aquí en apiKey y apiSecret
 *
 * Si los dejas vacíos (""), el sistema usará scraping con curl-impersonate.
 */

const config = {

  server: {
    port: 3000
  },

  cf: {
    // Opcional: API Key oficial de Codeforces (evita Cloudflare completamente)
    apiKey: "",
    apiSecret: ""
  }

}

export default config
