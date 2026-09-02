<script setup lang="ts">
/**
 * 第四步：视频对口型（dispatcher）
 *
 * 当前仅支持「独享算力」一个模型。职责：
 *   - 渲染步骤标题 + 主 UI（LipSyncMainSection）
 *   - 容纳统一的"模型配置弹窗"（独享算力服务器配置）
 *
 * 业务逻辑（上传、提交、状态跟踪）在 lip-sync-runtime / lip-sync-dedicated 中实现。
 */
import { ElDivider, ElMessage } from 'element-plus'
import { computed } from 'vue'
import { useLipSyncActive } from '@/composables/useLipSyncActive'
import { useLipSyncDedicated } from '@/composables/lip-sync-dedicated/useLipSyncDedicated'
import LipSyncMainSection from '@/components/lip-sync-runtime/LipSyncMainSection.vue'
import LipSyncDedicatedConfigForm from '@/components/lip-sync-dedicated/LipSyncDedicatedConfigForm.vue'

const props = defineProps<{
  voiceAudioBlob?: Blob | null
  voiceAudioUrl?: string
}>()

const { isConfigModalOpen, closeConfigModal } = useLipSyncActive()
const dedicatedState = useLipSyncDedicated()

const isSavingConfig = computed(() => dedicatedState.isSavingConfig.value)

async function saveConfig(): Promise<void> {
  if (!dedicatedState.config.baseUrl.trim()) {
    ElMessage.warning('请填写独享算力服务器地址')
    return
  }
  await dedicatedState.saveConfig()
  closeConfigModal()
}
</script>

<template>
  <div class="lip-sync-tool">
    <el-divider class="step-divider" style='margin-bottom:25px;margin-top:25px;'>第四步：视频对口型</el-divider>

    <LipSyncMainSection
      :voice-audio-url="props.voiceAudioUrl"
      :voice-audio-blob="props.voiceAudioBlob"
    />

    <!-- 模型配置弹窗：独享算力服务器配置 -->
    <teleport to="body">
      <div v-if="isConfigModalOpen" class="modal-backdrop">
        <section class="config-modal" role="dialog" aria-modal="true">
          <header class="modal-header">
            <h2>视频对口型模型配置</h2>
            <button class="icon-button" type="button" aria-label="关闭配置" @click="closeConfigModal">×</button>
          </header>

          <div class="config-modal-body">
            <LipSyncDedicatedConfigForm />
          </div>

          <footer class="modal-actions">
            <button class="secondary-button" type="button" :disabled="isSavingConfig" @click="closeConfigModal">
              取消
            </button>
            <button class="primary-button" type="button" :disabled="isSavingConfig" @click="saveConfig">
              {{ isSavingConfig ? '保存中...' : '保存配置' }}
            </button>
          </footer>
        </section>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
.lip-sync-tool {
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: #5f6e80;
  font-size: 13px;
  line-height: 1.6;
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

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.35);
}

.config-modal {
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

.icon-button:hover {
  border-color: #d4dce8;
  color: #172033;
  background: #f6f8fb;
}

.config-modal-body {
  display: grid;
  gap: 16px;
  padding: 18px;
  overflow: auto;
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

.primary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 16px;
  height: 36px;
  border: 1px solid #2a6f97;
  border-radius: 6px;
  color: #ffffff;
  background: #2a6f97;
  font-weight: 700;
  cursor: pointer;
}

.primary-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 14px;
  height: 36px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  color: #475569;
  background: #ffffff;
  font-weight: 700;
  cursor: pointer;
}

.secondary-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
