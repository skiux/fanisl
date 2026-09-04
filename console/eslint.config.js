import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

/**
 * 这个项目原先没有 lint。代价是实打实的：`RealizedDays` 把空数组的守卫写在几个
 * `useMemo` 之后——hook 先跑、守卫永远轮不到，合约域名 451 时整页白屏。
 * 这类错误 TypeScript 查不出来、人眼也看不住，只有 hooks 规则能拦。
 *
 * 规则只开两组，不引入一整套风格约束：hooks 的正确性，和 TS 的推荐集。
 * 格式化的事交给编辑器，不在这里吵。
 */
export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // shared/ 在仓库根，落在这份配置的 base path 之外，eslint 扫不到。
    // 那份只有一个组件，暂不为它单独铺一套配置。
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // **只开正确性两条，不开整套 recommended。** 新版插件里还带着一批 React
      // Compiler 的风格规则（effect 里不许 setState、渲染期不许调不纯函数……），
      // 要满足它们得把这个项目的取数逻辑整个重写——那是另一件事，不该混在
      // "加一道 lint 拦白屏"里。哪天要做再单独开。
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // 数据结构里 any 太多会让类型检查形同虚设，但现有代码里还有几处，先警告
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
)
