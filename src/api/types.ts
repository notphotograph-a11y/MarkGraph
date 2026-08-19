export interface VaultNode {
  type: 'dir' | 'file'
  name: string
  path: string
  children?: VaultNode[]
}

export interface NoteContent {
  content: string
  mtime: number
}

export type VaultEventKind = 'change' | 'add' | 'unlink'
export interface VaultEvent {
  kind: VaultEventKind
  path: string
}

export type ThemeId = 'apple' | 'paper' | 'obsidian' | 'x' | 'meta'
