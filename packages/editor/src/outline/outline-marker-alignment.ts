function firstTextLineCenter(block: HTMLElement, content: HTMLElement): number | null {
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()

  while (node) {
    const text = node.textContent ?? ''
    const characterIndex = text.search(/\S/u)
    const parent = node.parentElement
    if (characterIndex >= 0
      && parent?.closest('[data-block-id]') === block
      && !parent.closest('.prosemirror-math-inline, .prosemirror-math-block')) {
      const range = document.createRange()
      range.setStart(node, characterIndex)
      range.setEnd(node, characterIndex + 1)
      const rect = Array.from(range.getClientRects()).find(candidate => candidate.width > 0 && candidate.height > 0)
      range.detach()
      if (rect)
        return rect.top + rect.height / 2
    }
    node = walker.nextNode()
  }

  return null
}

function firstMathDisplayCenter(block: HTMLElement, content: HTMLElement): number | null {
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_ELEMENT)
  let node = walker.nextNode()

  while (node) {
    if (node instanceof HTMLElement
      && node.closest('[data-block-id]') === block
      && node.matches('.prosemirror-math-inline, .prosemirror-math-block')) {
      const display = node.querySelector<HTMLElement>(':scope > .prosemirror-math-display')
      if (display) {
        const rect = display.getBoundingClientRect()
        const style = getComputedStyle(display)
        if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden')
          return rect.top + rect.height / 2
      }
    }
    node = walker.nextNode()
  }

  return null
}

function firstVisibleBoxTop(block: HTMLElement, content: HTMLElement): number | null {
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_ELEMENT)
  let node = walker.nextNode()
  let firstVisibleTop: number | null = null

  while (node) {
    if (node instanceof HTMLElement && node.closest('[data-block-id]') === block) {
      const rect = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
        firstVisibleTop ??= rect.top
        if (node.matches('p, h1, h2, h3, h4, h5, h6, pre')) {
          const lineHeight = Number.parseFloat(style.lineHeight)
          const paddingTop = Number.parseFloat(style.paddingTop)
          if (Number.isFinite(lineHeight) && Number.isFinite(paddingTop))
            return rect.top + paddingTop + lineHeight / 2
        }
      }
    }
    node = walker.nextNode()
  }

  return firstVisibleTop
}

function markerOffset(block: HTMLElement): number | null {
  const marker = block.querySelector<HTMLElement>(':scope > .list-marker')
  const content = block.querySelector<HTMLElement>(':scope > .list-content')
  if (!marker || !content)
    return null

  const markerRect = marker.getBoundingClientRect()
  const blockRect = block.getBoundingClientRect()
  if (markerRect.height === 0 || blockRect.height === 0)
    return null

  const anchor = firstTextLineCenter(block, content)
    ?? firstMathDisplayCenter(block, content)
    ?? firstVisibleBoxTop(block, content)
  if (anchor === null)
    return null

  return Math.round((anchor - blockRect.top - markerRect.height / 2) * 100) / 100
}

function alignmentRules(root: HTMLElement): string {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-block-id]'))
    .map((block) => {
      const blockId = block.dataset.blockId
      const offset = markerOffset(block)
      if (!blockId || offset === null)
        return null
      const selector = `[data-editor-mode='outline'] [data-editor-content].ProseMirror [data-block-id="${blockId}"]`
      return `${selector} > .list-marker,${selector}[data-list-kind='ordered']::before{top:${offset}px !important}`
    })
    .filter(rule => rule !== null)
    .join('\n')
}

export function observeOutlineMarkerAlignment(root: HTMLElement, styleElement: HTMLStyleElement): () => void {
  let animationFrame: number | null = null
  let disposed = false
  const observedBlocks = new Set<HTMLElement>()

  const resizeObserver = new ResizeObserver(() => scheduleAlignment())

  const refreshResizeTargets = () => {
    const currentBlocks = new Set(root.querySelectorAll<HTMLElement>('[data-block-id]'))
    observedBlocks.forEach((block) => {
      if (!currentBlocks.has(block)) {
        resizeObserver.unobserve(block)
        observedBlocks.delete(block)
      }
    })
    currentBlocks.forEach((block) => {
      if (!observedBlocks.has(block)) {
        observedBlocks.add(block)
        resizeObserver.observe(block)
      }
    })
  }

  function scheduleAlignment(): void {
    if (disposed || animationFrame !== null)
      return
    animationFrame = requestAnimationFrame(() => {
      animationFrame = null
      refreshResizeTargets()
      const rules = alignmentRules(root)
      if (styleElement.textContent !== rules)
        styleElement.textContent = rules
    })
  }

  const mutationObserver = new MutationObserver(scheduleAlignment)
  mutationObserver.observe(root, { childList: true, characterData: true, subtree: true })
  window.addEventListener('resize', scheduleAlignment)
  void document.fonts?.ready.then(scheduleAlignment, () => undefined)
  scheduleAlignment()

  return () => {
    disposed = true
    if (animationFrame !== null)
      cancelAnimationFrame(animationFrame)
    mutationObserver.disconnect()
    resizeObserver.disconnect()
    window.removeEventListener('resize', scheduleAlignment)
  }
}
