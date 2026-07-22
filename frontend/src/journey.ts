export const chapters = [
  {
    id: 'entry',
    index: '00',
    label: '入口',
    english: 'ENTER',
    stop: 0,
    title: '把分散的投资内容，沉淀成自己的知识。',
    description: '保存原文，拆出判断、方法与认知，再让它们归并、演进并彼此连接。',
  },
  {
    id: 'source',
    index: '01',
    label: '内容',
    english: 'CONTENT',
    stop: 0.17,
    title: '所有知识，先有一段可以返回的原文。',
    description: '转录、画面信息、发布时间与信源完整留存，后面的结构始终能退回证据。',
  },
  {
    id: 'units',
    index: '02',
    label: '单元',
    english: 'EXTRACT',
    stop: 0.36,
    title: '一篇内容被拆开，三种知识各自留下。',
    description: '判断、方法与认知带着逐字引文和出处，进入各自适合的长期结构。',
  },
  {
    id: 'node',
    index: '03',
    label: '节点',
    english: 'MERGE',
    stop: 0.55,
    title: '重复不再堆积，新的表达回到同一节点。',
    description: '重申、细化、修正与反驳成为一条可回看的知识时间线。',
  },
  {
    id: 'relations',
    index: '04',
    label: '关系',
    english: 'DISCOVER',
    stop: 0.74,
    title: '当知识彼此连接，研究才真正开始。',
    description: '对立暴露分歧，互补拼合解释，跨源共识显示新的理解正在形成。',
  },
  {
    id: 'library',
    index: '05',
    label: '知识库',
    english: 'REMEMBER',
    stop: 0.92,
    title: '抵达的不是终点，而是一座会继续生长的知识库。',
    description: '它从 2 位信源和 18 篇内容开始，每次新增都进入同一套长期结构。',
  },
] as const

export function getActiveChapter(progress: number) {
  let active = 0
  chapters.forEach((chapter, index) => {
    if (index === 0) return
    const previousStop = chapters[index - 1].stop
    const arrival = previousStop + (chapter.stop - previousStop) * 0.88
    if (progress >= arrival) active = index
  })
  return active
}
