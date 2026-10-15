# SecureWipe v2 — Checklist kiểm thử thủ công

> Chạy trên **máy ảo hoặc máy thử**, không phải máy làm việc chính, với các mục có đánh dấu ⚠ (xóa thật).
> Ghi kết quả: ✅ đạt · ❌ lỗi (ghi chú) · ➖ không áp dụng.

## 0. Tự động (chạy trước mỗi lần phát hành)

```bash
npm run typecheck && npm test && node scripts/check-i18n.mjs && npm run build
```

## 1. Khởi động & portable

| # | Kiểm tra | Win | macOS | Linux |
|---|---|---|---|---|
| 1.1 | Mở bản portable lần đầu: hiện màn hình chào, ngôn ngữ theo hệ thống | | | |
| 1.2 | Thư mục `SecureWipe-Data` được tạo cạnh file chạy (Win/Linux) | | ➖ | |
| 1.3 | Chép bản portable lên USB chỉ đọc → app vẫn chạy, dữ liệu vào thư mục người dùng | | ➖ | |
| 1.4 | Mở lần thứ 2 khi đang chạy → chỉ focus cửa sổ cũ (single instance) | | | |
| 1.5 | Rút mạng → giao diện hiển thị đầy đủ (không phụ thuộc CDN) | | | |
| 1.6 | Theme Sáng/Tối/Theo hệ thống; đổi ngôn ngữ Việt ↔ Anh không cần khởi động lại | | | |
| 1.7 | Bật "Chạy nền ở khay hệ thống" → đóng cửa sổ thì ẩn xuống khay; tắt → đóng là thoát | | | |

## 2. Quyền quản trị (chỉ khi cần)

| # | Kiểm tra | Win | macOS | Linux |
|---|---|---|---|---|
| 2.1 | Mở app bình thường: không có hộp UAC/mật khẩu nào | | | |
| 2.2 | Nút có biểu tượng khiên → bấm → hiện UAC / hộp mật khẩu / polkit, banner "Đang chờ cấp quyền" | | | |
| 2.3 | Từ chối quyền → thông báo rõ ràng, không thay đổi gì, app vẫn chạy | | | |
| 2.4 | Chạy app bằng "Run as administrator" → badge "Quản trị viên", không hỏi UAC nữa | | ➖ | |

## 3. Dọn rác hệ thống

| # | Kiểm tra | Win | macOS | Linux |
|---|---|---|---|---|
| 3.1 | Quét: có tiến trình, Hủy được; danh mục chia nhóm, mục "Cần xem" không tick sẵn | | | |
| 3.2 | Bấm danh mục → panel phải liệt kê tệp thật (lớn nhất trước) | | | |
| 3.3 | Tạo tệp trong Temp mới hơn 24h → không bị liệt kê | | | |
| 3.4 | Thêm thư mục loại trừ trong Cài đặt → tệp bên trong không bị liệt kê | | | |
| 3.5 | ⚠ Dọn danh mục user → số byte giải phóng khớp chênh lệch dung lượng ổ | | | |
| 3.6 | ⚠ Dọn danh mục hệ thống 🛡 → hỏi quyền một lần cho tất cả | | | |
| 3.7 | Tệp đang bị khóa → được bỏ qua, báo số tệp bỏ qua | | | |

## 4. Quyền riêng tư

| # | Kiểm tra | Win | macOS | Linux |
|---|---|---|---|---|
| 4.1 | Phát hiện đúng các profile Chrome/Edge/Brave/Opera/Vivaldi/Firefox | | | |
| 4.2 | Mật khẩu & dữ liệu tự động điền không tick sẵn, có cảnh báo đỏ + checkbox xác nhận | | | |
| 4.3 | Trình duyệt đang mở → badge "Đang chạy", nút "Đóng trình duyệt" hoạt động | | | |
| 4.4 | ⚠ Xóa lịch sử Firefox → **bookmark vẫn còn** | | | |
| 4.5 | ⚠ Xóa cache + cookie Chrome → đăng xuất web, bookmark & extension vẫn còn | | | |

## 5. Multi Uninstaller

| # | Kiểm tra | Win | macOS | Linux |
|---|---|---|---|---|
| 5.1 | Danh sách có icon, publisher, ngày cài; dung lượng tính dần ở nền | | | |
| 5.2 | Tìm kiếm & bộ lọc (lớn, mới cài, Store/Flatpak, bị lỗi) | | | |
| 5.3 | ⚠ Gỡ 2 app cùng lúc → chạy tuần tự, mỗi app có bước tàn dư riêng | | | |
| 5.4 | Uninstaller mở trang khảo sát → nút "Trình gỡ cài đặt đã xong" xuất hiện và hoạt động | | ➖ | ➖ |
| 5.5 | Tàn dư: mục "An toàn" tick sẵn, mục "Có thể" không tick; **không có thư mục của app khác** | | | |
| 5.6 | ⚠ Xóa tàn dư → vào Lịch sử › Khu cách ly → Khôi phục trả lại đúng chỗ (kể cả registry) | | ➖ | ➖ |
| 5.7 | App Store (Windows) gỡ được; gói deb có phụ thuộc → từ chối với thông báo | | ➖ | |

## 6. Khởi động cùng máy & tiện ích

| # | Kiểm tra | Win | macOS | Linux |
|---|---|---|---|---|
| 6.1 | Tắt một mục Run (user) → Task Manager cũng hiện "Disabled"; bật lại được | | ➖ | ➖ |
| 6.2 | Mục HKLM / dịch vụ / LaunchDaemon → hỏi quyền | | | ➖ |
| 6.3 | Chữ ký số được cập nhật sau khi danh sách hiện ra | | ➖ | ➖ |
| 6.4 | ⚠ Gỡ mục khởi động → có trong Khu cách ly, khôi phục được | | | |
| 6.5 | Extensions: Chromium → nút "Quản lý" mở đúng trang; Firefox gỡ được khi đã đóng Firefox | | | |

## 7. Tệp tin

| # | Kiểm tra | Win | macOS | Linux |
|---|---|---|---|---|
| 7.1 | Space Lens: quét ổ đĩa, treemap đúng tỉ lệ, nhấp đúp để đi sâu, breadcrumb | | | |
| 7.2 | Tệp lớn: lọc theo kích thước/tuổi/loại; ⚠ chuyển vào Thùng rác | | | |
| 7.3 | Trùng lặp: hard link không bị coi là trùng; không cho chọn hết bản của một nhóm | | | |
| 7.4 | Thư mục rỗng: không liệt kê thư mục ẩn / .git / node_modules | | | |
| 7.5 | Shortcut hỏng: shortcut tới ổ USB đã rút không bị liệt kê | | | |
| 7.6 | Thùng rác: hiện đường dẫn gốc + ngày xóa; lọc "cách đây hơn 30 ngày" | | | |

## 8. Shredder & Wiper ⚠ (chỉ trên máy thử / ổ USB thử)

| # | Kiểm tra | Win | macOS | Linux |
|---|---|---|---|---|
| 8.1 | Kéo thả tệp/thư mục; thư mục hệ thống/home bị chặn với nhãn đỏ | | | |
| 8.2 | Phải gõ XOA/DELETE mới bấm được | | | |
| 8.3 | Hủy tệp 200 MB với DoD 3 lượt + verify → dùng phần mềm khôi phục (Recuva/PhotoRec) không thấy | | | |
| 8.4 | Xuất báo cáo PDF/JSON; mã SHA-256 khớp nội dung JSON | | | |
| 8.5 | Wiper trên ổ USB: tiến trình, tốc độ, ETA; Dừng giữa chừng → thư mục `.securewipe-*` bị xóa | | | |
| 8.6 | Sau wipe, PhotoRec không khôi phục được tệp đã xóa trước đó (HDD/USB) | | | |
| 8.7 | TRIM trên SSD hỏi quyền; báo cáo ghi "đã chạy" | | ➖ | |

## 9. Sức khỏe ổ đĩa & điểm khôi phục

| # | Kiểm tra | Win | macOS | Linux |
|---|---|---|---|---|
| 9.1 | Danh sách ổ vật lý, SSD/HDD, bus, trạng thái | | | |
| 9.2 | "Đọc SMART chi tiết" 🛡 → nhiệt độ/hao mòn/giờ hoạt động (Linux cần smartmontools) | | ➖ | |
| 9.3 | Restore point: tải danh sách 🛡, tạo mới, xóa | | | ➖ |

## 10. Lịch sử & cập nhật

| # | Kiểm tra | Win | macOS | Linux |
|---|---|---|---|---|
| 10.1 | Mọi thao tác xuất hiện trong Lịch sử với số mục/dung lượng thật | | | |
| 10.2 | Xuất CSV mở được bằng Excel (UTF-8) | | | |
| 10.3 | Khu cách ly hết hạn tự xóa khi mở app sau N ngày | | | |
| 10.4 | Kiểm tra cập nhật: không có mạng → báo lỗi nhẹ nhàng; có bản mới → hiện ở trang Giới thiệu | | | |

## 11. Trạng thái dịch vụ (nvma.site/securewipe.json)

| # | Kiểm tra | Win | macOS | Linux |
|---|---|---|---|---|
| 11.1 | `status: "Active"` → app chạy bình thường | | | |
| 11.2 | Đổi `latest.version` lên `1.0.1` → mở lại app thấy nút "Cập nhật 1.0.1"; Tùy chọn tắt "Thông báo khi có bản mới" → nút biến mất | | | |
| 11.3 | `status: "Deactive"` → mở lại app hiện **Out of Service** với nội dung `message`; nút Thử lại sau khi đổi về Active thì mở khóa | | | |
| 11.4 | Đổi sang Deactive khi đang quét/hủy tệp → tác vụ chạy xong mới khóa; không bắt đầu được tác vụ mới | | | |
| 11.5 | Khi bị khóa: khôi phục được tệp trong khu cách ly | | | |
| 11.6 | `status: "actve"` (gõ sai) → app không khóa | | | |
| 11.7 | Tắt mạng → app vẫn chạy (trong hạn 60 ngày) | | | |

## 12. Ngủ đông (Windows)

| # | Kiểm tra | Win |
|---|---|---|
| 12.1 | Hiển thị đúng trạng thái, loại (Đầy đủ/Thu gọn), dung lượng hiberfil.sys, Khởi động nhanh | |
| 12.2 | ⚠ Thu gọn → hỏi UAC, dung lượng giảm, Khởi động nhanh vẫn bật | |
| 12.3 | ⚠ Tắt → cảnh báo, hiberfil.sys bị xóa, dung lượng được cộng vào "đã giải phóng" | |
| 12.4 | ⚠ Bật lại (đầy đủ) → hiberfil.sys xuất hiện lại | |
