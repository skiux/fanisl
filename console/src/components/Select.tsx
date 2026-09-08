import { Select as Primitive } from 'radix-ui'
import { CaretDown, CaretUp, CaretUpDown, Check } from '@phosphor-icons/react'
import { cn } from '../lib/cn'

/**
 * 从一串里选一个，选项多到排不进一行时用这个。
 *
 * 少数几项、且要一眼看全的，用 `SegmentedControl`（分段下划线）；这里是另一件事：
 * 委托页的交易对可能有几十个，摊不开。
 *
 * **不用原生 `<select>`。** 原生控件的弹出层由操作系统画，字体、行高、配色全在
 * 这套纸面语言之外，选项里也塞不进第二层信息——委托页那个框原先就是一串
 * 裸的 `BTCUSDT`，看不出哪些有挂单、哪些是别的计价币。
 *
 * 键盘漫游、首字母跳转（打 `SOL` 直接跳到 SOLUSDT）、焦点与 `aria-*` 都交给
 * Radix，这里只管长相——理由同 `controls.tsx`：自己写这些不是设计取舍，
 * 只是把无障碍写错的机会多来一次。
 */
export type SelectOption = {
  value: string
  /** 主标签，也是选中后印在按钮上的字 */
  label: string
  /** 跟在主标签后面的灰字：计价币、账户之类 */
  suffix?: string
  /** 行尾的小字：挂单条数之类。不进按钮，只在列表里出现 */
  badge?: string
}

/** `label` 省略时不画分组标题——只有一组的时候那行标题是纯粹的噪声 */
export type SelectGroup = { label?: string; options: SelectOption[] }

export function Select({ value, onValueChange, groups, label, placeholder, disabled }: {
  value: string
  onValueChange: (next: string) => void
  groups: SelectGroup[]
  /** 无障碍名字。屏幕上的标签由调用方自己排版 */
  label: string
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <Primitive.Root disabled={disabled} onValueChange={onValueChange} value={value || undefined}>
      <Primitive.Trigger
        aria-label={label}
        className={cn(
          'group flex w-full min-w-0 items-center justify-between gap-2',
          'rounded-[var(--radius-control)] border border-rule px-2 py-1.5',
          'text-sm text-ink outline-none transition-colors duration-200',
          'hover:border-rule-strong data-[state=open]:border-accent',
          'focus-visible:border-accent focus-visible:outline focus-visible:outline-1',
          'focus-visible:outline-offset-2 focus-visible:outline-accent',
          'disabled:pointer-events-none disabled:opacity-40',
        )}
      >
        <span className="tnum min-w-0 truncate">
          <Primitive.Value placeholder={placeholder ?? '—'} />
        </span>
        <Primitive.Icon asChild>
          <CaretUpDown
            aria-hidden="true"
            className="shrink-0 text-ink-3 transition-colors duration-200 group-hover:text-ink-2"
            size={12}
          />
        </Primitive.Icon>
      </Primitive.Trigger>

      <Primitive.Portal>
        <Primitive.Content
          className={cn(
            'z-50 overflow-hidden rounded-[3px] border border-rule bg-sheet',
            'shadow-[var(--sheet-shadow)]',
            // 至少和按钮一样宽，最多铺到可用高度——列表长的时候自己滚
            'min-w-[var(--radix-select-trigger-width)]',
            'max-h-[min(20rem,var(--radix-select-content-available-height))]',
          )}
          position="popper"
          sideOffset={6}
        >
          <Scroll up />
          <Primitive.Viewport className="p-1">
            {groups.map((group, index) => (
              <Primitive.Group key={group.label ?? index}>
                {group.label && (
                  <Primitive.Label className="label px-2 pb-1 pt-2">{group.label}</Primitive.Label>
                )}
                {group.options.map((option) => (
                  <Primitive.Item
                    className={cn(
                      'flex cursor-pointer select-none items-center justify-between gap-3',
                      'rounded-[3px] px-2 py-1.5 text-sm text-ink-2 outline-none',
                      'data-[highlighted]:bg-sheet-2 data-[highlighted]:text-ink',
                      'data-[state=checked]:text-ink',
                    )}
                    key={option.value}
                    value={option.value}
                  >
                    <span className="tnum min-w-0 truncate">
                      <Primitive.ItemText>
                        {option.label}
                        {option.suffix && <span className="text-ink-3">{option.suffix}</span>}
                      </Primitive.ItemText>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {option.badge && <span className="tnum text-xs text-ink-3">{option.badge}</span>}
                      {/* 勾只在选中那行出现，但位置一直留着，
                          否则行尾的小字会左右跳 */}
                      <span className="grid size-3 place-items-center">
                        <Primitive.ItemIndicator>
                          <Check aria-hidden="true" size={11} weight="bold" />
                        </Primitive.ItemIndicator>
                      </span>
                    </span>
                  </Primitive.Item>
                ))}
              </Primitive.Group>
            ))}
          </Primitive.Viewport>
          <Scroll />
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}

function Scroll({ up }: { up?: boolean }) {
  const Button = up ? Primitive.ScrollUpButton : Primitive.ScrollDownButton
  const Icon = up ? CaretUp : CaretDown
  return (
    <Button className="flex h-5 items-center justify-center bg-sheet text-ink-3">
      <Icon aria-hidden="true" size={10} weight="bold" />
    </Button>
  )
}
