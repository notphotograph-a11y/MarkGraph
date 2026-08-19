import type { ReactNode } from 'react'

export interface PanelDef {
  id: string
  title: string
  render: () => ReactNode
}

const panels: PanelDef[] = []

/** 注册右栏面板（F8.2 面板插槽：反链/大纲已注册，Phase 2「相关笔记」等直接插入） */
export function registerPanel(def: PanelDef): void {
  if (!panels.some(p => p.id === def.id)) panels.push(def)
}

export function getPanels(): PanelDef[] {
  return panels
}
