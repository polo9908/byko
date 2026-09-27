import { resolve } from "path"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          // Helper de messagerie native : un processus distinct, lancé par
          // Chrome et exécuté par Node (voir docs/ipc/browser-automation.md).
          nativeHost: resolve(__dirname, "src/native-host/index.ts"),
        },
      },
    },
  },
  preload: {
    // Pas d'externalizeDepsPlugin ici : un preload sandboxé (voir
    // BrowserWindow.webPreferences.sandbox dans src/main/index.ts) tourne dans
    // un require() restreint qui ne résout pas les paquets npm (seulement
    // "electron" et quelques modules Node). Ses dépendances doivent donc être
    // bundlées ; seul "electron" reste externe (fourni par le runtime).
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/preload/index.ts"),
        },
        external: ["electron"],
        output: {
          // Un preload sandboxé ne peut pas non plus être un module ES
          // ("Cannot use import statement outside a module"). On force du
          // CommonJS via l'extension .cjs, qui l'exempte du "type": "module"
          // du package.json.
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve(__dirname, "src/renderer/src"),
        "@shared": resolve(__dirname, "src/shared"),
      },
    },
    plugins: [react()],
  },
})
