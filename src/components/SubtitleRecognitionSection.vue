<script setup lang="ts">
/**
 * 第五步：字幕时间轴识别（识别控件 + 可编辑字幕列表）
 *
 * 识别（ASR）只依赖第三步的语音音频，结果通过共享 composable
 * 提供给同列的字幕样式 / 画中画以及第七步导出使用。
 */
import { Stopwatch, Tickets } from '@element-plus/icons-vue'
import { ElDivider, ElIcon } from 'element-plus'
import { computed, nextTick, watch } from 'vue'
import { useSubtitleRecognition } from '@/composables/useSubtitleRecognition'

const {
  isRecognizing,
  startSubtitleRecognition,
  stopSubtitleRecognition,
  subtitleElapsedText,
  subtitleList,
  subtitleTaskStatus,
  updateSubtitleText,
} = useSubtitleRecognition()

function formatSubtitleTime(value: number): string {
  if (!Number.isFinite(value)) {
    return '00:00'
  }
  const normalizedValue = Math.max(0, value)
  const [integerPart, decimalPart = ''] = String(normalizedValue).split('.')
  const leftPart = integerPart.padStart(2, '0')
  const rightPart = decimalPart.padEnd(2, '0').slice(0, 2)
  return `${leftPart}:${rightPart}`
}

const subtitleRows = computed(() =>
  subtitleList.value.map((item) => ({
    id: item.id,
    text: item.text,
    timeRange: `${formatSubtitleTime(item.start)} - ${formatSubtitleTime(item.end)}`,
  })),
)

function autosizeSubtitleTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight}px`
}

function onSubtitleTextInput(id: string, event: Event): void {
  const textarea = event.target as HTMLTextAreaElement
  autosizeSubtitleTextarea(textarea)
  updateSubtitleText(id, textarea.value)
}

// 识别完成 / 文案变化后，批量校准列表内 textarea 高度
watch(
  subtitleRows,
  () => {
    void nextTick(() => {
      document
        .querySelectorAll<HTMLTextAreaElement>(
          '.subtitle-recognition-section .subtitle-text-input',
        )
        .forEach((textarea) => autosizeSubtitleTextarea(textarea))
    })
  },
  { deep: true },
)
</script>

<template>
  <section class="subtitle-recognition-section">
    <el-divider class="step-divider">第五步：字幕时间轴识别</el-divider>

    <section class="tool-actions">
      <button
        class="primary-button"
        type="button"
        :disabled="isRecognizing"
        @click="startSubtitleRecognition"
      >
        {{ isRecognizing ? '提取中...' : '字幕时间轴提取' }}
      </button>
      <button
        class="secondary-button"
        type="button"
        :disabled="!isRecognizing"
        @click="stopSubtitleRecognition"
      >
        停止中断
      </button>
    </section>

    <div class="subtitle-meta-row">
      <div class="task-status">状态：{{ subtitleTaskStatus }}</div>
      <span class="elapsed-badge" aria-label="字幕识别耗时">
        <Stopwatch class="elapsed-icon" aria-hidden="true" />
        {{ subtitleElapsedText }}
      </span>
    </div>

    <section class="subtitle-list-panel" aria-label="字幕可编辑列表">
      <div class="subtitle-list-frame">
        <div v-if="subtitleRows.length" class="subtitle-list">
          <article
            v-for="row in subtitleRows"
            :key="row.id"
            class="subtitle-row"
          >
            <span class="subtitle-time">{{ row.timeRange }}</span>
            <textarea
              class="subtitle-text-input"
              :value="row.text"
              rows="1"
              @input="onSubtitleTextInput(row.id, $event)"
            ></textarea>
          </article>
        </div>
        <div v-else class="empty-subtitle-list">
          <el-icon class="empty-subtitle-icon" aria-hidden="true">
            <Tickets />
          </el-icon>
          <span>识别字幕预览</span>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.subtitle-recognition-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
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

.tool-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(120px, auto);
  gap: 8px;
}

.tool-actions .primary-button,
.tool-actions .secondary-button {
  height: 34px;
  min-width: 76px;
  font-size: 13px;
}

.subtitle-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.task-status {
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

.subtitle-list-panel {
  /* flex-basis 用 0 + min-height 0：把列表高度约束在剩余空间内，
   * 内部 .subtitle-list 才会出现滚动条，而不是把整列撑高。 */
  flex: 1 1 0;
  min-height: 0;
}

.subtitle-list-frame {
  height: 100%;
  padding: 6px;
  border: 1px solid #d8e0ea;
  border-radius: 6px;
  background: #f8fafc;
}

.subtitle-list {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: auto;
}

.subtitle-row {
  min-height: 30px;
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 6px;
  align-items: stretch;
}

.subtitle-time {
  min-height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 6px;
  border: 1px solid #d8e0ea;
  border-radius: 6px;
  color: #64748b;
  background: #f8fafc;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
  text-align: center;
}

.subtitle-text-input {
  width: 100%;
  min-width: 0;
  min-height: 28px;
  padding: 5px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  color: #172033;
  background: #ffffff;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.5;
  outline: none;
  resize: none;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
}

.subtitle-text-input:focus {
  border-color: #2a6f97;
  box-shadow: 0 0 0 3px rgba(42, 111, 151, 0.12);
}

.empty-subtitle-list {
  height: 100%;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: #718096;
  font-size: 12px;
}

.empty-subtitle-icon {
  font-size: 34px;
  line-height: 1;
  color: #9aa4b2;
}
</style>
