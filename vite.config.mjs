import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

export default {
  // Pin root to this file's folder so the server works from any cwd.
  root: fileURLToPath(new URL('.', import.meta.url)),
  // GitHub Pages serves the site from /<repo>/ — asset URLs must match.
  base: '/cube-lab/',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5199,
    strictPort: true,
    watch: {
      ignored: ['**/.pnpm-store/**', '**/.acl-recovery/**', '**/*.tmpdir/**', '**/*.tmp'],
    },
  },
};
