<script setup lang="ts">
import { Stopwatch } from '@element-plus/icons-vue'
import { ElDivider } from 'element-plus'
import { ref } from 'vue'
import { useCopyCreation } from '@/composables/useCopyCreation'
import { useDouyinExtraction } from '@/composables/useDouyinExtraction'

const {
  douyinUrl,
  extractionElapsedText,
  extractedCopy,
  extractedVideoUrl,
  extractDouyinCopy,
  isExtractingDouyin,
  stopDouyinExtraction
} = useDouyinExtraction()

const {
  createdCopy,
  creationElapsedText,
  createRewriteCopy,
  isCreatingCopy,
  rewriteRequirements,
  stopCopyCreation
} = useCopyCreation()

const isVideoPreviewOpen = ref(false)

function openVideoPreview(): void {
  if (!extractedVideoUrl.value) {
    return
  }

  isVideoPreviewOpen.value = true
}

function closeVideoPreview(): void {
  isVideoPreviewOpen.value = false
}
</script>

<template>
  <article class="feature-column">
    <div class="column-body douyin-tool">
      <el-divider class="step-divider">第一步：提取抖音文案</el-divider>

      <label class="tool-field">
        <span>抖音地址（分享地址）</span>
        <input v-model="douyinUrl" type="text" placeholder="请输入抖音分享地址" :disabled="isExtractingDouyin" />
      </label>

      <div class="tool-actions extraction-actions">
        <button class="primary-button" type="button" :disabled="isExtractingDouyin" @click="extractDouyinCopy">
          {{ isExtractingDouyin ? '提取中...' : '提取文案' }}
        </button>
        <button class="secondary-button" type="button" :disabled="!isExtractingDouyin" @click="stopDouyinExtraction">
          停止中断
        </button>
      </div>

      <section class="result-panel copy-panel extracted-copy-panel">
        <div class="result-title-row">
          <h3>提取文案</h3>
          <div class="title-actions">
            <button class="text-link-button" type="button" :disabled="!extractedVideoUrl" @click="openVideoPreview">
              无水印视频预览
            </button>
            <span class="elapsed-badge" aria-label="提取耗时">
              <Stopwatch class="elapsed-icon" aria-hidden="true" />
              {{ extractionElapsedText }}
            </span>
          </div>
        </div>
        <textarea v-model="extractedCopy" rows="8" placeholder="提取完成后显示文案，可在这里修改"></textarea>
      </section>

      <el-divider class="step-divider">第二步：文案创作改写</el-divider>

      <section class="copy-creation-tool">
        <label class="tool-field other-requirements-field">
          <span>改写要求</span>
          <textarea v-model="rewriteRequirements" rows="3" placeholder="例如：更适合女性用户，开头三秒更强的钩子。"
            :disabled="isCreatingCopy"></textarea>
        </label>

        <div class="tool-actions creation-actions">
          <button class="primary-button" type="button" :disabled="isCreatingCopy"
            @click="createRewriteCopy(extractedCopy)">
            {{ isCreatingCopy ? '创作中...' : '文案创作' }}
          </button>
          <button class="secondary-button" type="button" :disabled="!isCreatingCopy" @click="stopCopyCreation">
            停止中断
          </button>
        </div>

        <section class="result-panel copy-panel created-copy-panel">
          <div class="result-title-row">
            <h3>文案创作</h3>
            <span class="elapsed-badge" aria-label="创作耗时">
              <Stopwatch class="elapsed-icon" aria-hidden="true" />
              {{ creationElapsedText }}
            </span>
          </div>
          <textarea v-model="createdCopy" rows="8" placeholder="创造完成后显示文案，可在这里修改"></textarea>
        </section>
      </section>
    </div>

    <teleport to="body">
      <div v-if="isVideoPreviewOpen" class="modal-backdrop">
        <section class="video-preview-modal" role="dialog" aria-modal="true" aria-labelledby="video-preview-title">
          <header class="modal-header">
            <h2 id="video-preview-title">无水印视频预览</h2>
            <button class="icon-button" type="button" aria-label="关闭无水印视频预览" @click="closeVideoPreview">
              ×
            </button>
          </header>
          <div class="video-preview-body">
            <video class="preview-video" :src="extractedVideoUrl" controls autoplay></video>
          </div>
        </section>
      </div>
    </teleport>
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

.douyin-tool {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
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

.tool-field {
  display: grid;
  gap: 6px;
}

.tool-field>span {
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.tool-field>input {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  color: #172033;
  background: #ffffff;
  outline: none;
}

.tool-field>input:focus {
  border-color: #2a6f97;
  box-shadow: 0 0 0 3px rgba(42, 111, 151, 0.12);
}

.tool-field>textarea {
  width: 100%;
  resize: vertical;
  padding: 8px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  color: #334155;
  background: #ffffff;
  font-size: 13px;
  font-weight: 400;
  line-height: 1.55;
  outline: none;
}

.tool-field>textarea::placeholder {
  color: #718096;
  font-weight: 400;
}

.tool-field>textarea:focus {
  border-color: #2a6f97;
  box-shadow: 0 0 0 3px rgba(42, 111, 151, 0.12);
}

.copy-creation-tool {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
}

.other-requirements-field {
  margin-top: -1px;
}

.tool-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(92px, auto);
  gap: 8px;
}

.extraction-actions,
.creation-actions {
  grid-template-columns: minmax(0, 1fr) minmax(120px, auto);
}

.tool-actions .primary-button,
.tool-actions .secondary-button {
  height: 34px;
  min-width: 76px;
  font-size: 13px;
}

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

.result-panel {
  display: grid;
  gap: 8px;
}

.result-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.title-actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.result-panel h3 {
  margin: 0;
  color: #172033;
  font-size: 13px;
  line-height: 1.3;
}

.text-link-button {
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  color: #2a6f97;
  background: transparent;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}

.text-link-button:hover:not(:disabled) {
  color: #235e80;
  text-decoration: underline;
}

.text-link-button:disabled {
  color: #9aa8ba;
  cursor: not-allowed;
  opacity: 1;
  text-decoration: none;
}

.elapsed-badge {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 82px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid #b8c7df;
  border-radius: 6px;
  color: #2f4870;
  background: #eef4ff;
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
}

.elapsed-icon {
  width: 14px;
  height: 14px;
}

.copy-panel textarea {
  width: 100%;
  min-height: 102px;
  resize: vertical;
  padding: 10px;
  border: 1px solid #d8e0ea;
  border-radius: 6px;
  color: #334155;
  background: #fbfcfe;
  font-size: 13px;
  font-weight: 400;
  line-height: 1.6;
  outline: none;
}

.copy-panel textarea::placeholder {
  color: #718096;
  font-weight: 400;
}

.copy-panel textarea:focus {
  border-color: #2a6f97;
  box-shadow: 0 0 0 3px rgba(42, 111, 151, 0.12);
}

.copy-creation-tool .result-panel {
  gap: 7px;
}

.extracted-copy-panel {
  margin-top: 10px;
}

.created-copy-panel {
  margin-top: 2px;
  flex: 1 1 auto;
  grid-template-rows: auto 1fr;
}

.created-copy-panel textarea {
  height: 100%;
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

.video-preview-modal {
  width: min(92vw, 760px);
  max-height: calc(100vh - 40px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.28);
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

.config-field {
  display: grid;
  gap: 6px;
}

.config-field > span {
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.config-field input,
.config-field select {
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

.config-field input:focus,
.config-field select:focus {
  border-color: #2a6f97;
  box-shadow: 0 0 0 3px rgba(42, 111, 151, 0.12);
}

.config-tip {
  margin: 0;
  color: #718096;
  font-size: 12px;
  line-height: 1.5;
}

.config-tip a {
  color: #2a6f97;
}



.config-form {
  display: grid;
  gap: 16px;
  padding: 10px 20px;
  overflow: auto;
}

.config-description {
  margin-bottom: 4px;
}

.config-description p {
  margin: 0;
  color: #718096;
  font-size: 13px;
  line-height: 1.4;
}

.field {
  display: grid;
  gap: 8px;
}

.field span {
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.field input {
  width: 100%;
  height: 36px;
  padding: 8px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  color: #172033;
  background: #ffffff;
  font-size: 13px;
  line-height: 1.4;
  outline: none;
}

.field input[readonly] {
  color: #64748b;
  background: #f8fafc;
  cursor: default;
}

.field input:focus {
  border-color: #2a6f97;
  box-shadow: 0 0 0 3px rgba(42, 111, 151, 0.12);
}

.field input[readonly]:focus {
  border-color: #cbd5e1;
  box-shadow: none;
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

.video-preview-body {
  padding: 14px;
  background: #f7f9fc;
}

.preview-video {
  width: 100%;
  height: min(70vh, 620px);
  display: block;
  border: 1px solid #d8e0ea;
  border-radius: 8px;
  background: #111827;
  object-fit: contain;
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
  letter-spacing: 0;
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

@media (max-width: 640px) {
  .modal-backdrop {
    padding: 10px;
  }
}
</style>
