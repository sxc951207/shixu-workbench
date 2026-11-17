# 第三方来源

直接依赖版本记录在 package.json，传递依赖与完整性校验记录在 package-lock.json。

| 内容 | 来源 | 锁定版本及许可 |
| --- | --- | --- |
| 网页与界面 | [React](https://github.com/facebook/react)、[Lucide](https://github.com/lucide-icons/lucide)、[Recharts](https://github.com/recharts/recharts) | React / React DOM 19.2.6 MIT，lucide-react 1.31.0 ISC（包含图标上游声明），Recharts 3.8.0 MIT |
| 权限与状态 | [CASL](https://github.com/stalniy/casl)、[XState](https://github.com/statelyai/xstate) | 7.1.3 / 5.33.4，均为 MIT；CASL 使用的 @ucast 包附 Apache-2.0 |
| 校验与存储 | [Zod](https://github.com/colinhacks/zod)、[CloudBase Node SDK](https://github.com/TencentCloudBase/node-sdk) | 3.25.76 / 3.18.7，均为 MIT |
| 表格读取 | [read-excel-file](https://github.com/catamphetamine/read-excel-file) | 9.3.15 MIT，相关 fflate、saxen、unzipper-esm 的许可证也随附 |
| OCR | [Tesseract.js](https://github.com/naptha/tesseract.js)、[Tesseract.js-core](https://github.com/naptha/tesseract.js-core)、[tessdata_best](https://github.com/tesseract-ocr/tessdata_best) | Tesseract.js 7.0.0 和识别引擎使用 Apache-2.0。语言包来自 @tesseract.js-data/eng 和 chi_sim 1.0.0 的 4.0.0_best_int |
| 构建链 | [Vite](https://github.com/vitejs/vite)、[esbuild](https://github.com/evanw/esbuild)、[Tailwind CSS](https://github.com/tailwindlabs/tailwindcss)、[TypeScript](https://github.com/microsoft/TypeScript) | Vite 8.0.13、esbuild 0.28.0、Tailwind 4.2.1 为 MIT，TypeScript 5.9.3 为 Apache-2.0 |

原始许可文本在 `public/licenses/`。两份语言包的名称、来源与 SHA-256 在 `public/ocr/v7/models.json`。网页构建检查语言包哈希，从锁定依赖复制 OCR worker、引擎和上游声明，并生成实际打入网页的依赖许可清单 `dist/web/licenses/bundled-dependencies.md`。主函数和备份函数构建各自携带许可目录。

上述许可适用于相应第三方组件。模板自有部分的对外授权由所有者决定。
