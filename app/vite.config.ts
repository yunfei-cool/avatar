import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import { deepseekProxyPlugin } from "./deepseekProxyPlugin"

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const deepseekApiKey = env.DEEPSEEK_API_KEY || '';
  const deepseekApiBase = (env.DEEPSEEK_API_BASE || 'https://api.deepseek.com/v1').trim();
  const deepseekProxyPath = (env.VITE_DEEPSEEK_PROXY_ENDPOINT || '/api/deepseek/chat/completions').trim();

  return {
    base: './',
    plugins: [
      inspectAttr(),
      react(),
      deepseekProxyPlugin({
        apiKey: deepseekApiKey,
        apiBase: deepseekApiBase,
        proxyPath: deepseekProxyPath,
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
