/**
 * 字幕可选字体配置
 *
 * 这里集中维护字幕功能所支持的全部字体，新增字体只需要：
 *   1. 把字体文件放入 `src/assets/fonts/`
 *   2. 在下方 `SUBTITLE_FONT_OPTIONS` 数组里追加一项即可
 *
 * 字段说明：
 * - id：稳定的英文标识，会写入 localStorage / 后端存储；切勿随意修改
 * - label：下拉框中展示的中文名
 * - fileName：字体文件名，用于后续通过 ffmpeg 烧制字幕时定位字体文件
 * - fontFamily：在 CSS @font-face / inline style 中实际使用的 font-family
 * - url：Vite 解析后的字体 URL，用于 Web 端预览渲染
 *
 * 后续接入 ffmpeg 烧制时，可以根据 `id` 找到对应配置，再通过 `fileName` 拼出
 * 实际磁盘上的字体路径（位于 `src/assets/fonts/<fileName>`）传给 ffmpeg。
 */

import msyhFontUrl from "@/assets/fonts/MSYH.TTC?url";
import msyhbdFontUrl from "@/assets/fonts/MSYHBD.TTC?url";
import simyouFontUrl from "@/assets/fonts/SIMYOU.TTF?url";

export interface SubtitleFontOption {
  id: string;
  label: string;
  fileName: string;
  fontFamily: string;
  url: string;
}

export const SUBTITLE_FONT_OPTIONS: SubtitleFontOption[] = [
  {
    id: "msyh",
    label: "微软雅黑（常规）",
    fileName: "MSYH.TTC",
    fontFamily: "subtitle-font-msyh",
    url: msyhFontUrl,
  },
  {
    id: "msyhbd",
    label: "微软雅黑（粗体）",
    fileName: "MSYHBD.TTC",
    fontFamily: "subtitle-font-msyhbd",
    url: msyhbdFontUrl,
  },
  {
    id: "simyou",
    label: "幼圆（常规）",
    fileName: "SIMYOU.TTF",
    fontFamily: "subtitle-font-simyou",
    url: simyouFontUrl,
  },
];

/**
 * 默认字体 ID，新用户首次打开字幕样式时会选中这一项
 */
export const DEFAULT_SUBTITLE_FONT_ID = "msyh";

/**
 * 根据 ID 获取对应的字体配置；找不到时返回默认字体配置
 */
export function getSubtitleFontOption(id: string): SubtitleFontOption {
  const matched = SUBTITLE_FONT_OPTIONS.find((option) => option.id === id);
  if (matched) {
    return matched;
  }

  const fallback = SUBTITLE_FONT_OPTIONS.find(
    (option) => option.id === DEFAULT_SUBTITLE_FONT_ID,
  );
  return fallback ?? SUBTITLE_FONT_OPTIONS[0];
}
