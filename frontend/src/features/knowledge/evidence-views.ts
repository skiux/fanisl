// 单元档案的四个 tab。单独成文件：组件文件只导出组件，热更新才不会退化成整页刷新（oxlint only-export-components）。
export type EvidenceView = 'structure' | 'verdict' | 'source' | 'review'

export const EVIDENCE_VIEWS: EvidenceView[] = ['structure', 'verdict', 'source', 'review']
