/**
 * 轻量事件总线（F8.1，Phase 2/3 扩展底座）。
 * 约定事件：note:open / note:save / tree:change / link:navigate / outline:goto / ui:*
 */

export type BusHandler = (payload?: unknown) => void

class EventBus {
  private handlers = new Map<string, Set<BusHandler>>()

  on(event: string, handler: BusHandler): () => void {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(handler)
    return () => {
      set.delete(handler)
    }
  }

  emit(event: string, payload?: unknown): void {
    this.handlers.get(event)?.forEach(h => h(payload))
  }
}

export const bus = new EventBus()
