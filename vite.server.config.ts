import { defineConfig } from "vite";
export default defineConfig({
  publicDir: false,
  build: {
    ssr: true, outDir: "build/server", target: "node24", minify: false,
    rolldownOptions: {
      input: { main: "server/main.ts", cli: "server/cli.ts", backup: "server/backup-cli.ts" },
      output: { entryFileNames: "[name].js" },
    },
  },
});
