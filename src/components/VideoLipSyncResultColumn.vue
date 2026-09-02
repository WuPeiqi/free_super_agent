<script setup lang="ts">
import { computed } from 'vue'
import { VideoCamera } from '@element-plus/icons-vue'
import { useLipSyncRuntime } from '@/composables/lip-sync-runtime/useLipSyncRuntime'

// 视频对口型当前仅支持独享算力，结果统一取自共享运行时
const lipSyncState = useLipSyncRuntime()

const hasResult = computed(() => lipSyncState.hasResult.value)
const resultVideoUrl = computed(() => lipSyncState.resultVideoUrl.value)
</script>

<template>
  <section class="lip-sync-result-section">
    <video v-if="hasResult" class="result-video" :src="resultVideoUrl" controls autoplay></video>
    <div v-else class="empty-result">
      <VideoCamera class="empty-result-icon" aria-hidden="true" />
      <span>对口型视频预览</span>
    </div>

  </section>
</template>

<style scoped>
.lip-sync-result-section {
  height: 280px;
  flex: 0 0 280px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: #5f6e80;
  font-size: 13px;
  line-height: 1.6;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.result-video {
  width: 100%;
  height: 100%;
  min-height: 0;
  flex: 1 1 auto;
  object-fit: contain;
  border-radius: 6px;
  background: #0f172a;
}

.empty-result {
  height: 100%;
  min-height: 0;
  flex: 1 1 auto;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  border: 1px dashed #cbd5e1;
  border-radius: 6px;
  color: #718096;
  background: #f8fafc;
  font-size: 12px;
}

.empty-result-icon {
  width: 34px;
  height: 34px;
  color: #9aa4b2;
}
</style>
