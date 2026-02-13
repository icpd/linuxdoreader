# LinuxDoReader - 项目上下文

## 项目概览

**LinuxDoReader** 是一个专为 `linux.do` 论坛设计的 Chrome 浏览器扩展。其核心目的是通过模拟拟人化的阅读和点赞行为，实现论坛交互自动化，帮助用户保持活跃度或自动化浏览任务。

### 核心功能
*   **拟人化阅读**：支持非线性随机滚动、随机停顿以及 Discourse 论坛的懒加载机制。
*   **智能点赞策略**：基于“社交证明”的点赞逻辑（仅点赞已有热度的帖子）、概率触发机制以及点赞上限后的自动冷却保护。
*   **自动导航**：在话题页和列表页（如 `/latest`、`/unseen`）之间自动跳转循环。
*   **任务管理**：支持设置任务持续时间，并提供页面内悬浮控制面板。

## 架构与技术栈

*   **类型**：Chrome 浏览器扩展 (Manifest V3)
*   **技术栈**：HTML, CSS, JavaScript (原生)
*   **权限说明**：
    *   `storage`：用于存储用户配置和任务状态。
    *   `tabs`：用于辅助导航控制。
*   **主机权限**：仅限于 `https://linux.do/*`。

### 文件结构
*   `manifest.json`：扩展配置文件，定义了入口点、权限和脚本注入规则。
*   `background.js`：Service Worker。负责初始化默认配置并持久化到 `chrome.storage.local`。
*   `content.js`：注入到 `linux.do` 页面的核心逻辑脚本。负责：
    *   DOM 操作（滚动、点击点赞）。
    *   业务逻辑（导航算法、点赞策略）。
    *   UI 渲染（页面悬浮控制面板）。
*   `popup/`：包含扩展图标点击后的弹出界面（`popup.html`, `popup.js`），用于参数微调。
*   `styles/content.css`：注入页面的悬浮面板样式。

## 开发与使用

### 安装步骤
1.  **加载已解压的扩展程序**：打开 `chrome://extensions/`，启用“开发者模式”，点击“加载已解压的扩展程序”，选择本项目根目录。
2.  **参数配置**：通过点击扩展图标进入 Popup 界面，调整滚动速度、点赞概率、任务时长等参数。

### 关键代码逻辑 (`content.js`)
*   **配置加载**：优先从 `chrome.storage.local` 读取，若无则使用 `DEFAULT_CONFIG`。
*   **选择器 (Selectors)**：使用特定的类名（如 `.timeline-replies`, `.discourse-reactions-reaction-button`）定位 DOM 元素。*注意：这些选择器依赖于论坛的主题结构，可能会因页面更新而失效。*
*   **状态管理**：
    *   `autoread` (bool)：控制自动阅读/导航循环的开关。
    *   `autolike` (bool)：控制点赞逻辑的开关。
    *   `taskStartTime` (timestamp)：用于记录和强制执行任务时长限制。

### 调试指南
*   **内容脚本**：在 `linux.do` 页面打开开发者工具控制台，查看以 `[LinuxDoReader]` 为前缀的日志。
*   **Popup/后台脚本**：右键点击插件图标选择“检查”或在 `chrome://extensions/` 中检查 Service Worker 视图。

## 开发规范
*   **异步处理**：广泛使用 `async/await` 处理存储操作和模拟延迟。
*   **状态同步**：`content.js` 监听 `chrome.storage.onChanged` 事件，实现 Popup 设置与页面悬浮面板状态的实时双向同步，无需刷新页面。
*   **安全性与反爬**：通过随机延迟和概率逻辑降低被识别为自动化脚本的风险。
