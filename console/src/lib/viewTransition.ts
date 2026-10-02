import { flushSync } from 'react-dom'

/**
 * 换页、换分节时旧内容先退、新内容后进，避免密集数字重叠成重影。
 *
 * 用浏览器自带的 View Transitions：旧画面截一张、新画面渲染好，两者的
 * 淡变时序与报头、导航不参与淡变的规则在 index.css。Material 对底部导航
 * 在顶层页面之间切换的建议就是这种不带方向的淡变——顶层页面之间没有空间上的前后关系；
 * NN/g 也提醒越常出现的动画越要短越轻。原先每次切分节都重播 560ms、上移 8px 的入场，
 * 整屏大面积位移，切多了看着累。
 *
 * 不支持的浏览器、系统开了"减少动态效果"、页面在后台时直接更新，什么都不播。
 * 后台标签页里浏览器本来就会放弃过渡，还会把 `ready` 以 InvalidStateError 拒掉——
 * 不先挡住的话，控制台每切一次就多一条未处理的报错。
 * `flushSync`：React 的更新默认是异步的，不同步落地的话浏览器截到的"新画面"还是旧的。
 */
export function withViewTransition(update: () => void) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (typeof document.startViewTransition !== 'function' || reduce
      || document.visibilityState !== 'visible') {
    update()
    return
  }
  const transition = document.startViewTransition(() => flushSync(update))
  // 过渡被浏览器放弃（连续快速切换时会发生）不是错误：更新本身已经落地
  transition.ready.catch(() => {})
}
