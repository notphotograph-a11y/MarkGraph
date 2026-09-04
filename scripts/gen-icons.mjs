/**
 * 应用图标生成（F24.2）：从 scripts/app-icon.svg 单一源产出全平台 PNG 到 public/。
 * 用法：node scripts/gen-icons.mjs（生成物入库，无构建期依赖）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const outDir = path.join(root, 'public')

const source = fs.readFileSync(path.join(__dirname, 'app-icon.svg'), 'utf8')
// iOS 不吃圆角（自己加遮罩）；maskable 需要满幅底 + 内容缩进安全圈（512×0.88）
const fullBleed = source.replace(/\brx="\d+"/, 'rx="0"')
const maskable = fullBleed.replace(
  '<g id="fg">',
  '<g id="fg" transform="translate(30.72 30.72) scale(0.88)">',
)

const jobs = [
  ['pwa-512.png', source, 512],
  ['pwa-192.png', source, 192],
  ['pwa-maskable-512.png', maskable, 512],
  ['apple-touch-icon.png', fullBleed, 180],
  ['favicon.png', source, 64],
]

fs.mkdirSync(outDir, { recursive: true })
for (const [file, svg, size] of jobs) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(outDir, file))
  console.log(`✓ public/${file} (${size}×${size})`)
}
