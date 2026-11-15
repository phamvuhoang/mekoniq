import type { LabProject, Locale, RunSnapshot, RunEvent } from "./shared/types";
import { defaultProject } from "./project/default";
import { ProjectStore } from "./project/store";
import { MAX_WORLD_SIZE } from "./project/schema";
import { summarizeDesign } from "./design/catalog";
import { validateWorld } from "./world/validation";
import { summarizeReport, openReplay } from "./reports/metrics";
import { buildBundle } from "./deployment/bundle";
import * as runtime from "./runtime/client";
import { locale, setLocale, tr } from "./i18n";
import { icon, esc } from "./ui/icons";
import type { Viewer } from "./viewer/robot";
import { robotSvg } from "./viewer/fallback";
import { TwinWorkspace } from "./ui/workspace";
import { AssemblyWorkspace } from "./ui/assembly-page";
import { httpTwinRuntime } from "./scenarios/controls";
import { loadTarget, loopbackPage } from "./runtime/target";
import { businessSimulationNote, illustrativeNote } from "./ui/labels";

type Page = "design" | "assembly" | "restaurant" | "scenarios" | "twin" | "results" | "deployment";
const PAGES: Page[] = ["design", "assembly", "restaurant", "scenarios", "twin", "results", "deployment"];
const names = () => ({
  design: tr("Thiết kế", "設計", "Design"),
  assembly: tr("Lắp ráp", "組立", "Assembly"),
  restaurant: tr("Mặt bằng", "レストラン", "Restaurant"),
  scenarios: tr("Kịch bản", "シナリオ", "Scenarios"),
  twin: tr("Bản sao số", "デジタルツイン", "Digital twin"),
  results: tr("Kết quả", "結果", "Results"),
  deployment: tr("Triển khai", "デプロイ", "Deployment"),
});
const componentName = (id: string): string =>
  ({
    base: tr("Khung gầm", "シャーシ", "Chassis"),
    drive: tr("Bộ truyền động", "駆動系", "Drive system"),
    battery: tr("Pin & BMS", "バッテリー・BMS", "Battery & BMS"),
    power: tr("Phân phối nguồn", "電源分配", "Power distribution"),
    compute: tr("Bộ điều khiển", "コンピューター", "Compute"),
    lidar: "LiDAR 360°",
    depth: tr("Camera chiều sâu", "深度カメラ", "Depth camera"),
    tablet: tr("Màn hình tương tác", "操作画面", "Interaction display"),
  })[id] ||
  tr("Khay phục vụ", "サービストレイ", "Service tray") +
    " " +
    id.split("-").pop();
const partGroup = (id: string) =>
  id === "base"
    ? "chassis"
    : id.startsWith("tray")
      ? "trays"
      : ["lidar", "depth"].includes(id)
        ? "sensor"
        : id;
const btn = (label: string, action: string, ico = "", cls = "", extra = "") =>
  `<button class="button ${cls}" data-action="${action}" ${extra}>${ico ? icon(ico, 17) : ""}${label}</button>`;
const statusLabel = (status: string) =>
  ({
    ready: tr("Sẵn sàng", "準備完了", "Ready"),
    running: tr("Đang chạy", "実行中", "Running"),
    awaiting_load: tr("Chờ xác nhận tải", "積載確認待ち", "Awaiting load"),
    awaiting_handoff: tr(
      "Chờ xác nhận giao",
      "受け渡し確認待ち",
      "Awaiting handoff",
    ),
    completed: tr("Hoàn thành", "完了", "Completed"),
    cancelled: tr("Đã hủy", "キャンセル済み", "Cancelled"),
    needs_attention: tr("Cần kiểm tra", "要確認", "Needs attention"),
  })[status] || esc(status);
export class LabApp {
  private host: HTMLElement;
  private project: LabProject = defaultProject();
  private store = new ProjectStore();
  private page: Page = "design";
  private selected = "battery";
  private worldSelected = "table-1";
  private exploded = 0;
  private view2d = innerWidth < 768;
  private viewer: Viewer | null = null;
  private renderGeneration = 0;
  private history: LabProject[] = [];
  private future: LabProject[] = [];
  private health: Awaited<ReturnType<typeof runtime.getHealth>> | null = null;
  private paired = false;
  private busy = false;
  private notice = "";
  private run: RunSnapshot | null = null;
  private runProject: LabProject | null = null;
  private report: unknown = null;
  private replay = false;
  private replayIndex = 0;
  private replayEvents: RunEvent[] = [];
  private reportProjectRevision: number | null = null;
  private scenarioId = "S01";
  private runSeed = 42;
  private backendCompatible = false;
  private faultKind = "blocked";
  // one runtime client for every page: the pairing (CSRF token, ownership proofs) lives in it, so a session made on the Twin page also serves Assembly
  // the saved runtime address (Twin page runtime box; none saved: this page's own /lab/v2) and, for another origin, the bearer kept in this tab
  private runtime = httpTwinRuntime(loadTarget(location.origin));
  private assembly = new AssemblyWorkspace(() => this.render(), this.runtime, (name, data) => this.download(name, data));
  private twin = new TwinWorkspace(() => this.render(), this.runtime, () => this.assembly.projectDigest(), () => this.assembly.engineeringInput());
  constructor(host: HTMLElement) {
    this.host = host;
    this.bind();
    void this.init();
  }
  private async init() {
    try {
      const saved = await this.store.load(
        localStorage.getItem("mekoniq-active-project") || this.project.id,
      );
      if (saved) this.selectProject(saved);
    } catch {
      this.notice = tr(
        "Bộ nhớ trình duyệt không khả dụng; vẫn có thể xuất dự án.",
        "ブラウザ保存を利用できません。エクスポートできます。",
        "Browser storage is unavailable; project export remains available.",
      );
    }
    this.render();
    if (!location.hash.startsWith("#replay") && loopbackPage(location.hostname))
      void this.checkHealth();
  }
  private async checkHealth() {
    if(location.hash.startsWith("#replay"))return;
    try {
      this.health = await runtime.getHealth();
      this.backendCompatible = Boolean(
        this.health.backends?.some(
          (b) => b.id === "business_sim" && b.available,
        ),
      );
    } catch {
      this.health = null;
      this.backendCompatible = false;
    }
    this.render();
  }
  private normalizeWorldSelection() {
    if (!this.project.world.points.some((point) => point.id === this.worldSelected))
      this.worldSelected = this.project.world.points[0]?.id ?? "";
  }
  private selectProject(project: LabProject) {
    this.project = project;
    this.normalizeWorldSelection();
    try {
      localStorage.setItem("mekoniq-active-project", project.id);
    } catch {
      this.notice = tr(
        "Bộ nhớ trình duyệt không khả dụng; vẫn có thể xuất dự án.",
        "ブラウザ保存を利用できません。エクスポートできます。",
        "Browser storage is unavailable; project export remains available.",
      );
    }
  }
  private saveProject() {
    void this.store.save(this.project).catch(() => {
      this.notice = tr(
        "Không thể lưu tự động. Hãy xuất dự án.",
        "自動保存できません。エクスポートしてください。",
        "Autosave unavailable. Export your project.",
      );
      this.render();
    });
  }
  private change(edit: (p: LabProject) => void) {
    this.history.push(structuredClone(this.project));
    this.future = [];
    edit(this.project);
    this.project.revision++;
    this.project.updatedAt = new Date().toISOString();
    this.selectProject(this.project);
    this.saveProject();
    this.render();
  }
  private header() {
    const ns = names();
    return `<a id="app-skip-link" class="skip-link" href="#workspace">${tr("Đến vùng làm việc", "ワークスペースへ", "Skip to workspace")}</a>
<header class="topbar">
<a id="app-brand-link" class="brand mq-brand" href="#design" aria-label="MEKONIQ Robot Lab">
<img class="brand-horizontal" src="/brand/assets/MEKONIQ_Horizontal_White_Transparent_v2.png" width="1420" height="300" alt="">
<img class="brand-compact" src="/brand/assets/MEKONIQ_Icon_Transparent.svg" width="40" height="40" alt="">
<span class="brand-lab">ROBOT LAB</span>
</a>
<span class="top-project">${icon("cube", 15)} ${tr("Dự án nhà hàng", "レストランプロジェクト", "Restaurant project")} <span class="revision">R${String(this.project.revision).padStart(2, "0")}</span>
</span>
<div class="top-right">
<span class="mode-badge">
<i>
</i> ${this.run ? "BUSINESS SIM" : "PREVIEW"}</span>
<div class="languages" aria-label="Language">${(["vi", "ja", "en"] as Locale[]).map((l) => `<button data-action="locale" data-value="${l}" aria-pressed="${locale === l}" lang="${l}">${l.toUpperCase()}</button>`).join("")}</div>
<a class="business-link" href="/business-plan.html" target="_blank" rel="noopener">${tr("Kế hoạch kinh doanh", "事業計画", "Business plan")} ↗</a>
</div>
</header>
<div class="app-layout">
<aside class="sidebar">
<div class="sidebar-heading">${tr("KHÔNG GIAN LÀM VIỆC", "ワークスペース", "WORKSPACE")}</div>
<nav aria-label="${tr("Điều hướng chính", "メインナビゲーション", "Main navigation")}">${Object.entries(
      ns,
    )
      .map(
        ([key, label], i) =>
          `<a href="#${key}" class="nav-item ${this.page === key ? "active" : ""}" ${this.page === key ? 'aria-current="page"' : ""}>${icon(["design", "map", "play", "cube", "result", "deploy"][i]!)}<span>${label}</span>
<span class="nav-number" aria-hidden="true">0${i + 1}</span>
</a>`,
      )
      .join("")}</nav>
<div class="sidebar-bottom">
<div class="workspace-stamp">${icon("robot", 27)}<span>MEKONIQ<br>
<b>ENGINEERING LAB</b>
</span>
</div>
<p>${tr("Từ ý tưởng đến vận hành.", "アイデアから運用へ。", "From concept to service.")}</p>
<div class="sidebar-version">
<span class="tiny-dot">
</span> LAB v0.1 <span>R0</span>
</div>
</div>
</aside>
<main id="workspace" tabindex="-1" aria-busy="${this.busy}">${
      // the Digital twin page is viewport-first: its own run bar replaces the heading, runtime strip and footer
      this.page === "twin" ? `<h1 class="visually-hidden">${ns.twin}</h1>` : `
<div class="page-heading">
<div>
<div class="eyebrow">${tr("THIẾT KẾ. KIỂM CHỨNG. TRIỂN KHAI.", "設計。検証。運用。", "DESIGN. VALIDATE. DEPLOY.")}</div>
<h1>${this.page === "design" ? tr("Robot của bạn, từng chi tiết.", "ロボットを、細部まで。", "Your robot, down to the details.") : ns[this.page]}</h1>
<p>${this.page === "design" ? tr("Lắp ráp cấu hình phục vụ phù hợp với không gian của bạn.", "店舗に合ったサービスロボットを構成。", "Build a service robot around the way your space works.") : this.page === "restaurant" ? tr("Một mặt bằng chung cho thiết kế và kiểm chứng nghiệp vụ.", "設計と業務検証のための共通レイアウト。", "A shared layout for design and workflow validation.") : this.page === "scenarios" ? tr("Mỗi kết quả bắt đầu từ một lần chạy có nguồn gốc rõ ràng.", "根拠のある実行から結果が生まれます。", "Every result begins with a traceable run.") : this.page === "results" ? tr("Bằng chứng phần mềm, phạm vi được ghi rõ.", "範囲を明示したソフトウェア検証記録。", "Software evidence, with its limits in view.") : tr("Gói cấu hình dự thảo. Robot thật cần nghiệm thu riêng.", "設定ドラフト。実機は別途受入試験が必要です。", "A configuration draft. Physical robots require commissioning.")}</p>
</div>
<div class="heading-actions">${btn(tr("Hoàn tác", "元に戻す", "Undo"), "undo", "undo", "quiet", this.history.length ? "" : "disabled")}${btn(tr("Làm lại", "やり直す", "Redo"), "redo", "rotate", "quiet", this.future.length ? "" : "disabled")}${btn(tr("Xuất dự án", "プロジェクト出力", "Export project"), "export-project", "download", "secondary")}</div>
</div>
<div class="runtime-strip">
<span class="connection ${this.health ? "online" : ""}">
<i>
</i>${this.health ? tr("Runtime đã kết nối", "ランタイム接続済み", "Runtime connected") : tr("Chế độ xem trước", "プレビューモード", "Preview mode")}</span>
<span>${this.health ? businessSimulationNote() : tr("Thiết kế tự do · kết nối runtime cục bộ để chạy kịch bản", "自由に設計 · シナリオ実行にはローカル接続が必要", "Explore your design · connect a local runtime to run scenarios")}</span>
<button class="text-button" data-action="goto-runtime">${tr("Kết nối", "接続", "Connect")}${icon("arrow", 14)}</button>
</div>`
    }${
      this.notice
        ? `<div class="notice" role="status">${icon("info", 17)}<span>${esc(this.notice)}</span>
<button aria-label="${tr("Đóng", "閉じる", "Dismiss")}" data-action="dismiss">${icon("cross", 16)}</button>
</div>`
        : ""
    }${this.page === "design" ? this.design() : this.page === "restaurant" ? this.restaurant() : this.page === "scenarios" ? this.scenarios() : this.page === "twin" ? this.twin.html() : this.page === "assembly" ? this.assembly.html() : this.page === "results" ? this.results() : this.deployment()}${
      this.page === "twin"
        ? ""
        : `<footer class="main-footer">
<span>MEKONIQ ROBOT LAB <span class="footer-divider">/</span> ${tr("Không gian kỹ thuật mở", "オープンエンジニアリング", "An open engineering workspace")}</span>
<span>${icon("info", 13)} ${illustrativeNote()}</span>
</footer>`
    }
</main>
</div>`;
  }
  private design() {
    const d = this.project.design,
      s = summarizeDesign(d);
    return `<div class="design-grid">
<section class="panel configuration">
<div class="panel-heading">
<h2>${tr("Cấu hình robot", "ロボット構成", "Robot configuration")}</h2>
<span class="small-code">01</span>
</div>
<div class="preset-card">
<span class="preset-icon">${icon("robot", 24)}</span>
<div>
<strong>${tr("Robot phục vụ", "サービスロボット", "Service robot")}</strong>
<span>MK · SERVICE / R0</span>
</div>
<span class="preset-check">${icon("check", 14)}</span>
</div>
<label class="field-label" for="chassis">${tr("Nền tảng", "プラットフォーム", "Platform")}</label>
<select id="chassis" data-design="chassis">
<option value="service" ${d.chassis === "service" ? "selected" : ""}>${tr("Chassis vi sai · minh họa", "差動シャーシ · 参考", "Differential chassis · illustrative")}</option>
<option value="valetudo" ${d.chassis === "valetudo" ? "selected" : ""}>Valetudo · reference</option>
</select>
<div class="field-section">
<div class="label-row">
<label>${tr("Số khay phục vụ", "トレイ数", "Service trays")}</label>
<span>${tr("Mô-đun", "モジュール", "Modular")}</span>
</div>
<div class="segmented">${[2, 3, 4]
      .map(
        (
          n,
        ) => `<button data-action="trays" data-value="${n}" aria-pressed="${d.trays === n}">${n} <span>${tr("khay", "段", "trays")}</span>
</button>`,
      )
      .join("")}</div>
</div>
<div class="field-section">
<label class="field-label" for="battery">${tr("Bộ pin", "バッテリー", "Battery pack")}</label>
<select id="battery" data-design="batteryAh" ${d.chassis === "valetudo" ? "disabled" : ""}>${[10, 20, 30].map((n) => `<option value="${n}" ${d.batteryAh === n ? "selected" : ""}>24 V / ${n} Ah</option>`).join("")}</select>
<p class="field-help">${tr("Năng lượng theo mô hình, chưa đo thực tế.", "計算モデル値、実測ではありません。", "Modelled energy, pending measurement.")}</p>
</div>
<div class="field-section">
<label class="field-label" for="sensor">${tr("Bộ cảm biến", "センサー", "Sensor suite")}</label>
<select id="sensor" data-design="sensor" ${d.chassis === "valetudo" ? "disabled" : ""}>
<option value="lidar" ${d.sensor === "lidar" ? "selected" : ""}>LiDAR 360°</option>
<option value="depth" ${d.sensor === "depth" ? "selected" : ""}>${tr("Camera chiều sâu", "深度カメラ", "Depth camera")}</option>
</select>
</div>
<div class="field-section">
<div class="label-row">
<label for="payload">${tr("Tải dự kiến", "想定積載量", "Intended payload")}</label>
<output id="payload-value">${d.payloadKg} <span>kg</span>
</output>
</div>
<input id="payload" type="range" min="0" max="30" step="1" value="${d.payloadKg}" data-design="payloadKg">
<div class="range-labels">
<span>0 kg</span>
<span>30 kg</span>
</div>
</div>
<div class="config-note">${icon("info", 16)}<span>${tr("Thông số để khám phá thiết kế. Tải an toàn cần kiểm chứng trên robot thật.", "設計検討用の値です。安全積載量は実機検証が必要です。", "Explore design tradeoffs. Safe payload requires physical testing.")}</span>
</div>
</section>
<section class="panel model-panel">
<div class="viewer-top">
<span class="small-code">MK–SR / ${String(d.trays).padStart(2, "0")}</span>
<div class="viewer-switch">
<button data-action="view" data-value="3d" aria-pressed="${!this.view2d}">3D</button>
<button data-action="view" data-value="2d" aria-pressed="${this.view2d}">2D</button>
</div>
</div>
<div class="model-stage" id="robot-stage">${robotSvg(d.trays, partGroup(this.selected), this.exploded)}</div>
<div class="model-caption">
<span class="coordinate">Z ↑ <span>X ↗</span> Y →</span>
<span>${tr("Hình học minh họa", "参考形状", "Illustrative geometry")} · 1:${tr("tương đối", "概略", "approx.")}</span>
<button class="icon-button" data-action="reset-view" aria-label="${tr("Đặt lại góc nhìn", "視点リセット", "Reset view")}">${icon("rotate", 17)}</button>
</div>
<div class="assembly-control">
<div>
<label for="explode">${icon("design", 16)} ${tr("Khám phá lắp ráp", "組立を見る", "Explore assembly")}</label>
<output>${Math.round(this.exploded * 100)}%</output>
</div>
<input id="explode" type="range" min="0" max="1" step=".01" value="${this.exploded}">
<div class="range-labels">
<span>${tr("Lắp hoàn chỉnh", "組立済み", "Assembled")}</span>
<span>${tr("Tách lớp", "分解", "Exploded")}</span>
</div>
</div>
</section>
<section class="panel inspector">
<div class="panel-heading">
<h2>${tr("Chi tiết linh kiện", "コンポーネント", "Component inspector")}</h2>${icon("cube", 18)}</div>
<div class="selected-part">
<div class="component-symbol">${icon(this.selected === "battery" ? "bolt" : this.selected === "tablet" ? "robot" : "cube", 30)}</div>
<span class="eyebrow">${esc(this.selected.toUpperCase())} / R1</span>
<h3>${componentName(this.selected)}</h3>
<span class="pill">${tr("Dữ liệu minh họa", "参考データ", "Illustrative data")}</span>
</div>
<dl class="part-details">
<div>
<dt>${tr("Thông số", "仕様", "Specification")}</dt>
<dd>${this.selected === "battery" ? `24 V · ${d.batteryAh} Ah` : this.selected.startsWith("tray") ? `${d.trays} × modular` : this.selected === "lidar" ? "360° / 2D" : this.selected === "base" ? "Differential" : "R0 / illustrative"}</dd>
</div>
<div>
<dt>${tr("Kết nối", "接続", "Connection")}</dt>
<dd>${this.selected === "battery" ? "BMS → fuse → power" : this.selected === "lidar" ? "Data → compute" : "Functional / pending"}</dd>
</div>
<div>
<dt>${tr("Kiểm chứng", "検証", "Validation")}</dt>
<dd class="amber">${tr("Chờ đo thực tế", "実測待ち", "Measurement pending")}</dd>
</div>
</dl>
<div class="wiring-title">${icon("link", 15)} ${tr("Sơ đồ chức năng", "機能接続図", "Functional wiring")}</div>
<div class="wiring">
<button data-action="part" data-value="battery" class="${this.selected === "battery" ? "selected" : ""}">24 V<br>
<small>BMS</small>
</button>
<span>→</span>
<button data-action="part" data-value="power" class="${this.selected === "power" ? "selected" : ""}">DC–DC<br>
<small>POWER</small>
</button>
<span>→</span>
<button data-action="part" data-value="compute" class="${this.selected === "compute" ? "selected" : ""}">CPU<br>
<small>DATA</small>
</button>
</div>
<p class="field-help">${tr("Quan hệ chức năng, không phải sơ đồ đấu dây thi công.", "機能関係のみ。施工配線図ではありません。", "Functional relationships. Not an installation wiring diagram.")}</p>
</section>
</div>
<div class="metrics-grid">
<article class="metric">
<span>${icon("cube", 17)} ${tr("Khối lượng dự kiến", "想定総質量", "Estimated total mass")}</span>
<strong>${s.massKg?.toFixed(1) ?? "—"} <small>kg</small>
</strong>
<p>${tr("Gồm tải dự kiến", "想定積載量を含む", "Including intended payload")}</p>
</article>
<article class="metric">
<span>${icon("bolt", 17)} ${tr("Năng lượng khả dụng", "使用可能エネルギー", "Usable energy")}</span>
<strong>${s.usableWh?.toFixed(0) ?? "—"} <small>Wh</small>
</strong>
<p>24 V × Ah × 0.8 × 0.9</p>
</article>
<article class="metric">
<span>${icon("rotate", 17)} ${tr("Thời gian ước tính", "推定稼働時間", "Modelled runtime")}</span>
<strong>${s.runtimeHours?.toFixed(1) ?? "—"} <small>${tr("giờ", "時間", "hours")}</small>
</strong>
<p>${tr("Giả định công suất trung bình 120 W", "平均電力120 Wを仮定", "Assumes 120 W average draw")}</p>
</article>
<article class="metric cost">
<span>${icon("result", 17)} ${tr("Chi phí linh kiện", "部品概算", "Component estimate")}</span>
<strong>${s.totalMinor ? new Intl.NumberFormat(locale === "vi" ? "vi-VN" : locale === "ja" ? "ja-JP" : "en-US").format(Number(s.totalMinor)) : "—"} <small>₫</small>
</strong>
<p>${s.missingIds.length ? tr("Tổng chưa đầy đủ · còn thiếu giá", "一部未価格 · 小計", "Partial total · missing prices") : tr("Giá minh họa, không phải báo giá", "参考価格、見積書ではありません", "Illustrative prices, not a quotation")}</p>
</article>
</div>
<section class="panel bom-panel">
<div class="panel-heading">
<div>
<h2>${tr("Danh mục linh kiện", "部品表", "Bill of materials")}</h2>
<p>${tr("Chọn linh kiện để khám phá kết cấu và kết nối.", "部品を選択して構造と接続を確認。", "Select a component to explore its assembly and connections.")}</p>
</div>
<span class="pill">${s.lines.length} ${tr("linh kiện", "部品", "components")}</span>
</div>
<div class="bom-list">${s.lines
      .map(
        (
          l,
          i,
        ) => `<button class="bom-row ${this.selected === l.id ? "selected" : ""}" data-action="part" data-value="${esc(l.id)}" aria-pressed="${this.selected === l.id}">
<span class="bom-index">${String(i + 1).padStart(2, "0")}</span>
<span class="bom-name">${componentName(l.id)}<small>${esc(l.id)} · R1</small>
</span>
<span class="bom-quantity">×${l.quantity}</span>
<span class="bom-mass">${d.chassis === "valetudo" && l.id === "base" ? "—" : l.massKg.toFixed(1) + " kg"}</span>
<span class="bom-price">${l.priceMinor ? new Intl.NumberFormat().format(Number(l.priceMinor)) + " ₫" : tr("Chưa có giá", "価格未定", "Unpriced")}</span>${icon("chevron", 14)}</button>`,
      )
      .join(
        "",
      )}</div>${s.issues.length ? `<div class="validation-list">${s.issues.map((i) => `<p>${icon("info", 15)}${esc(i.message)}</p>`).join("")}</div>` : ""}</section>
<div class="research-row">
<span class="eyebrow">${tr("NGHIÊN CỨU TIẾP THEO", "今後の研究", "ON THE RESEARCH BENCH")}</span>
<article>${icon("coffee", 22)}<div>
<h3>${tr("Trạm pha chế", "ドリンクステーション", "Beverage cell")}</h3>
<p>${tr("Pha chế định lượng → bàn giao cho robot", "定量抽出 → ロボットへ受け渡し", "Metered dispensing → robot handoff")}</p>
</div>
<span class="pill">R3 · ${tr("Nghiên cứu", "研究", "Research")}</span>
</article>
<article>${icon("heat", 22)}<div>
<h3>${tr("Trạm nấu ăn", "調理ステーション", "Cooking cell")}</h3>
<p>${tr("Định lượng, nhiệt độ và thời gian", "分量・温度・時間", "Portioning, temperature and timing")}</p>
</div>
<span class="pill">R4 · ${tr("Nghiên cứu", "研究", "Research")}</span>
</article>
</div>`;
  }
  private worldSvg(interactive = false) {
    // Runtime observations belong to the world captured when the run was created.
    // The editable draft intentionally has no live robot overlay.
    const run = interactive ? null : this.run;
    const w =
      !interactive && this.runProject
        ? this.runProject.world
        : this.project.world;
    const point = run?.robotPosition ?? { x: 1, y: 1 };
    const selected = this.worldSelected;
    const pos = (x: number, y: number) => `${x * 70},${(w.height - y) * 70}`;
    return `<svg id="world-map" class="world-map" data-world-revision="${w.revision}" viewBox="-22 -22 ${w.width * 70 + 44} ${w.height * 70 + 44}" role="${interactive ? "group" : "img"}" aria-label="${tr("Mặt bằng nhà hàng theo mét", "レストラン平面図、単位メートル", "Restaurant layout in metres")}">
<defs>
<pattern id="map-grid" width="70" height="70" patternUnits="userSpaceOnUse">
<path d="M70 0H0V70" fill="none" stroke="#2c424b" stroke-width="1"/>
</pattern>
</defs>
<rect width="${w.width * 70}" height="${w.height * 70}" fill="#101e25" stroke="#4a626a" stroke-width="3"/>
<rect width="${w.width * 70}" height="${w.height * 70}" fill="url(#map-grid)"/>${Array.from({ length: Math.min(MAX_WORLD_SIZE, Math.max(0, Number.isFinite(w.width) ? Math.floor(w.width) : 0)) + 1 }, (_, n) => `<text x="${n * 70}" y="-9" text-anchor="middle" fill="#a2b8bf" font-size="11">${n} m</text>`).join("")}${w.obstacles
      .map(
        (o) => `<g>
<rect x="${o.x * 70}" y="${(w.height - o.y - o.height) * 70}" width="${o.width * 70}" height="${o.height * 70}" rx="8" fill="#29414b" stroke="#617b83"/>
<path d="M${o.x * 70 + 10} ${(w.height - o.y - o.height) * 70 + 9}h${Math.max(0, o.width * 70 - 20)}" stroke="#42616b"/>
</g>`,
      )
      .join("")}${w.points
      .map(
        (
          p,
        ) => `<g class="map-point ${p.id === selected ? "selected" : ""}" data-world-point="${esc(p.id)}" ${interactive ? `data-point="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(p.name)}"` : ""} transform="translate(${pos(p.x, p.y)})">
<circle r="${p.id === selected ? 16 : 12}" fill="${p.kind === "table" ? "#182a33" : "#263e36"}" stroke="${p.id === selected ? "#b4f375" : "#89a2a4"}" stroke-width="2"/>
<circle r="3" fill="#b4f375"/>
<text y="29" text-anchor="middle" fill="#edf5f3" font-size="12">${esc(p.name)}</text>
</g>`,
      )
      .join(
        "",
      )}${run ? `<path d="M${pos(point.x, point.y)}${run.target ? " L" + pos(run.target.x, run.target.y) : ""}" stroke="#b4f375" stroke-width="2" stroke-dasharray="6 6" fill="none"/>` : ""}${
      !interactive
        ? `<g data-robot-pose transform="translate(${pos(point.x, point.y)})">
<circle r="17" fill="#b4f375" stroke="#122207" stroke-width="3"/>
<path d="m-5 4 5-10 5 10" fill="none" stroke="#122207" stroke-width="2"/>
</g>`
        : ""
    }
</svg>`;
  }
  private runWorldNotice() {
    if (!this.run || !this.runProject) return "";
    const stale =
      this.project.id !== this.runProject.id ||
      JSON.stringify(this.project.world) !==
        JSON.stringify(this.runProject.world);
    return `<div class="source-note run-world-context" role="status" data-stale="${stale}">${icon("info", 15)}<span>${tr("Mặt bằng lần chạy", "実行レイアウト", "Run layout")} R${this.runProject.world.revision}${stale ? " · " + tr("Dự án đã thay đổi. Đang hiển thị mặt bằng đã ghi của lần chạy; thay đổi chỉ áp dụng cho lần chạy mới.", "プロジェクトが変更されています。記録済みレイアウトを表示中。変更は新しい実行に適用されます。", "Project layout changed. Showing the recorded run layout; edits apply only to a new run.") : " · " + tr("Bản ghi cố định của lần chạy này.", "この実行の固定スナップショット。", "Fixed snapshot for this run.")}</span></div>`;
  }
  private restaurant() {
    const p =
      this.project.world.points.find((x) => x.id === this.worldSelected) ??
      this.project.world.points[0];
    const issues = validateWorld(this.project.world);
    return `${this.run ? `<div class="notice editor-run-notice" role="status">${icon("info", 17)}<span>${tr("Đang sửa bản nháp. Lần chạy hiện tại giữ mặt bằng đã ghi; vùng sửa không hiển thị telemetry robot.", "ドラフトを編集中。現在の実行は記録済みレイアウトを使用します。編集画面に実機観測は重ねません。", "Editing a draft. The active run keeps its recorded layout; robot telemetry is hidden in this editor.")}</span></div>` : ""}<div class="world-grid">
<section class="panel map-panel">
<div class="panel-heading">
<h2>${tr("Mặt bằng nhà hàng", "レストラン平面図", "Restaurant floor plan")}</h2>
<span class="pill">${this.project.world.width} × ${this.project.world.height} m · R${this.project.world.revision}</span>
</div>${this.worldSvg(true)}<div class="map-legend">
<span>
<i class="legend-table">
</i>${tr("Bàn / vật cản", "テーブル・障害物", "Table / obstacle")}</span>
<span>
<i class="legend-point">
</i>${tr("Điểm bàn giao", "受渡地点", "Handoff point")}</span>
<span>${tr("Kéo điểm hoặc nhập tọa độ →", "ドラッグまたは座標入力 →", "Drag a point or enter coordinates →")}</span>
</div>
</section>
<section class="panel world-inspector">
<div class="panel-heading">
<h2>${tr("Đối tượng", "オブジェクト", "Objects")}</h2>${btn(tr("Thêm", "追加", "Add"), "add-table", "plus", "quiet")}</div>
${p ? `<label class="field-label" for="world-object">${tr("Chọn đối tượng", "対象を選択", "Selected object")}</label>
<select id="world-object">${this.project.world.points.map((x) => `<option value="${esc(x.id)}" ${x.id === p.id ? "selected" : ""}>${esc(x.name)} · ${x.kind}</option>`).join("")}</select>
<form id="point-form">
<label class="field-label" for="point-name">${tr("Tên", "名前", "Name")}</label>
<input id="point-name" name="name" value="${esc(p.name)}" required maxlength="60">
<div class="coordinate-inputs">
<label>X (m)<input name="x" type="number" min="0" max="${this.project.world.width}" step=".1" value="${p.x}" required>
</label>
<label>Y (m)<input name="y" type="number" min="0" max="${this.project.world.height}" step=".1" value="${p.y}" required>
</label>
</div>
<button class="button primary full" type="submit">${icon("check", 17)}${tr("Cập nhật tọa độ", "座標を更新", "Update coordinates")}</button>
</form>` : `<p class="empty-inline">${tr("Thêm điểm để bắt đầu chỉnh sửa.", "地点を追加して編集を始めてください。", "Add a point to start editing.")}</p>`}
<div class="config-note">${icon("info", 17)}<span>${tr("Điểm bàn giao ở cạnh bàn. Thay đổi mặt bằng làm cũ bằng chứng và map binding.", "受渡地点はテーブルの外側。変更すると検証結果とマップ紐付けが古くなります。", "Handoff points sit beside tables. Layout changes invalidate prior evidence and map bindings.")}</span>
</div>
<h3>${tr("Kiểm tra hình học", "形状チェック", "Geometry checks")}</h3>${issues.length ? issues.map((i) => `<p class="issue-text">${esc(i.message)}</p>`).join("") : `<p class="check-text">${icon("check", 16)}${tr("Không có lỗi hình học đã biết", "既知の形状エラーなし", "No known geometry issues")}</p>`}<p class="field-help">${tr("Hình học minh họa. Không phải map SLAM hoặc kiểm chứng tránh vật cản.", "参考形状。SLAMマップや障害物回避の検証ではありません。", "Illustrative geometry. This is not a SLAM map or obstacle avoidance validation.")}</p>
</section>
</div>`;
  }
  private runtimePanel() {
    return `<section class="panel runtime-panel" id="runtime-panel">
<div class="panel-heading">
<div>
<h2>${tr("Runtime cục bộ", "ローカルランタイム", "Local runtime")}</h2>
<p>${tr("Chạy qua source domain và SimulatorAdapter.", "Source domain と SimulatorAdapter で実行。", "Execute through the source domain and SimulatorAdapter.")}</p>
</div>
<span class="pill">${this.health ? "ONLINE" : "OFFLINE"}</span>
</div>
<form id="pair-form">
<label for="pair-token">${tr("Mã ghép nối từ terminal", "ターミナルのペアリングトークン", "Pairing token from your terminal")}</label>
<div class="pair-row">
<input id="pair-token" type="password" autocomplete="off" placeholder="Local runtime token" required>
<button class="button secondary" ${this.busy ? "disabled" : ""}>${icon("link", 17)}${this.paired ? tr("Đã ghép nối", "ペアリング済み", "Paired") : tr("Ghép nối", "ペアリング", "Pair runtime")}</button>${btn(tr("Kiểm tra", "確認", "Check"), "health", "rotate", "quiet")}</div>
</form>
<p class="field-help">${this.health ? `Source: ${esc(this.health.sourceCommit)} · protocol ${esc(this.health.protocolMajor)}` : tr("Khởi động pnpm runtime trong môi trường phát triển cục bộ. Token không được lưu vào dự án.", "ローカル開発環境で pnpm runtime を起動。トークンは保存されません。", "Start pnpm runtime in your local development environment. The token is never saved in your project.")}</p>
</section>`;
  }
  private scenarios() {
    return `${this.runtimePanel()}<div class="scenario-layout">
<section class="panel">
<div class="panel-heading">
<h2>${tr("Thư viện kịch bản", "シナリオ一覧", "Scenario library")}</h2>
<span class="pill">BUSINESS SIM</span>
</div>
<button class="scenario-card active" data-action="scenario" data-value="S01" aria-pressed="true">
<span class="scenario-id">S01</span>
<div>
<h3>${tr("Một chuyến phục vụ", "1回のサービス", "One service journey")}</h3>
<p>${tr("Bếp → nhận món → bàn 1 → giao món → điểm chờ", "厨房 → 積載 → テーブル1 → 受渡 → 待機", "Kitchen → load → table 1 → handoff → parking")}</p>
</div>${icon("check", 19)}</button>${[
      [
        "S03",
        tr("Người cắt ngang", "通行人の横断", "Pedestrian crossing"),
        "GAZEBO",
      ],
      ["S04", tr("Lối đi bị chặn", "通路の閉塞", "Blocked passage"), "GAZEBO"],
      [
        "S06",
        tr("Mất kết nối WAN", "WAN切断", "WAN disconnection"),
        "PROTOCOL RIG",
      ],
    ]
      .map(
        ([id, label, tag]) =>
          `<div class="scenario-card unavailable">
<span class="scenario-id">${id}</span>
<div>
<h3>${label}</h3>
<p>${tr("Chưa có backend kiểm chứng", "検証バックエンド未対応", "Validation backend unavailable")}</p>
</div>
<span class="pill">${tag}</span>
</div>`,
      )
      .join("")}<div class="scenario-options">
<label>Seed<input id="run-seed" type="number" min="0" max="2147483647" value="${this.runSeed}">
</label>
<span>${tr("Cùng seed, cùng đầu vào để tái lập.", "同じseedと入力で再現。", "Same seed and inputs for reproduction.")}</span>
</div>${btn(this.busy ? tr("Đang xử lý…", "処理中…", "Working…") : tr("Tạo lần chạy", "実行を作成", "Create run"), "create-run", "play", "primary full", !this.paired || !this.backendCompatible || this.busy ? "disabled" : "")}<p class="field-help">${tr("Cần runtime tương thích và ghép nối. Mô phỏng không chứng minh điều hướng vật lý.", "互換ランタイムとペアリングが必要。実機走行は検証しません。", "Requires a compatible paired runtime. Simulation does not validate physical navigation.")}</p>
</section>
<section class="panel run-panel">
<div class="panel-heading">
<h2>${tr("Theo dõi thực thi", "実行モニター", "Execution monitor")}</h2>
<span class="pill">${this.run ? statusLabel(this.run.status) : tr("Chưa có lần chạy", "実行なし", "No run yet")}</span>
</div>${this.runWorldNotice()}${this.worldSvg()}${
      this.run
        ? `<div class="run-state">
<span class="eyebrow">${esc(this.run.id)}</span>
<h3>${statusLabel(this.run.status)}</h3>
<p>Stage: ${esc(this.run.stage)} · Revision: ${esc(this.run.revision)} · ${(this.run.elapsedMs / 1000).toFixed(1)} s</p>
<div class="run-actions">${btn(tr("Bắt đầu", "開始", "Start"), "run-start", "play", "primary", this.busy || this.run.status !== "ready" ? "disabled" : "")}${btn("+1 s", "run-step", "arrow", "secondary", this.busy || ["completed", "cancelled"].includes(this.run.status) ? "disabled" : "")}${btn(tr("Xác nhận tại điểm dừng", "停止地点を確認", "Confirm stop"), "run-confirm", "check", "secondary", this.busy || !["awaiting_load", "awaiting_handoff"].includes(this.run.status) ? "disabled" : "")}${btn(tr("Hủy", "キャンセル", "Cancel"), "run-cancel", "cross", "quiet", this.busy || ["completed", "cancelled"].includes(this.run.status) ? "disabled" : "")}${btn(tr("Đọc trạng thái", "状態取得", "Refresh"), "run-refresh", "rotate", "quiet")}</div>
<div class="fault-actions">
<label for="fault-kind">${tr("Chèn lỗi thử nghiệm", "障害注入", "Inject test fault")}</label>
<select id="fault-kind">${[
            [
              "blocked",
              tr(
                "Chặn đích mô phỏng",
                "模擬目的地の閉塞",
                "Simulator blocked target",
              ),
            ],
            [
              "clear",
              tr(
                "Xóa vật cản mô phỏng",
                "模擬障害物を解除",
                "Clear simulator blockage",
              ),
            ],
            [
              "offline",
              tr("Adapter offline", "アダプター切断", "Adapter offline"),
            ],
            [
              "online",
              tr("Adapter online", "アダプター再接続", "Adapter online"),
            ],
            [
              "reboot",
              tr("Khởi động lại adapter", "アダプター再起動", "Adapter reboot"),
            ],
            [
              "duplicate-completed",
              tr(
                "Lặp sự kiện hoàn thành",
                "完了イベントを重複",
                "Duplicate completion event",
              ),
            ],
          ]
            .map(
              ([value, label]) =>
                `<option value="${value}" ${this.faultKind === value ? "selected" : ""}>${label}</option>`,
            )
            .join(
              "",
            )}</select>${btn(tr("Chèn lỗi", "注入", "Inject"), "run-fault", "bolt", "quiet", this.busy ? "disabled" : "")}</div>
</div>`
        : `<div class="empty-inline">${icon("play", 22)}<p>${tr("Tạo lần chạy để quan sát sự kiện từ source.", "実行を作成してSourceイベントを確認。", "Create a run to observe source events.")}</p>
</div>`
    }<p class="source-note">${icon("info", 15)}${tr("Vị trí chỉ cập nhật từ runtime. Canvas không quyết định đến đích.", "位置はランタイムから更新。描画は到着を判定しません。", "Position is observed from the runtime. The canvas never decides arrival.")}</p>
</section>
</div>`;
  }
  private reportMetrics() {
    if (!this.report) return "";
    try {
      const metrics = summarizeReport(this.report);
      return `<div class="metrics-grid report-metrics">${[
        [
          tr("Thời gian di chuyển", "移動時間", "Travel time"),
          (metrics.travelMs / 1000).toFixed(1) + " s",
        ],
        [
          tr("Chờ người xác nhận", "人の確認待ち", "Human confirmation wait"),
          (metrics.humanWaitMs / 1000).toFixed(1) + " s",
        ],
        [
          tr("Số lệnh thực thi", "実行試行数", "Execute attempts"),
          metrics.executeAttempts,
        ],
        [tr("Cỡ mẫu", "サンプル数", "Sample count"), metrics.sampleCount],
      ]
        .map(
          ([label, value]) => `<article class="metric">
<span>${label}</span>
<strong>${esc(value)}</strong>
</article>`,
        )
        .join("")}</div>`;
    } catch {
      return `<p class="issue-text">${tr("Báo cáo không hợp lệ; không suy ra metric.", "無効なレポート。指標を表示できません。", "Invalid report; metrics cannot be derived.")}</p>`;
    }
  }
  private results() {
    if (!this.run)
      return `<section class="panel empty-state">${icon("result", 46)}<h2>${tr("Chưa có bằng chứng thực thi", "実行の記録はまだありません", "No run evidence yet")}</h2>
<p>${tr("Cấu hình và hình ảnh xem trước không tạo kết quả kiểm chứng. Kết nối runtime, chạy S01 rồi xem báo cáo tại đây.", "構成やプレビューは検証結果を作成しません。ランタイムを接続してS01を実行してください。", "Configuration and preview visuals do not create evidence. Connect a runtime and run S01 to inspect its report here.")}</p>${btn(tr("Mở kịch bản", "シナリオを開く", "Open scenarios"), "goto-runtime", "play", "primary")}</section>`;
    const events = this.replay ? this.replayEvents : this.run.events;
    return `<section class="panel">
<div class="panel-heading">
<div>
<h2>${statusLabel(this.run.status)}</h2>
<p>${esc(this.run.id)} · ${esc(this.run.mode)} · ${esc(this.run.scenarioId)} · Seed ${esc(this.run.seed)}</p>
</div>${btn(tr("Tải báo cáo", "レポート取得", "Fetch report"), "report", "result", "secondary")}</div>
<div class="evidence-warning">${icon("info", 20)}<div>
<strong>${tr("Bằng chứng nghiệp vụ phần mềm", "業務ソフトウェア検証", "Business software evidence")}</strong>
<p>${tr("Không chứng minh tải an toàn, tránh vật cản, lực dừng hoặc readiness robot thật.", "積載安全性、回避、停止力、実機準備状態は証明しません。", "Does not prove payload safety, obstacle avoidance, stopping force or physical robot readiness.")}</p>
</div>
</div>${this.reportProjectRevision !== null && this.reportProjectRevision !== this.project.revision ? `<p class="issue-text">${tr("Dự án đã thay đổi. Báo cáo thuộc revision cũ.", "プロジェクト変更済み。以前のリビジョンの記録です。", "Project changed. This report belongs to an earlier revision.")}</p>` : ""}${this.reportMetrics()}<dl class="report-meta">
<div>
<dt>Source commit</dt>
<dd>${esc(this.run.sourceCommit)}</dd>
</div>
<div>
<dt>Run revision</dt>
<dd>${esc(this.run.revision)}</dd>
</div>
<div>
<dt>${tr("Thời gian mô phỏng", "シミュレーション時間", "Simulation time")}</dt>
<dd>${(this.run.elapsedMs / 1000).toFixed(1)} s</dd>
</div>
<div>
<dt>${tr("Sự kiện", "イベント", "Events")}</dt>
<dd>${events.length}</dd>
</div>
</dl>
<div class="panel-heading">
<h3>${tr("Dòng sự kiện", "イベントタイムライン", "Event timeline")}</h3>
<div>${btn(tr("Xem lại chỉ đọc", "読み取り専用再生", "Read-only replay"), "replay", "play", "secondary")}${this.report ? btn(tr("Xuất báo cáo", "レポート出力", "Export report"), "export-report", "download", "quiet") : ""}</div>
</div>${
      this.replay
        ? `<div class="replay-controls">
<span class="pill">REPLAY · READ ONLY</span>
<label for="replay-index">${tr("Sự kiện", "イベント", "Event")} ${this.replayIndex + 1} / ${events.length}</label>
<input id="replay-index" type="range" min="0" max="${Math.max(0, events.length - 1)}" value="${this.replayIndex}">
</div>`
        : ""
    }<ol class="event-list">${
      (this.replay ? events.slice(0, this.replayIndex + 1) : events)
        .map(
          (e, i) => `<li>
<span class="event-number">${String(i + 1).padStart(2, "0")}</span>
<div>
<strong>${esc(e.type)}</strong>
<span>${esc(e.at)}</span>
<details>
<summary>${tr("Dữ liệu sự kiện", "イベントデータ", "Event data")}</summary>
<pre>${esc(JSON.stringify(e, null, 2))}</pre>
</details>
</div>
</li>`,
        )
        .join("") ||
      `<li>${tr("Chưa có sự kiện", "イベントなし", "No events yet")}</li>`
    }</ol>
</section>`;
  }
  private deployment() {
    return `<div class="deployment-grid">
<section class="panel">
<div class="panel-heading">
<h2>${tr("Điều kiện triển khai", "デプロイ条件", "Deployment readiness")}</h2>
<span class="pill amber">DRAFT / BLOCKED</span>
</div>
<p class="section-description">${tr("Xuất cấu hình để review kỹ thuật. Không tự provision executor hoặc phát lệnh lên robot.", "技術レビュー用の設定を出力。実機へ設定やコマンドを送りません。", "Export a configuration for engineering review. Native executor provisioning and physical commands require separate commissioning.")}</p>${[
      [
        tr("Thiết kế và mặt bằng", "設計とレイアウト", "Design and layout"),
        tr(
          "Có revision và kiểm tra cấu hình",
          "バージョンと構成チェックあり",
          "Versioned, with configuration checks",
        ),
      ],
      [
        tr("Phần mềm source", "Sourceソフトウェア", "Source software"),
        this.health
          ? tr(
              "Runtime local được quan sát",
              "ローカルランタイム接続確認",
              "Local runtime observed",
            )
          : tr(
              "Chưa kết nối runtime",
              "ランタイム未接続",
              "Runtime not connected",
            ),
      ],
      [
        tr(
          "Map binding trên robot",
          "実機マップ紐付け",
          "Per-robot map binding",
        ),
        tr(
          "Chưa dạy map và điểm bàn giao",
          "マップと受渡地点の登録待ち",
          "Map and handoff targets not commissioned",
        ),
      ],
      [
        tr("Tải và an toàn", "積載量と安全性", "Payload and safety"),
        tr(
          "Chưa có đo đạc và nghiệm thu",
          "実測と受入試験待ち",
          "Measurement and acceptance pending",
        ),
      ],
      [
        tr("Executor và vận hành", "実行機と運用", "Executor and venue"),
        tr(
          "Chưa provision / chưa chấp thuận tại địa điểm",
          "未プロビジョニング・現地承認待ち",
          "Not provisioned / venue acceptance pending",
        ),
      ],
    ]
      .map(
        ([a, b], i) =>
          `<div class="readiness-row">
<span class="readiness-icon ${i === 0 ? "done" : ""}">${icon(i === 0 ? "check" : "lock", 17)}</span>
<div>
<strong>${a}</strong>
<p>${b}</p>
</div>
<span class="small-code">${i === 0 ? "DRAFT" : "PENDING"}</span>
</div>`,
      )
      .join("")}</section>
<section class="panel export-panel">${icon("deploy", 38)}<span class="eyebrow">DEPLOYMENT CANDIDATE</span>
<h2>${tr("Sẵn sàng để review.", "レビューへ。", "Ready for review.")}</h2>
<p>${tr("Gói JSON gồm dự án, revision, checksum và các gate còn thiếu. Mọi gói xuất vẫn là draft.", "JSONにはプロジェクト、リビジョン、ハッシュ、未完了ゲートを含みます。出力はすべてドラフトです。", "A JSON bundle with your project, revisions, hashes and open gates. Every exported candidate remains a draft.")}</p>
<label class="button secondary full" for="import-project">${icon("cube", 17)}${tr("Nhập dự án JSON", "プロジェクトJSONを読込", "Import project JSON")}</label>
<input id="import-project" type="file" accept="application/json,.json" class="visually-hidden">
<div class="export-code">schemaVersion: 1<br>status: "draft"<br>hardwareValidated: false</div>${btn(tr("Xuất candidate dự thảo", "ドラフト候補を出力", "Export draft candidate"), "export-bundle", "download", "primary full", this.busy ? "disabled" : "")}<button class="button secondary full" disabled>${icon("lock", 17)}${tr("Triển khai lên robot · bị chặn", "実機へデプロイ · ブロック中", "Deploy to robot · blocked")}</button>
<p class="field-help">${tr("Không có điều khiển phần cứng trong Lab public.", "公開Labに実機操作権限はありません。", "The public Lab has no hardware control authority.")}</p>
</section>
</div>`;
  }
  private async mountViewer(
    stage: HTMLElement,
    generation: number,
  ): Promise<void> {
    try {
      const { mountRobot } = await import("./viewer/robot");
      // A locale change, another render or navigation can finish before the import.
      // Never create GPU resources for a detached or superseded stage.
      if (
        generation !== this.renderGeneration ||
        !stage.isConnected ||
        this.page !== "design" ||
        this.view2d
      )
        return;
      stage.replaceChildren();
      const viewer = mountRobot(
        stage,
        this.project.design,
        (id) => {
          this.selected =
            id === "chassis"
              ? "base"
              : id === "sensor"
                ? this.project.design.sensor
                : id === "trays"
                  ? "tray-1"
                  : id;
          this.render();
        },
        () => {
          if (generation !== this.renderGeneration) return;
          this.view2d = true;
          this.render();
        },
      );
      if (!viewer) {
        this.view2d = true;
        this.render();
        return;
      }
      this.viewer = viewer;
      viewer.explode(this.exploded);
      viewer.select(partGroup(this.selected));
    } catch {
      if (generation !== this.renderGeneration) return;
      this.view2d = true;
      this.notice = tr(
        "Không tải được chế độ 3D. Tiếp tục thiết kế với bản 2D.",
        "3Dを読み込めません。2Dで設計を続行できます。",
        "The 3D viewer could not load. Continue designing in 2D.",
      );
      this.render();
    }
  }
  private render() {
    this.normalizeWorldSelection();
    const generation = ++this.renderGeneration;
    this.viewer?.dispose();
    this.viewer = null;
    const focused = document.activeElement as HTMLElement | null;
    const focusId = focused?.id;
    const focusAction = focused?.dataset.action;
    const focusValue = focused?.dataset.value;
    this.host.innerHTML = this.header();
    document.documentElement.lang = locale;
    if (this.page === "design" && !this.view2d) {
      // The lightweight SVG remains useful while the optional 3D chunk loads.
      const stage = document.getElementById("robot-stage")!;
      void this.mountViewer(stage, generation);
    }
    if (this.page === "twin") this.twin.mounted();
    else this.twin.leave();
    if (this.page === "assembly") this.assembly.mounted();
    else this.assembly.leave();
    if (focusId)
      document.getElementById(focusId)?.focus({ preventScroll: true });
    else if (focusAction) {
      this.host
        .querySelector<HTMLElement>(
          `[data-action="${CSS.escape(focusAction)}"]${focusValue ? `[data-value="${CSS.escape(focusValue)}"]` : ""}`,
        )
        ?.focus({ preventScroll: true });
    }
  }
  private download(name: string, data: unknown) {
    const blob = new Blob(
      [typeof data === "string" ? data : JSON.stringify(data, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  private async operation(task: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    this.notice = "";
    this.render();
    try {
      await task();
    } catch (e) {
      this.notice = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy = false;
      this.render();
    }
  }
  private bind() {
    const route = () => {
      const h = location.hash.slice(1);
      this.page = PAGES.includes(h as Page) ? (h as Page) : "design";
      this.render();
    };
    window.addEventListener("hashchange", route);
    const h = location.hash.slice(1);
    if (PAGES.includes(h as Page)) this.page = h as Page;
    this.host.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
      if (!b) return;
      const a = b.dataset.action,
        v = b.dataset.value;
      if (a?.startsWith("twin-")) return this.twin.click(a, v);
      if (a?.startsWith("asm-")) return this.assembly.click(a, v);
      if (a === "locale") {
        setLocale(v as Locale);
        this.render();
      } else if (a === "trays")
        this.change((p) => {
          p.design.trays = Number(v);
          p.design.revision++;
        });
      else if (a === "part") {
        this.selected = v!;
        this.render();
      } else if (a === "view") {
        this.view2d = v === "2d";
        this.render();
      } else if (a === "reset-view") this.viewer?.reset();
      else if (a === "dismiss") {
        this.notice = "";
        this.render();
      } else if (a === "undo") {
        const prev = this.history.pop();
        if (prev) {
          this.future.push(structuredClone(this.project));
          this.selectProject({
            ...prev,
            revision: this.project.revision + 1,
            updatedAt: new Date().toISOString(),
            design: {
              ...prev.design,
              revision: this.project.design.revision + 1,
            },
            world: { ...prev.world, revision: this.project.world.revision + 1 },
          });
          this.saveProject();
          this.render();
        }
      } else if (a === "redo") {
        const next = this.future.pop();
        if (next) {
          this.history.push(structuredClone(this.project));
          this.selectProject({
            ...next,
            revision: this.project.revision + 1,
            updatedAt: new Date().toISOString(),
            design: {
              ...next.design,
              revision: this.project.design.revision + 1,
            },
            world: { ...next.world, revision: this.project.world.revision + 1 },
          });
          this.saveProject();
          this.render();
        }
      } else if (a === "export-project")
        this.download("mekoniq-project.json", this.project);
      else if (a === "goto-runtime") {
        location.hash = "scenarios";
        setTimeout(() => document.getElementById("pair-token")?.focus(), 50);
      } else if (a === "health") void this.checkHealth();
      else if (a === "scenario") {
        this.scenarioId = v!;
        this.render();
      } else if (a === "add-table")
        this.change((p) => {
          let n = p.world.points.filter((x) => x.kind === "table").length + 1;
          while (p.world.points.some((x) => x.id === `table-${n}`)) n++;
          p.world.points.push({
            id: `table-${n}`,
            name: `Table ${n}`,
            kind: "table",
            x: 2,
            y: 3,
          });
          p.world.revision++;
          this.worldSelected = `table-${n}`;
        });
      else if (a === "create-run")
        void this.operation(async () => {
          const inputProject = structuredClone(this.project);
          this.run = await runtime.createRun(
            inputProject,
            this.scenarioId,
            this.runSeed,
          );
          this.runProject = inputProject;
          this.report = null;
          this.replay = false;
          this.replayEvents = [];
          this.reportProjectRevision = inputProject.revision;
        });
      else if (a?.startsWith("run-") && this.run)
        void this.operation(async () => {
          const kind = a.slice(4);
          if (kind === "refresh") this.run = await runtime.getRun(this.run!.id);
          else if (kind === "fault")
            this.run = await runtime.action(
              this.run!.id,
              "injectFault",
              {
                fault: this.faultKind,
              },
              this.run!.revision,
            );
          else
            this.run = await runtime.action(
              this.run!.id,
              kind as "start" | "step" | "confirm" | "cancel",
              kind === "step" ? { ms: 1000 } : {},
              this.run!.revision,
            );
        });
      else if (a === "report" && this.run)
        void this.operation(async () => {
          this.report = await runtime.getReport(this.run!.id);
        });
      else if (a === "export-report")
        this.download("mekoniq-run-report.json", this.report);
      else if (a === "replay") {
        this.replay = !this.replay;
        if (this.replay) {
          if (this.report) {
            try {
              const view = openReplay(this.report);
              this.replayEvents = view.seek(view.summary().elapsedMs);
            } catch {
              this.replayEvents = structuredClone(this.run?.events ?? []);
            }
          } else this.replayEvents = structuredClone(this.run?.events ?? []);
        }
        this.replayIndex = Math.max(0, this.replayEvents.length - 1);
        this.render();
      } else if (a === "export-bundle")
        void this.operation(async () => {
          const bundle = await buildBundle(
            this.project,
            this.report ? [this.report] : [],
          );
          this.download("mekoniq-deployment-draft.json", bundle);
        });
    });
    this.host.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement;
      if (input.id.startsWith("twin-")) return this.twin.change(input.id, input.value);
      if (input.id.startsWith("asm-") && input.id !== "asm-import") return this.assembly.change(input.id, input.value);
      if (input.id === "import-project" && input.files?.[0]) {
        const file = input.files[0];
        void this.operation(async () => {
          const next = await this.store.import(await file.text());
          this.history.push(structuredClone(this.project));
          this.future = [];
          this.notice = tr(
            "Đã nhập dự án.",
            "プロジェクトを読み込みました。",
            "Project imported.",
          );
          this.selectProject(next);
        });
      } else if (input.dataset.design) {
        const key = input.dataset.design;
        this.change((p) => {
          if (key === "trays" || key === "batteryAh" || key === "payloadKg")
            p.design[key] = Number(input.value);
          else if (key === "chassis") {
            p.design.chassis = input.value as "service" | "valetudo";
            if (p.design.chassis === "valetudo") {
              p.design.batteryAh = 20;
              p.design.sensor = "lidar";
            }
          } else if (key === "sensor")
            p.design.sensor = input.value as "lidar" | "depth";
          p.design.revision++;
        });
      } else if (input.id === "world-object") {
        this.worldSelected = input.value;
        this.render();
      } else if (input.id === "run-seed") this.runSeed = Number(input.value);
      else if (input.id === "fault-kind") this.faultKind = input.value;
    });
    this.host.addEventListener("input", (e) => {
      const i = e.target as HTMLInputElement;
      if (i.id.startsWith("twin-")) return this.twin.input(i.id, i.value);
      if (i.id === "explode") {
        this.exploded = Number(i.value);
        this.viewer?.explode(this.exploded);
        i.parentElement!.querySelector("output")!.textContent =
          `${Math.round(this.exploded * 100)}%`;
        if (this.view2d) {
          const stage = document.getElementById("robot-stage");
          if (stage)
            stage.innerHTML = robotSvg(
              this.project.design.trays,
              partGroup(this.selected),
              this.exploded,
            );
        }
      } else if (i.id === "payload") {
        const out = document.getElementById("payload-value");
        if (out) out.textContent = `${i.value} kg`;
      } else if (i.id === "replay-index") {
        this.replayIndex = Number(i.value);
        this.render();
      }
    });
    this.host.addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      if (this.twin.submit(form) || this.assembly.submit(form)) return;
      if (form.id === "pair-form") {
        const token = (
          document.getElementById("pair-token") as HTMLInputElement
        ).value;
        void this.operation(async () => {
          await runtime.pair(token);
          this.paired = true;
          await this.checkHealth();
          this.notice = tr(
            "Runtime đã ghép nối. Có thể tạo lần chạy.",
            "ランタイムとペアリングしました。",
            "Runtime paired. You can create a run.",
          );
        });
      } else if (form.id === "point-form") {
        const f = new FormData(form);
        const x = Number(f.get("x")),
          y = Number(f.get("y"));
        const selectedId = this.worldSelected;
        if (!this.project.world.points.some((point) => point.id === selectedId)) return;
        this.change((p) => {
          const point = p.world.points.find((point) => point.id === selectedId)!;
          point.x = x;
          point.y = y;
          point.name = String(f.get("name"));
          p.world.revision++;
        });
      }
    });
    let drag: {
      id: string;
      svg: SVGSVGElement;
      startX: number;
      startY: number;
    } | null = null;
    this.host.addEventListener("pointerdown", (e) => {
      const point = (e.target as HTMLElement).closest<SVGGElement>(
        "[data-point]",
      );
      if (point) {
        drag = {
          id: point.dataset.point!,
          svg: point.ownerSVGElement!,
          startX: e.clientX,
          startY: e.clientY,
        };
        this.worldSelected = point.dataset.point!;
      }
    });
    this.host.addEventListener("pointerup", (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) {
        this.render();
        return;
      }
      const matrix = d.svg.getScreenCTM();
      if (!matrix) return;
      const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(
        matrix.inverse(),
      );
      this.change((p) => {
        const item = p.world.points.find((a) => a.id === d.id)!;
        item.x =
          Math.round(Math.max(0, Math.min(p.world.width, point.x / 70)) * 10) /
          10;
        item.y =
          Math.round(
            Math.max(
              0,
              Math.min(p.world.height, p.world.height - point.y / 70),
            ) * 10,
          ) / 10;
        p.world.revision++;
      });
    });
    this.host.addEventListener("keydown", (e) => {
      const entity = (e.target as Element).closest<SVGElement>('[data-action="twin-pick"]');
      if (entity && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        return this.twin.click("twin-pick", entity.dataset.value);
      }
      const point = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-point]",
      );
      if (point && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        this.worldSelected = point.dataset.point!;
        this.render();
        document.getElementById("world-object")?.focus();
      }
    });
  }
}
