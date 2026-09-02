<script setup lang="ts">
import { Picture } from '@element-plus/icons-vue'
import { computed, nextTick, ref, watch } from 'vue'
import { usePictureInPicture } from '@/composables/usePictureInPicture'
import { getSubtitleFontOption } from '@/config/subtitle-fonts'
import type { PipAsset } from '@/types/picture-in-picture'

interface SubtitleRowSummary {
  id: string
  text: string
  timeRange: string
}

interface SubtitleStyleSnapshot {
  fontId: string
  fontSize: number
  color: string
  strokeSize: number
  strokeColor: string
}

const props = defineProps<{
  videoSrc: string
  subtitleRows: SubtitleRowSummary[]
  subtitleStyle: SubtitleStyleSnapshot
  initialActiveSubtitleId?: string
}>()

const {
  addUploadedAsset,
  applyAssetNaturalSize,
  assetsBySubtitleId,
  closePipModal,
  deleteHistoryEntry,
  editingAssets,
  editingSubtitleIds,
  historyEntries,
  isPipModalOpen,
  refreshHistory,
  removeAsset,
  reuseHistoryEntry,
  selectAsset,
  selectedAssetId,
  setSubtitleSelection,
  toggleSubtitleSelection
} = usePictureInPicture()

const editorCanvasRef = ref<HTMLDivElement | null>(null)

// 多选时画布字幕文案展示哪一段：默认取第一个选中的字幕
const subtitleForCanvas = computed<SubtitleRowSummary | null>(() => {
  if (editingSubtitleIds.value.length === 0) {
    return null
  }
  const firstId = editingSubtitleIds.value[0]
  return props.subtitleRows.find((row) => row.id === firstId) ?? null
})

const subtitleFontFamily = computed(
  () => `'${getSubtitleFontOption(props.subtitleStyle.fontId).fontFamily}', sans-serif`
)

const subtitleBaseStyle = computed<Record<string, string>>(() => ({
  fontFamily: subtitleFontFamily.value,
  fontSize: `${props.subtitleStyle.fontSize}px`,
  whiteSpace: 'pre-line'
}))

const subtitleFillStyle = computed<Record<string, string>>(() => ({
  ...subtitleBaseStyle.value,
  color: props.subtitleStyle.color,
  WebkitTextFillColor: props.subtitleStyle.color,
  WebkitTextStrokeWidth: '0px'
}))

const subtitleStrokeStyle = computed<Record<string, string>>(() => ({
  ...subtitleBaseStyle.value,
  color: 'transparent',
  WebkitTextFillColor: 'transparent',
  WebkitTextStrokeColor: props.subtitleStyle.strokeColor,
  WebkitTextStrokeWidth: `${props.subtitleStyle.strokeSize}px`
}))

watch(
  () => isPipModalOpen.value,
  (open) => {
    if (!open) {
      return
    }
    if (editingSubtitleIds.value.length === 0) {
      const initialId = props.initialActiveSubtitleId || props.subtitleRows[0]?.id || ''
      if (initialId) {
        setSubtitleSelection([initialId])
      }
    }
    void nextTick()
    void refreshHistory()
  }
)

watch(
  () => props.subtitleRows.length,
  (length) => {
    if (length === 0) {
      setSubtitleSelection([])
    }
  }
)

const allSubtitleSelected = computed(() => {
  if (props.subtitleRows.length === 0) {
    return false
  }
  return editingSubtitleIds.value.length === props.subtitleRows.length
})

function isSubtitleSelected(id: string): boolean {
  return editingSubtitleIds.value.includes(id)
}

function getSubtitleAssetCount(subtitleId: string): number {
  return assetsBySubtitleId.value.get(subtitleId)?.length ?? 0
}

function handleSelectAllSubtitles(): void {
  if (allSubtitleSelected.value) {
    setSubtitleSelection([])
  } else {
    setSubtitleSelection(props.subtitleRows.map((row) => row.id))
  }
}

function handleSubtitleClick(row: SubtitleRowSummary, event: MouseEvent): void {
  // 默认行为：单击即“仅选中该字幕段”，便于聚焦编辑
  // 配合 Ctrl/Cmd 可追加多选；checkbox 单独处理勾选逻辑
  if (event.ctrlKey || event.metaKey || event.shiftKey) {
    toggleSubtitleSelection(row.id)
    return
  }
  setSubtitleSelection([row.id])
}

function handleSubtitleCheckboxChange(row: SubtitleRowSummary, event: Event): void {
  event.stopPropagation()
  toggleSubtitleSelection(row.id)
}

function handleUpload(event: Event, kindHint: 'image' | 'video'): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''

  if (!file) {
    return
  }

  if (kindHint === 'image' && !file.type.startsWith('image/')) {
    return
  }
  if (kindHint === 'video' && !file.type.startsWith('video/')) {
    return
  }

  addUploadedAsset(file)
}

interface DragContext {
  mode: 'move' | 'resize'
  asset: PipAsset
  startX: number
  startY: number
  initialRegion: PipAsset['region']
  canvasWidth: number
  canvasHeight: number
}

let dragContext: DragContext | null = null

function getCanvasSize(): { width: number; height: number } {
  const rect = editorCanvasRef.value?.getBoundingClientRect()
  return {
    width: rect?.width ?? 0,
    height: rect?.height ?? 0
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function startDrag(event: MouseEvent, asset: PipAsset, mode: 'move' | 'resize'): void {
  event.preventDefault()
  event.stopPropagation()
  selectAsset(asset.id)

  const size = getCanvasSize()
  if (size.width === 0 || size.height === 0) {
    return
  }

  dragContext = {
    mode,
    asset,
    startX: event.clientX,
    startY: event.clientY,
    initialRegion: { ...asset.region },
    canvasWidth: size.width,
    canvasHeight: size.height
  }

  window.addEventListener('mousemove', handleDrag)
  window.addEventListener('mouseup', endDrag)
}

function handleDrag(event: MouseEvent): void {
  if (!dragContext) {
    return
  }

  const { mode, asset, startX, startY, initialRegion, canvasWidth, canvasHeight } = dragContext
  const deltaXPercent = ((event.clientX - startX) / canvasWidth) * 100
  const deltaYPercent = ((event.clientY - startY) / canvasHeight) * 100

  if (mode === 'move') {
    const nextX = clamp(initialRegion.x + deltaXPercent, 0, 100 - initialRegion.width)
    const nextY = clamp(initialRegion.y + deltaYPercent, 0, 100 - initialRegion.height)
    asset.region = { ...initialRegion, x: nextX, y: nextY }
    return
  }

  // resize：保持素材原始比例做等比缩放
  // 画框像素比例：(initialWidth*canvasW) / (initialHeight*canvasH)
  // 取水平/垂直拖动距离里影响更大的那一个为基准，宽高按这个比例同步变化
  const initialPxWidth = (initialRegion.width / 100) * canvasWidth
  const initialPxHeight = (initialRegion.height / 100) * canvasHeight
  if (initialPxWidth <= 0 || initialPxHeight <= 0) {
    return
  }

  const aspectRatio = initialPxWidth / initialPxHeight
  const deltaXPx = (deltaXPercent / 100) * canvasWidth
  const deltaYPx = (deltaYPercent / 100) * canvasHeight

  // 选拖动的"主导方向"：把另一个方向同步换算成保持比例后的值
  const widthCandidate = initialPxWidth + deltaXPx
  const heightCandidate = initialPxHeight + deltaYPx
  const widthFromHeight = heightCandidate * aspectRatio
  const heightFromWidth = widthCandidate / aspectRatio

  let nextPxWidth: number
  let nextPxHeight: number
  if (Math.abs(deltaXPx) >= Math.abs(deltaYPx)) {
    nextPxWidth = widthCandidate
    nextPxHeight = heightFromWidth
  } else {
    nextPxWidth = widthFromHeight
    nextPxHeight = heightCandidate
  }

  // 最小尺寸：8% 画布短边对应像素，避免缩到看不见
  const minPxWidth = (8 / 100) * canvasWidth
  const minPxHeight = (8 / 100) * canvasHeight
  if (nextPxWidth < minPxWidth) {
    nextPxWidth = minPxWidth
    nextPxHeight = nextPxWidth / aspectRatio
  }
  if (nextPxHeight < minPxHeight) {
    nextPxHeight = minPxHeight
    nextPxWidth = nextPxHeight * aspectRatio
  }

  // 不能超过画布右下边界
  const maxPxWidth = canvasWidth - (initialRegion.x / 100) * canvasWidth
  const maxPxHeight = canvasHeight - (initialRegion.y / 100) * canvasHeight
  if (nextPxWidth > maxPxWidth) {
    nextPxWidth = maxPxWidth
    nextPxHeight = nextPxWidth / aspectRatio
  }
  if (nextPxHeight > maxPxHeight) {
    nextPxHeight = maxPxHeight
    nextPxWidth = nextPxHeight * aspectRatio
  }

  asset.region = {
    ...initialRegion,
    width: (nextPxWidth / canvasWidth) * 100,
    height: (nextPxHeight / canvasHeight) * 100
  }
}

function endDrag(): void {
  dragContext = null
  window.removeEventListener('mousemove', handleDrag)
  window.removeEventListener('mouseup', endDrag)
}

function handleRemove(asset: PipAsset, event: MouseEvent): void {
  event.stopPropagation()
  removeAsset(asset.id)
}

function formatHistoryTime(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function reuseHistory(entry: { id: string; kind: 'image' | 'video' }): void {
  const target = historyEntries.value.find((item) => item.id === entry.id)
  if (target) {
    reuseHistoryEntry(target)
  }
}

async function deleteHistory(id: string, event: MouseEvent): Promise<void> {
  event.stopPropagation()
  await deleteHistoryEntry(id)
}

/** 图片加载完成后回填原始尺寸，让画框宽高比保持与图片一致 */
function handleAssetImageLoaded(asset: PipAsset, event: Event): void {
  const img = event.target as HTMLImageElement
  const size = getCanvasSize()
  applyAssetNaturalSize(asset.id, img.naturalWidth, img.naturalHeight, size.width, size.height)
}

/** 视频元数据加载完成后回填原始尺寸 */
function handleAssetVideoLoaded(asset: PipAsset, event: Event): void {
  const video = event.target as HTMLVideoElement
  const size = getCanvasSize()
  applyAssetNaturalSize(asset.id, video.videoWidth, video.videoHeight, size.width, size.height)
}
</script>

<template>
  <teleport to="body">
    <div v-if="isPipModalOpen" class="modal-backdrop">
      <section class="pip-modal" role="dialog" aria-modal="true" aria-labelledby="pip-modal-title">
        <header class="modal-header">
          <div>
            <h2 id="pip-modal-title">画中画配置</h2>
            <p class="pip-modal-subtitle">勾选字幕段后，上传的画中画会同时绑定到所选字幕</p>
          </div>
          <button class="icon-button" type="button" aria-label="关闭画中画" @click="closePipModal">×</button>
        </header>

        <div class="pip-modal-body">
          <!-- 左栏：字幕列表（支持多选共享） -->
          <section class="pip-subtitle-list" aria-label="字幕列表">
            <div class="pip-subtitle-list-head">
              <h3>字幕列表</h3>
              <button
                v-if="subtitleRows.length"
                type="button"
                class="pip-subtitle-toggle-all"
                @click="handleSelectAllSubtitles"
              >
                {{ allSubtitleSelected ? '取消全选' : '全选' }}
              </button>
            </div>
            <p class="pip-subtitle-tip">
              <span>勾选多段可让它们共享同一份画中画素材</span>
            </p>
            <div v-if="subtitleRows.length" class="pip-subtitle-list-scroll">
              <article
                v-for="row in subtitleRows"
                :key="row.id"
                class="pip-subtitle-row"
                :class="{ 'is-active': isSubtitleSelected(row.id) }"
                @click="handleSubtitleClick(row, $event)"
              >
                <input
                  type="checkbox"
                  class="pip-subtitle-checkbox"
                  :checked="isSubtitleSelected(row.id)"
                  :aria-label="`选择字幕：${row.text}`"
                  @click.stop
                  @change="handleSubtitleCheckboxChange(row, $event)"
                />
                <div class="pip-subtitle-row-main">
                  <span class="pip-subtitle-time">{{ row.timeRange }}</span>
                  <span class="pip-subtitle-text">{{ row.text }}</span>
                </div>
                <span
                  v-if="getSubtitleAssetCount(row.id) > 0"
                  class="pip-subtitle-asset-badge"
                  :title="`已配置 ${getSubtitleAssetCount(row.id)} 个画中画素材`"
                >
                  {{ getSubtitleAssetCount(row.id) }}
                </span>
              </article>
            </div>
            <div v-else class="pip-empty">暂无字幕，请先在第四步完成识别</div>
          </section>

          <!-- 中间：编辑画布 + 上传工具栏 -->
          <section class="pip-editor" aria-label="画中画编辑">
            <div class="pip-toolbar">
              <label class="pip-tool-button" :class="{ 'is-disabled': editingSubtitleIds.length === 0 }">
                <input type="file" accept="image/*" @change="handleUpload($event, 'image')" />
                <Picture />
                <span>上传图片</span>
              </label>
              <span class="pip-toolbar-tip">
                当前已选 {{ editingSubtitleIds.length }} 段字幕
              </span>
            </div>

            <div class="pip-editor-stage">
              <div ref="editorCanvasRef" class="pip-editor-canvas">
                <video
                  v-if="videoSrc"
                  class="pip-editor-base-video"
                  :src="videoSrc"
                  muted
                  playsinline
                ></video>

                <div
                  v-for="asset in editingAssets"
                  :key="asset.id"
                  class="pip-asset-frame"
                  :class="{ 'is-selected': asset.id === selectedAssetId }"
                  :style="{
                    left: `${asset.region.x}%`,
                    top: `${asset.region.y}%`,
                    width: `${asset.region.width}%`,
                    height: `${asset.region.height}%`
                  }"
                  @mousedown="startDrag($event, asset, 'move')"
                >
                  <img
                    v-if="asset.kind === 'image'"
                    :src="asset.url"
                    alt="画中画图片"
                    draggable="false"
                    @load="handleAssetImageLoaded(asset, $event)"
                  />
                  <video
                    v-else
                    class="pip-asset-video"
                    :src="asset.url"
                    muted
                    playsinline
                    @loadedmetadata="handleAssetVideoLoaded(asset, $event)"
                  ></video>

                  <button
                    type="button"
                    class="pip-asset-remove"
                    aria-label="移除画中画素材"
                    @click="handleRemove(asset, $event)"
                  >
                    ×
                  </button>

                  <span
                    class="pip-asset-resize-handle"
                    aria-label="调整画中画素材大小"
                    @mousedown="startDrag($event, asset, 'resize')"
                  ></span>
                </div>

                <div v-if="subtitleForCanvas" class="pip-editor-subtitle">
                  <div class="pip-editor-subtitle-stroke" :style="subtitleStrokeStyle">
                    {{ subtitleForCanvas.text }}
                  </div>
                  <div class="pip-editor-subtitle-fill" :style="subtitleFillStyle">
                    {{ subtitleForCanvas.text }}
                  </div>
                </div>
              </div>

              <div v-if="editingSubtitleIds.length === 0" class="pip-editor-empty">
                请先在左侧勾选字幕段
              </div>
            </div>
          </section>

          <!-- 右栏：历史素材（本地上传过的素材可复用） -->
          <section class="pip-ai-side" aria-label="历史素材">
            <div class="pip-history">
              <div class="pip-history-head">
                <span class="pip-history-title">历史素材</span>
                <span class="pip-history-tip">点击复用，悬停可删除</span>
              </div>
              <div v-if="historyEntries.length" class="pip-history-list">
                <article
                  v-for="entry in historyEntries"
                  :key="entry.id"
                  class="pip-history-item"
                  :title="entry.prompt || entry.fileName"
                  @click="reuseHistory(entry)"
                >
                  <img
                    v-if="entry.kind === 'image'"
                    class="pip-history-thumb"
                    :src="entry.url"
                    :alt="entry.fileName"
                  />
                  <video
                    v-else
                    class="pip-history-thumb"
                    :src="entry.url"
                    muted
                    preload="metadata"
                  ></video>

                  <span class="pip-history-meta">
                    <span class="pip-history-meta-kind">
                      {{ entry.kind === 'image' ? '图片' : '视频' }}
                    </span>
                    <span class="pip-history-meta-time">{{ formatHistoryTime(entry.createdAt) }}</span>
                  </span>

                  <button
                    type="button"
                    class="pip-history-remove"
                    aria-label="删除该历史素材"
                    @click="deleteHistory(entry.id, $event)"
                  >
                    ×
                  </button>
                </article>
              </div>
              <div v-else class="pip-history-empty">暂无历史素材</div>
            </div>
          </section>
        </div>
      </section>
    </div>
  </teleport>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.4);
}

.pip-modal {
  width: min(96vw, 1140px);
  height: min(94vh, 720px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #cbd5e1;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 32px 90px rgba(15, 23, 42, 0.32);
}

.modal-header {
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 18px;
  border-bottom: 1px solid #e1e7ef;
}

.modal-header h2 {
  margin: 0;
  color: #172033;
  font-size: 17px;
  line-height: 1.2;
}

.pip-modal-subtitle {
  margin: 4px 0 0;
  color: #718096;
  font-size: 12px;
  line-height: 1.5;
}

.icon-button {
  width: 32px;
  height: 32px;
  display: inline-grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #64748b;
  background: transparent;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.icon-button:hover {
  border-color: #d4dce8;
  color: #172033;
  background: #f6f8fb;
}

.pip-modal-body {
  flex: 1;
  min-height: 0;
  display: grid;
  /* 左：字幕列表  中：编辑预览  右：AI + 历史素材（一行 4 个素材，包含 ~16px 滚动条余量） */
  grid-template-columns: minmax(320px, 360px) minmax(0, 1fr) 396px;
  grid-template-rows: minmax(0, 1fr);
  gap: 0;
}

/* 左栏：字幕列表 */
.pip-subtitle-list {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  border-right: 1px solid #e1e7ef;
  background: #f8fafc;
}

.pip-subtitle-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pip-subtitle-list-head h3 {
  margin: 0;
  color: #172033;
  font-size: 13px;
}

.pip-subtitle-toggle-all {
  height: 24px;
  padding: 0 10px;
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  color: #475569;
  background: #ffffff;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.pip-subtitle-toggle-all:hover {
  border-color: #2a6f97;
  color: #2a6f97;
}

.pip-subtitle-tip {
  margin: 0;
  color: #718096;
  font-size: 11px;
  line-height: 1.4;
}

.pip-subtitle-list-scroll {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 6px;
  overflow: auto;
}

.pip-subtitle-row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid #d8e0ea;
  border-radius: 6px;
  background: #ffffff;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease;
}

.pip-subtitle-row.is-active {
  border-color: #2a6f97;
  background: #eef7fb;
}

.pip-subtitle-checkbox {
  width: 16px;
  height: 16px;
  accent-color: #2a6f97;
  cursor: pointer;
}

.pip-subtitle-row-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.pip-subtitle-time {
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
}

.pip-subtitle-text {
  color: #172033;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.pip-subtitle-asset-badge {
  flex: 0 0 auto;
  min-width: 22px;
  height: 22px;
  display: inline-grid;
  place-items: center;
  padding: 0 6px;
  border-radius: 999px;
  color: #ffffff;
  background: #2a6f97;
  font-size: 11px;
  font-weight: 700;
}

.pip-empty {
  padding: 18px 12px;
  color: #94a3b8;
  font-size: 12px;
  text-align: center;
}

/* 中间：编辑画布 */
.pip-editor {
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  overflow: hidden;
}

/* 右栏：AI 工作台（生图 / 生视频 + 历史素材） */
.pip-ai-side {
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  /* 右内边距收紧，把空间留给历史素材的滚动条 */
  padding: 14px 6px 14px 14px;
  border-left: 1px solid #e1e7ef;
  background: #f8fafc;
  overflow: hidden;
}

.pip-ai-form {
  flex: 0 0 auto;
  display: grid;
  gap: 12px;
}

.pip-history {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pip-history-list {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  /* 固定每列 80px，超出宽度自动换行；保留行间距 */
  grid-template-columns: repeat(auto-fill, 80px);
  align-content: start;
  gap: 8px;
  overflow-y: auto;
  /* 仅在右侧预留滚动条占位，确保 4 列布局稳定，不会因为是否出现滚动条而抖动 */
  scrollbar-gutter: stable;
  padding-bottom: 2px;
}

.pip-ai-generate-fill {
  flex: 1 1 auto;
}

.pip-ai-section {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid #dbe4ee;
  border-radius: 8px;
  background: #ffffff;
}

.pip-ai-section.is-flat {
  padding: 0;
  border: 0;
  background: transparent;
}

.pip-ai-field {
  display: grid;
  gap: 4px;
}

.pip-ai-field-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.pip-ai-field-hint {
  color: #94a3b8;
  font-size: 11px;
  font-weight: 400;
  margin-left: 6px;
}

.pip-ai-field-icon {
  width: 24px;
  height: 24px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 4px;
  color: #64748b;
  background: transparent;
  cursor: pointer;
}

.pip-ai-field-icon:hover {
  color: #2a6f97;
  background: #eef7fb;
}

.pip-ai-field-icon svg {
  width: 14px;
  height: 14px;
}

.pip-ai-textarea {
  height: auto;
  /* 默认 5 行，行高 1.5、字号 12px、上下 padding 8px → 约 12*1.5*5 + 16 ≈ 106 */
  min-height: 106px;
  padding: 8px 10px;
  resize: vertical;
  font-family: inherit;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.pip-ai-action-row {
  align-items: stretch;
}

.pip-ai-action-row .pip-ai-generate {
  flex: 1 1 auto;
  height: 36px;
  min-height: 36px;
  box-sizing: border-box;
}

.pip-ai-action-row .pip-ai-section-config {
  height: 36px;
  min-height: 36px;
  box-sizing: border-box;
}

.pip-ai-divider {
  flex: 0 0 auto;
  height: 1px;
  background: #e1e7ef;
  margin: 0;
}

.pip-ai-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pip-ai-section-title {
  color: #172033;
  font-size: 13px;
  font-weight: 700;
}

.pip-ai-section-config {
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 8px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  color: #64748b;
  background: #ffffff;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}

.pip-ai-section-config:hover {
  border-color: #2a6f97;
  color: #2a6f97;
  background: #f2f7fb;
}

.pip-ai-section-config svg {
  width: 14px;
  height: 14px;
  color: #9aa4b2;
  flex: 0 0 auto;
}

.pip-ai-generate {
  margin-left: auto;
}

.pip-ai-generate-full {
  width: 100%;
  margin-left: 0;
}

.pip-toolbar {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.pip-toolbar-tip {
  margin-left: auto;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.pip-tool-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px dashed #9bb1c8;
  border-radius: 6px;
  color: #4b5d73;
  background: #f8fbfd;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.pip-tool-button.is-disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.pip-tool-button input[type='file'] {
  display: none;
}

.pip-tool-button svg {
  width: 14px;
  height: 14px;
}

.pip-editor-stage {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: grid;
  place-items: center;
  border: 1px solid #d8e0ea;
  border-radius: 8px;
  background: #0f172a;
  position: relative;
  overflow: hidden;
}

.pip-editor-canvas {
  position: relative;
  height: 100%;
  max-height: 100%;
  aspect-ratio: 9 / 16;
  max-width: 100%;
  overflow: hidden;
  background: #000;
}

.pip-editor-base-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}

.pip-editor-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #cbd5e1;
  font-size: 12px;
  pointer-events: none;
}

.pip-asset-frame {
  position: absolute;
  border: 1px dashed rgba(255, 255, 255, 0.6);
  cursor: move;
  user-select: none;
  background: rgba(15, 23, 42, 0.1);
}

.pip-asset-frame.is-selected {
  border-color: #38bdf8;
  border-style: solid;
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.3);
}

.pip-asset-frame img,
.pip-asset-frame video {
  width: 100%;
  height: 100%;
  display: block;
  /* 永远保持原始比例，不裁切；画框尺寸已经按比例同步，留黑边只是兜底 */
  object-fit: contain;
  pointer-events: none;
  background: transparent;
}

.pip-asset-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 4px;
  color: #ffffff;
  background: rgba(15, 23, 42, 0.6);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.pip-asset-resize-handle {
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 12px;
  height: 12px;
  border: 1px solid #ffffff;
  border-radius: 2px;
  background: #38bdf8;
  cursor: nwse-resize;
}

.pip-editor-subtitle {
  position: absolute;
  left: 6px;
  right: 6px;
  bottom: 12%;
  text-align: center;
  pointer-events: none;
}

.pip-editor-subtitle-stroke {
  position: relative;
  z-index: 1;
}

.pip-editor-subtitle-fill {
  position: absolute;
  inset: 0;
  z-index: 2;
}

.pip-history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pip-history-title {
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.pip-history-tip {
  color: #94a3b8;
  font-size: 11px;
}

.pip-history-item {
  position: relative;
  width: 80px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px;
  border: 1px solid #d8e0ea;
  border-radius: 6px;
  background: #ffffff;
  cursor: pointer;
  transition: border-color 0.18s ease, transform 0.18s ease;
  box-sizing: border-box;
}

.pip-history-item:hover {
  border-color: #2a6f97;
  transform: translateY(-1px);
}

.pip-history-thumb {
  width: 72px;
  height: 72px;
  display: block;
  object-fit: cover;
  border-radius: 4px;
  background: #0f172a;
}

.pip-history-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  color: #64748b;
  font-size: 10px;
  line-height: 1.2;
}

.pip-history-meta-kind {
  font-weight: 700;
  color: #2a6f97;
}

.pip-history-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 4px;
  color: #ffffff;
  background: rgba(15, 23, 42, 0.6);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.18s ease;
}

.pip-history-item:hover .pip-history-remove {
  opacity: 1;
}

.pip-history-empty {
  color: #94a3b8;
  font-size: 12px;
}

.pip-ai-form {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.pip-ai-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pip-ai-row .pip-ai-input {
  flex: 1 1 auto;
  min-width: 0;
}

.pip-ai-size {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
  align-items: stretch;
}

.pip-ai-size-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #ffffff;
  color: #475569;
  font-size: 12px;
}

.pip-ai-size-cell > span:first-child {
  color: #94a3b8;
  font-weight: 700;
}

.pip-ai-size-input {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: #172033;
  font-size: 12px;
  outline: none;
  /* 隐藏 number input 默认上下箭头 */
  -moz-appearance: textfield;
}

.pip-ai-size-input::-webkit-outer-spin-button,
.pip-ai-size-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.pip-ai-size-unit {
  color: #94a3b8;
  font-size: 11px;
}

.pip-ai-input {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #ffffff;
  color: #172033;
  font-size: 12px;
  outline: none;
  text-overflow: ellipsis;
}

.pip-ai-input:focus {
  border-color: #2a6f97;
  box-shadow: 0 0 0 3px rgba(42, 111, 151, 0.12);
}

.pip-ai-view-button {
  width: 32px;
  height: 32px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  color: #475569;
  background: #ffffff;
  cursor: pointer;
}

.pip-ai-view-button:hover {
  border-color: #2a6f97;
  color: #2a6f97;
  background: #f2f7fb;
}

.pip-ai-view-button svg {
  width: 14px;
  height: 14px;
}

.pip-ai-row .primary-button {
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 14px;
  font-size: 12px;
  box-sizing: border-box;
}

.pip-btn-icon {
  font-size: 13px;
}

.pip-model-config-modal {
  width: min(94vw, 560px);
  max-height: calc(100vh - 40px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.28);
}

.pip-model-config-modal .config-modal-body {
  display: grid;
  gap: 16px;
  padding: 18px;
  overflow: auto;
}

.pip-model-config-modal .provider-select-field {
  display: grid;
  gap: 6px;
}

.pip-model-config-modal .provider-select-field > span {
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.pip-model-config-modal .provider-select-field select {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  color: #172033;
  background: #ffffff;
  font-size: 13px;
  outline: none;
}

.pip-model-config-modal .provider-select-field select:focus {
  border-color: #2a6f97;
  box-shadow: 0 0 0 3px rgba(42, 111, 151, 0.12);
}

.pip-model-config-modal .config-field {
  display: grid;
  gap: 6px;
}

.pip-model-config-modal .config-field > span {
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.pip-model-config-modal .config-field input,
.pip-model-config-modal .config-field select {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  color: #172033;
  background: #ffffff;
  font-size: 13px;
  outline: none;
}

.pip-model-config-modal .config-field input:focus,
.pip-model-config-modal .config-field select:focus {
  border-color: #2a6f97;
  box-shadow: 0 0 0 3px rgba(42, 111, 151, 0.12);
}

.pip-model-config-modal .config-tip {
  margin: 0;
  color: #718096;
  font-size: 12px;
  line-height: 1.5;
}

.pip-model-config-modal .config-tip a {
  color: #2a6f97;
}

.model-config-list {
  display: grid;
  gap: 12px;
  padding: 16px;
  overflow: auto;
  /* 整个内容区使用统一的浅色背景，避免与无边框 card 区出现两种颜色 */
  background: #fbfcfe;
}

.model-card {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid #d8e0ea;
  border-radius: 8px;
  background: #fbfcfe;
}

.model-card-head strong {
  display: block;
  color: #172033;
  font-size: 14px;
  line-height: 1.2;
}

.model-card.is-borderless {
  padding: 0;
  border: 0;
  background: transparent;
}

.model-card-head p {
  margin: 5px 0 0;
  color: #718096;
  font-size: 12px;
  line-height: 1.4;
}

.model-card-head .config-tip {
  margin-top: 6px;
}

.model-card-head .config-tip a {
  color: #2a6f97;
  text-decoration: none;
}

.model-card-head .config-tip a:hover {
  text-decoration: underline;
}

.field {
  display: grid;
  gap: 6px;
}

.field span {
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.field input,
.field select {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  color: #172033;
  background: #ffffff;
  font-size: 12px;
  outline: none;
}

.field input:focus,
.field select:focus {
  border-color: #2a6f97;
  box-shadow: 0 0 0 3px rgba(42, 111, 151, 0.12);
}

.pip-size-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: 6px;
  align-items: center;
}

.pip-size-multiply {
  color: #94a3b8;
  font-size: 12px;
  font-weight: 700;
}

.modal-actions {
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 10px 16px;
  border-top: 1px solid #e1e7ef;
  background: #fbfcfe;
}

.primary-button,
.secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  padding: 0 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.primary-button {
  border: 1px solid #2a6f97;
  color: #ffffff;
  background: #2a6f97;
}

.primary-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.secondary-button {
  border: 1px solid #cbd5e1;
  color: #475569;
  background: #ffffff;
}

.pip-prompt-modal {
  width: min(94vw, 760px);
  height: min(88vh, 600px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.28);
}

.pip-prompt-modal-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
}

.pip-prompt-edit {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pip-prompt-edit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pip-prompt-edit-label {
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.pip-prompt-reset {
  height: 26px;
  padding: 0 10px;
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  color: #475569;
  background: #ffffff;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.pip-prompt-reset:hover {
  border-color: #2a6f97;
  color: #2a6f97;
  background: #f2f7fb;
}

.pip-prompt-modal-textarea {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  padding: 12px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #f8fafc;
  color: #172033;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  outline: none;
  resize: none;
}

.pip-prompt-modal-textarea:focus {
  border-color: #2a6f97;
  box-shadow: 0 0 0 3px rgba(42, 111, 151, 0.12);
  background: #ffffff;
}
</style>
