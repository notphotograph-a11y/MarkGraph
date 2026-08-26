/**
 * 附件读写（F19）：二进制旁路，不走 readNote/writeNote 的 utf8 契约。
 * 只接受光栅图；笔记里写相对路径 attachments/…，HTTP 经 /api/file 取回。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  ATTACHMENTS_DIR,
  isImageRel,
  rejectHiddenSegments,
  safeJoin,
} from './fs-vault.js'

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

const MAGIC: { ext: string; test: (b: Buffer) => boolean }[] = [
  { ext: '.png', test: b => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: '.jpg', test: b => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.jpeg', test: b => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.gif', test: b => b.length >= 6 && b.subarray(0, 6).toString('ascii').startsWith('GIF8') },
  { ext: '.webp', test: b => b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
]

export function imageMime(rel: string): string {
  return MIME[path.posix.extname(rel).toLowerCase()] ?? 'application/octet-stream'
}

function extFromName(name: string): string {
  const ext = path.posix.extname(name).toLowerCase()
  return isImageRel(`x${ext}`) ? ext : ''
}

function sniffExt(buf: Buffer, claimed: string): string {
  const hit = MAGIC.find(m => m.test(buf))
  if (hit) {
    // jpg/jpeg 同源，尊重用户声明
    if ((hit.ext === '.jpg' || hit.ext === '.jpeg') && (claimed === '.jpg' || claimed === '.jpeg')) return claimed
    return hit.ext
  }
  throw Object.assign(new Error('无法识别的图片格式'), { statusCode: 400 })
}

function sanitizeBase(name: string): string {
  const base = path.posix.basename(name).replace(/\.[^.]+$/, '')
  const cleaned = base
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return cleaned || 'image'
}

export async function readAttachment(rel: string): Promise<{ body: Buffer; mime: string }> {
  rejectHiddenSegments(rel)
  if (!isImageRel(rel)) throw Object.assign(new Error('仅支持图片'), { statusCode: 400 })
  const full = safeJoin(rel)
  try {
    const body = await fs.readFile(full)
    return { body, mime: imageMime(rel) }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw Object.assign(new Error('文件不存在'), { statusCode: 404 })
    }
    throw err
  }
}

export async function writeAttachment(originalName: string, body: Buffer): Promise<{ path: string }> {
  if (body.length === 0) throw Object.assign(new Error('空文件'), { statusCode: 400 })
  if (body.length > MAX_IMAGE_BYTES) {
    throw Object.assign(new Error('图片不能超过 8MB'), { statusCode: 400 })
  }
  const claimed = extFromName(originalName)
  const ext = sniffExt(body, claimed)
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15)
  const rel = `${ATTACHMENTS_DIR}/${stamp}-${sanitizeBase(originalName)}${ext}`
  const full = safeJoin(rel)
  await fs.mkdir(path.dirname(full), { recursive: true })
  // wx：同毫秒重名时换后缀，避免覆盖
  try {
    const handle = await fs.open(full, 'wx')
    await handle.writeFile(body)
    await handle.close()
    return { path: rel }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    const alt = `${ATTACHMENTS_DIR}/${stamp}-${sanitizeBase(originalName)}-${Math.random().toString(36).slice(2, 6)}${ext}`
    await fs.writeFile(safeJoin(alt), body)
    return { path: alt }
  }
}
