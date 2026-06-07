'use client'

import React, {
  useEffect,
  useState,
  memo,
  useMemo,
  useCallback,
  useRef,
} from 'react'
import Prism from 'prismjs'
import '../styles/code-block.css'

// 导入需要的语言支持
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-java'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-scss'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-nginx'
import 'prismjs/components/prism-docker'

interface MarkdownRendererProps {
  content: string
  className?: string
}

interface ListItem {
  content: string
  level: number
  type: 'unordered' | 'ordered'
  children?: ListItem[]
}

interface Section {
  type:
    | 'title'
    | 'subtitle'
    | 'text'
    | 'code'
    | 'list'
    | 'quote'
    | 'table'
    | 'divider'
  content: string
  level?: number
  language?: string
  listType?: 'unordered' | 'ordered'
  listItems?: ListItem[]
  dividerType?: 'dash' | 'star' | 'equal' | 'underscore'
}

// 复制到剪贴板的组件 - OpenAI 风格
const CopyButton = memo(({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('复制失败:', err)
    }
  }, [text])

  return (
    <button
      onClick={copyToClipboard}
      className="p-2 rounded-md text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200"
      title="复制代码"
    >
      {copied ? (
        <svg
          className="w-4 h-4 text-green-600 dark:text-green-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      ) : (
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
      )}
    </button>
  )
})

CopyButton.displayName = 'CopyButton'

const MarkdownRenderer = memo(
  ({ content, className = '' }: MarkdownRendererProps) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const [isClient, setIsClient] = useState(false)

    // 客户端检测
    useEffect(() => {
      setIsClient(true)
    }, [])

    // 缓存文本格式处理函数 - OpenAI 风格
    const processInlineFormats = useCallback((text: string): string => {
      return text
        .replace(
          /\*\*(.*?)\*\*/g,
          '<strong class="font-semibold text-gray-700 dark:text-gray-300">$1</strong>'
        )
        .replace(
          /\*(.*?)\*/g,
          '<em class="italic text-gray-600 dark:text-gray-400">$1</em>'
        )
        .replace(
          /`([^`]*)`/g,
          '<code class="px-2 py-1 rounded-md text-sm font-mono text-gray-700 dark:text-gray-300" style="background-color: rgb(236, 236, 236);">$1</code>'
        )
        .replace(
          /\$([^$]+)\$/g,
          '<span class="px-2 py-1 rounded-md text-sm font-mono text-gray-700 dark:text-gray-300" style="background-color: rgb(236, 236, 236);">$1</span>'
        )
        .replace(
          /\[([^\]]+)\]\(([^)]+)\)/g,
          '<a href="$2" class="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline underline-offset-2 transition-colors duration-200" target="_blank" rel="noopener noreferrer">$1</a>'
        )
    }, [])

    // 缓存列表类型判断
    const getListType = useCallback(
      (listItems: string[]): 'unordered' | 'ordered' => {
        if (listItems.length === 0) return 'unordered'
        const firstItem = listItems[0].trim()
        return firstItem.match(/^\d+\./) ? 'ordered' : 'unordered'
      },
      []
    )

    // 缓存缩进层级计算
    const getIndentLevel = useCallback((line: string): number => {
      const match = line.match(/^(\s*)/)
      return match ? Math.floor(match[1].length / 2) : 0
    }, [])

    // 缓存嵌套列表解析
    const parseNestedList = useCallback(
      (listLines: string[]): ListItem[] => {
        const items: ListItem[] = []
        const stack: ListItem[] = []

        for (const line of listLines) {
          const level = getIndentLevel(line)
          const trimmedLine = line.trim()
          const isOrdered = /^\d+\./.test(trimmedLine)
          const content = trimmedLine
            .replace(/^[-*+]\s*/, '')
            .replace(/^\d+\.\s*/, '')

          const item: ListItem = {
            content,
            level,
            type: isOrdered ? 'ordered' : 'unordered',
            children: [],
          }

          while (stack.length > 0 && stack[stack.length - 1].level >= level) {
            stack.pop()
          }

          if (stack.length === 0) {
            items.push(item)
          } else {
            const parent = stack[stack.length - 1]
            if (!parent.children) parent.children = []
            parent.children.push(item)
          }

          stack.push(item)
        }

        return items
      },
      [getIndentLevel]
    )

    // 缓存 markdown 解析结果 - 只在客户端解析
    const parseMarkdown = useCallback(
      (markdownContent: string): Section[] => {
        if (!isClient) return [] // 服务端返回空数组

        const lines = markdownContent.split('\n')
        const sections: Section[] = []

        let currentCodeBlock = ''
        let inCodeBlock = false
        let codeLanguage = ''
        let currentList: string[] = []
        let inList = false
        let currentTable: string[] = []
        let inTable = false

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          const trimmedLine = line.trim()

          // 代码块处理 - 修复：使用 trimmedLine 来识别代码块，支持有缩进的代码块
          if (trimmedLine.startsWith('```')) {
            if (inCodeBlock) {
              sections.push({
                type: 'code',
                content: currentCodeBlock.replace(/\n$/, ''),
                language: codeLanguage,
              })
              currentCodeBlock = ''
              inCodeBlock = false
              codeLanguage = ''
            } else {
              if (inList && currentList.length > 0) {
                sections.push({
                  type: 'list',
                  content: currentList.join('\n'),
                  listType: getListType(currentList),
                  listItems: parseNestedList(currentList),
                })
                currentList = []
                inList = false
              }
              if (inTable && currentTable.length > 0) {
                sections.push({
                  type: 'table',
                  content: currentTable.join('\n'),
                })
                currentTable = []
                inTable = false
              }
              inCodeBlock = true
              codeLanguage = trimmedLine.replace('```', '').trim() || 'text'
            }
            continue
          }

          if (inCodeBlock) {
            currentCodeBlock += line + '\n'
            continue
          }

          // 表格处理
          if (line.includes('|') && line.trim().length > 0) {
            currentTable.push(line)
            inTable = true
            continue
          } else if (inTable && currentTable.length > 0) {
            sections.push({ type: 'table', content: currentTable.join('\n') })
            currentTable = []
            inTable = false
          }

          // 分割线处理
          if (line.match(/^-{3,}$|^={3,}$|^\*{3,}$|^_{3,}$/)) {
            if (inList && currentList.length > 0) {
              sections.push({
                type: 'list',
                content: currentList.join('\n'),
                listType: getListType(currentList),
                listItems: parseNestedList(currentList),
              })
              currentList = []
              inList = false
            }

            let dividerType: 'dash' | 'star' | 'equal' | 'underscore' = 'dash'
            if (line.match(/^-{3,}$/)) dividerType = 'dash'
            else if (line.match(/^\*{3,}$/)) dividerType = 'star'
            else if (line.match(/^={3,}$/)) dividerType = 'equal'
            else if (line.match(/^_{3,}$/)) dividerType = 'underscore'

            sections.push({ type: 'divider', content: '', dividerType })
            continue
          }

          // 标题处理
          if (line.startsWith('#')) {
            if (inList && currentList.length > 0) {
              sections.push({
                type: 'list',
                content: currentList.join('\n'),
                listType: getListType(currentList),
                listItems: parseNestedList(currentList),
              })
              currentList = []
              inList = false
            }
            const level = line.match(/^#+/)?.[0].length || 1
            const title = line.replace(/^#+\s*/, '').replace(/\s*​$/, '')
            sections.push({
              type: level === 1 ? 'title' : 'subtitle',
              content: title,
              level,
            })
            continue
          }

          // 引用处理
          if (line.startsWith('>')) {
            if (inList && currentList.length > 0) {
              sections.push({
                type: 'list',
                content: currentList.join('\n'),
                listType: getListType(currentList),
                listItems: parseNestedList(currentList),
              })
              currentList = []
              inList = false
            }
            let quoteContent = line.replace(/^>\s*/, '')
            let nextIndex = i + 1

            while (
              nextIndex < lines.length &&
              lines[nextIndex].startsWith('>')
            ) {
              quoteContent += '\n' + lines[nextIndex].replace(/^>\s*/, '')
              nextIndex++
            }

            sections.push({ type: 'quote', content: quoteContent })
            i = nextIndex - 1
            continue
          }

          // 列表处理
          if (line.match(/^(\s*)[-*+]\s/) || line.match(/^(\s*)\d+\.\s/)) {
            currentList.push(line)
            inList = true
            continue
          }

          if (
            inList &&
            line.match(/^\s+\S/) &&
            !line.match(/^(\s*)[-*+]\s/) &&
            !line.match(/^(\s*)\d+\.\s/)
          ) {
            currentList[currentList.length - 1] += '\n' + line
            continue
          }

          // 普通文本
          if (line.trim()) {
            if (inList && currentList.length > 0) {
              sections.push({
                type: 'list',
                content: currentList.join('\n'),
                listType: getListType(currentList),
                listItems: parseNestedList(currentList),
              })
              currentList = []
              inList = false
            }
            sections.push({ type: 'text', content: line })
          }
        }

        // 处理最后的内容
        if (inCodeBlock && currentCodeBlock.trim()) {
          // 处理未完成的代码块
          sections.push({
            type: 'code',
            content: currentCodeBlock.replace(/\n$/, ''),
            language: codeLanguage,
          })
        }
        if (inList && currentList.length > 0) {
          sections.push({
            type: 'list',
            content: currentList.join('\n'),
            listType: getListType(currentList),
            listItems: parseNestedList(currentList),
          })
        }
        if (inTable && currentTable.length > 0) {
          sections.push({ type: 'table', content: currentTable.join('\n') })
        }

        return sections
      },
      [isClient, getListType, parseNestedList]
    )

    // 缓存解析结果
    const sections = useMemo(
      () => parseMarkdown(content),
      [content, parseMarkdown]
    )

    // 缓存列表渲染函数 - OpenAI 风格
    const renderListItems = useCallback(
      (items: ListItem[], level: number = 0): React.JSX.Element[] => {
        return items.map((item, index) => {
          const processedContent = processInlineFormats(item.content)
          const hasChildren = item.children && item.children.length > 0
          const isOrdered = item.type === 'ordered'

          return (
            <li
              key={index}
              className={`relative ${
                isOrdered ? 'pl-0' : 'flex items-start gap-3'
              }`}
            >
              {!isOrdered && (
                <span className="w-1.5 h-1.5 bg-gray-400 dark:bg-gray-500 rounded-full block mt-2.5 flex-shrink-0"></span>
              )}
              <div
                className={`${isOrdered ? '' : 'flex-1'} ${
                  level > 0 && !isOrdered ? 'pl-1' : ''
                }`}
              >
                <span
                  className="text-gray-700 dark:text-gray-300 leading-loose"
                  dangerouslySetInnerHTML={{
                    __html: processedContent,
                  }}
                />
                {hasChildren && (
                  <div
                    className={`mt-2 ${isOrdered ? 'ml-6' : 'ml-4'} relative`}
                  >
                    {item.children![0].type === 'ordered' ? (
                      <ol className="space-y-2 list-decimal list-inside">
                        {item.children!.map((child, childIndex) => (
                          <li
                            key={childIndex}
                            className="text-gray-700 dark:text-gray-300 leading-loose"
                          >
                            <span
                              dangerouslySetInnerHTML={{
                                __html: processInlineFormats(child.content),
                              }}
                            />
                            {child.children && child.children.length > 0 && (
                              <div className="mt-2 ml-4">
                                {child.children[0].type === 'ordered' ? (
                                  <ol className="space-y-2 list-decimal list-inside">
                                    {renderListItems(child.children, level + 2)}
                                  </ol>
                                ) : (
                                  <ul className="space-y-2">
                                    {renderListItems(child.children, level + 2)}
                                  </ul>
                                )}
                              </div>
                            )}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <ul className="space-y-2">
                        {renderListItems(item.children!, level + 1)}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </li>
          )
        })
      },
      [processInlineFormats]
    )

    // 优化的 Prism 高亮 - 只高亮当前组件的代码块
    useEffect(() => {
      if (isClient && containerRef.current) {
        const codeBlocks = containerRef.current.querySelectorAll(
          'pre code[class*="language-"]'
        )
        codeBlocks.forEach(block => {
          Prism.highlightElement(block as HTMLElement)
        })
      }
    }, [isClient, sections])

    // 服务端渲染显示骨架屏
    if (!isClient) {
      return (
        <div className={`markdown-renderer ${className}`}>
          <div className="animate-pulse">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-4"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full mb-4"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6 mb-4"></div>
          </div>
        </div>
      )
    }

    return (
      <div
        ref={containerRef}
        className={`markdown-renderer space-y-8 ${className}`}
        suppressHydrationWarning
      >
        {sections.map((section, index) => {
          switch (section.type) {
            case 'title':
              return (
                <div key={index} className="relative">
                  <h1
                    className="text-3xl font-bold text-gray-700 dark:text-gray-300 mb-8 pb-4 border-b border-gray-200 dark:border-gray-700 leading-tight"
                    dangerouslySetInnerHTML={{
                      __html: processInlineFormats(section.content),
                    }}
                  />
                </div>
              )

            case 'subtitle':
              const HeadingTag =
                section.level === 2
                  ? 'h2'
                  : section.level === 3
                  ? 'h3'
                  : section.level === 4
                  ? 'h4'
                  : section.level === 5
                  ? 'h5'
                  : 'h6'
              const headingSize =
                section.level === 2
                  ? 'text-2xl'
                  : section.level === 3
                  ? 'text-xl'
                  : section.level === 4
                  ? 'text-lg'
                  : section.level === 5
                  ? 'text-base'
                  : 'text-sm'

              return (
                <HeadingTag
                  key={index}
                  className={`${headingSize} font-semibold text-gray-700 dark:text-gray-300 mt-10 mb-6 leading-relaxed`}
                  dangerouslySetInnerHTML={{
                    __html: processInlineFormats(section.content),
                  }}
                />
              )

            case 'quote':
              return (
                <div key={index} className="relative my-6">
                  <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-6 py-2 bg-gray-50 dark:bg-gray-800/50 rounded-r-lg">
                    <div className="text-gray-600 dark:text-gray-400 italic leading-relaxed">
                      <MarkdownRenderer
                        content={section.content}
                        className="space-y-4"
                      />
                    </div>
                  </blockquote>
                </div>
              )

            case 'code':
              const languageKey = (() => {
                const lang = section.language?.toLowerCase() || 'text'
                if (lang === 'dockerfile') return 'docker'
                if (lang === 'cpp' || lang === 'c++') return 'java'
                return lang
              })()
              const originalContent = section.content.replace(/\n$/, '')
              const codeLines = originalContent.split('\n')

              return (
                <div key={index} className="my-6 group">
                  <div className="openai-code-container relative">
                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                      <CopyButton text={originalContent} />
                    </div>

                    <div
                      className="overflow-x-auto overflow-y-hidden"
                      style={{
                        scrollbarWidth: 'thin',
                        scrollbarColor: 'rgba(156, 163, 175, 0.5) transparent',
                      }}
                    >
                      <div className="py-4 px-6 min-w-0">
                        <pre className="openai-code-content text-sm leading-6 font-mono min-w-max">
                          {codeLines.map((line, index) => (
                            <div
                              key={index}
                              className="code-line h-6 leading-6"
                              style={{
                                whiteSpace: 'pre',
                                tabSize: 4,
                                minWidth: 'max-content',
                              }}
                            >
                              <code
                                className={`language-${languageKey}`}
                                style={{ whiteSpace: 'pre', tabSize: 4 }}
                                dangerouslySetInnerHTML={{
                                  __html:
                                    line.trim().length === 0
                                      ? '\u00A0'
                                      : Prism.highlight(
                                          line,
                                          Prism.languages[languageKey] ||
                                            Prism.languages.text,
                                          languageKey
                                        ),
                                }}
                              />
                            </div>
                          ))}
                        </pre>
                      </div>
                    </div>
                  </div>

                  <style jsx>{`
                    .openai-code-container .overflow-x-auto::-webkit-scrollbar {
                      height: 8px;
                    }
                    .openai-code-container
                      .overflow-x-auto::-webkit-scrollbar-track {
                      background: rgba(243, 244, 246, 0.5);
                      border-radius: 4px;
                    }
                    .openai-code-container
                      .overflow-x-auto::-webkit-scrollbar-thumb {
                      background: rgba(156, 163, 175, 0.5);
                      border-radius: 4px;
                    }
                    .openai-code-container
                      .overflow-x-auto::-webkit-scrollbar-thumb:hover {
                      background: rgba(156, 163, 175, 0.7);
                    }
                    .dark
                      .openai-code-container
                      .overflow-x-auto::-webkit-scrollbar-track {
                      background: rgba(55, 65, 81, 0.5);
                    }
                    .dark
                      .openai-code-container
                      .overflow-x-auto::-webkit-scrollbar-thumb {
                      background: rgba(107, 114, 128, 0.5);
                    }
                    .dark
                      .openai-code-container
                      .overflow-x-auto::-webkit-scrollbar-thumb:hover {
                      background: rgba(107, 114, 128, 0.7);
                    }
                  `}</style>
                </div>
              )

            case 'list':
              if (!section.listItems || section.listItems.length === 0) {
                return null
              }

              const rootListType = section.listItems[0].type

              return (
                <div key={index} className="my-6">
                  {rootListType === 'ordered' ? (
                    <ol className="space-y-3 list-decimal list-inside">
                      {section.listItems.map((item, itemIndex) => (
                        <li
                          key={itemIndex}
                          className="text-gray-700 dark:text-gray-300 leading-loose"
                        >
                          <span
                            className="text-gray-700 dark:text-gray-300 leading-loose"
                            dangerouslySetInnerHTML={{
                              __html: processInlineFormats(item.content),
                            }}
                          />
                          {item.children && item.children.length > 0 && (
                            <div className="mt-2 ml-4">
                              {item.children[0].type === 'ordered' ? (
                                <ol className="space-y-2 list-decimal list-inside">
                                  {item.children.map((child, childIndex) => (
                                    <li
                                      key={childIndex}
                                      className="text-gray-700 dark:text-gray-300 leading-loose"
                                    >
                                      <span
                                        dangerouslySetInnerHTML={{
                                          __html: processInlineFormats(
                                            child.content
                                          ),
                                        }}
                                      />
                                    </li>
                                  ))}
                                </ol>
                              ) : (
                                <ul className="space-y-2">
                                  {renderListItems(item.children, 1)}
                                </ul>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <ul className="space-y-3">
                      {renderListItems(section.listItems)}
                    </ul>
                  )}
                </div>
              )

            case 'table':
              const tableLines = section.content
                .split('\n')
                .filter(line => line.trim())
              const headers = tableLines[0]
                ?.split('|')
                .map(h => h.trim())
                .filter(h => h)
              const rows = tableLines.slice(2).map(line =>
                line
                  .split('|')
                  .map(cell => cell.trim())
                  .filter(cell => cell)
              )

              return (
                <div key={index} className="my-6">
                  <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                      {headers && (
                        <thead className="bg-gray-50 dark:bg-gray-800">
                          <tr>
                            {headers.map((header, headerIndex) => (
                              <th
                                key={headerIndex}
                                className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                                dangerouslySetInnerHTML={{
                                  __html: processInlineFormats(header),
                                }}
                              />
                            ))}
                          </tr>
                        </thead>
                      )}
                      <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                        {rows.map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {row.map((cell, cellIndex) => (
                              <td
                                key={cellIndex}
                                className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300"
                                dangerouslySetInnerHTML={{
                                  __html: processInlineFormats(cell),
                                }}
                              />
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )

            case 'divider':
              return (
                <div key={index} className="my-8">
                  <div className="w-full">
                    <div
                      className="h-px dark:bg-gray-600"
                      style={{ backgroundColor: 'rgb(243, 243, 243)' }}
                    ></div>
                  </div>
                </div>
              )

            case 'text':
              const processedText = processInlineFormats(section.content)

              return (
                <p
                  key={index}
                  className="text-gray-700 dark:text-gray-300 leading-loose text-base"
                  dangerouslySetInnerHTML={{ __html: processedText }}
                />
              )

            default:
              return null
          }
        })}
      </div>
    )
  }
)

MarkdownRenderer.displayName = 'MarkdownRenderer'

export default MarkdownRenderer
