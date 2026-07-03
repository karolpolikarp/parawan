import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Ścieżki względne: zbudowany dist/index.html działa też otwarty PROSTO Z DYSKU
  // (podwójny klik, file://) — bez żadnego serwera.
  base: './',
  resolve: {
    alias: {
      // Importujemy rdzeń bezpośrednio ze źródeł TS — dev/build nie wymaga
      // wcześniejszego `npm run build` w packages/core.
      'anonimizator/ner': fileURLToPath(new URL('../../packages/core/src/ner-client.ts', import.meta.url)),
      anonimizator: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
});
