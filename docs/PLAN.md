# SecureWipe v2 — Kế hoạch tái cấu trúc & nâng cấp

> Nhánh làm việc: `v2-rewrite` · Mốc v1: commit `9f5414f` · Cập nhật lần cuối: 2026-10-15
>
> Ký hiệu: `[ ]` chưa làm · `[~]` đang làm · `[x]` xong · 🛡 = cần quyền Administrator/root

## 0. Quyết định đã chốt

| Hạng mục | Quyết định |
|---|---|
| Giao diện | React + Vite + TypeScript + Tailwind (build local, chạy offline) |
| License | **Tạm bỏ** trong giai đoạn này (gỡ master key, trial, màn hình kích hoạt) |
| macOS | Không ký/notarize → phát hành `.zip` chưa ký, kèm hướng dẫn chuột phải → Open |
| Phát hành | Chỉ bản **Portable**: Windows `.exe` portable + `.zip`; macOS `.zip`; Linux `.AppImage` + `.tar.gz` |
| Quyền Admin | App chạy quyền user (`asInvoker`); chỉ tác vụ 🛡 mới xin nâng quyền, từng tác vụ một |
| Phạm vi | P0 → P4 + toàn bộ tính năng 2.0 và 2.1 |

## 1. Lỗi đã phát hiện ở v1 (đối chiếu khi sửa)

| # | Mức | Lỗi | Xử lý ở v2 |
|---|---|---|---|
| 1 | 🔴 | Privacy Firefox: History/Cookies/Authorization trỏ vào cả thư mục Profiles → xóa toàn bộ profile | Định nghĩa từng file cụ thể theo profile; lịch sử Firefox xóa qua SQLite, giữ bookmark |
| 2 | 🔴 | Xóa `Login Data` (mật khẩu) mặc định được tick | Mật khẩu mặc định **không tick**, cảnh báo đỏ |
| 3 | 🔴 | Tàn dư Uninstaller so khớp chuỗi con theo publisher → xóa thư mục của app khác | So khớp chính xác tên đã chuẩn hóa + chấm điểm tin cậy; không bao giờ xóa thư mục publisher dùng chung |
| 4 | 🔴 | Registry tàn dư bịa ra (không kiểm tra tồn tại), kích thước giả 5 KB | Chỉ liệt kê key tồn tại; export `.reg` trước khi xóa |
| 5 | 🔴 | Tắt Autorun = xóa registry value (không bật lại được) | Dùng `StartupApproved` (giống Task Manager), bật/tắt đảo ngược được |
| 6 | 🔴 | Wipe tự xóa toàn bộ Shadow Copy / Time Machine snapshot | Tách thành Restore Point Manager, chỉ xóa khi người dùng chọn |
| 7 | 🔴 | Junk xóa sạch Temp/`Explorer`/`/tmp`, không chọn mục, không lọc tuổi file | Danh mục chi tiết, lọc tuổi ≥ 24h, bỏ qua file bị khóa |
| 8 | 🔴 | Shredder không chặn đường dẫn hệ thống | PathGuard |
| 9 | 🔴 | RCE: renderer gửi chuỗi lệnh uninstall tùy ý + Tailwind CDN | Renderer chỉ gửi ID; không tải script ngoài; CSP |
| 10 | 🔴 | PowerShell injection (ghép chuỗi không escape) | Tham số truyền qua JSON/biến môi trường, `-EncodedCommand` |
| 11 | 🔴 | XSS qua `innerHTML` + `onclick` inline | React (escape mặc định), không inline handler |
| 12 | 🔴 | IPC xóa bất kỳ path nào renderer gửi | ScanSession: main chỉ xóa mục có trong phiên quét |
| 13 | 🔴 | Master key license plaintext | Gỡ bỏ license |
| 14 | 🟠 | Shredder chỉ ghi đè 5 MB đầu; mở mode `'w'` (truncate) | Ghi đè toàn bộ theo chunk, mode `r+`, fsync, verify |
| 15 | 🟠 | Wipe macOS/Linux không chạy nhưng vẫn xuất chứng chỉ "VERIFIED" | Wipe đa nền tảng thật; báo cáo chỉ chứa số liệu đo được |
| 16 | 🟠 | Wipe không có tiến trình, không hủy được | TaskRunner: tiến trình, tốc độ, ETA, Hủy |
| 17 | 🟠 | Số liệu giả: +500 MB/+2000 MB, kích thước app random, MB quét random, nhiệt độ 35°C | Chỉ số liệu thật; không đo được → "Không xác định" |
| 18 | 🟠 | Multi Uninstaller chỉ gỡ app đầu tiên; quét tàn dư trước khi gỡ xong | Hàng đợi tuần tự, chờ uninstaller kết thúc + xác minh |
| 19 | 🟠 | `readFileSync` + MD5 toàn file → treo app, lỗi file > 2 GB | I/O bất đồng bộ, băm stream, nhóm theo kích thước |
| 20 | 🟠 | Listener IPC đăng ký lặp | Kênh sự kiện tác vụ duy nhất, hủy đăng ký đúng |
| 21 | 🟠 | Nút/tùy chọn chưa nối logic (Refresh, Launch at startup, master checkbox) | Viết lại toàn bộ UI |
| 22 | 🟡 | 2 cấu hình build mâu thuẫn (`requireAdministrator` vs `asInvoker`) | 1 file `electron-builder.yml` |
| 23 | 🟡 | Tailwind CDN → offline vỡ giao diện | Build CSS local |
| 24 | 🟡 | Không thực sự portable; relaunch admin sai exe | Thư mục dữ liệu cạnh file chạy; Privilege Broker |
| 25 | 🟡 | Không single-instance; thông báo mỗi lần đóng | Single-instance lock; tray tùy chọn |
| 26 | 🟡 | Dùng thương hiệu "CleanMyPC" trong UI | Gỡ bỏ |
| 27 | 🟡 | i18n ~10%, `alert()`/`confirm()` | i18n đầy đủ vi/en, Dialog/Toast riêng |

## 2. Kiến trúc v2

```
src/
  shared/            types, IPC contract, locales (vi/en) dùng chung main + renderer
  main/
    main.ts          bootstrap: data dir portable, single-instance, window, tray
    infra/           logger, settings, history, exec (PowerShell/shell an toàn), fs utils, format
    safety/          pathGuard, scanSession, quarantine, regBackup
    tasks/           taskManager (progress, cancel)
    elevation/       broker (Windows UAC / macOS osascript / Linux pkexec) + script mẫu cố định
    platform/        volumes, processes, sysinfo
    services/        junk, uninstall, startup, privacy, extensions, shredder, wiper, health,
                     spaceLens, largeFiles, duplicates, emptyFolders, brokenShortcuts,
                     trash, restorePoints, smartScan, report, updates
    ipc/             đăng ký handler + validate input (zod)
  preload/           contextBridge, chỉ expose API đã định kiểu
  renderer/          React app (Vite)
tests/               Vitest cho các module thuần (pathGuard, matcher, shredder, duplicates, ...)
```

**Nguyên tắc an toàn (áp dụng mọi module)**
1. Quét → Xem trước → Xác nhận → Thực thi → Báo cáo. Mặc định chỉ tick mục an toàn.
2. Không có số liệu giả. Không đo được thì ghi "Không xác định".
3. Renderer không bao giờ gửi đường dẫn để xóa; chỉ gửi `sessionId` + ID mục. Main kiểm tra lại PathGuard trước mỗi thao tác.
4. Khôi phục được: tàn dư gỡ cài đặt → Quarantine (giữ 7 ngày, có nút Khôi phục); registry → `.reg` backup; file lớn/trùng lặp → Thùng rác hệ điều hành. Junk (cache/temp tái tạo được) xóa trực tiếp. Shredder/Wiper không đảo ngược → xác nhận 2 bước.

**Mô hình quyền (Privilege Broker)**: App chạy quyền user. Tác vụ 🛡 được đóng gói thành "job" (script mẫu cố định nhúng trong app + file tham số JSON), chạy qua `Start-Process -Verb RunAs` (Windows), `osascript … with administrator privileges` (macOS), `pkexec` (Linux). Tiến trình báo về qua file JSON-lines; không restart app, không mất trạng thái. Mỗi nút 🛡 có tooltip giải thích lý do.

## 3. Phân loại quyền theo tính năng

| Cần quyền 🛡 | Không cần quyền |
|---|---|
| Junk hệ thống: `Windows\Temp`, Windows Update/Delivery Optimization, WER hệ thống; journal, apt/dnf cache (Linux); `/Library/Caches`, `/Library/Logs` (macOS) | Junk của user (Temp, cache app, thumbnail, log, dev cache), Thùng rác của user |
| Tàn dư trong Program Files/ProgramData, registry HKLM | Tàn dư AppData, registry HKCU |
| Startup HKLM, Scheduled Tasks, Services; LaunchDaemons (macOS) | Startup HKCU, thư mục Startup user, LaunchAgents user, autostart/systemd --user |
| TRIM (Optimize-Volume / fstrim) | Wipe free space (ghi vào thư mục user ghi được trên cùng ổ) |
| Restore Point: tạo/xóa | Privacy trình duyệt, dấu vết hệ thống, DNS flush (Windows) |
| SMART chi tiết (StorageReliabilityCounter, smartctl) | Thông tin sức khỏe cơ bản, Space Lens, Large/Duplicate, Shredder file user |
| Gỡ gói hệ thống Linux (apt/dnf/snap) | Gỡ app Windows (uninstaller gốc tự xin UAC), app macOS trong `~/Applications`, Flatpak user |

## 4. Lộ trình & checklist

### P0 — Nền móng
- [x] Tạo nhánh `v2-rewrite`, snapshot v1
- [x] Cấu trúc thư mục mới; toolchain: esbuild (main/preload) + Vite (renderer) + Tailwind v4
- [x] Bảo mật Electron: `contextIsolation`, `sandbox`, CSP, chặn `window.open`/điều hướng, `openExternal` có whitelist
- [x] Single-instance; thư mục dữ liệu portable (`SecureWipe-Data` cạnh file chạy, fallback userData)
- [x] Logger, Settings, History (JSON-lines)
- [x] `exec` an toàn (PowerShell `-EncodedCommand`, tham số qua env), không ghép chuỗi
- [x] TaskManager (tiến trình, hủy) + kênh sự kiện IPC duy nhất
- [x] Privilege Broker 3 nền tảng
- [x] PathGuard, ScanSession, Quarantine, RegBackup
- [x] IPC contract dùng chung + validate bằng zod
- [x] i18n framework (vi/en)

### P1 — Viết lại lõi
- [x] Junk Cleaner Pro (Windows/macOS/Linux, cây danh mục, lọc tuổi, bỏ file khóa, dev cache)
- [x] Multi Uninstaller Pro (Win32 + Store / macOS .app / dpkg-rpm-flatpak-snap), hàng đợi, xác minh, tàn dư chấm điểm
- [x] Startup Manager (Run + StartupApproved, Startup folder, Scheduled Tasks, Services; LaunchAgents; XDG autostart + systemd --user), kiểm tra chữ ký
- [x] Privacy (7 trình duyệt, đa profile, 3 OS, SQLite cho Firefox, phát hiện trình duyệt đang mở) + dấu vết hệ thống
- [x] Shredder (1/3/7/35 lượt, verify, đổi tên, truncate, xóa thư mục, cảnh báo SSD)
- [x] Free Space Wiper (đa nền tảng, metadata pass, TRIM 🛡, tiến trình/ETA/hủy)
- [x] Disk Health (SMART thật; chi tiết 🛡)
- [x] Báo cáo thực thi PDF + JSON có mã SHA-256 toàn vẹn
- [x] Gỡ toàn bộ license
- [x] Unit test (Vitest)

### P2 — Giao diện
- [x] Design system: token màu, theme Sáng/Tối/Hệ thống, typography, icon (lucide)
- [x] Shell: sidebar nhóm + thu gọn, header trạng thái quyền, Toast, Dialog, ConfirmDialog
- [x] Thành phần: bảng ảo hóa, checkbox nhóm, progress (ETA + Hủy), empty state, trạng thái tải (TaskView/spinner thay cho skeleton)
- [x] Dashboard + toàn bộ màn hình module
- [x] i18n vi/en đầy đủ; Cài đặt; Giới thiệu

### P3 — Tính năng mới
**2.0**
- [x] Smart Scan (điểm sức khỏe, "Dọn tất cả mục an toàn")
- [x] Space Lens (treemap dung lượng)
- [x] Duplicate Finder (size → partial hash → full hash, quy tắc tự chọn)
- [x] Quarantine & Hoàn tác (7 ngày)
- [x] Nhật ký & Báo cáo (xuất CSV/PDF)
- [x] Restore Point Manager 🛡 (+ tùy chọn tạo trước khi xóa registry)

**2.1**
- [x] Browser Extensions Manager (liệt kê, quyền nhạy cảm; gỡ Firefox; mở trang quản lý cho Chromium*)
- [x] Empty Folders Finder & Broken Shortcuts Finder
- [x] Thùng rác thông minh (theo ổ, lọc theo ngày xóa)
- [x] Kiểm tra cập nhật SecureWipe (GitHub Releases, chỉ thông báo)

\* Chromium bảo vệ cấu hình extension bằng HMAC; xóa thư mục extension sẽ bị trình duyệt tự "sửa chữa"/cài lại → gỡ an toàn phải qua trang `chrome://extensions`.

### P4 — Đóng gói & kiểm thử
- [x] `electron-builder.yml` duy nhất: Win portable+zip (x64, arm64), mac zip (x64, arm64), Linux AppImage+tar.gz (x64, arm64); `asar`, `asInvoker`
- [x] GitHub Actions ma trận 3 OS, đính kèm Release khi push tag `v*`
- [x] Checklist kiểm thử thủ công cho từng nền tảng (`docs/TESTING.md`)
- [x] README cập nhật

## 5. Nhật ký tiến độ

| Ngày | Nội dung |
|---|---|
| 2026-10-15 | Audit v1, chốt kế hoạch, tạo nhánh `v2-rewrite` |
| 2026-10-15 | P0 + P1: main process mới (IPC có kiểu + zod, ScanSession, PathGuard, Quarantine, Privilege Broker 3 OS), viết lại toàn bộ service; 32 unit test |
| 2026-10-15 | P2 + P3: renderer React (18 trang, theme sáng/tối, vi/en 739 khóa), toàn bộ tính năng 2.0 & 2.1 |
| 2026-10-15 | Tối ưu Windows: thay `Get-PhysicalDisk`/`Get-ScheduledTask` (30+ giây) bằng truy vấn CIM / COM (< 1 giây); kiểm tra chữ ký số chạy nền |
| 2026-10-15 | P4: `electron-builder.yml` duy nhất, CI 3 OS, README, `docs/TESTING.md`; build thử Windows portable |

## 6. Còn lại / rủi ro đã biết

- **macOS & Linux**: mã đã viết đầy đủ nhưng mới kiểm thử thực tế trên Windows 11. Cần chạy `docs/TESTING.md` trên macOS (Intel + Apple Silicon) và Ubuntu/Fedora trước khi phát hành.
- **macOS chưa ký**: Gatekeeper sẽ cảnh báo; người dùng phải chuột phải → Open. Khi có Apple Developer ID, bật `identity`, `hardenedRuntime` và notarize trong `electron-builder.yml`.
- **Windows portable chưa ký mã (code signing)**: SmartScreen có thể cảnh báo lần đầu. Nên mua chứng chỉ ký mã (OV/EV) cho bản thương mại.
- **Các thao tác xóa thật** (Shredder, Wiper, gỡ cài đặt, dọn rác hệ thống) chỉ được kiểm thử bằng unit test trên thư mục tạm, chưa chạy trên máy thật — làm theo mục ⚠ trong `docs/TESTING.md` trên máy ảo.

## 7. Bản phát hành 1.0.0

| Ngày | Nội dung |
|---|---|
| 2026-10-15 | Giao diện kiểu CleanMyPC (sidebar module + thanh tiến trình, Lịch sử/Tùy chọn/Trợ giúp), version 1.0.0 |
| 2026-10-16 | Trạng thái dịch vụ từ `nvma.site/securewipe.json`: cập nhật + khóa từ xa "Out of Service" (kiểm tra khi mở & mỗi tuần, khóa sau tác vụ, offline > 60 ngày thì khóa, vẫn khôi phục được khu cách ly); module Ngủ đông (Windows); bỏ mọi link GitHub trong app; macOS ký ad-hoc |

Đề xuất cho 1.1 (chờ chọn): dọn rác Zalo/Cốc Cốc, ai đã dùng camera/micro, chế độ Máy công cộng, quét dữ liệu nhạy cảm; sau đó: đo thật mức làm chậm khởi động, xu hướng SMART, hủy kèm dấu vết, chế độ Bàn giao máy.
