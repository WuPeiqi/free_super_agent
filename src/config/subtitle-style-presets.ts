/**
 * 字幕样式预设配置
 *
 * 这里集中维护字幕的常用样式预设，方便用户在字幕样式弹窗里一键切换。
 * 后续如果需要调整顺序、增删预设，只需要修改下方数组即可，
 * 组件会自动按数组顺序渲染。
 *
 * 字段说明：
 * - id：稳定标识，会被持久化（如 localStorage）
 * - label：用于无障碍/标题展示的中文名
 * - fontId：对应 SUBTITLE_FONT_OPTIONS 中的字体 id
 * - fontSize：字号（px）
 * - color：填充色（HEX）
 * - strokeSize：描边粗细（px，0 表示无描边）
 * - strokeColor：描边色（HEX，无描边时仅用于配置形态完整）
 */

export interface SubtitleStylePreset {
  id: string;
  label: string;
  fontId: string;
  fontSize: number;
  color: string;
  strokeSize: number;
  strokeColor: string;
}

export const SUBTITLE_STYLE_PRESETS: SubtitleStylePreset[] = [
  {
    id: "plain-white",
    label: "白色无描边",
    fontId: "msyh",
    fontSize: 10,
    color: "#ffffff",
    strokeSize: 0,
    strokeColor: "#000000",
  },
  {
    id: "white-black-stroke",
    label: "白字黑描边",
    fontId: "msyh",
    fontSize: 10,
    color: "#ffffff",
    strokeSize: 0.2,
    strokeColor: "#000000",
  },
  {
    id: "black-white-stroke",
    label: "黑字白描边",
    fontId: "msyh",
    fontSize: 10,
    color: "#000000",
    strokeSize: 0.2,
    strokeColor: "#ffffff",
  },
  {
    id: "yellow-black-stroke",
    label: "黄字黑描边",
    fontId: "msyh",
    fontSize: 10,
    color: "#ffde00",
    strokeSize: 0.5,
    strokeColor: "#000000",
  },
  {
    id: "yellow-only",
    label: "黄字无描边",
    fontId: "msyh",
    fontSize: 10,
    color: "#ffde00",
    strokeSize: 0,
    strokeColor: "#000000",
  },
  {
    id: "red-black-stroke",
    label: "红字黑描边",
    fontId: "msyh",
    fontSize: 10,
    color: "#ff3b30",
    strokeSize: 0.5,
    strokeColor: "#000000",
  },
  {
    id: "cyan-black-stroke",
    label: "青字黑描边",
    fontId: "msyh",
    fontSize: 10,
    color: "#00e0ff",
    strokeSize: 0.5,
    strokeColor: "#000000",
  },
  {
    id: "green-black-stroke",
    label: "绿字黑描边",
    fontId: "msyh",
    fontSize: 10,
    color: "#22c55e",
    strokeSize: 0.5,
    strokeColor: "#000000",
  },
];

/**
 * 默认预设 ID，新用户首次打开字幕样式弹窗时会以此预设作为初始样式
 */
export const DEFAULT_SUBTITLE_STYLE_PRESET_ID = "plain-white";
