import { ElMessage } from "element-plus";
import { computed, ref } from "vue";
import type {
  PipAsset,
  PipAssetKind,
  PipHistoryEntry,
  SavePipHistoryPayload,
} from "@/types/picture-in-picture";

/**
 * 画中画功能共享状态
 *
 * 关键设计：
 * - 资源 PipAsset.subtitleIds 是多对多关系，多个字幕段可以挂同一份资源
 * - 编辑态用 editingSubtitleIds（数组）替代过去的单选 ID，UI 通过多选 checkbox 控制
 * - 素材仅支持本地上传（可从历史素材复用），已移除 AI 生图能力
 */

let sharedState: ReturnType<typeof usePictureInPictureImpl> | null = null;

function generatePipAssetId(): string {
  return `pip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getDefaultRegion(kind: PipAssetKind): PipAsset["region"] {
  if (kind === "video") {
    return { x: 60, y: 35, width: 32, height: 28 };
  }
  return { x: 8, y: 35, width: 32, height: 28 };
}

function usePictureInPictureImpl() {
  const assets = ref<PipAsset[]>([]);
  const selectedAssetId = ref<string>("");
  const isPipModalOpen = ref(false);
  /** 当前编辑的字幕段 ID 集合：上传的资源会同时绑定到这些字幕段 */
  const editingSubtitleIds = ref<string[]>([]);
  /** 历史素材列表（来自 userData/pip-history/history.json） */
  const historyEntries = ref<PipHistoryEntry[]>([]);

  /**
   * 按字幕段聚合资源数组：用于左栏徽章统计、画布预览等场景
   */
  const assetsBySubtitleId = computed(() => {
    const grouped = new Map<string, PipAsset[]>();
    assets.value.forEach((asset) => {
      asset.subtitleIds.forEach((subtitleId) => {
        const list = grouped.get(subtitleId) ?? [];
        list.push(asset);
        grouped.set(subtitleId, list);
      });
    });
    return grouped;
  });

  /**
   * 当前编辑范围内涉及的资源（去重）：
   * - 选中多个字幕段时，命中任意一段都纳入
   * - 一份资源即便被多次匹配，最终也只在编辑器里出现一次
   */
  const editingAssets = computed<PipAsset[]>(() => {
    if (editingSubtitleIds.value.length === 0) {
      return [];
    }
    const editingSet = new Set(editingSubtitleIds.value);
    return assets.value.filter((asset) =>
      asset.subtitleIds.some((id) => editingSet.has(id)),
    );
  });

  function openPipModal(initialSubtitleId = ""): void {
    editingSubtitleIds.value = initialSubtitleId ? [initialSubtitleId] : [];
    selectedAssetId.value = "";
    isPipModalOpen.value = true;
  }

  function closePipModal(): void {
    isPipModalOpen.value = false;
  }

  /** 切换某个字幕段的选中状态（用于 checkbox） */
  function toggleSubtitleSelection(subtitleId: string): void {
    const index = editingSubtitleIds.value.indexOf(subtitleId);
    if (index === -1) {
      editingSubtitleIds.value.push(subtitleId);
    } else {
      editingSubtitleIds.value.splice(index, 1);
    }
    selectedAssetId.value = "";
  }

  /** 一次性设置选中范围（不存在则添加，存在则保留） */
  function setSubtitleSelection(subtitleIds: string[]): void {
    editingSubtitleIds.value = [...subtitleIds];
    selectedAssetId.value = "";
  }

  function selectAsset(assetId: string): void {
    selectedAssetId.value = assetId;
  }

  function ensureEditingSelection(): boolean {
    if (editingSubtitleIds.value.length === 0) {
      ElMessage.warning("请先在左侧勾选需要编辑的字幕段（可以多选）");
      return false;
    }
    return true;
  }

  /**
   * 拉取本地历史素材列表（按时间倒序），首次进入弹窗或保存/删除后调用
   */
  async function refreshHistory(): Promise<void> {
    try {
      const list =
        (await window.desktopApi.listPipHistory()) as PipHistoryEntry[];
      historyEntries.value = Array.isArray(list) ? list : [];
    } catch {
      // 历史读取失败时保持现有内存列表，不阻塞主流程
    }
  }

  /**
   * 把一段二进制内容写入本地，并把元数据加进 history.json
   * 返回写入后得到的历史条目
   */
  async function persistAssetToHistory(
    payload: SavePipHistoryPayload,
  ): Promise<PipHistoryEntry | null> {
    try {
      const entry = (await window.desktopApi.savePipHistory(
        payload,
      )) as PipHistoryEntry;
      historyEntries.value = [entry, ...historyEntries.value];
      return entry;
    } catch (error) {
      ElMessage.error(
        error instanceof Error ? error.message : "保存历史素材失败",
      );
      return null;
    }
  }

  /**
   * 从历史条目复用为新的 PipAsset，绑定到当前选中的字幕段
   */
  function reuseHistoryEntry(entry: PipHistoryEntry): void {
    if (!ensureEditingSelection()) {
      return;
    }
    const asset: PipAsset = {
      id: generatePipAssetId(),
      kind: entry.kind,
      origin: entry.origin,
      url: entry.url,
      naturalSize: entry.naturalSize,
      region: getDefaultRegion(entry.kind),
      subtitleIds: [...editingSubtitleIds.value],
      label: entry.fileName,
    };
    assets.value.push(asset);
    selectedAssetId.value = asset.id;
  }

  async function deleteHistoryEntry(id: string): Promise<void> {
    try {
      await window.desktopApi.deletePipHistory(id);
      historyEntries.value = historyEntries.value.filter(
        (entry) => entry.id !== id,
      );
    } catch (error) {
      ElMessage.error(
        error instanceof Error ? error.message : "删除历史素材失败",
      );
    }
  }

  async function addUploadedAsset(file: File): Promise<void> {
    if (!ensureEditingSelection()) {
      return;
    }

    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");

    if (!isImage && !isVideo) {
      ElMessage.warning("仅支持图片或视频文件");
      return;
    }

    const kind: PipAssetKind = isImage ? "image" : "video";

    // 先把上传内容落地到 userData/pip-history 下，得到稳定 url
    const arrayBuffer = await file.arrayBuffer();
    const entry = await persistAssetToHistory({
      kind,
      origin: "upload",
      fileName: file.name,
      mimeType: file.type || (kind === "image" ? "image/png" : "video/mp4"),
      arrayBuffer,
    });
    if (!entry) {
      return;
    }

    const asset: PipAsset = {
      id: generatePipAssetId(),
      kind,
      origin: "upload",
      url: entry.url,
      region: getDefaultRegion(kind),
      subtitleIds: [...editingSubtitleIds.value],
      label: file.name,
    };

    assets.value.push(asset);
    selectedAssetId.value = asset.id;
  }

  function updateAssetRegion(
    assetId: string,
    region: PipAsset["region"],
  ): void {
    const target = assets.value.find((asset) => asset.id === assetId);
    if (!target) {
      return;
    }
    target.region = region;
  }

  /**
   * 资源加载完成后回填原始宽高，并把画框 height 调整成与素材同比，
   * 后续缩放也基于这个原始比例做等比放缩，避免裁切素材。
   */
  function applyAssetNaturalSize(
    assetId: string,
    naturalWidth: number,
    naturalHeight: number,
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    const target = assets.value.find((asset) => asset.id === assetId);
    if (
      !target ||
      !canvasWidth ||
      !canvasHeight ||
      !naturalWidth ||
      !naturalHeight
    ) {
      return;
    }

    if (
      target.naturalSize &&
      target.naturalSize.width === naturalWidth &&
      target.naturalSize.height === naturalHeight
    ) {
      return;
    }

    target.naturalSize = { width: naturalWidth, height: naturalHeight };

    // 画框像素宽高比 = 画布宽高 * region 百分比；要让画框比例 == 素材比例：
    // (region.width * canvasWidth) / (region.height * canvasHeight) == naturalWidth / naturalHeight
    // 解得 region.height = (region.width * canvasWidth * naturalHeight) / (canvasHeight * naturalWidth)
    const assetAspect = naturalWidth / naturalHeight;
    const desiredHeight =
      (target.region.width * canvasWidth) / (canvasHeight * assetAspect);
    const clampedHeight = Math.min(desiredHeight, 100 - target.region.y);
    target.region = {
      ...target.region,
      height: clampedHeight,
    };
  }

  /** 修改资源覆盖的字幕段集合（左栏多选 chip 上的“同步到选中字幕”操作） */
  function updateAssetSubtitles(assetId: string, subtitleIds: string[]): void {
    const target = assets.value.find((asset) => asset.id === assetId);
    if (!target) {
      return;
    }
    target.subtitleIds = [...subtitleIds];
  }

  function removeAsset(assetId: string): void {
    const index = assets.value.findIndex((asset) => asset.id === assetId);
    if (index === -1) {
      return;
    }

    const asset = assets.value[index];
    if (asset.url.startsWith("blob:")) {
      URL.revokeObjectURL(asset.url);
    }

    assets.value.splice(index, 1);
    if (selectedAssetId.value === assetId) {
      selectedAssetId.value = "";
    }
  }

  function clearAssets(): void {
    assets.value.forEach((asset) => {
      if (asset.url.startsWith("blob:")) {
        URL.revokeObjectURL(asset.url);
      }
    });
    assets.value = [];
    selectedAssetId.value = "";
  }

  return {
    addUploadedAsset,
    applyAssetNaturalSize,
    assets,
    assetsBySubtitleId,
    clearAssets,
    closePipModal,
    deleteHistoryEntry,
    editingAssets,
    editingSubtitleIds,
    historyEntries,
    isPipModalOpen,
    openPipModal,
    refreshHistory,
    removeAsset,
    reuseHistoryEntry,
    selectAsset,
    selectedAssetId,
    setSubtitleSelection,
    toggleSubtitleSelection,
    updateAssetRegion,
    updateAssetSubtitles,
  };
}

export function usePictureInPicture() {
  if (!sharedState) {
    sharedState = usePictureInPictureImpl();
  }
  return sharedState;
}
