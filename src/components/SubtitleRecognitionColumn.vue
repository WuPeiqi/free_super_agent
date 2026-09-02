<script setup lang="ts">
import { EditPen, Picture } from "@element-plus/icons-vue";
import { ElDivider, ElIcon, ElMessage, ElSwitch } from "element-plus";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import PictureInPictureModal from "@/components/PictureInPictureModal.vue";
import SubtitleRecognitionSection from "@/components/SubtitleRecognitionSection.vue";
import { useSubtitleRecognition } from "@/composables/useSubtitleRecognition";
import { usePictureInPicture } from "@/composables/usePictureInPicture";
import {
  DEFAULT_SUBTITLE_FONT_ID,
  SUBTITLE_FONT_OPTIONS,
  getSubtitleFontOption,
} from "@/config/subtitle-fonts";
import {
  SUBTITLE_STYLE_PRESETS,
  type SubtitleStylePreset,
} from "@/config/subtitle-style-presets";

const {
  effectiveVideoSourceUrl,
  subtitleList,
  updateSubtitleText,
} = useSubtitleRecognition();

const previewVideoSrc = computed(() => effectiveVideoSourceUrl.value);

function formatSubtitleTime(value: number): string {
  if (!Number.isFinite(value)) {
    return "00:00";
  }

  const normalizedValue = Math.max(0, value);
  const [integerPart, decimalPart = ""] = String(normalizedValue).split(".");
  const leftPart = integerPart.padStart(2, "0");
  const rightPart = decimalPart.padEnd(2, "0").slice(0, 2);
  return `${leftPart}:${rightPart}`;
}

const subtitleRows = computed(() =>
  subtitleList.value.map((item) => ({
    id: item.id,
    text: item.text,
    timeRange: `${formatSubtitleTime(item.start)} - ${formatSubtitleTime(item.end)}`,
  })),
);

const fontOptions = SUBTITLE_FONT_OPTIONS;

const subtitleActualFontSize = 10;
const subtitleStyleStorageKey = "free-super-agent.subtitle-style";
const subtitleFontSize = ref(subtitleActualFontSize);
const subtitleColor = ref("#ffffff");
const subtitleStrokeSize = ref(1);
const subtitleStrokeColor = ref("#000000");
// 选中字体的 ID（持久化到 localStorage），渲染时再映射到对应的 fontFamily
const selectedFontId = ref(DEFAULT_SUBTITLE_FONT_ID);
const isStyleModalOpen = ref(false);

const selectedFont = computed(() =>
  getSubtitleFontOption(selectedFontId.value),
);

const stylePresets = SUBTITLE_STYLE_PRESETS;

// 根据预设值与当前字幕样式做匹配，命中则返回对应预设 ID，否则返回空字符串
const activeStylePresetId = computed(() => {
  const matched = stylePresets.find(
    (preset) =>
      preset.fontId === selectedFontId.value &&
      preset.fontSize === subtitleFontSize.value &&
      preset.color.toLowerCase() === subtitleColor.value.toLowerCase() &&
      preset.strokeSize === subtitleStrokeSize.value &&
      preset.strokeColor.toLowerCase() ===
        subtitleStrokeColor.value.toLowerCase(),
  );
  return matched?.id ?? "";
});

function applyStylePreset(preset: SubtitleStylePreset): void {
  // 一键应用预设里的全部字幕样式参数
  selectedFontId.value = preset.fontId;
  subtitleFontSize.value = preset.fontSize;
  subtitleColor.value = preset.color;
  subtitleStrokeSize.value = preset.strokeSize;
  subtitleStrokeColor.value = preset.strokeColor;
}

// 主页字幕样式入口右侧逐行展示当前样式：字体 / 字号 / 字色 / 描边
interface SubtitleStyleSummaryRow {
  label: string;
  text?: string;
  // 当存在 colors 时，按顺序渲染色块；最后一项可能跟着辅助文字（如描边粗细）
  colors?: string[];
}

const subtitleStyleSummaryRows = computed<SubtitleStyleSummaryRow[]>(() => {
  const rows: SubtitleStyleSummaryRow[] = [];
  rows.push({ label: "字体", text: selectedFont.value.label });
  rows.push({ label: "字号", text: `${subtitleFontSize.value}px` });
  rows.push({ label: "字色", colors: [subtitleColor.value] });

  if (subtitleStrokeSize.value > 0) {
    rows.push({
      label: "描边",
      text: `${subtitleStrokeSize.value.toFixed(1)}px`,
      colors: [subtitleStrokeColor.value],
    });
  } else {
    rows.push({ label: "描边", text: "无" });
  }

  return rows;
});

// === 画中画入口相关 ===
const { assets: pipAssets, openPipModal } = usePictureInPicture();

// 字幕识别完成前，字幕样式 / 画中画两个入口都不可用
const hasRecognizedSubtitles = computed(() => subtitleRows.value.length > 0);

// === 渲染生成视频已移至 ExportColumn ===

function ensureSubtitlesReady(): boolean {
  if (!hasRecognizedSubtitles.value) {
    ElMessage.warning("请先进行字幕识别");
    return false;
  }
  return true;
}

function handleOpenStyleModal(): void {
  if (!ensureSubtitlesReady()) {
    return;
  }
  openStyleModal();
}

function handleOpenPipModal(): void {
  if (!ensureSubtitlesReady()) {
    return;
  }
  openPipModal(activeSubtitleId.value);
}

// 把当前字幕样式打包传给画中画弹窗，预览处保持与字幕样式一致
const pipSubtitleStyleSnapshot = computed(() => ({
  fontId: selectedFontId.value,
  fontSize: subtitleFontSize.value,
  color: subtitleColor.value,
  strokeSize: subtitleStrokeSize.value,
  strokeColor: subtitleStrokeColor.value,
}));

// 主页画中画入口的概览统计
const pipImageCount = computed(
  () => pipAssets.value.filter((asset) => asset.kind === "image").length,
);
const pipVideoCount = computed(
  () => pipAssets.value.filter((asset) => asset.kind === "video").length,
);
const pipCoveredSubtitleCount = computed(() => {
  // 同一个资源可能挂在多个字幕段上；用集合去重
  const subtitleIds = new Set<string>();
  pipAssets.value.forEach((asset) => {
    asset.subtitleIds.forEach((id) => {
      subtitleIds.add(id);
    });
  });
  return subtitleIds.size;
});

// chip 上 “T” 矢量图形所在 SVG 的视觉尺寸（CSS 像素）。
// 这里同时作为描边视觉放大的基准：预览时字号是 10px，chip 上 T 是 28px，
// 把预设里 0.2~0.5px 的描边按 28/10 比例放大，chip 上才能看得出来。
const stylePresetChipFontSize = 28;

function getStylePresetChipStyle(preset: SubtitleStylePreset): {
  fill: string;
  stroke: string;
  strokeWidth: number;
} {
  // 描边为 0 时，chip 上仅展示填充色，不画描边
  if (preset.strokeSize <= 0) {
    return {
      fill: preset.color,
      stroke: "none",
      strokeWidth: 0,
    };
  }

  const scaleRatio = stylePresetChipFontSize / preset.fontSize;
  return {
    fill: preset.color,
    stroke: preset.strokeColor,
    strokeWidth: preset.strokeSize * scaleRatio,
  };
}

// 预览视频的当前播放时间（秒），由 timeupdate 事件驱动，用于同步字幕展示
const previewCurrentTime = ref(0);
const previewVideoRef = ref<HTMLVideoElement | null>(null);

// 没有匹配到字幕段落时展示的预设文字（如视频开头到首段字幕出现前的空白时间）
const previewFallbackSubtitleText = "预设字幕参考文字";

// 根据当前播放时间匹配字幕段落；未匹配到时回退到预设文字
const previewSubtitleText = computed(() => {
  const time = previewCurrentTime.value;
  const matched = subtitleList.value.find(
    (item) => time >= item.start && time <= item.end,
  );

  if (matched) {
    return matched.text;
  }

  return previewFallbackSubtitleText;
});

// 当前命中的字幕段落 ID，便于在样式弹窗的字幕列表里高亮指示
const activeSubtitleId = computed(() => {
  const time = previewCurrentTime.value;
  return (
    subtitleList.value.find((item) => time >= item.start && time <= item.end)
      ?.id ?? ""
  );
});

const previewSubtitleBaseStyle = computed(() => ({
  fontFamily: `'${selectedFont.value.fontFamily}', sans-serif`,
  fontSize: `${subtitleFontSize.value}px`,
  // 保留字幕中的换行（\n），多行内容按用户编辑结果在预览里逐行展示
  whiteSpace: "pre-line",
}));
const previewSubtitleFillStyle = computed(() => ({
  ...previewSubtitleBaseStyle.value,
  color: subtitleColor.value,
  WebkitTextFillColor: subtitleColor.value,
  WebkitTextStrokeWidth: "0px",
}));
const previewSubtitleStrokeStyle = computed(() => ({
  ...previewSubtitleBaseStyle.value,
  color: "transparent",
  WebkitTextFillColor: "transparent",
  WebkitTextStrokeColor: subtitleStrokeColor.value,
  WebkitTextStrokeWidth: `${subtitleStrokeSize.value}px`,
}));

function openStyleModal(): void {
  previewCurrentTime.value = 0;
  isStyleModalOpen.value = true;

  // 弹窗里的字幕列表与第五步共用数据，但 textarea 是新挂载的实例，需要等渲染后单独撑开高度
  void nextTick(() => {
    applySubtitleAutosize();
  });
}

function autosizeSubtitleTextarea(textarea: HTMLTextAreaElement): void {
  // 根据内容自适应高度：先重置，再按 scrollHeight 撑开
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function onSubtitleTextInput(id: string, event: Event): void {
  const textarea = event.target as HTMLTextAreaElement;
  autosizeSubtitleTextarea(textarea);
  updateSubtitleText(id, textarea.value);
}

function applySubtitleAutosize(): void {
  // 列表渲染或字幕重置后批量校正高度，确保多行内容首次就能完整展示
  // 第五步字幕列表与样式弹窗内的字幕列表共用同一函数，统一遍历两处
  const textareas = document.querySelectorAll<HTMLTextAreaElement>(
    ".subtitle-list .subtitle-text-input, .style-subtitle-list .subtitle-text-input",
  );
  textareas.forEach((textarea) => autosizeSubtitleTextarea(textarea));
}

function closeStyleModal(): void {
  // 关闭弹窗时暂停视频，避免后台仍在播放
  if (previewVideoRef.value) {
    previewVideoRef.value.pause();
  }

  isStyleModalOpen.value = false;
}

function handlePreviewTimeUpdate(event: Event): void {
  const videoElement = event.target as HTMLVideoElement | null;
  if (videoElement) {
    previewCurrentTime.value = videoElement.currentTime;
  }
}

function handlePreviewSeeked(event: Event): void {
  const videoElement = event.target as HTMLVideoElement | null;
  if (videoElement) {
    previewCurrentTime.value = videoElement.currentTime;
  }
}

onMounted(() => {
  const storedConfig = window.localStorage.getItem(subtitleStyleStorageKey);
  if (storedConfig) {
    try {
      const parsedConfig = JSON.parse(storedConfig) as Partial<{
        fontSize: number;
        fontColor: string;
        fontId: string;
        // 兼容旧版本写入的字段名
        fontName: string;
        strokeColor: string;
        strokeSize: number;
      }>;

      if (typeof parsedConfig.fontSize === "number") {
        subtitleFontSize.value = parsedConfig.fontSize;
      }
      if (typeof parsedConfig.fontColor === "string") {
        subtitleColor.value = parsedConfig.fontColor;
      }
      if (typeof parsedConfig.fontId === "string") {
        selectedFontId.value = parsedConfig.fontId;
      } else if (typeof parsedConfig.fontName === "string") {
        // 旧版本里存的是 fontFamily，按它反查 ID；找不到则使用默认值
        const matched = SUBTITLE_FONT_OPTIONS.find(
          (option) => option.fontFamily === parsedConfig.fontName,
        );
        if (matched) {
          selectedFontId.value = matched.id;
        }
      }
      if (typeof parsedConfig.strokeColor === "string") {
        subtitleStrokeColor.value = parsedConfig.strokeColor;
      }
      if (typeof parsedConfig.strokeSize === "number") {
        // 描边范围调整为 0~1，旧版本可能存了更大的值，这里夹一下避免显示与滑动条不一致
        subtitleStrokeSize.value = Math.min(
          1,
          Math.max(0, parsedConfig.strokeSize),
        );
      }
    } catch {
      window.localStorage.removeItem(subtitleStyleStorageKey);
    }
  }

  if (
    !fontOptions.length ||
    document.querySelector('style[data-subtitle-fonts="true"]')
  ) {
    return;
  }

  const styleElement = document.createElement("style");
  styleElement.dataset.subtitleFonts = "true";
  styleElement.textContent = fontOptions
    .map(
      (font) => `
@font-face {
  font-family: '${font.fontFamily}';
  src: url('${font.url}');
  font-display: swap;
}`,
    )
    .join("\n");
  document.head.appendChild(styleElement);
});

watch(
  [
    subtitleFontSize,
    subtitleColor,
    selectedFontId,
    subtitleStrokeSize,
    subtitleStrokeColor,
  ],
  () => {
    window.localStorage.setItem(
      subtitleStyleStorageKey,
      JSON.stringify({
        fontColor: subtitleColor.value,
        fontId: selectedFontId.value,
        fontSize: subtitleFontSize.value,
        strokeColor: subtitleStrokeColor.value,
        strokeSize: subtitleStrokeSize.value,
      }),
    );
  },
  { deep: false },
);

// 字幕数据变化（识别完成、文案重置）后，需要等 DOM 更新再批量校准 textarea 高度
watch(
  subtitleRows,
  () => {
    void nextTick(() => {
      applySubtitleAutosize();
    });
  },
  { deep: true },
);
</script>

<template>
  <article class="feature-column">
    <div class="column-body subtitle-tool">
      <SubtitleRecognitionSection />

      <div
        class="subtitle-style-entry"
        :class="{ 'is-disabled': !hasRecognizedSubtitles }"
      >
        <button
          class="subtitle-style-icon-button"
          type="button"
          aria-label="字幕样式"
          :title="hasRecognizedSubtitles ? '字幕样式' : '请先进行字幕识别'"
          :disabled="!hasRecognizedSubtitles"
          @click="handleOpenStyleModal"
        >
          <EditPen />
          <span>字幕样式</span>
        </button>
        <div class="subtitle-style-summary" aria-label="当前字幕样式">
          <div
            v-for="row in subtitleStyleSummaryRows"
            :key="row.label"
            class="subtitle-style-summary-row"
          >
            <span class="subtitle-style-summary-label">{{ row.label }}</span>
            <span class="subtitle-style-summary-value">
              <template v-if="row.colors">
                <span
                  v-for="color in row.colors"
                  :key="color"
                  class="subtitle-style-summary-color"
                  :style="{ backgroundColor: color }"
                  :aria-label="color"
                ></span>
              </template>
              <span v-if="row.text" class="subtitle-style-summary-text">{{
                row.text
              }}</span>
            </span>
          </div>
        </div>
      </div>

      <div
        class="subtitle-style-entry"
        :class="{ 'is-disabled': !hasRecognizedSubtitles }"
      >
        <button
          class="subtitle-style-icon-button"
          type="button"
          aria-label="画中画"
          :title="hasRecognizedSubtitles ? '画中画' : '请先进行字幕识别'"
          :disabled="!hasRecognizedSubtitles"
          @click="handleOpenPipModal"
        >
          <Picture />
          <span>画中画</span>
        </button>
        <div
          class="subtitle-style-summary subtitle-pip-summary"
          aria-label="画中画概览"
        >
          <div class="subtitle-style-summary-row">
            <span class="subtitle-style-summary-label">总数</span>
            <span class="subtitle-style-summary-value">
              <span class="subtitle-style-summary-text"
                >{{ pipAssets.length }} 个素材</span
              >
            </span>
          </div>
          <div class="subtitle-style-summary-row">
            <span class="subtitle-style-summary-label">图片</span>
            <span class="subtitle-style-summary-value">
              <span class="subtitle-style-summary-text">{{
                pipImageCount
              }}</span>
            </span>
          </div>
          <div class="subtitle-style-summary-row">
            <span class="subtitle-style-summary-label">视频</span>
            <span class="subtitle-style-summary-value">
              <span class="subtitle-style-summary-text">{{
                pipVideoCount
              }}</span>
            </span>
          </div>
          <div class="subtitle-style-summary-row">
            <span class="subtitle-style-summary-label">字幕</span>
            <span class="subtitle-style-summary-value">
              <span class="subtitle-style-summary-text"
                >已覆盖 {{ pipCoveredSubtitleCount }} /
                {{ subtitleRows.length }} 段</span
              >
            </span>
          </div>
        </div>
      </div>
    </div>

    <PictureInPictureModal
      :video-src="previewVideoSrc"
      :subtitle-rows="subtitleRows"
      :subtitle-style="pipSubtitleStyleSnapshot"
      :initial-active-subtitle-id="activeSubtitleId"
    />

    <teleport to="body">
      <div v-if="isStyleModalOpen" class="modal-backdrop">
        <section
          class="style-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="subtitle-style-title"
        >
          <header class="modal-header">
            <div>
              <h2 id="subtitle-style-title">字幕样式配置</h2>
              <p class="style-modal-subtitle">
                在放大预览中直接调整字体、颜色和描边效果
              </p>
            </div>
            <button
              class="icon-button"
              type="button"
              aria-label="关闭字幕样式配置"
              @click="closeStyleModal"
            >
              ×
            </button>
          </header>

          <div class="style-modal-body">
            <section class="style-modal-config">
              <div class="style-panel">
                <label
                  class="style-field style-field-inline style-preset-field"
                >
                  <span>预设</span>
                  <div
                    class="style-preset-row"
                    role="radiogroup"
                    aria-label="字幕样式预设"
                  >
                    <button
                      v-for="preset in stylePresets"
                      :key="preset.id"
                      type="button"
                      class="style-preset-chip"
                      :class="{
                        'is-active': activeStylePresetId === preset.id,
                      }"
                      role="radio"
                      :aria-checked="activeStylePresetId === preset.id"
                      :title="preset.label"
                      @click="applyStylePreset(preset)"
                    >
                      <svg
                        class="style-preset-chip-icon"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        :stroke-width="
                          getStylePresetChipStyle(preset).strokeWidth
                        "
                        :stroke="getStylePresetChipStyle(preset).stroke"
                        :fill="getStylePresetChipStyle(preset).fill"
                        stroke-linejoin="round"
                        stroke-linecap="round"
                      >
                        <!--
                          “工字 T” 路径：横竖笔画粗细一致（均为 6 个 SVG 单位）
                          - 顶部横笔画：高 6（y=3 → y=9），宽 18（x=3 → x=21）
                          - 中间竖笔画：宽 6（x=9 → x=15），高 12（y=9 → y=21）
                          通过同一条 path 的 fill + stroke 同步控制填充与描边
                        -->
                        <path d="M3 3 H21 V9 H15 V21 H9 V9 H3 Z" />
                      </svg>
                    </button>
                  </div>
                </label>

                <label class="style-field style-field-inline">
                  <span>字体</span>
                  <select v-model="selectedFontId">
                    <option
                      v-for="font in fontOptions"
                      :key="font.id"
                      :value="font.id"
                    >
                      {{ font.label }}
                    </option>
                  </select>
                </label>

                <label class="style-field style-field-inline">
                  <span>字号</span>
                  <div class="range-control">
                    <input
                      v-model.number="subtitleFontSize"
                      type="range"
                      min="10"
                      max="64"
                      step="1"
                    />
                    <strong>{{ subtitleFontSize }}px</strong>
                  </div>
                </label>

                <label class="style-field style-field-inline">
                  <span>颜色</span>
                  <div class="color-control">
                    <input v-model="subtitleColor" type="color" />
                    <span>{{ subtitleColor }}</span>
                  </div>
                </label>

                <label class="style-field style-field-inline">
                  <span>描边</span>
                  <div class="color-control">
                    <input v-model="subtitleStrokeColor" type="color" />
                    <span>{{ subtitleStrokeColor }}</span>
                  </div>
                </label>

                <label class="style-field style-field-inline">
                  <span>粗细</span>
                  <div class="range-control">
                    <input
                      v-model.number="subtitleStrokeSize"
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                    />
                    <strong>{{ subtitleStrokeSize.toFixed(1) }}px</strong>
                  </div>
                </label>
              </div>

              <div class="style-panel style-subtitle-list-panel">
                <h3>字幕列表</h3>

                <div v-if="subtitleRows.length" class="style-subtitle-list">
                  <article
                    v-for="row in subtitleRows"
                    :key="row.id"
                    class="subtitle-row style-subtitle-row"
                    :class="{ 'is-active': row.id === activeSubtitleId }"
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
                <div v-else class="style-subtitle-empty">
                  暂无字幕数据，请先在第五步完成字幕时间轴识别
                </div>
              </div>
            </section>

            <section class="style-modal-preview">
              <div class="style-preview-stage">
                <div class="preview-canvas">
                  <video
                    ref="previewVideoRef"
                    class="preview-video"
                    :src="previewVideoSrc"
                    controls
                    playsinline
                    controlsList="nodownload nofullscreen noplaybackrate noremoteplayback"
                    disablePictureInPicture
                    @timeupdate="handlePreviewTimeUpdate"
                    @seeked="handlePreviewSeeked"
                  ></video>
                  <div
                    v-if="previewSubtitleText"
                    class="preview-subtitle preview-subtitle-stroke"
                    :style="previewSubtitleStrokeStyle"
                  >
                    {{ previewSubtitleText }}
                  </div>
                  <div
                    v-if="previewSubtitleText"
                    class="preview-subtitle preview-subtitle-fill"
                    :style="previewSubtitleFillStyle"
                  >
                    {{ previewSubtitleText }}
                  </div>
                </div>
              </div>
            </section>
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

.subtitle-tool {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
}

/* 让第五步字幕时间轴识别撑满剩余空间，使本列底边与其它列对齐 */
.subtitle-tool :deep(.subtitle-recognition-section) {
  flex: 1 1 auto;
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

.tool-field,
.style-field,
.field {
  display: grid;
  gap: 6px;
}

.style-field-inline {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}

.style-field-inline > span {
  margin: 0;
}

/* 预设字段右侧是多枚 chip，需要从顶部对齐（chip 可能换行），并让标签不偏到中间 */
.style-preset-field {
  align-items: start;
}

.style-preset-field > span {
  /* chip 高度 36px，让 “预设” 文字与 chip 视觉中线对齐 */
  padding-top: 8px;
}

.tool-field > span,
.style-field > span,
.field > span {
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.audio-url-field {
  display: grid;
  gap: 6px;
}

.audio-url-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.audio-url-mode {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.audio-url-mode-text {
  color: #94a3b8;
  font-size: 11px;
  font-weight: 400;
}

.audio-url-field input[readonly] {
  color: #64748b;
  background: #f8fafc;
  cursor: default;
}

.audio-url-field input[readonly]:focus {
  border-color: #cbd5e1;
  box-shadow: none;
}

.url-input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
}

.url-input-row input[type="text"] {
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

.url-input-row input[type="text"]:focus {
  border-color: #2a6f97;
  box-shadow: 0 0 0 3px rgba(42, 111, 151, 0.12);
}

.url-file-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  padding: 0 12px;
  border: 1px dashed #9bb1c8;
  border-radius: 6px;
  color: #4b5d73;
  background: #f8fbfd;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.url-file-button:hover {
  border-color: #2a6f97;
  color: #2a6f97;
  background: #eef7fb;
}

.url-file-button.is-loading {
  opacity: 0.6;
  cursor: wait;
}

.url-file-button:disabled {
  opacity: 0.6;
  cursor: wait;
}

.test-audio-field input,
.audio-url-field input,
.style-field select,
.field input {
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

.test-audio-field input:focus,
.audio-url-field input:focus,
.style-field select:focus,
.field input:focus {
  border-color: #2a6f97;
  box-shadow: 0 0 0 3px rgba(42, 111, 151, 0.12);
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
  flex: 1 1 auto;
  height: auto;
  min-height: 360px;
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

.subtitle-style-entry {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  align-items: stretch;
  gap: 8px;
}

.subtitle-style-icon-button {
  width: 100%;
  /* 高度由网格行决定，与右侧摘要面板保持一致 */
  height: 100%;
  min-height: 84px;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  color: #475569;
  background: #ffffff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    color 0.18s ease,
    background 0.18s ease;
}

.subtitle-style-icon-button:hover {
  border-color: #2a6f97;
  color: #2a6f97;
  background: #f2f7fb;
}

.subtitle-style-icon-button:disabled,
.subtitle-style-icon-button:disabled:hover {
  border-color: #e2e8f0;
  color: #94a3b8;
  background: #f8fafc;
  cursor: not-allowed;
}

.subtitle-style-entry.is-disabled .subtitle-style-summary {
  color: #94a3b8;
  background: #f1f5f9;
}

.subtitle-style-icon-button svg {
  width: 18px;
  height: 18px;
}

.subtitle-style-icon-button > span {
  line-height: 1;
  font-size: 13px;
}

.subtitle-style-summary {
  min-width: 0;
  display: grid;
  grid-template-rows: repeat(4, 1fr);
  align-items: stretch;
  padding: 6px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  color: #475569;
  background: #f8fafc;
  font-size: 12px;
  cursor: default;
}

.subtitle-style-summary:hover {
  border-color: #cbd5e1;
}

.subtitle-style-summary-row {
  min-width: 0;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}

.subtitle-style-summary-row + .subtitle-style-summary-row {
  border-top: 1px dashed #e2e8f0;
}

.subtitle-style-summary-label {
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
}

.subtitle-style-summary-value {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #172033;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.subtitle-style-summary-color {
  width: 16px;
  height: 16px;
  display: inline-block;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  flex: 0 0 auto;
}

.subtitle-style-summary-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.range-control,
.color-control {
  min-width: 0;
  min-height: 30px;
  display: grid;
  align-items: center;
  gap: 8px;
}

.range-control {
  grid-template-columns: minmax(0, 1fr) 44px;
}

.range-control input {
  width: 100%;
  margin: 0;
}

.range-control strong,
.color-control span {
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
}

.color-control {
  grid-template-columns: 42px minmax(0, 1fr);
}

.color-control input[type="color"] {
  width: 42px;
  height: 28px;
  padding: 2px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #ffffff;
}

.preview-canvas {
  position: relative;
  width: 270px;
  height: 480px;
  overflow: hidden;
  /* border-radius: 6px; */
  background-color: #111827;
}

.preview-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
  background: #0f172a;
}

.preview-canvas::after {
  content: "";
  position: absolute;
  inset: auto 0 0;
  height: 58%;
  background: linear-gradient(
    180deg,
    rgba(15, 23, 42, 0),
    rgba(15, 23, 42, 0.58)
  );
  pointer-events: none;
  z-index: 1;
}

.preview-subtitle {
  position: absolute;
  right: 10px;
  bottom: 20%;
  left: 10px;
  text-align: center;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.72);
  pointer-events: none;
}

.preview-subtitle-stroke {
  z-index: 2;
}

.preview-subtitle-fill {
  z-index: 3;
}

.style-modal {
  width: min(94vw, 820px);
  height: min(92vh, 680px);
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 28px 80px rgba(15, 23, 42, 0.28);
}

.style-modal-subtitle {
  margin: 4px 0 0;
  color: #718096;
  font-size: 12px;
  line-height: 1.5;
}

.style-modal-body {
  min-height: 0;
  display: grid;
  grid-template-columns: 500px 320px;
  gap: 0;
  flex: 1;
}

.style-modal-config {
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 14px;
  padding: 18px;
  overflow: auto;
  background: linear-gradient(
    180deg,
    rgba(248, 250, 252, 0.98),
    rgba(255, 255, 255, 0.96)
  );
}

.style-panel {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid #dbe4ee;
  border-radius: 8px;
  background: #ffffff;
}

.style-preset-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.style-preset-chip {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid #4b5364;
  border-radius: 8px;
  /* 中性偏亮的灰，让黑色和白色描边都能保持足够对比度 */
  background: #5c6577;
  color: #ffffff;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    transform 0.18s ease;
}

.style-preset-chip:hover {
  transform: translateY(-1px);
}

.style-preset-chip.is-active {
  border-color: #2a6f97;
  box-shadow: 0 0 0 3px rgba(42, 111, 151, 0.22);
}

.style-preset-chip-icon {
  width: 22px;
  height: 22px;
  display: block;
  /* fill / stroke / stroke-width 由模板上的 SVG 属性绑定控制 */
  overflow: visible;
}

.style-panel h3 {
  margin: 0;
  color: #172033;
  font-size: 13px;
}

.style-subtitle-list-panel {
  min-height: 0;
  padding: 0;
  border: 0;
  background: transparent;
}

.style-subtitle-list {
  max-height: 320px;
  display: grid;
  align-content: start;
  gap: 6px;
  overflow: auto;
  padding-right: 4px;
}

.style-subtitle-row.is-active .subtitle-time {
  border-color: #2a6f97;
  color: #ffffff;
  background: #2a6f97;
}

.style-subtitle-row.is-active .subtitle-text-input {
  border-color: #2a6f97;
  box-shadow: 0 0 0 3px rgba(42, 111, 151, 0.12);
}

.style-subtitle-empty {
  padding: 18px 12px;
  border: 1px dashed #cbd5e1;
  border-radius: 6px;
  color: #94a3b8;
  background: #f8fafc;
  font-size: 12px;
  text-align: center;
}

.style-modal-preview {
  min-height: 0;
  display: grid;
  place-items: center;
  padding: 18px;
  border-left: 1px solid #e1e7ef;
  background: #f4f7fb;
}

.style-preview-stage {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: transparent;
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
  line-height: 1.2;
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

.field select:disabled {
  color: #64748b;
  background: #f8fafc;
  cursor: default;
}

.field input[readonly] {
  color: #64748b;
  background: #f8fafc;
  cursor: default;
}

.field input[readonly]:focus {
  border-color: #cbd5e1;
  box-shadow: none;
}

.config-tip {
  margin: 0;
  color: #60728a;
  font-size: 12px;
  line-height: 1.6;
}

.config-tip a {
  color: #2a6f97;
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

@media (max-width: 760px) {
  .tool-actions {
    grid-template-columns: 1fr;
  }

  .subtitle-row {
    grid-template-columns: 1fr;
  }

  .style-modal-body {
    grid-template-columns: 1fr;
  }

  .style-modal-preview {
    border-left: 0;
    border-top: 1px solid #e1e7ef;
  }
}
</style>
