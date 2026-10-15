# SecureWipe 1.0

Công cụ di động giúp dọn dẹp hệ thống, gỡ cài đặt phần mềm và xóa dữ liệu an toàn dành cho **Windows, macOS và Linux** — phát triển bởi NVMA.

Không cần cài đặt, không chạy dịch vụ ngầm, không yêu cầu quyền quản trị viên (trừ khi một tác vụ cụ thể đòi hỏi quyền này).

## Tính năng

| Nhóm | Chức năng |
|---|---|
| Tổng quan | **Smart Scan** — điểm sức khỏe máy, dọn nhanh các mục an toàn |
| Dọn dẹp | Dọn rác hệ thống (user / hệ thống 🛡 / trình duyệt / ứng dụng / lập trình / nhật ký) · Quyền riêng tư (7 trình duyệt, đa profile, dấu vết hệ thống) · Thùng rác trên mọi ổ đĩa |
| Ứng dụng | Multi Uninstaller (Win32, Store, macOS .app, deb/rpm/Flatpak/Snap/AppImage) + quét tàn dư có chấm điểm tin cậy · Startup Manager · Ngủ đông (Windows: tắt / thu gọn hiberfil.sys 🛡) · Browser Extensions |
| Tệp tin | Space Lens (treemap) · Tệp lớn · Tệp trùng lặp (băm nội dung) · Thư mục rỗng & shortcut hỏng |
| Bảo mật | Shredder (1/3/7/35 lượt + verify) · Free Space Wiper (+ metadata, TRIM 🛡) · Disk Health (SMART) · Restore Points 🛡 |
| Hệ thống | Lịch sử & khu cách ly (khôi phục được) · Báo cáo PDF/JSON có mã SHA-256 · Song ngữ Việt/Anh · Theme sáng/tối |

🛡 = tác vụ xin quyền quản trị riêng (UAC / mật khẩu macOS / polkit). Ứng dụng luôn chạy với quyền người dùng thường.

## Nguyên tắc an toàn

1. Quét → xem trước → xác nhận → thực thi → báo cáo. Không xóa gì khi chưa xác nhận.
2. Không có số liệu giả; không đo được thì ghi "Không xác định".
3. Renderer không bao giờ gửi đường dẫn để xóa — chỉ gửi ID của mục trong phiên quét; main process kiểm tra lại bằng PathGuard.
4. Tàn dư gỡ cài đặt và mục khởi động vào **khu cách ly** (mặc định 7 ngày); khóa registry được sao lưu `.reg`; tệp lớn/trùng lặp vào Thùng rác của hệ điều hành.

## Phát triển

Yêu cầu: Node.js 22+ (khuyến nghị 24).

```bash
npm install
npm run dev          # Vite + Electron, tự reload
npm run typecheck    # TypeScript main + renderer
npm test             # Vitest (PathGuard, shred engine, name matching, parsers…)
node scripts/check-i18n.mjs   # kiểm tra bản dịch vi/en đầy đủ
```

Cấu trúc:

```
src/shared     kiểu dữ liệu + hợp đồng IPC dùng chung
src/main       Electron main: infra, safety, elevation, platform, services, ipc
src/preload    contextBridge (sandbox)
src/renderer   React + Tailwind (theme token sáng/tối, i18n vi/en)
tests          Vitest
```

## Đóng gói (portable)

```bash
npm run dist:win     # SecureWipe-<ver>-Portable-x64.exe / -arm64.exe + .zip
npm run dist:mac     # SecureWipe-<ver>-mac-x64.zip / -arm64.zip (chưa ký)
npm run dist:linux   # .AppImage + .tar.gz (x64, arm64)
```

Kết quả nằm trong `release/<version>/`. Push tag `v*` lên GitHub để CI build cả 3 nền tảng và công bố release.

Dữ liệu (cài đặt, lịch sử, khu cách ly, báo cáo, log) được lưu trong thư mục **`SecureWipe-Data`** cạnh file chạy (Windows/Linux); nếu thư mục đó không ghi được thì dùng thư mục người dùng của hệ điều hành. macOS luôn dùng `~/Library/Application Support/SecureWipe`.

### macOS (ký ad-hoc, chưa notarize)

Bản macOS chưa được ký/notarize. Lần đầu mở: chuột phải vào `SecureWipe.app` → **Open** → **Open**. Hoặc:

```bash
xattr -dr com.apple.quarantine /path/to/SecureWipe.app
```

## Kiểm thử

Xem [docs/TESTING.md](docs/TESTING.md) cho checklist kiểm thử thủ công trên từng nền tảng, và [docs/PLAN.md](docs/PLAN.md) cho kế hoạch & tiến độ.

© 2026 NVMA Team — https://nvma.site
