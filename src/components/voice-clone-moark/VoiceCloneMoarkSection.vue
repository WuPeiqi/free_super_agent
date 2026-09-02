<script setup lang="ts">
/**
 * 模力方舟语音克隆 UI
 *
 * 登录逻辑：
 *   - 点击「音色配置」时，先显示加载界面验证 cookie
 *   - cookie 无效 → 显示登录引导遮罩
 *   - cookie 有效 → 显示正常的音色管理界面（左侧音色列表 + 右侧录音/上传）
 *
 * 音色管理：
 *   - 纯本地操作，文件拷贝到用户目录
 *   - 不涉及网络，不同 API Key 共享本地音色
 *
 * 完全独立于其他 provider，删除时整个文件可直接移除。
 */
import { Delete, Edit, Microphone, Refresh, Stopwatch, VideoPause, VideoPlay } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { ref, onUnmounted } from 'vue'
import { useVoiceCloneMoark } from '@/composables/voice-clone-moark/useVoiceCloneMoark'
import { useWorkflowState } from '@/composables/useWorkflowState'
import type { MoarkVoiceProfile } from '@/types/voice-clone-moark'

const { createdCopyText } = useWorkflowState()

const {
  voices,
  selectedVoiceId,
  isLoadingVoices,
  isSavingVoice,
  isSynthesizingVoice,
  synthesisElapsedText,
  synthesizedAudioUrl,
  voiceName,
  editingVoiceId,
  editingVoiceName,
  refreshVoices,
  saveVoice,
  startEditVoice,
  saveEditVoice,
  deleteVoice,
  synthesizeSelectedVoice,
  stopVoiceSynthesis,
} = useVoiceCloneMoark()

const isVoiceModalOpen = ref(false)

// ── 录音相关 ──
const isRecording = ref(false)
const recordingElapsedSeconds = ref(0)
const recordedAudioUrl = ref('')
let selectedFilePath = ''
let mediaRecorder: MediaRecorder | undefined
let recordingTimer: number | undefined
let recordedChunks: BlobPart[] = []

// ── 音色试听 ──
const playingVoiceId = ref('')
const voicePreviewProgress = ref(0)
let previewAudio: HTMLAudioElement | undefined

/**
 * 点击「音色管理」：打开弹窗并刷新本地音色列表。
 * 音色管理为纯本地操作，无需登录；登录仅在语音生成上传音色时需要（由配置中心统一授权）。
 */
async function handleOpenVoiceModal(): Promise<void> {
  isVoiceModalOpen.value = true
  await refreshVoices()
}

function closeVoiceModal(): void {
  stopVoicePreview()
  isVoiceModalOpen.value = false
}

// ── 录音 ──
async function startRecording(): Promise<void> {
  if (isRecording.value) return

  // macOS 需要先请求系统麦克风权限
  try {
    const accessStatus = (await window.desktopApi.requestMicrophoneAccess()) as string
    if (accessStatus === 'denied') {
      ElMessage.error('麦克风权限被拒绝，请在系统设置中允许本应用访问麦克风')
      return
    }
  } catch {
    // 非 macOS 或权限检查失败时继续尝试录音
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Permission') || msg.includes('NotAllowed')) {
      ElMessage.error('麦克风权限被拒绝，请在系统设置中允许本应用访问麦克风')
    } else {
      ElMessage.error('无法访问麦克风，请检查设备连接或系统权限设置')
    }
    return
  }

  recordedChunks = []
  selectedFilePath = ''
  if (recordedAudioUrl.value) {
    URL.revokeObjectURL(recordedAudioUrl.value)
    recordedAudioUrl.value = ''
  }

  mediaRecorder = new MediaRecorder(stream)
  mediaRecorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) recordedChunks.push(event.data)
  })
  mediaRecorder.addEventListener('stop', async () => {
    const blob = new Blob(recordedChunks, { type: mediaRecorder?.mimeType || 'audio/webm' })
    recordedAudioUrl.value = URL.createObjectURL(blob)
    stream.getTracks().forEach((track) => track.stop())

    // 把录音保存为临时文件
    try {
      const arrayBuffer = await blob.arrayBuffer()
      const filePath = (await window.desktopApi.saveMoarkRecording(
        arrayBuffer,
        blob.type,
      )) as string
      selectedFilePath = filePath
    } catch {
      // 静默
    }
  })

  recordingElapsedSeconds.value = 0
  isRecording.value = true
  mediaRecorder.start()

  recordingTimer = window.setInterval(() => {
    recordingElapsedSeconds.value += 1
    if (recordingElapsedSeconds.value >= 20) stopRecording()
  }, 1000)
}

function stopRecording(): void {
  if (!isRecording.value) return
  isRecording.value = false
  if (recordingTimer) {
    window.clearInterval(recordingTimer)
    recordingTimer = undefined
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
  }
}

// ── 文件上传（通过系统对话框选择） ──
async function handleVoiceFileUpload(): Promise<void> {
  const filePath = (await window.desktopApi.selectAudioFile()) as string | null
  if (!filePath) return

  // 读取文件并检查大小（限制 100MB）
  let fileResult: { arrayBuffer: ArrayBuffer; mimeType: string }
  try {
    fileResult = (await window.desktopApi.readAudioFile(filePath)) as {
      arrayBuffer: ArrayBuffer
      mimeType: string
    }
  } catch {
    ElMessage.error('文件读取失败，请重新选择')
    return
  }

  const maxSize = 100 * 1024 * 1024 // 100MB
  if (fileResult.arrayBuffer.byteLength > maxSize) {
    ElMessage.warning('音频文件不能超过 100MB，请重新选择')
    return
  }

  selectedFilePath = filePath

  if (recordedAudioUrl.value) {
    URL.revokeObjectURL(recordedAudioUrl.value)
    recordedAudioUrl.value = ''
  }

  const blob = new Blob([fileResult.arrayBuffer], { type: fileResult.mimeType })
  recordedAudioUrl.value = URL.createObjectURL(blob)
}

// ── 保存音色 ──
async function handleSaveVoice(): Promise<void> {
  const success = await saveVoice(selectedFilePath)
  // 仅保存成功后才清空录音状态
  if (success) {
    selectedFilePath = ''
    if (recordedAudioUrl.value) {
      URL.revokeObjectURL(recordedAudioUrl.value)
      recordedAudioUrl.value = ''
    }
  }
}

// ── 音色试听 ──
function stopVoicePreview(): void {
  if (previewAudio) {
    previewAudio.pause()
    previewAudio.src = ''
    previewAudio = undefined
  }
  playingVoiceId.value = ''
  voicePreviewProgress.value = 0
}

function toggleVoicePreview(voice: MoarkVoiceProfile): void {
  if (playingVoiceId.value === voice.id) {
    stopVoicePreview()
    return
  }
  stopVoicePreview()
  previewAudio = new Audio(voice.audioUrl)
  previewAudio.preload = 'metadata'
  playingVoiceId.value = voice.id
  previewAudio.addEventListener('timeupdate', () => {
    if (!previewAudio || !Number.isFinite(previewAudio.duration) || previewAudio.duration <= 0) {
      voicePreviewProgress.value = 0
      return
    }
    voicePreviewProgress.value = Math.min(100, (previewAudio.currentTime / previewAudio.duration) * 100)
  })
  previewAudio.addEventListener('ended', stopVoicePreview, { once: true })
  void previewAudio.play()
}

onUnmounted(() => {
  stopRecording()
  stopVoicePreview()
  if (recordedAudioUrl.value) URL.revokeObjectURL(recordedAudioUrl.value)
})
</script>

<template>
  <div>
    <div class="tool-actions voice-actions">
      <button class="primary-button" type="button" :disabled="isSynthesizingVoice" @click="synthesizeSelectedVoice">
        {{ isSynthesizingVoice ? '生成中...' : '语音生成' }}
      </button>
      <button class="secondary-button" type="button" :disabled="!isSynthesizingVoice" @click="stopVoiceSynthesis">
        停止中断
      </button>
    </div>

    <section class="voice-select-section">
      <div class="voice-select-title-row">
        <span class="voice-select-title">选择音色</span>
      </div>
      <div class="voice-select-controls">
        <select v-model="selectedVoiceId" class="voice-select-input">
          <option value="">请选择音色</option>
          <option v-for="voice in voices" :key="voice.id" :value="voice.id">
            {{ voice.name }}
          </option>
        </select>
        <button class="icon-action-button" type="button" :disabled="isLoadingVoices" title="刷新音色列表" @click="refreshVoices">
          <Refresh />
        </button>
        <button class="voice-manage-button" type="button" title="音色管理" @click="handleOpenVoiceModal">
          <Microphone />
          音色管理
        </button>
      </div>
    </section>

    <section class="voice-result-panel">
      <div class="result-title-row">
        <h3>语音预览</h3>
        <span class="elapsed-badge" aria-label="语音生成耗时">
          <Stopwatch class="elapsed-icon" aria-hidden="true" />
          {{ synthesisElapsedText }}
        </span>
      </div>
      <audio v-if="synthesizedAudioUrl" class="synthesized-audio" :src="synthesizedAudioUrl" controls></audio>
      <div v-else class="empty-audio">生成后可在这里播放音频</div>
    </section>

    <!-- 音色管理弹窗 -->
    <teleport to="body">
      <div v-if="isVoiceModalOpen" class="modal-backdrop">
        <section class="voice-modal" role="dialog" aria-modal="true">
          <header class="modal-header">
            <h2>模力方舟音色管理</h2>
            <button class="icon-button" type="button" aria-label="关闭" @click="closeVoiceModal">×</button>
          </header>

          <div class="voice-modal-body">
            <!-- 音色管理为纯本地操作，无需登录 -->
            <div class="voice-manage-layout">
              <!-- 左侧：音色列表 -->
              <section class="voice-list-panel">
                <header class="panel-title-row">
                  <h3>音色列表</h3>
                  <button class="text-link-button" type="button" @click="refreshVoices">刷新</button>
                </header>

                <div v-if="voices.length" class="voice-list">
                  <article v-for="voice in voices" :key="voice.id" class="voice-item"
                    :class="{ 'is-playing': playingVoiceId === voice.id }">
                    <div class="voice-item-main">
                      <input v-if="editingVoiceId === voice.id" v-model="editingVoiceName" class="voice-edit-input" type="text" />
                      <strong v-else>{{ voice.name }}</strong>
                      <span>{{ voice.md5 }}</span>
                    </div>
                    <div class="voice-item-actions">
                      <button class="icon-action-button" type="button" title="试听" @click="toggleVoicePreview(voice)">
                        <VideoPause v-if="playingVoiceId === voice.id" />
                        <VideoPlay v-else />
                      </button>
                      <button v-if="editingVoiceId === voice.id" class="small-button primary" type="button" @click="saveEditVoice">
                        保存
                      </button>
                      <button v-else class="icon-action-button" type="button" title="编辑" @click="startEditVoice(voice)">
                        <Edit />
                      </button>
                      <button class="icon-action-button danger" type="button" title="删除" @click="deleteVoice(voice.id)">
                        <Delete />
                      </button>
                    </div>
                    <div class="voice-progress-track">
                      <div class="voice-progress-value"
                        :style="{ width: playingVoiceId === voice.id ? `${voicePreviewProgress}%` : '0%' }"></div>
                    </div>
                  </article>
                </div>
                <div v-else class="empty-list">暂无音色，请在右侧新增</div>
              </section>

              <!-- 右侧：新增音色 -->
              <section class="voice-create-panel">
                <h3>新增音色</h3>
                <label class="tool-field">
                  <span>音色名称</span>
                  <input v-model="voiceName" class="voice-name-input" type="text" placeholder="例如：我的口播音色" />
                </label>

                <div class="read-text">
                  <strong>朗读文本</strong>
                  <p v-if="createdCopyText.trim()" class="read-text-content">{{ createdCopyText }}</p>
                  <p v-else class="read-text-empty">请先在第二步完成文案创作</p>
                </div>

                <div class="record-panel">
                  <div class="record-status">
                    <Microphone class="record-icon" />
                    <span>{{ isRecording ? `录制中 ${recordingElapsedSeconds}s / 20s` : '录制时长建议最多 20s' }}</span>
                  </div>
                  <div class="record-actions">
                    <button class="primary-button" type="button" :disabled="isRecording" @click="startRecording">开始录制</button>
                    <button class="secondary-button" type="button" :disabled="!isRecording" @click="stopRecording">停止录制</button>
                  </div>
                  <button class="upload-voice-button" type="button" @click="handleVoiceFileUpload">
                    上传音频文件
                  </button>
                  <p class="upload-tip">支持任意音频格式，文件大小不超过 100MB</p>
                  <div class="recorded-audio-slot">
                    <audio v-if="recordedAudioUrl" class="recorded-audio" :src="recordedAudioUrl" controls></audio>
                    <span v-else>录制完成后可在这里试听</span>
                  </div>
                </div>

                <footer class="voice-create-actions">
                  <button class="primary-button" type="button" :disabled="isSavingVoice || isRecording" @click="handleSaveVoice">
                    {{ isSavingVoice ? '保存中...' : '保存音色' }}
                  </button>
                </footer>
              </section>
            </div>
          </div>
        </section>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
.voice-select-section { display: grid; gap: 6px; margin-top: 12px; }
.voice-select-title-row { display: flex; align-items: center; justify-content: space-between; }
.voice-select-title { color: #334155; font-size: 12px; font-weight: 700; }

.voice-select-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px auto;
  gap: 8px;
  align-items: center;
}

.voice-select-input {
  width: 100%; height: 34px; padding: 0 10px;
  border: 1px solid #cbd5e1; border-radius: 6px;
  color: #172033; background: #ffffff; outline: none;
}
.voice-select-input:focus { border-color: #2a6f97; box-shadow: 0 0 0 3px rgba(42, 111, 151, 0.12); }

.icon-action-button {
  width: 34px; height: 34px; display: inline-grid; place-items: center;
  border: 1px solid #cbd5e1; border-radius: 6px; color: #41546b; background: #ffffff;
}
.icon-action-button:hover:not(:disabled) { color: #2a6f97; background: #f5f8fb; }
.icon-action-button:disabled { opacity: 0.5; cursor: not-allowed; }
.icon-action-button svg { width: 16px; height: 16px; }
.icon-action-button.danger:hover:not(:disabled) { color: #b42318; }

.voice-manage-button {
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  color: #64748b;
  background: #ffffff;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}
.voice-manage-button:hover { color: #2a6f97; background: #f5f8fb; }
.voice-manage-button svg { width: 14px; height: 14px; color: #9aa4b2; flex: 0 0 auto; }

.tool-actions { display: grid; grid-template-columns: minmax(0, 1fr) minmax(120px, auto); gap: 8px; }
.tool-actions .primary-button, .tool-actions .secondary-button { height: 34px; min-width: 76px; font-size: 13px; }

.model-config-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; color: #64748b; }
.model-config-button svg { width: 14px; height: 14px; color: #9aa4b2; flex: 0 0 auto; }

.voice-result-panel { display: grid; gap: 8px; padding: 0; margin-top: 12px; }
.result-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.result-title-row h3 { margin: 0; color: #172033; font-size: 13px; }

.empty-audio {
  min-height: 34px; display: grid; place-items: center;
  border: 1px dashed #cbd5e1; border-radius: 6px; color: #718096; background: #f8fafc; font-size: 12px;
}

.elapsed-badge {
  min-width: 74px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
  gap: 5px; padding: 0 9px; border: 1px solid #c7d5e7; border-radius: 6px;
  color: #29435f; background: #f2f7fb; font-size: 12px; font-weight: 700;
}

.elapsed-icon { width: 14px; height: 14px; }

.synthesized-audio { width: 100%; height: 32px; }

/* ── 弹窗 ── */
.modal-backdrop { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 20px; background: rgba(15, 23, 42, 0.35); }

.voice-modal {
  width: min(94vw, 980px); max-height: calc(100vh - 40px);
  display: flex; flex-direction: column; overflow: hidden;
  border: 1px solid #cbd5e1; border-radius: 8px; background: #ffffff;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.28);
}

.modal-header {
  min-height: 56px; display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 0 18px; border-bottom: 1px solid #e1e7ef;
}
.modal-header h2 { margin: 0; color: #172033; font-size: 17px; line-height: 1.2; }

.icon-button {
  width: 32px; height: 32px; display: inline-grid; place-items: center;
  border: 1px solid transparent; border-radius: 6px; color: #64748b; background: transparent; font-size: 24px; line-height: 1;
}
.icon-button:hover { border-color: #d4dce8; color: #172033; background: #f6f8fb; }

.voice-modal-body { flex: 1; min-height: 360px; position: relative; overflow: hidden; }

/* ── 加载 ── */
.loading-overlay { position: absolute; inset: 0; display: grid; place-items: center; background: #ffffff; z-index: 10; }
.loading-card { display: flex; flex-direction: column; align-items: center; gap: 14px; }
.loading-card p { margin: 0; color: #64748b; font-size: 13px; }
.loading-spinner { width: 32px; height: 32px; border: 3px solid #e2e8f0; border-top-color: #2a6f97; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ── 登录遮罩 ── */
.login-overlay { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(255, 255, 255, 0.88); backdrop-filter: blur(2px); z-index: 10; }
.login-card { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 32px 40px; text-align: center; max-width: 360px; }
.login-icon { font-size: 40px; line-height: 1; }
.login-card h3 { margin: 0; color: #172033; font-size: 16px; font-weight: 700; }
.login-card p { margin: 0; color: #64748b; font-size: 13px; line-height: 1.6; }
.login-tip { color: #94a3b8 !important; font-size: 12px !important; }
.login-button { margin-top: 8px; min-width: 140px; height: 38px; font-size: 14px; font-weight: 700; }

/* ── 已登录布局 ── */
.voice-manage-layout {
  height: 100%; display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 0.85fr);
  gap: 0; overflow: hidden;
}

.voice-list-panel, .voice-create-panel { min-height: 0; padding: 16px; overflow: auto; }
.voice-list-panel { border-right: 1px solid #e1e7ef; }

.panel-title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.panel-title-row h3, .voice-create-panel h3 { margin: 0; color: #172033; font-size: 14px; }

.text-link-button { padding: 0; border: 0; color: #2a6f97; background: transparent; font-size: 12px; font-weight: 700; cursor: pointer; }

.voice-list { display: grid; gap: 10px; }

.voice-item {
  position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px; align-items: center; padding: 10px;
  border: 1px solid #e1e7ef; border-radius: 6px; background: #fbfcfe;
}
.voice-item.is-playing { border-color: #9cc3da; background: #f7fbfd; }
.voice-item-main { min-width: 0; display: grid; gap: 4px; }
.voice-item-main strong { color: #172033; font-size: 13px; }
.voice-item-main span { color: #718096; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.voice-edit-input { width: 100%; height: 28px; padding: 0 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12px; }
.voice-item-actions { display: inline-flex; gap: 6px; }

.voice-progress-track { position: absolute; right: 0; bottom: 0; left: 0; height: 3px; overflow: hidden; background: transparent; }
.voice-progress-value { height: 100%; border-radius: 999px; background: #2a6f97; transition: width 0.12s linear; }

.small-button { height: 30px; padding: 0 10px; border-radius: 6px; font-size: 12px; font-weight: 700; }
.small-button.primary { border: 1px solid #2a6f97; color: #ffffff; background: #2a6f97; }

.empty-list {
  min-height: 80px; display: grid; place-items: center;
  border: 1px dashed #cbd5e1; border-radius: 6px; color: #718096; background: #f8fafc; font-size: 12px;
}

.voice-create-panel { display: flex; flex-direction: column; gap: 12px; }

.tool-field { display: grid; gap: 6px; }
.tool-field > span { color: #334155; font-size: 12px; font-weight: 700; }
.tool-field input { width: 100%; height: 34px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 6px; color: #172033; background: #ffffff; font-size: 13px; outline: none; }
.tool-field input:focus { border-color: #2a6f97; box-shadow: 0 0 0 3px rgba(42, 111, 151, 0.12); }
.voice-name-input { font-size: 12px; }

.read-text { padding: 10px; border: 1px solid #e1e7ef; border-radius: 6px; background: #f8fafc; }
.read-text strong { display: block; margin-bottom: 6px; color: #334155; font-size: 12px; }
.read-text p { margin: 0; color: #60728a; font-size: 12px; line-height: 1.6; }
.read-text-content {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}
.read-text-empty { color: #94a3b8 !important; font-style: italic; }

.record-panel { display: grid; gap: 10px; padding: 10px; border: 1px solid #e1e7ef; border-radius: 6px; }
.record-status { display: flex; align-items: center; gap: 8px; color: #41546b; font-size: 12px; font-weight: 700; }
.record-icon { width: 16px; height: 16px; }
.record-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }

.upload-voice-button {
  height: 34px; display: grid; place-items: center;
  border: 1px dashed #9bb1c8; border-radius: 6px; color: #2a6f97; background: #f8fbfd;
  font-size: 13px; font-weight: 700; cursor: pointer;
}
.upload-voice-button:hover { border-color: #2a6f97; background: #eef7fb; }

.upload-tip { margin: -4px 0 0; color: #718096; font-size: 12px; line-height: 1.4; }

.recorded-audio-slot { min-height: 34px; display: grid; align-items: center; }
.recorded-audio { width: 100%; height: 32px; }
.recorded-audio-slot span {
  min-height: 32px; display: grid; place-items: center;
  border: 1px dashed #cbd5e1; border-radius: 6px; color: #718096; background: #f8fafc; font-size: 12px;
}

.voice-create-actions { display: flex; justify-content: flex-end; }

@media (max-width: 760px) {
  .voice-manage-layout { grid-template-columns: 1fr; }
  .voice-list-panel { border-right: 0; border-bottom: 1px solid #e1e7ef; }
}
</style>
