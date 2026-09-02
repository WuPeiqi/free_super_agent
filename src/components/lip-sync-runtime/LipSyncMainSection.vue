<script setup lang="ts">
/**
 * 视频对口型主 UI（独享算力）
 *
 * 提供音频/视频上传与任务提交入口，独立于 WaveSpeed 模块
 */
import { Setting, Stopwatch, Upload } from '@element-plus/icons-vue'
import { useLipSyncActive } from '@/composables/useLipSyncActive'
import { useLipSyncRuntime } from '@/composables/lip-sync-runtime/useLipSyncRuntime'
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  voiceAudioBlob?: Blob | null
  voiceAudioUrl?: string
}>()

const { openConfigModal } = useLipSyncActive()
const {
  taskStatus,
  elapsedText,
  isSubmitting,
  isPolling,
  clearSelectedAudioFile,
  uploadedAudioFileName,
  uploadedAudioPreviewUrl,
  videoPreviewUrl,
  videoStatus,
  uploadAudioFile,
  uploadVideoFile,
  submitTask,
  stopTask
} = useLipSyncRuntime()

const isVideoPreviewOpen = ref(false)

// 第三步生成新语音时，自动同步到第四步（仅在未运行对口型时）
watch(
  () => props.voiceAudioUrl,
  async (newUrl) => {
    if (newUrl && !isSubmitting.value && !isPolling.value) {
      // 主进程在硬盘上复制一份，不经过渲染进程内存
      try {
        const copiedUrl = await window.desktopApi.copyLocalAudio(newUrl) as string;
        uploadedAudioPreviewUrl.value = copiedUrl;
      } catch {
        // 复制失败则直接使用原地址
        uploadedAudioPreviewUrl.value = newUrl;
      }
      uploadedAudioFileName.value = "";
      clearSelectedAudioFile();
    }
  },
)

/** 将 API 返回的英文状态映射为中文 */
function formatTaskStatus(status: string): string {
  const statusMap: Record<string, string> = {
    waiting: '排队中',
    in_progress: '执行中',
    success: '成功',
    failure: '失败',
    cancelled: '取消',
    queued: '排队中',
    processing: '处理中',
    completed: '成功',
    failed: '失败',
  }
  return statusMap[status] ?? status
}

// 点击「视频对口型」：把第三步音频（Blob 优先）与本地视频交给 composable 处理
function handleSubmit(): void {
  void submitTask(props.voiceAudioUrl ?? '', props.voiceAudioBlob ?? null)
}

const videoUploadHint = computed(() => {
  if (videoStatus.value === '上传中...') return '文件正在上传，请稍候'
  if (videoStatus.value === '上传失败') return '上传失败，请重新选择视频文件'
  return videoPreviewUrl.value ? '视频已就绪，点击按钮弹出播放器预览' : '完成上传后才可以预览视频'
})

function openVideoPreview(): void {
  if (!videoPreviewUrl.value) return
  isVideoPreviewOpen.value = true
}

function closeVideoPreview(): void {
  isVideoPreviewOpen.value = false
}
</script>

<template>
  <div class="sc-section">
    <div class="tool-actions">
      <button class="primary-button" type="button" :disabled="isSubmitting || isPolling" @click="handleSubmit">
        {{ isSubmitting || isPolling ? '执行中...' : '视频对口型' }}
      </button>
      <button class="secondary-button" type="button" :disabled="!isPolling && !isSubmitting" @click="stopTask">
        停止重启
      </button>
      <button class="secondary-button model-config-button" type="button" title="模型配置" @click="openConfigModal">
        <Setting />
        模型配置
      </button>
    </div>

    <section class="media-upload-panel" aria-label="对口型素材上传">
      <article class="media-upload-item">
        <div class="media-upload-head">
          <strong>语音文件</strong>
        </div>
        <div class="media-upload-controls">
          <label class="media-upload-action">
            <input type="file" accept=".mp3,.wav,.m4a,.ogg,.flac,.aac,audio/*" @change="uploadAudioFile" />
            <Upload />
            <span>替换语音</span>
          </label>

          <div class="media-preview-control">
            <audio v-if="uploadedAudioPreviewUrl" class="audio-preview" :src="uploadedAudioPreviewUrl" controls></audio>
            <audio v-else-if="props.voiceAudioUrl" class="audio-preview" :src="props.voiceAudioUrl" controls></audio>
            <button v-else class="preview-disabled" type="button" disabled>完成第三步后可预览</button>
          </div>
        </div>
      </article>

      <article class="media-upload-item">
        <div class="media-upload-head">
          <strong>视频文件</strong>
        </div>
        <div class="media-upload-controls">
          <label class="media-upload-action">
            <input type="file" accept=".mp4,.mov,.mkv,video/*" @change="uploadVideoFile" />
            <Upload />
            <span>上传视频</span>
          </label>

          <div class="media-preview-control">
            <button v-if="videoPreviewUrl" class="video-preview-trigger" type="button"
              @click="openVideoPreview">
              打开视频预览
            </button>
            <button v-else class="preview-disabled" type="button" disabled>暂不可预览</button>
          </div>
        </div>
      </article>
    </section>

    <div class="task-status-row">
      <span>任务状态：{{ formatTaskStatus(taskStatus) }}</span>
      <span class="elapsed-badge">
        <Stopwatch class="elapsed-icon" aria-hidden="true" />
        {{ elapsedText }}
      </span>
    </div>

    <teleport to="body">
      <div v-if="isVideoPreviewOpen" class="modal-backdrop">
        <section class="video-preview-modal" role="dialog" aria-modal="true">
          <header class="modal-header">
            <h2>视频预览</h2>
            <button class="icon-button" type="button" aria-label="关闭视频预览" @click="closeVideoPreview">×</button>
          </header>
          <div class="video-preview-body">
            <video class="modal-preview-video" :src="videoPreviewUrl" controls autoplay></video>
          </div>
        </section>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
.sc-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.media-upload-panel {
  display: grid;
  gap: 12px;
}

.media-upload-item {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.media-upload-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.media-upload-head strong {
  color: #172033;
  font-size: 13px;
  line-height: 1.3;
}

.replace-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #2a6f97;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.replace-action:hover {
  color: #235e80;
  text-decoration: underline;
}

.replace-action input {
  display: none;
}

.audio-preview-row {
  min-height: 34px;
  display: flex;
  align-items: center;
}

.audio-preview {
  width: 100%;
  height: 34px;
  border-radius: 6px;
}

.audio-placeholder {
  color: #9aa8ba;
  font-size: 12px;
}

.media-upload-action {
  min-width: 0;
  width: 104px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  border: 1px dashed #9bb1c8;
  border-radius: 6px;
  color: #4b5d73;
  background: #f8fbfd;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.media-upload-action:hover {
  border-color: #2a6f97;
  background: #eef7fb;
}

.media-upload-action svg {
  width: 14px;
  height: 14px;
  color: #9aa4b2;
  flex: 0 0 auto;
}

.media-upload-action input {
  display: none;
}

.media-upload-controls {
  min-width: 0;
  display: grid;
  grid-template-columns: 104px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}

.media-upload-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.media-upload-head strong {
  color: #172033;
  font-size: 13px;
  line-height: 1.3;
}

.media-upload-head strong span {
  color: #718096;
  font-size: 12px;
  font-weight: 400;
}

.media-upload-item.is-uploading .state-pill { color: #1d5f8f; }
.media-upload-item.is-ready .state-pill { color: #167449; }
.media-upload-item.is-error .state-pill { color: #c21f12; }

.media-preview-control {
  min-width: 0;
}

.video-preview-trigger,
.preview-disabled {
  width: 100%;
  height: 34px;
  border: 1px solid #d8e0ea;
  border-radius: 6px;
  color: #64748b;
  background: #ffffff;
  font-size: 11px;
  font-weight: 700;
}

.video-preview-trigger:hover:not(:disabled) {
  border-color: #94a3b8;
  color: #475569;
  background: #f8fafc;
}

.preview-disabled {
  color: #9aa4b2;
  background: #f8fafc;
}

.tool-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tool-actions .primary-button,
.tool-actions .secondary-button {
  min-width: 0;
  height: 34px;
  padding: 0 12px;
  font-size: 13px;
}

.tool-actions .primary-button { flex: 1 1 0; }
.tool-actions .secondary-button { flex: 0 0 auto; }

.model-config-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #64748b;
}

.model-config-button svg {
  width: 14px;
  height: 14px;
  color: #9aa4b2;
  flex: 0 0 auto;
}

.task-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.elapsed-badge {
  min-width: 74px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 9px;
  border: 1px solid #c7d5e7;
  border-radius: 6px;
  color: #29435f;
  background: #f2f7fb;
  font-size: 12px;
  font-weight: 700;
}

.elapsed-icon {
  width: 14px;
  height: 14px;
}

.video-preview-modal {
  width: min(92vw, 860px);
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.28);
}

.video-preview-body {
  min-height: 0;
  padding: 12px;
  background: #0f172a;
}

.modal-preview-video {
  width: 100%;
  max-height: calc(100vh - 150px);
  display: block;
  border-radius: 6px;
  background: #0f172a;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.35);
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
  font-size: 24px;
  line-height: 1;
}

@media (max-width: 760px) {
  .media-upload-action {
    width: 100%;
    height: 32px;
  }

  .media-upload-controls {
    grid-template-columns: 1fr;
  }

  .tool-actions {
    flex-wrap: wrap;
  }

  .tool-actions .primary-button,
  .tool-actions .secondary-button {
    flex: 1 1 100%;
  }
}
</style>
