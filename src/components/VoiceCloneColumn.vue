<script setup lang="ts">
/**
 * 第三步：语音克隆合成 + 第四步：视频对口型
 *
 * 语音克隆仅支持模力方舟。模型 API Key 与登录统一在右上角【配置中心】完成。
 * 对口型直接消费第三步合成的语音音频，故放在本列下方。
 */
import { ElDivider } from 'element-plus'
import VoiceCloneMoarkSection from '@/components/voice-clone-moark/VoiceCloneMoarkSection.vue'
import VideoLipSyncSection from '@/components/VideoLipSyncSection.vue'
import VideoLipSyncResultColumn from '@/components/VideoLipSyncResultColumn.vue'
import { useVoiceCloneActive } from '@/composables/useVoiceClone'

// 第四步视频对口型需要第三步语音合成的音频
const { synthesizedAudioUrl } = useVoiceCloneActive()
</script>

<template>
  <article class="feature-column">
    <div class="column-body voice-tool">
      <el-divider class="step-divider">第三步：语音克隆合成</el-divider>

      <VoiceCloneMoarkSection />

      <VideoLipSyncSection :voice-audio-url="synthesizedAudioUrl" />
      <VideoLipSyncResultColumn />
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

.voice-tool {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow-y: auto;
}

/* 第四步对口型结果预览撑满剩余空间，使本列底边与其他列对齐；
 * flex-basis 用 0，避免生成视频后被视频原始高度撑爆本列。 */
.voice-tool :deep(.lip-sync-result-section) {
  flex: 1 1 0;
  min-height: 240px;
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

/* ── 配置弹窗 ── */
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

.provider-select-field {
  display: grid;
  gap: 6px;
}

.provider-select-field > span {
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.provider-select-field select {
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

.provider-select-field select:focus {
  border-color: #2a6f97;
  box-shadow: 0 0 0 3px rgba(42, 111, 151, 0.12);
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
</style>
