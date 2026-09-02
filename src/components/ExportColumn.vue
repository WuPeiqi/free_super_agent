<script setup lang="ts">
import { ElDivider, ElMessage } from 'element-plus'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useSubtitleRecognition } from '@/composables/useSubtitleRecognition'
import { usePictureInPicture } from '@/composables/usePictureInPicture'
import { SUBTITLE_FONT_OPTIONS, getSubtitleFontOption } from '@/config/subtitle-fonts'

const {
  effectiveVideoSourceUrl,
  subtitleList
} = useSubtitleRecognition()

const { assets: pipAssets } = usePictureInPicture()

const subtitleStyleStorageKey = 'free-super-agent.subtitle-style'

function readSubtitleStyle() {
  try {
    const stored = window.localStorage.getItem(subtitleStyleStorageKey)
    if (!stored) return null
    return JSON.parse(stored) as Partial<{
      fontId: string; fontSize: number; fontColor: string
      strokeSize: number; strokeColor: string
    }>
  } catch { return null }
}


const hasVideo = computed(() => Boolean(effectiveVideoSourceUrl.value))
// 导出只依赖视频：字幕 / 画中画 / 封面都是可选项
const canRender = computed(() => hasVideo.value)

// ── 第六步：渲染导出视频 ──────────────────────────────────
const isRendering = ref(false)
const renderProgress = ref(0)
const renderOutputPath = ref('')
const renderSuccess = ref(false)
let unsubscribeProgress: (() => void) | null = null

onMounted(() => {
  if (!document.querySelector('style[data-cover-fonts="true"]')) {
    const styleEl = document.createElement('style')
    styleEl.dataset.coverFonts = 'true'
    styleEl.textContent = SUBTITLE_FONT_OPTIONS.map((f) =>
      `@font-face { font-family: '${f.fontFamily}'; src: url('${f.url}'); font-display: swap; }`
    ).join('\n')
    document.head.appendChild(styleEl)
  }

  // 进入本步骤时若已有视频（上游步骤先完成），立即生成时间轴缩略图与封面帧
  if (hasVideo.value) {
    void buildFilmstrip()
    scheduleCapture()
  }
})

onUnmounted(() => {
  unsubscribeProgress?.()
  unsubscribeProgress = null
  if (captureTimer) {
    clearTimeout(captureTimer)
    captureTimer = null
  }
  releaseFilmstrip()
})

function handleShowInFolder(): void {
  if (renderOutputPath.value) void window.desktopApi.showVideoInFolder(renderOutputPath.value)
}

async function handleExportAll(): Promise<void> {
  // 只要有视频就能导出：字幕、字幕样式、画中画、封面都是可选的，
  // 未完成的部分直接跳过（例如只做了对口型 → 导出无字幕视频）
  if (!hasVideo.value) {
    ElMessage.warning('请先完成第四步视频对口型')
    return
  }

  isRendering.value = true
  renderProgress.value = 0
  renderSuccess.value = false
  renderOutputPath.value = ''

  unsubscribeProgress?.()
  unsubscribeProgress = window.desktopApi.onVideoRenderProgress((progress: number) => {
    renderProgress.value = progress
  })

  try {
    const style = readSubtitleStyle()
    const fontOption = getSubtitleFontOption(style?.fontId ?? '')

    let videoUrl = effectiveVideoSourceUrl.value
    if (videoUrl.startsWith('local-video://local-file/')) {
      videoUrl = decodeURIComponent(videoUrl.replace('local-video://local-file/', ''))
    }

    // 过滤掉被清空的字幕段；未做字幕识别时为空数组
    const subtitles = subtitleList.value
      .filter((item) => item.text.trim())
      .map((item) => ({ start: item.start, end: item.end, text: item.text }))

    const pipItems = pipAssets.value.map((asset) => {
      const matched = subtitleList.value.filter((sub) => asset.subtitleIds.includes(sub.id))
      return {
        url: asset.url, kind: asset.kind, region: asset.region,
        startTime: matched.length ? Math.min(...matched.map((s) => s.start)) : 0,
        endTime:   matched.length ? Math.max(...matched.map((s) => s.end)) : 0
      }
    })

    // 只有配置了字幕或画中画，才需要额外渲染一个成品视频；
    // 否则只导出对口型原视频（原视频始终导出）
    const needsRender = subtitles.length > 0 || pipItems.length > 0

    const videoPayload: Record<string, unknown> | null = needsRender
      ? {
          videoUrl,
          subtitles,
          subtitleStyle: {
            fontFileName: fontOption.fileName,
            fontSize: style?.fontSize ?? 10,
            color: style?.fontColor ?? '#ffffff',
            strokeSize: style?.strokeSize ?? 0,
            strokeColor: style?.strokeColor ?? '#000000'
          },
          pipItems,
          outputPath: ''
        }
      : null

    const ts = Date.now()

    // 封面：仅在填写了封面标题时才生成并导出（未填写视为不需要封面）
    let composedCoverDataUrl: string | null = null
    if (coverTitle.value.trim() && (await ensureCoverFrame())) {
      composedCoverDataUrl = await buildCoverDataUrl()
    }

    const result = await window.desktopApi.exportAll(
      JSON.parse(JSON.stringify({
        // 对口型原视频始终导出
        sourceVideoUrl: videoUrl,
        videoPayload: videoPayload ?? undefined,
        coverBase64: composedCoverDataUrl ?? undefined,
        coverFileName: composedCoverDataUrl ? `封面_${ts}.jpg` : undefined
      }))
    ) as { success: boolean; canceled?: boolean; outputDir?: string; error?: string }

    if (result.canceled) {
      return
    }
    if (result.success && result.outputDir) {
      renderSuccess.value = true
      renderOutputPath.value = result.outputDir
      // 未走渲染时不会有进度回调，这里补满进度条
      renderProgress.value = 100
      ElMessage.success('导出完成')
    } else {
      ElMessage.error(result.error || '导出失败')
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导出失败')
  } finally {
    isRendering.value = false
    unsubscribeProgress?.()
    unsubscribeProgress = null
  }
}

// ── 第六步：标题封面 ──────────────────────────────────────
type CoverStyleId = 'bottom-gradient' | 'center-emphasis' | 'top-banner'

const coverFontFamily = computed(() => {
  const opt = SUBTITLE_FONT_OPTIONS.find((f) => f.id === coverFontId.value)
  return opt ? `'${opt.fontFamily}', sans-serif` : 'sans-serif'
})

const coverStyles = [
  { id: 'bottom-gradient' as CoverStyleId, label: '黄底标题',  description: '黄色色带，白字黑描边居中' },
  { id: 'center-emphasis' as CoverStyleId, label: '居中强调',  description: '半透明遮罩，大字居中' },
  { id: 'top-banner'      as CoverStyleId, label: '蓝调渐变', description: '蓝色渐变条，左侧橙色竖线' }
]

const selectedStyleId = ref<CoverStyleId>('bottom-gradient')
const coverTitle = ref('')
const coverFontId = ref('msyhbd')   // 默认微软雅黑粗体
const coverFontSize = ref(10)       // 预览字号（px），导出时等比放大
const coverFrameDataUrl = ref('')
const frameTimePercent = ref(10)
const isCapturing = ref(false)
const coverPreviewRef = ref<HTMLElement | null>(null)

// 视频总时长（秒），由生成缩略图时的 ffmpeg 结果提供
const coverVideoDuration = ref(0)

// ── 时间轴（缩略图条 + 播放头）─────────────────────────────
// 缩略图数量越多，时间轴越细，拖动时的即时预览也越接近真实帧
const FILMSTRIP_COUNT = 24
const filmstripThumbs = ref<string[]>([])
const isBuildingFilmstrip = ref(false)
const timelineRef = ref<HTMLElement | null>(null)
let isDraggingPlayhead = false

/** 生成时间轴缩略图（一次 ffmpeg 调用，视频地址变化时才重新生成） */
async function buildFilmstrip(): Promise<void> {
  filmstripThumbs.value = []
  if (!hasVideo.value) return

  isBuildingFilmstrip.value = true
  try {
    const result = (await window.desktopApi.captureVideoFilmstrip(
      effectiveVideoSourceUrl.value,
      FILMSTRIP_COUNT,
    )) as { frames: ArrayBuffer[]; mimeType: string; duration: number }

    if (!result?.frames?.length) return

    filmstripThumbs.value = result.frames.map((frame) => {
      const blob = new Blob([frame], { type: result.mimeType })
      return URL.createObjectURL(blob)
    })

    // 时长由 ffmpeg 提供，用于时间轴上的时间读数
    if (Number.isFinite(result.duration)) {
      coverVideoDuration.value = result.duration
    }
  } catch {
    // 生成失败时时间轴退化为纯色条，不影响选帧
  } finally {
    isBuildingFilmstrip.value = false
  }
}

/** 由指针位置换算百分比 */
function percentFromClientX(clientX: number): number {
  const el = timelineRef.value
  if (!el) return frameTimePercent.value
  const rect = el.getBoundingClientRect()
  if (!rect.width) return frameTimePercent.value
  const offsetX = Math.min(Math.max(clientX - rect.left, 0), rect.width)
  return (offsetX / rect.width) * 100
}

/** 当前位置最接近的缩略图，用作拖动过程中的即时预览 */
const nearestThumbUrl = computed(() => {
  const thumbs = filmstripThumbs.value
  if (!thumbs.length) return ''
  const index = Math.round((frameTimePercent.value / 100) * (thumbs.length - 1))
  return thumbs[Math.min(Math.max(index, 0), thumbs.length - 1)]
})

/**
 * 预览卡片实际显示的帧：
 * 有 ffmpeg 高清帧就用它；拖动过程中高清帧被清空，退回最近的缩略图，
 * 保证「拖到哪儿、上面的封面就立刻变成哪一帧」。
 */
const coverDisplayFrameUrl = computed(
  () => coverFrameDataUrl.value || nearestThumbUrl.value,
)

function applyPercent(percent: number): void {
  frameTimePercent.value = Math.round(percent * 10) / 10
}

function onTimelinePointerDown(event: PointerEvent): void {
  if (!hasVideo.value) return
  isDraggingPlayhead = true
  timelineRef.value?.setPointerCapture(event.pointerId)
  // 作废旧的高清帧：拖动期间先用缩略图顶上，松手后再截新的高清帧
  coverFrameDataUrl.value = ''
  applyPercent(percentFromClientX(event.clientX))
}

function onTimelinePointerMove(event: PointerEvent): void {
  if (!isDraggingPlayhead) return
  applyPercent(percentFromClientX(event.clientX))
}

function onTimelinePointerUp(event: PointerEvent): void {
  if (!isDraggingPlayhead) return
  isDraggingPlayhead = false
  timelineRef.value?.releasePointerCapture(event.pointerId)
  // 松手后再截一张导出用的高清帧
  scheduleCapture()
}

/** 键盘操作：左右微调、Home/End 跳到首尾 */
function onTimelineKeydown(event: KeyboardEvent): void {
  if (!hasVideo.value) return

  const step = event.shiftKey ? 5 : 1
  let next = frameTimePercent.value

  if (event.key === 'ArrowLeft') next = Math.max(0, next - step)
  else if (event.key === 'ArrowRight') next = Math.min(100, next + step)
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = 100
  else return

  event.preventDefault()
  coverFrameDataUrl.value = ''
  applyPercent(next)
  scheduleCapture()
}

/** 总时长文案 */
const totalDurationLabel = computed(() => {
  const duration = coverVideoDuration.value
  if (!duration || !Number.isFinite(duration)) return '--:--'
  const mm = String(Math.floor(duration / 60)).padStart(2, '0')
  const ss = String(Math.floor(duration % 60)).padStart(2, '0')
  return `${mm}:${ss}`
})

/** 当前截取位置的时间文案（时长未知时退回百分比） */
const frameTimeLabel = computed(() => {
  const duration = coverVideoDuration.value
  if (!duration || !Number.isFinite(duration)) {
    return `${frameTimePercent.value}%`
  }
  const seconds = (duration * frameTimePercent.value) / 100
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(Math.floor(seconds % 60)).padStart(2, '0')
  return `${mm}:${ss}`
})

watch(effectiveVideoSourceUrl, () => {
  // 视频地址变化时清空封面帧与时长，重建时间轴缩略图，并自动截取当前位置的帧
  coverFrameDataUrl.value = ''
  coverVideoDuration.value = 0
  releaseFilmstrip()
  void buildFilmstrip()
  scheduleCapture()
})

/** 释放缩略图的 blob URL，避免内存泄漏 */
function releaseFilmstrip(): void {
  filmstripThumbs.value.forEach((url) => URL.revokeObjectURL(url))
  filmstripThumbs.value = []
}

let captureTimer: ReturnType<typeof setTimeout> | null = null

function scheduleCapture(): void {
  if (captureTimer) clearTimeout(captureTimer)
  captureTimer = setTimeout(() => { void captureFrame() }, 400)
}

async function captureFrame(): Promise<void> {
  if (!hasVideo.value) return

  isCapturing.value = true
  try {
    const result = (await window.desktopApi.captureVideoFrame(
      effectiveVideoSourceUrl.value,
      frameTimePercent.value
    )) as { arrayBuffer: ArrayBuffer; mimeType: string }

    const blob = new Blob([result.arrayBuffer], { type: result.mimeType })
    const reader = new FileReader()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    coverFrameDataUrl.value = dataUrl
  } catch {
    // 截取失败时静默，避免滑动过程中的中间态报错
  } finally {
    isCapturing.value = false
  }
}

/**
 * 确保已有导出用的封面帧：没有就按当前截取位置补截一张
 * （预览走 <video> seek，不再每次拖动都截帧，导出前统一兜底）
 */
async function ensureCoverFrame(): Promise<boolean> {
  if (coverFrameDataUrl.value) return true
  if (!hasVideo.value) return false
  await captureFrame()
  return Boolean(coverFrameDataUrl.value)
}

/**
 * 将一段文本按 Canvas 实际测量宽度进行自动换行，
 * 模拟 CSS 的 word-break: break-word 行为
 */
function wrapTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const result: string[] = []
  for (const rawLine of text.split('\n')) {
    if (rawLine.length === 0) { result.push(''); continue }
    let current = ''
    for (const char of rawLine) {
      const test = current + char
      if (ctx.measureText(test).width > maxWidth && current.length > 0) {
        result.push(current)
        current = char
      } else {
        current = test
      }
    }
    if (current) result.push(current)
  }
  return result.filter((l) => l.length > 0)
}

/**
 * 在 Canvas 上合成封面（背景帧 + 文字色带）并返回 JPEG dataUrl
 * 供单独导出和统一导出两处复用
 */
async function buildCoverDataUrl(): Promise<string | null> {
  if (!coverFrameDataUrl.value) {
    return null
  }

  const W = 1080, H = 1920
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  const img = new Image()
  img.src = coverFrameDataUrl.value
  await new Promise<void>((resolve) => { img.onload = () => resolve() })
  ctx.drawImage(img, 0, 0, W, H)

  const title = coverTitle.value || '封面标题'
  const style = selectedStyleId.value

  await document.fonts.ready

  const previewW = coverPreviewRef.value?.getBoundingClientRect().width || 160
  const previewH = previewW * (16 / 9)
  const scaleW = W / previewW
  const scaleH = H / previewH
  const exportFontSize = Math.round(coverFontSize.value * scaleW)
  const fontFamily = coverFontFamily.value

  function drawBand(gradColors: [string, string], accentColor: string): void {
    const padding = exportFontSize * 0.4
    const accentW = 4 * scaleW
    const gapW = exportFontSize * 0.5
    const fontSize = exportFontSize
    ctx.font = `bold ${fontSize}px ${fontFamily}`
    ctx.letterSpacing = `${exportFontSize * 0.08}px`

    // 文字可用最大宽度（与预览 CSS 的 flex:1 行为对齐）
    const textMaxWidth = W * 0.88 - accentW - gapW
    // 自动换行，模拟预览中 CSS word-break 的效果
    const lines = wrapTextLines(ctx, title, textMaxWidth)

    const lineH = fontSize * 1.5
    const textBlockH = lines.length * lineH
    const bandH = textBlockH + padding * 2
    const bandY = (H - bandH) / 2

    // 绘制渐变色带背景
    const grad = ctx.createLinearGradient(0, 0, W, 0)
    grad.addColorStop(0, gradColors[0])
    grad.addColorStop(1, gradColors[1])
    ctx.fillStyle = grad
    ctx.fillRect(0, bandY, W, bandH)

    // 绘制左侧强调竖线
    ctx.fillStyle = accentColor
    ctx.fillRect(0, bandY + padding, accentW, textBlockH)

    // 绘制文字（含阴影，与预览 CSS text-shadow 对齐）
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'
    lines.forEach((line, i) => {
      const x = accentW + gapW
      const y = bandY + padding + lineH * i + lineH / 2
      // 先画阴影层（模拟 text-shadow: 0 1px 4px rgba(0,0,0,0.4)）
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.4)'
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 1 * scaleW
      ctx.shadowBlur = 4 * scaleW
      ctx.fillText(line, x, y)
      ctx.restore()
    })
  }

  if (style === 'bottom-gradient') {
    drawBand(['rgba(180,130,10,0.92)', 'rgba(248,179,0,0.88)'], '#c0392b')
  } else if (style === 'center-emphasis') {
    drawBand(['rgba(26,26,46,0.94)', 'rgba(45,45,78,0.90)'], '#00b894')
  } else {
    drawBand(['rgba(26,58,92,0.92)', 'rgba(42,111,151,0.85)'], '#ff6b2b')
  }

  return canvas.toDataURL('image/jpeg', 0.95)
}
</script>

<template>
  <article class="feature-column">
    <div class="column-body export-tool">
      <el-divider class="step-divider">第六步：封面设计</el-divider>

      <!-- 封面预览（三种风格并排，点击选中） -->
      <div class="cover-style-previews">
        <button
          v-for="(style, idx) in coverStyles"
          :key="style.id"
          type="button"
          class="cover-style-preview-card"
          :class="{ 'is-active': selectedStyleId === style.id }"
          :title="style.label"
          @click="selectedStyleId = style.id"
        >
          <div
            :ref="idx === 0 ? (el) => { coverPreviewRef = el as HTMLElement | null } : undefined"
            class="cover-style-preview-inner"
            :style="coverDisplayFrameUrl ? { backgroundImage: `url(${coverDisplayFrameUrl})` } : {}"
          >
            <div v-if="!coverDisplayFrameUrl" class="cover-preview-empty"></div>

            <!-- 选中标识 -->
            <div v-if="selectedStyleId === style.id" class="cover-style-selected-badge">
              <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="8" cy="8" r="8" fill="#2a6f97"/>
                <path d="M4.5 8.5l2.5 2.5 4.5-5" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>

            <template v-if="style.id === 'bottom-gradient'">
              <div class="cover-style1-band">
                <span class="cover-style1-accent"></span>
                <span class="cover-style-text" :style="{ fontFamily: coverFontFamily, fontSize: `${coverFontSize}px` }">{{ coverTitle || '封面标题' }}</span>
              </div>
            </template>
            <template v-else-if="style.id === 'center-emphasis'">
              <div class="cover-style2-band">
                <span class="cover-style2-accent"></span>
                <span class="cover-style-text" :style="{ fontFamily: coverFontFamily, fontSize: `${coverFontSize}px` }">{{ coverTitle || '封面标题' }}</span>
              </div>
            </template>
            <template v-else>
              <div class="cover-style3-band">
                <span class="cover-style3-accent"></span>
                <span class="cover-style-text" :style="{ fontFamily: coverFontFamily, fontSize: `${coverFontSize}px` }">{{ coverTitle || '封面标题' }}</span>
              </div>
            </template>
          </div>
        </button>
      </div>

      <!-- 帧截取 -->
      <section class="cover-frame-section">
        <div class="cover-frame-controls">
          <span class="cover-field-label cover-timeline-label">
            截取位置
            <span v-if="isBuildingFilmstrip" class="cover-capturing-hint">生成缩略图...</span>
            <span v-else-if="isCapturing" class="cover-capturing-hint">截取中...</span>
            <span class="cover-timeline-time">{{ frameTimeLabel }} / {{ totalDurationLabel }}</span>
          </span>

          <!-- 时间轴：缩略图条 + 可拖动播放头 -->
          <div
            ref="timelineRef"
            class="cover-timeline"
            :class="{ 'is-disabled': !hasVideo }"
            role="slider"
            tabindex="0"
            aria-label="封面截取位置"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="frameTimePercent"
            :aria-valuetext="`${frameTimeLabel} / ${totalDurationLabel}`"
            @pointerdown="onTimelinePointerDown"
            @pointermove="onTimelinePointerMove"
            @pointerup="onTimelinePointerUp"
            @pointercancel="onTimelinePointerUp"
            @keydown="onTimelineKeydown"
          >
            <div class="cover-timeline-track">
              <img
                v-for="(thumb, i) in filmstripThumbs"
                :key="i"
                class="cover-timeline-thumb"
                :src="thumb"
                alt=""
                draggable="false"
              />
            </div>

            <!-- 播放头 -->
            <div
              v-if="hasVideo"
              class="cover-timeline-playhead"
              :style="{ left: `${frameTimePercent}%` }"
            >
              <span class="cover-timeline-playhead-grip"></span>
            </div>
          </div>
        </div>
      </section>

      <!-- 字体设置 -->
      <div class="cover-font-row">
        <label class="cover-font-field">
          <span class="cover-field-label">字体</span>
          <select v-model="coverFontId" class="cover-input">
            <option v-for="font in SUBTITLE_FONT_OPTIONS" :key="font.id" :value="font.id">
              {{ font.label }}
            </option>
          </select>
        </label>
        <label class="cover-font-field">
          <span class="cover-field-label">字号 <span class="cover-font-size-val">{{ coverFontSize }}px</span></span>
          <input v-model.number="coverFontSize" type="range" min="6" max="64" step="0.5" class="cover-range-input" />
        </label>
      </div>

      <!-- 封面标题 -->
      <label class="cover-field">
        <span class="cover-field-label">封面标题</span>
        <textarea v-model="coverTitle" class="cover-input cover-title-textarea" rows="2" placeholder="输入封面标题（支持换行）"></textarea>
      </label>

      <!-- 导出封面（已移至第七步统一导出） -->

      <el-divider class="step-divider">第七步：导出</el-divider>

      <section class="render-section">
        <button
          class="primary-button render-video-button"
          type="button"
          :disabled="!canRender || isRendering"
          :title="canRender ? '一键导出' : '请先完成第四步视频对口型'"
          @click="handleExportAll"
        >
          {{ isRendering ? '导出中...' : '一键导出' }}
        </button>

        <div class="render-progress-area">
          <template v-if="renderSuccess && !isRendering">
            <div class="render-success-row">
              <span class="render-success-text">✓ 导出完成</span>
              <button
                type="button"
                class="render-open-folder"
                @click="handleShowInFolder"
              >
                打开文件夹
              </button>
            </div>
          </template>
          <template v-else>
            <div class="render-progress-bar">
              <div class="render-progress-fill" :style="{ width: `${renderProgress}%` }"></div>
            </div>
            <div class="render-progress-info">
              <span class="render-progress-percent">{{ renderProgress }}%</span>
              <span class="render-progress-status">
                {{ !isRendering && renderProgress === 0 ? '等待导出' : renderProgress < 30 ? '下载视频中...' : renderProgress < 40 ? '准备渲染...' : renderProgress < 100 ? '编码中...' : '完成' }}
              </span>
            </div>
          </template>
        </div>

        <div v-if="renderSuccess && !isRendering" class="render-success-area" style="display:none"></div>
      </section>

      <!-- 内测说明与联系方式（原顶部横幅移至此处） -->
      <div class="beta-notice">
        <p class="beta-title">🧪 联系作者</p>
        <p class="beta-desc">欢迎反馈Bug与建议，帮助我们持续优化。</p>
        <p class="beta-contact">作者：武沛齐</p>
        <p class="beta-contact">微信：<span class="beta-wechat">wupeiqi5555</span></p>
        <p class="beta-contact">
          官方：<a
            class="beta-link"
            href="https://github.com/wupeiqi/free_super_agent"
            target="_blank"
            rel="noreferrer"
          >https://github.com/wupeiqi/free_super_agent</a>
        </p>
      </div>
    </div>

  </article>
</template>

<style scoped>
.feature-column {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #d8e0ea;
  border-radius: 6px;
  background: #ffffff;
}

.column-body {
  flex: 1;
  min-height: 0;
  padding: 12px;
  color: #5f6e80;
  font-size: 13px;
  line-height: 1.6;
}

.export-tool {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.step-divider {
  margin-top: 20px;
  margin-bottom: 15px;
  border-color: #b9c9dc;
}

.step-divider :deep(.el-divider__text) {
  padding: 5px 14px;
  border: 1px solid #c7d5e7;
  border-radius: 999px;
  color: #29435f;
  background: linear-gradient(180deg, #ffffff 0%, #eef5fb 100%);
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(42, 74, 108, 0.08);
}

.render-section {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid #dbe4ee;
  border-radius: 8px;
  background: #f8fafc;
}

.render-video-button {
  width: 100%;
  height: 38px;
  font-size: 14px;
  font-weight: 700;
  border-radius: 6px;
}

.render-video-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.render-progress-area {
  margin-top: 12px;
  display: grid;
  gap: 8px;
}

.render-progress-bar {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: #e2e8f0;
  overflow: hidden;
}

.render-progress-fill {
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, #2a6f97, #38bdf8);
  transition: width 0.6s ease;
}

.render-progress-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.render-progress-percent {
  color: #2a6f97;
  font-size: 13px;
  font-weight: 700;
}

.render-progress-status {
  color: #64748b;
  font-size: 12px;
}

.render-success-area {
  display: none;
}

/* 内测说明：高度跟随内容，不再撑满本列剩余空间 */
.beta-notice {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  /* gap 控制每行之间的间距 */
  gap: 7px;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 152, 0, 0.25);
  border-radius: 8px;
  background: rgba(255, 243, 224, 0.85);
  color: #5d4e37;
  font-size: 12px;
  line-height: 1.5;
}

.beta-title {
  margin: 0;
  color: #e65100;
  font-size: 12px;
  font-weight: 700;
}

.beta-desc {
  margin: 0;
  color: #6d5e48;
}

.beta-contact {
  margin: 0;
}

.beta-wechat {
  font-weight: 600;
  color: #2a6f97;
}

/* 官方仓库链接：点击后由主进程用系统浏览器打开
 * 沿用正文颜色，仅用下划线表示可点击，视觉重点留给微信号 */
.beta-link {
  color: inherit;
  font-weight: inherit;
  text-decoration: underline;
  word-break: break-all;
}

.render-success-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 38px;
}

.render-success-text {
  color: #16a34a;
  font-size: 13px;
  font-weight: 700;
}

.render-open-folder {
  height: 30px;
  padding: 0 14px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  color: #475569;
  background: #ffffff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.render-open-folder:hover {
  border-color: #2a6f97;
  color: #2a6f97;
  background: #f2f7fb;
}

.primary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 16px;
  border: 1px solid #2a6f97;
  border-radius: 6px;
  color: #ffffff;
  background: #2a6f97;
  font-weight: 700;
  cursor: pointer;
}

/* ── 第七步：标题封面 ── */
.cover-style-previews {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 96px));
  justify-content: center;
  gap: 8px;
}

.cover-style-preview-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  transition: border-color 0.18s ease;
}

.cover-style-preview-card:hover {
  border-color: #94a3b8;
}

.cover-style-preview-card.is-active {
  border-color: #2a6f97;
  box-shadow: 0 0 0 2px rgba(42, 111, 151, 0.18);
}

.cover-style-preview-inner {
  position: relative;
  width: 100%;
  aspect-ratio: 9 / 16;
  overflow: hidden;
  border-radius: 6px;
  background: #0f172a;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}

.cover-preview-empty {
  width: 100%;
  height: 100%;
  background: #1e293b;
}

.cover-style-preview-label {
  color: #334155;
  font-size: 11px;
  font-weight: 700;
  padding-bottom: 2px;
}

.cover-style-selected-badge {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 18px;
  height: 18px;
  z-index: 10;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
}

/* 三种预设共用基础结构 */
.cover-style1-band,
.cover-style2-band,
.cover-style3-band {
  position: absolute;
  left: 0; right: 0;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  /* padding 跟随字号缩放：字号小时色带也小，不再出现 padding 比文字还高的情况 */
  padding: 0.4em 0.8em 0.4em 0;
  z-index: 2;
}

/* 预设1：金橙渐变 */
.cover-style1-band {
  background: linear-gradient(90deg, rgba(180,130,10,0.92) 0%, rgba(248,179,0,0.88) 100%);
}
.cover-style1-accent {
  flex: 0 0 4px;
  align-self: stretch;
  margin-right: 10px;
  background: #c0392b;
  border-radius: 0 2px 2px 0;
}

/* 预设2：深灰渐变 */
.cover-style2-band {
  background: linear-gradient(90deg, rgba(26,26,46,0.94) 0%, rgba(45,45,78,0.90) 100%);
}
.cover-style2-accent {
  flex: 0 0 4px;
  align-self: stretch;
  margin-right: 10px;
  background: #00b894;
  border-radius: 0 2px 2px 0;
}

/* 预设3：蓝调渐变（原有） */
.cover-style3-band {
  background: linear-gradient(90deg, rgba(26,58,92,0.92) 0%, rgba(42,111,151,0.85) 100%);
}
.cover-style3-accent {
  flex: 0 0 4px;
  align-self: stretch;
  margin-right: 10px;
  background: #ff6b2b;
  border-radius: 0 2px 2px 0;
}

/* 三种预设共用文字样式 */
.cover-style-text {
  flex: 1;
  color: #ffffff;
  font-weight: 900;
  text-align: left;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
  letter-spacing: 0.08em;
  text-shadow: 0 1px 4px rgba(0,0,0,0.4);
}

.cover-frame-section {
  display: grid; gap: 8px;
}

.cover-frame-controls {
  display: grid; gap: 6px;
}

.cover-range-input { width: 100%; margin: 0; }

.cover-range-val {
  color: #64748b; font-size: 12px; font-weight: 700; text-align: right;
}

/* ── 截取位置时间轴 ── */
/* 标签行左对齐排列，时间读数用 margin-left:auto 顶到最右侧，
 * 避免 .cover-field-label 的 space-between 在出现提示文字时把时间挤到中间 */
.cover-timeline-label {
  justify-content: flex-start;
  gap: 6px;
}

.cover-timeline-time {
  margin-left: auto;
  color: #2a6f97;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.cover-timeline {
  position: relative;
  height: 54px;
  overflow: hidden;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #0f172a;
  cursor: pointer;
  touch-action: none;
  user-select: none;
}

.cover-timeline:focus-visible {
  outline: none;
  border-color: #2a6f97;
  box-shadow: 0 0 0 3px rgba(42, 111, 151, 0.22);
}

.cover-timeline.is-disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.cover-timeline-track {
  position: absolute;
  inset: 0;
  display: flex;
}

/* 缩略图等分铺满：整段视频内容一眼可见 */
.cover-timeline-thumb {
  flex: 1 1 0;
  min-width: 0;
  height: 100%;
  display: block;
  object-fit: cover;
  pointer-events: none;
}

.cover-timeline-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: #ffffff;
  box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.55);
  pointer-events: none;
}

.cover-timeline-playhead-grip {
  position: absolute;
  top: -1px;
  left: 50%;
  width: 10px;
  height: 10px;
  transform: translateX(-50%);
  border-radius: 2px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.5);
}

.cover-capture-button { height: 34px; font-size: 13px; }

.cover-capturing-hint {
  color: #2a6f97;
  font-size: 11px;
  font-weight: 400;
}

.cover-field { display: grid; gap: 6px; }

.cover-field-label {
  display: flex; align-items: center; justify-content: space-between;
  color: #334155; font-size: 12px; font-weight: 700;
}

.cover-auto-btn {
  height: 22px; padding: 0 10px;
  border: 1px solid #cbd5e1; border-radius: 999px;
  color: #475569; background: #ffffff;
  font-size: 11px; font-weight: 700; cursor: pointer;
}
.cover-auto-btn:hover { border-color: #2a6f97; color: #2a6f97; background: #f2f7fb; }

.cover-font-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
}

.cover-font-field {
  display: grid;
  gap: 5px;
}

.cover-font-size-val {
  color: #64748b;
  font-size: 11px;
  font-weight: 400;
}

.cover-input {
  width: 100%; height: 34px; padding: 0 10px;
  border: 1px solid #cbd5e1; border-radius: 6px;
  color: #172033; background: #ffffff; font-size: 12px; outline: none;
}
.cover-input:focus { border-color: #2a6f97; box-shadow: 0 0 0 3px rgba(42,111,151,0.12); }

.cover-title-textarea {
  height: auto;
  padding: 8px 10px;
  resize: none;
  font-family: inherit;
  line-height: 1.5;
  white-space: pre-wrap;
}

.cover-textarea {
  width: 100%; padding: 8px 10px;
  border: 1px solid #cbd5e1; border-radius: 6px;
  color: #172033; background: #ffffff;
  font-family: inherit; font-size: 12px; line-height: 1.5;
  outline: none; resize: none;
}
.cover-textarea:focus { border-color: #2a6f97; box-shadow: 0 0 0 3px rgba(42,111,151,0.12); }

.cover-export-button {
  width: 100%; height: 36px; font-size: 13px; font-weight: 700;
  border: 1px solid #2a6f97; border-radius: 6px;
  color: #ffffff; background: #2a6f97; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.cover-export-button:disabled { opacity: 0.5; cursor: not-allowed; }

.cover-hidden-video {
  position: absolute; width: 1px; height: 1px;
  opacity: 0; pointer-events: none; left: -9999px;
}

.secondary-button {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 6px; padding: 0 14px;
  border: 1px solid #cbd5e1; border-radius: 6px;
  color: #475569; background: #ffffff;
  font-size: 13px; font-weight: 700; cursor: pointer;
  transition: border-color 0.18s ease, color 0.18s ease;
}
.secondary-button:hover:not(:disabled) { border-color: #2a6f97; color: #2a6f97; background: #f2f7fb; }
.secondary-button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
