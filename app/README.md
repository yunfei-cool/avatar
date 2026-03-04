# React + TypeScript + Vite

## DeepSeek Key（后端托管）

项目已改为后端代理 DeepSeek，前端不再配置 API Key。

1. 在本地创建 `app/.env.local`（不要提交）：

```bash
DEEPSEEK_API_KEY=your_real_key
DEEPSEEK_API_BASE=https://api.deepseek.com/v1
VITE_DEEPSEEK_PROXY_ENDPOINT=/api/deepseek/chat/completions
VITE_DEEPSEEK_MODEL=deepseek-chat
```

2. 启动开发：

```bash
npm run dev
```

## 公域 Web 快速部署（Vercel）

1. 代码推送到 GitHub。
2. 在 Vercel 新建项目，Root Directory 选择 `app/`。
3. 在 Vercel 项目环境变量中配置：
   - `DEEPSEEK_API_KEY`（必填）
   - `DEEPSEEK_API_BASE`（可选，默认 `https://api.deepseek.com/v1`）
   - `VITE_DEEPSEEK_PROXY_ENDPOINT`（可选，默认 `/api/deepseek/chat/completions`）
   - `VITE_DEEPSEEK_MODEL`（可选，默认 `deepseek-chat`）
4. 点击 Deploy，部署完成后访问分配域名即可。

说明：
- 前端请求路径是 `/api/deepseek/chat/completions`。
- 线上由 `app/api/deepseek/chat/completions.js` 作为 Serverless 代理转发到 DeepSeek。
- 这样 API Key 只存在于服务端环境变量，不暴露给浏览器。

## 安全要求

- 永远不要把真实 `DEEPSEEK_API_KEY` 写进前端源码（`src/`）或提交到仓库。
- `.env.local` 必须在 `.gitignore` 中。
- 泄露后立即在 DeepSeek 控制台轮换（Rotate）密钥。
- 服务端代理应限制来源域名与调用频率（生产环境建议增加鉴权和限流）。

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
