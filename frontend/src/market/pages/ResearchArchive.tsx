import { ArrowLeft } from '@phosphor-icons/react'
import { fetchResearchDoc, fetchResearchDocs } from '../../api'
import { useQuery } from '../../lib/useQuery'
import { navigate } from '../../lib/router'
import { QueryGate } from '../ui'
import MarkdownRenderer from '../../components/MarkdownRenderer'

// 研究档案（Reading 容器）：负结果是资产——capstone 与 23 裁决在产品内体面陈列。
// 文档由后端白名单只读提供（/research/docs），与 doc/ 目录同源。

export default function ResearchArchive({ name }: { name?: string }) {
  return name ? <Doc name={name} /> : <Index />
}

function Index() {
  const docs = useQuery(() => fetchResearchDocs(), [])
  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto bg-white">
      <div className="mx-auto max-w-[44rem] px-6 pb-28 pt-10">
        <button onClick={() => navigate('/research')}
          className="flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-700">
          <ArrowLeft size={14} /> 研究
        </button>
        <h1 className="mt-8 text-2xl font-semibold tracking-tight text-zinc-900">研究档案</h1>
        <p className="mt-2.5 text-sm text-zinc-400">
          23 个预注册假设全部 KILLED——负结果照实入档，是这套纪律最大的遗产。判据原文见预注册文档（锁死，永不修改）。
        </p>
        <QueryGate q={docs} skeletonHeight={160}>
          {(list) => (
            <div className="mt-10">
              {list.map((d) => (
                <button key={d.name} onClick={() => navigate(`/research/archive/${d.name}`)}
                  className="-mx-4 block w-[calc(100%+2rem)] rounded-xl px-4 py-3.5 text-left transition-colors duration-150 hover:bg-zinc-50">
                  <div className="text-md font-medium text-zinc-900">{d.title}</div>
                  <div className="mt-0.5 font-mono text-2xs text-zinc-400">{d.name}</div>
                </button>
              ))}
            </div>
          )}
        </QueryGate>
      </div>
    </div>
  )
}

function Doc({ name }: { name: string }) {
  const doc = useQuery(() => fetchResearchDoc(name), [name])
  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto bg-white">
      <div className="mx-auto max-w-[44rem] px-6 pb-28 pt-10">
        <button onClick={() => navigate('/research/archive')}
          className="flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-700">
          <ArrowLeft size={14} /> 研究档案
        </button>
        <QueryGate q={doc} skeletonHeight={400}>
          {(d) => (
            <>
              <h1 className="mt-8 text-2xl font-semibold tracking-tight text-zinc-900">{d.title}</h1>
              <p className="mt-2 font-mono text-2xs text-zinc-400">{d.path}（只读陈列，与仓库同源）</p>
              <div className="mt-10 text-md leading-[1.9] text-zinc-700">
                <MarkdownRenderer content={d.content} />
              </div>
            </>
          )}
        </QueryGate>
      </div>
    </div>
  )
}
